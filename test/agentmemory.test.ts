import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverAgentMemory, importAgentMemory } from '../src/core/agentmemory.js';
import { setSetting } from '../src/core/db.js';
import { NotFoundError } from '../src/core/memories.js';
import { tempDb, fakeEmbedder } from './helpers.js';
import type { DB } from '../src/core/db.js';

const embedder = fakeEmbedder();
let db: DB, cleanup: () => void, memDir: string;

const FILE = `---
name: user-likes-mango
description: favorite fruit
metadata:
  type: user
---
The user's favorite fruit is mango.`;

beforeEach(() => {
  ({ db, cleanup } = tempDb());
  memDir = fs.mkdtempSync(path.join(os.tmpdir(), 'membrain-agentmem-'));
  fs.writeFileSync(path.join(memDir, 'user-likes-mango.md'), FILE);
  fs.writeFileSync(path.join(memDir, 'MEMORY.md'), '- index file, must be skipped');
  setSetting(db, 'agent_memory_dirs', JSON.stringify([memDir]));
});
afterEach(() => {
  cleanup();
  fs.rmSync(memDir, { recursive: true, force: true });
});

// discovery also scans the real ~/.claude/projects on this machine — assertions
// only look at files under the temp dir (agent 'custom')
const mine = <T extends { path: string }>(files: T[]) =>
  files.filter((f) => f.path.startsWith(memDir));

describe('agent memory', () => {
  it('discovers md files with frontmatter, skips MEMORY.md index', () => {
    const files = mine(discoverAgentMemory(db));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      agent: 'custom',
      name: 'user-likes-mango',
      description: 'favorite fruit',
      status: 'new',
      importedAt: null,
    });
  });

  it('imports a discovered file as a memory, body only, typed tags', async () => {
    const [file] = mine(discoverAgentMemory(db));
    const r = await importAgentMemory(db, embedder, [file.path]);
    expect(r.added).toBe(1);
    const [m] = r.memories;
    expect(m.content).toBe("The user's favorite fruit is mango.");
    expect(m.source).toBe('import');
    expect(m.tags).toEqual(['agent-import', 'custom']);
    // original untouched
    expect(fs.existsSync(file.path)).toBe(true);
  });

  it('re-import of unchanged file is skipped, changed file updates in place', async () => {
    const [file] = mine(discoverAgentMemory(db));
    const first = await importAgentMemory(db, embedder, [file.path]);
    expect(mine(discoverAgentMemory(db))[0].status).toBe('imported');

    // unchanged → skipped, no duplicate
    const again = await importAgentMemory(db, embedder, [file.path]);
    expect(again).toMatchObject({ added: 0, updated: 0, skipped: 1 });

    // change the source file → status changed → import updates the SAME memory
    fs.writeFileSync(file.path, FILE.replaceAll('mango', 'papaya'));
    expect(mine(discoverAgentMemory(db))[0].status).toBe('changed');
    const upd = await importAgentMemory(db, embedder, [file.path]);
    expect(upd).toMatchObject({ added: 0, updated: 1, skipped: 0 });
    expect(upd.memories[0].id).toBe(first.memories[0].id);
    expect(upd.memories[0].content).toContain('papaya');
    expect(mine(discoverAgentMemory(db))[0].status).toBe('imported');
  });

  it('rejects paths outside discovered memory dirs', async () => {
    const outside = path.join(os.tmpdir(), 'membrain-evil.md');
    fs.writeFileSync(outside, 'secret');
    await expect(importAgentMemory(db, embedder, [outside])).rejects.toThrow(NotFoundError);
    fs.rmSync(outside);
  });
});
