import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  saveMemory,
  updateMemory,
  deleteMemory,
  getMemory,
  listMemories,
} from '../core/memories.js';
import { searchMemories } from '../core/search.js';
import { stageSave } from '../core/insights.js';
import { getSetting } from '../core/db.js';
import type { Ctx } from './rest.js';

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

// One McpServer per session; source attribution comes from the session's clientInfo.
export function buildMcpServer(ctx: Ctx): McpServer {
  const { db, embedder } = ctx;
  const server = new McpServer({ name: 'membrain', version: '0.1.0' });

  // sealed pages never leave the ledger: not readable, updatable, or deletable
  // over MCP. (list/search/context exclude them at the query level.)
  const assertUnsealed = (id: number) => {
    if (getMemory(db, id).sealed) {
      throw new Error(`memory ${id} is sealed by the user — not accessible to agents`);
    }
  };
  const source = () => `mcp:${server.server.getClientVersion()?.name ?? 'unknown'}`;

  server.registerTool(
    'save_memory',
    {
      description:
        'Store durable facts, preferences, or decisions the user would want remembered across sessions.',
      inputSchema: {
        content: z.string().describe('The fact to remember, self-contained'),
        tags: z.array(z.string()).optional().describe('Optional tags for filtering'),
      },
    },
    async ({ content, tags }) => {
      // settings mcp_writes='staged': agent saves go to the review queue instead
      if (getSetting(db, 'mcp_writes') === 'staged') {
        const p = stageSave(db, { content, tags, source: source() });
        return text({
          staged: true,
          proposalId: p.id,
          note: 'This ledger stages agent writes — the user will review and approve it in the web UI.',
        });
      }
      const m = await saveMemory(db, embedder, { content, tags, source: source() });
      return text({ id: m.id });
    },
  );

  server.registerTool(
    'search_memory',
    {
      description:
        'Look up what is already known about the user, their projects, or past decisions before answering questions about them.',
      inputSchema: {
        query: z.string().describe('Natural language search query'),
        top_k: z.number().int().min(1).max(50).optional().describe('Max results, default 5'),
        tags: z.array(z.string()).optional().describe('Only return memories with one of these tags'),
      },
    },
    async ({ query, top_k, tags }) => {
      const results = await searchMemories(db, embedder, { query, topK: top_k ?? 5, tags });
      return text(
        results.map(({ id, content, score, tags: t, source: s, created_at }) => ({
          id,
          content,
          score,
          tags: t,
          source: s,
          created_at,
        })),
      );
    },
  );

  server.registerTool(
    'update_memory',
    {
      description: 'Update the content or tags of an existing memory by id.',
      inputSchema: {
        id: z.number().int().describe('Memory id'),
        content: z.string().optional().describe('New content'),
        tags: z.array(z.string()).optional().describe('New tags (replaces existing)'),
      },
    },
    async ({ id, content, tags }) => {
      assertUnsealed(id);
      await updateMemory(db, embedder, id, { content, tags });
      return text({ ok: true });
    },
  );

  server.registerTool(
    'delete_memory',
    {
      description: 'Delete a memory by id.',
      inputSchema: { id: z.number().int().describe('Memory id') },
    },
    async ({ id }) => {
      assertUnsealed(id);
      deleteMemory(db, id);
      return text({ ok: true });
    },
  );

  server.registerTool(
    'list_memories',
    {
      description: 'List the most recent memories, optionally filtered by tag.',
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional().describe('Max results, default 20'),
        tag: z.string().optional().describe('Only memories with this tag'),
      },
    },
    async ({ limit, tag }) => text(listMemories(db, { limit: limit ?? 20, tag })),
  );

  server.registerTool(
    'get_memory',
    {
      description: 'Fetch one memory in full by id (search results may be truncated).',
      inputSchema: { id: z.number().int().describe('Memory id') },
    },
    async ({ id }) => {
      assertUnsealed(id);
      return text(getMemory(db, id));
    },
  );

  server.registerTool(
    'save_memories',
    {
      description:
        'Store several durable facts at once — use instead of repeated save_memory calls when a conversation yields multiple things worth remembering.',
      inputSchema: {
        memories: z
          .array(
            z.object({
              content: z.string().describe('One self-contained fact'),
              tags: z.array(z.string()).optional(),
            }),
          )
          .min(1)
          .max(50)
          .describe('Facts to remember'),
      },
    },
    async ({ memories }) => {
      if (getSetting(db, 'mcp_writes') === 'staged') {
        const proposalIds = memories.map(
          (m) => stageSave(db, { ...m, source: source() }).id,
        );
        return text({
          staged: true,
          proposalIds,
          note: 'This ledger stages agent writes — the user will review and approve them in the web UI.',
        });
      }
      const ids: number[] = [];
      for (const m of memories) {
        ids.push((await saveMemory(db, embedder, { ...m, source: source() })).id);
      }
      return text({ ids });
    },
  );

  server.registerTool(
    'memory_context',
    {
      description:
        'Call once at the start of a session or task: returns a compact digest of what is already known — relevant memories for the given topic, or the most recent ones. Cheaper than multiple searches.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Topic of the current task; omit for the most recent memories'),
        top_k: z.number().int().min(1).max(30).optional().describe('Max memories, default 8'),
      },
    },
    async ({ query, top_k }) => {
      const k = top_k ?? 8;
      const rows = query?.trim()
        ? await searchMemories(db, embedder, { query, topK: k })
        : listMemories(db, { limit: k });
      const digest = rows
        .map(
          (m) =>
            `- [#${m.id} · ${m.source}${m.tags.length ? ' · ' + m.tags.join(',') : ''}] ${m.content.replace(/\s+/g, ' ').slice(0, 300)}`,
        )
        .join('\n');
      return {
        content: [
          {
            type: 'text' as const,
            text: rows.length
              ? `MEMORY CONTEXT (${rows.length} entries):\n${digest}`
              : 'MEMORY CONTEXT: store is empty for this topic.',
          },
        ],
      };
    },
  );

  return server;
}

/** Streamable HTTP at /mcp with session tracking (session id → transport). */
export function registerMcpHttp(app: FastifyInstance, ctx: Ctx): void {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const lastSeen = new Map<string, number>();

  // clients rarely send DELETE — evict sessions idle > 30 min so the map can't grow forever
  const IDLE_MS = 30 * 60 * 1000;
  setInterval(
    () => {
      const cutoff = Date.now() - IDLE_MS;
      for (const [id, seen] of lastSeen) {
        if (seen < cutoff) {
          transports.get(id)?.close();
          transports.delete(id);
          lastSeen.delete(id);
        }
      }
    },
    5 * 60 * 1000,
  ).unref();

  const handle = async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId) lastSeen.set(sessionId, Date.now());
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (req.method === 'POST' && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          },
        });
        transport.onclose = () => {
          if (transport!.sessionId) transports.delete(transport!.sessionId);
        };
        await buildMcpServer(ctx).connect(transport);
      } else {
        return reply
          .status(400)
          .send({ jsonrpc: '2.0', error: { code: -32000, message: 'no valid session' }, id: null });
      }
    }
    await transport.handleRequest(req.raw, reply.raw, req.body);
  };

  app.post('/mcp', handle);
  app.get('/mcp', handle);
  app.delete('/mcp', handle);
}

/** stdio mode for Claude Desktop's simplest config: membrain --stdio */
export async function runStdio(ctx: Ctx): Promise<void> {
  await buildMcpServer(ctx).connect(new StdioServerTransport());
}
