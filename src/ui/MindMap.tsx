import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { api, type Memory, type MindMap as MindMapData, type MindMapNode } from './api.js';
import { kindColor, relativeTime, sourceColor, sourceLabel } from './util.js';
import { Markdown } from './markdown.js';

interface Pos {
  x: number;
  y: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
}

const W = 1000;
const H = 640;

// deterministic seed so the sim starts from the same shape every time
function seed(id: string): Pos {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const angle = (h % 360) * (Math.PI / 180);
  const radius = 120 + (h % 160);
  return { x: W / 2 + Math.cos(angle) * radius, y: H / 2 + Math.sin(angle) * radius * 0.7 };
}

const KINDS = ['person', 'project', 'tool', 'preference', 'topic', 'fact'] as const;

export default function MindMap({
  onOpenMemory,
}: {
  onOpenMemory?: (m: Memory) => void;
}) {
  const [map, setMap] = useState<MindMapData | null>(null);
  const [building, setBuilding] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MindMapNode | null>(null);
  const [nodeMemories, setNodeMemories] = useState<Memory[]>([]);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: W, h: H });
  const dragging = useRef<{ x: number; y: number } | null>(null);
  // live d3-force simulation (the same engine Obsidian's graph uses):
  // drag a node and the rest of the constellation tugs along and resettles
  const [positions, setPositions] = useState<Map<string, Pos>>(new Map());
  const nodeDrag = useRef<{ id: string; moved: boolean } | null>(null);
  const simRef = useRef<Simulation<SimNode, SimulationLinkDatum<SimNode>> | null>(null);
  const simNodes = useRef<Map<string, SimNode>>(new Map());

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

  // Esc closes the entity drawer
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

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
    simRef.current?.stop();
    if (!map) {
      setPositions(new Map());
      return;
    }
    const nodes: SimNode[] = map.nodes.map((n) => ({ id: n.id, ...seed(n.id) }));
    simNodes.current = new Map(nodes.map((n) => [n.id, n]));
    const links: SimulationLinkDatum<SimNode>[] = map.edges.map((e) => ({
      source: e.from,
      target: e.to,
    }));
    const sim = forceSimulation(nodes)
      .force(
        'link',
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
          .id((d) => d.id)
          .distance(150)
          .strength(0.5),
      )
      .force('charge', forceManyBody().strength(-320))
      .force('center', forceCenter(W / 2, H / 2))
      .force('collide', forceCollide(36))
      .on('tick', () => {
        setPositions(new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])));
      });
    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [map]);
  const pos = positions;

  // pointer position → simulation coordinates
  const toSim = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: viewBox.x + ((e.clientX - rect.left) / rect.width) * viewBox.w,
      y: viewBox.y + ((e.clientY - rect.top) / rect.height) * viewBox.h,
    };
  };

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
            <p
              className={`display mt-0.5 text-[13.5px] italic ${building ? 'gen-shimmer' : 'text-[var(--text-2)]'}`}
              role="status"
            >
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

      <div>
        {/* the atlas gets the whole desk — node details open as a drawer, never
            by shrinking the canvas */}
        <div className="card overflow-hidden">
          {map ? (
            <svg
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
              className="h-[calc(100vh-17rem)] min-h-[420px] w-full cursor-grab select-none active:cursor-grabbing"
              role="img"
              aria-label="Knowledge map of your memories"
              onPointerDown={(e) => {
                dragging.current = { x: e.clientX, y: e.clientY };
                (e.target as Element).setPointerCapture?.(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (nodeDrag.current) {
                  // obsidian drag: pin the node to the pointer, let the sim pull the rest
                  nodeDrag.current.moved = true;
                  const n = simNodes.current.get(nodeDrag.current.id);
                  if (n) {
                    const p = toSim(e);
                    n.fx = p.x;
                    n.fy = p.y;
                  }
                  return;
                }
                if (!dragging.current) return;
                const scale = viewBox.w / (e.currentTarget.clientWidth || W);
                // compute the delta NOW — the updater runs later, when the ref may
                // already be nulled by pointerup (the old null.x crash)
                const dx = (e.clientX - dragging.current.x) * scale;
                const dy = (e.clientY - dragging.current.y) * scale;
                setViewBox((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
                dragging.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerUp={() => {
                if (nodeDrag.current) {
                  const n = simNodes.current.get(nodeDrag.current.id);
                  if (n) {
                    // release the pin — the graph springs back and settles
                    n.fx = null;
                    n.fy = null;
                  }
                  simRef.current?.alphaTarget(0);
                  if (!nodeDrag.current.moved && map) {
                    const node = map.nodes.find((x) => x.id === nodeDrag.current!.id);
                    if (node) setSelected(selected?.id === node.id ? null : node);
                  }
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
                    className="cursor-pointer active:cursor-grabbing"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      nodeDrag.current = { id: n.id, moved: false };
                      const sn = simNodes.current.get(n.id);
                      if (sn) {
                        sn.fx = sn.x;
                        sn.fy = sn.y;
                      }
                      // reheat the simulation so the graph reacts while dragging
                      simRef.current?.alphaTarget(0.3).restart();
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
            <div className="flex h-[calc(100vh-17rem)] min-h-[420px] items-center justify-center p-10 text-center">
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
          <>
            <div className="drawer-scrim" onClick={() => setSelected(null)} aria-hidden="true" />
            <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Entity ${selected.label}`}>
              <header className="flex items-center gap-2.5 border-b border-[var(--line)] px-6 py-4">
                <h3 className="display text-[16px] font-semibold">{selected.label}</h3>
                <span
                  className="chip"
                  style={{ borderColor: `${kindColor(selected.kind)}50`, color: kindColor(selected.kind) }}
                >
                  {selected.kind}
                </span>
                <button
                  className="ml-auto cursor-pointer text-[18px] leading-none text-[var(--text-3)] hover:text-[var(--text)]"
                  onClick={() => setSelected(null)}
                  aria-label="Close entity"
                >
                  ✕
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
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
            <div className="mt-3 space-y-2.5">
              <span className="label">
                Entries behind this ({selected.memoryIds.length})
              </span>
              {nodeMemories.map((m) => (
                <div key={m.id} className="border border-[var(--line)] bg-[var(--inset)] p-3">
                  <div className="flex items-center gap-2">
                    <span className="mono text-[10px] text-[var(--text-3)]">
                      #{String(m.id).padStart(3, '0')}
                    </span>
                    <span className="stamp" style={{ color: sourceColor(m.source) }}>
                      {sourceLabel(m.source)}
                    </span>
                    {onOpenMemory && (
                      <button
                        className="btn ml-auto px-2 py-0.5 text-[10px]"
                        onClick={() => onOpenMemory(m)}
                      >
                        Open entry →
                      </button>
                    )}
                  </div>
                  {m.title && (
                    <div className="display mt-1.5 text-[13px] font-semibold">{m.title}</div>
                  )}
                  {/* memories are often markdown (agent imports) — render, don't dump */}
                  <div className="relative mt-1 max-h-36 overflow-hidden">
                    <Markdown text={m.content} />
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
                      style={{ background: 'linear-gradient(transparent, var(--surface))' }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              ))}
              {selected.memoryIds.length === 0 && (
                <p className="text-[12px] text-[var(--text-3)]">
                  The model didn't link specific memories to this entity.
                </p>
              )}
            </div>
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
