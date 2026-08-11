import { useCallback, useEffect, useState } from 'react';
import { api, type Stats } from './api.js';
import { prettyBytes } from './util.js';
import logo from './assets/membrain-logo.png';
import type { Memory } from './api.js';
import Memories from './Memories.js';
import MindMap from './MindMap.js';
import Skills from './Skills.js';
import AgentImport from './AgentImport.js';
import Docs from './Docs.js';
import Settings from './Settings.js';
import Tour, { tourPending } from './Tour.js';

const TABS = [
  { no: '01', name: 'Memories' },
  { no: '02', name: 'Map' },
  { no: '03', name: 'Skills' },
  { no: '04', name: 'Agent Import' },
  { no: '05', name: 'Docs' },
  { no: '06', name: 'Settings' },
] as const;
type Tab = (typeof TABS)[number]['name'];

export default function App() {
  const [tab, setTab] = useState<Tab>('Memories');
  const [stats, setStats] = useState<Stats | null>(null);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'light');
  const [touring, setTouring] = useState(() => tourPending());
  const [tourTab, setTourTab] = useState<string | null>(null);
  const [jumpMemory, setJumpMemory] = useState<Memory | null>(null);

  const openMemory = useCallback((m: Memory) => {
    setJumpMemory(m);
    setTab('Memories');
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.theme = theme;
  }, [theme]);

  const refreshStats = useCallback(() => {
    void api.stats().then(setStats).catch(() => {});
  }, []);
  useEffect(refreshStats, [refreshStats]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      const el = document.getElementById('recall-input');
      if (el) {
        e.preventDefault();
        setTab('Memories');
        el.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 md:grid-cols-[230px_1fr]">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {/* The index — a ledger's table of contents down the left edge. */}
      <aside className="border-[var(--line)] px-4 pb-4 pt-8 md:sticky md:top-0 md:h-screen md:border-r md:px-5 md:pt-10">
        <div className="mb-8 flex items-center gap-3">
          <img
            src={logo}
            alt=""
            className="h-11 w-11 rounded border border-[var(--line-strong)] object-cover"
          />
          <div>
            <h1 className="display text-[24px] font-semibold leading-none">Membrain</h1>
            <p className="label mt-1.5">The memory ledger</p>
          </div>
        </div>

        <nav
          className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5 md:overflow-visible"
          aria-label="Sections"
        >
          {TABS.map((t) => (
            <button
              key={t.name}
              onClick={() => setTab(t.name)}
              aria-current={tab === t.name ? 'page' : undefined}
              className={`rail-item shrink-0 md:shrink ${touring && tourTab === t.name ? 'tour-glow' : ''}`}
            >
              <span className="rail-no">{t.no}</span>
              <span>{t.name}</span>
            </button>
          ))}
        </nav>

        <div className="mt-8 hidden md:block">
          <div className="rule-double mb-3" aria-hidden="true" />
          {stats && (
            <dl className="space-y-1.5 text-[12px] text-[var(--text-2)]">
              <div className="leader">
                <dt>Entries</dt>
                <span className="leader-dots" aria-hidden="true" />
                <dd className="mono">{stats.memories}</dd>
              </div>
              <div className="leader">
                <dt>On disk</dt>
                <span className="leader-dots" aria-hidden="true" />
                <dd className="mono">{prettyBytes(stats.dbSizeBytes)}</dd>
              </div>
              {stats.embeddingModel && (
                <div className="leader">
                  <dt>Embedder</dt>
                  <span className="leader-dots" aria-hidden="true" />
                  <dd className="mono truncate max-w-[7rem]" title={stats.embeddingModel}>
                    MiniLM
                  </dd>
                </div>
              )}
            </dl>
          )}
          <button
            className="btn mt-4 w-full"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            aria-label={theme === 'light' ? 'Switch to night ledger' : 'Switch to paper'}
          >
            {theme === 'light' ? '☾ Night ledger' : '☀ Paper'}
          </button>
        </div>
      </aside>

      <main id="main" className="min-w-0 px-4 pb-24 pt-6 md:px-8 md:pt-10">
        {tab === 'Memories' && (
          <Memories
            onStatsDirty={refreshStats}
            jumpMemory={jumpMemory}
            onJumpConsumed={() => setJumpMemory(null)}
          />
        )}
        {tab === 'Map' && <MindMap onOpenMemory={openMemory} />}
        {tab === 'Skills' && <Skills />}
        {tab === 'Agent Import' && <AgentImport onImported={refreshStats} />}
        {tab === 'Docs' && <Docs />}
        {tab === 'Settings' && <Settings />}
      </main>

      {touring && (
        <Tour
          onTab={(t) => {
            setTab(t as Tab);
            setTourTab(t);
          }}
          onClose={() => {
            setTouring(false);
            setTourTab(null);
            setTab('Memories');
          }}
        />
      )}
    </div>
  );
}
