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

import html
import json
import subprocess
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import store

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
    r = store.pg("SELECT id,target_db,started_at,total_opportunity,total_at_risk,"
                 "playbooks_valid,memo_md FROM autopilot.run WHERE status='succeeded' "
                 "ORDER BY id DESC LIMIT 1;", capture=True)
    return r[0] if r else None


def findings_for(run_id):
    return store.pg("SELECT title,severity,headline,gross_value,opportunity_value,basis,"
                    "recommended_action,receipt_sql,metrics FROM autopilot.finding "
                    f"WHERE run_id={int(run_id)} ORDER BY opportunity_value DESC;", capture=True)


def runs_history():
    return store.pg("SELECT id,target_db,started_at,total_opportunity,total_at_risk,playbooks_valid "
                    "FROM autopilot.run WHERE status='succeeded' ORDER BY id DESC LIMIT 8;", capture=True)


def connectors():
    return store.pg("SELECT id,name,dbname,pg_user,enabled,last_status,last_tested "
                    "FROM autopilot.connector ORDER BY id;", capture=True)


def exec_summary(memo):
    if not memo or "## Executive summary" not in memo:
        return ""
    c = memo.split("## Executive summary", 1)[1].split("##", 1)[0]
    return " ".join(l.strip() for l in c.splitlines()
                    if l.strip() and not l.strip().startswith("_↑"))


def get_crontab():
    p = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    return p.stdout if p.returncode == 0 else ""


# ---------- chrome ----------
def page(active, body):
    nav = "".join(
        f'<a href="{href}" class="{ "on" if active==key else "" }">{label}</a>'
        for key, href, label in (("reports", "/", "Reports"),
                                  ("connectors", "/connectors", "Connectors"),
                                  ("schedule", "/schedule", "Schedule")))
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
    body = f"""<h1>Reports</h1>
<p class=muted>Run #{run['id']} · target <b>{esc(run['target_db'])}</b> · {len(fs)} findings · {run['started_at'][:16]}</p>
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


# ---------- actions ----------
def test_connector(cid):
    rows = store.pg(f"SELECT dbname,pg_user FROM autopilot.connector WHERE id={int(cid)};", capture=True)
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

    def do_GET(self):
        try:
            if self.path in ("/", "/index.html"):
                self._send(view_reports())
            elif self.path == "/connectors":
                self._send(view_connectors())
            elif self.path == "/schedule":
                self._send(view_schedule())
            else:
                self._send("not found", 404, "text/plain")
        except Exception as e:
            self._send(f"<pre>{esc(e)}</pre>", 500)

    def do_POST(self):
        try:
            f = self._form()
            if self.path == "/connectors/add":
                store.pg("INSERT INTO autopilot.connector (name,dbname,pg_user) VALUES "
                         f"({store.dq(f.get('name'))},{store.dq(f.get('dbname'))},"
                         f"{store.dq(f.get('pg_user','mehdi'))}) ON CONFLICT (dbname) DO NOTHING;")
                self._redirect("/connectors")
            elif self.path == "/connectors/toggle":
                store.pg(f"UPDATE autopilot.connector SET enabled = NOT enabled, updated_at=now() "
                         f"WHERE id={int(f['id'])};")
                self._redirect("/connectors")
            elif self.path == "/connectors/delete":
                store.pg(f"DELETE FROM autopilot.connector WHERE id={int(f['id'])};")
                self._redirect("/connectors")
            elif self.path == "/connectors/test":
                test_connector(f["id"]); self._redirect("/connectors")
            elif self.path == "/schedule/set":
                set_schedule(f["hour"]); self._redirect("/schedule")
            elif self.path == "/run-now":
                run_now(); self._redirect("/schedule")
            else:
                self._send("not found", 404, "text/plain")
        except Exception as e:
            self._send(f"<pre>{esc(e)}</pre>", 500)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    (HERE / "logs").mkdir(exist_ok=True)
    print(f"Argus UI → http://localhost:{PORT}", file=sys.stderr)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
