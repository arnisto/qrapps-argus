/**
 * Retrieve relevant chunks for a query.
 *
 * 1. Embed the query (Gemini).
 * 2. pgvector cosine ANN against `chunks` (over-fetch k*3).
 * 3. Rerank by  sim × (0.5 + 0.5·authority) × (0.7 + 0.3·recency_decay).
 *    Authority is 0..100 (smallint in `sources`), normalised to 0..1.
 *    Recency uses exp(-age_days / 365), so today=1.0, ~0.37 at one year.
 * 4. Return top-k with source metadata.
 */
import { db } from '../db.js';
import { embed, type ProviderRow } from './gemini.js';
import { toPgvectorLiteral } from './pgvector.js';

export interface RetrievedChunk {
  chunk_id: string;
  source_id: string;
  source_title: string;
  source_kind: string;
  content: string;
  sim: number;
  authority: number;
  score: number;
}

interface RawRow {
  chunk_id: string;
  source_id: string;
  content: string;
  created_at: string;
  sim: string; // pg returns the numeric expression as a string by default
  source_title: string;
  source_kind: string;
  authority: number;
}

export async function retrieve(
  envId: string,
  query: string,
  provider: ProviderRow,
  k = 8,
): Promise<RetrievedChunk[]> {
  if (!query.trim()) return [];
  const [qVec] = await embed(provider, [query], 768);
  if (!qVec) return [];
  const literal = toPgvectorLiteral(qVec);
  const over = Math.max(k * 3, 12);

  const { rows } = await db().query<RawRow>(
    `SELECT c.id            AS chunk_id,
            c.source_id     AS source_id,
            c.text          AS content,
            c.created_at,
            1 - (c.embedding <=> $1::vector) AS sim,
            s.title         AS source_title,
            s.kind          AS source_kind,
            s.authority     AS authority
       FROM chunks c
       JOIN sources s ON s.id = c.source_id
      WHERE c.env_id = $2
      ORDER BY c.embedding <=> $1::vector
      LIMIT $3`,
    [literal, envId, over],
  );

  const now = Date.now();
  const scored: RetrievedChunk[] = rows.map((r) => {
    const sim = Number(r.sim);
    const authNorm = Math.max(0, Math.min(1, r.authority / 100));
    const ageDays = Math.max(0, (now - new Date(r.created_at).getTime()) / 86_400_000);
    const recency = Math.exp(-ageDays / 365);
    const score = sim * (0.5 + 0.5 * authNorm) * (0.7 + 0.3 * recency);
    return {
      chunk_id: r.chunk_id,
      source_id: r.source_id,
      source_title: r.source_title,
      source_kind: r.source_kind,
      content: r.content,
      sim: Number(sim.toFixed(4)),
      authority: r.authority,
      score: Number(score.toFixed(4)),
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
