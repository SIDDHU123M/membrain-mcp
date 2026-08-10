import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type AgentMemoryFile } from './api.js';

export default function AgentImport({ onImported }: { onImported: () => void }) {
  const [files, setFiles] = useState<AgentMemoryFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => setFiles(await api.agentMemory()), []);
  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const g = new Map<string, AgentMemoryFile[]>();
    for (const f of files) {
      const key = `${f.agent} · ${f.project ?? 'global'}`;
      g.set(key, [...(g.get(key) ?? []), f]);
    }
    return [...g.entries()];
  }, [files]);

  const importable = (f: AgentMemoryFile) => f.status !== 'imported';

  const toggle = (path: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const toggleGroup = (fs: AgentMemoryFile[]) =>
    setSelected((s) => {
      const next = new Set(s);
      const candidates = fs.filter(importable);
      const allIn = candidates.every((f) => next.has(f.path));
      for (const f of candidates) {
        if (allIn) next.delete(f.path);
        else next.add(f.path);
      }
      return next;
    });

  const doImport = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.importAgentMemory([...selected]);
      const parts = [];
      if (r.added) parts.push(`${r.added} filed`);
      if (r.updated) parts.push(`${r.updated} updated (file changed since last import)`);
      if (r.skipped) parts.push(`${r.skipped} skipped (already filed)`);
      setNotice(`Done: ${parts.join(', ') || 'nothing to do'}. Originals untouched.`);
      setSelected(new Set());
      await load();
      onImported();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rise">
        <div className="rule-double" aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
          <div className="min-w-0 flex-1">
            <span className="label">Acquisitions</span>
            <p className="display mt-0.5 text-[13.5px] italic text-[var(--text-2)]">
              Memory your agents already keep on this machine — select files to copy into the
              ledger. Originals stay where they are.
            </p>
          </div>
          <button className="btn-primary shrink-0" onClick={doImport} disabled={busy || selected.size === 0}>
            File {selected.size > 0 ? `${selected.size} selected` : 'selected'}
          </button>
        </div>
        <div className="border-b border-[var(--line-strong)]" aria-hidden="true" />
      </section>

      {notice && (
        <div className="card notice px-4 py-2.5 text-[13px]" role="status">
          {notice}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="display text-[15px] italic text-[var(--text-3)]">
            No agent memory found on this machine.
          </p>
        </div>
      ) : (
        groups.map(([label, fs]) => (
          <section key={label} className="card rise overflow-hidden">
            <button
              onClick={() => toggleGroup(fs)}
              className="flex w-full cursor-pointer items-baseline gap-2.5 border-b border-[var(--line-strong)] px-4 py-2.5 text-left transition-colors hover:bg-[var(--inset)]"
            >
              <span className="mono max-w-[55%] truncate text-[11.5px] font-semibold tracking-[0.06em] text-[var(--text-2)]">
                {label.toUpperCase()}
              </span>
              <span className="text-[11px] text-[var(--text-3)]">
                {fs.length} {fs.length === 1 ? 'file' : 'files'} — click to select all importable
              </span>
            </button>
            <div>
              {fs.map((f) => (
                <label
                  key={f.path}
                  className={`entry !cursor-default items-center ${
                    importable(f) ? '!cursor-pointer' : 'opacity-55'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[#1e3a8a]"
                    checked={selected.has(f.path)}
                    disabled={!importable(f)}
                    onChange={() => toggle(f.path)}
                  />
                  <span className="shrink-0 text-[13px]">{f.name}</span>
                  {f.status === 'imported' && (
                    <span
                      className="stamp shrink-0"
                      style={{ color: 'var(--accent)' }}
                      title={f.importedAt ? `filed ${new Date(f.importedAt).toLocaleString()}` : undefined}
                    >
                      ✓ filed
                    </span>
                  )}
                  {f.status === 'changed' && (
                    <span
                      className="stamp shrink-0"
                      style={{ color: 'var(--warn)' }}
                      title="File changed since it was filed — importing updates the existing entry"
                    >
                      changed
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-3)]">
                    {f.description}
                  </span>
                </label>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
