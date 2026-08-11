import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type SkillInfo } from './api.js';
import { Markdown } from './markdown.js';

const TEMPLATE = (name: string) => `---
name: ${name}
description: what this skill is for
---

# ${name}

Instructions the agent follows when this skill is invoked.
`;

export default function Skills() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [open, setOpen] = useState<{ root: string; name: string } | null>(null);
  const [content, setContent] = useState('');
  const [path, setPath] = useState('');
  const [newName, setNewName] = useState('');
  const [newRoot, setNewRoot] = useState<string>('claude');
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'preview' | 'code'>('preview');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setSkills(await api.skills()), []);
  useEffect(() => {
    void load();
  }, [load]);

  const roots = useMemo(() => [...new Set(skills.map((s) => s.root))], [skills]);
  const visible = useMemo(
    () =>
      filter
        ? skills.filter(
            (s) =>
              s.name.toLowerCase().includes(filter.toLowerCase()) ||
              s.description.toLowerCase().includes(filter.toLowerCase()),
          )
        : skills,
    [skills, filter],
  );

  const openSkill = async (root: string, name: string) => {
    const s = await api.skill(root, name);
    setOpen({ root, name });
    setContent(s.content);
    setPath(s.path);
    setNotice(null);
  };

  const save = async () => {
    if (!open) return;
    setBusy(true);
    try {
      await api.saveSkill(open.root, open.name, content);
      setNotice('Saved');
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!open) return;
    setBusy(true);
    try {
      await api.deleteSkill(open.root, open.name);
      setOpen(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const root = roots.includes(newRoot) ? newRoot : (roots[0] ?? 'claude');
      await api.saveSkill(root, name, TEMPLATE(name));
      setNewName('');
      await load();
      await openSkill(root, name);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 md:h-[calc(100vh-7.5rem)]">
      <section className="rise shrink-0">
        <div className="rule-double" aria-hidden="true" />
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5">
          <span className="label">Instruction manual</span>
          <p className="display text-[13.5px] italic text-[var(--text-2)]">
            The skills your agents follow — every SKILL.md on this machine, editable.
          </p>
        </div>
        <div className="border-b border-[var(--line-strong)]" aria-hidden="true" />
      </section>

      {/* grid rows default to auto (content-sized) — a long SKILL.md would grow the
          row past the pinned viewport instead of scrolling inside the card */}
      <div className="grid gap-5 md:min-h-0 md:flex-1 md:grid-cols-[290px_1fr] md:grid-rows-[minmax(0,1fr)]">
        <div className="flex flex-col gap-2.5 md:min-h-0">
          <input
            className="input"
            placeholder="Filter skills…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter skills"
          />
          <div className="flex gap-1.5">
            <input
              className="input"
              placeholder="new-skill-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              aria-label="New skill name"
            />
            {roots.length > 1 && (
              <select
                className="input w-auto"
                value={newRoot}
                onChange={(e) => setNewRoot(e.target.value)}
                aria-label="Skill root"
              >
                {roots.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
            <button className="btn-primary shrink-0" onClick={create} disabled={busy || !newName.trim()}>
              New
            </button>
          </div>

          <div className="card max-h-[60vh] overflow-y-auto md:max-h-none md:min-h-0 md:flex-1">
            {visible.length === 0 && (
              <div className="p-4 text-[13px] text-[var(--text-3)]">
                {skills.length === 0 ? 'No skills found in configured roots.' : 'No skills match the filter.'}
              </div>
            )}
            {visible.map((s) => (
              <button
                key={`${s.root}/${s.name}`}
                onClick={() => void openSkill(s.root, s.name)}
                className="entry"
                aria-current={open?.name === s.name && open?.root === s.root ? 'true' : undefined}
                style={
                  open?.name === s.name && open?.root === s.root
                    ? { background: 'var(--accent-soft)' }
                    : undefined
                }
              >
                <span className="min-w-0 flex-1">
                  <span className="display block truncate text-[13.5px] font-semibold">{s.name}</span>
                  {s.description && (
                    <span className="mt-0.5 block truncate text-[11.5px] leading-4 text-[var(--text-3)]">
                      {s.description}
                    </span>
                  )}
                </span>
                <span className="stamp shrink-0" style={{ color: 'var(--text-3)' }}>
                  {s.root}
                </span>
              </button>
            ))}
          </div>
        </div>

        {open ? (
          <div className="card flex min-h-[68vh] flex-col md:min-h-0 md:h-full">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--line)] px-4 py-3">
              <h2 className="display text-[16px] font-semibold">{open.name}</h2>
              <span className="mono truncate text-[10.5px] text-[var(--text-3)]" title={path}>
                {path}
              </span>
              {notice && <span className="text-[12px] notice">{notice}</span>}
              <div className="seg ml-auto !border-b-0" role="group" aria-label="Editor mode">
                {(['preview', 'code'] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={mode === m ? 'seg-on' : ''}>
                    {m}
                  </button>
                ))}
              </div>
              <button
                className="btn shrink-0"
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
                  a.download = `${open.name}-SKILL.md`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                Download
              </button>
              <button className="btn-primary shrink-0" onClick={save} disabled={busy}>
                Save
              </button>
              <button className="btn-danger shrink-0" onClick={del} disabled={busy}>
                Delete
              </button>
            </div>
            {mode === 'code' ? (
              <textarea
                className="input mono min-h-0 flex-1 resize-none rounded-none border-none text-[12.5px] leading-[1.7]"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                aria-label="SKILL.md source"
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                <Markdown text={content} />
              </div>
            )}
          </div>
        ) : (
          <div className="card flex min-h-[68vh] items-center justify-center p-10 md:min-h-0 md:h-full">
            <p className="display text-[14px] italic text-[var(--text-3)]">
              Select a skill from the index to read or edit its SKILL.md
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
