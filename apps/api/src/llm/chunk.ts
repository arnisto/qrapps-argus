/**
 * Document → chunks. ~2048 chars target, ~256 char overlap (≈ 512/64
 * tokens). Splits on paragraph boundaries first, hard-splits anything
 * still too long after that.
 *
 * Supported inputs:
 *   · text/plain, .md, .markdown
 *   · text/html (rudimentary script/style strip + tag removal)
 *
 * PDFs and images go through `extractText()` consumers in routes/sources.ts —
 * keep this module free of optional deps.
 */

const CHUNK_TARGET = 2048;
const CHUNK_OVERLAP = 256;

function normalize(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunk(text: string): string[] {
  const normalized = normalize(text);
  if (!normalized) return [];

  // Split on paragraph boundaries, accumulate to target size.
  const paras = normalized.split(/\n\n+/);
  const out: string[] = [];
  let buf = '';
  for (const para of paras) {
    if (!para.trim()) continue;
    if (buf.length + para.length + 2 <= CHUNK_TARGET) {
      buf = buf ? `${buf}\n\n${para}` : para;
      continue;
    }
    if (buf) out.push(buf);
    // Hard-split paragraphs that exceed the target on their own.
    let remaining = para;
    while (remaining.length > CHUNK_TARGET) {
      out.push(remaining.slice(0, CHUNK_TARGET));
      remaining = remaining.slice(CHUNK_TARGET - CHUNK_OVERLAP);
    }
    buf = remaining;
  }
  if (buf) out.push(buf);

  // Tail-overlap pass — gives retrieval a bit of cross-chunk context.
  const overlapped: string[] = [];
  for (let i = 0; i < out.length; i += 1) {
    let body = out[i]!;
    if (i > 0) {
      const tail = out[i - 1]!.slice(-CHUNK_OVERLAP);
      body = `${tail}\n\n${body}`;
    }
    overlapped.push(body.slice(0, CHUNK_TARGET + CHUNK_OVERLAP));
  }
  return overlapped;
}

/**
 * Crude HTML strip — pulls out the text content for ingestion of
 * policy / FAQ pages, scrubs script + style blocks first.
 */
export function htmlToText(html: string): string {
  return normalize(
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' '),
  );
}

/**
 * Heuristic token count — 4 chars per token is good enough for English /
 * French / Arabic mix; sources only use it for logging, not for any
 * model-side limit decision.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}
