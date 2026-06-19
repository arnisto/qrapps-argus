"""RAG-augmented chat completion. The /v1/chat handler calls this.

Contract: takes OpenAI-shaped `messages`, retrieves grounded context for the
last user turn, injects it via a system message, calls the configured
provider, persists a ke_request row, and returns an OpenAI-shaped response
plus `argus_citations`.
"""

from __future__ import annotations

import store
from . import providers, retrieve


SYSTEM_PROMPT_TEMPLATE = """You are an assistant answering on behalf of the company. Use ONLY the facts in CONTEXT to answer. If the context does not contain the answer, say plainly that you don't have that information yet — do not invent.

When you use a fact, you may reference it inline with [#1], [#2], etc., matching the CONTEXT numbering.

CONTEXT (most relevant first):
{context}
"""


def _build_context_block(chunks: list[dict]) -> str:
    if not chunks:
        return "(no relevant company facts found)"
    parts = []
    for i, c in enumerate(chunks, 1):
        parts.append(f"[#{i}] {c['source_title']} ({c['source_kind']}, score={c['score']})\n{c['content']}")
    return "\n\n---\n\n".join(parts)


def chat(tenant_id: str, model: str, messages: list[dict],
         k: int = 8, apikey_id: int | None = None, **opts) -> dict:
    # 1. pull the last user turn — that's the query we retrieve against
    user_turns = [m for m in messages if m.get("role") == "user"]
    query = user_turns[-1]["content"] if user_turns else ""
    chunks = retrieve.retrieve(tenant_id, query, k=k)

    # 2. prepend a grounding system message (do not overwrite caller system msgs)
    sys_block = SYSTEM_PROMPT_TEMPLATE.format(context=_build_context_block(chunks))
    augmented = [{"role": "system", "content": sys_block}] + messages

    # 3. call the provider
    try:
        completion = providers.complete(tenant_id, model, augmented, **opts)
        status = "ok"
    except Exception as e:
        # persist a failed request for visibility
        _log_request(tenant_id, apikey_id, model,
                     providers.provider_for_model(model), 0, 0, 0, 0, 0.0,
                     len(chunks), [c["chunk_id"] for c in chunks],
                     "provider_error")
        raise

    # 4. enrich response with citations
    completion["argus_citations"] = [
        {"chunk_id": c["chunk_id"], "source_id": c["source_id"],
         "source_title": c["source_title"], "score": c["score"]}
        for c in chunks
    ]
    if not chunks:
        completion["argus_warning"] = "no_grounded_context"

    # 5. persist the request
    a = completion.get("_argus", {})
    usage = completion.get("usage", {})
    _log_request(tenant_id, apikey_id, model, a.get("provider", "?"),
                 int(usage.get("prompt_tokens", 0)),
                 int(usage.get("completion_tokens", 0)),
                 int(usage.get("total_tokens", 0)),
                 int(a.get("latency_ms", 0)),
                 float(a.get("cost_usd_estimate", 0.0)),
                 len(chunks), [c["chunk_id"] for c in chunks], status)
    return completion


def _log_request(tenant_id, apikey_id, model, provider, pt, ct, tt,
                 latency_ms, cost, chunks_used, citations, status):
    cit_sql = "ARRAY[" + ",".join(str(int(c)) for c in citations) + "]::BIGINT[]" if citations else "ARRAY[]::BIGINT[]"
    store.pg(
        "INSERT INTO autopilot.ke_request (tenant_id, apikey_id, model, provider, "
        "prompt_tokens, completion_tokens, total_tokens, latency_ms, cost_usd, "
        "chunks_used, citations, status) VALUES ("
        f"{store.dq(tenant_id)}, {apikey_id if apikey_id else 'NULL'}, "
        f"{store.dq(model)}, {store.dq(provider)}, {int(pt)}, {int(ct)}, {int(tt)}, "
        f"{int(latency_ms)}, {float(cost)}, {int(chunks_used)}, {cit_sql}, "
        f"{store.dq(status)});")


def list_requests(tenant_id: str = "default", limit: int = 50) -> list[dict]:
    return store.pgq(
        "SELECT r.id, r.created_at, r.model, r.provider, r.prompt_tokens, "
        "r.completion_tokens, r.latency_ms, r.cost_usd, r.chunks_used, "
        "r.status, r.apikey_id, k.name AS apikey_name "
        "FROM autopilot.ke_request r LEFT JOIN autopilot.ke_apikey k ON k.id = r.apikey_id "
        f"WHERE r.tenant_id = {store.dq(tenant_id)} "
        f"ORDER BY r.id DESC LIMIT {int(limit)};")
