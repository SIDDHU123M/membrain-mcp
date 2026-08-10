export interface Chunk {
  text: string;
  tokenCount: number;
}

// ponytail: chars/4 token heuristic — swap for a real tokenizer only if chunk sizes ever matter
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks of at most maxTokens, with `overlap` fraction of
 * carry-over between consecutive chunks. Splits at whitespace when possible.
 * Text under maxTokens comes back as a single chunk.
 */
export function chunkText(text: string, maxTokens = 800, overlap = 0.15): Chunk[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const maxChars = maxTokens * 4;
  if (trimmed.length <= maxChars) {
    return [{ text: trimmed, tokenCount: estimateTokens(trimmed) }];
  }
  const overlapChars = Math.floor(maxChars * overlap);
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + maxChars, trimmed.length);
    if (end < trimmed.length) {
      const lastSpace = trimmed.lastIndexOf(' ', end);
      if (lastSpace > start + maxChars / 2) end = lastSpace;
    }
    const piece = trimmed.slice(start, end).trim();
    if (piece.length > 0) chunks.push({ text: piece, tokenCount: estimateTokens(piece) });
    if (end >= trimmed.length) break;
    start = end - overlapChars;
  }
  return chunks;
}
