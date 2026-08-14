// Local-only tab: what the hosted ledger is, how it compares, one button to try it.
// (The hosted app itself never shows this — its Integrations page plays the mirror role.)

const ROWS: [string, string, string][] = [
  ['Setup', 'npm i -g membrain-mcp, run membrain', 'Sign in — email, GitHub, or Google'],
  ['Where data lives', 'One SQLite file on your disk', 'Cloudflare D1, encrypted at rest'],
  ['Offline', 'Fully — embeddings and clerk run locally', 'No — it’s a website'],
  ['Search', 'Local embeddings + FTS5, hybrid RRF', 'Workers AI embeddings + FTS5, same recipe'],
  ['The clerk', 'Local Ollama, or your own API key', 'Workers AI, or your own API key'],
  ['Agents connect to', 'http://127.0.0.1:7777/mcp — localhost, no auth', 'https://membrain.devlune.in/mcp + API key'],
  ['Skills & agent import', 'Yes — they need your files and disk', 'No — memories only, by design'],
  ['Privacy', 'Nothing ever leaves your machine', 'Encrypted at rest, honestly not zero-knowledge'],
  ['Price', 'Free forever, MIT', 'Free'],
];

export default function Cloud() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <h2 className="display text-[24px] font-semibold">The ledger, hosted</h2>
      <p className="mt-2 text-[14px] leading-6 text-[var(--text-2)]">
        This same ledger runs as a free hosted service at membrain.devlune.in — for machines where
        you can't keep a process running, or people you'd rather just send a link. Same UI, same
        eight MCP tools, same sealed-entry and staged-write rules. Exports are interchangeable:
        JSON from here imports there, and back.
      </p>

      <div className="card mt-5 overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--line-strong)] text-left">
              <th className="p-3 font-normal" />
              <th className="label p-3">Self-hosted (this one)</th>
              <th className="label p-3">Hosted</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([k, a, b]) => (
              <tr key={k} className="border-b border-[var(--line)] align-top last:border-b-0">
                <td className="label whitespace-nowrap p-3">{k}</td>
                <td className="p-3">{a}</td>
                <td className="p-3 text-[var(--text-2)]">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <a
          className="btn-primary"
          href="https://membrain.devlune.in/login#signup"
          target="_blank"
          rel="noreferrer"
        >
          Try the cloud ledger →
        </a>
        <a className="btn" href="https://membrain.devlune.in" target="_blank" rel="noreferrer">
          membrain.devlune.in
        </a>
      </div>
      <p className="mt-3 text-[12px] text-[var(--text-2)]">
        This local ledger stays the flagship — the cloud is the zero-setup sibling, not a replacement.
      </p>
    </div>
  );
}
