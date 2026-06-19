"""Ingest pipeline: file or Q&A → chunks → embeddings → pgvector rows.

Supported file types: .txt, .md, .markdown, .html, .pdf.
PDFs are parsed with the `pypdf` package if installed, else a graceful error.

Chunking: ~512 token windows with 64-token overlap (heuristic by chars when
no tokenizer is around — 4 chars ≈ 1 token for English/French/Arabic mix).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import store
from . import providers


CHUNK_TARGET_CHARS = 2048   # ~512 tokens
CHUNK_OVERLAP_CHARS = 256   # ~64 tokens
EMBED_BATCH = 16            # respect Gemini RPM; embed sequentially per text


def _normalize(s: str) -> str:
    s = re.sub(r"\r\n?", "\n", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _chunk(text: str) -> list[str]:
    text = _normalize(text)
    if not text:
        return []
    # split on paragraph boundaries first, then accumulate to ~target size
    paras = re.split(r"\n\n+", text)
    out, buf = [], ""
    for p in paras:
        if not p.strip():
            continue
        if len(buf) + len(p) + 2 <= CHUNK_TARGET_CHARS:
            buf = (buf + "\n\n" + p) if buf else p
        else:
            if buf:
                out.append(buf)
            # if a single paragraph is too large, hard-split it
            while len(p) > CHUNK_TARGET_CHARS:
                out.append(p[:CHUNK_TARGET_CHARS])
                p = p[CHUNK_TARGET_CHARS - CHUNK_OVERLAP_CHARS:]
            buf = p
    if buf:
        out.append(buf)
    # add overlap between chunks for retrieval continuity
    overlapped = []
    for i, c in enumerate(out):
        if i > 0 and out[i - 1]:
            tail = out[i - 1][-CHUNK_OVERLAP_CHARS:]
            c = tail + "\n\n" + c
        overlapped.append(c[:CHUNK_TARGET_CHARS + CHUNK_OVERLAP_CHARS])
    return overlapped


def _extract_text(path: Path, mime: str | None) -> str:
    suf = path.suffix.lower()
    raw = path.read_bytes()
    if suf in (".txt", ".md", ".markdown"):
        return raw.decode("utf-8", errors="replace")
    if suf in (".html", ".htm"):
        # crude HTML strip — good enough for ingestion of policy/FAQ pages
        t = raw.decode("utf-8", errors="replace")
        t = re.sub(r"<script.*?</script>", "", t, flags=re.S | re.I)
        t = re.sub(r"<style.*?</style>", "", t, flags=re.S | re.I)
        t = re.sub(r"<[^>]+>", " ", t)
        return _normalize(t)
    if suf == ".pdf":
        try:
            from pypdf import PdfReader  # type: ignore
        except ImportError as e:
            raise RuntimeError("PDF ingest requires `pypdf` — run `pip install pypdf`.") from e
        reader = PdfReader(str(path))
        return "\n\n".join(p.extract_text() or "" for p in reader.pages)
    if mime and mime.startswith("text/"):
        return raw.decode("utf-8", errors="replace")
    raise RuntimeError(f"unsupported file type: {suf or mime or 'unknown'}")


def _emb_to_pgvector_literal(vec: list[float]) -> str:
    # pgvector accepts text "[v1,v2,...]"
    return "'[" + ",".join(f"{x:.6f}" for x in vec) + "]'"


def ingest_file(tenant_id: str, path: Path, title: str | None = None,
                mime: str | None = None, added_by: str | None = None) -> dict:
    """Parse + chunk + embed + persist. Returns {source_id, chunks, tokens}."""
    text = _extract_text(path, mime)
    chunks = _chunk(text)
    if not chunks:
        raise RuntimeError("no extractable text in file")
    src_rows = store.pg(
        "INSERT INTO autopilot.ke_source (tenant_id, kind, title, uri, bytes, mime, authority, added_by) VALUES ("
        f"{store.dq(tenant_id)}, 'file', {store.dq(title or path.name)}, {store.dq(str(path))}, "
        f"{path.stat().st_size}, {store.dq(mime)}, 0.6, {store.dq(added_by)}) RETURNING id;",
        capture=True)
    source_id = int(src_rows[0]["id"])

    # embed sequentially (Gemini one-text-per-call). Tracks cumulative tokens.
    total_tokens = 0
    for i, c in enumerate(chunks):
        vecs = providers.embed(tenant_id, [c])
        emb_lit = _emb_to_pgvector_literal(vecs[0])
        tok_est = max(1, len(c) // 4)
        total_tokens += tok_est
        store.pg(
            "INSERT INTO autopilot.ke_chunk (tenant_id, source_id, chunk_no, content, tokens, embedding) "
            f"VALUES ({store.dq(tenant_id)}, {source_id}, {i}, {store.dq(c)}, "
            f"{tok_est}, {emb_lit}::vector);")
    return {"source_id": source_id, "chunks": len(chunks), "tokens": total_tokens,
            "title": title or path.name}


def ingest_qa(tenant_id: str, question: str, answer: str,
              added_by: str | None = None) -> dict:
    """Answered Q&A counts as a high-authority single-chunk source."""
    content = f"Q: {question.strip()}\nA: {answer.strip()}"
    src_rows = store.pg(
        "INSERT INTO autopilot.ke_source (tenant_id, kind, title, uri, bytes, mime, authority, added_by) VALUES ("
        f"{store.dq(tenant_id)}, 'qa', {store.dq(question.strip()[:160])}, NULL, {len(content)}, "
        f"'text/plain', 0.9, {store.dq(added_by)}) RETURNING id;", capture=True)
    source_id = int(src_rows[0]["id"])
    vecs = providers.embed(tenant_id, [content])
    emb_lit = _emb_to_pgvector_literal(vecs[0])
    store.pg(
        "INSERT INTO autopilot.ke_chunk (tenant_id, source_id, chunk_no, content, tokens, embedding) "
        f"VALUES ({store.dq(tenant_id)}, {source_id}, 0, {store.dq(content)}, "
        f"{max(1, len(content) // 4)}, {emb_lit}::vector);")
    return {"source_id": source_id, "chunks": 1, "tokens": max(1, len(content) // 4)}


def list_sources(tenant_id: str = "default") -> list[dict]:
    return store.pgq(
        "SELECT s.id, s.kind, s.title, s.uri, s.bytes, s.authority, s.created_at, "
        "(SELECT COUNT(*) FROM autopilot.ke_chunk c WHERE c.source_id=s.id) AS chunks "
        f"FROM autopilot.ke_source s WHERE s.tenant_id={store.dq(tenant_id)} "
        "ORDER BY s.id DESC;")


def delete_source(tenant_id: str, source_id: int):
    store.pg(f"DELETE FROM autopilot.ke_source "
             f"WHERE tenant_id={store.dq(tenant_id)} AND id={int(source_id)};")
