import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findDuplicates } from '../src/core/dedupe.js';
import { saveMemory } from '../src/core/memories.js';
import { tempDb, fakeEmbedder } from './helpers.js';
import type { DB } from '../src/core/db.js';

const embedder = fakeEmbedder();
let db: DB, cleanup: () => void;

beforeEach(() => ({ db, cleanup } = tempDb()));
afterEach(() => cleanup());

describe('dedupe', () => {
  it('finds identical-content memories as a pair, distinct ones stay out', async () => {
    const a = await saveMemory(db, embedder, { content: 'user loves mango juice', source: 'ui' });
    const b = await saveMemory(db, embedder, {
      content: 'user loves mango juice',
      source: 'mcp:claude',
    });
    await saveMemory(db, embedder, {
      content: 'deploy pipeline runs entirely on fridays',
      source: 'ui',
    });
    const pairs = findDuplicates(db, 0.95);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].a.id, pairs[0].b.id].sort()).toEqual([a.id, b.id]);
    expect(pairs[0].similarity).toBeGreaterThan(0.99);
  });

  it('empty store → no pairs', () => {
    expect(findDuplicates(db)).toEqual([]);
  });
});
