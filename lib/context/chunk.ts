// Dependency-free text chunker for the Client Context Layer RAG pipeline.
// Splits extracted document/transcript text into overlapping chunks sized for
// embedding. Token counts are approximated at ~4 chars/token (good enough to
// keep chunks comfortably inside the embedding model's context); swap in a real
// tokenizer later if exact budgeting is ever needed.

export interface Chunk {
  index: number;
  content: string;
  tokenEstimate: number;
}

const CHARS_PER_CHUNK = 3200; // ~800 tokens
const OVERLAP_CHARS = 400; // ~100 tokens of overlap so context isn't cut mid-thought

/**
 * Split text into overlapping chunks, preferring to break on a paragraph,
 * line, or sentence boundary near the target size so chunks read cleanly.
 */
export function chunkText(text: string): Chunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < clean.length) {
    let end = Math.min(start + CHARS_PER_CHUNK, clean.length);

    // Prefer a natural boundary in the back half of the window.
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const boundary = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". ")
      );
      if (boundary > CHARS_PER_CHUNK * 0.5) end = start + boundary + 1;
    }

    const content = clean.slice(start, end).trim();
    if (content) {
      chunks.push({ index: index++, content, tokenEstimate: Math.ceil(content.length / 4) });
    }

    if (end >= clean.length) break;
    start = Math.max(0, end - OVERLAP_CHARS);
  }

  return chunks;
}
