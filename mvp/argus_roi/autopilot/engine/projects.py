"""Projects (businesses / workspaces).

A project is a top-level tenant. Its `slug` is the canonical tenant_id used
on every other ke_* table. Slugs go into URLs (`/p/<slug>/v1/chat/...`) and
into the API keys minted under them — so they are **immutable**. Display
`name` can change freely.

Per the panel: keep the schema minimal — `type` deferred until a feature
branches on it. delete cascades through the existing FK in ke_chunk →
ke_source. ke_apikey, ke_provider, ke_request reference tenant_id only as a
string, so they're cleaned up explicitly in delete().
"""

from __future__ import annotations

import re
import store

_SLUG_RE = re.compile(r"[^a-z0-9-]+")
_SLUG_DEDUP = re.compile(r"-+")


def slugify(s: str) -> str:
    s = (s or "").lower().strip()
    s = _SLUG_RE.sub("-", s)
    s = _SLUG_DEDUP.sub("-", s).strip("-")
    return s[:48] or "untitled"


def ensure_default() -> None:
    """Idempotent. Called on startup so legacy bare /v1/... keeps routing."""
    store.pg(
        "INSERT INTO autopilot.ke_project (slug, name, primary_model) "
        "VALUES ('default', 'Default workspace', 'gemini-2.5-flash') "
        "ON CONFLICT (slug) DO NOTHING;")


def list_projects() -> list[dict]:
    """One row per project. Folds in counts/cost so the list view doesn't N+1."""
    return store.pgq(
        "SELECT p.id, p.slug, p.name, p.primary_model, p.created_at, "
        "(SELECT COUNT(*) FROM autopilot.ke_source   s WHERE s.tenant_id = p.slug) AS sources, "
        "(SELECT COUNT(*) FROM autopilot.ke_chunk    c WHERE c.tenant_id = p.slug) AS chunks, "
        "(SELECT COUNT(*) FROM autopilot.ke_apikey   k WHERE k.tenant_id = p.slug AND k.enabled) AS active_keys, "
        "(SELECT COUNT(*) FROM autopilot.ke_provider g WHERE g.tenant_id = p.slug AND g.enabled) AS active_providers, "
        "(SELECT COUNT(*) FROM autopilot.ke_request  r WHERE r.tenant_id = p.slug) AS requests, "
        "(SELECT COALESCE(SUM(cost_usd),0) FROM autopilot.ke_request r WHERE r.tenant_id = p.slug) AS cost_usd, "
        "(SELECT MAX(created_at) FROM autopilot.ke_request r WHERE r.tenant_id = p.slug) AS last_request_at "
        "FROM autopilot.ke_project p "
        "ORDER BY (p.slug='default') DESC, p.id;")


def rename(slug: str, name: str | None = None,
           primary_model: str | None = None) -> dict:
    """Patch the mutable fields of a project. slug is immutable on purpose."""
    sets = []
    if name is not None and name.strip():
        sets.append(f"name = {store.dq(name.strip())}")
    if primary_model is not None and primary_model.strip():
        sets.append(f"primary_model = {store.dq(primary_model.strip())}")
    if not sets:
        return get_by_slug(slug)
    store.pg(f"UPDATE autopilot.ke_project SET {', '.join(sets)} "
             f"WHERE slug = {store.dq(slug)};")
    return get_by_slug(slug)


def get_by_slug(slug: str) -> dict | None:
    rows = store.pgq(
        f"SELECT id, slug, name, primary_model, created_at FROM autopilot.ke_project "
        f"WHERE slug = {store.dq(slug)} LIMIT 1;")
    return rows[0] if rows else None


def exists(slug: str) -> bool:
    return get_by_slug(slug) is not None


def create(name: str, primary_model: str, slug: str | None = None) -> dict:
    base = slugify(slug or name)
    if not base:
        raise ValueError("slug/name empty")
    # ensure uniqueness with a numeric suffix if needed (race-safe via the
    # UNIQUE constraint — we just don't want to surface the conflict UX)
    candidate, n = base, 1
    while exists(candidate):
        n += 1
        candidate = f"{base}-{n}"
    rows = store.pg(
        "INSERT INTO autopilot.ke_project (slug, name, primary_model) VALUES ("
        f"{store.dq(candidate)}, {store.dq(name)}, {store.dq(primary_model)}) "
        "RETURNING id, slug, name, primary_model, created_at;",
        capture=True)
    return rows[0]


def delete(slug: str) -> None:
    """Delete a project + all tenant-scoped rows. 'default' is protected."""
    if slug == "default":
        raise ValueError("cannot delete the default project")
    # ke_source → ke_chunk cascades via FK. The rest are scoped by tenant_id
    # string columns, so clean them explicitly in one txn.
    store.pg(
        "BEGIN; "
        f"DELETE FROM autopilot.ke_source   WHERE tenant_id = {store.dq(slug)}; "
        f"DELETE FROM autopilot.ke_apikey   WHERE tenant_id = {store.dq(slug)}; "
        f"DELETE FROM autopilot.ke_provider WHERE tenant_id = {store.dq(slug)}; "
        f"DELETE FROM autopilot.ke_request  WHERE tenant_id = {store.dq(slug)}; "
        f"DELETE FROM autopilot.ke_project  WHERE slug = {store.dq(slug)}; "
        "COMMIT;")
