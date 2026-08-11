import crypto from 'node:crypto';
import { type DB, getSetting, setSetting } from './db.js';
import { OllamaError, ollamaConfig, ollamaGenerate } from './ollama.js';

export interface MapCategory {
  name: string;
  description: string;
  ids: number[];
}

export interface MemoryMap {
  builtAt: string;
  model: string;
  hash: string;
  stale: boolean;
  categories: MapCategory[];
}

/** Cheap change detector: memory count + latest update. */
export function storeHash(db: DB): string {
  const row = db
    .prepare("SELECT COUNT(*) n, COALESCE(MAX(updated_at), '') m FROM memories")
    .get() as { n: number; m: string };
  return `${row.n}:${row.m}`;
}

export function getCachedMap(db: DB): MemoryMap | null {
  const raw = getSetting(db, 'memory_map');
  if (!raw) return null;
  const map = JSON.parse(raw) as MemoryMap;
  map.stale = map.hash !== storeHash(db);
  return map;
}

const MAP_CAP = 500;
const MAP_BATCH = 10;

export interface MapProgress {
  done: number;
  total: number;
  map: MemoryMap;
}

let mapBuilding = false;

/**
 * Organize the store incrementally: memories go through the LLM in small
 * batches, each batch sees the category list so far and either assigns to an
 * existing category or creates a new one. The partial map is persisted and
 * reported after every batch — the UI streams it live. Small prompts also
 * dodge context-window truncation entirely.
 */
export async function buildMemoryMap(
  db: DB,
  onProgress?: (p: MapProgress) => void,
): Promise<MemoryMap> {
  if (mapBuilding) throw new OllamaError('a map build is already running');
  const cfg = await ollamaConfig(db);
  if (!cfg) throw new OllamaError('No AI available — start Ollama or configure a cloud provider in Settings');
  const rows = db
    .prepare('SELECT id, content FROM memories ORDER BY id DESC LIMIT ?')
    .all(MAP_CAP) as { id: number; content: string }[];
  if (rows.length === 0) throw new OllamaError('nothing to map — the store is empty');

  mapBuilding = true;
  try {
    const categories: MapCategory[] = [];
    const findCat = (name: string) =>
      categories.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());

    const snapshot = (done: number): MemoryMap => ({
      builtAt: new Date().toISOString(),
      model: cfg.model,
      hash: done >= rows.length ? storeHash(db) : `building:${done}/${rows.length}`,
      stale: false,
      categories: categories.filter((c) => c.ids.length > 0),
    });

    for (let i = 0; i < rows.length; i += MAP_BATCH) {
      const batch = rows.slice(i, i + MAP_BATCH);
      const catList =
        categories.length > 0
          ? categories.map((c) => `- ${c.name}: ${c.description}`).join('\n')
          : '(none yet)';
      const out = await ollamaGenerate(
        cfg,
        'You are filing memories from a personal memory store into topical categories.\n' +
          'EXISTING CATEGORIES:\n' +
          catList +
          '\n\nFile each memory below into ONE existing category when it fits; only create a new ' +
          'category when nothing fits. New category names are short (1-3 words) with a one-sentence ' +
          'description. Respond with JSON: {"assignments":[{"id":1,"category":"Category Name"}],' +
          '"newCategories":[{"name":"...","description":"..."}]}\n\n' +
          'MEMORIES (id: content):\n' +
          batch.map((r) => `${r.id}: ${r.content.replace(/\s+/g, ' ').slice(0, 280)}`).join('\n'),
        { json: true, timeoutMs: 120_000, numCtx: 8192 },
      );

      const parsed = JSON.parse(out) as {
        assignments?: { id: number | string; category: string }[];
        newCategories?: { name: string; description?: string }[];
      };
      for (const nc of parsed.newCategories ?? []) {
        if (typeof nc?.name === 'string' && nc.name.trim() && !findCat(nc.name)) {
          categories.push({
            name: nc.name.trim().slice(0, 40),
            description: String(nc.description ?? '').slice(0, 160),
            ids: [],
          });
        }
      }
      const valid = new Set(batch.map((r) => r.id));
      const placed = new Set<number>();
      for (const a of parsed.assignments ?? []) {
        const id = Number(a?.id);
        if (!Number.isInteger(id) || !valid.has(id) || placed.has(id)) continue;
        if (typeof a?.category !== 'string' || !a.category.trim()) continue;
        let cat = findCat(a.category);
        if (!cat) {
          cat = { name: a.category.trim().slice(0, 40), description: '', ids: [] };
          categories.push(cat);
        }
        cat.ids.push(id);
        placed.add(id);
      }
      for (const r of batch) {
        if (placed.has(r.id)) continue;
        let cat = findCat('Uncategorized');
        if (!cat) {
          cat = { name: 'Uncategorized', description: 'Not placed by the model.', ids: [] };
          categories.push(cat);
        }
        cat.ids.push(r.id);
      }

      const done = Math.min(i + MAP_BATCH, rows.length);
      const partial = snapshot(done);
      setSetting(db, 'memory_map', JSON.stringify(partial));
      onProgress?.({ done, total: rows.length, map: partial });
    }

    const map = snapshot(rows.length);
    if (map.categories.length === 0) throw new OllamaError('model returned no usable categories');
    setSetting(db, 'memory_map', JSON.stringify(map));
    return map;
  } finally {
    mapBuilding = false;
  }
}

// ---- AI proposal queue ----
// Every Ollama-driven change to a LIVE memory is staged here first and applied
// only when the user accepts it in the UI. Nothing edits the store silently.

export interface Proposal {
  id: string;
  memoryId: number;
  kind: 'title';
  old: string | null;
  next: string;
  model: string;
  createdAt: string;
}

export function getProposals(db: DB): Proposal[] {
  const raw = getSetting(db, 'ai_proposals');
  return raw ? (JSON.parse(raw) as Proposal[]) : [];
}

function saveProposals(db: DB, proposals: Proposal[]): void {
  setSetting(db, 'ai_proposals', JSON.stringify(proposals));
}

/** Accept (apply) or reject (drop) proposals by id. Skips memories that no longer exist. */
export function resolveProposals(
  db: DB,
  ids: string[],
  accept: boolean,
): { resolved: number; applied: number } {
  const wanted = new Set(ids);
  const all = getProposals(db);
  let applied = 0;
  let resolved = 0;
  const rest: Proposal[] = [];
  const upd = db.prepare('UPDATE memories SET title = ? WHERE id = ?');
  for (const p of all) {
    if (!wanted.has(p.id)) {
      rest.push(p);
      continue;
    }
    resolved++;
    if (accept && p.kind === 'title') {
      applied += upd.run(p.next, p.memoryId).changes;
    }
  }
  saveProposals(db, rest);
  return { resolved, applied };
}

export interface TitlesProgress {
  done: number;
  total: number;
  proposed: number;
}

const TITLE_BATCH = 1; // one memory per call, user's explicit choice — lightest possible load

/**
 * Ask the LLM for short display titles for memories that lack one — staged as
 * proposals for review, NOT applied. Runs in small batches with progress so
 * the UI can stream it live. Returns how many were proposed.
 */
export async function proposeTitles(
  db: DB,
  onProgress?: (p: TitlesProgress) => void,
  memoryIds?: number[],
): Promise<number> {
  const cfg = await ollamaConfig(db);
  if (!cfg) throw new OllamaError('No AI available — start Ollama or configure a cloud provider in Settings');
  const pending = new Set(
    getProposals(db)
      .filter((p) => p.kind === 'title')
      .map((p) => p.memoryId),
  );
  // explicit ids may re-title entries that already have one (old value kept on the proposal)
  const rows = (
    memoryIds && memoryIds.length > 0
      ? (db
          .prepare(
            `SELECT id, content, title FROM memories WHERE id IN (${memoryIds.map(() => '?').join(',')})`,
          )
          .all(...memoryIds) as { id: number; content: string; title: string | null }[])
      : (db
          .prepare('SELECT id, content, NULL AS title FROM memories WHERE title IS NULL ORDER BY id DESC LIMIT 120')
          .all() as { id: number; content: string; title: string | null }[])
  ).filter((r) => !pending.has(r.id));
  const oldTitles = new Map(rows.map((r) => [r.id, r.title]));

  let proposed = 0;
  for (let i = 0; i < rows.length; i += TITLE_BATCH) {
    const batch = rows.slice(i, i + TITLE_BATCH);
    const out = await ollamaGenerate(
      cfg,
      'Write a very short display title (3-7 words, no ending period) for each memory below. ' +
        'Respond with JSON: {"titles":[{"id":1,"title":"..."}]}\n\nMEMORIES (id: content):\n' +
        batch.map((r) => `${r.id}: ${r.content.replace(/\s+/g, ' ').slice(0, 240)}`).join('\n'),
      { json: true, timeoutMs: 120_000, numCtx: 2048 },
    );
    const parsed = JSON.parse(out) as { titles?: { id: number | string; title: string }[] };
    const valid = new Set(batch.map((r) => r.id));
    const proposals = getProposals(db); // reload each batch so accepts mid-run aren't lost
    for (const t of parsed.titles ?? []) {
      const id = Number(t?.id);
      if (Number.isInteger(id) && typeof t?.title === 'string' && valid.has(id)) {
        proposals.push({
          id: crypto.randomUUID(),
          memoryId: id,
          kind: 'title',
          old: oldTitles.get(id) ?? null,
          next: t.title.trim().slice(0, 80),
          model: cfg.model,
          createdAt: new Date().toISOString(),
        });
        proposed++;
      }
    }
    saveProposals(db, proposals);
    onProgress?.({ done: Math.min(i + TITLE_BATCH, rows.length), total: rows.length, proposed });
  }
  return proposed;
}

// ---- mind map: entity/relationship graph over the whole store ----
// Visualization only — search/retrieval never touches this (no GraphRAG layer).

export type NodeKind = 'person' | 'project' | 'tool' | 'preference' | 'topic' | 'fact';

export interface MindMapNode {
  id: string;
  label: string;
  kind: NodeKind;
  memoryIds: number[];
}

export interface MindMapEdge {
  from: string;
  to: string;
  label: string;
}

export interface MindMap {
  builtAt: string;
  model: string;
  hash: string;
  stale: boolean;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
}

export function getCachedMindMap(db: DB): MindMap | null {
  const raw = getSetting(db, 'mind_map');
  if (!raw) return null;
  const map = JSON.parse(raw) as MindMap;
  map.stale = map.hash !== storeHash(db);
  return map;
}

const KINDS: NodeKind[] = ['person', 'project', 'tool', 'preference', 'topic', 'fact'];

/** Ask the local LLM to extract a knowledge graph from the store; cache like the topic map. */
export async function buildMindMap(db: DB): Promise<MindMap> {
  const cfg = await ollamaConfig(db);
  if (!cfg) throw new OllamaError('No AI available — start Ollama or configure a cloud provider in Settings');
  const rows = db
    .prepare('SELECT id, content FROM memories ORDER BY id DESC LIMIT ?')
    .all(MAP_CAP) as { id: number; content: string }[];
  if (rows.length === 0) throw new OllamaError('nothing to map — the store is empty');

  const listing = rows
    .map((r) => `${r.id}: ${r.content.replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n');
  const out = await ollamaGenerate(
    cfg,
    'Build a knowledge map of this personal memory store. Extract the key entities as nodes — ' +
      'people, projects, tools, preferences, recurring topics — and the relationships between them ' +
      'as labeled edges (short verb phrases like "built with", "prefers", "works on"). ' +
      '8-25 nodes. Each node lists the memory ids it came from. Node kind must be one of: ' +
      'person, project, tool, preference, topic, fact. Respond with JSON: ' +
      '{"nodes":[{"id":"snake_case","label":"Display Name","kind":"project","memoryIds":[1,2]}],' +
      '"edges":[{"from":"node_id","to":"node_id","label":"relationship"}]}\n\n' +
      'MEMORIES (id: content):\n' +
      listing,
    { json: true, timeoutMs: 300_000 },
  );

  const parsed = JSON.parse(out) as { nodes?: MindMapNode[]; edges?: MindMapEdge[] };
  const valid = new Set(rows.map((r) => r.id));
  const nodes: MindMapNode[] = [];
  const seenIds = new Set<string>();
  for (const n of parsed.nodes ?? []) {
    if (typeof n?.id !== 'string' || typeof n?.label !== 'string' || seenIds.has(n.id)) continue;
    seenIds.add(n.id);
    nodes.push({
      id: n.id,
      label: n.label.slice(0, 60),
      kind: KINDS.includes(n.kind) ? n.kind : 'topic',
      memoryIds: Array.isArray(n.memoryIds)
        ? n.memoryIds.map((i) => Number(i)).filter((i) => Number.isInteger(i) && valid.has(i))
        : [],
    });
  }
  const edges = (parsed.edges ?? []).filter(
    (e): e is MindMapEdge =>
      typeof e?.from === 'string' &&
      typeof e?.to === 'string' &&
      seenIds.has(e.from) &&
      seenIds.has(e.to) &&
      e.from !== e.to,
  );
  if (nodes.length === 0) throw new OllamaError('model returned no usable nodes');

  const map: MindMap = {
    builtAt: new Date().toISOString(),
    model: cfg.model,
    hash: storeHash(db),
    stale: false,
    nodes,
    edges: edges.map((e) => ({ ...e, label: String(e.label ?? '').slice(0, 40) })),
  };
  setSetting(db, 'mind_map', JSON.stringify(map));
  return map;
}

export interface SavedSummary {
  text: string;
  count: number;
  at: string;
}

export function getLastSummary(db: DB): SavedSummary | null {
  const raw = getSetting(db, 'last_summary');
  return raw ? (JSON.parse(raw) as SavedSummary) : null;
}

/** Summarize the whole store, or just the given memory ids. */
export async function summarizeMemories(db: DB, ids?: number[]): Promise<string> {
  const cfg = await ollamaConfig(db);
  if (!cfg) throw new OllamaError('No AI available — start Ollama or configure a cloud provider in Settings');
  const rows = (
    ids && ids.length > 0
      ? db
          .prepare(
            `SELECT id, content FROM memories WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
          )
          .all(...ids)
      : db.prepare('SELECT id, content FROM memories ORDER BY id DESC LIMIT ?').all(MAP_CAP)
  ) as { id: number; content: string }[];
  if (rows.length === 0) throw new OllamaError('nothing to summarize');

  const text = await ollamaGenerate(
    cfg,
    'Summarize this personal memory store for its owner. Lead with a one-sentence overall picture, ' +
      'then the key themes as short plain lines (no markdown syntax), concrete and specific. Under 150 words.\n\n' +
      'MEMORIES:\n' +
      rows.map((r) => `- ${r.content.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n'),
    { timeoutMs: 300_000 },
  );
  setSetting(db, 'last_summary', JSON.stringify({ text, count: rows.length, at: new Date().toISOString() }));
  return text;
}
