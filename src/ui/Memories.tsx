import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type MapCategory, type Memory, type MemoryMap, type Proposal, type SavedSummary } from './api.js';
import { relativeTime, sourceColor, sourceLabel } from './util.js';
import { Markdown } from './markdown.js';

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
          {memory.pinned && <span className="text-[12px]" title="Pinned">★</span>}
          {memory.archived && <span className="chip">archived</span>}
          {memory.sealed && <span className="chip" title="Never sent to any AI, invisible to agents">sealed</span>}
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
            // agent-written memories are frequently markdown — render it
            <Markdown text={memory.content} />
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
                disabled={toolBusy !== null || memory.sealed}
                title={
                  memory.sealed
                    ? 'Sealed — this entry is never sent to any AI'
                    : 'Draft a title for this entry — staged for your review, never applied directly'
                }
              >
                {toolBusy === 'title' ? 'Drafting…' : memory.title ? 'Redraft title' : 'Draft title'}
              </button>
              <button className="btn" onClick={() => void findRelated()} disabled={toolBusy !== null}>
                {toolBusy === 'related' ? 'Searching…' : 'Find related'}
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  await api.updateMemory(memory.id, { pinned: !memory.pinned });
                  onChanged();
                  onClose();
                }}
              >
                {memory.pinned ? 'Unpin' : 'Pin to top'}
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  await api.updateMemory(memory.id, { archived: !memory.archived });
                  onChanged();
                  onClose();
                }}
              >
                {memory.archived ? 'Restore' : 'Archive'}
              </button>
              <button
                className="btn"
                disabled={busy}
                title="Sealed entries are never sent to any AI (clerk or cloud) and are invisible to agents over MCP"
                onClick={async () => {
                  await api.updateMemory(memory.id, { sealed: !memory.sealed });
                  onChanged();
                  onClose();
                }}
              >
                {memory.sealed ? 'Unseal' : 'Seal from AI'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  const md = `---\nid: ${memory.id}\ntags: ${JSON.stringify(memory.tags)}\nsource: ${memory.source}\n---\n\n${memory.content}\n`;
                  void navigator.clipboard.writeText(md).then(() => setToolNote('Copied as markdown.'));
                }}
              >
                Copy as markdown
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

export default function Memories({
  onStatsDirty,
  jumpMemory,
  onJumpConsumed,
}: {
  onStatsDirty: () => void;
  jumpMemory?: Memory | null;
  onJumpConsumed?: () => void;
}) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [writer, setWriter] = useState<string | null>(null);
  const [view, setView] = useState<'ledger' | 'cards' | 'topics'>('ledger');
  const [shelf, setShelf] = useState<'live' | 'pinned' | 'archived'>('live');
  const [stale, setStale] = useState<Memory[] | null>(null);
  const [map, setMap] = useState<MemoryMap | null>(null);
  const [category, setCategory] = useState<MapCategory | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drawer, setDrawer] = useState<Memory | null>(null);
  const [summaries, setSummaries] = useState<SavedSummary[]>([]);
  const [sumDrawer, setSumDrawer] = useState<{
    running: boolean;
    label: string;
    ids?: number[];
    view: SavedSummary | null;
    error?: string;
  } | null>(null);
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
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; m: Memory } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // context menu dismissal
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  useEffect(() => () => esRef.current?.close(), []);

  // arriving from the atlas: open the requested entry in the drawer
  useEffect(() => {
    if (jumpMemory) {
      setDrawer(jumpMemory);
      onJumpConsumed?.();
    }
  }, [jumpMemory, onJumpConsumed]);

  // Esc closes the summary drawer (the memory drawer handles its own)
  useEffect(() => {
    if (!sumDrawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSumDrawer(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sumDrawer]);

  // [[wikilink]] clicked anywhere markdown renders → recall that name
  useEffect(() => {
    const onLink = (e: Event) => {
      setDrawer(null);
      setQuery((e as CustomEvent<string>).detail);
      document.getElementById('recall-input')?.focus();
    };
    window.addEventListener('membrain:wikilink', onLink);
    return () => window.removeEventListener('membrain:wikilink', onLink);
  }, []);

  const load = useCallback(async () => {
    setMemories(
      await api.memories({
        query: query || undefined,
        tag: tag ?? undefined,
        archived: shelf === 'archived',
      }),
    );
    onStatsDirty();
  }, [query, tag, shelf, onStatsDirty]);

  useEffect(() => {
    const t = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  // the wire: when any writer touches the store (an agent over MCP, a script,
  // another tab), refresh the ledger and flash the arriving entry.
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [wireLog, setWireLog] = useState<{ type: string; id: number; source?: string; at: number }[]>([]);
  const [showWire, setShowWire] = useState(false);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    const es = new EventSource('/api/events');
    let t: ReturnType<typeof setTimeout> | null = null;
    es.addEventListener('memory', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data) as { type: string; id: number; source?: string };
      setWireLog((l) => [{ ...e, at: Date.now() }, ...l].slice(0, 20));
      if (e.type !== 'deleted') {
        setFresh((s) => new Set(s).add(e.id));
        setTimeout(
          () =>
            setFresh((s) => {
              const n = new Set(s);
              n.delete(e.id);
              return n;
            }),
          3000,
        );
      }
      if (t) clearTimeout(t);
      t = setTimeout(() => void loadRef.current(), 250);
    });
    return () => {
      if (t) clearTimeout(t);
      es.close();
    };
  }, []);

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
    // summaries survive restarts — the drawer lists them
    void api
      .summaries()
      .then((r) => setSummaries(r.summaries))
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
  const sealedCount = useMemo(() => memories.filter((m) => m.sealed).length, [memories]);

  // which brain is on duty — shown whenever the clerk is working
  const [llmInfo, setLlmInfo] = useState<{ provider: string; model: string } | null>(null);
  useEffect(() => {
    if (!aiOp || llmInfo) return;
    void api
      .llmInfo()
      .then((r) => setLlmInfo(r.llm))
      .catch(() => {});
  }, [aiOp, llmInfo]);

  const visible = useMemo(() => {
    let v = memories;
    if (shelf === 'pinned') v = v.filter((m) => m.pinned);
    if (writer) v = v.filter((m) => m.source === writer);
    if (category) {
      const ids = new Set(category.ids);
      v = v.filter((m) => ids.has(m.id));
    }
    return v;
  }, [memories, shelf, writer, category]);

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
  const runMap = (onlyNew = false) => {
    setAiOp('map');
    setNotice(null);
    setAiStatus(onlyNew ? 'Filing new entries into existing topics…' : 'Filing memories into topics…');
    const es = new EventSource(`/api/insights/map/stream${onlyNew ? '?mode=update' : ''}`);
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
    const useIds = ids ?? scope.ids;
    const useLabel = label ?? scope.label;
    setAiOp('summary');
    setSumDrawer({ running: true, label: useLabel, ids: useIds, view: null });
    setNotice(null);
    try {
      const r = await api.summarize(useIds, useLabel);
      setSumDrawer({ running: false, label: useLabel, ids: useIds, view: r.summary });
      setSummaries((s) => [r.summary, ...s.filter((x) => x.id !== r.summary.id)].slice(0, 12));
    } catch (e) {
      setSumDrawer((d) => (d ? { ...d, running: false, error: (e as Error).message } : d));
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

  const findStale = async () => {
    setNotice(null);
    try {
      const r = await api.stale(90);
      setStale(r);
      if (r.length === 0) setNotice('Nothing stale — every live entry was touched in the last 90 days.');
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const resolveStale = async (id: number, action: 'confirm' | 'archive' | 'strike') => {
    setBusy(true);
    try {
      if (action === 'confirm') await api.updateMemory(id, {}); // touch: still true today
      if (action === 'archive') await api.updateMemory(id, { archived: true });
      if (action === 'strike') await api.deleteMemory(id);
      setStale((s) => s?.filter((m) => m.id !== id) ?? null);
      await load();
    } finally {
      setBusy(false);
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

  const toggleSelect = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteSelected = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3500);
      return;
    }
    setConfirmDelete(false);
    setBusy(true);
    try {
      for (const id of selected) await api.deleteMemory(id);
      setNotice(`Struck ${selected.size} entries from the ledger.`);
      setSelected(new Set());
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openCtx = (e: React.MouseEvent, m: Memory) => {
    e.preventDefault();
    const pad = 8;
    setCtxMenu({
      x: Math.min(e.clientX, window.innerWidth - 190 - pad),
      y: Math.min(e.clientY, window.innerHeight - 230 - pad),
      m,
    });
  };

  const ctxAction = async (
    action: 'open' | 'select' | 'title' | 'export' | 'pin' | 'archive' | 'seal' | 'delete',
  ) => {
    if (!ctxMenu) return;
    const m = ctxMenu.m;
    setCtxMenu(null);
    if (action === 'open') setDrawer(m);
    if (action === 'select') toggleSelect(m.id);
    if (action === 'export') window.open(`/api/export/memories?ids=${m.id}`, '_blank');
    if (action === 'pin') {
      await api.updateMemory(m.id, { pinned: !m.pinned });
      await load();
    }
    if (action === 'seal') {
      await api.updateMemory(m.id, { sealed: !m.sealed });
      setNotice(
        m.sealed
          ? `Entry #${m.id} unsealed — the clerk and agents can see it again.`
          : `Entry #${m.id} sealed — it will never be sent to any AI or shown to agents.`,
      );
      await load();
    }
    if (action === 'archive') {
      await api.updateMemory(m.id, { archived: !m.archived });
      setNotice(m.archived ? `Entry #${m.id} restored to the ledger.` : `Entry #${m.id} filed to the archive.`);
      await load();
    }
    if (action === 'title') {
      try {
        await api.proposeTitleFor(m.id);
        setNotice(`Title drafted for #${m.id} — review in the clerk's proposals.`);
        await loadProposals();
        setShowProposals(true);
      } catch (e) {
        setNotice((e as Error).message);
      }
    }
    if (action === 'delete') {
      setBusy(true);
      try {
        await api.deleteMemory(m.id);
        setNotice(`Struck entry #${m.id}.`);
        await load();
      } finally {
        setBusy(false);
      }
    }
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
        <div className="py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="label shrink-0">The clerk</span>
            {aiOp && (
              <span className="relative flex h-2 w-2 shrink-0 self-center" aria-hidden="true">
                <span className="absolute h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
                <span className="relative h-2 w-2 rounded-full bg-[var(--accent)]" />
              </span>
            )}
            <p
              className={`display min-w-0 break-words text-[13.5px] italic ${
                aiOp ? 'font-medium text-[var(--text)]' : 'text-[var(--text-2)]'
              }`}
              role="status"
              aria-live="polite"
            >
              {aiOp
                ? (aiStatus ?? 'The clerk is working…')
                : (aiStatus ??
                  (map
                    ? `${map.categories.length} topics on file${map.stale ? ' — entries changed since, reorganize' : ''} · ${untitled} untitled`
                    : `${memories.length} entries · ${untitled} untitled · not yet organized`))}
            </p>
            {aiOp && llmInfo && (
              <span className="chip shrink-0" title="The brain doing this work, from Settings">
                {llmInfo.provider} · {llmInfo.model}
              </span>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button className="btn-primary" onClick={() => runMap(false)} disabled={aiOp !== null}>
              {map ? 'Reorganize' : 'Organize'}
            </button>
            {map && map.stale && (
              <button
                className="btn"
                onClick={() => runMap(true)}
                disabled={aiOp !== null}
                title="File only entries the map has never seen into the existing topics — much faster than a full reorganize"
              >
                File new entries
              </button>
            )}
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
            {summaries.length > 0 && (
              <button
                className="btn"
                onClick={() =>
                  setSumDrawer({
                    running: false,
                    label: summaries[0].label,
                    ids: summaries[0].ids,
                    view: summaries[0],
                  })
                }
                title="Every summary the clerk has written — reopen, regenerate, or file one into the ledger"
              >
                Summaries · {summaries.length}
              </button>
            )}
            <button className="btn" onClick={() => void findDupes()} title="Vector similarity — instant, no LLM">
              Duplicates
            </button>
            <button
              className="btn"
              onClick={() => void findStale()}
              title="Entries untouched for 90+ days — confirm they still hold, or archive/strike them"
            >
              Stale
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
          <p className="mt-2 text-[11.5px] text-[var(--text-3)]">
            {sealedCount > 0
              ? `${sealedCount} sealed ${sealedCount === 1 ? 'entry stays' : 'entries stay'} out of every AI operation and agent request.`
              : 'Private entry? Right-click it → “Seal” and it will never be sent to any AI or shown to agents.'}
          </p>
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
                    {p.kind === 'save' ? (
                      <>
                        <div className="line-clamp-2 text-[13px]">{p.next}</div>
                        <p className="mt-0.5 truncate text-[11.5px] text-[var(--text-3)]">
                          new entry from <span style={{ color: sourceColor(p.source ?? '') }}>{sourceLabel(p.source ?? '')}</span>
                          {p.tags?.length ? ` · ${p.tags.join(', ')}` : ''}
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="text-[13px]">
                          {p.old && <span className="text-[var(--text-3)] line-through">{p.old} </span>}
                          <span className="display font-semibold">{p.next}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[11.5px] text-[var(--text-3)]">
                          #{String(p.memoryId).padStart(3, '0')} · {m?.content ?? '(entry not in current view)'}
                        </p>
                      </>
                    )}
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

      {/* the wire — live event log; every write from any writer, as it lands */}
      {wireLog.length > 0 && (
        <section className="card rise p-3" aria-label="The wire — live activity">
          <button
            className="flex w-full cursor-pointer items-center gap-2 text-left"
            onClick={() => setShowWire((s) => !s)}
            aria-expanded={showWire}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            </span>
            <span className="label">The wire</span>
            <span className="text-[11.5px] text-[var(--text-3)]">
              {wireLog.length} {wireLog.length === 1 ? 'event' : 'events'} this session
            </span>
            <span className="ml-auto text-[11px] text-[var(--text-3)]">{showWire ? 'hide' : 'show'}</span>
          </button>
          {showWire && (
            <div className="rowlist mt-2 max-h-[26vh] overflow-y-auto">
              {wireLog.map((e, idx) => (
                <div key={`${e.at}-${idx}`} className="flex items-center gap-2.5 py-1.5 text-[12px]">
                  <span className="mono text-[10.5px] text-[var(--text-3)]">
                    {new Date(e.at).toLocaleTimeString()}
                  </span>
                  <span className="mono">
                    {e.type === 'saved' ? 'recorded' : e.type === 'updated' ? 'amended' : 'struck'}
                  </span>
                  <button
                    className="mono cursor-pointer underline decoration-dotted underline-offset-2"
                    onClick={() =>
                      void api
                        .memory(e.id)
                        .then(setDrawer)
                        .catch(() => setNotice(`Entry #${e.id} is gone (struck).`))
                    }
                  >
                    #{String(e.id).padStart(3, '0')}
                  </button>
                  {e.source && <Stamp source={e.source} />}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {stale && stale.length > 0 && (
        <section className="card rise p-4" aria-label="Stale entries">
          <div className="mb-2 flex items-center gap-2">
            <p className="flex-1 text-[12.5px] text-[var(--text-2)]">
              {stale.length} {stale.length === 1 ? 'entry' : 'entries'} untouched for 90+ days —
              confirm each still holds, or file it away.
            </p>
            <button className="btn" onClick={() => setStale(null)}>
              Close
            </button>
          </div>
          <div className="rowlist max-h-[40vh] overflow-y-auto">
            {stale.map((m) => (
              <div key={m.id} className="flex items-start gap-3 py-2.5">
                <span className="mono pt-0.5 text-[10.5px] text-[var(--text-3)]">
                  #{String(m.id).padStart(3, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[12.5px] leading-5 text-[var(--text-2)]">{m.content}</p>
                  <span className="mono text-[10px] text-[var(--text-3)]">
                    last touched {new Date(m.updated_at).toLocaleDateString()}
                  </span>
                </div>
                <Stamp source={m.source} />
                <div className="flex shrink-0 gap-1">
                  <button className="btn px-2 py-0.5 text-[10.5px]" onClick={() => void resolveStale(m.id, 'confirm')} disabled={busy} title="Mark as still true today">
                    Still true
                  </button>
                  <button className="btn px-2 py-0.5 text-[10.5px]" onClick={() => void resolveStale(m.id, 'archive')} disabled={busy}>
                    Archive
                  </button>
                  <button className="btn-danger px-2 py-0.5 text-[10.5px]" onClick={() => void resolveStale(m.id, 'strike')} disabled={busy}>
                    Strike
                  </button>
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
        <div className="seg" role="group" aria-label="Shelf">
          {(['live', 'pinned', 'archived'] as const).map((s) => (
            <button key={s} onClick={() => setShelf(s)} aria-pressed={shelf === s} className={shelf === s ? 'seg-on' : ''}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {allTags.includes('example') && (
            <button
              className="chip chip-btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const ex = memories.filter((m) => m.tags.includes('example'));
                  for (const m of ex) await api.deleteMemory(m.id);
                  setNotice(`Struck ${ex.length} example ${ex.length === 1 ? 'entry' : 'entries'}. The ledger is yours.`);
                  await load();
                } finally {
                  setBusy(false);
                }
              }}
              title="Remove the seeded example entries"
            >
              Clear examples ✕
            </button>
          )}
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
            <>
              <button
                className="btn-danger"
                onClick={() => void deleteSelected()}
                disabled={busy}
                style={confirmDelete ? { borderColor: 'var(--danger)', color: 'var(--danger)' } : undefined}
              >
                {confirmDelete ? `Confirm — strike ${selected.size}?` : `Delete ${selected.size} selected`}
              </button>
              <button className="btn" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div className="card notice flex items-start gap-3 px-4 py-2.5 text-[13px]" role="status">
          <span className="min-w-0 flex-1 break-words">{notice}</span>
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
        shelf !== 'live' || writer || tag || category || query ? (
          // filters hid everything — say so, never look like data loss
          <div className="card rise p-12 text-center">
            <p className="display text-[18px] italic text-[var(--text-2)]">Nothing on this shelf.</p>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-[var(--text-3)]">
              {[
                shelf !== 'live' && `shelf: ${shelf}`,
                query && `search: “${query}”`,
                tag && `tag: ${tag}`,
                writer && `writer: ${sourceLabel(writer)}`,
                category && `topic: ${category.name}`,
              ]
                .filter(Boolean)
                .join(' · ')}{' '}
              — no entries match all of that. Your data is untouched.
            </p>
            <button
              className="btn mt-4"
              onClick={() => {
                setShelf('live');
                setWriter(null);
                setTag(null);
                setCategory(null);
                setQuery('');
              }}
            >
              Show everything
            </button>
          </div>
        ) : (
          <div className="card rise p-12 text-center">
            <p className="display text-[18px] italic text-[var(--text-2)]">The ledger is empty.</p>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-[var(--text-3)]">
              Record an entry, drop a PDF/MD/TXT anywhere on this page, or point an agent at{' '}
              <code className="pill">{location.origin}/mcp</code> and let it remember for you.
            </p>
          </div>
        )
      ) : view === 'cards' ? (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((m, i) => (
            <article key={m.id} className="card card-hover rise relative" style={{ animationDelay: `${Math.min(i, 12) * 24}ms` }} onContextMenu={(e) => openCtx(e, m)}>
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
            <div
              key={m.id}
              className={`flex items-center border-b border-[var(--line)] last:border-b-0 ${fresh.has(m.id) ? 'wire-fresh' : ''}`}
              onContextMenu={(e) => openCtx(e, m)}
            >
              <input
                type="checkbox"
                className="ml-3.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[#1e3a8a]"
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
              <button className="entry min-w-0 flex-1 !border-b-0" onClick={() => setDrawer(m)} aria-label={`Open entry: ${heading(m)}`}>
                <span className="entry-id">#{String(m.id).padStart(3, '0')}</span>
                <span className="min-w-0 flex-1">
                  <span className="display block truncate text-[14px] font-semibold leading-snug">{heading(m)}</span>
                  {m.title && (
                    <span className="mt-0.5 block truncate text-[12px] leading-5 text-[var(--text-3)]">{m.content.replace(/\s+/g, ' ')}</span>
                  )}
                </span>
                {m.score !== undefined && (
                  <span
                    className="mono hidden shrink-0 text-[10.5px] text-[var(--text-3)] sm:inline"
                    title={`Matched via ${(m.via ?? []).map((v) => (v === 'vec' ? 'meaning' : 'keywords')).join(' + ') || 'recency'}`}
                  >
                    {m.via?.includes('vec') && 'sem '}
                    {m.via?.includes('fts') && 'kw '}
                    {m.score.toFixed(3)}
                  </span>
                )}
                {m.pinned && (
                  <span className="shrink-0 text-[11px]" title="Pinned" aria-label="Pinned">
                    ★
                  </span>
                )}
                {m.sealed && (
                  <span className="chip shrink-0" title="Sealed — never sent to any AI, invisible to agents">
                    sealed
                  </span>
                )}
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

      {sumDrawer && (
        <>
          <div className="drawer-scrim" onClick={() => setSumDrawer(null)} aria-hidden="true" />
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="The clerk's summary">
            <header className="flex items-center gap-3 border-b border-[var(--line)] px-6 py-4">
              <span className="label">The clerk's summary</span>
              <span className="chip">{sumDrawer.view?.label ?? sumDrawer.label}</span>
              <button
                className="ml-auto cursor-pointer text-[18px] leading-none text-[var(--text-3)] hover:text-[var(--text)]"
                onClick={() => setSumDrawer(null)}
                aria-label="Close summary"
              >
                ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {sumDrawer.running ? (
                <div className="flex items-center gap-3 py-6" role="status">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
                    <span className="relative h-2 w-2 rounded-full bg-[var(--accent)]" />
                  </span>
                  <p className="display text-[14px] italic text-[var(--text-2)]">
                    Reading {sumDrawer.ids?.length ?? memories.length} entries — writing the digest of{' '}
                    {sumDrawer.label}. Local models take a minute.
                  </p>
                </div>
              ) : sumDrawer.error ? (
                <div className="py-4">
                  <p className="notice text-[13px]">{sumDrawer.error}</p>
                  <button
                    className="btn mt-3"
                    onClick={() => void runSummary(sumDrawer.ids, sumDrawer.label)}
                  >
                    Try again
                  </button>
                </div>
              ) : sumDrawer.view ? (
                <>
                  <p className="label">
                    Summary of {sumDrawer.view.label} · {sumDrawer.view.count} entries ·{' '}
                    {relativeTime(sumDrawer.view.at)}
                  </p>
                  <div className="mt-2">
                    <Markdown text={sumDrawer.view.text} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3.5">
                    <button
                      className="btn"
                      disabled={aiOp !== null}
                      onClick={() => void runSummary(sumDrawer.view?.ids, sumDrawer.view?.label)}
                    >
                      Regenerate
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        const v = sumDrawer.view!;
                        void navigator.clipboard
                          .writeText(`## Summary of ${v.label} (${v.count} entries)\n\n${v.text}\n`)
                          .then(() => setNotice('Summary copied as markdown.'));
                      }}
                    >
                      Copy markdown
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      title="File this summary into the ledger as its own entry"
                      onClick={async () => {
                        const v = sumDrawer.view!;
                        setBusy(true);
                        try {
                          await api.addMemory(`Summary of ${v.label} (${v.count} entries):\n\n${v.text}`, ['summary']);
                          setNotice(`Summary of ${v.label} filed into the ledger.`);
                          await load();
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Save as entry
                    </button>
                  </div>
                </>
              ) : null}

              {summaries.length > 0 && (
                <div className="mt-6 border-t border-[var(--line)] pt-4">
                  <span className="label">Earlier summaries</span>
                  <div className="rowlist mt-1.5">
                    {summaries.map((s) => (
                      <button
                        key={s.id}
                        className="flex w-full cursor-pointer items-baseline gap-2.5 py-2 text-left"
                        onClick={() =>
                          setSumDrawer({ running: false, label: s.label, ids: s.ids, view: s })
                        }
                        aria-current={sumDrawer.view?.id === s.id ? 'true' : undefined}
                      >
                        <span className={`text-[13px] ${sumDrawer.view?.id === s.id ? 'font-semibold' : ''}`}>
                          {s.label}
                        </span>
                        <span className="leader-dots" aria-hidden="true" />
                        <span className="mono shrink-0 text-[10.5px] text-[var(--text-3)]">
                          {s.count} entries · {relativeTime(s.at)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </>
      )}

      {ctxMenu && (
        <div
          className="card fixed z-50 w-[185px] py-1"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
          aria-label={`Entry ${ctxMenu.m.id} actions`}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="mono border-b border-[var(--line)] px-3 pb-1 pt-0.5 text-[10px] text-[var(--text-3)]">
            ENTRY #{String(ctxMenu.m.id).padStart(3, '0')}
          </div>
          {(
            [
              ['open', 'Open entry'],
              ['select', selected.has(ctxMenu.m.id) ? 'Deselect' : 'Select'],
              ['pin', ctxMenu.m.pinned ? 'Unpin' : 'Pin to top'],
              ['seal', ctxMenu.m.sealed ? 'Unseal (allow AI)' : 'Seal (hide from AI)'],
              ['archive', ctxMenu.m.archived ? 'Restore from archive' : 'File to archive'],
              ['title', ctxMenu.m.title ? 'Redraft title' : 'Draft title'],
              ['export', 'Export JSON'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="menuitem"
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-[12.5px] text-[var(--text-2)] transition-colors hover:bg-[var(--inset)] hover:text-[var(--text)]"
              onClick={() => void ctxAction(key)}
            >
              {label}
            </button>
          ))}
          <button
            role="menuitem"
            className="block w-full cursor-pointer border-t border-[var(--line)] px-3 py-1.5 text-left text-[12.5px] text-[var(--danger)] transition-colors hover:bg-[var(--inset)]"
            onClick={() => void ctxAction('delete')}
          >
            Strike entry
          </button>
        </div>
      )}
    </div>
  );
}
