import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type DB, getSetting, setSetting } from './db.js';
import type { Embedder } from './embeddings.js';
import { type Memory, NotFoundError, getMemory, saveMemory, updateMemory } from './memories.js';

export type AgentFileStatus = 'new' | 'imported' | 'changed';

export interface AgentMemoryFile {
  path: string;
  agent: string;
  project: string | null;
  name: string;
  description: string;
  status: AgentFileStatus;
  importedAt: string | null;
}

export interface AgentImportResult {
  memories: Memory[];
  added: number;
  updated: number;
  skipped: number;
}

interface Frontmatter {
  meta: Record<string, string>;
  body: string;
}

interface ImportRecord {
  hash: string;
  importedAt: string;
  memoryId: number;
}

function parseFrontmatter(content: string): Frontmatter {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: content.slice(m[0].length) };
}

const hash = (content: string) => crypto.createHash('sha256').update(content).digest('hex');

// Which files were already imported (path → content hash + resulting memory).
// Lives in settings so re-imports can be blocked and changes detected.
function importRecords(db: DB): Record<string, ImportRecord> {
  const raw = getSetting(db, 'agent_imports');
  return raw ? (JSON.parse(raw) as Record<string, ImportRecord>) : {};
}

function saveRecords(db: DB, records: Record<string, ImportRecord>): void {
  setSetting(db, 'agent_imports', JSON.stringify(records));
}

/**
 * Directories scanned for pre-existing agent memory (*.md fact files).
 * Default: every Claude Code project memory dir under ~/.claude/projects.
 * Extra dirs via settings agent_memory_dirs = ["\/abs\/path", ...].
 */
function memoryDirs(db: DB): { dir: string; agent: string; project: string | null }[] {
  const out: { dir: string; agent: string; project: string | null }[] = [];
  const projects = path.join(os.homedir(), '.claude', 'projects');
  try {
    for (const e of fs.readdirSync(projects, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const dir = path.join(projects, e.name, 'memory');
      if (fs.existsSync(dir)) out.push({ dir, agent: 'claude', project: e.name });
    }
  } catch {}
  const extra = getSetting(db, 'agent_memory_dirs');
  if (extra) {
    for (const dir of JSON.parse(extra) as string[]) {
      if (fs.existsSync(dir)) out.push({ dir, agent: 'custom', project: path.basename(dir) });
    }
  }
  return out;
}

export function discoverAgentMemory(db: DB): AgentMemoryFile[] {
  const records = importRecords(db);
  const out: AgentMemoryFile[] = [];
  for (const { dir, agent, project } of memoryDirs(db)) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
    } catch {
      continue;
    }
    for (const f of files) {
      const file = path.join(dir, f);
      try {
        const content = fs.readFileSync(file, 'utf8');
        const { meta } = parseFrontmatter(content);
        const rec = records[path.resolve(file)];
        const status: AgentFileStatus = !rec
          ? 'new'
          : rec.hash === hash(content)
            ? 'imported'
            : 'changed';
        out.push({
          path: file,
          agent,
          project,
          name: meta.name ?? path.basename(f, '.md'),
          description: meta.description ?? '',
          status,
          importedAt: rec?.importedAt ?? null,
        });
      } catch {}
    }
  }
  return out;
}

/**
 * Import selected agent memory files into membrain, one memory per file.
 * Paths must come from discoverAgentMemory — anything else is rejected.
 * Already-imported unchanged files are skipped (never duplicated); changed
 * files UPDATE the memory created last time instead of adding a copy.
 * Originals are left untouched.
 */
export async function importAgentMemory(
  db: DB,
  embedder: Embedder,
  paths: string[],
): Promise<AgentImportResult> {
  const known = new Map(discoverAgentMemory(db).map((f) => [path.resolve(f.path), f]));
  const records = importRecords(db);
  const result: AgentImportResult = { memories: [], added: 0, updated: 0, skipped: 0 };

  for (const p of paths) {
    const resolved = path.resolve(p);
    const file = known.get(resolved);
    if (!file) throw new NotFoundError(`not a discovered agent memory file: ${p}`);
    if (file.status === 'imported') {
      result.skipped++;
      continue;
    }
    const raw = fs.readFileSync(file.path, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    const content = body.trim() || file.description;
    const tags = ['agent-import', file.agent];
    const type = meta.type?.match(/\w+/)?.[0];
    if (type) tags.push(type);

    const prior = records[resolved];
    let memory: Memory | null = null;
    if (prior) {
      try {
        getMemory(db, prior.memoryId);
        memory = await updateMemory(db, embedder, prior.memoryId, { content, tags });
        result.updated++;
      } catch {
        memory = null; // original membrain memory was deleted — recreate
      }
    }
    if (!memory) {
      memory = await saveMemory(db, embedder, { content, tags, source: 'import' });
      result.added++;
    }
    records[resolved] = { hash: hash(raw), importedAt: new Date().toISOString(), memoryId: memory.id };
    result.memories.push(memory);
  }
  saveRecords(db, records);
  return result;
}
