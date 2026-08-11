import { type DB, getSetting } from './db.js';

/** Any LLM-backend failure (local or cloud) — REST maps this to 503. */
export class OllamaError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export type LlmKind = 'ollama' | 'openai' | 'anthropic';

export interface LlmConfig {
  kind: LlmKind;
  url: string;
  model: string;
  apiKey?: string;
}

// kept for callers that specifically need the local instance (legacy name)
export interface OllamaConfig extends LlmConfig {}

const DEFAULT_URLS: Record<Exclude<LlmKind, 'ollama'>, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

/**
 * Resolve the clerk's brain from settings. Default: local Ollama (auto-picks
 * the first installed model). Cloud alternatives for machines without a local
 * model: settings llm_provider = 'openai' (any OpenAI-compatible endpoint —
 * OpenAI, OpenRouter, NVIDIA NIM, Groq, custom) or 'anthropic', plus
 * llm_api_url / llm_api_key / llm_model. Null = nothing usable.
 */
export async function llmConfig(db: DB): Promise<LlmConfig | null> {
  const provider = (getSetting(db, 'llm_provider') ?? 'ollama') as LlmKind;
  if (provider === 'ollama') {
    const url = getSetting(db, 'ollama_url') ?? 'http://127.0.0.1:11434';
    try {
      const res = await fetch(new URL('/api/tags', url), { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return null;
      const json = (await res.json()) as { models?: { name: string }[] };
      const model = getSetting(db, 'ollama_model') ?? json.models?.[0]?.name;
      return model ? { kind: 'ollama', url, model } : null;
    } catch {
      return null;
    }
  }
  const url = getSetting(db, 'llm_api_url')?.trim() || DEFAULT_URLS[provider];
  const apiKey = getSetting(db, 'llm_api_key');
  const model = getSetting(db, 'llm_model');
  if (!apiKey || !model) return null;
  return { kind: provider, url, model, apiKey };
}

/** Back-compat alias — some callers only care about the local instance. */
export const ollamaConfig = llmConfig;

/** Thinking models may emit <think>…</think>; cloud models may fence JSON — strip both. */
export function stripThink(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

export interface GenOpts {
  json?: boolean;
  timeoutMs?: number;
  numCtx?: number;
}

async function ollamaGen(cfg: LlmConfig, prompt: string, opts: GenOpts): Promise<string> {
  const res = await fetch(new URL('/api/generate', cfg.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      // Ollama's server default ctx can be as low as 2048 — long prompts get silently
      // truncated and the model returns garbage. Always ask for a real window.
      options: { num_ctx: opts.numCtx ?? 16384 },
      // batched ops call many times in a row — keep the model warm between calls
      keep_alive: '10m',
      ...(opts.json ? { format: 'json' } : {}),
      // /no_think: soft switch understood by qwen3-family; inert text for others
      prompt: prompt + ' /no_think',
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
  });
  if (!res.ok) throw new OllamaError(`ollama ${res.status}: ${await res.text()}`, res.status);
  const json = (await res.json()) as { response: string };
  return stripThink(json.response);
}

async function openaiGen(cfg: LlmConfig, prompt: string, opts: GenOpts): Promise<string> {
  const base = cfg.url.endsWith('/') ? cfg.url : cfg.url + '/';
  const res = await fetch(new URL('chat/completions', base), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: prompt }],
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
  });
  if (!res.ok) throw new OllamaError(`${new URL(base).host} ${res.status}: ${await res.text()}`, res.status);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new OllamaError('provider returned no content');
  return stripThink(text);
}

async function anthropicGen(cfg: LlmConfig, prompt: string, opts: GenOpts): Promise<string> {
  const base = cfg.url.replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: opts.json ? prompt + '\nRespond with ONLY the JSON, no prose.' : prompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
  });
  if (!res.ok) throw new OllamaError(`anthropic ${res.status}: ${await res.text()}`, res.status);
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = json.content?.find((c) => c.type === 'text')?.text;
  if (typeof text !== 'string') throw new OllamaError('provider returned no content');
  return stripThink(text);
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate with whatever brain is configured. Callers resolve cfg once per
 * operation. Transient provider errors (NVIDIA's "Already borrowed" 500s,
 * rate limits, gateway blips) are retried with backoff so a single hiccup
 * doesn't abort a long batched run.
 */
export async function ollamaGenerate(
  cfg: LlmConfig,
  prompt: string,
  opts: GenOpts = {},
): Promise<string> {
  const MAX = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      if (cfg.kind === 'openai') return await openaiGen(cfg, prompt, opts);
      if (cfg.kind === 'anthropic') return await anthropicGen(cfg, prompt, opts);
      return await ollamaGen(cfg, prompt, opts);
    } catch (err) {
      const e =
        err instanceof OllamaError
          ? err
          : new OllamaError(`${cfg.kind} request failed: ${(err as Error).message}`);
      if (attempt < MAX && e.status !== undefined && RETRYABLE.has(e.status)) {
        console.error(`[ai] transient ${e.status} from provider, retry ${attempt}/${MAX - 1}`);
        await sleep(attempt * 2000);
        continue;
      }
      throw e;
    }
  }
}
