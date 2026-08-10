import { describe, it, expect } from 'vitest';
import { chunkText, estimateTokens } from '../src/core/chunking.js';

describe('chunking', () => {
  it('empty and whitespace-only → no chunks', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n ')).toEqual([]);
  });

  it('short text → single chunk', () => {
    const chunks = chunkText('a small fact about the user');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('a small fact about the user');
  });

  it('long text → multiple chunks with overlap, nothing lost', () => {
    const words = Array.from({ length: 2000 }, (_, i) => `word${i}`);
    const text = words.join(' ');
    const chunks = chunkText(text, 800, 0.15);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(800);
    // every word survives chunking
    const joined = chunks.map((c) => c.text).join(' ');
    for (const w of ['word0', 'word999', 'word1999']) expect(joined).toContain(w);
    // consecutive chunks share overlap
    const tail = chunks[0].text.split(' ').slice(-3).join(' ');
    expect(chunks[1].text).toContain(tail.split(' ')[2]);
  });

  it('estimateTokens ~ chars/4', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });
});
