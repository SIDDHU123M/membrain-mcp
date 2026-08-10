import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.js';
import type { Embedder } from './embeddings.js';
import { type Memory, ValidationError, saveMemory } from './memories.js';

export interface MemoryExport {
  membrain: 1;
  exportedAt: string;
  memories: {
    content: string;
    title: string | null;
    tags: string[];
    source: string;
    created_at: string;
  }[];
}

export function exportMemories(db: DB, ids?: number[]): MemoryExport {
  const rows = (
    ids && ids.length > 0
      ? db
          .prepare(
            `SELECT content, title, tags, source, created_at FROM memories WHERE id IN (${ids
              .map(() => '?')
              .join(',')}) ORDER BY id`,
          )
          .all(...ids)
      : db.prepare('SELECT content, title, tags, source, created_at FROM memories ORDER BY id').all()
  ) as { content: string; title: string | null; tags: string; source: string; created_at: string }[];
  return {
    membrain: 1,
    exportedAt: new Date().toISOString(),
    memories: rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) as string[] })),
  };
}

/** Restore memories from an export file. Re-embeds everything; originals' timestamps are kept as tags-level data only. */
export async function importMemoriesJson(
  db: DB,
  embedder: Embedder,
  payload: unknown,
): Promise<Memory[]> {
  const p = payload as Partial<MemoryExport>;
  if (p?.membrain !== 1 || !Array.isArray(p.memories)) {
    throw new ValidationError('not a membrain memory export (expected {membrain:1, memories:[...]})');
  }
  const out: Memory[] = [];
  for (const m of p.memories) {
    if (typeof m?.content !== 'string' || m.content.trim().length === 0) continue;
    const source =
      typeof m.source === 'string' && /^(ui|import|mcp:.+)$/.test(m.source) ? m.source : 'import';
    const saved = await saveMemory(db, embedder, {
      content: m.content,
      tags: Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === 'string') : [],
      source,
    });
    if (typeof m.title === 'string' && m.title.trim()) {
      db.prepare('UPDATE memories SET title = ? WHERE id = ?').run(m.title.trim().slice(0, 80), saved.id);
      saved.title = m.title.trim().slice(0, 80);
    }
    out.push(saved);
  }
  return out;
}

/** Consistent snapshot of the live DB (safe under WAL). Returns the snapshot path. */
export async function backupDbFile(db: DB, dataDir: string): Promise<string> {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(dir, `membrain-${stamp}.db`);
  await db.backup(dest);
  return dest;
}

/** Automatic safety net: snapshot at boot, keep only the newest `keep` snapshots. */
export async function snapshotOnBoot(db: DB, dataDir: string, keep = 5): Promise<string> {
  const dest = await backupDbFile(db, dataDir);
  const dir = path.join(dataDir, 'backups');
  const old = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('membrain-') && f.endsWith('.db'))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return dest;
}
