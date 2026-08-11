#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { openDb } from '../core/db.js';
import { getEmbedder } from '../core/embeddings.js';
import { needsReembed, reembedAll } from '../core/memories.js';
import { snapshotOnBoot } from '../core/backup.js';
import { registerRest, type Ctx } from './rest.js';
import { registerMcpHttp, runStdio } from './mcp.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

async function main() {
  if (has('--version') || has('-v')) {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(fileURLToPath(import.meta.url), '../../../package.json'), 'utf8'),
    ) as { version: string };
    console.log(`membrain ${pkg.version}`);
    return;
  }
  const stdio = has('--stdio');
  const host = arg('--host') ?? '127.0.0.1';
  const port = Number(arg('--port') ?? 7777);
  const dataDir = path.resolve(arg('--data') ?? 'data');
  const dbFile = path.join(dataDir, 'memory.db');

  const log = stdio ? console.error : console.log; // stdout is JSON-RPC in stdio mode

  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !has('--i-understand-no-auth')) {
    console.error(
      `Refusing to bind ${host}: membrain has NO AUTH — anyone who reaches the port owns your memory.\n` +
        'If this interface is private (Tailscale/WireGuard/LAN you trust), rerun with:\n' +
        `  membrain --host ${host} --i-understand-no-auth`,
    );
    process.exit(1);
  }

  const db = openDb(dbFile);
  log(`membrain: db at ${dbFile}`);
  if (!stdio) {
    // safety net: snapshot every boot, keep the newest 5
    try {
      await snapshotOnBoot(db, dataDir);
      log('membrain: boot snapshot taken (data/backups, keeping 5)');
    } catch (err) {
      log(`membrain: boot snapshot failed: ${(err as Error).message}`);
    }
  }
  const embedder = await getEmbedder(db, { dataDir, quiet: stdio });
  if (needsReembed(db, embedder)) {
    log(`membrain: embedding model changed → re-embedding all chunks with ${embedder.model}...`);
    const n = await reembedAll(db, embedder);
    log(`membrain: re-embedded ${n} chunks`);
  }
  const ctx: Ctx = { db, embedder, dbFile, readonlySkills: has('--readonly-skills') };

  if (stdio) {
    await runStdio(ctx);
    return; // lives until the client closes stdin
  }

  const app = Fastify({ logger: false });
  await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  registerRest(app, ctx);
  registerMcpHttp(app, ctx);

  const uiDir = path.resolve(fileURLToPath(import.meta.url), '../../ui');
  await app.register(fastifyStatic, { root: uiDir, wildcard: false });
  app.get('/landing', (_req, reply) => reply.sendFile('landing.html'));
  // SPA fallback: unknown non-API GETs serve the UI
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/mcp')) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: 'not found' });
  });

  await app.listen({ host, port });
  const uiUrl = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  log(`membrain: UI      ${uiUrl}`);
  log(`membrain: MCP     ${uiUrl}/mcp`);
  log(`membrain: REST    ${uiUrl}/api/memories`);

  // default behavior: open the ledger in the browser (suppress with --no-open;
  // never inside containers/CI where there is no display). Fully detached —
  // it must never block or touch the server's console.
  if (!has('--no-open') && !process.env.CI && !fs.existsSync('/.dockerenv')) {
    try {
      const { spawn } = await import('node:child_process');
      const [cmd, args] =
        process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', uiUrl]]
          : process.platform === 'darwin'
            ? ['open', [uiUrl]]
            : ['xdg-open', [uiUrl]];
      spawn(cmd, args as string[], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
