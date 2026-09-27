"""Build the Slack canvas markdown for the Growize Build Tracker from the plan + autopilot progress.
Usage: node autopilot/status.mjs && python3 ops/tracker/canvas.py > ops/tracker/canvas.md   (read-only; never writes Slack itself)"""
import json, re, collections, datetime
P = json.load(open('pm/plan-merged/growize-console-plan.json', encoding='utf-8'))
PR = json.load(open('autopilot/console/progress.json', encoding='utf-8'))
blocked = open('autopilot/console/BLOCKED.md', encoding='utf-8').read()
st = {k: v.get('status') for k, v in PR['stories'].items()}
IC = {'done': 'Done', 'review': 'Review', 'waiting': 'Waiting on people', 'in_progress': 'Building', 'regressed': 'Regressed', None: 'To do'}
stories = [s for s in P['stories'] if s.get('plan') == 'In plan']
try: AU = json.load(open('ops/tracker/audit.json', encoding='utf-8'))['stories']
except Exception: AU = {}
FE = {'built': 'Built (demo data)', 'partly': 'Partly built', 'not started': 'Not started', 'n/a': 'Not a screen'}
sub = collections.defaultdict(list)
for t in P['subtasks']: sub[t['story']].append(t)
subdone = {k for k, v in PR.get('subtasks', {}).items() if v.get('status') == 'done'}
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30))).strftime('%d %b %Y %H:%M IST')
cnt = collections.Counter(st.get(s['id']) for s in stories)
out = []
out.append(f"::: {{.callout}}\n**Updated {now}** from the build itself (autopilot progress). Statuses are not edited here; comment on a row instead.\n:::\n")
out.append("# :bar_chart: Summary\n")
out.append(f"|Stories in build|Done|Building|Review|Waiting on people|To do|\n|---|---|---|---|---|---|\n|{len(stories)}|{cnt['done']}|{cnt['in_progress']}|{cnt['review']+cnt['regressed']}|{cnt['waiting']}|{cnt[None]}|\n")
# ---- time views: holistic goal, month and week (from autopilot/status.json forecasts, D66 progress-based) ----
S = json.load(open('autopilot/status.json', encoding='utf-8'))
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
def d(x): return datetime.datetime.fromisoformat(x.replace('Z', '+00:00')).astimezone(IST)
tg = S['targets']; start = d(tg['build_start']); target = d(tg['build_target']); fin = d(S['finish']['all']); tend = d(S['test_end'])
today = datetime.datetime.now(IST)
done_at = {k: d(v['at']) for k, v in PR['stories'].items() if v.get('status') == 'done' and v.get('at')}
proj = {k: d(v) for k, v in S.get('projected', {}).items() if st.get(k) != 'done'}  # a finished story counts once, on the day it finished
ids = {s['id'] for s in stories}
def wk(x): m = (x - datetime.timedelta(days=x.weekday())).date(); return m
time = []
time.append("# :compass: Goal and forecast\n")
time.append(f"**Goal:** the whole Growize Console (lead side and Investors side, one app on Zoho) built by ![](slack_date:{target.date()}), then tested and hardened, and live when the go-live checks pass.\n")
ok = ':large_green_circle: On track' if S.get('on_track') else ':red_circle: Behind'
time.append("|Measure|Value|\n|---|---|")
time.append(f"|Status|{ok}|")
time.append(f"|Built so far|{sum(st.get(i)=='done' for i in ids)} of {len(ids)} stories ({round(100*sum(st.get(i)=='done' for i in ids)/len(ids))}%)|")
time.append(f"|Pace now|{S.get('measured_pace')} stories/day ({S.get('pace_source')})|")
time.append(f"|Pace needed for the target|{round(S.get('needed_pace',0),1)} stories/day|")
time.append(f"|Build target|![](slack_date:{target.date()})|")
time.append(f"|Forecast: everything built|![](slack_date:{fin.date()})|")
time.append(f"|Forecast: testing finished (earliest go-live)|![](slack_date:{tend.date()})|")
time.append("\nDates are forecasts from the measured pace, not fixed deadlines (D66). They move every time the build finishes a story.\n")
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
out.append("# :mag: Where the build really is (audit 27 Sep)\n")
out.append("|Layer|State|\n|---|---|")
out.append(f"|Front end (screens)|{fec['built']} stories built, {fec['partly']} partly, {fec['not started']} not started, {fec['n/a']} have no screen|")
out.append("|Lead side screens|Ported from the IR console prototype: Today, Leads, Lead page, Add/CSV, Events, Plan, Numbers, Activity, Teams, System, Profile, Updates, Payments (IR claims), Documents (paperwork), Transfers|")
out.append("|Investors side screens|Not started: Investors list and record, Farms and allotments, Tickets, Investor updates, Finance receipts and matching, payouts, app access|")
out.append("|Connected to Zoho|No screen reads or writes Zoho yet; every page runs on demo data (the Zoho adapter is a stub)|")
out.append("|Zoho org|Modules and fields in place (M02 done items); still open: profiles per seat, field-level security (PAN not encrypted, only Administrator and Standard profiles exist), sharing rules, test user, sandbox and OAuth client|")
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
    out.append("|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|\n|---|---|---|---|---|---|---|")
    for s in es:
        ts = sub[s['id']]; hd = [t for t in ts if not str(t.get('doer') or t.get('owner') or '').startswith('Autopilot')]
        title = s['title'].replace('|', '/')[:110]
        au = AU.get(s['id'], {}); zo = 'Yes' if st.get(s['id']) == 'done' and s['epic'] == 'M02' else 'No'
        out.append(f"|**{s['id']}** {title}|{IC.get(st.get(s['id']), IC[None])}|{FE.get(au.get('front_end'), '—')}|{zo}|{s.get('stage','')}|{s.get('priority','')}|{sum(t['id'] in subdone for t in ts)}/{len(ts)}|")
    out.append("")
print("\n".join(out))
