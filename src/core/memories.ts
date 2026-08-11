import fs from 'node:fs';
import { type DB, ensureVecTable, getSetting, setSetting } from './db.js';
import { chunkText } from './chunking.js';
import type { Embedder } from './embeddings.js';

import { emitMemoryEvent } from './events.js';

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export interface Memory {
  id: number;
  content: string;
  title: string | null;
  tags: string[];
  source: string;
  created_at: string;
  updated_at: string;
  pinned: boolean;
  archived: boolean;
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

function toMemory(row: MemoryRow): Memory {
  return {
    ...row,
    tags: JSON.parse(row.tags) as string[],
    pinned: !!row.pinned,
    archived: !!row.archived,
  };
}

function validateContent(content: unknown): string {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new ValidationError('content must be a non-empty string');
  }
  return content.trim();
}

function validateTags(tags: unknown): string[] {
  if (tags === undefined) return [];
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) {
    throw new ValidationError('tags must be an array of strings');
  }
  return tags as string[];
}

function vecBuffer(vec: number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer);
}

/** Chunk + embed content, then replace all chunks/vectors for the memory in one transaction. */
async function writeChunks(db: DB, embedder: Embedder, memoryId: number, content: string) {
  const chunks = chunkText(content);
  const vecs = await embedder.embed(chunks.map((c) => c.text));
  ensureVecTable(db, embedder.dim);
  db.transaction(() => {
    const old = db.prepare('SELECT id FROM chunks WHERE memory_id = ?').all(memoryId) as {
      id: number;
    }[];
    // vec0 requires strict INTEGER rowids — BigInt forces integer binding
    for (const { id } of old) db.prepare('DELETE FROM chunks_vec WHERE rowid = ?').run(BigInt(id));
    db.prepare('DELETE FROM chunks WHERE memory_id = ?').run(memoryId);
    const insChunk = db.prepare(
      'INSERT INTO chunks (memory_id, seq, text, token_count) VALUES (?, ?, ?, ?)',
    );
    const insVec = db.prepare('INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)');
    chunks.forEach((c, i) => {
      const chunkId = insChunk.run(memoryId, i, c.text, c.tokenCount).lastInsertRowid as number;
      insVec.run(BigInt(chunkId), vecBuffer(vecs[i]));
    });
  })();
}

export async function saveMemory(
  db: DB,
  embedder: Embedder,
  input: { content: string; tags?: string[]; source: string },
): Promise<Memory> {
  const content = validateContent(input.content);
  const tags = validateTags(input.tags);
  const now = new Date().toISOString();
  const id = db
    .prepare(
      'INSERT INTO memories (content, tags, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(content, JSON.stringify(tags), input.source, now, now).lastInsertRowid as number;
  await writeChunks(db, embedder, id, content);
  setSetting(db, 'embedding_model', embedder.model);
  emitMemoryEvent({ type: 'saved', id, source: input.source });
  return getMemory(db, id);
}

export function getMemory(db: DB, id: number): Memory {
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
  if (!row) throw new NotFoundError(`memory ${id} not found`);
  return toMemory(row);
}

export async function updateMemory(
  db: DB,
  embedder: Embedder,
  id: number,
  patch: { content?: string; tags?: string[]; pinned?: boolean; archived?: boolean },
): Promise<Memory> {
  const existing = getMemory(db, id);
  const content = patch.content !== undefined ? validateContent(patch.content) : existing.content;
  const tags = patch.tags !== undefined ? validateTags(patch.tags) : existing.tags;
  const pinned = patch.pinned !== undefined ? patch.pinned : existing.pinned;
  const archived = patch.archived !== undefined ? patch.archived : existing.archived;
  db.prepare(
    'UPDATE memories SET content = ?, tags = ?, pinned = ?, archived = ?, updated_at = ? WHERE id = ?',
  ).run(content, JSON.stringify(tags), pinned ? 1 : 0, archived ? 1 : 0, new Date().toISOString(), id);
  if (patch.content !== undefined && content !== existing.content) {
    // the LLM title described the old content — clear it so it can be re-proposed
    db.prepare('UPDATE memories SET title = NULL WHERE id = ?').run(id);
    await writeChunks(db, embedder, id, content);
  }
  emitMemoryEvent({ type: 'updated', id, source: existing.source });
  return getMemory(db, id);
}

export function deleteMemory(db: DB, id: number): void {
  getMemory(db, id); // throws NotFoundError
  db.transaction(() => {
    const old = db.prepare('SELECT id FROM chunks WHERE memory_id = ?').all(id) as { id: number }[];
    for (const { id: cid } of old)
      db.prepare('DELETE FROM chunks_vec WHERE rowid = ?').run(BigInt(cid));
    db.prepare('DELETE FROM memories WHERE id = ?').run(id); // chunks cascade
  })();
  emitMemoryEvent({ type: 'deleted', id });
}

export function listMemories(
  db: DB,
  opts: { limit?: number; tag?: string; archived?: boolean } = {},
): Memory[] {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 500));
  // default view: live pages only, pinned float; archived view: the drawer of struck pages
  const where = [opts.archived ? 'archived = 1' : 'archived = 0'];
  const params: (string | number)[] = [];
  if (opts.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(memories.tags) WHERE json_each.value = ?)');
    params.push(opts.tag);
  }
  const rows = db
    .prepare(
      `SELECT * FROM memories WHERE ${where.join(' AND ')}
       ORDER BY pinned DESC, created_at DESC, id DESC LIMIT ?`,
    )
    .all(...params, limit) as MemoryRow[];
  return rows.map(toMemory);
}

/** Oldest untouched live entries — candidates for confirm-or-strike review. */
export function listStale(db: DB, opts: { days?: number; limit?: number } = {}): Memory[] {
  const days = Math.max(1, opts.days ?? 90);
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const rows = db
    .prepare(
      'SELECT * FROM memories WHERE archived = 0 AND pinned = 0 AND updated_at < ? ORDER BY updated_at ASC LIMIT ?',
    )
    .all(cutoff, limit) as MemoryRow[];
  return rows.map(toMemory);
}

export function stats(db: DB, dbFile: string): {
  memories: number;
  chunks: number;
  dbSizeBytes: number;
  embeddingModel: string | null;
} {
  const memories = (db.prepare('SELECT COUNT(*) n FROM memories').get() as { n: number }).n;
  const chunks = (db.prepare('SELECT COUNT(*) n FROM chunks').get() as { n: number }).n;
  let dbSizeBytes = 0;
  try {
    dbSizeBytes = fs.statSync(dbFile).size;
  } catch {}
  return { memories, chunks, dbSizeBytes, embeddingModel: getSetting(db, 'embedding_model') ?? null };
}

/**
 * Re-embed every chunk with the current embedder. Called on boot when the
 * embedding model changed — vectors from different models must never mix.
 */
export async function reembedAll(db: DB, embedder: Embedder): Promise<number> {
  ensureVecTable(db, embedder.dim);
  const rows = db.prepare('SELECT id, text FROM chunks ORDER BY id').all() as {
    id: number;
    text: string;
  }[];
  if (rows.length === 0) {
    setSetting(db, 'embedding_model', embedder.model);
    return 0;
  }
  const vecs = await embedder.embed(rows.map((r) => r.text));
  db.transaction(() => {
    const ins = db.prepare('INSERT OR REPLACE INTO chunks_vec (rowid, embedding) VALUES (?, ?)');
    rows.forEach((r, i) => ins.run(BigInt(r.id), vecBuffer(vecs[i])));
  })();
  setSetting(db, 'embedding_model', embedder.model);
  return rows.length;
}

/** True when stored vectors were produced by a different model than the current embedder. */
export function needsReembed(db: DB, embedder: Embedder): boolean {
  const stored = getSetting(db, 'embedding_model');
  return stored !== undefined && stored !== embedder.model;
}
