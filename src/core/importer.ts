import path from 'node:path';
import { type DB, getSetting } from './db.js';
import type { Embedder } from './embeddings.js';
import { type Memory, ValidationError, saveMemory } from './memories.js';
import { chunkText } from './chunking.js';
import { type OllamaConfig, ollamaConfig, ollamaGenerate } from './ollama.js';

export interface ImportResult {
  ids: number[];
  memories: Memory[];
  usedLlm: boolean;
}

async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') {
    // pdf-parse's index.js runs debug code when imported — use the lib entry directly
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }
  if (ext === '.md' || ext === '.txt') return buffer.toString('utf8');
  throw new ValidationError(`unsupported file type "${ext}" — only .pdf, .md, .txt`);
}

async function extractFacts(cfg: OllamaConfig, text: string): Promise<string[]> {
  const out = await ollamaGenerate(
    cfg,
    'You organize documents into an AI memory store. From the text below, extract the durable ' +
      'key points worth remembering: facts, decisions, preferences, definitions, numbers. ' +
      'Each memory must be one self-contained sentence or two, understandable without the document. ' +
      'Skip filler, boilerplate, and formatting. ' +
      'Respond with JSON: {"memories": ["...", "..."]}\n\nTEXT:\n' +
      text,
    { json: true, timeoutMs: 180_000 },
  );
  const parsed = JSON.parse(out) as { memories?: unknown };
  if (!Array.isArray(parsed.memories)) return [];
  return parsed.memories.filter((m): m is string => typeof m === 'string' && m.trim().length > 0);
}

export interface ImportPreview {
  filename: string;
  usedLlm: boolean;
  model: string | null;
  tags: string[];
  facts: string[];
}

/**
 * File → text → candidate memories, WITHOUT saving anything. When a local
 * Ollama is reachable the text is run through it window-by-window to extract
 * key points; otherwise the raw text is the single candidate. The UI shows
 * this preview for the user to select/edit before committing.
 */
export async function previewImport(
  db: DB,
  input: { filename: string; buffer: Buffer; tags?: string[] },
): Promise<ImportPreview> {
  const text = (await extractText(input.filename, input.buffer)).trim();
  if (text.length === 0) throw new ValidationError('file contains no extractable text');
  const tags = [...(input.tags ?? []), path.basename(input.filename)];

  const cfg = getSetting(db, 'import_llm') === 'off' ? null : await ollamaConfig(db);
  if (cfg) {
    try {
      // window the doc so it fits a small local model's context
      const windows = chunkText(text, 1500, 0.05);
      const facts: string[] = [];
      for (const w of windows) facts.push(...(await extractFacts(cfg, w.text)));
      if (facts.length > 0) {
        return { filename: input.filename, usedLlm: true, model: cfg.model, tags, facts };
      }
    } catch (err) {
      // LLM extraction is best-effort; fall through to raw preview
      console.error(`ollama extraction failed, previewing raw: ${(err as Error).message}`);
    }
  }
  return { filename: input.filename, usedLlm: false, model: null, tags, facts: [text] };
}

/** Save reviewed facts as memories (source=import). The commit half of the preview flow. */
export async function commitImport(
  db: DB,
  embedder: Embedder,
  facts: { content: string; tags?: string[] }[],
): Promise<Memory[]> {
  if (!Array.isArray(facts) || facts.length === 0) {
    throw new ValidationError('facts must be a non-empty array');
  }
  const memories: Memory[] = [];
  for (const f of facts) {
    memories.push(
      await saveMemory(db, embedder, { content: f.content, tags: f.tags, source: 'import' }),
    );
  }
  return memories;
}

/** One-shot import (REST/scripts): preview + commit everything. */
export async function importFile(
  db: DB,
  embedder: Embedder,
  input: { filename: string; buffer: Buffer; tags?: string[] },
): Promise<ImportResult> {
  const p = await previewImport(db, input);
  const memories = await commitImport(
    db,
    embedder,
    p.facts.map((content) => ({ content, tags: p.tags })),
  );
  return { ids: memories.map((m) => m.id), memories, usedLlm: p.usedLlm };
}
