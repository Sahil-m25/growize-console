"""Build the Slack canvas markdown for the Growize Build Tracker from the plan + autopilot progress.
Usage: python3 ops/tracker/canvas.py [--push]
  Refreshes autopilot/status.json, writes ops/tracker/canvas.md, and with --push replaces the Slack canvas body
  (needs a Slack bot token with canvases:write in ops/tracker/.slack-token or SLACK_BOT_TOKEN; without one it only writes the file).
  autopilot/done.mjs runs it with --push after every recorded round (D98)."""
import json, re, collections, datetime, os, sys, subprocess
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); os.chdir(ROOT)
subprocess.run(['node', 'autopilot/status.mjs'], check=False, capture_output=True)
PH = json.load(open('autopilot/phases.json', encoding='utf-8'))
P = json.load(open('pm/plan-merged/growize-console-plan.json', encoding='utf-8'))
PR = json.load(open('autopilot/console/progress.json', encoding='utf-8'))
blocked = open('autopilot/console/BLOCKED.md', encoding='utf-8').read()
st = {k: v.get('status') for k, v in PR['stories'].items()}
IC = {'done': 'Done', 'review': 'Review', 'waiting': 'Waiting on people', 'in_progress': 'Building', 'regressed': 'Regressed', None: 'To do'}
stories = [s for s in P['stories'] if s.get('plan') == 'In plan']
try: AU = json.load(open('ops/tracker/audit.json', encoding='utf-8'))['stories']
except Exception: AU = {}
PI = {'done': ':white_check_mark: Done', 'waiting': ':hourglass_flowing_sand: Waiting on people', 'review': ':eyes: Review', 'in_progress': ':hammer: Building', 'regressed': ':warning: Regressed', 'pending': 'To do'}
FE = {'built': 'Built (demo data)', 'partly': 'Partly built', 'not started': 'Not started', 'n/a': 'Not a screen'}
sub = collections.defaultdict(list)
for t in P['subtasks']: sub[t['story']].append(t)
subdone = {k for k, v in PR.get('subtasks', {}).items() if v.get('status') == 'done'}
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30))).strftime('%d %b %Y %H:%M IST')
cnt = collections.Counter(st.get(s['id']) for s in stories)
out = []
out.append(f"::: {{.callout}}\n**Updated {now}** from the build itself (autopilot progress). Statuses are not edited here; comment on a row instead.\n:::\n")
S = json.load(open('autopilot/status.json', encoding='utf-8'))
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
def d(x): return datetime.datetime.fromisoformat(x.replace('Z', '+00:00')).astimezone(IST)
tg = S['targets']; target = d(tg['build_target']); fin = d(S['finish']['all']); tend = d(S['test_end'])
today = datetime.datetime.now(IST)
cur = S.get('current_phase')
out.append("# :compass: Where we are\n")
out.append(f"**Goal:** the whole Growize Console (lead side and Investors side, one app on Zoho), built in three phases: **front end first, then plug into Zoho, then test**. Owner's build target ![](slack_date:{target.date()}).\n")
out.append(f"**Now working on:** {PH['names'].get(cur, 'all phases finished')}" + (f" — {PH['gate'][cur]}" if cur else "") + "\n")
if S.get('idle_hours') and S['idle_hours'] > 6: out.append(f"::: {{.callout}}\n:warning: The build loop has not run for {round(S['idle_hours'])} hours. Nothing moves until /build runs on the laptop again.\n:::\n")
out.append("|Phase|Done|Review|Left|Loop hours left|Forecast finish|Pace|\n|---|---|---|---|---|---|---|")
for k in PH['order']:
    x = S['phases'][k]; pct = round(100 * x['built'] / max(x['units'], 1))
    here = ' :arrow_left:' if k == cur else ''
    fin_k = 'done' if x['finish'] == 'done' else '![](slack_date:%s)' % d(x['finish']).date()
    pace = f"{x['minutes_per_unit']} min/unit measured" if x['source'] == 'measured' else 'assumed until 5 rounds'
    out.append(f"|**{x['name']}**{here}|{x['built']} of {x['units']} ({pct}%)|{x['review']}|{x['left']}|{x['loop_hours_left']}|{fin_k}|{pace}|")
ok = ':large_green_circle: On track' if S.get('on_track') else ':red_circle: Behind the target'
out.append(f"\n|Forecast|Date|\n|---|---|\n|All three phases through the loop|![](slack_date:{fin.date()})|\n|People's testing and UAT finished (earliest go-live)|![](slack_date:{tend.date()})|\n|Status|{ok}|\n")
out.append("::: {.callout}\n**What each phase needs from people.** Phase 1 needs nothing. Phase 2 cannot be tested without the Zoho **sandbox**, an **OAuth client** for the console and a licensed **test user** (Sahil, in BLOCKED.md); the autopilot writes the code meanwhile. Phase 3 needs the tester's weekend reviews and UAT by the business users.\n:::\n")
out.append(f"Forecast = loop hours left ÷ {S['loop_hours_per_day']} loop hours a day. Minutes per unit are assumptions until each phase has 5 measured rounds; then the measured pace takes over. Stories count once per phase they have work in.\n")
done_at = {k: d(v['at']) for k, v in PR['stories'].items() if v.get('status') == 'done' and v.get('at')}
proj = {}
for k, v in S.get('projected', {}).items():
    sid = k.split(':')[0]; proj[sid] = max(proj.get(sid, d(v)), d(v))
ids = {s['id'] for s in stories}
def wk(x): m = (x - datetime.timedelta(days=x.weekday())).date(); return m
time = []
time.append("## Stages\n\n|Stage|What it delivers|Stories|Done|Forecast done|\n|---|---|---|---|---|")
SD = {'S0':'Zoho org build-out and access wall','S1':'Foundations, access, test suite','S2':'Lead side daily work and Investors pages','S3':'Journey, gates, money, paper, Zoho Sign, farms','S4':'Updates, tickets, app push, activity, numbers, teams','S5':'Hardening, UAT, migration, release'}
for sg in ['S0','S1','S2','S3','S4','S5']:
    ss = [s['id'] for s in stories if s['stage'] == sg]
    last = max([proj[i] for i in ss if i in proj] or [None], key=lambda x: x or today) if any(i in proj for i in ss) else None
    time.append(f"|{sg}|{SD[sg]}|{len(ss)}|{sum(st.get(i)=='done' for i in ss)}|{'![](slack_date:%s)' % last.date() if last else ('done' if all(st.get(i)=='done' for i in ss) else '—')}|")
# month view
time.append("\n# :calendar: Month by month\n\n|Month|Stories finished|Forecast to finish|Cumulative forecast|\n|---|---|---|---|")
months = sorted({x.strftime('%Y-%m') for x in list(done_at.values()) + list(proj.values())})
cum = 0
for m in months:
    dn = sum(1 for k, x in done_at.items() if k in ids and x.strftime('%Y-%m') == m)
    fc = sum(1 for k, x in proj.items() if k in ids and x.strftime('%Y-%m') == m)
    cum += dn + fc
    time.append(f"|{datetime.datetime.strptime(m, '%Y-%m').strftime('%B %Y')}|{dn}|{fc}|{cum} of {len(ids)}|")
# week view
time.append("\n# :spiral_calendar_pad: Week by week\n\n|Week of|Finished|Forecast|Cumulative|Burn-up|\n|---|---|---|---|---|")
weeks = sorted({wk(x) for x in list(done_at.values()) + list(proj.values())})
cum = 0
for w in weeks:
    dn = sum(1 for k, x in done_at.items() if k in ids and wk(x) == w)
    fc = sum(1 for k, x in proj.items() if k in ids and wk(x) == w)
    cum += dn + fc; pct = round(100 * cum / len(ids))
    mark = ' **(this week)**' if w == wk(today) else ''
    time.append(f"|![](slack_date:{w}){mark}|{dn}|{fc}|{cum}|{':large_green_square:' * (pct // 10)}{':white_large_square:' * (10 - pct // 10)} {pct}%|")
# this week detail
thisw = wk(today)
time.append("\n## This week\n")
fin_w = [k for k, x in done_at.items() if k in ids and wk(x) == thisw]
due_w = sorted([k for k, x in proj.items() if k in ids and wk(x) == thisw], key=lambda k: proj[k])
stuck = [k for k in ids if st.get(k) in ('review', 'waiting', 'regressed')]
title = {s['id']: s['title'] for s in stories}
time.append(f"**Finished ({len(fin_w)}):** " + (", ".join(sorted(fin_w)) or "none yet"))
time.append(f"\n**Planned by the forecast ({len(due_w)}):** " + (", ".join(due_w) or "none"))
time.append(f"\n**Stuck: review or waiting on people ({len(stuck)}):**\n")
time += [f"- **{k}** {title[k][:90]} ({st.get(k)})" for k in sorted(stuck)] or ["- none"]
time.append("")
out += time
fec = collections.Counter(AU.get(s['id'], {}).get('front_end') for s in stories)
out.append("# :mag: What exists today (audit 27 Sep, re-checked by the D98 test run)\n")
out.append("|Layer|State|\n|---|---|")
out.append(f"|Front end (screens)|{fec['built']} stories built, {fec['partly']} partly, {fec['not started']} not started, {fec['n/a']} have no screen|")
out.append("|Lead side screens|Ported from the IR console prototype, but the port lost behaviour: Jev passes 22% of the lead-side cases (the same kind of cases passed 77% on the prototype on 25 Sep). No sign-in screen yet. Pages: Today, Leads, Lead page, Add/CSV, Events, Plan, Numbers, Activity, Teams, System, Profile, Updates, Payments (IR claims), Documents (paperwork), Transfers|")
out.append("|Investors side screens|Not started: Investors list and record, Farms and allotments, Tickets, Investor updates, Finance receipts and matching, payouts, app access|")
out.append("|Connected to Zoho|No screen reads or writes Zoho yet; every page runs on demo data (the Zoho adapter is a stub)|")
out.append("|Zoho org|Modules and fields in place (M02 done items); still open: profiles per seat, field-level security (PAN not encrypted, only Administrator and Standard profiles exist), sharing rules, test user, sandbox and OAuth client|")
try:
    RUN = json.load(open('ops/tracker/ui-run.json', encoding='utf-8'))
    out.append(f"|Tested by Jev|{RUN['summary']}|")
except Exception:
    out.append("|Tested by Jev|No story has passed Jev's screen tests yet|")
out.append("")
out.append("# :dart: Epics\n")
out.append("|Epic|Stage|Stories|Done|Progress|Goal|\n|---|---|---|---|---|---|")
for e in P.get('epics', []):
    es = [s for s in stories if s['epic'] == e['id']]
    if not es: continue
    d = sum(st.get(s['id']) == 'done' for s in es)
    pct = round(100 * d / len(es))
    bar = ':large_green_square:' * (pct // 20) + ':white_large_square:' * (5 - pct // 20)
    goal = re.sub(r'\s+', ' ', e.get('goal', ''))[:140].replace('|', '/')
    out.append(f"|**{e['id']}** {e['name']}|{e.get('stage','')}|{len(es)}|{d}|{bar} {pct}%|{goal}|")
out.append("\n# :hammer_and_wrench: People's to-do (from the build)\n")
items = [l[5:].strip() for l in blocked.splitlines() if l.startswith('- [ ]') and ', Autopilot' not in l]
out += [f"- [ ] {i[:300]}" for i in items] or ["- Nothing waiting on people."]
out.append("\n# :clipboard: Stories\n")
order = {'in_progress': 0, 'review': 1, 'regressed': 1, 'waiting': 2, None: 3, 'done': 4}
for e in P.get('epics', []):
    es = sorted([s for s in stories if s['epic'] == e['id']], key=lambda s: (order.get(st.get(s['id']), 3), s['id']))
    if not es: continue
    out.append(f"## {e['id']} · {e['name']}\n")
    out.append("|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|\n|---|---|---|---|---|---|---|---|")
    for s in es:
        ts = sub[s['id']]; hd = [t for t in ts if not str(t.get('doer') or t.get('owner') or '').startswith('Autopilot')]
        title = s['title'].replace('|', '/')[:110]
        au = AU.get(s['id'], {}); phs = PR['stories'].get(s['id'], {}).get('phases', {})
        tp = {p: [t for t in ts if str(t.get('doer') or '').startswith('Autopilot') and any(t['type'] in PH['types'][p] for _ in [0])] for p in PH['order']}
        cell = lambda p: '—' if not tp[p] else PI.get(phs.get(p), 'To do')
        out.append(f"|**{s['id']}** {title}|{cell('fe')}|{cell('zoho')}|{cell('test')}|{FE.get(au.get('front_end'), '—')}|{s.get('stage','')}|{s.get('priority','')}|{sum(t['id'] in subdone for t in ts)}/{len(ts)}|")
    out.append("")
md = "\n".join(out)
open('ops/tracker/canvas.md', 'w', encoding='utf-8').write(md)
if '--push' in sys.argv:
    tok = os.environ.get('SLACK_BOT_TOKEN') or (open('ops/tracker/.slack-token').read().strip() if os.path.exists('ops/tracker/.slack-token') else '')
    cid = json.load(open('ops/tracker/tracker.json'))['canvas_id']
    if tok:
        import urllib.request
        body = json.dumps({'canvas_id': cid, 'changes': [{'operation': 'replace', 'document_content': {'type': 'markdown', 'markdown': md}}]}).encode()
        req = urllib.request.Request('https://slack.com/api/canvases.edit', data=body, headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json; charset=utf-8'})
        try:
            r = json.load(urllib.request.urlopen(req, timeout=60)); print('slack:', 'ok' if r.get('ok') else r.get('error'))
        except Exception as e: print('slack push failed:', e)
    else: print('no Slack token: wrote ops/tracker/canvas.md only')
else: print(md)
