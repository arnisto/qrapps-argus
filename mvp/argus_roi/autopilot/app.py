#!/usr/bin/env python3
"""
Argus — the one real UI.

A small, single-file web app. No mock data, no framework. Three pages:

  /            Reports    — the latest run's real findings (money, severity, SQL)
  /connectors  Connectors — the real databases Argus analyses; add/edit/enable/test
  /schedule    Schedule   — the real cron jobs; change the daily time, run now

Everything reads/writes the live `argus` Postgres and the user's crontab.
"less is more": just the pieces that do real work.

    python3 app.py            # http://localhost:8090
    python3 app.py 9000       # custom port
"""

from __future__ import annotations

import cgi
import glob
import html
import io
import json
import subprocess
import sys
import tempfile
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import store
from engine import providers as ke_providers
from engine import ingest as ke_ingest
from engine import keys as ke_keys
from engine import chat as ke_chat

try:
    import yaml
except ImportError:
    yaml = None

HERE = Path(__file__).resolve().parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
CRON_TAG = "argus-autopilot"   # marker comment on our cron line

SEV = {"critical": "#ef4444", "high": "#f59e0b", "medium": "#eab308", "low": "#22c55e"}


def money(v):
    try:
        return f"{float(v):,.0f} TND"
    except (TypeError, ValueError):
        return "0 TND"


def esc(s):
    return html.escape(str(s if s is not None else ""))


# ---------- data ----------
def latest_run():
    r = store.pgq("SELECT id,target_db,started_at,total_opportunity,total_at_risk,"
                 "playbooks_valid,memo_md,llm_model,llm_calls,tokens_in,tokens_out,cost_usd "
                 "FROM autopilot.run WHERE status='succeeded' ORDER BY id DESC LIMIT 1;")
    return r[0] if r else None


def findings_for(run_id):
    return store.pgq("SELECT title,severity,headline,gross_value,opportunity_value,basis,"
                    "recommended_action,receipt_sql,metrics FROM autopilot.finding "
                    f"WHERE run_id={int(run_id)} ORDER BY opportunity_value DESC;")


def runs_history():
    return store.pgq("SELECT id,target_db,started_at,total_opportunity,total_at_risk,playbooks_valid "
                    "FROM autopilot.run WHERE status='succeeded' ORDER BY id DESC LIMIT 8;")


def connectors():
    return store.pgq("SELECT id,name,dbname,pg_user,enabled,last_status,last_tested "
                    "FROM autopilot.connector ORDER BY id;")


def exec_summary(memo):
    if not memo or "## Executive summary" not in memo:
        return ""
    c = memo.split("## Executive summary", 1)[1].split("##", 1)[0]
    return " ".join(l.strip() for l in c.splitlines()
                    if l.strip() and not l.strip().startswith("_↑"))


def get_crontab():
    p = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    return p.stdout if p.returncode == 0 else ""


def llm_calls_for(run_id):
    return store.pgq("SELECT purpose,model,tokens_in,tokens_out,latency_ms,cost_usd,ok "
                    f"FROM autopilot.llm_call WHERE run_id={int(run_id)} ORDER BY id;")


def usage_history():
    return store.pgq("SELECT id,target_db,started_at,llm_model,llm_calls,tokens_in,tokens_out,cost_usd "
                    "FROM autopilot.run WHERE status='succeeded' AND llm_calls>0 "
                    "ORDER BY id DESC LIMIT 12;")


def playbooks_db():
    return store.pgq("SELECT DISTINCT ON (playbook_key) playbook_key,title,kind,hypothesis,valid,"
                    "validation_note,generated_by,target_db,created_at FROM autopilot.playbook "
                    "ORDER BY playbook_key, created_at DESC;")


def playbooks_yaml():
    out = []
    pbdir = HERE.parent / "playbooks"
    for fp in sorted(glob.glob(str(pbdir / "*.yaml"))):
        try:
            d = yaml.safe_load(Path(fp).read_text()) if yaml else {}
        except Exception:
            d = {}
        out.append({"file": Path(fp).name, "id": d.get("id", ""), "title": d.get("title", ""),
                    "kind": d.get("kind", ""), "hypothesis": (d.get("hypothesis") or "").strip(),
                    "action": (d.get("recommended_action") or "").strip()})
    return out


# ---------- chrome ----------
def page(active, body):
    nav = "".join(
        f'<a href="{href}" class="{ "on" if active==key else "" }">{label}</a>'
        for key, href, label in (("reports", "/", "Reports"),
                                  ("connectors", "/connectors", "Connectors"),
                                  ("playbooks", "/playbooks", "Playbooks"),
                                  ("usage", "/usage", "LLM Usage"),
                                  ("schedule", "/schedule", "Schedule"),
                                  ("help", "/help", "Help")))
    return f"""<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Argus</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;background:#0b0f17;color:#e6edf3;
font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif}}
header{{display:flex;align-items:center;gap:22px;padding:14px 22px;border-bottom:1px solid #1f2937;
background:#0d1320;position:sticky;top:0;z-index:9}}
header .brand{{font-weight:700;font-size:17px}}
header a{{color:#8b97a7;text-decoration:none;font-size:14px;padding:6px 2px}}
header a.on{{color:#e6edf3;border-bottom:2px solid #3b82f6}}
.wrap{{max-width:880px;margin:0 auto;padding:24px 20px 90px}}
h1{{font-size:20px;margin:0 0 4px}}.muted{{color:#8b97a7}}
.bignums{{display:flex;gap:14px;margin:20px 0}}
.big{{flex:1;background:#121826;border:1px solid #1f2937;border-radius:14px;padding:16px}}
.big .lbl{{font-size:11px;letter-spacing:.08em;color:#8b97a7;text-transform:uppercase}}
.big .v{{font-size:28px;font-weight:700;margin-top:6px}}.big.opp .v{{color:#34d399}}.big.risk .v{{color:#f59e0b}}
.summary{{background:#0f1625;border-left:3px solid #3b82f6;border-radius:8px;padding:14px 16px;margin:16px 0;color:#cdd9e5}}
.card{{background:#121826;border:1px solid #1f2937;border-radius:14px;padding:16px;margin:12px 0}}
.card .top{{display:flex;align-items:center;gap:10px;flex-wrap:wrap}}
.badge{{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;color:#0b0f17}}
.card h3{{margin:0;font-size:16px;flex:1}}.val{{font-size:20px;font-weight:700;color:#34d399;white-space:nowrap}}
.gross{{font-size:12px;color:#8b97a7}}.hl{{margin:8px 0;color:#cdd9e5}}
.kv{{font-size:13px;color:#9fb0c0;margin:3px 0}}.kv b{{color:#cdd9e5}}
details{{margin-top:8px}}summary{{cursor:pointer;color:#60a5fa;font-size:13px}}
pre{{background:#0a0e15;border:1px solid #1f2937;border-radius:8px;padding:11px;overflow:auto;font-size:12px;color:#9fe8c0}}
table{{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}}
td,th{{padding:8px;border-bottom:1px solid #1f2937;text-align:left}}.r{{text-align:right}}
input,select{{background:#0a0e15;border:1px solid #2a3647;color:#e6edf3;border-radius:8px;padding:8px 10px;font-size:14px}}
button,.btn{{background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}}
button.sec{{background:#243044}}button.danger{{background:#7f1d1d}}
.pill{{font-size:11px;padding:2px 8px;border-radius:999px}}.pill.on{{background:#064e3b;color:#34d399}}.pill.off{{background:#3a2030;color:#fca5a5}}
form.inline{{display:inline}}
.row{{display:flex;gap:8px;align-items:center;flex-wrap:wrap}}
.foot{{margin-top:30px;font-size:12px;color:#64748b}}a{{color:#60a5fa}}
</style></head><body>
<header><span class=brand>🛰️ Argus</span>{nav}
<span style="margin-left:auto" class=muted>operational intelligence · live</span></header>
<div class=wrap>{body}<p class=foot>Live from Postgres · refresh to update</p></div>
</body></html>"""


# ---------- pages ----------
def view_reports():
    run = latest_run()
    if not run:
        return page("reports", "<h1>Reports</h1><p class=muted>No runs yet. Go to "
                    "<a href=/schedule>Schedule</a> and click <b>Run now</b>.</p>")
    fs = findings_for(run["id"])
    cards = ""
    for i, f in enumerate(fs, 1):
        try:
            m = json.loads(f["metrics"]) if isinstance(f["metrics"], str) else (f["metrics"] or {})
        except Exception:
            m = {}
        metric_str = ", ".join(f"{k}={v}" for k, v in m.items())
        cards += f"""<div class=card><div class=top>
<span class=badge style="background:{SEV.get(f['severity'],'#94a3b8')}">{f['severity'].upper()}</span>
<h3>{i}. {esc(f['title'])}</h3><span class=val>{money(f['opportunity_value'])}</span></div>
<div class=gross>gross exposure {money(f['gross_value'])}</div>
<div class=hl>{esc(f['headline'])}</div>
<div class=kv><b>Why this number:</b> {esc(f['basis'])}</div>
<div class=kv><b>Do this:</b> {esc(f['recommended_action'])}</div>
<details><summary>📎 Show the SQL that proves it</summary>
<pre>{esc(f['receipt_sql'])}</pre><div class=kv>Result: <code>{esc(metric_str)}</code></div>
</details></div>"""
    hist = "".join(f"<tr><td>#{h['id']}</td><td>{esc(h['target_db'])}</td><td>{h['started_at'][:16]}</td>"
                   f"<td class=r>{money(h['total_opportunity'])}</td><td class=r>{money(h['total_at_risk'])}</td></tr>"
                   for h in runs_history())
    llm_line = ""
    if run.get("llm_model"):
        llm_line = (f"<p class=muted>🧠 powered by <b>{esc(run['llm_model'])}</b> · "
                    f"{run['llm_calls']} calls · {int(run['tokens_in']):,}+{int(run['tokens_out']):,} tokens · "
                    f"~${float(run['cost_usd']):.4f} · <a href=/usage>usage details →</a></p>")
    body = f"""<h1>Reports</h1>
<p class=muted>Run #{run['id']} · target <b>{esc(run['target_db'])}</b> · {len(fs)} findings · {run['started_at'][:16]}</p>
{llm_line}
<div class=bignums>
<div class="big opp"><div class=lbl>Realizable this run</div><div class=v>{money(run['total_opportunity'])}</div></div>
<div class="big risk"><div class=lbl>Revenue at risk</div><div class=v>{money(run['total_at_risk'])}</div></div></div>
<div class=summary><b>Executive summary.</b> {esc(exec_summary(run.get('memo_md','')) or '—')}</div>
<h2 style="font-size:15px">Findings</h2>{cards}
<h2 style="font-size:15px;margin-top:26px">Recent runs</h2>
<table><tr><th>Run</th><th>Target</th><th>When</th><th class=r>Realizable</th><th class=r>At risk</th></tr>{hist}</table>"""
    return page("reports", body)


def view_connectors():
    rows = ""
    for c in connectors():
        en = c["enabled"] in ("t", True, "true")
        pill = '<span class="pill on">enabled</span>' if en else '<span class="pill off">disabled</span>'
        status = esc(c["last_status"] or "—")
        rows += f"""<tr><td><b>{esc(c['name'])}</b></td><td><code>{esc(c['dbname'])}</code></td>
<td>{esc(c['pg_user'])}</td><td>{pill}</td><td class=muted>{status}</td>
<td class=row>
<form class=inline method=post action=/connectors/test><input type=hidden name=id value={c['id']}><button class=sec>Test</button></form>
<form class=inline method=post action=/connectors/toggle><input type=hidden name=id value={c['id']}><button class=sec>{'Disable' if en else 'Enable'}</button></form>
<form class=inline method=post action=/connectors/delete onsubmit="return confirm('Delete connector?')"><input type=hidden name=id value={c['id']}><button class=danger>Delete</button></form>
</td></tr>"""
    body = f"""<h1>Connectors</h1>
<p class=muted>The real databases Argus analyses. Enabled ones are included in each daily run.</p>
<table><tr><th>Name</th><th>Database</th><th>User</th><th>Status</th><th>Last test</th><th></th></tr>{rows}</table>
<h2 style="font-size:15px;margin-top:24px">Add a connector</h2>
<form method=post action=/connectors/add class=row>
<input name=name placeholder="Name (e.g. Intigo Finance)" required>
<input name=dbname placeholder="postgres db name" required>
<input name=pg_user placeholder="db user" value="mehdi">
<button>Add connector</button></form>"""
    return page("connectors", body)


def view_schedule():
    ct = get_crontab()
    our = [l for l in ct.splitlines() if CRON_TAG in l or "cron.sh" in l]
    hour = "7"
    for l in our:
        parts = l.split()
        if len(parts) >= 2 and parts[1].isdigit():
            hour = parts[1]
            break
    options = "".join(f'<option value="{h}" {"selected" if str(h)==hour else ""}>{h:02d}:00</option>'
                      for h in range(24))
    cron_show = esc(ct.strip() or "(no crontab)")
    body = f"""<h1>Schedule</h1>
<p class=muted>Argus runs automatically every day. Change the time or run it on demand.</p>
<div class=card>
<div class=row><b>Daily run time:</b>
<form method=post action=/schedule/set class=row>
<select name=hour>{options}</select><button>Save time</button></form>
<form method=post action=/run-now class=inline><button class=sec>▶ Run now</button></form>
</div></div>
<h2 style="font-size:15px;margin-top:20px">Active cron jobs (real)</h2>
<pre>{cron_show}</pre>
<p class=muted>The <code>@reboot</code> line keeps this UI alive; the <code>0 H * * *</code> line runs the analysis.</p>"""
    return page("schedule", body)


def view_usage():
    run = latest_run()
    body = "<h1>LLM Usage</h1><p class=muted>Exactly which model ran, how many tokens, and the estimated cost. Numbers come from the provider's usage metadata.</p>"
    if run and run.get("llm_model"):
        calls = llm_calls_for(run["id"])
        body += f"""<div class=bignums>
<div class=big><div class=lbl>Model</div><div class=v style="font-size:18px">{esc(run['llm_model'])}</div></div>
<div class=big><div class=lbl>Calls (run #{run['id']})</div><div class=v>{run['llm_calls']}</div></div>
<div class=big><div class=lbl>Tokens</div><div class=v style="font-size:20px">{int(run['tokens_in']):,}<span class=muted style="font-size:13px"> in</span> · {int(run['tokens_out']):,}<span class=muted style="font-size:13px"> out</span></div></div>
<div class=big><div class=lbl>Est. cost</div><div class=v>${float(run['cost_usd']):.4f}</div></div></div>
<h2 style="font-size:15px">Calls this run</h2>
<table><tr><th>Purpose</th><th>Model</th><th class=r>Tokens in</th><th class=r>Tokens out</th><th class=r>Latency</th><th class=r>Cost</th><th>OK</th></tr>"""
        for c in calls:
            ok = "✓" if c["ok"] in ("t", True, "true") else "✗"
            body += (f"<tr><td>{esc(c['purpose'])}</td><td>{esc(c['model'])}</td>"
                     f"<td class=r>{int(c['tokens_in']):,}</td><td class=r>{int(c['tokens_out']):,}</td>"
                     f"<td class=r>{int(c['latency_ms'])} ms</td><td class=r>${float(c['cost_usd']):.5f}</td><td>{ok}</td></tr>")
        body += "</table>"
    else:
        body += "<p class=muted>No LLM usage recorded yet. Run an analysis from <a href=/schedule>Schedule</a>.</p>"

    hist = "".join(f"<tr><td>#{h['id']}</td><td>{esc(h['target_db'])}</td><td>{h['started_at'][:16]}</td>"
                   f"<td>{esc(h['llm_model'] or '')}</td><td class=r>{h['llm_calls']}</td>"
                   f"<td class=r>{int(h['tokens_in']):,}</td><td class=r>{int(h['tokens_out']):,}</td>"
                   f"<td class=r>${float(h['cost_usd']):.4f}</td></tr>" for h in usage_history())
    body += (f"<h2 style='font-size:15px;margin-top:24px'>Cost per run (history)</h2>"
             f"<table><tr><th>Run</th><th>Target</th><th>When</th><th>Model</th><th class=r>Calls</th>"
             f"<th class=r>In</th><th class=r>Out</th><th class=r>Cost</th></tr>{hist}</table>"
             f"<p class=muted style='margin-top:10px'>Pricing is an estimate "
             f"(gemini-2.5-flash ≈ $0.30/1M in, $2.50/1M out incl. thinking). Tune in <code>llm.py</code>.</p>")
    return page("usage", body)


def view_playbooks():
    yamls = playbooks_yaml()
    yrows = "".join(
        f"<div class=card><div class=top><span class=badge style='background:#334155'>SEED</span>"
        f"<h3>{esc(p['title'] or p['id'])}</h3><span class=muted>{esc(p['file'])}</span></div>"
        f"<div class=hl>{esc(p['hypothesis'])}</div>"
        f"<div class=kv><b>Action:</b> {esc(p['action'])}</div></div>" for p in yamls)

    dbpbs = playbooks_db()
    drows = ""
    for p in dbpbs:
        valid = p["valid"] in ("t", True, "true")
        badge = ("#064e3b" if valid else "#3a2030")
        lbl = "VALID" if valid else "REJECTED"
        drows += (f"<div class=card><div class=top>"
                  f"<span class=badge style='background:{badge};color:#fff'>{lbl}</span>"
                  f"<h3>{esc(p['title'])}</h3><span class=muted>{esc(p['kind'])}</span></div>"
                  f"<div class=hl>{esc(p['hypothesis'] or '')}</div>"
                  f"<div class=kv><b>Source:</b> {esc(p['generated_by'])} · target {esc(p['target_db'])} · "
                  f"{esc((p['validation_note'] or '')[:80])}</div></div>")

    body = (f"<h1>Playbooks</h1>"
            f"<p class=muted>The questions Argus asks your data. Two kinds: hand-written seed YAML files, "
            f"and the ones the LLM invents each run (stored in the DB, valid + rejected).</p>"
            f"<h2 style='font-size:15px'>Seed playbooks — <code>mvp/argus_roi/playbooks/*.yaml</code> ({len(yamls)})</h2>{yrows}"
            f"<h2 style='font-size:15px;margin-top:24px'>LLM-generated playbooks ({len(dbpbs)} unique)</h2>{drows or '<p class=muted>None yet — run an analysis.</p>'}")
    return page("playbooks", body)


def view_help():
    body = """<h1>How Argus works</h1>
<p class=muted>The whole system on one page. Less is more.</p>

<div class=card><h3>What it does</h3>
<div class=hl>Every day, Argus connects to your databases, asks an LLM to invent
"playbooks" (money-finding questions), runs them against your live data, sizes each
finding in TND, and shows you a ranked report. You never write SQL or prompts.</div></div>

<div class=card><h3>The daily loop</h3>
<div class=kv><b>1. Map</b> — reads your DB structure (tables, columns, relationships).</div>
<div class=kv><b>2. Generate</b> — the LLM invents opportunity playbooks from that map. <a href=/playbooks>See playbooks →</a></div>
<div class=kv><b>3. Validate</b> — runs each playbook's SQL read-only; if it errors, the LLM fixes it (up to 3 tries).</div>
<div class=kv><b>4. Size</b> — multiplies the raw number by a conservative "realization factor" to estimate recoverable value.</div>
<div class=kv><b>5. Report</b> — ranks findings, writes a summary, stores everything. <a href=/>See reports →</a></div></div>

<div class=card><h3>The pages</h3>
<div class=kv><b>Reports</b> — the money findings from the latest run, each with the exact SQL that proves it.</div>
<div class=kv><b>Connectors</b> — the databases Argus analyses. Enable/disable/add/test them.</div>
<div class=kv><b>Playbooks</b> — every question Argus asks (seed + LLM-invented).</div>
<div class=kv><b>LLM Usage</b> — which model ran, token counts, estimated cost per run.</div>
<div class=kv><b>Schedule</b> — when the daily run happens; change the time or run now.</div></div>

<div class=card><h3>What you can trust</h3>
<div class=kv>• Every number is a real SQL result — the database is the calculator, never the LLM.</div>
<div class=kv>• Every finding has a "Show the SQL" button — click to verify.</div>
<div class=kv>• All DB access is read-only with a 30-second timeout. Argus never writes to your data.</div></div>

<div class=card><h3>Honest limits (today)</h3>
<div class=kv>• The LLM invents fresh playbooks each run, so the total swings day to day — great for discovery, not yet for tracking the same number over time.</div>
<div class=kv>• Realization factors are estimates, not calibrated to your real recovery rates.</div>
<div class=kv>• Local tool: needs this machine on + Docker (argus Postgres/Redis) up. No login yet — don't expose port 8090 to the internet.</div></div>

<p class=muted>Repo: <code>mvp/argus_roi/autopilot/</code> · data in the <code>argus</code> Postgres (schema <code>autopilot</code>) + Redis key <code>argus:latest</code>.</p>"""
    return page("help", body)


# ============================================================================
#  WORKING KNOWLEDGE-ENGINE PAGES  (separate from the Claude design preview)
# ============================================================================

def _ke_chrome(active: str, body: str) -> str:
    nav_items = [
        ("teach",      "/teach",      "Teach"),
        ("models",     "/models",     "Models"),
        ("api",        "/api",        "Developer API"),
        ("playground", "/playground", "Playground"),
    ]
    nav = " · ".join(
        f'<a href="{href}" style="color:{"#3b82f6" if active==key else "#94a3b8"};text-decoration:none;font-weight:{600 if active==key else 500};">{label}</a>'
        for key, href, label in nav_items)
    return f"""<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Argus · {active}</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;background:#0b0f17;color:#e6edf3;
font:14px/1.55 ui-sans-serif,system-ui,sans-serif}}
header{{display:flex;align-items:center;gap:18px;padding:13px 22px;border-bottom:1px solid #1f2937;background:#0d1320;position:sticky;top:0;z-index:9}}
header .brand{{font-weight:700;font-size:16px}}
header a:hover{{color:#cdd9e5!important}}
.wrap{{max-width:980px;margin:0 auto;padding:22px 20px 80px}}
h1{{font-size:20px;margin:0 0 6px}}.muted{{color:#8b97a7;font-size:13px}}
.card{{background:#121826;border:1px solid #1f2937;border-radius:12px;padding:16px;margin:14px 0}}
.card h2{{margin:0 0 10px;font-size:15px;color:#cdd9e5}}
table{{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}}
td,th{{padding:8px 10px;border-bottom:1px solid #1f2937;text-align:left;vertical-align:top}}.r{{text-align:right}}
input,select,textarea{{background:#0a0e15;border:1px solid #2a3647;color:#e6edf3;border-radius:8px;padding:8px 10px;font-size:14px;font-family:inherit;width:100%}}
textarea{{min-height:90px}}
button,.btn{{background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer}}
button.sec{{background:#243044}}button.danger{{background:#7f1d1d}}
.kv{{display:grid;grid-template-columns:140px 1fr;gap:8px 12px;font-size:13px}}.kv b{{color:#cdd9e5}}
.row{{display:flex;gap:8px;align-items:center;flex-wrap:wrap}}
.pill{{font-size:11px;padding:2px 8px;border-radius:999px;background:#1d4ed8;color:#fff}}
.pill.gray{{background:#243044;color:#cdd9e5}}
pre{{background:#0a0e15;border:1px solid #1f2937;border-radius:8px;padding:11px;overflow:auto;font-size:12px;color:#9fe8c0;white-space:pre-wrap;word-break:break-all}}
form.inline{{display:inline}} a{{color:#60a5fa;text-decoration:none}}
.warn{{background:#3a2030;color:#fca5a5;padding:8px 12px;border-radius:8px;font-size:13px;margin:8px 0}}
.ok{{background:#0b3322;color:#34d399;padding:8px 12px;border-radius:8px;font-size:13px;margin:8px 0}}
</style></head><body>
<header><span class=brand>🛰️ Argus</span>
<a href="/" style="color:#94a3b8;text-decoration:none">design preview</a>
<span style="color:#3a4452">·</span>{nav}
<span style="margin-left:auto" class=muted>knowledge layer · /v1 API</span></header>
<div class=wrap>{body}</div></body></html>"""


def _human_bytes(n):
    if not n: return "—"
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024: return f"{n:.0f} {u}"
        n /= 1024
    return f"{n:.1f} TB"


def view_teach():
    sources = ke_ingest.list_sources("default")
    rows = ""
    for s in sources:
        kind_pill = '<span class="pill gray">file</span>' if s["kind"] == "file" else \
                    '<span class="pill" style="background:#064e3b;color:#34d399">Q&A</span>'
        rows += (f"<tr><td>{kind_pill}</td><td><b>{esc(s['title'])}</b><div class=muted>"
                 f"{esc(s.get('uri') or '')}</div></td>"
                 f"<td>{int(s.get('chunks',0))}</td>"
                 f"<td>{_human_bytes(s.get('bytes') or 0)}</td>"
                 f"<td>{esc(s['created_at'][:16])}</td>"
                 f"<td><form class=inline method=post action=/teach/delete onsubmit=\"return confirm('Delete?')\">"
                 f"<input type=hidden name=id value={s['id']}><button class=danger>Delete</button></form></td></tr>")

    body = f"""<h1>Teach Argus</h1>
<p class=muted>Upload files (PDF / MD / TXT / HTML) or add answered Q&A. Each one is chunked, embedded with Gemini text-embedding-004, and indexed in pgvector. Anything you teach is then available to <code>/v1/chat</code>.</p>

<div class=card><h2>Upload a file</h2>
<form method=post action=/teach/upload enctype=multipart/form-data class=row>
<input type=file name=file required style="max-width:380px">
<button>Ingest file</button>
</form>
<div class=muted style="margin-top:6px">PDFs require <code>pypdf</code> in the runtime. Otherwise: txt/md/markdown/html.</div></div>

<div class=card><h2>Add an answered Q&A</h2>
<form method=post action=/teach/qa>
<div style="display:grid;gap:8px">
<input name=question placeholder="Question (what customers ask)" required>
<textarea name=answer placeholder="The grounded answer (becomes a high-authority fact)" required></textarea>
<div><button>Add Q&A</button></div>
</div></form></div>

<div class=card><h2>Sources ({len(sources)})</h2>
<table><tr><th>Kind</th><th>Title</th><th>Chunks</th><th>Size</th><th>Added</th><th></th></tr>
{rows or '<tr><td colspan=6 class=muted style="text-align:center;padding:24px">Nothing yet — upload a file above.</td></tr>'}
</table></div>"""
    return _ke_chrome("teach", body)


def view_models():
    rows = ""
    for p in ke_providers.list_providers("default"):
        enabled = '<span class="pill" style="background:#064e3b;color:#34d399">enabled</span>' if (p["enabled"] in ("t", True, "true")) else '<span class="pill" style="background:#3a2030;color:#fca5a5">off</span>'
        rows += (f"<tr><td><b>{esc(p['name'])}</b></td><td>{esc(p['default_model'])}</td>"
                 f"<td>{esc(p.get('base_url') or '—')}</td><td>{enabled}</td>"
                 f"<td>{esc(p['created_at'][:16])}</td>"
                 f"<td><a class=btn href='/v1/providers/test/{p['name']}' target=_blank>Test</a> "
                 f"<form class=inline method=post action=/models/delete onsubmit=\"return confirm('Delete provider?')\">"
                 f"<input type=hidden name=id value={p['id']}><button class=danger>Delete</button></form></td></tr>")

    body = f"""<h1>Models</h1>
<p class=muted>Connect any LLM provider. Argus stores the API key encrypted (AES-GCM via APP_SECRET). Same model goes through Argus on every /v1/chat call — Argus just injects your knowledge.</p>

<div class=card><h2>Connect a provider</h2>
<form method=post action=/models/add>
<div style="display:grid;gap:8px;grid-template-columns:1fr 1fr">
  <label>Name <select name=name>
    <option value=gemini>gemini</option>
    <option value=groq>groq</option>
    <option value=openai>openai</option></select></label>
  <label>API key <input name=api_key required type=password placeholder="paste API key"></label>
  <label>Default model <input name=default_model required value="gemini-2.5-flash" placeholder="e.g. gemini-2.5-flash, llama-3.1-70b-versatile, gpt-4o-mini"></label>
  <label>Base URL (optional) <input name=base_url placeholder="leave empty for default"></label>
</div>
<div style="margin-top:8px"><button>Connect</button></div>
</form>
<div class=muted style="margin-top:6px">Gemini is also used for embeddings (text-embedding-004, 768-dim). Add Gemini first so ingestion works.</div></div>

<div class=card><h2>Connected providers</h2>
<table><tr><th>Provider</th><th>Default model</th><th>Base URL</th><th></th><th>Added</th><th></th></tr>
{rows or '<tr><td colspan=6 class=muted style="text-align:center;padding:24px">No providers yet.</td></tr>'}
</table></div>"""
    return _ke_chrome("models", body)


def view_api(revealed_key: str | None = None):
    keys = ke_keys.list_keys("default")
    reqs = ke_chat.list_requests("default", limit=20)

    krows = ""
    for k in keys:
        active = (k["enabled"] in ("t", True, "true"))
        pill = '<span class="pill" style="background:#064e3b;color:#34d399">active</span>' if active else '<span class="pill" style="background:#3a2030;color:#fca5a5">revoked</span>'
        krows += (f"<tr><td><b>{esc(k['name'])}</b></td>"
                  f"<td><code>{esc(k['key_prefix'])}</code></td>"
                  f"<td>{pill}</td>"
                  f"<td>{int(k.get('rate_per_min') or 0)}/min</td>"
                  f"<td>{esc(k['created_at'][:16])}</td>"
                  f"<td>{esc((k.get('last_used_at') or '')[:16] or '—')}</td>"
                  f"<td><form class=inline method=post action=/api/revoke-key><input type=hidden name=id value={k['id']}><button class=sec>Revoke</button></form></td></tr>")

    reveal_box = ""
    if revealed_key:
        reveal_box = (f"<div class=ok><b>Save this key now</b> — it's only shown once. "
                      f"<br><pre style='margin-top:6px'>{esc(revealed_key)}</pre></div>")

    rrows = ""
    for r in reqs:
        rrows += (f"<tr><td>{esc(r['created_at'][:16])}</td>"
                  f"<td>{esc(r['provider'])}/{esc(r['model'])}</td>"
                  f"<td>{esc(r.get('apikey_name') or '—')}</td>"
                  f"<td class=r>{int(r.get('prompt_tokens') or 0)} → {int(r.get('completion_tokens') or 0)}</td>"
                  f"<td class=r>{int(r.get('latency_ms') or 0)} ms</td>"
                  f"<td class=r>${float(r.get('cost_usd') or 0):.5f}</td>"
                  f"<td class=r>{int(r.get('chunks_used') or 0)}</td>"
                  f"<td>{esc(r['status'])}</td></tr>")

    body = f"""<h1>Developer API</h1>
<p class=muted>Use the same models you connected, but through Argus — every call gets your knowledge injected, with citations. <b>OpenAI-compatible</b>: drop into any client by setting <code>baseUrl = http://localhost:8090/v1</code> and using an Argus API key.</p>

{reveal_box}

<div class=card><h2>API keys</h2>
<form method=post action=/api/create-key class=row style="margin-bottom:10px">
<input name=name placeholder="key name (e.g. 'My App Prod')" required style="max-width:280px">
<button>Create new key</button>
</form>
<table><tr><th>Name</th><th>Prefix</th><th></th><th>Rate</th><th>Created</th><th>Last used</th><th></th></tr>
{krows or '<tr><td colspan=7 class=muted style="text-align:center;padding:24px">No keys yet.</td></tr>'}
</table></div>

<div class=card><h2>Use the API</h2>
<h3 style="font-size:13px;margin:10px 0 4px;color:#cdd9e5">curl</h3>
<pre>curl http://localhost:8090/v1/chat/completions \\
  -H "Authorization: Bearer $ARGUS_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{{
    "model": "gemini-2.5-flash",
    "messages": [{{"role": "user", "content": "What is your refund policy?"}}]
  }}'</pre>
<h3 style="font-size:13px;margin:14px 0 4px;color:#cdd9e5">Python (openai SDK — same call, swapped baseUrl)</h3>
<pre>from openai import OpenAI
client = OpenAI(api_key="ak_live_…", base_url="http://localhost:8090/v1")
resp = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{{"role": "user", "content": "What is your refund policy?"}}],
)
print(resp.choices[0].message.content)
print(resp.argus_citations)   # which chunks were used</pre>
<div class=muted>The response shape mirrors OpenAI exactly, plus an <code>argus_citations</code> array naming the chunks used to ground the answer. <code>argus_warning: "no_grounded_context"</code> appears when retrieval returned nothing relevant.</div></div>

<div class=card><h2>Recent requests ({len(reqs)})</h2>
<table><tr><th>When</th><th>Model</th><th>Key</th><th class=r>Tokens</th><th class=r>Latency</th><th class=r>Cost</th><th class=r>Chunks</th><th>Status</th></tr>
{rrows or '<tr><td colspan=8 class=muted style="text-align:center;padding:24px">No requests yet.</td></tr>'}
</table></div>"""
    return _ke_chrome("api", body)


def view_playground(prompt: str = "", model: str = "gemini-2.5-flash",
                    answer: str | None = None, citations: list | None = None):
    provs = ke_providers.list_providers("default")
    model_opts = "".join(f'<option value="{esc(p["default_model"])}" {"selected" if p["default_model"]==model else ""}>{esc(p["name"])} → {esc(p["default_model"])}</option>'
                          for p in provs) or '<option value="">(no providers connected — visit /models)</option>'
    cit_html = ""
    if citations:
        rows = "".join(f"<tr><td>[#{i+1}]</td><td>{esc(c['source_title'])}</td><td>{esc(c.get('source_kind') or '')}</td><td class=r>{c['score']:.3f}</td></tr>"
                        for i, c in enumerate(citations))
        cit_html = f"<div class=card><h2>Citations</h2><table><tr><th></th><th>Source</th><th>Kind</th><th class=r>Score</th></tr>{rows}</table></div>"
    elif answer is not None:
        cit_html = "<div class=warn>No grounded context retrieved — the model answered without your knowledge.</div>"
    ans_html = ""
    if answer is not None:
        ans_html = f"<div class=card><h2>Answer</h2><pre style='color:#e6edf3;white-space:pre-wrap'>{esc(answer)}</pre></div>{cit_html}"
    body = f"""<h1>Playground</h1>
<p class=muted>Try Argus end-to-end: pick a connected model, ask a question, see the answer + which chunks grounded it.</p>
<div class=card><form method=post action=/playground/run>
<label>Model <select name=model>{model_opts}</select></label>
<div style="margin-top:8px"><label>Question <textarea name=q placeholder="Ask anything about what you've taught Argus.">{esc(prompt)}</textarea></label></div>
<div style="margin-top:8px"><button>Ask</button></div>
</form></div>
{ans_html}"""
    return _ke_chrome("playground", body)


# ============================================================================
#  AUTOPILOT PAGES (existing — preserved under /old/*)
# ============================================================================


# ---------- actions ----------
def test_connector(cid):
    rows = store.pgq(f"SELECT dbname,pg_user FROM autopilot.connector WHERE id={int(cid)};")
    if not rows:
        return
    db, user = rows[0]["dbname"], rows[0]["pg_user"]
    p = subprocess.run(["psql", "-U", user, "-d", db, "-tAc", "SELECT 1;"],
                       capture_output=True, text=True, timeout=15)
    ok = p.returncode == 0 and p.stdout.strip() == "1"
    status = "ok ✓" if ok else f"FAILED: {p.stderr.strip()[:60]}"
    store.pg(f"UPDATE autopilot.connector SET last_status={store.dq(status)}, "
             f"last_tested=now(), updated_at=now() WHERE id={int(cid)};")


def run_now():
    subprocess.Popen(["python3", str(HERE / "autopilot.py"), "--all-enabled"],
                     cwd=str(HERE),
                     stdout=open(HERE / "logs" / "run_now.log", "a"),
                     stderr=subprocess.STDOUT)


def set_schedule(hour):
    hour = int(hour)
    ct = get_crontab().splitlines()
    cron_sh = str(HERE / "cron.sh")
    log = str(HERE / "logs" / "cron.log")
    kept = [l for l in ct if "cron.sh" not in l]
    kept.append(f"{0} {hour} * * * {cron_sh} >> {log} 2>&1  # {CRON_TAG}")
    subprocess.run(["crontab", "-"], input="\n".join(kept) + "\n", text=True)


# ---------- http ----------
class H(BaseHTTPRequestHandler):
    def _send(self, body, code=200, ctype="text/html; charset=utf-8"):
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _redirect(self, to):
        self.send_response(303)
        self.send_header("Location", to)
        self.end_headers()

    def _form(self):
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n).decode()
        return {k: v[0] for k, v in urllib.parse.parse_qs(raw).items()}

    def _send_static(self, fp: Path, ctype: str):
        data = fp.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj, code=200):
        data = json.dumps(obj, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _bearer(self) -> str | None:
        auth = self.headers.get("Authorization", "")
        return auth[7:].strip() if auth.startswith("Bearer ") else None

    def _require_apikey(self):
        info = ke_keys.verify(self._bearer() or "")
        if not info:
            self._json({"error": {"message": "missing or invalid bearer token", "type": "auth"}}, 401)
            return None
        return info

    def do_GET(self):
        try:
            console_dir = HERE / "console"
            # ----- Claude design preview (the polished mockup) -----
            if self.path in ("/", "/index.html", "/console", "/console/", "/console/index.html"):
                self._send_static(console_dir / "index.html", "text/html; charset=utf-8")
            elif self.path in ("/support.js", "/console/support.js"):
                self._send_static(console_dir / "support.js", "application/javascript; charset=utf-8")
            # ----- Working knowledge-engine UI -----
            elif self.path == "/teach":
                self._send(view_teach())
            elif self.path == "/models":
                self._send(view_models())
            elif self.path == "/api" or self.path.startswith("/api?"):
                qs = urllib.parse.urlparse(self.path).query
                params = urllib.parse.parse_qs(qs)
                self._send(view_api(revealed_key=(params.get("revealed_key") or [None])[0]))
            elif self.path == "/playground":
                self._send(view_playground())
            # ----- Developer JSON API (Bearer-authed) -----
            elif self.path == "/v1/sources":
                if self._require_apikey() is None: return
                self._json({"sources": ke_ingest.list_sources("default")})
            elif self.path == "/v1/keys":
                # admin: list keys (no bearer required for now — local single-tenant)
                self._json({"keys": ke_keys.list_keys("default")})
            elif self.path == "/v1/providers":
                self._json({"providers": ke_providers.list_providers("default")})
            elif self.path == "/v1/requests":
                self._json({"requests": ke_chat.list_requests("default", limit=50)})
            elif self.path.startswith("/v1/providers/test/"):
                name = self.path.rsplit("/", 1)[-1]
                self._json(ke_providers.test_provider("default", name))
            # ----- Old real-data autopilot pages -----
            elif self.path == "/old" or self.path == "/old/":
                self._send(view_reports())
            elif self.path == "/old/connectors":
                self._send(view_connectors())
            elif self.path == "/old/playbooks":
                self._send(view_playbooks())
            elif self.path == "/old/usage":
                self._send(view_usage())
            elif self.path == "/old/schedule":
                self._send(view_schedule())
            elif self.path == "/old/help":
                self._send(view_help())
            else:
                self._send("not found", 404, "text/plain")
        except Exception as e:
            self._send(f"<pre>{esc(e)}</pre>", 500)

    def do_POST(self):
        try:
            ctype = self.headers.get("Content-Type", "")
            is_v1 = self.path.startswith("/v1/")

            # ---------- Developer JSON API ----------
            if self.path == "/v1/chat/completions":
                # OpenAI-compatible. Bearer required.
                info = self._require_apikey()
                if info is None: return
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))).decode())
                model = body.get("model") or "gemini-2.5-flash"
                msgs = body.get("messages") or []
                k = int(((body.get("argus") or {}).get("k")) or 8)
                opts = {kk: body[kk] for kk in ("temperature", "max_tokens") if kk in body}
                try:
                    out = ke_chat.chat(info["tenant_id"], model, msgs,
                                        k=k, apikey_id=int(info["id"]), **opts)
                    self._json(out)
                except Exception as ex:
                    self._json({"error": {"message": str(ex), "type": "provider_error"}}, 502)
                return

            if self.path == "/v1/providers":
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))).decode())
                pid = ke_providers.add_provider(
                    "default", body["name"], body["api_key"], body["default_model"],
                    body.get("base_url"))
                self._json({"id": pid, "name": body["name"], "default_model": body["default_model"]})
                return

            if self.path.startswith("/v1/providers/delete/"):
                pid = int(self.path.rsplit("/", 1)[-1])
                ke_providers.delete_provider("default", pid)
                self._json({"ok": True})
                return

            if self.path == "/v1/ingest":
                # Two flavours: multipart file upload, OR JSON Q&A.
                if ctype.startswith("multipart/"):
                    form = cgi.FieldStorage(
                        fp=self.rfile, headers=self.headers,
                        environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": ctype})
                    field = form["file"] if "file" in form else None
                    if field is None or not getattr(field, "filename", None):
                        self._json({"error": {"message": "field 'file' missing"}}, 400); return
                    tmp = Path(tempfile.gettempdir()) / field.filename
                    tmp.write_bytes(field.file.read())
                    result = ke_ingest.ingest_file("default", tmp,
                                                    title=field.filename,
                                                    mime=field.type,
                                                    added_by="ui")
                    self._json(result); return
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))).decode())
                if body.get("kind") == "qa":
                    self._json(ke_ingest.ingest_qa("default", body["question"], body["answer"],
                                                    added_by=body.get("added_by", "ui")))
                else:
                    self._json({"error": {"message": "unknown ingest kind"}}, 400)
                return

            if self.path == "/v1/keys":
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))).decode())
                k = ke_keys.generate("default", body.get("name", "unnamed"),
                                      scopes=body.get("scopes"),
                                      rate_per_min=int(body.get("rate_per_min", 60)))
                self._json(k); return

            if self.path.startswith("/v1/keys/revoke/"):
                ke_keys.revoke("default", int(self.path.rsplit("/", 1)[-1]))
                self._json({"ok": True}); return
            if self.path.startswith("/v1/keys/delete/"):
                ke_keys.delete("default", int(self.path.rsplit("/", 1)[-1]))
                self._json({"ok": True}); return
            if self.path.startswith("/v1/sources/delete/"):
                ke_ingest.delete_source("default", int(self.path.rsplit("/", 1)[-1]))
                self._json({"ok": True}); return

            # ---------- Working UI form actions ----------
            f = self._form() if ctype.startswith("application/x-www-form-urlencoded") else {}

            if self.path == "/teach/upload":
                form = cgi.FieldStorage(
                    fp=self.rfile, headers=self.headers,
                    environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": ctype})
                field = form["file"] if "file" in form else None
                if field is not None and getattr(field, "filename", None):
                    tmp = Path(tempfile.gettempdir()) / field.filename
                    tmp.write_bytes(field.file.read())
                    ke_ingest.ingest_file("default", tmp,
                                            title=field.filename, mime=field.type, added_by="ui")
                self._redirect("/teach"); return

            if self.path == "/teach/qa":
                ke_ingest.ingest_qa("default", f.get("question", ""), f.get("answer", ""), "ui")
                self._redirect("/teach"); return
            if self.path == "/teach/delete":
                ke_ingest.delete_source("default", int(f["id"])); self._redirect("/teach"); return

            if self.path == "/models/add":
                ke_providers.add_provider("default", f["name"], f["api_key"],
                                            f["default_model"], f.get("base_url") or None)
                self._redirect("/models"); return
            if self.path == "/models/delete":
                ke_providers.delete_provider("default", int(f["id"])); self._redirect("/models"); return

            if self.path == "/api/create-key":
                k = ke_keys.generate("default", f.get("name", "key"))
                # surface the plaintext via querystring so /api shows it once
                self._redirect(f"/api?revealed_id={k['id']}&revealed_key={urllib.parse.quote(k['key'])}")
                return
            if self.path == "/api/revoke-key":
                ke_keys.revoke("default", int(f["id"])); self._redirect("/api"); return

            if self.path == "/playground/run":
                # Run a chat against the configured model with the user prompt.
                model = f.get("model") or "gemini-2.5-flash"
                q = f.get("q", "")
                try:
                    out = ke_chat.chat("default", model, [{"role": "user", "content": q}], k=8)
                    txt = out["choices"][0]["message"]["content"]
                    cits = out.get("argus_citations", [])
                except Exception as e:
                    txt = f"error: {e}"
                    cits = []
                self._send(view_playground(prompt=q, model=model, answer=txt, citations=cits))
                return

            # ---------- Old autopilot form actions (preserved) ----------
            if self.path == "/connectors/add":
                store.pg("INSERT INTO autopilot.connector (name,dbname,pg_user) VALUES "
                         f"({store.dq(f.get('name'))},{store.dq(f.get('dbname'))},"
                         f"{store.dq(f.get('pg_user','mehdi'))}) ON CONFLICT (dbname) DO NOTHING;")
                self._redirect("/old/connectors")
            elif self.path == "/connectors/toggle":
                store.pg(f"UPDATE autopilot.connector SET enabled = NOT enabled, updated_at=now() "
                         f"WHERE id={int(f['id'])};")
                self._redirect("/old/connectors")
            elif self.path == "/connectors/delete":
                store.pg(f"DELETE FROM autopilot.connector WHERE id={int(f['id'])};")
                self._redirect("/old/connectors")
            elif self.path == "/connectors/test":
                test_connector(f["id"]); self._redirect("/old/connectors")
            elif self.path == "/schedule/set":
                set_schedule(f["hour"]); self._redirect("/old/schedule")
            elif self.path == "/run-now":
                run_now(); self._redirect("/old/schedule")
            else:
                self._send("not found", 404, "text/plain")
        except Exception as e:
            # /v1/* always gets JSON errors so clients don't choke on HTML
            if self.path.startswith("/v1/"):
                self._json({"error": {"message": str(e), "type": "server_error"}}, 500)
            else:
                self._send(f"<pre>{esc(e)}</pre>", 500)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    (HERE / "logs").mkdir(exist_ok=True)
    print(f"Argus UI → http://localhost:{PORT}", file=sys.stderr)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
