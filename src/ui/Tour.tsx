import { useEffect, useState } from 'react';

export interface TourStep {
  tab: string | null;
  /** optional in-page element to spotlight; falls back to the rail tab button */
  spot?: string;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    tab: null,
    title: 'Welcome to the ledger',
    body: 'Membrain is one memory shared by you and your AI agents. This minute-long tour walks the rooms — every screen you see is live, this is your actual ledger behind the veil.',
  },
  {
    tab: 'Memories',
    spot: '#recall-input',
    title: 'Memories',
    body: 'The ledger itself. This ruled line recalls anything — hybrid semantic and keyword search. Record entries by hand, drop PDFs to have them distilled, and let the clerk organize, title, and summarize. Every entry is stamped with who wrote it.',
  },
  {
    tab: 'Map',
    title: 'The atlas',
    body: 'Everything the store knows, drawn as a constellation — people, projects, tools, preferences, and how they connect. Drag the stars around; real physics. Built by the clerk on request, never used for retrieval.',
  },
  {
    tab: 'Skills',
    title: 'Skills',
    body: "The instruction manuals your agents follow. Every SKILL.md on this machine, with a markdown preview and an editor. The membrain skill teaches agents to remember unprompted — it's already here.",
  },
  {
    tab: 'Agent Import',
    title: 'Acquisitions',
    body: 'Memory your agents already keep on disk, discovered and ready to file into the ledger. Content hashes make sure nothing imports twice; changed files update their entry instead of duplicating.',
  },
  {
    tab: 'Docs',
    title: 'The manual',
    body: 'Quickstart, agent connection snippets, MCP usage guidance, and the skill as a download. If you forget everything else: agents connect at /mcp on this same port.',
  },
  {
    tab: 'Settings',
    title: 'Settings',
    body: "The clerk's brain (local Ollama or any cloud key — there's a test button), embeddings, paths, and backups. Everything configurable lives here; no config files.",
  },
];

const DONE_KEY = 'membrain-tour-done';

export function tourPending(): boolean {
  return !localStorage.getItem(DONE_KEY);
}

interface Spot {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_W = 480;
const CARD_EST_H = 250;
const GAP = 14;

export default function Tour({
  onTab,
  onClose,
}: {
  onTab: (tab: string) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  const step = STEPS[i];

  useEffect(() => {
    if (step.tab) onTab(step.tab);
    let cancelled = false;
    let tries = 0;
    const find = (): HTMLElement | null =>
      (step.spot && document.querySelector<HTMLElement>(step.spot)) ||
      (step.tab ? document.querySelector<HTMLElement>(`[data-tour="${step.tab}"]`) : null);
    const measure = () => {
      if (cancelled) return;
      const el = find();
      // in-page spots mount after the tab switch — keep trying briefly
      if (step.spot && !document.querySelector(step.spot) && tries < 30) {
        tries++;
        requestAnimationFrame(measure);
      }
      if (!el) return setSpot(null);
      const r = el.getBoundingClientRect();
      setSpot({ top: r.top - 5, left: r.left - 5, width: r.width + 10, height: r.height + 10 });
    };
    find()?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const raf = requestAnimationFrame(measure);
    const remeasure = () => {
      tries = 30;
      measure();
    };
    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, true);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, true);
    };
  }, [step, onTab]);

  const finish = () => {
    localStorage.setItem(DONE_KEY, '1');
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' && i < STEPS.length - 1) setI(i + 1);
      if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // the card follows the spotlight: below the target when there's room,
  // above it otherwise, clamped to the viewport; centered on the welcome step
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(CARD_W, vw - 24);
  const cardStyle: React.CSSProperties = spot
    ? {
        top:
          spot.top + spot.height + GAP + CARD_EST_H < vh - 12
            ? spot.top + spot.height + GAP
            : Math.max(12, spot.top - CARD_EST_H - GAP),
        left: Math.min(Math.max(12, spot.left), vw - cardW - 12),
        width: cardW,
      }
    : { top: Math.max(48, vh * 0.18), left: (vw - cardW) / 2, width: cardW };

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Tour">
      {/* click-catcher; the actual veil is the spotlight's box-shadow */}
      <div className="absolute inset-0" onClick={finish} aria-hidden="true" />
      <div
        className="tour-spot"
        style={
          spot ?? {
            top: vh / 2,
            left: vw / 2,
            width: 0,
            height: 0,
            outlineColor: 'transparent',
          }
        }
        aria-hidden="true"
      />

      <div
        className="card fixed z-10 max-h-[min(82vh,36rem)] overflow-y-auto p-4 sm:p-5"
        style={{ ...cardStyle, transition: 'top 0.4s cubic-bezier(0.33,1,0.68,1), left 0.4s cubic-bezier(0.33,1,0.68,1)' }}
      >
        <div className="rule-double" aria-hidden="true" />
        <div className="flex items-baseline gap-3 pt-3">
          <span className="label">
            A quick tour — {i + 1} of {STEPS.length}
          </span>
          <div className="ml-auto flex gap-1" aria-hidden="true">
            {STEPS.map((_, j) => (
              <span
                key={j}
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: j === i ? 'var(--accent)' : 'var(--line-strong)' }}
              />
            ))}
          </div>
        </div>
        <h2 className="display mt-2 text-[20px] font-semibold">{step.title}</h2>
        <p className="mt-1.5 text-[13.5px] leading-6 text-[var(--text-2)]">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          {i > 0 && (
            <button className="btn" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          {i < STEPS.length - 1 ? (
            <button className="btn-primary" onClick={() => setI(i + 1)} autoFocus>
              Next
            </button>
          ) : (
            <button className="btn-primary" onClick={finish} autoFocus>
              Start using the ledger
            </button>
          )}
          <button className="btn ml-auto" onClick={finish}>
            Skip tour
          </button>
        </div>
      </div>
    </div>
  );
}
