import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type DB, getSetting } from './db.js';
import { NotFoundError, ValidationError } from './memories.js';

export interface SkillInfo {
  root: string;
  name: string;
  description: string;
}

export interface Skill extends SkillInfo {
  content: string;
  path: string;
}

/**
 * Skill roots are named directories holding agent skills in the standard
 * <root>/<skill-name>/SKILL.md layout. Default: the user's global Claude
 * skills. Override with settings key skill_roots = {"name": "/abs/path"}.
 */
export function skillRoots(db: DB): Record<string, string> {
  const raw = getSetting(db, 'skill_roots');
  if (raw) return JSON.parse(raw) as Record<string, string>;
  return {
    claude: path.join(os.homedir(), '.claude', 'skills'),
    agents: path.join(os.homedir(), '.agents', 'skills'),
  };
}

// Trust boundary: name becomes a filesystem path. Strict allowlist keeps every
// operation confined to the configured roots — no dots, slashes, or drive letters.
function validName(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) {
    throw new ValidationError('skill name must be alphanumeric with - or _, max 64 chars');
  }
  return name;
}

function rootDir(db: DB, root: string): string {
  const dir = skillRoots(db)[root];
  if (!dir) throw new NotFoundError(`unknown skill root "${root}"`);
  return dir;
}

function frontmatterDescription(content: string): string {
  const m = content.match(/^---\r?\n[\s\S]*?^description:\s*(.+?)\r?\n[\s\S]*?^---/m);
  return m ? m[1].trim() : '';
}

export function listSkills(db: DB): SkillInfo[] {
  const out: SkillInfo[] = [];
  for (const [root, dir] of Object.entries(skillRoots(db))) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // root not created yet — empty, not an error
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const file = path.join(dir, e.name, 'SKILL.md');
      try {
        const content = fs.readFileSync(file, 'utf8');
        out.push({ root, name: e.name, description: frontmatterDescription(content) });
      } catch {
        continue; // folder without SKILL.md is not a skill
      }
    }
  }
  return out.sort((a, b) => a.root.localeCompare(b.root) || a.name.localeCompare(b.name));
}

export function getSkill(db: DB, root: string, name: string): Skill {
  const file = path.join(rootDir(db, root), validName(name), 'SKILL.md');
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    throw new NotFoundError(`skill ${root}/${name} not found`);
  }
  return { root, name, description: frontmatterDescription(content), content, path: file };
}

export function saveSkill(db: DB, root: string, name: string, content: string): Skill {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new ValidationError('content must be a non-empty string');
  }
  const dir = path.join(rootDir(db, root), validName(name));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
  return getSkill(db, root, name);
}

export interface SkillExport {
  membrain: 1;
  exportedAt: string;
  skills: { root: string; name: string; content: string }[];
}

export function exportSkills(db: DB): SkillExport {
  return {
    membrain: 1,
    exportedAt: new Date().toISOString(),
    skills: listSkills(db).map((s) => {
      const { root, name, content } = getSkill(db, s.root, s.name);
      return { root, name, content };
    }),
  };
}

/** Restore skills from an export. Unknown roots fall back to the first configured root. */
export function importSkillsJson(db: DB, payload: unknown): number {
  const p = payload as Partial<SkillExport>;
  if (p?.membrain !== 1 || !Array.isArray(p.skills)) {
    throw new ValidationError('not a membrain skill export (expected {membrain:1, skills:[...]})');
  }
  const roots = Object.keys(skillRoots(db));
  let n = 0;
  for (const s of p.skills) {
    if (typeof s?.name !== 'string' || typeof s?.content !== 'string') continue;
    const root = typeof s.root === 'string' && roots.includes(s.root) ? s.root : roots[0];
    saveSkill(db, root, s.name, s.content);
    n++;
  }
  return n;
}

export function deleteSkill(db: DB, root: string, name: string): void {
  const dir = path.join(rootDir(db, root), validName(name));
  // only ever delete folders that actually are skills
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) {
    throw new NotFoundError(`skill ${root}/${name} not found`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
