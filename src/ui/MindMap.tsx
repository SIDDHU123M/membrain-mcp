import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Memory, type MindMap as MindMapData, type MindMapNode } from './api.js';
import { kindColor, relativeTime } from './util.js';

interface Pos {
  x: number;
  y: number;
}

const W = 1000;
const H = 640;

/* Deterministic hand-rolled force layout — repulsion + edge springs + center pull.
   ponytail: good enough for ≤25 nodes; a real graph lib only if this ever grows. */
function layout(map: MindMapData): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  map.nodes.forEach((n) => {
    let h = 0;
    for (const c of n.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const angle = (h % 360) * (Math.PI / 180);
    const radius = 120 + (h % 160);
    pos.set(n.id, {
      x: W / 2 + Math.cos(angle) * radius,
      y: H / 2 + Math.sin(angle) * radius * 0.7,
    });
  });
  const ids = map.nodes.map((n) => n.id);
  for (let iter = 0; iter < 260; iter++) {
    const force = new Map<string, Pos>(ids.map((id) => [id, { x: 0, y: 0 }]));
    // repulsion
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i])!;
        const b = pos.get(ids[j])!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 80);
        const f = 22000 / d2;
        const d = Math.sqrt(d2);
        force.get(ids[i])!.x += (dx / d) * f;
        force.get(ids[i])!.y += (dy / d) * f;
        force.get(ids[j])!.x -= (dx / d) * f;
        force.get(ids[j])!.y -= (dy / d) * f;
      }
    }
    // springs
    for (const e of map.edges) {
      const a = pos.get(e.from)!;
      const b = pos.get(e.to)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(Math.hypot(dx, dy), 1);
      const f = (d - 150) * 0.02;
      force.get(e.from)!.x += (dx / d) * f;
      force.get(e.from)!.y += (dy / d) * f;
      force.get(e.to)!.x -= (dx / d) * f;
      force.get(e.to)!.y -= (dy / d) * f;
    }
    const cool = 1 - iter / 260;
    for (const id of ids) {
      const p = pos.get(id)!;
      const f = force.get(id)!;
      // center gravity
      f.x += (W / 2 - p.x) * 0.004;
      f.y += (H / 2 - p.y) * 0.006;
      p.x = Math.min(W - 70, Math.max(70, p.x + f.x * cool * 0.5));
      p.y = Math.min(H - 50, Math.max(50, p.y + f.y * cool * 0.5));
    }
  }
  return pos;
}

const KINDS = ['person', 'project', 'tool', 'preference', 'topic', 'fact'] as const;

export default function MindMap() {
  const [map, setMap] = useState<MindMapData | null>(null);
  const [building, setBuilding] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MindMapNode | null>(null);
  const [nodeMemories, setNodeMemories] = useState<Memory[]>([]);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: W, h: H });
  const dragging = useRef<{ x: number; y: number } | null>(null);
  // node dragging, obsidian-style: positions live in state; a drag moves one node, edges follow
  const [positions, setPositions] = useState<Map<string, Pos>>(new Map());
  const nodeDrag = useRef<{ id: string; moved: boolean } | null>(null);

  useEffect(() => {
    void api
      .mindMap()
      .then((r) => setMap(r.map))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!building) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [building]);

  // fetch the memories behind the selected node
  useEffect(() => {
    if (!selected) return setNodeMemories([]);
    let live = true;
    void Promise.all(
      selected.memoryIds.slice(0, 12).map((id) => api.memory(id).catch(() => null)),
    ).then((ms) => live && setNodeMemories(ms.filter((m): m is Memory => m !== null)));
    return () => {
      live = false;
    };
  }, [selected]);

  useEffect(() => {
    setPositions(map ? layout(map) : new Map<string, Pos>());
  }, [map]);
  const pos = positions;

  const build = async () => {
    setBuilding(true);
    setError(null);
    try {
      setMap(await api.buildMindMap());
      setSelected(null);
      setViewBox({ x: 0, y: 0, w: W, h: H });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  const neighbors = useMemo(() => {
    if (!map || !selected) return new Set<string>();
    const s = new Set<string>([selected.id]);
    for (const e of map.edges) {
      if (e.from === selected.id) s.add(e.to);
      if (e.to === selected.id) s.add(e.from);
    }
    return s;
  }, [map, selected]);

  return (
    <div className="space-y-4">
      <section className="rise">
        <div className="rule-double" aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
          <div className="min-w-0 flex-1">
            <span className="label">The atlas</span>
            <p className="display mt-0.5 text-[13.5px] italic text-[var(--text-2)]" role="status">
              {building
                ? `The clerk is reading the ledger and drawing your knowledge map… ${elapsed}s`
                : map
                  ? `${map.nodes.length} entities · ${map.edges.length} relationships · ${map.model} · ${relativeTime(map.builtAt)}` +
                    (map.stale ? ' — entries changed since, redraw for a fresh map' : '')
                  : 'Every person, project, tool, and preference in the ledger — and how they connect.'}
            </p>
          </div>
          <button className="btn-primary shrink-0" onClick={() => void build()} disabled={building}>
            {building ? 'Drawing…' : map ? 'Redraw map' : 'Draw my map'}
          </button>
        </div>
        <div className="border-b border-[var(--line-strong)]" aria-hidden="true" />
      </section>

      {error && (
        <div className="card notice px-4 py-2.5 text-[13px]" role="alert">
          {error}
        </div>
      )}

      {map && (
        <div className="rise flex flex-wrap gap-1.5" aria-hidden="true">
          {KINDS.filter((k) => map.nodes.some((n) => n.kind === k)).map((k) => (
            <span key={k} className="chip">
              <span
                className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: kindColor(k) }}
              />
              {k}
            </span>
          ))}
        </div>
      )}

      <div className={`grid gap-3 ${selected ? 'lg:grid-cols-[1fr_320px]' : ''}`}>
        <div className="card overflow-hidden">
          {map ? (
            <svg
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
              className="h-[62vh] w-full cursor-grab select-none active:cursor-grabbing"
              role="img"
              aria-label="Knowledge map of your memories"
              onPointerDown={(e) => {
                dragging.current = { x: e.clientX, y: e.clientY };
                (e.target as Element).setPointerCapture?.(e.pointerId);
              }}
              onPointerMove={(e) => {
                const scale = viewBox.w / (e.currentTarget.clientWidth || W);
                if (nodeDrag.current) {
                  const { id } = nodeDrag.current;
                  nodeDrag.current.moved = true;
                  const last = dragging.current ?? { x: e.clientX, y: e.clientY };
                  setPositions((p) => {
                    const next = new Map(p);
                    const cur = next.get(id);
                    if (cur) {
                      next.set(id, {
                        x: cur.x + (e.clientX - last.x) * scale,
                        y: cur.y + (e.clientY - last.y) * scale,
                      });
                    }
                    return next;
                  });
                  dragging.current = { x: e.clientX, y: e.clientY };
                  return;
                }
                if (!dragging.current) return;
                // compute the delta NOW — the updater runs later, when the ref may
                // already be nulled by pointerup (the old null.x crash)
                const dx = (e.clientX - dragging.current.x) * scale;
                const dy = (e.clientY - dragging.current.y) * scale;
                setViewBox((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
                dragging.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerUp={() => {
                if (nodeDrag.current && !nodeDrag.current.moved && map) {
                  const n = map.nodes.find((x) => x.id === nodeDrag.current!.id);
                  if (n) setSelected(selected?.id === n.id ? null : n);
                }
                nodeDrag.current = null;
                dragging.current = null;
              }}
              onWheel={(e) => {
                const f = e.deltaY > 0 ? 1.12 : 0.9;
                setViewBox((v) => {
                  const w = Math.min(W * 2.5, Math.max(280, v.w * f));
                  const h = (w / W) * H;
                  return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
                });
              }}
            >
              {map.edges.map((e, i) => {
                const a = pos.get(e.from);
                const b = pos.get(e.to);
                if (!a || !b) return null;
                const lit =
                  selected && (e.from === selected.id || e.to === selected.id);
                const dim = selected && !lit;
                return (
                  <g key={i} opacity={dim ? 0.15 : 1}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={lit ? 'var(--accent)' : 'var(--line-strong)'}
                      strokeWidth={lit ? 1.6 : 1}
                    />
                    {lit && (
                      <text
                        x={(a.x + b.x) / 2}
                        y={(a.y + b.y) / 2 - 5}
                        textAnchor="middle"
                        fontSize="11"
                        fill="var(--text-2)"
                        style={{ fontFamily: 'var(--font-body)' }}
                      >
                        {e.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {map.nodes.map((n) => {
                const p = pos.get(n.id);
                if (!p) return null;
                const r = 9 + Math.min(13, n.memoryIds.length * 1.4);
                const color = kindColor(n.kind);
                const dim = selected && !neighbors.has(n.id);
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x},${p.y})`}
                    opacity={dim ? 0.22 : 1}
                    className="cursor-grab active:cursor-grabbing"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      nodeDrag.current = { id: n.id, moved: false };
                      dragging.current = { x: e.clientX, y: e.clientY };
                      (e.currentTarget.ownerSVGElement as SVGSVGElement | null)?.setPointerCapture?.(
                        e.pointerId,
                      );
                    }}
                    role="button"
                    aria-label={`${n.label} (${n.kind}, ${n.memoryIds.length} memories) — drag to move`}
                  >
                    <circle r={r + 5} fill={color} opacity="0.12" />
                    <circle
                      r={r}
                      fill={`${color}26`}
                      stroke={color}
                      strokeWidth={selected?.id === n.id ? 2.5 : 1.5}
                    />
                    <text
                      y={r + 15}
                      textAnchor="middle"
                      fontSize="12.5"
                      fontWeight="600"
                      fill="var(--text)"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {n.label}
                    </text>
                    {n.memoryIds.length > 0 && (
                      <text
                        y="4"
                        textAnchor="middle"
                        fontSize="10.5"
                        fill={color}
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        {n.memoryIds.length}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="flex h-[62vh] items-center justify-center p-10 text-center">
              <div>
                <p className="display text-[16px] text-[var(--text-2)]">No map drawn yet.</p>
                <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-[var(--text-3)]">
                  Press <span className="text-[var(--text-2)]">Draw my map</span> and the local LLM
                  will chart what it knows about you as a constellation — drag to pan, scroll to
                  zoom, click a node to see the memories behind it.
                </p>
              </div>
            </div>
          )}
        </div>

        {selected && (
          <aside className="card max-h-[62vh] overflow-y-auto p-4" aria-label="Selected entity">
            <div className="flex items-center gap-2">
              <h3 className="display text-[15px] font-semibold">{selected.label}</h3>
              <span
                className="chip ml-auto"
                style={{ borderColor: `${kindColor(selected.kind)}50`, color: kindColor(selected.kind) }}
              >
                {selected.kind}
              </span>
            </div>
            {map && (
              <ul className="mt-2.5 space-y-1">
                {map.edges
                  .filter((e) => e.from === selected.id || e.to === selected.id)
                  .slice(0, 10)
                  .map((e, i) => {
                    const otherId = e.from === selected.id ? e.to : e.from;
                    const other = map.nodes.find((n) => n.id === otherId);
                    return (
                      <li key={i} className="text-[12.5px] leading-5 text-[var(--text-2)]">
                        <span className="text-[var(--text-3)]">
                          {e.from === selected.id ? e.label : `← ${e.label}`}
                        </span>{' '}
                        {other?.label ?? otherId}
                      </li>
                    );
                  })}
              </ul>
            )}
            <div className="mt-3 space-y-2">
              {nodeMemories.map((m) => (
                <div
                  key={m.id}
                  className="rounded-[10px] border border-[var(--line)] bg-[var(--inset)] px-3 py-2"
                >
                  {m.title && (
                    <div className="display mb-0.5 text-[12px] font-semibold">{m.title}</div>
                  )}
                  <p className="line-clamp-3 text-[12px] leading-5 text-[var(--text-2)]">
                    {m.content}
                  </p>
                </div>
              ))}
              {selected.memoryIds.length === 0 && (
                <p className="text-[12px] text-[var(--text-3)]">
                  The model didn't link specific memories to this entity.
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
