"""LiteLLM-style provider adapter for Argus.

Shipping providers: Gemini, Groq, OpenAI. Each implements two methods:

    complete(messages, model, **opts) -> dict   # OpenAI-shape response
    embed(texts, model='text-embedding-004') -> list[list[float]]

Selection: a model string ("gemini-2.5-flash", "groq/llama-3.1-70b-versatile",
"gpt-4o-mini") maps to a provider via `provider_for_model()`. Provider API
keys are read from autopilot.ke_provider (encrypted by engine.secret).

No external deps — uses `urllib` like the rest of the autopilot. Swap in the
LiteLLM library only when the 4th provider lands.
"""

from __future__ import annotations

import json
import time
import urllib.request
import urllib.error
from dataclasses import dataclass
from typing import Iterable

import store
from . import secret


# Approximate cost ($/1M tokens) — tune per current pricing.
PRICING = {
    "gemini-2.5-flash":  {"in": 0.30, "out": 2.50},
    "gemini-2.5-pro":    {"in": 1.25, "out": 10.0},
    "gemini-2.0-flash":  {"in": 0.10, "out": 0.40},
    "groq/llama-3.1-70b-versatile":  {"in": 0.59, "out": 0.79},
    "groq/llama-3.3-70b-versatile":  {"in": 0.59, "out": 0.79},
    "groq/llama-3.1-8b-instant":     {"in": 0.05, "out": 0.08},
    "gpt-4o":            {"in": 2.50, "out": 10.0},
    "gpt-4o-mini":       {"in": 0.15, "out": 0.60},
}

EMBED_DIM = 768  # Gemini text-embedding-004 default


@dataclass
class Provider:
    name: str
    api_key: str
    default_model: str
    base_url: str | None = None


# ---------- provider lookup ----------------------------------------------
def provider_for_model(model: str) -> str:
    m = (model or "").lower()
    if m.startswith("gemini") or m.startswith("text-embedding-004") or m.startswith("models/"):
        return "gemini"
    if m.startswith("groq/") or m.startswith("llama") or m.startswith("mixtral"):
        return "groq"
    if m.startswith("gpt-") or m.startswith("text-embedding-3") or m.startswith("o1") or m.startswith("o3"):
        return "openai"
    # default: try gemini (cheapest configured for the user)
    return "gemini"


def load_provider(tenant_id: str, name: str) -> Provider | None:
    rows = store.pgq(
        "SELECT name, api_key_enc, default_model, base_url FROM autopilot.ke_provider "
        f"WHERE tenant_id = {store.dq(tenant_id)} AND name = {store.dq(name)} AND enabled "
        "LIMIT 1;")
    if not rows:
        return None
    r = rows[0]
    return Provider(name=r["name"], api_key=secret.decrypt(r["api_key_enc"]),
                    default_model=r["default_model"], base_url=r.get("base_url") or None)


def list_providers(tenant_id: str = "default") -> list[dict]:
    return store.pgq(
        "SELECT id, name, default_model, base_url, enabled, created_at "
        f"FROM autopilot.ke_provider WHERE tenant_id={store.dq(tenant_id)} ORDER BY id;")


def add_provider(tenant_id: str, name: str, api_key: str,
                 default_model: str, base_url: str | None = None) -> int:
    enc = secret.encrypt(api_key)
    rows = store.pg(
        "INSERT INTO autopilot.ke_provider (tenant_id, name, api_key_enc, default_model, base_url) "
        f"VALUES ({store.dq(tenant_id)}, {store.dq(name)}, {store.dq(enc)}, "
        f"{store.dq(default_model)}, {store.dq(base_url)}) "
        "ON CONFLICT (tenant_id, name) DO UPDATE SET "
        "api_key_enc = EXCLUDED.api_key_enc, default_model = EXCLUDED.default_model, "
        "base_url = EXCLUDED.base_url, enabled = true RETURNING id;",
        capture=True)
    return int(rows[0]["id"])


def delete_provider(tenant_id: str, pid: int):
    store.pg(f"DELETE FROM autopilot.ke_provider WHERE tenant_id={store.dq(tenant_id)} AND id={int(pid)};")


# ---------- HTTP helpers --------------------------------------------------
def _post(url: str, body: dict, headers: dict, timeout: int = 90) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def _cost(model: str, in_tok: int, out_tok: int) -> float:
    pr = PRICING.get(model, {"in": 0.0, "out": 0.0})
    return (in_tok / 1_000_000) * pr["in"] + (out_tok / 1_000_000) * pr["out"]


# ---------- complete (chat) -----------------------------------------------
def complete(tenant_id: str, model: str, messages: list[dict], **opts) -> dict:
    """Returns an OpenAI-shaped completion dict, augmented with `_argus`
    metadata (provider used, latency_ms, cost_usd_estimate)."""
    pname = provider_for_model(model)
    p = load_provider(tenant_id, pname)
    if not p:
        raise RuntimeError(f"no provider '{pname}' configured for tenant '{tenant_id}'")
    real_model = model if pname != "groq" else model.split("/", 1)[-1]

    t0 = time.time()
    if pname == "gemini":
        out = _gemini_complete(p, real_model, messages, opts)
    elif pname == "groq":
        out = _groq_complete(p, real_model, messages, opts)
    elif pname == "openai":
        out = _openai_complete(p, real_model, messages, opts)
    else:
        raise RuntimeError(f"unknown provider {pname}")

    elapsed = int((time.time() - t0) * 1000)
    usage = out.get("usage", {})
    out["_argus"] = {
        "provider": pname,
        "model": model,
        "latency_ms": elapsed,
        "cost_usd_estimate": round(_cost(model,
                                          int(usage.get("prompt_tokens", 0)),
                                          int(usage.get("completion_tokens", 0))), 6),
    }
    return out


# ---------- per-provider impls -------------------------------------------
def _gemini_complete(p: Provider, model: str, messages: list[dict], opts: dict) -> dict:
    url = (p.base_url or "https://generativelanguage.googleapis.com") + \
          f"/v1beta/models/{model}:generateContent?key={p.api_key}"
    contents, sys = [], None
    for m in messages:
        role = m.get("role", "user")
        if role == "system":
            sys = (sys or "") + "\n" + m["content"]
        else:
            contents.append({"role": "model" if role == "assistant" else "user",
                              "parts": [{"text": m["content"]}]})
    body = {"contents": contents,
            "generationConfig": {"temperature": float(opts.get("temperature", 0.3)),
                                  "maxOutputTokens": int(opts.get("max_tokens", 4096))}}
    if sys:
        body["systemInstruction"] = {"parts": [{"text": sys.strip()}]}
    data = _post(url, body, {})
    cand = data["candidates"][0]
    text = cand["content"]["parts"][0]["text"]
    um = data.get("usageMetadata", {})
    return {
        "id": "chatcmpl-" + str(int(time.time() * 1000)),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text},
                     "finish_reason": cand.get("finishReason", "stop").lower()}],
        "usage": {
            "prompt_tokens": int(um.get("promptTokenCount", 0)),
            "completion_tokens": int(um.get("candidatesTokenCount", 0))
                                  + int(um.get("thoughtsTokenCount", 0)),
            "total_tokens": int(um.get("totalTokenCount", 0)),
        },
    }


def _groq_complete(p: Provider, model: str, messages: list[dict], opts: dict) -> dict:
    url = (p.base_url or "https://api.groq.com") + "/openai/v1/chat/completions"
    body = {"model": model, "messages": messages,
            "temperature": float(opts.get("temperature", 0.3)),
            "max_tokens": int(opts.get("max_tokens", 4096))}
    return _post(url, body, {"Authorization": f"Bearer {p.api_key}"})


def _openai_complete(p: Provider, model: str, messages: list[dict], opts: dict) -> dict:
    url = (p.base_url or "https://api.openai.com") + "/v1/chat/completions"
    body = {"model": model, "messages": messages,
            "temperature": float(opts.get("temperature", 0.3)),
            "max_tokens": int(opts.get("max_tokens", 4096))}
    return _post(url, body, {"Authorization": f"Bearer {p.api_key}"})


# ---------- embed ---------------------------------------------------------
def embed(tenant_id: str, texts: Iterable[str],
          model: str = "gemini-embedding-001", dim: int = 768) -> list[list[float]]:
    """Embeds via Gemini. Default = gemini-embedding-001 with
    outputDimensionality=768 so vectors match ke_chunk.embedding vector(768)."""
    p = load_provider(tenant_id, "gemini")
    if not p:
        raise RuntimeError("no Gemini provider configured (needed for embeddings)")
    out: list[list[float]] = []
    for t in texts:
        url = (p.base_url or "https://generativelanguage.googleapis.com") + \
              f"/v1beta/models/{model}:embedContent?key={p.api_key}"
        body = {"model": f"models/{model}",
                "content": {"parts": [{"text": t}]},
                "outputDimensionality": int(dim)}
        data = _post(url, body, {})
        out.append(data["embedding"]["values"])
    return out


def test_provider(tenant_id: str, name: str) -> dict:
    """Cheap reachability check used by /v1/providers/test."""
    p = load_provider(tenant_id, name)
    if not p:
        return {"ok": False, "error": "not configured"}
    try:
        r = complete(tenant_id, p.default_model,
                     [{"role": "user", "content": "Reply with: OK"}],
                     max_tokens=64)
        return {"ok": True, "text": r["choices"][0]["message"]["content"][:80],
                "model": p.default_model}
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"http {e.code}: {e.read()[:200].decode(errors='ignore')}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
