"""
Shared LLM access for the autopilot — now with usage accounting.

Every call records: model, purpose, input/output tokens, latency, and an
estimated cost. autopilot drains these per run and persists them so the UI
can show exactly which model ran and how much it cost.

Reads provider + key from repo .env. Implements Gemini (configured default).
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.request
import urllib.error
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

# Estimated USD price per 1M tokens. Clearly an estimate — tune to your billing.
# Gemini 2.5 Flash (input incl. cached, output incl. thinking).
PRICING = {
    "gemini-2.5-flash": {"in": 0.30, "out": 2.50},
    "gemini-2.0-flash": {"in": 0.10, "out": 0.40},
    "gemini-flash-latest": {"in": 0.30, "out": 2.50},
}

# Per-run call ledger. autopilot sets the purpose, drains after each run.
_CALLS: list[dict] = []
_PURPOSE = "misc"


def set_purpose(p: str):
    global _PURPOSE
    _PURPOSE = p


def drain_calls() -> list[dict]:
    global _CALLS
    out, _CALLS = _CALLS, []
    return out


def load_env() -> dict:
    env = {}
    f = REPO_ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.split("#")[0].strip()
    env.update({k: v for k, v in os.environ.items() if k.startswith("ARGUS_")})
    return env


def model_id() -> str:
    env = load_env()
    p = env.get("ARGUS_DEFAULT_AI_PROVIDER", "gemini").lower()
    return f"{p}/{env.get('ARGUS_GEMINI_MODEL', 'gemini-2.5-flash')}"


def _cost(model: str, tin: int, tout: int) -> float:
    pr = PRICING.get(model, {"in": 0.30, "out": 2.50})
    return (tin / 1_000_000) * pr["in"] + (tout / 1_000_000) * pr["out"]


def call_llm(prompt: str, max_tokens: int = 8192, temperature: float = 0.3) -> str | None:
    env = load_env()
    provider = env.get("ARGUS_DEFAULT_AI_PROVIDER", "gemini").lower()
    if provider == "gemini":
        return _gemini(prompt, env.get("ARGUS_GEMINI_API_KEY", ""),
                       env.get("ARGUS_GEMINI_MODEL", "gemini-2.5-flash"),
                       max_tokens, temperature)
    return None


def _gemini(prompt, key, model, max_tokens, temperature, retries=4) -> str | None:
    if not key:
        return None
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={key}")
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
    }).encode()
    for attempt in range(retries):
        t0 = time.time()
        try:
            req = urllib.request.Request(url, data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read())
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            um = data.get("usageMetadata", {})
            tin = int(um.get("promptTokenCount", 0))
            # candidatesTokenCount + thoughtsTokenCount = what we're billed for output
            tout = int(um.get("candidatesTokenCount", 0)) + int(um.get("thoughtsTokenCount", 0))
            _CALLS.append({
                "model": model, "purpose": _PURPOSE,
                "tokens_in": tin, "tokens_out": tout,
                "latency_ms": int((time.time() - t0) * 1000),
                "cost_usd": round(_cost(model, tin, tout), 6), "ok": True,
            })
            return text
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            _CALLS.append({"model": model, "purpose": _PURPOSE, "tokens_in": 0, "tokens_out": 0,
                           "latency_ms": int((time.time() - t0) * 1000), "cost_usd": 0, "ok": False})
            return None
        except Exception:
            if attempt < retries - 1:
                time.sleep(2)
                continue
            _CALLS.append({"model": model, "purpose": _PURPOSE, "tokens_in": 0, "tokens_out": 0,
                           "latency_ms": int((time.time() - t0) * 1000), "cost_usd": 0, "ok": False})
            return None
    return None


def extract_json(text: str):
    if not text:
        return None
    text = re.sub(r"```(?:json)?", "", text).strip("` \n")
    for opener, closer in (("[", "]"), ("{", "}")):
        start = text.find(opener)
        if start == -1:
            continue
        depth = 0
        for i in range(start, len(text)):
            if text[i] == opener:
                depth += 1
            elif text[i] == closer:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
    return None
