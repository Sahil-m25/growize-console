"""Build the Slack canvas markdown for the Growize Build Tracker from the plan + autopilot progress.
Usage: python3 ops/tracker/canvas.py > ops/tracker/canvas.md   (read-only; never writes Slack itself)"""
import json, re, collections, datetime
P = json.load(open('pm/plan-merged/growize-console-plan.json', encoding='utf-8'))
PR = json.load(open('autopilot/console/progress.json', encoding='utf-8'))
blocked = open('autopilot/console/BLOCKED.md', encoding='utf-8').read()
st = {k: v.get('status') for k, v in PR['stories'].items()}
IC = {'done': ':white_check_mark: Done', 'review': ':eyes: Review', 'waiting': ':hourglass_flowing_sand: Waiting on people',
      'in_progress': ':hammer: Building', 'regressed': ':warning: Regressed', None: ':white_circle: To do'}
stories = [s for s in P['stories'] if s.get('plan') == 'In plan']
sub = collections.defaultdict(list)
for t in P['subtasks']: sub[t['story']].append(t)
subdone = {k for k, v in PR.get('subtasks', {}).items() if v.get('status') == 'done'}
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30))).strftime('%d %b %Y %H:%M IST')
cnt = collections.Counter(st.get(s['id']) for s in stories)
out = []
out.append(f"::: {{.callout}}\n**Updated {now}** from the build itself (autopilot progress). Statuses are not edited here; comment on a row instead.\n:::\n")
out.append("# :bar_chart: Summary\n")
out.append(f"|Stories in build|Done|Building|Review|Waiting on people|To do|\n|---|---|---|---|---|---|\n|{len(stories)}|{cnt['done']}|{cnt['in_progress']}|{cnt['review']+cnt['regressed']}|{cnt['waiting']}|{cnt[None]}|\n")
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
    out.append("|Story|Status|Stage|Priority|Subtasks done|People steps|\n|---|---|---|---|---|---|")
    for s in es:
        ts = sub[s['id']]; hd = [t for t in ts if not str(t.get('doer') or t.get('owner') or '').startswith('Autopilot')]
        title = s['title'].replace('|', '/')[:110]
        out.append(f"|**{s['id']}** {title}|{IC.get(st.get(s['id']), IC[None])}|{s.get('stage','')}|{s.get('priority','')}|{sum(t['id'] in subdone for t in ts)}/{len(ts)}|{len(hd)}|")
    out.append("")
print("\n".join(out))
