#!/usr/bin/env python3
"""
Argus Reports — a dead-simple, real-data-only web view.

One page. No mock data. Reads the latest autopilot run straight from the
`argus` Postgres on every request and renders a clean executive report:
the bottom-line money number, the ranked findings, and click-to-open
receipt SQL. Nothing else.

    python3 report_server.py            # serve on http://localhost:8090
    python3 report_server.py 9000       # custom port
"""

from __future__ import annotations

import html
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import store  # reuse the argus-PG helper

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090

SEV = {
    "critical": ("#ef4444", "CRITICAL"),
    "high":     ("#f59e0b", "HIGH"),
    "medium":   ("#eab308", "MEDIUM"),
    "low":      ("#22c55e", "LOW"),
}


def money(v) -> str:
    try:
        return f"{float(v):,.0f} TND"
    except (TypeError, ValueError):
        return "0 TND"


def latest_run() -> dict | None:
    rows = store.pg(
        "SELECT id, target_db, started_at, total_opportunity, total_at_risk, "
        "playbooks_valid, memo_md FROM autopilot.run "
        "WHERE status='succeeded' ORDER BY id DESC LIMIT 1;", capture=True)
    return rows[0] if rows else None


def findings_for(run_id: str) -> list[dict]:
    return store.pg(
        "SELECT title, kind, severity, headline, gross_value, opportunity_value, "
        "basis, recommended_action, receipt_sql, metrics "
        f"FROM autopilot.finding WHERE run_id={int(run_id)} "
        "ORDER BY opportunity_value DESC;", capture=True)


def run_history() -> list[dict]:
    return store.pg(
        "SELECT id, started_at, total_opportunity, total_at_risk, playbooks_valid "
        "FROM autopilot.run WHERE status='succeeded' ORDER BY id DESC LIMIT 10;",
        capture=True)


def extract_summary(memo_md: str) -> str:
    if not memo_md or "## Executive summary" not in memo_md:
        return ""
    chunk = memo_md.split("## Executive summary", 1)[1]
    chunk = chunk.split("##", 1)[0]
    # drop the trailing "_↑ narrative…_" attribution line
    lines = [l for l in chunk.strip().splitlines() if not l.strip().startswith("_↑")]
    return " ".join(l.strip() for l in lines if l.strip())


def render(run: dict | None) -> str:
    if not run:
        body = "<p class='muted'>No runs yet. The daily job runs at 07:00, or run "
        body += "<code>python3 autopilot.py</code> to generate one now.</p>"
        return PAGE.format(title="Argus Reports", body=body, updated="")

    fs = findings_for(run["id"])
    summary = extract_summary(run.get("memo_md", ""))

    opp = money(run["total_opportunity"])
    risk = money(run["total_at_risk"])

    cards = []
    for i, f in enumerate(fs, 1):
        color, label = SEV.get(f["severity"], ("#94a3b8", f["severity"].upper()))
        try:
            metrics = json.loads(f["metrics"]) if isinstance(f["metrics"], str) else f["metrics"]
        except Exception:
            metrics = {}
        metric_str = ", ".join(f"{k} = {v}" for k, v in (metrics or {}).items())
        cards.append(CARD.format(
            n=i,
            title=html.escape(f["title"]),
            sev_color=color, sev_label=label,
            value=money(f["opportunity_value"]),
            gross=money(f["gross_value"]),
            headline=html.escape(f["headline"] or ""),
            basis=html.escape(f["basis"] or ""),
            action=html.escape(f["recommended_action"] or ""),
            sql=html.escape(f["receipt_sql"] or ""),
            metrics=html.escape(metric_str),
        ))

    hist = "".join(
        f"<tr><td>#{h['id']}</td><td>{h['started_at'][:16]}</td>"
        f"<td class='r'>{money(h['total_opportunity'])}</td>"
        f"<td class='r'>{money(h['total_at_risk'])}</td>"
        f"<td class='r'>{h['playbooks_valid']}</td></tr>"
        for h in run_history())

    body = HEADER.format(
        run_id=run["id"], target=html.escape(run["target_db"]),
        opp=opp, risk=risk, n=len(fs),
        summary=html.escape(summary) or "—",
        cards="".join(cards), history=hist,
    )
    return PAGE.format(title="Argus Reports", body=body,
                       updated=f"run #{run['id']} · {run['started_at'][:16]}")


# ---- templates ------------------------------------------------------------
PAGE = """<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
*{{box-sizing:border-box}}
body{{margin:0;background:#0b0f17;color:#e6edf3;font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif}}
.wrap{{max-width:860px;margin:0 auto;padding:28px 20px 80px}}
h1{{font-size:22px;margin:0}}
.muted{{color:#8b97a7}}
.bignums{{display:flex;gap:14px;margin:22px 0}}
.big{{flex:1;background:#121826;border:1px solid #1f2937;border-radius:14px;padding:18px}}
.big .lbl{{font-size:12px;letter-spacing:.08em;color:#8b97a7;text-transform:uppercase}}
.big .v{{font-size:30px;font-weight:700;margin-top:6px}}
.big.opp .v{{color:#34d399}} .big.risk .v{{color:#f59e0b}}
.summary{{background:#0f1625;border-left:3px solid #3b82f6;border-radius:8px;padding:16px 18px;margin:18px 0;color:#cdd9e5}}
.card{{background:#121826;border:1px solid #1f2937;border-radius:14px;padding:18px;margin:14px 0}}
.card .top{{display:flex;align-items:center;gap:10px;flex-wrap:wrap}}
.badge{{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;color:#0b0f17}}
.card h3{{margin:0;font-size:17px;flex:1}}
.val{{font-size:22px;font-weight:700;color:#34d399;white-space:nowrap}}
.gross{{font-size:12px;color:#8b97a7}}
.hl{{margin:10px 0;color:#cdd9e5}}
.kv{{font-size:13px;color:#9fb0c0;margin:4px 0}}
.kv b{{color:#cdd9e5}}
details{{margin-top:10px}} summary{{cursor:pointer;color:#60a5fa;font-size:13px}}
pre{{background:#0a0e15;border:1px solid #1f2937;border-radius:8px;padding:12px;overflow:auto;font-size:12px;color:#9fe8c0}}
table{{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}}
td,th{{padding:7px 8px;border-bottom:1px solid #1f2937;text-align:left}} .r{{text-align:right}}
a{{color:#60a5fa}}
.foot{{margin-top:30px;font-size:12px;color:#64748b}}
</style></head><body><div class=wrap>{body}
<p class=foot>Argus · live from Postgres · {updated} · refresh to update</p>
</div></body></html>"""

HEADER = """<h1>🛰️ Argus — Operational Intelligence</h1>
<p class=muted>Run #{run_id} · target <b>{target}</b> · {n} findings · all numbers are verified SQL results</p>
<div class=bignums>
  <div class="big opp"><div class=lbl>Realizable this run</div><div class=v>{opp}</div></div>
  <div class="big risk"><div class=lbl>Revenue at risk</div><div class=v>{risk}</div></div>
</div>
<div class=summary><b>Executive summary.</b> {summary}</div>
<h2 style="font-size:16px;margin-top:26px">Findings</h2>
{cards}
<h2 style="font-size:16px;margin-top:30px">Recent runs</h2>
<table><tr><th>Run</th><th>When</th><th class=r>Realizable</th><th class=r>At risk</th><th class=r>Findings</th></tr>{history}</table>"""

CARD = """<div class=card>
  <div class=top>
    <span class=badge style="background:{sev_color}">{sev_label}</span>
    <h3>{n}. {title}</h3>
    <span class=val>{value}</span>
  </div>
  <div class=gross>gross exposure {gross}</div>
  <div class=hl>{headline}</div>
  <div class=kv><b>Why this number:</b> {basis}</div>
  <div class=kv><b>Do this:</b> {action}</div>
  <details><summary>📎 Show the SQL that proves it</summary>
    <pre>{sql}</pre>
    <div class=kv>Result: <code>{metrics}</code></div>
  </details>
</div>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ("/", "/index.html"):
            self.send_response(404); self.end_headers(); return
        try:
            html_out = render(latest_run())
        except Exception as e:
            html_out = PAGE.format(title="Argus", body=f"<pre>error: {html.escape(str(e))}</pre>", updated="")
        data = html_out.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass  # quiet


if __name__ == "__main__":
    print(f"Argus Reports → http://localhost:{PORT}", file=sys.stderr)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
