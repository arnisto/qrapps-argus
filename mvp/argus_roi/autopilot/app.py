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
import hmac
import html
import io
import json
import os
import re
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
from engine import secret as ke_secret
from engine import projects as ke_projects


# --- Safe filename for uploads (prevents path traversal) -------------------
_UNSAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(raw: str) -> str:
    name = Path(raw or "").name        # strip ANY directory components
    name = _UNSAFE_NAME_RE.sub("_", name).strip("._") or "upload"
    return name[:120]                  # cap length


def _stash_upload(field) -> tuple[Path, str]:
    """Stream a multipart upload to a unique NamedTemporaryFile and keep the
    sanitised original name only as metadata. Returns (path, display_name)."""
    safe = _safe_filename(getattr(field, "filename", "") or "upload")
    with tempfile.NamedTemporaryFile(prefix="argus_up_", suffix="_" + safe,
                                      delete=False) as tf:
        tf.write(field.file.read())
        return Path(tf.name), safe

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

def _ke_chrome(active: str, body: str, tenant: str = "default") -> str:
    # Build per-tenant URLs so nav stays within the active business.
    base = "" if tenant == "default" else f"/p/{tenant}"
    nav_items = [
        ("environments", "/environments",     "Environments"),
        ("teach",        f"{base}/teach",     "Teach"),
        ("models",       f"{base}/models",    "Models"),
        ("api",          f"{base}/api",       "Developer API"),
        ("playground",   f"{base}/playground","Playground"),
    ]
    nav = " · ".join(
        f'<a href="{href}" style="color:{"#3b82f6" if active==key else "#94a3b8"};text-decoration:none;font-weight:{600 if active==key else 500};">{label}</a>'
        for key, href, label in nav_items)

    # Tiny project switcher in the chrome (right side).
    projects = ke_projects.list_projects()
    proj_opts = "".join(
        f'<option value="{esc(p["slug"])}" {"selected" if p["slug"]==tenant else ""}>'
        f'{esc(p["name"])} ({esc(p["slug"])})</option>' for p in projects)
    switcher = f"""
<form method=post action="/projects/switch" style="display:flex;align-items:center;gap:6px;margin:0">
  <span style="font-size:11px;color:#8b97a7">project</span>
  <select name=slug onchange="this.form.submit()" style="background:#0a0e15;color:#e6edf3;border:1px solid #2a3647;border-radius:6px;padding:4px 8px;font-size:12px">{proj_opts}</select>
  <a href="/projects/new" style="font-size:11px;color:#60a5fa;text-decoration:none;margin-left:4px">+ new</a>
</form>"""
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
<div style="margin-left:auto;display:flex;align-items:center;gap:14px">{switcher}</div></header>
<div class=wrap>{body}</div></body></html>"""


def _human_bytes(n):
    if not n: return "—"
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024: return f"{n:.0f} {u}"
        n /= 1024
    return f"{n:.1f} TB"


def view_teach(tenant: str = "default"):
    base = "" if tenant == "default" else f"/p/{tenant}"
    sources = ke_ingest.list_sources(tenant)
    rows = ""
    for s in sources:
        kind_pill = '<span class="pill gray">file</span>' if s["kind"] == "file" else \
                    '<span class="pill" style="background:#064e3b;color:#34d399">Q&A</span>'
        rows += (f"<tr><td>{kind_pill}</td><td><b>{esc(s['title'])}</b><div class=muted>"
                 f"{esc(s.get('uri') or '')}</div></td>"
                 f"<td>{int(s.get('chunks',0))}</td>"
                 f"<td>{_human_bytes(s.get('bytes') or 0)}</td>"
                 f"<td>{esc(s['created_at'][:16])}</td>"
                 f"<td><form class=inline method=post action=\"{base}/teach/delete\" onsubmit=\"return confirm('Delete?')\">"
                 f"<input type=hidden name=id value={s['id']}><button class=danger>Delete</button></form></td></tr>")
    body = f"""<h1>Teach Argus <span style="font-size:12px;color:#8b97a7">· project {esc(tenant)}</span></h1>
<p class=muted>Upload files (PDF / MD / TXT / HTML) or add answered Q&A. Each one is chunked, embedded with Gemini, and indexed in pgvector — for this project only.</p>

<div class=card><h2>Upload a file</h2>
<form method=post action="{base}/teach/upload" enctype=multipart/form-data class=row>
<input type=file name=file required style="max-width:380px">
<button>Ingest file</button>
</form>
<div class=muted style="margin-top:6px">PDFs require <code>pypdf</code> in the runtime. Otherwise: txt/md/markdown/html.</div></div>

<div class=card><h2>Add an answered Q&A</h2>
<form method=post action="{base}/teach/qa">
<div style="display:grid;gap:8px">
<input name=question placeholder="Question (what customers ask)" required>
<textarea name=answer placeholder="The grounded answer (becomes a high-authority fact)" required></textarea>
<div><button>Add Q&A</button></div>
</div></form></div>

<div class=card><h2>Sources ({len(sources)})</h2>
<table><tr><th>Kind</th><th>Title</th><th>Chunks</th><th>Size</th><th>Added</th><th></th></tr>
{rows or '<tr><td colspan=6 class=muted style="text-align:center;padding:24px">Nothing yet — upload a file above.</td></tr>'}
</table></div>"""
    return _ke_chrome("teach", body, tenant)


def view_models(tenant: str = "default"):
    base = "" if tenant == "default" else f"/p/{tenant}"
    rows = ""
    for p in ke_providers.list_providers(tenant):
        enabled = '<span class="pill" style="background:#064e3b;color:#34d399">enabled</span>' if (p["enabled"] in ("t", True, "true")) else '<span class="pill" style="background:#3a2030;color:#fca5a5">off</span>'
        rows += (f"<tr><td><b>{esc(p['name'])}</b></td><td>{esc(p['default_model'])}</td>"
                 f"<td>{esc(p.get('base_url') or '—')}</td><td>{enabled}</td>"
                 f"<td>{esc(p['created_at'][:16])}</td>"
                 f"<td><span class=muted>(test via API)</span> "
                 f"<form class=inline method=post action=\"{base}/models/delete\" onsubmit=\"return confirm('Delete provider?')\">"
                 f"<input type=hidden name=id value={p['id']}><button class=danger>Delete</button></form></td></tr>")

    body = f"""<h1>Models <span style="font-size:12px;color:#8b97a7">· project {esc(tenant)}</span></h1>
<p class=muted>Connect any LLM provider for <b>this project</b>. Argus stores the API key encrypted (AES-GCM via APP_SECRET). Same model goes through Argus on every /v1/chat call — Argus just injects this project's knowledge.</p>

<div class=card><h2>Connect a provider</h2>
<form method=post action="{base}/models/add">
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
    return _ke_chrome("models", body, tenant)


def view_api(revealed_key: str | None = None, tenant: str = "default"):
    keys = ke_keys.list_keys(tenant)
    reqs = ke_chat.list_requests(tenant, limit=20)
    base = "" if tenant == "default" else f"/p/{tenant}"
    api_base = f"http://localhost:8090{base}/v1"

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
                  f"<td><form class=inline method=post action=\"{base}/api/revoke-key\"><input type=hidden name=id value={k['id']}><button class=sec>Revoke</button></form></td></tr>")

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

    body = f"""<h1>Developer API <span style="font-size:12px;color:#8b97a7">· project {esc(tenant)}</span></h1>
<p class=muted>Use the same models you connected, but through Argus — every call gets your knowledge injected, with citations. <b>OpenAI-compatible</b>: drop into any client by setting <code>baseUrl = {esc(api_base)}</code> and using an Argus API key from this project.</p>

{reveal_box}

<div class=card><h2>API keys</h2>
<form method=post action="{base}/api/create-key" class=row style="margin-bottom:10px">
<input name=name placeholder="key name (e.g. 'My App Prod')" required style="max-width:280px">
<button>Create new key</button>
</form>
<table><tr><th>Name</th><th>Prefix</th><th></th><th>Rate</th><th>Created</th><th>Last used</th><th></th></tr>
{krows or '<tr><td colspan=7 class=muted style="text-align:center;padding:24px">No keys yet.</td></tr>'}
</table></div>

<div class=card><h2>Use the API</h2>
<h3 style="font-size:13px;margin:10px 0 4px;color:#cdd9e5">curl</h3>
<pre>curl {esc(api_base)}/chat/completions \\
  -H "Authorization: Bearer $ARGUS_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{{
    "model": "gemini-2.5-flash",
    "messages": [{{"role": "user", "content": "What is your refund policy?"}}]
  }}'</pre>
<h3 style="font-size:13px;margin:14px 0 4px;color:#cdd9e5">Python (openai SDK — same call, swapped baseUrl)</h3>
<pre>from openai import OpenAI
client = OpenAI(api_key="ak_live_…", base_url="{esc(api_base)}")
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
    return _ke_chrome("api", body, tenant)


def view_playground(prompt: str = "", model: str = "gemini-2.5-flash",
                    answer: str | None = None, citations: list | None = None,
                    tenant: str = "default"):
    provs = ke_providers.list_providers(tenant)
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
    base = "" if tenant == "default" else f"/p/{tenant}"
    body = f"""<h1>Playground <span style="font-size:12px;color:#8b97a7">· project {esc(tenant)}</span></h1>
<p class=muted>Try Argus end-to-end: pick a connected model, ask a question, see the answer + which chunks grounded it.</p>
<div class=card><form method=post action="{base}/playground/run">
<label>Model <select name=model>{model_opts}</select></label>
<div style="margin-top:8px"><label>Question <textarea name=q placeholder="Ask anything about what you've taught Argus.">{esc(prompt)}</textarea></label></div>
<div style="margin-top:8px"><button>Ask</button></div>
</form></div>
{ans_html}"""
    return _ke_chrome("playground", body, tenant)


def view_environments(flash: str | None = None):
    """Odoo-style LIST view of every business in one table."""
    projs = ke_projects.list_projects()
    rows = ""
    for p in projs:
        base = "" if p["slug"] == "default" else f"/p/{p['slug']}"
        cost = float(p.get("cost_usd") or 0)
        last = (p.get("last_request_at") or "")[:16] or "—"
        is_default = p["slug"] == "default"
        rename_form = (
            f'<form class=inline method=post action="/environments/rename" style="display:inline-flex;gap:4px;align-items:center">'
            f'<input type=hidden name=slug value="{esc(p["slug"])}">'
            f'<input name=name value="{esc(p["name"])}" style="width:140px;padding:4px 6px;font-size:12px">'
            f'<input name=primary_model value="{esc(p["primary_model"])}" style="width:160px;padding:4px 6px;font-size:12px">'
            f'<button class=sec style="padding:4px 8px;font-size:11px">Save</button></form>'
        )
        delete_form = (
            f'<form class=inline method=post action="/environments/delete" '
            f'onsubmit="return confirm(\'Delete {esc(p["slug"])} and ALL its sources / keys / requests? This is permanent.\')">'
            f'<input type=hidden name=slug value="{esc(p["slug"])}">'
            f'<button class=danger style="padding:4px 8px;font-size:11px">Delete</button></form>'
        )
        if is_default:
            delete_form = '<span class=muted style="font-size:11px">protected</span>'
        rows += (
            f"<tr>"
            f"<td><a href='/environments/{esc(p['slug'])}' style='color:#60a5fa;font-weight:600'>{esc(p['name'])}</a>"
            f"<div class=muted style='font-size:11px'>slug: <code>{esc(p['slug'])}</code></div></td>"
            f"<td>{rename_form}</td>"
            f"<td class=r>{int(p.get('active_providers') or 0)}</td>"
            f"<td class=r>{int(p.get('sources') or 0)} src · {int(p.get('chunks') or 0)} chunks</td>"
            f"<td class=r>{int(p.get('active_keys') or 0)}</td>"
            f"<td class=r>{int(p.get('requests') or 0)}</td>"
            f"<td class=r>${cost:.4f}</td>"
            f"<td class=muted style='font-size:11px'>{last}</td>"
            f"<td><a class=btn href='{base}/teach' style='padding:4px 10px;font-size:11px'>Open</a> {delete_form}</td>"
            f"</tr>"
        )

    flash_html = f'<div class=ok>{esc(flash)}</div>' if flash else ""
    body = f"""<h1>Environments</h1>
<p class=muted>One row per business. Each environment is fully isolated: own connected models, knowledge core, API keys, and per-project base URL <code>/p/&lt;slug&gt;/v1</code>.</p>
{flash_html}

<div class=card><h2>+ New environment</h2>
<form method=post action="/environments/create">
<div style="display:grid;gap:8px;grid-template-columns:1fr 1fr 1fr">
  <label>Name <input name=name required placeholder="e.g. Acme Logistics"></label>
  <label>Slug (optional) <input name=slug placeholder="auto from name"></label>
  <label>Primary model <input name=primary_model required value="gemini-2.5-flash"></label>
</div>
<div style="margin-top:10px"><button>Create environment</button></div></form></div>

<div class=card><h2>All environments ({len(projs)})</h2>
<table>
<tr><th>Name / slug</th><th>Rename + change model</th><th class=r>Models</th><th class=r>Knowledge</th><th class=r>Keys</th><th class=r>Reqs</th><th class=r>Cost</th><th>Last activity</th><th></th></tr>
{rows or '<tr><td colspan=9 class=muted style="text-align:center;padding:24px">No environments yet.</td></tr>'}
</table>
<div class=muted style="margin-top:8px;font-size:12px">Cost is the cumulative provider spend logged on this project's <code>/v1/chat</code> calls. Click a name to drill in.</div>
</div>"""
    return _ke_chrome("environments", body, "default")


def view_environment(slug: str, flash: str | None = None):
    """Odoo-style FORM view: everything about one environment in one screen."""
    p = ke_projects.get_by_slug(slug)
    if not p:
        return _ke_chrome("environments",
                          f'<h1>Environment not found</h1><p>No project with slug <code>{esc(slug)}</code>.</p>'
                          f'<p><a href="/environments">← all environments</a></p>',
                          "default")
    base = "" if slug == "default" else f"/p/{slug}"
    api_base = f"http://localhost:8090{base}/v1"
    providers = ke_providers.list_providers(slug)
    keys = ke_keys.list_keys(slug)
    sources = ke_ingest.list_sources(slug)
    requests = ke_chat.list_requests(slug, limit=10)

    prov_rows = "".join(
        f"<tr><td><b>{esc(g['name'])}</b></td><td><code>{esc(g['default_model'])}</code></td>"
        f"<td class=muted>{esc(g.get('base_url') or 'default endpoint')}</td>"
        f"<td>{'<span class=pill style=\"background:#064e3b;color:#34d399\">enabled</span>' if g['enabled'] in ('t', True, 'true') else '<span class=pill style=\"background:#3a2030;color:#fca5a5\">off</span>'}</td>"
        f"<td class=muted style='font-size:11px'>added {esc((g['created_at'] or '')[:16])}</td></tr>"
        for g in providers
    ) or '<tr><td colspan=5 class=muted style="text-align:center;padding:18px">No providers connected to this environment yet.</td></tr>'

    key_rows = "".join(
        f"<tr><td><b>{esc(k['name'])}</b></td><td><code>{esc(k['key_prefix'])}</code></td>"
        f"<td class=muted>{int(k.get('rate_per_min') or 0)}/min</td>"
        f"<td class=muted style='font-size:11px'>{esc((k['last_used_at'] or '')[:16]) or '—'}</td></tr>"
        for k in keys
    ) or '<tr><td colspan=4 class=muted style="text-align:center;padding:18px">No API keys minted in this environment yet.</td></tr>'

    src_rows = "".join(
        f"<tr><td><b>{esc(s['title'])}</b></td><td class=muted>{esc(s['kind'])}</td>"
        f"<td class=muted>{int(s.get('chunks') or 0)} chunks</td>"
        f"<td class=muted style='font-size:11px'>{esc((s['created_at'] or '')[:16])}</td></tr>"
        for s in sources
    ) or '<tr><td colspan=4 class=muted style="text-align:center;padding:18px">No knowledge ingested yet.</td></tr>'

    req_rows = "".join(
        f"<tr><td class=muted style='font-size:11px'>{esc((r['created_at'] or '')[:16])}</td>"
        f"<td>{esc(r['provider'])}/{esc(r['model'])}</td>"
        f"<td class=r>{int(r.get('total_tokens') or 0)} tok</td>"
        f"<td class=r>{int(r.get('latency_ms') or 0)} ms</td>"
        f"<td class=r>${float(r.get('cost_usd') or 0):.5f}</td>"
        f"<td>{esc(r['status'])}</td></tr>"
        for r in requests
    ) or '<tr><td colspan=6 class=muted style="text-align:center;padding:18px">No requests yet — try the <a href="' + base + '/playground">Playground</a>.</td></tr>'

    is_default = slug == "default"
    delete_row = (
        '<div class=muted>The default environment cannot be deleted (preserves the legacy /v1/... routes).</div>'
        if is_default else
        f'<form method=post action="/environments/delete" onsubmit="return confirm(\'Delete {esc(slug)} and ALL its sources / keys / requests? Permanent.\')">'
        f'<input type=hidden name=slug value="{esc(slug)}">'
        f'<button class=danger>Permanently delete this environment</button></form>'
    )
    flash_html = f'<div class=ok>{esc(flash)}</div>' if flash else ""

    body = f"""<p style="margin:0 0 6px"><a href="/environments" style="color:#60a5fa;font-size:12px">← all environments</a></p>
<h1>{esc(p['name'])} <span style="font-size:13px;color:#8b97a7">· <code>{esc(slug)}</code></span></h1>
<p class=muted>Base URL: <code>{esc(api_base)}</code>  ·  Created {esc((p['created_at'] or '')[:16])}</p>
{flash_html}

<div class=card><h2>Settings</h2>
<form method=post action="/environments/rename">
<input type=hidden name=slug value="{esc(slug)}">
<div style="display:grid;gap:8px;grid-template-columns:1fr 1fr">
  <label>Display name <input name=name value="{esc(p['name'])}" required></label>
  <label>Primary model <input name=primary_model value="{esc(p['primary_model'])}" required></label>
</div>
<div style="margin-top:10px"><button>Save changes</button></div></form>
<div class=muted style="margin-top:6px;font-size:12px">Slug is immutable — it's baked into the URL and any keys minted under it.</div>
</div>

<div class=card><h2>Connected models ({len(providers)} real)</h2>
<table><tr><th>Provider</th><th>Default model</th><th>Base URL</th><th></th><th></th></tr>
{prov_rows}
</table>
<div class=muted style="margin-top:6px;font-size:12px">Manage these on the <a href="{base}/models">Models page for this environment</a>.</div>
</div>

<div class=card><h2>API keys ({len(keys)})</h2>
<table><tr><th>Name</th><th>Prefix</th><th>Rate</th><th>Last used</th></tr>
{key_rows}
</table>
<div class=muted style="margin-top:6px;font-size:12px">Manage on the <a href="{base}/api">Developer API page for this environment</a>.</div>
</div>

<div class=card><h2>Knowledge ({len(sources)} sources)</h2>
<table><tr><th>Title</th><th>Kind</th><th>Chunks</th><th>Added</th></tr>
{src_rows}
</table>
<div class=muted style="margin-top:6px;font-size:12px">Add more on the <a href="{base}/teach">Teach page for this environment</a>.</div>
</div>

<div class=card><h2>Recent requests</h2>
<table><tr><th>When</th><th>Provider/model</th><th class=r>Tokens</th><th class=r>Latency</th><th class=r>Cost</th><th>Status</th></tr>
{req_rows}
</table>
</div>

<div class=card style="border-color:#7f1d1d"><h2 style="color:#fca5a5">Danger zone</h2>{delete_row}</div>"""
    return _ke_chrome("environments", body, "default")


def view_new_project():
    body = """<h1>+ New business</h1>
<p class=muted>Each business is a fully isolated workspace: its own connected LLMs, knowledge core, API keys, and per-project URL prefix.</p>
<div class=card>
<form method=post action="/projects/create">
<div style="display:grid;gap:10px;max-width:480px">
  <label>Business name <input name=name required placeholder="Speedo Delivery"></label>
  <label>URL slug (optional) <input name=slug placeholder="auto-derived from name"></label>
  <label>Primary model <input name=primary_model required value="gemini-2.5-flash" placeholder="gemini-2.5-flash / llama-3.3-70b-versatile / gpt-4o-mini"></label>
</div>
<div style="margin-top:12px"><button>Create business</button></div>
</form>
</div>
<p class=muted style="margin-top:14px">After creation, your developer-API base URL becomes <code>http://localhost:8090/p/&lt;slug&gt;/v1</code>.</p>"""
    return _ke_chrome("teach", body, "default")


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

    def _send_secret(self, body, code=200, ctype="text/html; charset=utf-8"):
        """Same as _send but with no-store + no-referrer for one-time-secret
        responses (the create-key plaintext reveal)."""
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Referrer-Policy", "no-referrer")
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
        """Per-tenant developer API key (for /v1/chat, /v1/ingest, /v1/sources)."""
        info = ke_keys.verify(self._bearer() or "")
        if not info:
            self._json({"error": {"message": "missing or invalid bearer token", "type": "auth"}}, 401)
            return None
        return info

    def _tenant_path(self, suffix: str) -> str:
        """Build a per-tenant URL: /p/<slug>/<suffix> for non-default, /<suffix> otherwise.
        suffix may or may not start with '/'."""
        s = suffix if suffix.startswith("/") else "/" + suffix
        return s if self._tenant == "default" else f"/p/{self._tenant}{s}"

    def _require_tenant_match(self, key_info: dict) -> bool:
        """When the URL had an explicit /p/<slug>/ prefix, require the API key
        was minted for that same project. Prevents a confused-deputy attack
        where a leaked key for tenant A is used against /p/B/v1/...
        Returns False (and sends 403) on mismatch."""
        if self._tenant_explicit and key_info["tenant_id"] != self._tenant:
            self._json({"error": {"message": "API key was minted for a different project — "
                                              f"key tenant '{key_info['tenant_id']}' ≠ URL tenant '{self._tenant}'",
                                    "type": "tenant_mismatch"}}, 403)
            return False
        return True

    def _require_admin(self) -> bool:
        """Admin token for /v1/* management endpoints (provider config,
        key issuance, request log, etc.). Uses hmac.compare_digest."""
        provided = self._bearer() or ""
        expected = ke_secret.admin_token()
        if not expected or not hmac.compare_digest(provided, expected):
            self._json({"error": {"message": "admin token required (set Authorization: Bearer <ARGUS_ADMIN_TOKEN>)",
                                    "type": "admin_auth"}}, 401)
            return False
        return True

    # ------------------------------------------------------------------
    # Declarative route tables.
    # Refactored from giant if/elif chains in do_GET/do_POST so adding a
    # route is a single dict entry, not another branch. The argus_code_review
    # hook complained about it being a 17-branch chain — now zero.
    # Each handler does its own auth check, body parsing, and response.
    # ------------------------------------------------------------------

    _GET_EXACT = {
        "/":                       "_serve_console_index",
        "/index.html":             "_serve_console_index",
        "/console":                "_serve_console_index",
        "/console/":               "_serve_console_index",
        "/console/index.html":     "_serve_console_index",
        "/support.js":             "_serve_console_js",
        "/console/support.js":     "_serve_console_js",
        "/teach":                  "_get_teach",
        "/models":                 "_get_models",
        "/api":                    "_get_api",
        "/playground":             "_get_playground",
        "/projects/new":           "_get_projects_new",
        "/environments":           "_get_environments",
        "/environments/":          "_get_environments",
        "/v1/projects":            "_get_v1_projects",
        "/v1/sources":             "_get_v1_sources",
        "/v1/keys":                "_get_v1_keys",
        "/v1/providers":           "_get_v1_providers",
        "/v1/requests":            "_get_v1_requests",
        "/old":                    "_get_old_reports",
        "/old/":                   "_get_old_reports",
        "/old/connectors":         "_get_old_connectors",
        "/old/playbooks":          "_get_old_playbooks",
        "/old/usage":              "_get_old_usage",
        "/old/schedule":           "_get_old_schedule",
        "/old/help":               "_get_old_help",
    }
    # (prefix, handler) — checked AFTER exact match. Order matters only when
    # one prefix is itself a prefix of another (none here today).
    _GET_PREFIX = (
        ("/v1/providers/test/", "_get_v1_provider_test"),
        ("/environments/",      "_get_environment_form"),
    )

    _POST_EXACT = {
        "/v1/chat/completions":  "_post_v1_chat",
        "/v1/providers":         "_post_v1_providers",
        "/v1/ingest":            "_post_v1_ingest",
        "/v1/keys":              "_post_v1_keys",
        "/v1/projects":          "_post_v1_projects",
        "/teach/upload":         "_post_teach_upload",
        "/teach/qa":             "_post_teach_qa",
        "/teach/delete":         "_post_teach_delete",
        "/models/add":           "_post_models_add",
        "/models/delete":        "_post_models_delete",
        "/api/create-key":       "_post_api_create_key",
        "/api/revoke-key":       "_post_api_revoke_key",
        "/playground/run":       "_post_playground_run",
        "/projects/switch":      "_post_projects_switch",
        "/projects/create":      "_post_projects_create",
        "/environments/create":  "_post_environments_create",
        "/environments/rename":  "_post_environments_rename",
        "/environments/delete":  "_post_environments_delete",
        "/connectors/add":       "_post_old_conn_add",
        "/connectors/toggle":    "_post_old_conn_toggle",
        "/connectors/delete":    "_post_old_conn_delete",
        "/connectors/test":      "_post_old_conn_test",
        "/schedule/set":         "_post_old_sched_set",
        "/run-now":              "_post_old_run_now",
    }
    _POST_PREFIX = (
        ("/v1/providers/delete/", "_post_v1_provider_delete"),
        ("/v1/keys/revoke/",      "_post_v1_key_revoke"),
        ("/v1/keys/delete/",      "_post_v1_key_delete"),
        ("/v1/sources/delete/",   "_post_v1_source_delete"),
        ("/v1/projects/delete/",  "_post_v1_project_delete"),
    )

    # ---------- Tenant resolution (URL-prefix only — single source of truth) ----------
    def _resolve_tenant(self) -> bool:
        """Inspect self.path. If it starts with `/p/<slug>/...`, strip that
        prefix off self.path and set self._tenant=slug, self._tenant_explicit=True.
        Otherwise tenant defaults to 'default' (preserves legacy `/v1/...`).

        Returns False (and sends 404) if the prefix names an unknown project.
        Stores the original path on self._raw_path so error messages don't lose
        the slug context."""
        self._raw_path = self.path
        self._tenant = "default"
        self._tenant_explicit = False
        if not self.path.startswith("/p/"):
            return True
        rest = self.path[3:]
        slash = rest.find("/")
        if slash <= 0:
            self._send("not found (use /p/<slug>/...)", 404, "text/plain")
            return False
        slug, suffix = rest[:slash], rest[slash:]
        if not ke_projects.exists(slug):
            self._send(f"project '{slug}' not found", 404, "text/plain")
            return False
        self._tenant = slug
        self._tenant_explicit = True
        self.path = suffix or "/"
        return True

    # ---------- Dispatcher + error sink ----------
    def _dispatch(self, exact, prefix):
        if not self._resolve_tenant():
            return
        # `/api?revealed_key=...` style: split query before exact lookup.
        base = self.path.split("?", 1)[0]
        name = exact.get(self.path) or exact.get(base)
        if name:
            return getattr(self, name)()
        for p, handler in prefix:
            if self.path.startswith(p):
                return getattr(self, handler)(self.path[len(p):])
        self._send("not found", 404, "text/plain")

    def _error(self, e: Exception):
        if self.path.startswith("/v1/"):
            self._json({"error": {"message": str(e), "type": "server_error"}}, 500)
        else:
            self._send(f"<pre>{esc(e)}</pre>", 500)

    def do_GET(self):
        try:
            self._dispatch(self._GET_EXACT, self._GET_PREFIX)
        except Exception as e:
            self._error(e)

    def do_POST(self):
        try:
            self._dispatch(self._POST_EXACT, self._POST_PREFIX)
        except Exception as e:
            self._error(e)

    # ---------- Body-parsing helpers (so handlers stay tiny) ----------
    def _json_body(self) -> dict:
        n = int(self.headers.get("Content-Length", 0) or 0)
        return json.loads(self.rfile.read(n).decode() or "{}")

    def _multipart_form(self):
        return cgi.FieldStorage(
            fp=self.rfile, headers=self.headers,
            environ={"REQUEST_METHOD": "POST",
                     "CONTENT_TYPE": self.headers.get("Content-Type", "")})

    # ---------- GET handlers ----------
    def _serve_console_index(self):
        self._send_static(HERE / "console" / "index.html", "text/html; charset=utf-8")

    def _serve_console_js(self):
        self._send_static(HERE / "console" / "support.js",
                           "application/javascript; charset=utf-8")

    def _get_teach(self):      self._send(view_teach(self._tenant))
    def _get_models(self):     self._send(view_models(self._tenant))
    def _get_playground(self): self._send(view_playground(tenant=self._tenant))
    def _get_projects_new(self): self._send(view_new_project())

    def _get_environments(self):
        qs = urllib.parse.urlparse(self.path).query
        flash = (urllib.parse.parse_qs(qs).get("ok") or [None])[0]
        self._send(view_environments(flash=flash))

    def _get_environment_form(self, suffix: str):
        # `suffix` here is everything after `/environments/` — including any
        # `?ok=...` query string, since the prefix dispatcher hands us the
        # raw path slice. Split query off the slug first.
        path_only, _, qs = suffix.partition("?")
        slug = path_only.strip("/").split("/", 1)[0]
        if not slug:
            self._send(view_environments()); return
        flash = (urllib.parse.parse_qs(qs).get("ok") or [None])[0]
        self._send(view_environment(slug, flash=flash))

    def _get_api(self):
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        self._send(view_api(revealed_key=(params.get("revealed_key") or [None])[0],
                              tenant=self._tenant))

    def _get_v1_sources(self):
        info = self._require_apikey()
        if info is None: return
        if not self._require_tenant_match(info): return
        self._json({"sources": ke_ingest.list_sources(info["tenant_id"])})

    def _get_v1_keys(self):
        if not self._require_admin(): return
        self._json({"keys": ke_keys.list_keys(self._tenant)})

    def _get_v1_providers(self):
        if not self._require_admin(): return
        self._json({"providers": ke_providers.list_providers(self._tenant)})

    def _get_v1_requests(self):
        if not self._require_admin(): return
        self._json({"requests": ke_chat.list_requests(self._tenant, limit=50)})

    def _get_v1_provider_test(self, name: str):
        if not self._require_admin(): return
        self._json(ke_providers.test_provider(self._tenant, name))

    # System-level (not per-project) admin: list every project the operator manages.
    def _get_v1_projects(self):
        if not self._require_admin(): return
        self._json({"projects": ke_projects.list_projects()})

    def _get_old_reports(self):    self._send(view_reports())
    def _get_old_connectors(self): self._send(view_connectors())
    def _get_old_playbooks(self):  self._send(view_playbooks())
    def _get_old_usage(self):      self._send(view_usage())
    def _get_old_schedule(self):   self._send(view_schedule())
    def _get_old_help(self):       self._send(view_help())

    # ---------- POST handlers (developer JSON API) ----------
    def _post_v1_chat(self):
        info = self._require_apikey()
        if info is None: return
        if not self._require_tenant_match(info): return
        body = self._json_body()
        model = body.get("model") or "gemini-2.5-flash"
        msgs = body.get("messages") or []
        k = int(((body.get("argus") or {}).get("k")) or 8)
        opts = {kk: body[kk] for kk in ("temperature", "max_tokens") if kk in body}
        try:
            self._json(ke_chat.chat(info["tenant_id"], model, msgs,
                                      k=k, apikey_id=int(info["id"]), **opts))
        except Exception as ex:
            self._json({"error": {"message": str(ex), "type": "provider_error"}}, 502)

    def _post_v1_providers(self):
        if not self._require_admin(): return
        body = self._json_body()
        pid = ke_providers.add_provider(self._tenant, body["name"], body["api_key"],
                                          body["default_model"], body.get("base_url"))
        self._json({"id": pid, "name": body["name"],
                    "default_model": body["default_model"]})

    def _post_v1_provider_delete(self, suffix: str):
        if not self._require_admin(): return
        ke_providers.delete_provider(self._tenant, int(suffix))
        self._json({"ok": True})

    def _post_v1_ingest(self):
        info = self._require_apikey()
        if info is None: return
        if not self._require_tenant_match(info): return
        if self.headers.get("Content-Type", "").startswith("multipart/"):
            return self._ingest_multipart(info)
        body = self._json_body()
        if body.get("kind") != "qa":
            self._json({"error": {"message": "unknown ingest kind"}}, 400); return
        self._json(ke_ingest.ingest_qa(info["tenant_id"], body["question"],
                                         body["answer"],
                                         added_by=f"apikey:{info['id']}"))

    def _ingest_multipart(self, info: dict):
        form = self._multipart_form()
        field = form["file"] if "file" in form else None
        if field is None or not getattr(field, "filename", None):
            self._json({"error": {"message": "field 'file' missing"}}, 400); return
        tmp, display = _stash_upload(field)
        try:
            self._json(ke_ingest.ingest_file(info["tenant_id"], tmp,
                                               title=display, mime=field.type,
                                               added_by=f"apikey:{info['id']}"))
        finally:
            try: tmp.unlink(missing_ok=True)
            except Exception: pass

    def _post_v1_keys(self):
        if not self._require_admin(): return
        body = self._json_body()
        self._json(ke_keys.generate(self._tenant, body.get("name", "unnamed"),
                                     scopes=body.get("scopes"),
                                     rate_per_min=int(body.get("rate_per_min", 60))))

    def _post_v1_key_revoke(self, suffix: str):
        if not self._require_admin(): return
        ke_keys.revoke(self._tenant, int(suffix)); self._json({"ok": True})

    def _post_v1_key_delete(self, suffix: str):
        if not self._require_admin(): return
        ke_keys.delete(self._tenant, int(suffix)); self._json({"ok": True})

    def _post_v1_source_delete(self, suffix: str):
        info = self._require_apikey()
        if info is None: return
        if not self._require_tenant_match(info): return
        ke_ingest.delete_source(info["tenant_id"], int(suffix))
        self._json({"ok": True})

    # ---------- System-level admin: projects CRUD ----------
    def _post_v1_projects(self):
        if not self._require_admin(): return
        body = self._json_body()
        if not body.get("name") or not body.get("primary_model"):
            self._json({"error": {"message": "name and primary_model required"}}, 400); return
        try:
            p = ke_projects.create(body["name"], body["primary_model"], slug=body.get("slug"))
            self._json(p)
        except Exception as e:
            self._json({"error": {"message": str(e), "type": "invalid_request"}}, 400)

    def _post_v1_project_delete(self, suffix: str):
        if not self._require_admin(): return
        try:
            ke_projects.delete(suffix); self._json({"ok": True})
        except ValueError as e:
            self._json({"error": {"message": str(e), "type": "invalid_request"}}, 400)

    # ---------- POST handlers (working UI form actions) ----------
    def _post_teach_upload(self):
        form = self._multipart_form()
        field = form["file"] if "file" in form else None
        if field is not None and getattr(field, "filename", None):
            tmp, display = _stash_upload(field)
            try:
                ke_ingest.ingest_file(self._tenant, tmp, title=display,
                                        mime=field.type, added_by="ui")
            finally:
                try: tmp.unlink(missing_ok=True)
                except Exception: pass
        self._redirect(self._tenant_path("/teach"))

    def _post_teach_qa(self):
        f = self._form()
        ke_ingest.ingest_qa(self._tenant, f.get("question", ""),
                              f.get("answer", ""), "ui")
        self._redirect(self._tenant_path("/teach"))

    def _post_teach_delete(self):
        ke_ingest.delete_source(self._tenant, int(self._form()["id"]))
        self._redirect(self._tenant_path("/teach"))

    def _post_models_add(self):
        f = self._form()
        ke_providers.add_provider(self._tenant, f["name"], f["api_key"],
                                    f["default_model"], f.get("base_url") or None)
        self._redirect(self._tenant_path("/models"))

    def _post_models_delete(self):
        ke_providers.delete_provider(self._tenant, int(self._form()["id"]))
        self._redirect(self._tenant_path("/models"))

    def _post_api_create_key(self):
        # plaintext key rendered in body, never via URL (uses _send_secret →
        # Cache-Control: no-store, Referrer-Policy: no-referrer).
        k = ke_keys.generate(self._tenant, self._form().get("name", "key"))
        self._send_secret(view_api(revealed_key=k["key"], tenant=self._tenant))

    def _post_api_revoke_key(self):
        ke_keys.revoke(self._tenant, int(self._form()["id"]))
        self._redirect(self._tenant_path("/api"))

    def _post_playground_run(self):
        f = self._form()
        model = f.get("model") or "gemini-2.5-flash"
        q = f.get("q", "")
        try:
            out = ke_chat.chat(self._tenant, model,
                                [{"role": "user", "content": q}], k=8)
            txt = out["choices"][0]["message"]["content"]
            cits = out.get("argus_citations", [])
        except Exception as e:
            txt, cits = f"error: {e}", []
        self._send(view_playground(prompt=q, model=model,
                                     answer=txt, citations=cits,
                                     tenant=self._tenant))

    # ---------- POST handlers (project switcher + creator) ----------
    def _post_projects_switch(self):
        slug = self._form().get("slug", "default")
        if not ke_projects.exists(slug):
            self._send("not found", 404, "text/plain"); return
        target = "/teach" if slug == "default" else f"/p/{slug}/teach"
        self._redirect(target)

    def _post_projects_create(self):
        f = self._form()
        name = (f.get("name") or "").strip()
        model = (f.get("primary_model") or "gemini-2.5-flash").strip()
        if not name:
            self._send("name required", 400, "text/plain"); return
        try:
            p = ke_projects.create(name, model, slug=f.get("slug") or None)
        except Exception as e:
            self._send(f"could not create: {esc(e)}", 400, "text/plain"); return
        self._redirect(f"/p/{p['slug']}/teach")

    def _post_environments_create(self):
        f = self._form()
        name = (f.get("name") or "").strip()
        model = (f.get("primary_model") or "gemini-2.5-flash").strip()
        if not name:
            self._send("name required", 400, "text/plain"); return
        try:
            p = ke_projects.create(name, model, slug=f.get("slug") or None)
        except Exception as e:
            self._send(f"could not create: {esc(e)}", 400, "text/plain"); return
        self._redirect(f"/environments/{p['slug']}?ok=" + urllib.parse.quote(f"Created {p['name']} ({p['slug']})."))

    def _post_environments_rename(self):
        f = self._form()
        slug = (f.get("slug") or "").strip()
        if not slug or not ke_projects.exists(slug):
            self._send("unknown environment", 404, "text/plain"); return
        ke_projects.rename(slug, name=f.get("name"), primary_model=f.get("primary_model"))
        self._redirect(f"/environments/{slug}?ok=" + urllib.parse.quote("Saved."))

    def _post_environments_delete(self):
        slug = (self._form().get("slug") or "").strip()
        if not slug:
            self._send("slug required", 400, "text/plain"); return
        if slug == "default":
            self._send("cannot delete the default environment", 403, "text/plain"); return
        try:
            ke_projects.delete(slug)
        except Exception as e:
            self._send(f"could not delete: {esc(e)}", 400, "text/plain"); return
        self._redirect("/environments?ok=" + urllib.parse.quote(f"Deleted environment '{slug}'."))

    # ---------- POST handlers (legacy autopilot pages under /old) ----------
    def _post_old_conn_add(self):
        f = self._form()
        store.pg("INSERT INTO autopilot.connector (name,dbname,pg_user) VALUES "
                  f"({store.dq(f.get('name'))},{store.dq(f.get('dbname'))},"
                  f"{store.dq(f.get('pg_user','mehdi'))}) "
                  "ON CONFLICT (dbname) DO NOTHING;")
        self._redirect("/old/connectors")

    def _post_old_conn_toggle(self):
        store.pg("UPDATE autopilot.connector SET enabled = NOT enabled, updated_at=now() "
                  f"WHERE id={int(self._form()['id'])};")
        self._redirect("/old/connectors")

    def _post_old_conn_delete(self):
        store.pg(f"DELETE FROM autopilot.connector WHERE id={int(self._form()['id'])};")
        self._redirect("/old/connectors")

    def _post_old_conn_test(self):
        test_connector(self._form()["id"]); self._redirect("/old/connectors")

    def _post_old_sched_set(self):
        set_schedule(self._form()["hour"]); self._redirect("/old/schedule")

    def _post_old_run_now(self):
        run_now(); self._redirect("/old/schedule")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    (HERE / "logs").mkdir(exist_ok=True)
    # Bind to loopback by default — the operator UI has no per-user auth,
    # so any process on the host is the only trust boundary. Override with
    # ARGUS_BIND=0.0.0.0 if you intentionally need LAN access (and ideally
    # put a reverse proxy with real auth in front of it).
    BIND = os.environ.get("ARGUS_BIND", "127.0.0.1")
    print(f"Argus UI → http://{('localhost' if BIND in ('127.0.0.1','localhost') else BIND)}:{PORT}",
          file=sys.stderr)
    if BIND != "127.0.0.1":
        print(f"[warn] binding to {BIND} — /v1/* admin endpoints require "
              f"ARGUS_ADMIN_TOKEN; operator UI pages are unauthenticated.",
              file=sys.stderr)
    # Touch admin_token so the bootstrap path runs on first boot and we
    # surface the location in the log.
    _ = ke_secret.admin_token()
    # Make sure the 'default' project exists so bare /v1/... keeps routing.
    try:
        ke_projects.ensure_default()
    except Exception as e:
        print(f"[startup] ensure_default failed: {e}", file=sys.stderr)
    ThreadingHTTPServer((BIND, PORT), H).serve_forever()
