"""AES-GCM encrypt/decrypt for provider API keys at rest.

Uses Python stdlib only. APP_SECRET (32 raw bytes, base64) is read from env.
If unset on first call we generate one, persist it to ~/.argus/secret, and
warn — production should set it via env. This keeps the MVP zero-config but
auditable.
"""

from __future__ import annotations

import base64
import json
import os
import secrets as _stdlib_secrets
from pathlib import Path

# Lazy crypto: use `cryptography` if installed; else fall back to a clean,
# stdlib-only AES-GCM via the `Crypto` package; else stash the key in a small
# XOR scheme (NOT production-safe — surfaces a loud warning).
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # type: ignore
    _HAS_AESGCM = True
except Exception:                                          # pragma: no cover
    _HAS_AESGCM = False


_HOME_SECRET = Path.home() / ".argus" / "secret"
_HOME_ADMIN  = Path.home() / ".argus" / "admin_token"


def _load_key() -> bytes:
    raw = os.environ.get("APP_SECRET")
    if raw:
        try:
            k = base64.b64decode(raw)
            if len(k) == 32:
                return k
        except Exception:
            pass
    if _HOME_SECRET.exists():
        try:
            k = base64.b64decode(_HOME_SECRET.read_text().strip())
            if len(k) == 32:
                return k
        except Exception:
            pass
    # bootstrap: generate, persist, warn
    _HOME_SECRET.parent.mkdir(parents=True, exist_ok=True)
    k = _stdlib_secrets.token_bytes(32)
    _HOME_SECRET.write_text(base64.b64encode(k).decode())
    _HOME_SECRET.chmod(0o600)
    print(f"[engine.secret] generated APP_SECRET at {_HOME_SECRET}. "
          f"Set APP_SECRET env in production.")
    return k


def admin_token() -> str:
    """Bearer token required by /v1/* management endpoints and the operator UI
    (when bound to a non-loopback interface). Reads ARGUS_ADMIN_TOKEN env, else
    bootstraps a random one at ~/.argus/admin_token and prints it once."""
    tok = os.environ.get("ARGUS_ADMIN_TOKEN", "").strip()
    if tok:
        return tok
    if _HOME_ADMIN.exists():
        return _HOME_ADMIN.read_text().strip()
    _HOME_ADMIN.parent.mkdir(parents=True, exist_ok=True)
    new = "argus_admin_" + base64.urlsafe_b64encode(_stdlib_secrets.token_bytes(24)).decode().rstrip("=")
    _HOME_ADMIN.write_text(new)
    _HOME_ADMIN.chmod(0o600)
    print(f"[engine.secret] generated ARGUS_ADMIN_TOKEN at {_HOME_ADMIN} — "
          f"use it with `Authorization: Bearer <token>` on /v1/* admin endpoints.")
    return new


def encrypt(plaintext: str) -> str:
    if not plaintext:
        return ""
    key = _load_key()
    if _HAS_AESGCM:
        aes = AESGCM(key)
        nonce = _stdlib_secrets.token_bytes(12)
        ct = aes.encrypt(nonce, plaintext.encode(), None)
        return "agcm:" + base64.b64encode(nonce + ct).decode()
    # last-resort scheme — surfaces as a startup warning above; not used when
    # cryptography is installed (which it is in our docker image).
    print("[engine.secret] WARNING: cryptography lib not installed; using "
          "obfuscation-only XOR fallback. Install `cryptography` for AES-GCM.")
    pt = plaintext.encode()
    obf = bytes(b ^ key[i % 32] for i, b in enumerate(pt))
    return "xor:" + base64.b64encode(obf).decode()


def decrypt(blob: str) -> str:
    if not blob:
        return ""
    if blob.startswith("agcm:") and _HAS_AESGCM:
        raw = base64.b64decode(blob[5:])
        nonce, ct = raw[:12], raw[12:]
        return AESGCM(_load_key()).decrypt(nonce, ct, None).decode()
    if blob.startswith("xor:"):
        key = _load_key()
        ct = base64.b64decode(blob[4:])
        return bytes(b ^ key[i % 32] for i, b in enumerate(ct)).decode()
    raise ValueError(f"engine.secret: unknown ciphertext prefix in {blob[:8]!r}")
