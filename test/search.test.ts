import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveMemory } from '../src/core/memories.js';
import { searchMemories } from '../src/core/search.js';
import { tempDb, fakeEmbedder } from './helpers.js';
import type { DB } from '../src/core/db.js';

const embedder = fakeEmbedder();
let db: DB, cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = tempDb());
  await saveMemory(db, embedder, {
    content: 'user favorite fruit is mango',
    tags: ['food'],
    source: 'ui',
  });
  await saveMemory(db, embedder, {
    content: 'project deadline is friday',
    tags: ['work'],
    source: 'mcp:claude',
  });
  await saveMemory(db, embedder, {
    content: 'user dislikes cilantro in food',
    tags: ['food'],
    source: 'ui',
  });
});
afterEach(() => cleanup());

describe('hybrid search', () => {
  it('finds by keyword, ranks the matching memory first', async () => {
    const r = await searchMemories(db, embedder, { query: 'mango' });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].content).toContain('mango');
    expect(r[0].score).toBeGreaterThan(0);
    expect(r[0].source).toBe('ui');
  });

  it('shared-word semantic match via vectors', async () => {
    const r = await searchMemories(db, embedder, { query: 'deadline friday project' });
    expect(r[0].content).toContain('deadline');
  });

  it('tag filter narrows results', async () => {
    const r = await searchMemories(db, embedder, { query: 'user food', tags: ['food'] });
    expect(r.length).toBeGreaterThan(0);
    for (const m of r) expect(m.tags).toContain('food');
  });

  it('topK respected, empty query → empty', async () => {
    expect(await searchMemories(db, embedder, { query: '  ' })).toEqual([]);
    const r = await searchMemories(db, embedder, { query: 'user', topK: 1 });
    expect(r).toHaveLength(1);
  });

  it('FTS special characters do not crash', async () => {
    const r = await searchMemories(db, embedder, { query: '"mango" AND (fruit)' });
    expect(Array.isArray(r)).toBe(true);
  });
});

describe('relevance floor', () => {
  it('nonsense queries return nothing instead of least-unrelated neighbors', async () => {
    const { tempDb, fakeEmbedder } = await import('./helpers.js');
    const { saveMemory } = await import('../src/core/memories.js');
    const { db, cleanup } = tempDb();
    const embedder = fakeEmbedder();
    await saveMemory(db, embedder, { content: 'the user prefers dark themes', source: 'ui' });
    await saveMemory(db, embedder, { content: 'aurora is a music player project', source: 'ui' });
    const r = await searchMemories(db, embedder, { query: 'zzzz_not_a_real_term_987654321' });
    expect(r).toEqual([]);
    cleanup();
  });
});
