// Every writer signs the ledger in their own ink — the audit trail is the
// visual system. Deep ink set on paper, lifted set for the night ledger.
const NIGHT_PALETTE = ['#7dd3c8', '#e8a7c4', '#b8b2a6', '#c3b3e8', '#a8cc9a', '#e0bd8a'];
const PAPER_PALETTE = ['#0f766e', '#86198f', '#57534e', '#5b21b6', '#3f6212', '#9a3412'];

function isLight(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme !== 'dark';
}

export function sourceColor(source: string): string {
  const light = isLight();
  if (source === 'ui') return light ? '#1c1917' : '#ece7db';
  if (source === 'import') return light ? '#92650f' : '#d9b36a';
  let h = 0;
  for (const c of source) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (light ? PAPER_PALETTE : NIGHT_PALETTE)[h % PAPER_PALETTE.length];
}

const KIND_NIGHT: Record<string, string> = {
  person: '#7dd3c8',
  project: '#d8d2c4',
  tool: '#b8b2a6',
  preference: '#e8a7c4',
  topic: '#c3b3e8',
  fact: '#e0bd8a',
};
const KIND_PAPER: Record<string, string> = {
  person: '#0f766e',
  project: '#44403c',
  tool: '#57534e',
  preference: '#86198f',
  topic: '#5b21b6',
  fact: '#92650f',
};

export function kindColor(kind: string): string {
  return (isLight() ? KIND_PAPER : KIND_NIGHT)[kind] ?? (isLight() ? '#99948a' : '#7a756a');
}

export function sourceLabel(source: string): string {
  if (source === 'ui') return 'you';
  if (source === 'import') return 'import';
  return source.replace(/^mcp:/, '');
}

export function relativeTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
