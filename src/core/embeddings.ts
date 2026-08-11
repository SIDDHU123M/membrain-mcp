import path from 'node:path';
import { type DB, getSetting } from './db.js';

export interface Embedder {
  model: string;
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export interface EmbedderOptions {
  dataDir: string;
  quiet?: boolean; // stdio mode: nothing may touch stdout
}

async function localEmbedder(opts: EmbedderOptions): Promise<Embedder> {
  const { FlagEmbedding, EmbeddingModel } = await import('fastembed');
  const fe = await FlagEmbedding.init({
    model: EmbeddingModel.AllMiniLML6V2,
    cacheDir: path.join(opts.dataDir, 'models'),
    showDownloadProgress: !opts.quiet,
  });
  return {
    model: 'fast-all-MiniLM-L6-v2',
    dim: 384,
    async embed(texts) {
      const out: number[][] = [];
      for await (const batch of fe.embed(texts)) {
        for (const vec of batch) out.push(Array.from(vec));
      }
      return out;
    },
    async embedQuery(text) {
      return Array.from(await fe.queryEmbed(text));
    },
  };
}

async function apiEmbedder(url: string, model: string, apiKey?: string): Promise<Embedder> {
  const endpoint = new URL('embeddings', url.endsWith('/') ? url : url + '/');
  async function call(body: Record<string, unknown>): Promise<Response> {
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }
  async function embed(texts: string[], kind: 'passage' | 'query'): Promise<number[][]> {
    // standard OpenAI shape first; some providers (NVIDIA retriever models)
    // refuse without input_type, so retry once with it
    let res = await call({ input: texts, model });
    if (!res.ok) res = await call({ input: texts, model, input_type: kind });
    if (!res.ok) throw new Error(`embedding API ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
  const [probe] = await embed(['dim probe'], 'passage');
  return {
    model: `api:${model}`,
    dim: probe.length,
    embed: (texts) => embed(texts, 'passage'),
    embedQuery: async (text) => (await embed([text], 'query'))[0],
  };
}

/**
 * Build the embedder chosen in settings. Local fastembed is the default and
 * needs no configuration. API provider: settings embedding_provider='api',
 * embedding_api_url, embedding_api_model, embedding_api_key?.
 * A broken API config must never kill the boot — memory has to keep working,
 * so it falls back to local with a loud warning instead.
 */
export async function getEmbedder(db: DB, opts: EmbedderOptions): Promise<Embedder> {
  const provider = getSetting(db, 'embedding_provider') ?? 'local';
  if (provider === 'api') {
    const url = getSetting(db, 'embedding_api_url');
    const model = getSetting(db, 'embedding_api_model');
    if (!url || !model) {
      console.error(
        '[embeddings] embedding_provider=api but embedding_api_url/model unset — falling back to local embeddings',
      );
    } else {
      try {
        return await apiEmbedder(url, model, getSetting(db, 'embedding_api_key'));
      } catch (err) {
        console.error(
          `[embeddings] API embedder failed (${(err as Error).message}) — falling back to local embeddings`,
        );
      }
    }
  }
  return localEmbedder(opts);
}
