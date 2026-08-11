import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  saveMemory,
  getMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  listStale,
  stats,
  reembedAll,
  needsReembed,
  NotFoundError,
  ValidationError,
} from '../src/core/memories.js';
import { searchMemories } from '../src/core/search.js';
import { tempDb, fakeEmbedder } from './helpers.js';
import type { DB } from '../src/core/db.js';

const embedder = fakeEmbedder();
let db: DB, file: string, cleanup: () => void;

beforeEach(() => ({ db, file, cleanup } = tempDb()));
afterEach(() => cleanup());

describe('memories CRUD', () => {
  it('pin floats to top, archive hides from list and recall, stale skips pinned', async () => {
    const a = await saveMemory(db, embedder, { content: 'first note', source: 'ui' });
    const b = await saveMemory(db, embedder, { content: 'second note', source: 'ui' });
    await updateMemory(db, embedder, a.id, { pinned: true });
    expect(listMemories(db)[0].id).toBe(a.id); // pinned beats newer

    await updateMemory(db, embedder, b.id, { archived: true });
    expect(listMemories(db).map((m) => m.id)).not.toContain(b.id);
    expect(listMemories(db, { archived: true }).map((m) => m.id)).toEqual([b.id]);
    const res = await searchMemories(db, embedder, { query: 'second note' });
    expect(res.map((r) => r.id)).not.toContain(b.id);

    db.prepare("UPDATE memories SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(a.id);
    expect(listStale(db, { days: 30 })).toHaveLength(0); // pinned exempt
    await updateMemory(db, embedder, a.id, { pinned: false });
    db.prepare("UPDATE memories SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(a.id);
    expect(listStale(db, { days: 30 }).map((m) => m.id)).toEqual([a.id]);
  });

  it('save → get round-trip with chunks and vectors', async () => {
    const m = await saveMemory(db, embedder, {
      content: 'user prefers dark mode',
      tags: ['pref'],
      source: 'ui',
    });
    expect(m.id).toBe(1);
    expect(m.tags).toEqual(['pref']);
    expect(getMemory(db, m.id).content).toBe('user prefers dark mode');
    expect(db.prepare('SELECT count(*) n FROM chunks').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT count(*) n FROM chunks_vec').get()).toEqual({ n: 1 });
  });

  it('long content → multiple chunks, delete cleans everything', async () => {
    const long = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ');
    const m = await saveMemory(db, embedder, { content: long, source: 'import' });
    const n = (db.prepare('SELECT count(*) n FROM chunks').get() as { n: number }).n;
    expect(n).toBeGreaterThan(1);
    deleteMemory(db, m.id);
    expect(db.prepare('SELECT count(*) n FROM chunks').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) n FROM chunks_vec').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) n FROM chunks_fts').get()).toEqual({ n: 0 });
    expect(() => getMemory(db, m.id)).toThrow(NotFoundError);
  });

  it('update content re-chunks; update tags only leaves chunks alone', async () => {
    const m = await saveMemory(db, embedder, { content: 'old fact', source: 'ui' });
    const chunkId = (db.prepare('SELECT id FROM chunks').get() as { id: number }).id;
    const t1 = await updateMemory(db, embedder, m.id, { tags: ['a'] });
    expect(t1.tags).toEqual(['a']);
    expect((db.prepare('SELECT id FROM chunks').get() as { id: number }).id).toBe(chunkId);
    const t2 = await updateMemory(db, embedder, m.id, { content: 'new fact' });
    expect(t2.content).toBe('new fact');
    expect((db.prepare('SELECT text FROM chunks').get() as { text: string }).text).toBe('new fact');
  });

  it('validation: empty content, bad tags', async () => {
    await expect(saveMemory(db, embedder, { content: ' ', source: 'ui' })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      saveMemory(db, embedder, { content: 'x', tags: [1] as unknown as string[], source: 'ui' }),
    ).rejects.toThrow(ValidationError);
  });

  it('list: newest first, tag filter, limit', async () => {
    await saveMemory(db, embedder, { content: 'one', tags: ['t1'], source: 'ui' });
    await saveMemory(db, embedder, { content: 'two', tags: ['t2'], source: 'ui' });
    await saveMemory(db, embedder, { content: 'three', tags: ['t1'], source: 'mcp:claude' });
    const all = listMemories(db);
    expect(all.map((m) => m.content)).toEqual(['three', 'two', 'one']);
    expect(listMemories(db, { tag: 't1' }).map((m) => m.content)).toEqual(['three', 'one']);
    expect(listMemories(db, { limit: 1 })).toHaveLength(1);
  });

  it('stats counts and model name', async () => {
    await saveMemory(db, embedder, { content: 'x', source: 'ui' });
    const s = stats(db, file);
    expect(s.memories).toBe(1);
    expect(s.chunks).toBe(1);
    expect(s.dbSizeBytes).toBeGreaterThan(0);
    expect(s.embeddingModel).toBe('fake-test-embedder');
  });

  it('content edit clears the LLM title; tag-only edit keeps it', async () => {
    const m = await saveMemory(db, embedder, { content: 'original fact', source: 'ui' });
    db.prepare('UPDATE memories SET title = ? WHERE id = ?').run('A Title', m.id);
    const t1 = await updateMemory(db, embedder, m.id, { tags: ['keep'] });
    expect(t1.title).toBe('A Title');
    const t2 = await updateMemory(db, embedder, m.id, { content: 'changed fact' });
    expect(t2.title).toBeNull();
  });

  it('model switch flags + reembed fixes', async () => {
    await saveMemory(db, embedder, { content: 'a fact', source: 'ui' });
    const other = { ...fakeEmbedder(8), model: 'other-model' };
    expect(needsReembed(db, other)).toBe(true);
    expect(needsReembed(db, embedder)).toBe(false);
    const n = await reembedAll(db, other);
    expect(n).toBe(1);
    expect(needsReembed(db, other)).toBe(false);
    expect(db.prepare('SELECT count(*) n FROM chunks_vec').get()).toEqual({ n: 1 });
  });
});
