import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

// Numbered migrations, applied in order on boot. Never edit an applied one — append a new entry.
const MIGRATIONS: string[] = [
  // 001 — initial schema
  `
  CREATE TABLE memories (
    id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    text TEXT NOT NULL,
    token_count INTEGER NOT NULL
  );
  CREATE INDEX idx_chunks_memory ON chunks(memory_id);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id');
  CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  `,
  // 002 — LLM-generated display titles (nullable; only insights.ts writes them)
  `ALTER TABLE memories ADD COLUMN title TEXT;`,
];

export function openDb(file: string): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  sqliteVec.load(db);
  const applied = db.pragma('user_version', { simple: true }) as number;
  for (let i = applied; i < MIGRATIONS.length; i++) {
    const apply = db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    });
    apply();
  }
  return db;
}

export function getSetting(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

// Settings exposed to the UI/REST. Internal bookkeeping keys (embedding_model,
// embedding_dim) stay out — they're written by core, not by the user.
export const EDITABLE_SETTINGS = [
  'ollama_url',
  'ollama_model',
  'import_llm',
  'embedding_provider',
  'embedding_api_url',
  'embedding_api_model',
  'embedding_api_key',
  'skill_roots',
  'agent_memory_dirs',
] as const;

export function getEditableSettings(db: DB): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of EDITABLE_SETTINGS) out[key] = getSetting(db, key) ?? null;
  return out;
}

// The vec0 table's dimension depends on the embedding model, so it lives outside
// numbered migrations. A dim change drops all vectors — caller must re-embed.
export function ensureVecTable(db: DB, dim: number): void {
  const cur = getSetting(db, 'embedding_dim');
  if (cur !== undefined && Number(cur) === dim) return;
  db.exec('DROP TABLE IF EXISTS chunks_vec');
  db.exec(`CREATE VIRTUAL TABLE chunks_vec USING vec0(embedding float[${dim}])`);
  setSetting(db, 'embedding_dim', String(dim));
}
