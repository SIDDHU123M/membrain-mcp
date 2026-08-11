# Connecting agents to Membrain

Every agent connects to the same store — a memory saved by one is instantly readable by all of them and visible in the web UI. Two transports:

- **Streamable HTTP** — `http://127.0.0.1:7777/mcp`. One running server, any number of clients. Use this whenever the client supports it.
- **stdio** — the client spawns `membrain --stdio` itself. For clients that only speak stdio (classic Claude Desktop config). Point it at the same `--data` dir so it shares the DB.

The server must be running for HTTP clients: `npm start` (or `npx membrain-mcp` once published).

## Claude Code

```bash
claude mcp add --transport http membrain http://127.0.0.1:7777/mcp
```

Or in `.mcp.json` (project) / `~/.claude.json` (global):

```json
{
  "mcpServers": {
    "membrain": { "type": "http", "url": "http://127.0.0.1:7777/mcp" }
  }
}
```

## Claude Desktop

`claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "membrain": {
      "command": "node",
      "args": [
        "C:\\path\\to\\Mem-Brain\\dist\\server\\index.js",
        "--stdio",
        "--data", "C:\\path\\to\\Mem-Brain\\data"
      ]
    }
  }
}
```

`--data` must point at the same folder the HTTP server uses — that's what makes the memory shared.

## Cursor

`.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "membrain": { "url": "http://127.0.0.1:7777/mcp" }
  }
}
```

## Any other MCP client

Anything that speaks Streamable HTTP: URL `http://127.0.0.1:7777/mcp`, no headers, no auth. Anything stdio-only: command `node <repo>/dist/server/index.js --stdio --data <repo>/data`.

## Scripts (no MCP needed)

The REST API is the same code path:

```bash
curl -X POST http://127.0.0.1:7777/api/memories -H "content-type: application/json" \
  -d '{"content":"deploy uses the blue pipeline","tags":["ops"]}'
curl "http://127.0.0.1:7777/api/memories?query=deploy"
```

## Install the membrain skill (recommended)

Tool descriptions alone make agents use memory *when asked*. The skill makes them use it *unprompted* — search before answering about you, save durable facts as they appear.

The skill ships in this repo at `skills/membrain/SKILL.md`. Install it into your skill roots (both are managed in the web UI → Skills tab):

- Claude Code: copy to `~/.claude/skills/membrain/SKILL.md`
- Global agent skills: copy to `~/.agents/skills/membrain/SKILL.md`

Or create it from the UI: Skills tab → create `membrain` → paste the file.

## Verify the loop

1. In Claude Desktop/Code, say: *"remember that my favorite editor is neovim"* → agent calls `save_memory`.
2. Open http://127.0.0.1:7777 — the memory is there, tagged with the agent as its source.
3. In a different agent, ask: *"what's my favorite editor?"* → `search_memory` answers from the shared store.

## Security

No auth exists anywhere. Keep the bind on `127.0.0.1` (default). Anything that can reach the port can read and write your memory and your skill files. Non-localhost binds require `--host <ip> --i-understand-no-auth` and a network you trust end-to-end (Tailscale/WireGuard).
