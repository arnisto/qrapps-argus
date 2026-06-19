"""Retrieve relevant chunks for a query.

  1. Embed the query (Gemini text-embedding-004).
  2. pgvector cosine ANN against ke_chunk (over-fetch k*3).
  3. Rerank by  sim × source.authority × recency_decay.
  4. Return top-k chunks with their source metadata.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

import store
from . import providers


def _emb_lit(vec: list[float]) -> str:
    return "'[" + ",".join(f"{x:.6f}" for x in vec) + "]'"


def retrieve(tenant_id: str, query: str, k: int = 8) -> list[dict]:
    """Returns: [{chunk_id, source_id, source_title, source_kind, content,
                  sim, authority, score}]."""
    if not query.strip():
        return []
    q_vec = providers.embed(tenant_id, [query])[0]
    over = max(k * 3, 12)
    rows = store.pgq(
        "SELECT c.id AS chunk_id, c.source_id, c.content, c.created_at, "
        "1 - (c.embedding <=> " + _emb_lit(q_vec) + "::vector) AS sim, "
        "s.title AS source_title, s.kind AS source_kind, s.authority "
        "FROM autopilot.ke_chunk c "
        "JOIN autopilot.ke_source s ON s.id = c.source_id "
        f"WHERE c.tenant_id = {store.dq(tenant_id)} "
        f"ORDER BY c.embedding <=> {_emb_lit(q_vec)}::vector "
        f"LIMIT {int(over)};")

    now = datetime.now(timezone.utc)
    scored = []
    for r in rows:
        sim = float(r["sim"])
        auth = float(r["authority"])
        # mild recency boost over the last year
        try:
            age_days = (now - datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))).days
        except Exception:
            age_days = 0
        recency = math.exp(-age_days / 365.0)   # 1.0 today, ~0.37 at 1y
        score = sim * (0.5 + 0.5 * auth) * (0.7 + 0.3 * recency)
        scored.append({
            "chunk_id": int(r["chunk_id"]),
            "source_id": int(r["source_id"]),
            "source_title": r["source_title"],
            "source_kind": r["source_kind"],
            "content": r["content"],
            "sim": round(sim, 4),
            "authority": auth,
            "score": round(score, 4),
        })
    scored.sort(key=lambda x: -x["score"])
    return scored[:k]
