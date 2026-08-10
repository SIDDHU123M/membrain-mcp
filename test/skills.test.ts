import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSkills, getSkill, saveSkill, deleteSkill } from '../src/core/skills.js';
import { setSetting } from '../src/core/db.js';
import { NotFoundError, ValidationError } from '../src/core/memories.js';
import { tempDb } from './helpers.js';
import type { DB } from '../src/core/db.js';

let db: DB, cleanup: () => void, skillDir: string;

const SKILL = `---
name: test-skill
description: does test things
---
# Test skill
body`;

beforeEach(() => {
  ({ db, cleanup } = tempDb());
  skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'membrain-skills-'));
  setSetting(db, 'skill_roots', JSON.stringify({ claude: skillDir }));
});
afterEach(() => {
  cleanup();
  fs.rmSync(skillDir, { recursive: true, force: true });
});

describe('skills', () => {
  it('save → list → get round-trip with frontmatter description', () => {
    saveSkill(db, 'claude', 'test-skill', SKILL);
    const list = listSkills(db);
    expect(list).toEqual([{ root: 'claude', name: 'test-skill', description: 'does test things' }]);
    const s = getSkill(db, 'claude', 'test-skill');
    expect(s.content).toBe(SKILL);
    expect(s.path).toBe(path.join(skillDir, 'test-skill', 'SKILL.md'));
  });

  it('delete removes the folder; missing skill → NotFound', () => {
    saveSkill(db, 'claude', 'gone', SKILL);
    deleteSkill(db, 'claude', 'gone');
    expect(fs.existsSync(path.join(skillDir, 'gone'))).toBe(false);
    expect(() => getSkill(db, 'claude', 'gone')).toThrow(NotFoundError);
    expect(() => deleteSkill(db, 'claude', 'gone')).toThrow(NotFoundError);
  });

  it('rejects path traversal and bad names', () => {
    expect(() => saveSkill(db, 'claude', '../evil', SKILL)).toThrow(ValidationError);
    expect(() => saveSkill(db, 'claude', 'a/b', SKILL)).toThrow(ValidationError);
    expect(() => saveSkill(db, 'claude', '.hidden', SKILL)).toThrow(ValidationError);
    expect(() => getSkill(db, 'nope', 'x')).toThrow(NotFoundError);
  });

  it('non-skill folders and missing roots are ignored in list', () => {
    fs.mkdirSync(path.join(skillDir, 'not-a-skill'));
    setSetting(
      db,
      'skill_roots',
      JSON.stringify({ claude: skillDir, ghost: path.join(skillDir, 'does-not-exist') }),
    );
    expect(listSkills(db)).toEqual([]);
  });
});
