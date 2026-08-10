import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  exportMemories,
  importMemoriesJson,
  backupDbFile,
  snapshotOnBoot,
} from '../src/core/backup.js';
import { exportSkills, importSkillsJson } from '../src/core/skills.js';
import { saveMemory, ValidationError } from '../src/core/memories.js';
import { setSetting } from '../src/core/db.js';
import { tempDb, fakeEmbedder } from './helpers.js';
import os from 'node:os';
import type { DB } from '../src/core/db.js';

const embedder = fakeEmbedder();
let db: DB, file: string, cleanup: () => void;

beforeEach(() => ({ db, file, cleanup } = tempDb()));
afterEach(() => cleanup());

describe('backup & export', () => {
  it('memories export → import round-trip, selective by ids', async () => {
    const a = await saveMemory(db, embedder, { content: 'alpha', tags: ['x'], source: 'ui' });
    await saveMemory(db, embedder, { content: 'beta', source: 'mcp:claude' });
    const all = exportMemories(db);
    expect(all.membrain).toBe(1);
    expect(all.memories).toHaveLength(2);
    const sel = exportMemories(db, [a.id]);
    expect(sel.memories).toHaveLength(1);
    expect(sel.memories[0].content).toBe('alpha');

    const { db: db2, cleanup: c2 } = tempDb();
    const restored = await importMemoriesJson(db2, embedder, all);
    expect(restored).toHaveLength(2);
    expect(restored.map((m) => m.source).sort()).toEqual(['mcp:claude', 'ui']);
    c2();
  });

  it('import rejects non-membrain payloads and bad sources fall back', async () => {
    await expect(importMemoriesJson(db, embedder, { nope: true })).rejects.toThrow(ValidationError);
    const r = await importMemoriesJson(db, embedder, {
      membrain: 1,
      memories: [{ content: 'x', source: 'evil; DROP', tags: [] }],
    });
    expect(r[0].source).toBe('import');
  });

  it('db snapshot is a valid sqlite file', async () => {
    await saveMemory(db, embedder, { content: 'persist me', source: 'ui' });
    const dest = await backupDbFile(db, path.dirname(file));
    const header = fs.readFileSync(dest).subarray(0, 15).toString();
    expect(header).toContain('SQLite format 3');
  });

  it('snapshotOnBoot keeps only the newest N', async () => {
    const dataDir = path.dirname(file);
    for (let i = 0; i < 4; i++) {
      const dest = await backupDbFile(db, dataDir);
      // distinct names — backup stamps have second precision
      fs.renameSync(dest, path.join(path.dirname(dest), `membrain-2020-01-0${i + 1}.db`));
    }
    await snapshotOnBoot(db, dataDir, 3);
    const left = fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.endsWith('.db'));
    expect(left.length).toBe(3);
  });

  it('skills export → import round-trip', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'membrain-bk-skills-'));
    setSetting(db, 'skill_roots', JSON.stringify({ claude: dir }));
    importSkillsJson(db, {
      membrain: 1,
      skills: [{ root: 'claude', name: 'demo', content: '---\nname: demo\ndescription: d\n---\nbody' }],
    });
    const ex = exportSkills(db);
    expect(ex.skills).toHaveLength(1);
    expect(ex.skills[0].name).toBe('demo');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
