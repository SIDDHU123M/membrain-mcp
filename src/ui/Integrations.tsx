// Hosted-ledger tab: mint/revoke API keys and connect agents to /mcp.
// Only rendered when /api/stats reports cloud: true.
import { useEffect, useState } from 'react';
import { api, type ApiKey, type AuthConfig } from './api.js';
import { relativeTime } from './util.js';
import PageTabs from './Tabs.js';

const SECTIONS = [
  { key: 'account', label: 'Account', icon: 'user' },
  { key: 'keys', label: 'API keys', icon: 'key' },
  { key: 'connect', label: 'Connect', icon: 'plug' },
  { key: 'selfhost', label: 'Self-host', icon: 'server' },
];

type Me = { email: string; name: string | null; github?: boolean; google?: boolean; password?: boolean };

function AccountCard() {
  const [me, setMe] = useState<Me | null>(null);
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [nameVal, setNameVal] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void api.me().then((m) => {
      setMe(m);
      setNameVal(m.name ?? '');
    });
    void api.authConfig().then(setCfg).catch(() => {});
  }, []);
  if (!me) return null;
  const saveName = async () => {
    await api.updateProfile(nameVal.trim());
    setMe({ ...me, name: nameVal.trim() || null });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const provider = (kind: 'github' | 'google', label: string) => {
    const linked = me[kind];
    const available = cfg?.[kind];
    return (
      <li className="flex items-center gap-3 py-2 text-[13px]">
        <span className="font-medium">{label}</span>
        {linked ? (
          <span className="ml-auto text-[12px] text-[var(--text-2)]">Linked — one-click sign-in works</span>
        ) : available ? (
          <a className="btn ml-auto px-2 py-0.5 text-[11px]" href={`/api/auth/${kind}?link=1`}>
            Link account
          </a>
        ) : (
          <span className="ml-auto text-[12px] text-[var(--text-3)]">not configured yet</span>
        )}
      </li>
    );
  };
  return (
    <div className="card mt-6 p-5">
      <h3 className="display text-[17px] font-semibold">Account</h3>
      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1">
          <label className="label mb-1 block" htmlFor="acct-name">
            Name
          </label>
          <input id="acct-name" className="input" value={nameVal} onChange={(e) => setNameVal(e.target.value)} />
        </div>
        <button className="btn shrink-0" onClick={() => void saveName()} disabled={(me.name ?? '') === nameVal.trim()}>
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
      <p className="mt-2 text-[12px] text-[var(--text-2)]">
        Signed in as <span className="mono">{me.email}</span>
        {me.password === false && ' · no password set — you sign in with a linked account'}
      </p>
      <ul className="mt-3 divide-y divide-[var(--line)] border-t border-[var(--line)]">
        {provider('github', 'GitHub')}
        {provider('google', 'Google')}
      </ul>
    </div>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{label}</span>
        <button
          className="btn px-2 py-0.5 text-[11px]"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="mono overflow-x-auto rounded border border-[var(--line)] bg-[var(--accent-soft)] p-3 text-[12px] leading-5">
        {text}
      </pre>
    </div>
  );
}

export default function Integrations() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sec, setSec] = useState('account');

  const load = () => {
    void api
      .keys()
      .then(setKeys)
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const k = await api.createKey(name.trim());
      setFresh({ name: k.name, key: k.key });
      setName('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    }
    setBusy(false);
  };

  const revoke = async (id: number) => {
    setError(null);
    try {
      await api.revokeKey(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    }
  };

  const origin = window.location.origin;
  const K = fresh?.key ?? 'mb_YOUR_KEY_HERE';

  return (
    <div className="max-w-3xl">
      <h2 className="display text-[24px] font-semibold">Integrations</h2>
      <p className="mt-1 text-[13px] text-[var(--text-2)]">
        Agents reach this ledger over MCP at <span className="mono">{origin}/mcp</span>, carrying an
        API key. Every key is a named door — revoke one and only that agent loses access.
      </p>

      <div className="mt-5">
        <PageTabs tabs={SECTIONS} active={sec} onSelect={setSec} />
      </div>

      <div className={sec === 'account' ? '' : 'hidden'}>
        <AccountCard />
      </div>

      {/* keys */}
      <div className={`card mt-5 p-5 ${sec === 'keys' ? '' : 'hidden'}`}>
        <h3 className="display text-[17px] font-semibold">API keys</h3>
        <div className="mt-3 flex gap-2">
          <input
            className="input flex-1"
            placeholder='Name the agent — "claude-code laptop", "cursor work"…'
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
          <button className="btn-primary shrink-0" disabled={busy || !name.trim()} onClick={() => void create()}>
            Mint key
          </button>
        </div>

        {fresh && (
          <div className="notice mt-4 text-[13px]">
            <p>
              Key for <strong>{fresh.name}</strong> — shown once, store it now:
            </p>
            <CopyBlock label="API key" text={fresh.key} />
          </div>
        )}
        {error && <p className="notice mt-3 text-[13px]">{error}</p>}

        {keys.length > 0 && (
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="font-medium">{k.name}</span>
                <span className="mono text-[var(--text-2)]">{k.prefix}…</span>
                <span className="ml-auto text-[12px] text-[var(--text-2)]">
                  {k.last_used_at ? `used ${relativeTime(k.last_used_at)}` : 'never used'}
                </span>
                <button className="btn px-2 py-0.5 text-[11px]" onClick={() => void revoke(k.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        {!keys.length && !fresh && (
          <p className="mt-3 text-[13px] text-[var(--text-2)]">No keys yet — mint one to connect an agent.</p>
        )}
      </div>

      {/* connect */}
      <div className={`card mt-5 p-5 ${sec === 'connect' ? '' : 'hidden'}`}>
        <h3 className="display text-[17px] font-semibold">Connect an agent</h3>
        <p className="mt-1 text-[13px] text-[var(--text-2)]">
          {fresh
            ? 'Commands below carry your new key — paste and go.'
            : 'Mint a key above, then swap it into the commands below.'}
        </p>

        <CopyBlock
          label="Claude Code (one command)"
          text={`claude mcp add membrain --transport http ${origin}/mcp --header "Authorization: Bearer ${K}"`}
        />
        <CopyBlock
          label="Cursor / any JSON-config client (.cursor/mcp.json)"
          text={JSON.stringify(
            { mcpServers: { membrain: { url: `${origin}/mcp`, headers: { Authorization: `Bearer ${K}` } } } },
            null,
            2,
          )}
        />
        <CopyBlock
          label="Claude Desktop (claude_desktop_config.json — via mcp-remote)"
          text={JSON.stringify(
            {
              mcpServers: {
                membrain: {
                  command: 'npx',
                  args: ['-y', 'mcp-remote', `${origin}/mcp`, '--header', `Authorization: Bearer ${K}`],
                },
              },
            },
            null,
            2,
          )}
        />
        <CopyBlock
          label="Plain REST (same key works on /api/*)"
          text={`curl -H "Authorization: Bearer ${K}" "${origin}/api/memories?query=what%20do%20you%20know"`}
        />

        <p className="mt-4 text-[12px] leading-5 text-[var(--text-2)]">
          Once connected, agents get the same tools as against a self-hosted ledger:
          save_memory, search_memory, memory_context and friends. Sealed entries stay invisible to
          them, and if you set agent writes to “staged” in Settings, saves wait for your approval.
        </p>
      </div>

      {/* what stays on your own machine */}
      <div className={`card mt-5 p-5 ${sec === 'selfhost' ? '' : 'hidden'}`}>
        <h3 className="display text-[17px] font-semibold">Want the rest? Self-host it</h3>
        <p className="mt-1 text-[13px] leading-5 text-[var(--text-2)]">
          The cloud ledger is memories only — on purpose. These live in the self-hosted version,
          where your files and your machine are available:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-[var(--text-2)]">
          <li>Skills — create and edit your agents' SKILL.md files on disk</li>
          <li>Agent memory import — discover and pull in memory your agents already keep locally</li>
          <li>One-click SQLite snapshots and a git-friendly markdown-folder export</li>
          <li>Fully offline recall and a local Ollama clerk — nothing ever leaves your machine</li>
        </ul>
        <CopyBlock label="Install (Node 20+)" text={'npm i -g membrain-mcp\nmembrain'} />
        <p className="mt-3 text-[12px] leading-5 text-[var(--text-2)]">
          Your cloud export (Settings → Export memories JSON) imports straight into it —{' '}
          <a className="underline" href="https://github.com/SIDDHU123M/membrain-mcp">
            source and docs on GitHub
          </a>
          .
        </p>
      </div>
    </div>
  );
}
