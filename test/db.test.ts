import { describe, it, expect } from 'vitest';
import { ensureVecTable, getSetting, setSetting } from '../src/core/db.js';
import { tempDb } from './helpers.js';

describe('db', () => {
  it('opens, migrates, and accepts inserts', () => {
    const { db, cleanup } = tempDb();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    const id = db
      .prepare(
        "INSERT INTO memories (content, tags, source, created_at, updated_at) VALUES ('x', '[]', 'ui', 't', 't')",
      )
      .run().lastInsertRowid;
    expect(id).toBe(1);
    cleanup();
  });

  it('settings round-trip and upsert', () => {
    const { db, cleanup } = tempDb();
    expect(getSetting(db, 'nope')).toBeUndefined();
    setSetting(db, 'k', 'v1');
    setSetting(db, 'k', 'v2');
    expect(getSetting(db, 'k')).toBe('v2');
    cleanup();
  });

  it('vec table recreated only on dim change', () => {
    const { db, cleanup } = tempDb();
    ensureVecTable(db, 4);
    db.prepare('INSERT INTO chunks_vec (rowid, embedding) VALUES (1, ?)').run(
      Buffer.from(new Float32Array([1, 0, 0, 0]).buffer),
    );
    ensureVecTable(db, 4); // same dim → keeps data
    expect(db.prepare('SELECT count(*) n FROM chunks_vec').get()).toEqual({ n: 1 });
    ensureVecTable(db, 8); // dim change → rebuilt empty
    expect(db.prepare('SELECT count(*) n FROM chunks_vec').get()).toEqual({ n: 0 });
    cleanup();
  });
});
