"""
Shared LLM access for the autopilot. Reads provider + key from repo .env.
Implements Gemini (the configured default). One retry-with-backoff caller and
a tolerant JSON extractor (LLMs love to wrap JSON in prose / code fences).
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


def call_llm(prompt: str, max_tokens: int = 8192, temperature: float = 0.3) -> str | None:
    env = load_env()
    provider = env.get("ARGUS_DEFAULT_AI_PROVIDER", "gemini").lower()
    if provider == "gemini":
        return _gemini(prompt, env.get("ARGUS_GEMINI_API_KEY", ""),
                       env.get("ARGUS_GEMINI_MODEL", "gemini-2.5-flash"),
                       max_tokens, temperature)
    return None


def model_id() -> str:
    env = load_env()
    p = env.get("ARGUS_DEFAULT_AI_PROVIDER", "gemini").lower()
    return f"{p}/{env.get('ARGUS_GEMINI_MODEL', 'gemini-2.5-flash')}"


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
        try:
            req = urllib.request.Request(url, data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read())
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            return None
        except Exception:
            if attempt < retries - 1:
                time.sleep(2)
                continue
            return None
    return None


def extract_json(text: str):
    """Pull the first JSON array/object out of an LLM response."""
    if not text:
        return None
    # strip code fences
    text = re.sub(r"```(?:json)?", "", text).strip("` \n")
    # find the outermost array or object
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
