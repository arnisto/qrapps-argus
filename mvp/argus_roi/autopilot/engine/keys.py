"""Argus-side API keys (Bearer tokens developers use on /v1/*).

Plain string keys, prefix-and-suffix visible in the UI ("ak_live_8f3a…1c"),
sha256 stored in the DB. The plaintext is shown ONCE at creation, never again.
"""

from __future__ import annotations

import hashlib
import secrets
import store


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def generate(tenant_id: str, name: str,
             scopes: list[str] | None = None, rate_per_min: int = 60) -> dict:
    raw = "ak_live_" + secrets.token_urlsafe(32)
    prefix = raw[:14] + "…" + raw[-4:]
    sc = scopes or ["chat:read", "ingest:write"]
    sc_sql = "ARRAY[" + ",".join(store.dq(s) for s in sc) + "]::TEXT[]"
    rows = store.pg(
        "INSERT INTO autopilot.ke_apikey (tenant_id, name, key_prefix, key_hash, "
        "scopes, rate_per_min) VALUES ("
        f"{store.dq(tenant_id)}, {store.dq(name)}, {store.dq(prefix)}, "
        f"{store.dq(_hash(raw))}, {sc_sql}, {int(rate_per_min)}) RETURNING id;",
        capture=True)
    return {"id": int(rows[0]["id"]), "key": raw, "prefix": prefix,
            "name": name, "scopes": sc, "rate_per_min": rate_per_min}


def list_keys(tenant_id: str = "default") -> list[dict]:
    return store.pgq(
        "SELECT id, name, key_prefix, scopes, rate_per_min, enabled, "
        "created_at, last_used_at FROM autopilot.ke_apikey "
        f"WHERE tenant_id={store.dq(tenant_id)} ORDER BY id DESC;")


def revoke(tenant_id: str, key_id: int):
    store.pg(f"UPDATE autopilot.ke_apikey SET enabled=false "
             f"WHERE tenant_id={store.dq(tenant_id)} AND id={int(key_id)};")


def delete(tenant_id: str, key_id: int):
    store.pg(f"DELETE FROM autopilot.ke_apikey "
             f"WHERE tenant_id={store.dq(tenant_id)} AND id={int(key_id)};")


def verify(bearer: str) -> dict | None:
    """Returns {id, tenant_id, scopes, rate_per_min} or None."""
    if not bearer:
        return None
    h = _hash(bearer)
    rows = store.pgq(
        "SELECT id, tenant_id, scopes, rate_per_min FROM autopilot.ke_apikey "
        f"WHERE key_hash={store.dq(h)} AND enabled LIMIT 1;")
    if not rows:
        return None
    # touch last_used (fire and forget; safe in single-tenant; will batch later)
    try:
        store.pg(f"UPDATE autopilot.ke_apikey SET last_used_at=now() WHERE id={int(rows[0]['id'])};")
    except Exception:
        pass
    return rows[0]
