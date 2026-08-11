import { type DB } from './db.js';
import type { Embedder } from './embeddings.js';
import type { Memory } from './memories.js';

export interface SearchResult extends Memory {
  score: number;
  /** recall receipt: which lists surfaced this memory */
  via: ('vec' | 'fts')[];
}

// FTS5 MATCH treats quotes/operators specially — quote every term, OR them for recall.
function ftsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' OR ');
}

const RRF_K = 60;

/**
 * Hybrid search: sqlite-vec cosine top-k + FTS5 keyword match, merged with
 * reciprocal rank fusion. Optional tag filter. Returns whole memories, best
 * chunk score wins per memory.
 */
export async function searchMemories(
  db: DB,
  embedder: Embedder,
  opts: { query: string; topK?: number; tags?: string[]; includeSealed?: boolean },
): Promise<SearchResult[]> {
  const topK = Math.max(1, Math.min(opts.topK ?? 5, 50));
  const query = opts.query.trim();
  if (query.length === 0) return [];
  // ponytail: overfetch then post-filter tags; pre-filtering inside vec knn needs
  // partition keys — add if tag-heavy DBs make this miss results
  const k = Math.max(topK * 4, 20);

  const scores = new Map<number, number>(); // chunk id → RRF score
  const vecHits = new Set<number>();
  const ftsHits = new Set<number>();

  const hasVecs =
    (db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='chunks_vec'").get() as { n: number })
      .n > 0;
  if (hasVecs) {
    const qv = await embedder.embedQuery(query);
    const vecRows = db
      .prepare('SELECT rowid, distance FROM chunks_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance')
      .all(Buffer.from(new Float32Array(qv).buffer), BigInt(k)) as {
      rowid: number;
      distance: number;
    }[];
    // KNN always returns the k *nearest* rows, however far away — a nonsense
    // query would surface whatever is least-unrelated. Floor it: unit vectors
    // under L2 give d = sqrt(2-2cos), so d > ~1.18 means cosine < ~0.30 — noise.
    const VEC_MAX_DISTANCE = 1.18;
    vecRows
      .filter((r) => r.distance <= VEC_MAX_DISTANCE)
      .forEach((r, rank) => {
        scores.set(r.rowid, (scores.get(r.rowid) ?? 0) + 1 / (RRF_K + rank + 1));
        vecHits.add(r.rowid);
      });
  }

  const match = ftsQuery(query);
  if (match.length > 0) {
    const ftsRows = db
      .prepare('SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?')
      .all(match, k) as { rowid: number }[];
    ftsRows.forEach((r, rank) => {
      scores.set(r.rowid, (scores.get(r.rowid) ?? 0) + 1 / (RRF_K + rank + 1));
      ftsHits.add(r.rowid);
    });
  }

  if (scores.size === 0) return [];

  // chunk → memory, keep the best-scoring chunk per memory; receipts union per memory
  const byMemory = new Map<number, number>();
  const viaByMemory = new Map<number, Set<'vec' | 'fts'>>();
  const chunkIds = [...scores.keys()];
  const placeholders = chunkIds.map(() => '?').join(',');
  const chunkRows = db
    .prepare(`SELECT id, memory_id FROM chunks WHERE id IN (${placeholders})`)
    .all(...chunkIds) as { id: number; memory_id: number }[];
  for (const { id, memory_id } of chunkRows) {
    const s = scores.get(id)!;
    if (s > (byMemory.get(memory_id) ?? 0)) byMemory.set(memory_id, s);
    const via = viaByMemory.get(memory_id) ?? new Set<'vec' | 'fts'>();
    if (vecHits.has(id)) via.add('vec');
    if (ftsHits.has(id)) via.add('fts');
    viaByMemory.set(memory_id, via);
  }

  // fetch candidate memories, then let recency join the fusion as a low-weight
  // third list — among equally relevant matches, newer memory wins
  type Row = {
    id: number;
    content: string;
    title: string | null;
    tags: string;
    source: string;
    created_at: string;
    updated_at: string;
    pinned: number;
    archived: number;
    sealed: number;
  };
  const getRow = db.prepare('SELECT * FROM memories WHERE id = ?');
  const candidates: { row: Row; score: number }[] = [];
  for (const [memoryId, score] of byMemory.entries()) {
    const row = getRow.get(memoryId) as Row | undefined;
    if (!row || row.archived) continue; // struck pages stay out of recall
    if (row.sealed && !opts.includeSealed) continue; // sealed pages never reach agents
    candidates.push({ row, score });
  }
  const RECENCY_WEIGHT = 0.5;
  [...candidates]
    .sort((a, b) => b.row.created_at.localeCompare(a.row.created_at))
    .forEach((c, rank) => {
      c.score += RECENCY_WEIGHT / (RRF_K + rank + 1);
    });

  const results: SearchResult[] = [];
  for (const { row, score } of candidates.sort((a, b) => b.score - a.score)) {
    const tags = JSON.parse(row.tags) as string[];
    if (opts.tags && opts.tags.length > 0 && !opts.tags.some((t) => tags.includes(t))) continue;
    results.push({
      ...row,
      tags,
      pinned: !!row.pinned,
      archived: !!row.archived,
      sealed: !!row.sealed,
      score,
      via: [...(viaByMemory.get(row.id) ?? [])],
    });
    if (results.length >= topK) break;
  }
  return results;
}
