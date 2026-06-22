/**
 * pgvector wire format: `[v1, v2, …, vN]` as a string literal in SQL,
 * cast to `::vector` on insert. Keep precision tight (6 digits) — wider
 * just bloats the SQL string without helping recall.
 */
export function toPgvectorLiteral(vec: number[]): string {
  return `[${vec.map((x) => x.toFixed(6)).join(',')}]`;
}
