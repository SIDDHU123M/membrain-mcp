<div align="center">

<img src="https://raw.githubusercontent.com/SIDDHU123M/membrain-mcp/master/assets/membrain-logo.png" alt="Membrain" width="300" />

# Membrain

**One memory, every AI.**

*A self-hosted memory ledger you run on your own machine. Your agents share it over MCP.*

[![npm](https://img.shields.io/npm/v/membrain-mcp?style=flat-square&color=1c1917&label=npm)](https://www.npmjs.com/package/membrain-mcp)
[![node](https://img.shields.io/badge/node-%E2%89%A520-1c1917?style=flat-square)](package.json)
[![MCP](https://img.shields.io/badge/protocol-MCP-1c1917?style=flat-square)](https://modelcontextprotocol.io)
[![DevLune](https://img.shields.io/badge/built%20by-DevLune-1c1917?style=flat-square)](https://devlune.in)

</div>

---

You write to the ledger from a paper-and-ink web UI. Your agents write to it over MCP: Claude Code,
Claude Desktop, Cursor, anything that speaks the protocol. What one remembers, all of them know.

Everything lives in **one SQLite file** on your disk. No accounts, no cloud, no telemetry. Works
fully offline.

Don't want to run anything? The same ledger exists as a **free hosted version** at
[membrain.devlune.in](https://membrain.devlune.in/login) — see
[Hosted or self-hosted](#hosted-or-self-hosted) below.

## Install

Global install is the default — it gives you the `membrain` command everywhere:

```bash
npm install -g membrain-mcp
membrain
```

That one word brings everything up at once: the web ledger starts on `http://127.0.0.1:7777` and
opens in your browser, the MCP server is live at `/mcp` from the same moment, and the REST API is
up at `/api/memories`. Keep the terminal open — that process is the server; `Ctrl+C` stops it and
your memories stay in `data/memory.db`.

The first run downloads a small local embedding model (about 80 MB) into `./data`; after that
everything works offline.

Prefer not to install globally? One-shot from any folder:

```bash
npx membrain-mcp
```

## Hosted or self-hosted

Same ledger, same web UI, same eight MCP tools — the difference is whose machine it runs on.
Exports are interchangeable: a cloud JSON export imports straight into a self-hosted ledger, and
vice versa.

|  | Self-hosted (the flagship) | Hosted — [membrain.devlune.in](https://membrain.devlune.in/login) |
|---|---|---|
| Setup | `npm i -g membrain-mcp`, run `membrain` | Sign in — email, GitHub, or Google |
| Where data lives | One SQLite file on your disk | Cloudflare D1, encrypted at rest |
| Offline | Fully | No — it's a website |
| Search | Local embeddings + FTS5, hybrid RRF | Workers AI embeddings + FTS5, same recipe |
| The clerk (AI ops) | Local Ollama, or your own API key | Workers AI, or your own API key |
| Agents connect to | `http://127.0.0.1:7777/mcp` (localhost, no auth) | `https://membrain.devlune.in/mcp` + API key from the Integrations page |
| Privacy | Nothing ever leaves your machine | [Plain-words policy](https://membrain.devlune.in/privacy) — encrypted at rest, not zero-knowledge |
| Price | Free forever, MIT | Free |

Sealed entries, staged agent writes, and the proposal queue behave identically in both.

## How it fits together

<img src="https://raw.githubusercontent.com/SIDDHU123M/membrain-mcp/master/assets/diagram.png" alt="How Membrain fits together: your agents connect over MCP, you use the web ledger, everything lands in one SQLite file" width="820" />

## Command

```
membrain [options]

  --port <n>            port, default 7777
  --data <dir>          data directory, default ./data (holds memory.db + models)
  --no-open             don't open the browser on start
  --stdio               run as an MCP stdio server (for clients that spawn the process)
  --readonly-skills     block writes to agent skill files
  --host <ip>           bind a non-localhost interface; requires --i-understand-no-auth
```

The whole store is `data/memory.db`. Copy it and that's a backup. Delete it and it's gone.

## Connect your agents

Claude Code, one line:

```bash
claude mcp add --transport http membrain http://127.0.0.1:7777/mcp
```

Cursor (`.cursor/mcp.json`) or any Streamable HTTP client:

```json
{ "mcpServers": { "membrain": { "url": "http://127.0.0.1:7777/mcp" } } }
```

Claude Desktop (stdio, spawns its own process against the same data dir):

```json
{
  "mcpServers": {
    "membrain": {
      "command": "membrain",
      "args": ["--stdio", "--data", "/path/to/your/data"]
    }
  }
}
```

Then try it: tell one agent *"remember that my favorite editor is neovim"*, open the ledger, and
watch the entry appear stamped with that agent's name. Ask a different agent tomorrow; it knows.

### MCP tools

| Tool | Does |
|---|---|
| `memory_context(query?, top_k?)` | one-call digest of what's known, for session starts |
| `save_memory(content, tags?)` | store a durable fact |
| `save_memories(memories[])` | store several facts in one call |
| `search_memory(query, top_k?, tags?)` | hybrid semantic + keyword search, recency-boosted |
| `get_memory(id)` | fetch one memory in full |
| `update_memory(id, content?, tags?)` | edit a memory |
| `delete_memory(id)` | remove a memory |
| `list_memories(limit?, tag?)` | recent memories |

## The ledger

The web UI is a paper-and-ink ledger with a night mode. What it does:

- **Memories** — hybrid search (sqlite-vec + FTS5 with reciprocal rank fusion), ledger, card, and
  topic views, filters by tag and by writer, multi-select, right-click context menu, and a drawer
  for reading and editing each entry.
- **The clerk** — a local Ollama (or a cloud model, see below) organizes the store into topics with
  live progress, drafts titles one entry at a time, summarizes any selection, and flags duplicate
  entries so you can strike them in one click.
- **Proposal queue** — every change the AI wants to make to a live memory is staged for your
  review first. Nothing is applied silently.
- **Reviewed imports** — drop a PDF, Markdown, or text file; it's distilled into candidate entries
  you edit and selectively file. Ollama down? The raw text imports anyway.
- **Map** — an interactive constellation of the people, projects, and tools in your store.
- **Skills** — edit your agents' SKILL.md files (in `~/.claude/skills` and `~/.agents/skills`)
  with a markdown preview.
- **Agent import** — pull the memory your agents already keep on disk into the ledger, tracked by
  content hash so nothing imports twice.
- **Backups** — a snapshot on every boot (keeps five), one-click snapshot downloads, portable JSON
  export and import.
- **Settings** — all of it configurable in the UI, including the AI provider.

## The AI

By default the clerk uses a local [Ollama](https://ollama.com) if one is running. No GPU, or no
Ollama? Open Settings and paste an API key for OpenAI, Anthropic (Claude), OpenRouter, NVIDIA NIM,
or any OpenAI-compatible endpoint. There's a test button.

The AI is optional. Memory itself — saving, searching, the MCP tools — runs entirely on the local
embedding model and needs nothing.

## Security

There is no auth, by design. The default bind is `127.0.0.1` and the docs assume it stays there.
Anyone who can reach the port can read and write your memory, so never expose it on a public
interface. Binding anything else requires an explicit `--host <ip> --i-understand-no-auth`, and
should only ever point at a private network you trust (Tailscale, WireGuard).

## Docker

```bash
docker build -t membrain .
docker run -p 127.0.0.1:7777:7777 -v membrain-data:/app/data membrain
```

Keep the port binding on `127.0.0.1`. The container boundary is not an auth layer.

## Development

```bash
npm install
npm run dev        # server via tsx
npm test           # vitest, 50 tests, no network
npm run build      # dist/server + dist/ui
```

Architecture and working rules live in `CLAUDE.md`; the product spec in `docs/membrain-prd.md`;
agent connection details in `docs/connect-agents.md`.

---

<div align="center">

**Built by [DevLune](https://devlune.in)**

*Crafted in the dark. Shipped to the world.*

[devlune.in](https://devlune.in) · [@dev.lune](https://instagram.com/dev.lune) · [sidharth@devlune.in](mailto:sidharth@devlune.in)

MIT © [DevLune](https://devlune.in)

</div>
