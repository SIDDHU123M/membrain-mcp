import type { DB } from './db.js';
import type { Memory } from './memories.js';

export interface DuplicatePair {
  a: Memory;
  b: Memory;
  similarity: number;
}

interface MemoryRow {
  id: number;
  content: string;
  title: string | null;
  tags: string;
  source: string;
  created_at: string;
  updated_at: string;
  pinned: number;
  archived: number;
}

/**
 * Find likely duplicate memories by cosine similarity of their first-chunk
 * embeddings. Pure vector math — no LLM, works offline, instant.
 * ponytail: O(n²) over the store; fine for a personal DB, ANN if it ever isn't.
 */
export function findDuplicates(db: DB, threshold = 0.9, limit = 40): DuplicatePair[] {
  const hasVecs =
    (db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='chunks_vec'").get() as { n: number })
      .n > 0;
  if (!hasVecs) return [];
  const rows = db
    .prepare(
      `SELECT c.memory_id AS id, v.embedding AS embedding
       FROM chunks c JOIN chunks_vec v ON v.rowid = c.id
       WHERE c.seq = 0`,
    )
    .all() as { id: number; embedding: Buffer }[];
  const vecs = rows.map((r) => ({
    id: r.id,
    v: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4),
  }));

  const pairs: { a: number; b: number; similarity: number }[] = [];
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      let dot = 0;
      const va = vecs[i].v;
      const vb = vecs[j].v;
      for (let k = 0; k < va.length; k++) dot += va[k] * vb[k];
      // fastembed vectors are L2-normalized → dot product IS cosine similarity
      if (dot >= threshold) pairs.push({ a: vecs[i].id, b: vecs[j].id, similarity: dot });
    }
  }
  pairs.sort((x, y) => y.similarity - x.similarity);

  const get = db.prepare('SELECT * FROM memories WHERE id = ?');
  const out: DuplicatePair[] = [];
  for (const p of pairs.slice(0, limit)) {
    const a = get.get(p.a) as MemoryRow | undefined;
    const b = get.get(p.b) as MemoryRow | undefined;
    if (!a || !b) continue;
    out.push({
      a: { ...a, tags: JSON.parse(a.tags) as string[], pinned: !!a.pinned, archived: !!a.archived },
      b: { ...b, tags: JSON.parse(b.tags) as string[], pinned: !!b.pinned, archived: !!b.archived },
      similarity: Math.round(p.similarity * 1000) / 1000,
    });
  }
  return out;
}
