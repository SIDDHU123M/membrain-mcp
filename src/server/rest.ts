import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  EDITABLE_SETTINGS,
  getEditableSettings,
  getSetting,
  setSetting,
  type DB,
} from '../core/db.js';
import type { Embedder } from '../core/embeddings.js';
import {
  saveMemory,
  getMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  listStale,
  stats,
  ValidationError,
  NotFoundError,
} from '../core/memories.js';
import { searchMemories } from '../core/search.js';
import { commitImport, importFile, previewImport } from '../core/importer.js';
import {
  listSkills,
  getSkill,
  saveSkill,
  deleteSkill,
  exportSkills,
  importSkillsJson,
} from '../core/skills.js';
import { backupDbFile, exportMarkdownFolder, exportMemories, importMemoriesJson } from '../core/backup.js';
import { bus, type MemoryEvent } from '../core/events.js';
import { findDuplicates } from '../core/dedupe.js';
import fs from 'node:fs';
import path from 'node:path';
import { discoverAgentMemory, importAgentMemory } from '../core/agentmemory.js';
import {
  buildMemoryMap,
  buildMindMap,
  getCachedMap,
  getCachedMindMap,
  listSummaries,
  getProposals,
  proposeTitles,
  resolveProposals,
  summarizeMemories,
} from '../core/insights.js';
import { OllamaError, llmConfig, ollamaGenerate } from '../core/ollama.js';

export interface Ctx {
  db: DB;
  embedder: Embedder;
  dbFile: string;
  readonlySkills?: boolean;
  version?: string;
}

// Stale binaries caused every "feature not showing" report — so the app tells
// on itself. One metadata GET to the npm registry (package name only, nothing
// else sent), cached 6h, disable with settings update_check='off'.
let latestCache: { value: string | null; at: number } = { value: null, at: 0 };
export async function checkLatestVersion(db: DB): Promise<string | null> {
  if (getSetting(db, 'update_check') === 'off') return null;
  if (Date.now() - latestCache.at < 6 * 3600_000) return latestCache.value;
  try {
    const res = await fetch('https://registry.npmjs.org/membrain-mcp/latest', {
      signal: AbortSignal.timeout(3000),
    });
    const j = (await res.json()) as { version?: string };
    latestCache = { value: typeof j.version === 'string' ? j.version : null, at: Date.now() };
  } catch {
    latestCache = { value: null, at: Date.now() };
  }
  return latestCache.value;
}

// Routes stay thin: parse request → call core → shape response. Logic lives in core/.
export function registerRest(app: FastifyInstance, ctx: Ctx): void {
  const { db, embedder, dbFile } = ctx;

  const guardSkills = () => {
    if (ctx.readonlySkills) {
      throw new ValidationError('skills are read-only on this server (--readonly-skills)');
    }
  };

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof ValidationError) return reply.status(400).send({ error: err.message });
    if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
    if (err instanceof OllamaError) {
      console.error(`[ai] ${err.message}`);
      return reply.status(503).send({ error: err.message });
    }
    if (typeof err.statusCode === 'number' && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    console.error('[error]', err);
    return reply.status(500).send({ error: 'internal error' });
  });

  app.get<{ Querystring: { query?: string; tag?: string; limit?: string; archived?: string } }>(
    '/api/memories',
    async (req) => {
      const { query, tag, limit, archived } = req.query;
      // the web UI is the one place sealed pages are visible
      if (query && query.trim()) {
        return searchMemories(db, embedder, {
          query,
          topK: limit ? Number(limit) : 20,
          tags: tag ? [tag] : undefined,
          includeSealed: true,
        });
      }
      return listMemories(db, {
        limit: limit ? Number(limit) : undefined,
        tag,
        archived: archived === '1',
        includeSealed: true,
      });
    },
  );

  app.get<{ Querystring: { days?: string; limit?: string } }>('/api/memories/stale', async (req) => {
    return listStale(db, {
      days: req.query.days ? Number(req.query.days) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
  });

  app.post<{ Body: { content: string; tags?: string[] } }>('/api/memories', async (req, reply) => {
    const m = await saveMemory(db, embedder, {
      content: req.body?.content,
      tags: req.body?.tags,
      source: 'ui',
    } as { content: string; tags?: string[]; source: string });
    return reply.status(201).send(m);
  });

  app.get<{ Params: { id: string } }>('/api/memories/:id', async (req) =>
    getMemory(db, Number(req.params.id)),
  );

  app.patch<{
    Params: { id: string };
    Body: { content?: string; tags?: string[]; pinned?: boolean; archived?: boolean; sealed?: boolean };
  }>('/api/memories/:id', async (req) => updateMemory(db, embedder, Number(req.params.id), req.body ?? {}));

  app.delete<{ Params: { id: string } }>('/api/memories/:id', async (req) => {
    deleteMemory(db, Number(req.params.id));
    return { ok: true };
  });

  app.post('/api/import', async (req) => {
    const file = await req.file();
    if (!file) throw new ValidationError('multipart file field required');
    const buffer = await file.toBuffer();
    return importFile(db, embedder, { filename: file.filename, buffer });
  });

  // preview/commit halves of the reviewed import flow (UI)
  app.post('/api/import/preview', async (req) => {
    const file = await req.file();
    if (!file) throw new ValidationError('multipart file field required');
    const buffer = await file.toBuffer();
    return previewImport(db, { filename: file.filename, buffer });
  });

  app.post<{ Body: { facts: { content: string; tags?: string[] }[] } }>(
    '/api/import/commit',
    async (req) => {
      const memories = await commitImport(db, embedder, req.body?.facts ?? []);
      return { imported: memories.length, memories };
    },
  );

  app.get('/api/stats', async () => ({
    ...stats(db, dbFile),
    version: ctx.version ?? null,
    latest: await checkLatestVersion(db),
  }));

  // the version catalogue: published releases from the registry (cached 6h,
  // same privacy contract as the update check — package name only)
  let versionsCache: { value: { version: string; at: string }[]; at: number } = { value: [], at: 0 };
  app.get('/api/versions', async () => {
    if (getSetting(db, 'update_check') === 'off') return { versions: [], checksOff: true };
    if (Date.now() - versionsCache.at < 6 * 3600_000) return { versions: versionsCache.value };
    try {
      const res = await fetch('https://registry.npmjs.org/membrain-mcp', {
        signal: AbortSignal.timeout(4000),
      });
      const j = (await res.json()) as { time?: Record<string, string> };
      const versions = Object.entries(j.time ?? {})
        .filter(([k]) => /^\d+\.\d+\.\d+$/.test(k))
        .map(([version, at]) => ({ version, at }))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 30);
      versionsCache = { value: versions, at: Date.now() };
    } catch {
      versionsCache = { value: versionsCache.value, at: Date.now() };
    }
    return { versions: versionsCache.value };
  });

  // ---- skills management (files on disk, not memory DB) ----

  app.get('/api/skills', async () => listSkills(db));

  app.get<{ Params: { root: string; name: string } }>('/api/skills/:root/:name', async (req) =>
    getSkill(db, req.params.root, req.params.name),
  );

  app.put<{ Params: { root: string; name: string }; Body: { content: string } }>(
    '/api/skills/:root/:name',
    async (req) => {
      guardSkills();
      return saveSkill(db, req.params.root, req.params.name, req.body?.content ?? '');
    },
  );

  app.delete<{ Params: { root: string; name: string } }>(
    '/api/skills/:root/:name',
    async (req) => {
      guardSkills();
      deleteSkill(db, req.params.root, req.params.name);
      return { ok: true };
    },
  );

  // ---- backup / export / import ----

  app.get('/api/backup', async (_req, reply) => {
    const file = await backupDbFile(db, path.dirname(dbFile));
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${path.basename(file)}"`)
      .send(fs.createReadStream(file));
  });

  app.get<{ Querystring: { ids?: string } }>('/api/export/memories', async (req, reply) => {
    const ids = req.query.ids
      ?.split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n));
    return reply
      .header('content-disposition', 'attachment; filename="membrain-memories.json"')
      .send(exportMemories(db, ids?.length ? ids : undefined));
  });

  app.post<{ Body: { dir?: string } }>('/api/export/markdown', async (req) => {
    const dir = path.resolve(
      typeof req.body?.dir === 'string' && req.body.dir.trim()
        ? req.body.dir.trim()
        : path.join(path.dirname(dbFile), 'export-md'),
    );
    return exportMarkdownFolder(db, dir);
  });

  app.post('/api/import/memories', async (req) => {
    const memories = await importMemoriesJson(db, embedder, req.body);
    return { imported: memories.length };
  });

  app.get('/api/export/skills', async (_req, reply) =>
    reply
      .header('content-disposition', 'attachment; filename="membrain-skills.json"')
      .send(exportSkills(db)),
  );

  app.post('/api/import/skills', async (req) => ({ imported: importSkillsJson(db, req.body) }));

  // ---- LLM insights: memory map + summaries (local Ollama) ----

  app.get('/api/insights/map', async () => ({ map: getCachedMap(db) }));

  app.post('/api/insights/map', async () => buildMemoryMap(db));

  // SSE streams: build with live progress. EventSource-compatible (GET).
  const sseStart = (reply: FastifyReply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    return {
      send: (event: string, data: unknown) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      end: () => res.end(),
    };
  };

  // the wire: every write from any writer (UI, REST, MCP, import) streams here
  app.get('/api/events', (req, reply) => {
    const s = sseStart(reply);
    const onEvent = (e: MemoryEvent) => s.send('memory', e);
    bus.on('memory', onEvent);
    const beat = setInterval(() => reply.raw.write(':hb\n\n'), 25000);
    req.raw.on('close', () => {
      clearInterval(beat);
      bus.off('memory', onEvent);
    });
  });

  app.get<{ Querystring: { mode?: string; ids?: string } }>('/api/insights/map/stream', async (req, reply) => {
    const s = sseStart(reply);
    const ids = req.query.ids?.split(',').map(Number).filter(Number.isInteger);
    try {
      const map = await buildMemoryMap(db, (p) => s.send('progress', p), {
        onlyNew: req.query.mode === 'update',
        ids: ids?.length ? ids : undefined,
      });
      s.send('done', map);
    } catch (err) {
      console.error(`[ai] organize failed: ${(err as Error).message}`);
      s.send('error', { error: (err as Error).message });
    }
    s.end();
  });

  app.get<{ Querystring: { ids?: string } }>('/api/insights/titles/stream', async (req, reply) => {
    const s = sseStart(reply);
    const ids = req.query.ids?.split(',').map(Number).filter(Number.isInteger);
    try {
      const proposed = await proposeTitles(db, (p) => s.send('progress', p), ids?.length ? ids : undefined);
      s.send('done', { proposed });
    } catch (err) {
      console.error(`[ai] titles failed: ${(err as Error).message}`);
      s.send('error', { error: (err as Error).message });
    }
    s.end();
  });

  app.get<{ Querystring: { threshold?: string } }>('/api/insights/duplicates', async (req) => {
    const t = req.query.threshold ? Number(req.query.threshold) : 0.9;
    return { pairs: findDuplicates(db, Math.min(0.99, Math.max(0.7, t))) };
  });

  app.get('/api/insights/mindmap', async () => ({ map: getCachedMindMap(db) }));

  app.post('/api/insights/mindmap', async () => buildMindMap(db));

  app.post<{ Body: { ids?: number[] } }>('/api/insights/titles', async (req) => {
    const ids = req.body?.ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((i) => typeof i !== 'number'))) {
      throw new ValidationError('ids must be an array of numbers');
    }
    return { proposed: await proposeTitles(db, undefined, ids) };
  });

  app.get('/api/proposals', async () => getProposals(db));

  app.post<{ Body: { ids: string[]; accept: boolean } }>('/api/proposals/resolve', async (req) => {
    const { ids, accept } = req.body ?? {};
    if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) {
      throw new ValidationError('ids must be an array of strings');
    }
    return resolveProposals(db, embedder, ids, accept === true);
  });

  app.get('/api/insights/summaries', async () => ({ summaries: listSummaries(db) }));

  app.post<{ Body: { ids?: number[]; label?: string } }>('/api/insights/summary', async (req) => {
    const ids = req.body?.ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((i) => typeof i !== 'number'))) {
      throw new ValidationError('ids must be an array of numbers');
    }
    const label =
      typeof req.body?.label === 'string' && req.body.label.trim()
        ? req.body.label.trim().slice(0, 60)
        : 'all entries';
    return { summary: await summarizeMemories(db, ids && ids.length > 0 ? ids : undefined, label) };
  });

  // which brain is on duty — shown while the clerk works (no generation, cheap)
  app.get('/api/llm/info', async () => {
    const cfg = await llmConfig(db);
    return { llm: cfg ? { provider: cfg.kind, model: cfg.model } : null };
  });

  // quick "does the configured brain answer" probe for the Settings tab
  app.post('/api/llm/test', async () => {
    const cfg = await llmConfig(db);
    if (!cfg) {
      throw new OllamaError(
        'No AI configured — start Ollama, or set a provider, API key, and model in Settings',
      );
    }
    const out = await ollamaGenerate(cfg, 'Reply with the single word: ok', {
      timeoutMs: 30_000,
      numCtx: 2048,
    });
    return { ok: true, provider: cfg.kind, model: cfg.model, reply: out.slice(0, 40) };
  });

  // ---- settings (allowlisted keys only) ----

  app.get('/api/settings', async () => getEditableSettings(db));

  app.put<{ Body: Record<string, string> }>('/api/settings', async (req) => {
    const body = req.body ?? {};
    for (const [key, value] of Object.entries(body)) {
      if (!(EDITABLE_SETTINGS as readonly string[]).includes(key)) {
        throw new ValidationError(`unknown setting "${key}"`);
      }
      if (typeof value !== 'string') throw new ValidationError(`setting "${key}" must be a string`);
    }
    for (const [key, value] of Object.entries(body)) setSetting(db, key, value);
    return getEditableSettings(db);
  });

  // ---- pre-existing agent memory (discover on disk, import into membrain) ----

  app.get('/api/agent-memory', async () => discoverAgentMemory(db));

  app.post<{ Body: { paths: string[] } }>('/api/agent-memory/import', async (req) => {
    const paths = req.body?.paths;
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
      throw new ValidationError('paths must be an array of strings');
    }
    const r = await importAgentMemory(db, embedder, paths);
    return {
      imported: r.memories.length,
      added: r.added,
      updated: r.updated,
      skipped: r.skipped,
      memories: r.memories,
    };
  });
}
