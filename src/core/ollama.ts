import { type DB, getSetting } from './db.js';

export class OllamaError extends Error {}

export interface OllamaConfig {
  url: string;
  model: string;
}

/** Resolve Ollama endpoint + model; auto-pick the first installed model when unset. Null = unreachable/none. */
export async function ollamaConfig(db: DB): Promise<OllamaConfig | null> {
  const url = getSetting(db, 'ollama_url') ?? 'http://127.0.0.1:11434';
  try {
    const res = await fetch(new URL('/api/tags', url), { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { models?: { name: string }[] };
    const model = getSetting(db, 'ollama_model') ?? json.models?.[0]?.name;
    return model ? { url, model } : null;
  } catch {
    return null;
  }
}

/** Thinking models (qwen3 etc.) may emit <think>…</think> before the answer — drop it. */
export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function ollamaGenerate(
  cfg: OllamaConfig,
  prompt: string,
  opts: { json?: boolean; timeoutMs?: number; numCtx?: number } = {},
): Promise<string> {
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
  if (!res.ok) throw new OllamaError(`ollama ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { response: string };
  return stripThink(json.response);
}
