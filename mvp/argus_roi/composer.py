"""
LLM Composer — turns deterministic findings into a CEO-voice narrative.

This is the ONLY place an LLM touches the pipeline, and it operates under one
hard rule (from docs/AGENT_LOOPS.md):

    The LLM writes PROSE, never math. Every number it is allowed to use is
    handed to it as a verified fact from the deterministic engine. It may not
    invent, recompute, or adjust a single figure.

Provider: reads ARGUS_DEFAULT_AI_PROVIDER + the matching key/model from the
repo .env. Today it implements Gemini (the configured default). Falls back
gracefully — if the LLM is unavailable, the deterministic memo still ships.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
import urllib.error
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_env() -> dict:
    env = {}
    envfile = REPO_ROOT / ".env"
    if envfile.exists():
        for line in envfile.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.split("#")[0].strip()
    # process env wins
    env.update({k: v for k, v in os.environ.items() if k.startswith("ARGUS_")})
    return env


def _call_gemini(prompt: str, key: str, model: str, retries: int = 3) -> str | None:
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={key}")
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        # 2.5-flash spends part of the budget on internal "thinking"; give it
        # plenty of headroom so the visible summary isn't truncated.
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 4096},
    }).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read())
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < retries - 1:
                time.sleep(2 * (attempt + 1))   # transient — back off and retry
                continue
            return None
        except Exception:
            return None
    return None


def _build_prompt(findings: list[dict], totals: dict) -> str:
    # Hand the LLM the numbers as immutable facts.
    facts = []
    for i, f in enumerate(findings, 1):
        facts.append(
            f"{i}. {f['title']} [{f['severity']}] — realizable {f['opportunity_value']:,.0f} TND "
            f"(gross {f['gross_value']:,.0f} TND). Headline: {f['headline']} "
            f"Action: {f['recommended_action'].strip()}"
        )
    facts_block = "\n".join(facts)
    return f"""You are the analyst writing the opening of a weekly operational memo to the CEO of Intigo, a Tunisian logistics company. Below are findings produced by a deterministic SQL engine. These numbers are FACTS — you must NOT change, recompute, or invent any figure. Use only the numbers given.

VERIFIED FACTS:
- Total realizable value this quarter: {totals['opportunity']:,.0f} TND
- Total revenue at risk: {totals['at_risk']:,.0f} TND
{facts_block}

Write a sharp 4-6 sentence executive summary in plain business English (the CEO's language). Lead with the single biggest opportunity. Be direct, no fluff, no hedging. Name the top 2-3 actions worth doing this week. Do NOT restate every finding — synthesize. Do NOT use any number that is not in the facts above. Output only the summary prose, no headers."""


def compose_narrative(findings: list[dict], totals: dict) -> dict:
    """Returns {provider, model, narrative} or {provider, model, narrative:None}."""
    env = _load_env()
    provider = env.get("ARGUS_DEFAULT_AI_PROVIDER", "gemini").lower()
    result = {"provider": provider, "model": None, "narrative": None}

    if provider == "gemini":
        key = env.get("ARGUS_GEMINI_API_KEY", "")
        model = env.get("ARGUS_GEMINI_MODEL", "gemini-2.5-flash")
        result["model"] = model
        if key:
            result["narrative"] = _call_gemini(_build_prompt(findings, totals), key, model)
    # Other providers (claude/openai) wire in here later — same contract.
    return result
