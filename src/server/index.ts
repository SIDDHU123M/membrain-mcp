#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { getSetting, openDb, setSetting } from '../core/db.js';
import { getEmbedder, getLocalEmbedder } from '../core/embeddings.js';
import { needsReembed, reembedAll } from '../core/memories.js';
import { snapshotOnBoot } from '../core/backup.js';
import { registerRest, type Ctx } from './rest.js';
import { registerMcpHttp, runStdio } from './mcp.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

function pkgVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(fileURLToPath(import.meta.url), '../../../package.json'), 'utf8'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

async function main() {
  if (has('--version') || has('-v')) {
    console.log(`membrain ${pkgVersion()}`);
    return;
  }
  const stdio = has('--stdio');
  const host = arg('--host') ?? '127.0.0.1';
  const port = Number(arg('--port') ?? 7777);
  const dataDir = path.resolve(arg('--data') ?? 'data');
  const dbFile = path.join(dataDir, 'memory.db');

  if (has('doctor')) {
    await doctor(dbFile, port);
    return;
  }

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
  log(`membrain v${pkgVersion()}`);
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
  let embedder = await getEmbedder(db, { dataDir, quiet: stdio });
  if (needsReembed(db, embedder)) {
    log(`membrain: embedding model changed → re-embedding all chunks with ${embedder.model}...`);
    try {
      const n = await reembedAll(db, embedder);
      log(`membrain: re-embedded ${n} chunks`);
    } catch (err) {
      // a failed migration must never kill the boot — nothing was written
      // (reembedAll commits in one transaction), so the old vectors are intact.
      // Fall back to the local embedder, which matches them.
      console.error(
        `[embeddings] re-embedding failed (${(err as Error).message}) — staying on local embeddings`,
      );
      embedder = await getLocalEmbedder({ dataDir, quiet: stdio });
    }
  }
  // seeded first run: an empty ledger reads as abandoned, not minimal. Five
  // example entries (tag `example`, one-click clear in the UI) so every screen
  // demos itself. Only ever once — clearing them must not reseed.
  if (!getSetting(db, 'seeded')) {
    const count = (db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n;
    if (count === 0) {
      const { saveMemory } = await import('../core/memories.js');
      const EXAMPLES = [
        'Welcome to your ledger. Entries are plain text — facts, preferences, decisions. This one is an example; when you are done looking around, strike all examples with one click.',
        'Your agents write here too. Connect one at http://127.0.0.1:7777/mcp and anything it saves appears in the ledger instantly, stamped with its name.',
        "Search is hybrid: meaning and keywords together. Try recalling 'how do agents connect' — this page's neighbor should surface even without exact words.",
        'Tags group entries. This one carries the example tag; click any tag in the ledger to filter by it.',
        'The clerk — a local Ollama, or any cloud key pasted in Settings — can title, organize and summarize the store. Every change it proposes is staged for your approval first.',
      ];
      for (const content of EXAMPLES) {
        await saveMemory(db, embedder, { content, tags: ['example'], source: 'ui' });
      }
      log(`membrain: first run — seeded ${EXAMPLES.length} example entries (tag: example)`);
    }
    setSetting(db, 'seeded', '1');
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
  await app.register(fastifyStatic, {
    root: uiDir,
    wildcard: false,
    // browsers heuristically cache HTML with no headers — users then run
    // yesterday's bundle and report missing features. HTML revalidates every
    // load; hashed assets are immutable so they cache forever.
    setHeaders(res, filepath) {
      if (filepath.endsWith('.html')) res.setHeader('cache-control', 'no-cache');
      else if (filepath.includes(`${path.sep}assets${path.sep}`))
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    },
  });
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

/** `membrain doctor` — checks the five things that actually break installs. */
async function doctor(dbFile: string, port: number) {
  const { llmConfig } = await import('../core/ollama.js');
  const { getSetting } = await import('../core/db.js');
  let failed = false;
  const report = (okay: boolean, label: string, detail?: string) => {
    if (!okay) failed = true;
    console.log(`  ${okay ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  };
  console.log('membrain doctor\n');

  const major = Number(process.versions.node.split('.')[0]);
  report(major >= 20, `node ${process.versions.node}`, major >= 20 ? undefined : 'needs >= 20');

  try {
    const db = openDb(dbFile);
    const m = (db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n;
    const c = (db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n;
    report(true, 'database + sqlite-vec', `${dbFile}: ${m} memories, ${c} chunks`);

    const embModel = getSetting(db, 'embedding_model') ?? 'not set (first boot will set it)';
    report(true, 'embeddings', `${getSetting(db, 'embedding_provider') ?? 'local'} / ${embModel}`);

    const llm = await llmConfig(db);
    if (llm) {
      report(true, 'clerk (LLM)', `${llm.kind} / ${llm.model}`);
    } else {
      report(
        false,
        'clerk (LLM)',
        'no Ollama reachable and no cloud key configured — imports still work, insights need a brain (Settings tab)',
      );
    }
  } catch (err) {
    report(false, 'database', (err as Error).message);
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/stats`, {
      signal: AbortSignal.timeout(1500),
    });
    report(true, `port ${port}`, res.ok ? 'a membrain server is already running here' : 'occupied by something else');
  } catch {
    report(true, `port ${port}`, 'free — ready to start');
  }

  console.log(failed ? '\nsomething needs attention.' : '\nall clear.');
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
