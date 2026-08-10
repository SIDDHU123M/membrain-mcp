import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { importFile } from '../src/core/importer.js';
import { setSetting } from '../src/core/db.js';
import { ValidationError } from '../src/core/memories.js';
import { tempDb, fakeEmbedder } from './helpers.js';
import type { DB } from '../src/core/db.js';

const embedder = fakeEmbedder();
let db: DB, cleanup: () => void;

beforeEach(() => {
  ({ db, cleanup } = tempDb());
  setSetting(db, 'import_llm', 'off'); // tests never talk to ollama
});
afterEach(() => cleanup());

describe('importer', () => {
  it('md file → one memory tagged with filename, source=import', async () => {
    const r = await importFile(db, embedder, {
      filename: 'notes.md',
      buffer: Buffer.from('# Notes\nremember the milk'),
    });
    expect(r.usedLlm).toBe(false);
    expect(r.memories).toHaveLength(1);
    expect(r.memories[0].source).toBe('import');
    expect(r.memories[0].tags).toContain('notes.md');
    expect(r.memories[0].content).toContain('remember the milk');
  });

  it('txt with extra tags', async () => {
    const r = await importFile(db, embedder, {
      filename: 'a.txt',
      buffer: Buffer.from('plain text'),
      tags: ['docs'],
    });
    expect(r.memories[0].tags).toEqual(['docs', 'a.txt']);
  });

  it('rejects unsupported extension and empty files', async () => {
    await expect(
      importFile(db, embedder, { filename: 'x.docx', buffer: Buffer.from('x') }),
    ).rejects.toThrow(ValidationError);
    await expect(
      importFile(db, embedder, { filename: 'x.txt', buffer: Buffer.from('   ') }),
    ).rejects.toThrow(ValidationError);
  });
});
