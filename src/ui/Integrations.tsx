// Hosted-ledger tab: mint/revoke API keys and connect agents to /mcp.
// Only rendered when /api/stats reports cloud: true.
import { useEffect, useState } from 'react';
import { api, type ApiKey } from './api.js';
import { relativeTime } from './util.js';

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

      {/* keys */}
      <div className="card mt-6 p-5">
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
      <div className="card mt-5 p-5">
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
    </div>
  );
}
