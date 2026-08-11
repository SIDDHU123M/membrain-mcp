import { useEffect, useState } from 'react';

export interface TourStep {
  tab: string | null;
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
    title: 'Memories',
    body: 'The ledger itself. The ruled line on top recalls anything — hybrid semantic and keyword search. Record entries by hand, drop PDFs to have them distilled, and let the clerk organize, title, and summarize. Every entry is stamped with who wrote it.',
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

export default function Tour({
  onTab,
  onClose,
}: {
  onTab: (tab: string) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const step = STEPS[i];

  useEffect(() => {
    if (step.tab) onTab(step.tab);
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

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-20 pb-3 sm:px-4 sm:pt-24 sm:pb-4" role="dialog" aria-modal="true" aria-label="Tour">
      {/* light veil — the real app stays visible behind it */}
      <div className="absolute inset-0 bg-[var(--bg)]/55" onClick={finish} aria-hidden="true" />

      <div className="card relative z-10 w-full max-w-[30rem] max-h-[min(82vh,36rem)] overflow-y-auto p-4 sm:p-5 sm:mb-2">
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
