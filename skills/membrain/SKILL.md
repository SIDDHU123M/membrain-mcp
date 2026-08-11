---
name: membrain
description: Shared long-term memory over MCP. Call memory_context once at the start of any session/task to load what is already known; use search_memory before answering questions about the user or their projects; save durable facts, preferences, and decisions with save_memory / save_memories. All agents and the user share the same store.
---

# Membrain — shared memory

Membrain is the user's self-hosted memory server. Every agent connected to it reads and writes the **same** store — memory another agent saved yesterday is yours to use today. The user sees and edits everything in a web UI, so write memories you'd be happy to have inspected.

## When to search (do this unprompted)

At the **start of any session or task**, call `memory_context(query?)` once — it returns a compact digest of what is already known about the topic (or the most recent memories), cheaper than several searches.

Then call `search_memory` before answering, whenever the answer could depend on who the user is or what happened before:

- Any question about the user, their preferences, projects, or setup.
- Starting a task in a domain you've likely touched before ("continue the site", "fix the app").
- Before asking the user a question — the answer may already be stored.

`search_memory(query, top_k=5, tags?)` is hybrid semantic + keyword with a mild recency boost; plain natural language queries work. Results carry `source` — who wrote it (`ui` = the user, `mcp:<client>` = an agent, `import` = a document). Truncated result? `get_memory(id)` fetches the full entry.

## When to save (do this unprompted)

Call `save_memory` when the user states something durable:

- Stable facts: role, stack, environment, people, constraints.
- Preferences: style, tooling, workflow, things they told you to stop doing.
- Decisions: chosen approaches, rejected options and why, agreed conventions.

Do **not** save: transient task state, secrets/credentials, anything the user asked to keep out, or facts already stored (search first — update instead of duplicating).

## Writing good memories

- One self-contained fact per memory, 1–2 sentences, understandable with zero context.
- Bad: "he prefers the second option". Good: "For the DevLune site, prefers flat per-page pricing over percentage multipliers."
- Add 1–3 lowercase tags for the domain (`preferences`, `project-x`, `stack`).

## Hygiene

- Contradiction between stored memory and what the user just said → the user is right: `update_memory` or `delete_memory`, then confirm.
- `list_memories(limit, tag?)` to review recent entries when consolidating.

## Saving several facts

A conversation that yields multiple durable facts → one `save_memories([{content, tags?}, …])` call instead of repeated `save_memory`.

## Tools

```
save_memory(content, tags?)            → { id }
save_memories(memories[])              → { ids }        bulk
search_memory(query, top_k=5, tags?)   → [ { id, content, score, tags, source, created_at } ]
get_memory(id)                         → full memory
update_memory(id, content?, tags?)     → { ok }
delete_memory(id)                      → { ok }
list_memories(limit=20, tag?)          → recent memories
memory_context(query?, top_k=8)        → session-start digest
```

If a save returns `{ staged: true }`, the ledger is set to review agent writes — the memory appears after the user approves it in the web UI. Treat it as saved; do not retry.
