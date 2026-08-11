import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildMemoryMap,
  buildMindMap,
  getCachedMap,
  getCachedMindMap,
  getProposals,
  proposeTitles,
  resolveProposals,
  stageSave,
  storeHash,
  summarizeMemories,
} from '../src/core/insights.js';
import { getMemory } from '../src/core/memories.js';
import type { Proposal } from '../src/core/insights.js';
import { stripThink, OllamaError } from '../src/core/ollama.js';
import { saveMemory, listMemories } from '../src/core/memories.js';
import { setSetting } from '../src/core/db.js';
import { tempDb, fakeEmbedder } from './helpers.js';
import type { DB } from '../src/core/db.js';

const embedder = fakeEmbedder();
let db: DB, cleanup: () => void;

beforeEach(() => {
  ({ db, cleanup } = tempDb());
  // point at a dead port so tests never talk to a real ollama
  setSetting(db, 'ollama_url', 'http://127.0.0.1:1');
});
afterEach(() => cleanup());

describe('insights', () => {
  it('broken api embedding config falls back to local instead of throwing', async () => {
    const { getEmbedder } = await import('../src/core/embeddings.js');
    setSetting(db, 'embedding_provider', 'api'); // url/model unset
    const e = await getEmbedder(db, { dataDir: 'data', quiet: true }).catch(() => null);
    // must not reject; local fallback returns a working embedder
    expect(e).not.toBeNull();
    expect(e!.model).toContain('MiniLM');
  });

  it('stripThink removes qwen-style thinking blocks', () => {
    expect(stripThink('<think>hmm\nlines</think>{"a":1}')).toBe('{"a":1}');
    expect(stripThink('plain')).toBe('plain');
  });

  it('storeHash changes when memories change', async () => {
    const h0 = storeHash(db);
    await saveMemory(db, embedder, { content: 'fact', source: 'ui' });
    expect(storeHash(db)).not.toBe(h0);
  });

  it('cached map round-trips and goes stale on change', async () => {
    await saveMemory(db, embedder, { content: 'fact', source: 'ui' });
    expect(getCachedMap(db)).toBeNull();
    setSetting(
      db,
      'memory_map',
      JSON.stringify({
        builtAt: 'x',
        model: 'm',
        hash: storeHash(db),
        stale: false,
        categories: [{ name: 'A', description: '', ids: [1] }],
      }),
    );
    expect(getCachedMap(db)?.stale).toBe(false);
    await saveMemory(db, embedder, { content: 'another', source: 'ui' });
    expect(getCachedMap(db)?.stale).toBe(true);
  });

  it('cloud provider without key/model → OllamaError, no network attempted', async () => {
    await saveMemory(db, embedder, { content: 'fact', source: 'ui' });
    setSetting(db, 'llm_provider', 'openai');
    await expect(proposeTitles(db)).rejects.toThrow(OllamaError);
    setSetting(db, 'llm_provider', 'anthropic');
    await expect(summarizeMemories(db)).rejects.toThrow(OllamaError);
  });

  it('all LLM ops fail with OllamaError when ollama is unreachable', async () => {
    await saveMemory(db, embedder, { content: 'fact', source: 'ui' });
    await expect(buildMemoryMap(db)).rejects.toThrow(OllamaError);
    await expect(summarizeMemories(db)).rejects.toThrow(OllamaError);
    await expect(proposeTitles(db)).rejects.toThrow(OllamaError);
    await expect(buildMindMap(db)).rejects.toThrow(OllamaError);
  });

  it('proposals: accept applies title, reject drops, missing memory skipped', async () => {
    const m = await saveMemory(db, embedder, { content: 'a fact', source: 'ui' });
    const mk = (id: string, memoryId: number, next: string): Proposal => ({
      id,
      memoryId,
      kind: 'title',
      old: null,
      next,
      model: 'test',
      createdAt: 'now',
    });
    setSetting(
      db,
      'ai_proposals',
      JSON.stringify([mk('p1', m.id, 'Good Title'), mk('p2', m.id, 'Bad Title'), mk('p3', 999, 'Ghost')]),
    );
    expect(getProposals(db)).toHaveLength(3);

    const acc = await resolveProposals(db, embedder, ['p1'], true);
    expect(acc).toEqual({ resolved: 1, applied: 1 });
    expect(getMemory(db, m.id).title).toBe('Good Title');

    const rej = await resolveProposals(db, embedder, ['p2'], false);
    expect(rej).toEqual({ resolved: 1, applied: 0 });
    expect(getMemory(db, m.id).title).toBe('Good Title');

    // memory 999 doesn't exist — resolved but nothing applied
    const ghost = await resolveProposals(db, embedder, ['p3'], true);
    expect(ghost).toEqual({ resolved: 1, applied: 0 });
    expect(getProposals(db)).toHaveLength(0);
  });

  it('staged agent save lands only on accept, with its original stamp', async () => {
    const p = stageSave(db, { content: 'agent fact', tags: ['x'], source: 'mcp:claude' });
    expect(getProposals(db).some((q) => q.id === p.id && q.kind === 'save')).toBe(true);
    expect(listMemories(db).some((m) => m.content === 'agent fact')).toBe(false); // nothing inked yet
    const r = await resolveProposals(db, embedder, [p.id], true);
    expect(r).toEqual({ resolved: 1, applied: 1 });
    const saved = listMemories(db).find((m) => m.content === 'agent fact');
    expect(saved?.source).toBe('mcp:claude');
    expect(saved?.tags).toEqual(['x']);
  });

  it('cached mind map goes stale on change', async () => {
    await saveMemory(db, embedder, { content: 'fact', source: 'ui' });
    expect(getCachedMindMap(db)).toBeNull();
    setSetting(
      db,
      'mind_map',
      JSON.stringify({
        builtAt: 'x',
        model: 'm',
        hash: storeHash(db),
        stale: false,
        nodes: [{ id: 'a', label: 'A', kind: 'topic', memoryIds: [1] }],
        edges: [],
      }),
    );
    expect(getCachedMindMap(db)?.stale).toBe(false);
    await saveMemory(db, embedder, { content: 'more', source: 'ui' });
    expect(getCachedMindMap(db)?.stale).toBe(true);
  });
});
