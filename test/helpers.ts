import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type DB } from '../src/core/db.js';
import type { Embedder } from '../src/core/embeddings.js';

/** Deterministic word-bucket embedder: shared words → similar vectors. No network, no model. */
export function fakeEmbedder(dim = 16): Embedder {
  function vec(text: string): number[] {
    const v = new Array<number>(dim).fill(0);
    for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
      let h = 5381;
      for (const ch of word) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
      v[h % dim] += 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
  return {
    model: 'fake-test-embedder',
    dim,
    embed: async (texts) => texts.map(vec),
    embedQuery: async (text) => vec(text),
  };
}

export function tempDb(): { db: DB; file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'membrain-test-'));
  const file = path.join(dir, 'memory.db');
  const db = openDb(file);
  return {
    db,
    file,
    cleanup: () => {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
