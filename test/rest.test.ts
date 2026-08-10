import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { registerRest } from '../src/server/rest.js';
import { setSetting } from '../src/core/db.js';
import { tempDb, fakeEmbedder } from './helpers.js';
import type { DB } from '../src/core/db.js';

let db: DB, file: string, cleanup: () => void, app: FastifyInstance;

beforeEach(async () => {
  ({ db, file, cleanup } = tempDb());
  setSetting(db, 'import_llm', 'off');
  app = Fastify();
  await app.register(fastifyMultipart);
  registerRest(app, { db, embedder: fakeEmbedder(), dbFile: file });
});
afterEach(async () => {
  await app.close();
  cleanup();
});

describe('REST API', () => {
  it('POST → GET list → search → PATCH → DELETE lifecycle', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/memories',
      payload: { content: 'likes mango', tags: ['food'] },
    });
    expect(post.statusCode).toBe(201);
    const created = post.json();
    expect(created.source).toBe('ui');

    const list = await app.inject({ url: '/api/memories' });
    expect(list.json()).toHaveLength(1);

    const search = await app.inject({ url: '/api/memories?query=mango' });
    expect(search.json()[0].content).toBe('likes mango');
    expect(search.json()[0].score).toBeGreaterThan(0);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/memories/${created.id}`,
      payload: { tags: ['fruit'] },
    });
    expect(patch.json().tags).toEqual(['fruit']);

    const del = await app.inject({ method: 'DELETE', url: `/api/memories/${created.id}` });
    expect(del.json()).toEqual({ ok: true });
    expect((await app.inject({ url: '/api/memories' })).json()).toHaveLength(0);
  });

  it('error mapping: 400 validation, 404 not found', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/memories', payload: { content: ' ' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('content');
    const missing = await app.inject({ url: '/api/memories/999' });
    expect(missing.statusCode).toBe(404);
  });

  it('source cannot be spoofed from request body', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/memories',
      payload: { content: 'sneaky', source: 'mcp:fake' },
    });
    expect(post.json().source).toBe('ui');
  });

  it('stats endpoint', async () => {
    await app.inject({ method: 'POST', url: '/api/memories', payload: { content: 'x' } });
    const s = (await app.inject({ url: '/api/stats' })).json();
    expect(s.memories).toBe(1);
    expect(s.dbSizeBytes).toBeGreaterThan(0);
  });

  it('multipart import creates a memory', async () => {
    const boundary = 'X-BOUNDARY';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="notes.txt"',
      'Content-Type: text/plain',
      '',
      'imported note content',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const res = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.usedLlm).toBe(false);
    expect(json.memories[0].tags).toContain('notes.txt');
  });
});
