import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type MapCategory, type Memory, type MemoryMap, type Proposal } from './api.js';
import { relativeTime, sourceColor, sourceLabel } from './util.js';

const parseTags = (s: string) =>
  s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

function Stamp({ source }: { source: string }) {
  const color = sourceColor(source);
  return (
    <span className="stamp" style={{ color }}>
      {sourceLabel(source)}
    </span>
  );
}

function heading(m: Memory): string {
  return m.title ?? m.content.split(/\s+/).slice(0, 7).join(' ');
}

/* ————— the drawer: one entry pulled from the file to read and manage ————— */
function Drawer({
  memory,
  onClose,
  onChanged,
  onOpen,
  onProposed,
}: {
  memory: Memory;
  onClose: () => void;
  onChanged: () => void;
  onOpen: (m: Memory) => void;
  onProposed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(memory.content);
  const [tags, setTags] = useState(memory.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [related, setRelated] = useState<Memory[] | null>(null);
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [toolNote, setToolNote] = useState<string | null>(null);

  // drawer switches entries in place — reset per-entry state
  useEffect(() => {
    setEditing(false);
    setContent(memory.content);
    setTags(memory.tags.join(', '));
    setRelated(null);
    setToolNote(null);
    setError(null);
  }, [memory]);

  const draftTitle = async () => {
    setToolBusy('title');
    setToolNote(null);
    try {
      const r = await api.proposeTitleFor(memory.id);
      setToolNote(
        r.proposed > 0
          ? 'Title drafted — review it in the clerk’s proposal queue.'
          : 'Nothing proposed (a proposal for this entry may already be pending).',
      );
      onProposed();
    } catch (e) {
      setToolNote((e as Error).message);
    } finally {
      setToolBusy(null);
    }
  };

  const findRelated = async () => {
    setToolBusy('related');
    setToolNote(null);
    try {
      const r = await api.memories({ query: memory.content.slice(0, 160) });
      setRelated(r.filter((m) => m.id !== memory.id).slice(0, 5));
    } catch (e) {
      setToolNote((e as Error).message);
    } finally {
      setToolBusy(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateMemory(memory.id, { content, tags: parseTags(tags) });
      setEditing(false);
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    setBusy(true);
    try {
      await api.deleteMemory(memory.id);
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Entry ${memory.id}`}>
        <header className="flex items-center gap-3 border-b border-[var(--line)] px-6 py-4">
          <span className="mono text-[11px] tracking-[0.12em] text-[var(--text-3)]">
            ENTRY&nbsp;#{String(memory.id).padStart(3, '0')}
          </span>
          <Stamp source={memory.source} />
          <button
            className="ml-auto cursor-pointer text-[18px] leading-none text-[var(--text-3)] hover:text-[var(--text)]"
            onClick={onClose}
            aria-label="Close entry"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {memory.title && (
            <h2 className="display mb-3 text-[21px] font-semibold leading-snug">{memory.title}</h2>
          )}

          {editing ? (
            <div className="space-y-3">
              <textarea
                className="input mono min-h-[38vh] text-[13px] leading-relaxed"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                autoFocus
                aria-label="Entry content"
              />
              <div>
                <label className="label mb-1.5">Tags</label>
                <input
                  className="input"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="comma, separated"
                />
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-[15px] leading-[1.75]">{memory.content}</p>
          )}

          <dl className="mt-6 space-y-1.5 border-t border-[var(--line)] pt-4 text-[12.5px] text-[var(--text-2)]">
            <div className="leader">
              <dt>Recorded by</dt>
              <span className="leader-dots" aria-hidden="true" />
              <dd style={{ color: sourceColor(memory.source) }}>{sourceLabel(memory.source)}</dd>
            </div>
            <div className="leader">
              <dt>Created</dt>
              <span className="leader-dots" aria-hidden="true" />
              <dd>{new Date(memory.created_at).toLocaleString()}</dd>
            </div>
            <div className="leader">
              <dt>Updated</dt>
              <span className="leader-dots" aria-hidden="true" />
              <dd>{new Date(memory.updated_at).toLocaleString()}</dd>
            </div>
            {!editing && memory.tags.length > 0 && (
              <div className="leader">
                <dt>Tags</dt>
                <span className="leader-dots" aria-hidden="true" />
                <dd className="flex flex-wrap justify-end gap-1">
                  {memory.tags.map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>

          {/* the clerk's tools for this one entry */}
          <div className="mt-6 border-t border-[var(--line)] pt-4">
            <span className="label">Clerk's tools</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                className="btn"
                onClick={() => void draftTitle()}
                disabled={toolBusy !== null}
                title="Draft a title for this entry — staged for your review, never applied directly"
              >
                {toolBusy === 'title' ? 'Drafting…' : memory.title ? 'Redraft title' : 'Draft title'}
              </button>
              <button className="btn" onClick={() => void findRelated()} disabled={toolBusy !== null}>
                {toolBusy === 'related' ? 'Searching…' : 'Find related'}
              </button>
            </div>
            {toolNote && <p className="notice mt-2 text-[12px]">{toolNote}</p>}
            {related && (
              <div className="mt-3 space-y-1.5">
                {related.length === 0 && (
                  <p className="text-[12px] text-[var(--text-3)]">No related entries found.</p>
                )}
                {related.map((r) => (
                  <button
                    key={r.id}
                    className="block w-full cursor-pointer border border-[var(--line)] bg-[var(--inset)] p-2.5 text-left transition-colors hover:border-[var(--line-strong)]"
                    onClick={() => onOpen(r)}
                    aria-label={`Open related entry ${r.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="mono text-[10px] text-[var(--text-3)]">
                        #{String(r.id).padStart(3, '0')}
                      </span>
                      {r.score !== undefined && (
                        <span className="mono text-[10px] text-[var(--text-3)]">
                          {r.score.toFixed(3)}
                        </span>
                      )}
                      <Stamp source={r.source} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--text-2)]">
                      {r.title ?? r.content}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <p className="mt-3 text-[12.5px] text-[var(--danger)]">{error}</p>}
        </div>

        <footer className="flex gap-2 border-t border-[var(--line)] px-6 py-4">
          {editing ? (
            <>
              <button className="btn-primary" onClick={save} disabled={busy}>
                Save changes
              </button>
              <button
                className="btn"
                onClick={() => {
                  setEditing(false);
                  setContent(memory.content);
                  setTags(memory.tags.join(', '));
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn-primary"
              onClick={() => {
                setContent(memory.content);
                setTags(memory.tags.join(', '));
                setEditing(true);
              }}
            >
              Edit entry
            </button>
          )}
          <button className="btn-danger ml-auto" onClick={del} disabled={busy}>
            Delete
          </button>
        </footer>
      </aside>
    </>
  );
}

function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="basis-full" role="status" aria-label={label}>
      <div className="flex items-baseline gap-2 text-[12px] text-[var(--text-2)]">
        <span className="display italic">{label}</span>
        <span className="mono ml-auto text-[11px]">
          {done}/{total} · {pct}%
        </span>
      </div>
      <div className="mt-1 h-[3px] w-full bg-[var(--line)]">
        <div
          className="h-full bg-[var(--accent)] transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

type AiOp = 'map' | 'titles' | 'summary' | 'import' | null;

interface ReviewFact {
  text: string;
  tags: string[];
  checked: boolean;
}

export default function Memories({ onStatsDirty }: { onStatsDirty: () => void }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [writer, setWriter] = useState<string | null>(null);
  const [view, setView] = useState<'ledger' | 'cards' | 'topics'>('ledger');
  const [map, setMap] = useState<MemoryMap | null>(null);
  const [category, setCategory] = useState<MapCategory | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drawer, setDrawer] = useState<Memory | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [aiOp, setAiOp] = useState<AiOp>(null);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(
    null,
  );
  const [dupes, setDupes] = useState<{ a: Memory; b: Memory; similarity: number }[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [review, setReview] = useState<{ header: string; facts: ReviewFact[] } | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [showProposals, setShowProposals] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  const load = useCallback(async () => {
    setMemories(await api.memories({ query: query || undefined, tag: tag ?? undefined }));
    onStatsDirty();
  }, [query, tag, onStatsDirty]);

  useEffect(() => {
    const t = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  const loadProposals = useCallback(async () => {
    try {
      setProposals(await api.proposals());
    } catch {}
  }, []);
  useEffect(() => {
    void loadProposals();
    void api
      .map()
      .then((r) => setMap(r.map))
      .catch(() => {});
  }, [loadProposals]);

  const allTags = useMemo(
    () => [...new Set(memories.flatMap((m) => m.tags))].sort().slice(0, 18),
    [memories],
  );
  const writers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of memories) counts.set(m.source, (counts.get(m.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [memories]);
  const byId = useMemo(() => new Map(memories.map((m) => [m.id, m])), [memories]);
  const untitled = useMemo(() => memories.filter((m) => !m.title).length, [memories]);

  const visible = useMemo(() => {
    let v = memories;
    if (writer) v = v.filter((m) => m.source === writer);
    if (category) {
      const ids = new Set(category.ids);
      v = v.filter((m) => ids.has(m.id));
    }
    return v;
  }, [memories, writer, category]);

  const scope = useMemo((): { ids?: number[]; label: string } => {
    if (selected.size > 0) return { ids: [...selected], label: `${selected.size} selected` };
    if (category) return { ids: category.ids, label: category.name };
    if (writer || tag || query) return { ids: visible.map((m) => m.id), label: 'filtered' };
    return { label: 'all' };
  }, [selected, category, writer, tag, query, visible]);

  const add = async () => {
    setBusy(true);
    try {
      await api.addMemory(newContent, parseTags(newTags));
      setNewContent('');
      setNewTags('');
      setAdding(false);
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setNotice(null);
    setAiOp('import');
    try {
      for (const f of Array.from(files)) {
        if (f.name.endsWith('.json')) {
          setAiStatus(`Restoring ${f.name}…`);
          const r = await api.importMemoriesJson(JSON.parse(await f.text()));
          setNotice(`${f.name} → restored ${r.imported} memories`);
          await load();
          continue;
        }
        setAiStatus(`Reading ${f.name}, extracting key points with the local LLM…`);
        const p = await api.previewImport(f);
        const header = p.usedLlm
          ? `${p.facts.length} candidate entries from ${p.filename} (${p.model}). Review, edit, untick — then file them.`
          : `${p.filename} — Ollama unreachable, raw text below. Review and file.`;
        setReview((prev) => ({
          header: prev ? `${prev.header}  +  ${header}` : header,
          facts: [
            ...(prev?.facts ?? []),
            ...p.facts.map((text) => ({ text, tags: p.tags, checked: true })),
          ],
        }));
      }
      setAiStatus(null);
    } catch (e) {
      setAiStatus(null);
      setNotice(`Import failed: ${(e as Error).message}`);
    } finally {
      setAiOp(null);
    }
  };

  const commitReview = async () => {
    if (!review) return;
    const picked = review.facts.filter((f) => f.checked && f.text.trim());
    setBusy(true);
    try {
      const r = await api.commitImport(picked.map((f) => ({ content: f.text, tags: f.tags })));
      setNotice(`Filed ${r.imported} new entries.`);
      setReview(null);
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* live SSE ops — the clerk reports as it works */
  const runMap = () => {
    setAiOp('map');
    setNotice(null);
    setAiStatus('Filing memories into topics…');
    const es = new EventSource('/api/insights/map/stream');
    esRef.current = es;
    es.addEventListener('progress', (e) => {
      const p = JSON.parse((e as MessageEvent).data) as {
        done: number;
        total: number;
        map: MemoryMap;
      };
      setProgress({ done: p.done, total: p.total, label: 'Organizing the ledger' });
      setMap(p.map);
    });
    es.addEventListener('done', (e) => {
      const m = JSON.parse((e as MessageEvent).data) as MemoryMap;
      setMap(m);
      setProgress(null);
      setAiStatus(
        `Filed ${m.categories.reduce((n, c) => n + c.ids.length, 0)} memories under ${m.categories.length} topics.`,
      );
      setAiOp(null);
      setView('topics');
      es.close();
    });
    es.addEventListener('error', (e) => {
      const data = (e as MessageEvent).data;
      if (data) setNotice((JSON.parse(data) as { error: string }).error);
      setProgress(null);
      setAiStatus(null);
      setAiOp(null);
      es.close();
    });
  };

  const runTitles = () => {
    setAiOp('titles');
    setNotice(null);
    setAiStatus('Drafting titles…');
    const es = new EventSource('/api/insights/titles/stream');
    esRef.current = es;
    es.addEventListener('progress', (e) => {
      const p = JSON.parse((e as MessageEvent).data) as {
        done: number;
        total: number;
        proposed: number;
      };
      setProgress({ done: p.done, total: p.total, label: `Drafting titles (${p.proposed} proposed)` });
      void loadProposals();
    });
    es.addEventListener('done', (e) => {
      const r = JSON.parse((e as MessageEvent).data) as { proposed: number };
      setProgress(null);
      setAiStatus(`Proposed ${r.proposed} titles — review before they're inked in.`);
      setAiOp(null);
      setShowProposals(true);
      void loadProposals();
      es.close();
    });
    es.addEventListener('error', (e) => {
      const data = (e as MessageEvent).data;
      if (data) setNotice((JSON.parse(data) as { error: string }).error);
      setProgress(null);
      setAiStatus(null);
      setAiOp(null);
      es.close();
    });
  };

  const runSummary = async (ids?: number[], label?: string) => {
    setAiOp('summary');
    setAiStatus(`Summarizing ${label ?? scope.label}…`);
    setSummary(null);
    setNotice(null);
    try {
      const r = await api.summarize(ids ?? scope.ids);
      setSummary(r.summary);
      setAiStatus(null);
    } catch (e) {
      setAiStatus(null);
      setNotice((e as Error).message);
    } finally {
      setAiOp(null);
    }
  };

  const findDupes = async () => {
    setNotice(null);
    try {
      const r = await api.duplicates();
      setDupes(r.pairs);
      if (r.pairs.length === 0) setNotice('No likely duplicates found (≥0.9 similarity).');
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const deleteDupe = async (id: number) => {
    setBusy(true);
    try {
      await api.deleteMemory(id);
      setDupes((d) => d?.filter((p) => p.a.id !== id && p.b.id !== id) ?? null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (ids: string[], accept: boolean) => {
    try {
      const r = await api.resolveProposals(ids, accept);
      setNotice(accept ? `Inked ${r.applied} of ${r.resolved} proposals.` : `Rejected ${r.resolved}.`);
      await loadProposals();
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const exportScope = () => {
    const qs = scope.ids?.length ? `?ids=${scope.ids.join(',')}` : '';
    window.open(`/api/export/memories${qs}`, '_blank');
  };

  return (
    <div
      className="space-y-5"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void importFiles(e.dataTransfer.files);
      }}
    >
      {/* the recall line */}
      <div className="rise relative">
        <svg
          className="pointer-events-none absolute left-1 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--text-3)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          id="recall-input"
          className="input recall pr-44"
          placeholder="Recall anything…"
          aria-label="Search memories"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (view === 'topics') setView('ledger');
          }}
        />
        <div className="absolute right-0 top-1/2 flex -translate-y-1/2 gap-1.5">
          <button className="btn-primary" onClick={() => setAdding((v) => !v)}>
            + Record
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
            Import
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.md,.txt,.json"
          multiple
          hidden
          onChange={(e) => void importFiles(e.target.files)}
        />
      </div>

      {/* the clerk — every AI operation, with live reporting */}
      <section className="rise" aria-label="The clerk — organize with AI">
        <div className="rule-double" aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 py-2.5">
          <div className="min-w-0 flex-1">
            <span className="label">The clerk</span>
            <p className="display mt-0.5 text-[13.5px] italic text-[var(--text-2)]" role="status">
              {aiOp
                ? aiStatus
                : (aiStatus ??
                  (map
                    ? `${map.categories.length} topics on file${map.stale ? ' — entries changed since, reorganize' : ''} · ${untitled} untitled`
                    : `${memories.length} entries · ${untitled} untitled · not yet organized`))}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button className="btn-primary" onClick={runMap} disabled={aiOp !== null}>
              {map ? 'Reorganize' : 'Organize'}
            </button>
            <button
              className="btn"
              onClick={runTitles}
              disabled={aiOp !== null || untitled === 0}
              title="Draft a short title for every untitled entry — you review before anything is written"
            >
              Titles
            </button>
            <button className="btn" onClick={() => void runSummary()} disabled={aiOp !== null}>
              Summarize {scope.label}
            </button>
            <button className="btn" onClick={() => void findDupes()} title="Vector similarity — instant, no LLM">
              Duplicates
            </button>
            <button className="btn" onClick={exportScope}>
              Export {scope.label}
            </button>
            {proposals.length > 0 && (
              <button
                className="btn"
                style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
                onClick={() => setShowProposals((v) => !v)}
              >
                {showProposals ? 'Hide' : 'Review'} {proposals.length} proposals
              </button>
            )}
          </div>
          {progress && <ProgressBar {...progress} />}
          {summary && (
            <div className="basis-full">
              <div className="card flex items-start gap-3 px-4 py-3">
                <p className="flex-1 whitespace-pre-wrap text-[13.5px] leading-6 text-[var(--text-2)]">
                  {summary}
                </p>
                <button
                  className="cursor-pointer text-[var(--text-3)] hover:text-[var(--text)]"
                  onClick={() => setSummary(null)}
                  aria-label="Dismiss summary"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="border-b border-[var(--line-strong)]" aria-hidden="true" />
      </section>

      {/* proposals awaiting ink */}
      {showProposals && proposals.length > 0 && (
        <section className="card rise p-4" aria-label="AI proposals awaiting review">
          <div className="mb-2.5 flex items-center gap-2">
            <p className="flex-1 text-[12.5px] text-[var(--text-2)]">
              The clerk wants to change these entries — nothing is inked until you accept.
            </p>
            <button className="btn-primary" onClick={() => void resolve(proposals.map((p) => p.id), true)}>
              Accept all
            </button>
            <button className="btn-danger" onClick={() => void resolve(proposals.map((p) => p.id), false)}>
              Reject all
            </button>
          </div>
          <div className="rowlist max-h-[36vh] overflow-y-auto">
            {proposals.map((p) => {
              const m = byId.get(p.memoryId);
              return (
                <div key={p.id} className="flex items-center gap-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px]">
                      {p.old && <span className="text-[var(--text-3)] line-through">{p.old} </span>}
                      <span className="display font-semibold">{p.next}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-[var(--text-3)]">
                      #{String(p.memoryId).padStart(3, '0')} · {m?.content ?? '(entry not in current view)'}
                    </p>
                  </div>
                  <button className="btn shrink-0 px-2" onClick={() => void resolve([p.id], true)} aria-label={`Accept: ${p.next}`}>
                    ✓
                  </button>
                  <button className="btn-danger shrink-0 px-2" onClick={() => void resolve([p.id], false)} aria-label={`Reject: ${p.next}`}>
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* duplicate candidates */}
      {dupes && dupes.length > 0 && (
        <section className="card rise p-4" aria-label="Duplicate candidates">
          <div className="mb-2 flex items-center gap-2">
            <p className="flex-1 text-[12.5px] text-[var(--text-2)]">
              {dupes.length} likely duplicate {dupes.length === 1 ? 'pair' : 'pairs'} — pick which
              copy to strike, or keep both.
            </p>
            <button className="btn" onClick={() => setDupes(null)}>
              Close
            </button>
          </div>
          <div className="rowlist max-h-[40vh] overflow-y-auto">
            {dupes.map((p) => (
              <div key={`${p.a.id}-${p.b.id}`} className="py-2.5">
                <div className="mono mb-1.5 text-[10.5px] text-[var(--text-3)]">
                  {Math.round(p.similarity * 100)}% similar
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[p.a, p.b].map((m) => (
                    <div key={m.id} className="border border-[var(--line)] bg-[var(--inset)] p-2.5">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="mono text-[10.5px] text-[var(--text-3)]">
                          #{String(m.id).padStart(3, '0')}
                        </span>
                        <Stamp source={m.source} />
                        <button
                          className="btn-danger ml-auto px-2 py-0.5 text-[10px]"
                          onClick={() => void deleteDupe(m.id)}
                          disabled={busy}
                        >
                          Strike
                        </button>
                      </div>
                      <p className="line-clamp-3 text-[12px] leading-5 text-[var(--text-2)]">
                        {m.content}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* filters + views */}
      <div className="rise flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="seg" role="group" aria-label="View">
          {(['ledger', 'cards', 'topics'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={view === v ? 'seg-on' : ''}>
              {v}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {view !== 'topics' &&
            writers.length > 1 &&
            writers.map(([src, n]) => {
              const color = sourceColor(src);
              const active = writer === src;
              return (
                <button
                  key={src}
                  onClick={() => setWriter(active ? null : src)}
                  className={`chip chip-btn ${active ? 'chip-active' : ''}`}
                  style={active ? { borderColor: color, color } : undefined}
                  aria-pressed={active}
                >
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
                  {sourceLabel(src)} · {n}
                </button>
              );
            })}
          {view !== 'topics' &&
            allTags.map((t) => (
              <button key={t} onClick={() => setTag(tag === t ? null : t)} className={`chip chip-btn ${tag === t ? 'chip-active' : ''}`} aria-pressed={tag === t}>
                {t}
              </button>
            ))}
          {category && (
            <button className="chip chip-btn chip-active" onClick={() => setCategory(null)} aria-label={`Clear topic filter ${category.name}`}>
              {category.name} ✕
            </button>
          )}
          {selected.size > 0 && (
            <button className="btn" onClick={() => setSelected(new Set())}>
              Clear {selected.size} selected
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="card notice flex items-start gap-3 px-4 py-2.5 text-[13px]" role="status">
          <span className="flex-1">{notice}</span>
          <button className="cursor-pointer text-[var(--text-3)] hover:text-[var(--text)]" onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {busy && (
        <div className="card px-4 py-2.5 text-[13px] text-[var(--text-3)]" role="status">
          Working…
        </div>
      )}

      {/* import review — candidates before they're filed */}
      {review && (
        <section className="card rise space-y-3 p-4" aria-label="Review extracted entries">
          <div className="flex items-start gap-3">
            <p className="flex-1 text-[13px] leading-5 text-[var(--text-2)]">{review.header}</p>
            <button className="cursor-pointer text-[var(--text-3)] hover:text-[var(--text)]" onClick={() => setReview(null)} aria-label="Discard extraction">
              ✕
            </button>
          </div>
          <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
            {review.facts.map((f, i) => (
              <div
                key={i}
                className={`flex items-start gap-2.5 border p-2.5 transition-opacity ${
                  f.checked ? 'border-[var(--line)] bg-[var(--inset)]' : 'border-transparent opacity-45'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[#1e3a8a]"
                  checked={f.checked}
                  onChange={() =>
                    setReview((r) =>
                      r ? { ...r, facts: r.facts.map((x, j) => (j === i ? { ...x, checked: !x.checked } : x)) } : r,
                    )
                  }
                  aria-label={`Include candidate ${i + 1}`}
                />
                <textarea
                  className="input min-h-9 flex-1 resize-y border-none bg-transparent p-0 text-[13px] leading-relaxed"
                  value={f.text}
                  rows={Math.min(4, Math.max(1, Math.ceil(f.text.length / 90)))}
                  onChange={(e) =>
                    setReview((r) =>
                      r ? { ...r, facts: r.facts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) } : r,
                    )
                  }
                  aria-label={`Candidate entry ${i + 1}`}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={commitReview} disabled={busy || review.facts.every((f) => !f.checked)}>
              File {review.facts.filter((f) => f.checked && f.text.trim()).length} entries
            </button>
            <button
              className="btn"
              onClick={() =>
                setReview((r) =>
                  r ? { ...r, facts: r.facts.map((f) => ({ ...f, checked: !r.facts.every((x) => x.checked) })) } : r,
                )
              }
            >
              {review.facts.every((f) => f.checked) ? 'Select none' : 'Select all'}
            </button>
            <button className="btn" onClick={() => setReview(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {adding && (
        <section className="card rise space-y-2.5 p-4">
          <textarea
            className="input min-h-28 text-[15px]"
            placeholder="What should be remembered?"
            aria-label="New entry content"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            autoFocus
          />
          <input className="input" placeholder="tags, comma separated" aria-label="Tags for new entry" value={newTags} onChange={(e) => setNewTags(e.target.value)} />
          <button className="btn-primary" onClick={add} disabled={busy || !newContent.trim()}>
            Record entry
          </button>
        </section>
      )}

      {/* the pages */}
      {view === 'topics' ? (
        map ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {map.categories.map((c, i) => (
              <div key={c.name} className="card rise p-4" style={{ animationDelay: `${i * 30}ms` }}>
                <div className="flex items-baseline gap-2">
                  <h3 className="display text-[16px] font-semibold">{c.name}</h3>
                  <span className="mono ml-auto shrink-0 text-[11px] text-[var(--text-3)]">{c.ids.length}</span>
                </div>
                {c.description && <p className="mt-1 text-[12.5px] leading-5 text-[var(--text-2)]">{c.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1" aria-hidden="true">
                  {c.ids.slice(0, 40).map((id) => {
                    const m = byId.get(id);
                    return (
                      <span key={id} title={m ? heading(m) : undefined} className="h-1.5 w-1.5 rounded-full" style={{ background: m ? sourceColor(m.source) : 'var(--line-strong)' }} />
                    );
                  })}
                  {c.ids.length > 40 && <span className="text-[10px] text-[var(--text-3)]">+{c.ids.length - 40}</span>}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn"
                    onClick={() => {
                      setCategory(c);
                      setView('ledger');
                    }}
                  >
                    Open
                  </button>
                  <button className="btn" onClick={() => void runSummary(c.ids, c.name)}>
                    Summarize
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-10 text-center text-[13.5px] text-[var(--text-3)]">
            Not organized yet — the clerk reads every entry and files the ledger into topics.
          </div>
        )
      ) : visible.length === 0 && !busy ? (
        <div className="card rise p-12 text-center">
          <p className="display text-[18px] italic text-[var(--text-2)]">The ledger is empty.</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-[var(--text-3)]">
            Record an entry, drop a PDF/MD/TXT anywhere on this page, or point an agent at{' '}
            <code className="pill">{location.origin}/mcp</code> and let it remember for you.
          </p>
        </div>
      ) : view === 'cards' ? (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((m, i) => (
            <article key={m.id} className="card card-hover rise relative" style={{ animationDelay: `${Math.min(i, 12) * 24}ms` }}>
              <input
                type="checkbox"
                className="absolute right-2.5 top-2.5 z-10 h-3.5 w-3.5 cursor-pointer accent-[#1e3a8a]"
                checked={selected.has(m.id)}
                onChange={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(m.id)) next.delete(m.id);
                    else next.add(m.id);
                    return next;
                  })
                }
                aria-label={`Select entry ${m.id}`}
              />
              <button onClick={() => setDrawer(m)} className="block w-full cursor-pointer p-3.5 pr-8 text-left" aria-label={`Open entry: ${heading(m)}`}>
                <div className="mono text-[10px] text-[var(--text-3)]">#{String(m.id).padStart(3, '0')}</div>
                <h3 className="display mt-1 text-[14.5px] font-semibold leading-snug">{heading(m)}</h3>
                <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-[1.55] text-[var(--text-2)]">{m.content}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <Stamp source={m.source} />
                  <span
                    className="ml-auto text-[10.5px] text-[var(--text-3)]"
                    title={new Date(m.created_at).toLocaleString()}
                  >
                    {relativeTime(m.created_at)}
                  </span>
                </div>
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="card rise overflow-hidden">
          {visible.map((m) => (
            <div key={m.id} className="relative">
              <input
                type="checkbox"
                className="absolute right-3.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 cursor-pointer accent-[#1e3a8a]"
                checked={selected.has(m.id)}
                onChange={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(m.id)) next.delete(m.id);
                    else next.add(m.id);
                    return next;
                  })
                }
                aria-label={`Select entry ${m.id}`}
              />
              <button className="entry pr-10" onClick={() => setDrawer(m)} aria-label={`Open entry: ${heading(m)}`}>
                <span className="entry-id">#{String(m.id).padStart(3, '0')}</span>
                <span className="min-w-0 flex-1">
                  <span className="display block truncate text-[14px] font-semibold leading-snug">{heading(m)}</span>
                  {m.title && (
                    <span className="mt-0.5 block truncate text-[12px] leading-5 text-[var(--text-3)]">{m.content.replace(/\s+/g, ' ')}</span>
                  )}
                </span>
                {m.score !== undefined && <span className="mono hidden shrink-0 text-[10.5px] text-[var(--text-3)] sm:inline">{m.score.toFixed(3)}</span>}
                <Stamp source={m.source} />
                <span
                  className="shrink-0 whitespace-nowrap text-right text-[11px] text-[var(--text-3)]"
                  title={new Date(m.created_at).toLocaleString()}
                >
                  {relativeTime(m.created_at)}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {drawer && (
        <Drawer
          memory={drawer}
          onClose={() => setDrawer(null)}
          onChanged={() => void load()}
          onOpen={(m) => setDrawer(m)}
          onProposed={() => void loadProposals()}
        />
      )}
    </div>
  );
}
