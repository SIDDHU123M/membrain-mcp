import { useState } from 'react';
import { Markdown } from './markdown.js';
import connectAgentsMd from '../../docs/connect-agents.md?raw';
import skillMd from '../../skills/membrain/SKILL.md?raw';

const QUICKSTART = `
## Install

Global install is the default. It gives you the \`membrain\` command everywhere:

\`\`\`
npm install -g membrain-mcp
\`\`\`

Prefer not to install globally? One-shot from any folder: \`npx membrain-mcp\`.

## Going live

Type one word:

\`\`\`
membrain
\`\`\`

That single command brings everything up at once:

- The **web ledger** starts at \`http://127.0.0.1:7777\` and opens in your browser by itself
  (\`--no-open\` if you don't want that).
- The **MCP server** is live at \`http://127.0.0.1:7777/mcp\` from that same moment. Nothing else
  to start; agents can connect immediately.
- The **REST API** is up at \`http://127.0.0.1:7777/api/memories\` for scripts.

Keep the terminal open — that process *is* the server. \`Ctrl+C\` stops it; your memories stay in
\`data/memory.db\` and everything is exactly where you left it on the next \`membrain\`.

The first run downloads a small local embedding model (about 80 MB) into \`./data\`; after that
everything works offline. The data directory is wherever you ran the command, so run it from the
same folder each time, or pin one forever with \`membrain --data C:/memory\`.

## Command

\`\`\`
membrain [options]

  --port <n>            port, default 7777
  --data <dir>          data directory, default ./data
  --no-open             don't open the browser on start
  --stdio               run as an MCP stdio server
  --readonly-skills     block writes to agent skill files
  --host <ip>           bind non-localhost; requires --i-understand-no-auth
\`\`\`

The whole store is \`data/memory.db\`. Copy it and that's a backup. Delete it and it's gone.

## Where things live

- **Memories** is the ledger itself: search, record, import, organize.
- **Map** draws what the store knows as a constellation.
- **Skills** edits the SKILL.md files your agents follow.
- **Agent Import** pulls memory your agents already keep on disk.
- **Settings** holds the AI provider, embeddings, paths, and backups.
`;

const TOOLS = `
## The contract

| Tool | Does |
| --- | --- |
| \`memory_context(query?, top_k?)\` | one-call digest of what's known, for session starts |
| \`save_memory(content, tags?)\` | store a durable fact |
| \`save_memories(memories[])\` | store several facts in one call |
| \`search_memory(query, top_k?, tags?)\` | hybrid semantic + keyword search, recency-boosted |
| \`get_memory(id)\` | fetch one memory in full |
| \`update_memory(id, content?, tags?)\` | edit a memory |
| \`delete_memory(id)\` | remove a memory |
| \`list_memories(limit?, tag?)\` | recent memories |

## How agents should use it

- Call \`memory_context\` once at the start of a session or task. It returns the most relevant
  entries for the topic, or the most recent ones, in a single round trip.
- Search before answering anything that depends on who the user is or what happened before.
- Save durable facts as they appear: preferences, decisions, constraints. One self-contained
  fact per entry, understandable without context.
- Several facts from one conversation belong in one \`save_memories\` call.
- Every entry records its writer. Yours are stamped with your client name.

## REST, for scripts

The same operations exist at \`/api/memories\` with no MCP required:

\`\`\`
curl -X POST http://127.0.0.1:7777/api/memories \\
  -H "content-type: application/json" \\
  -d '{"content":"deploy uses the blue pipeline","tags":["ops"]}'

curl "http://127.0.0.1:7777/api/memories?query=deploy"
\`\`\`
`;

const SKILL_INTRO = `
Tool descriptions make agents use memory when asked. The skill makes them use it unprompted:
recall at session start, save durable facts as they appear, search before answering questions
about you.

Download it and drop the folder into your skill root, or create it from the Skills tab. Standard
locations: \`~/.claude/skills/membrain/SKILL.md\` for Claude Code, \`~/.agents/skills/membrain/SKILL.md\`
for other agents.
`;

const SECTIONS = ['Quickstart', 'Connect agents', 'MCP usage', 'The skill'] as const;
type Section = (typeof SECTIONS)[number];

export default function Docs() {
  const [section, setSection] = useState<Section>('Quickstart');

  const downloadSkill = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([skillMd], { type: 'text/markdown' }));
    a.download = 'SKILL.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-5">
      <section className="rise">
        <div className="rule-double" aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
          <div className="min-w-0 flex-1">
            <span className="label">The manual</span>
            <p className="display mt-0.5 text-[13.5px] italic text-[var(--text-2)]">
              How to run Membrain, connect your agents, and make them remember unprompted.
            </p>
          </div>
          {section === 'The skill' && (
            <button className="btn-primary shrink-0" onClick={downloadSkill}>
              Download SKILL.md
            </button>
          )}
        </div>
        <div className="border-b border-[var(--line-strong)]" aria-hidden="true" />
      </section>

      <div className="seg rise" role="group" aria-label="Documentation section">
        {SECTIONS.map((s) => (
          <button key={s} onClick={() => setSection(s)} aria-pressed={section === s} className={section === s ? 'seg-on' : ''}>
            {s}
          </button>
        ))}
      </div>

      <div className="card rise max-w-3xl px-6 py-5">
        {section === 'Quickstart' && <Markdown text={QUICKSTART} />}
        {section === 'Connect agents' && <Markdown text={connectAgentsMd} />}
        {section === 'MCP usage' && <Markdown text={TOOLS} />}
        {section === 'The skill' && (
          <>
            <Markdown text={SKILL_INTRO} />
            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <span className="label">The skill, in full</span>
              <div className="mt-2 rounded border border-[var(--line)] bg-[var(--inset)] px-4 py-3">
                <Markdown text={skillMd} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
