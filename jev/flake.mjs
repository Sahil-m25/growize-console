#!/usr/bin/env node
// M19-S08 — the flake log and the quarantine list (D63). No Jev calls: it reads runner results.
//   node jev/flake.mjs record <results.json> [--date YYYY-MM-DD]   append each case's verdict to the log; a case that flipped
//                                                                    (PASS <-> not PASS) twice in 7 days moves to quarantine.json
//   node jev/flake.mjs list                                          the quarantine list, with fix-by dates and which are overdue
//   node jev/flake.mjs check <results.json>                          what CI does: quarantined cases are shown as failing, only the rest can block (exit 1)
//   node jev/flake.mjs release <TC-id>                               take a case off the list once its fix is in
// Files: jev/quarantine.json (committed — it is a decision), jev/flake-log.jsonl (committed — the history the 7-day rule reads).
// Env JEV_QUARANTINE / JEV_FLAKE_LOG point elsewhere (the tests do). Calibration cases (expect_fail) are never logged or quarantined.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
export const QUARANTINE = () => process.env.JEV_QUARANTINE || path.join(here, "quarantine.json");
export const FLAKE_LOG = () => process.env.JEV_FLAKE_LOG || path.join(here, "flake-log.jsonl");
export const WINDOW_DAYS = 7, FLIPS_TO_QUARANTINE = 2, FIX_BY_DAYS = 14;
const DAY = 86400000, day = d => new Date(d + "T00:00:00Z").getTime();
const addDays = (d, n) => new Date(day(d) + n * DAY).toISOString().slice(0, 10);

export function loadQuarantine(file = QUARANTINE()) { try { const j = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(j.cases) ? j : { ...j, cases: [] }; } catch { return { cases: [] }; } }
export const quarantinedIds = (q = loadQuarantine()) => new Set(q.cases.map(c => c.id));
export function readLog(file = FLAKE_LOG()) { try { return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } }

/* Flip dates of one case: the days on which its PASS/not-PASS class differs from the previous entry. Same-day entries are one reading
   (the last one counts), so three re-runs in a morning are not three flips. */
export function flipsOf(entries) {
  const byDay = new Map(); for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) byDay.set(e.date, e.verdict === "PASS");
  const out = []; let prev; for (const [d, pass] of byDay) { if (prev !== undefined && pass !== prev) out.push(d); prev = pass; }
  return out;
}

/* Pure core: a log (before this run) + this run's results + date → new entries, and the ids to quarantine. */
export function plan(log, results, date, already = new Set()) {
  const entries = results.filter(r => !r.expect_fail && r.id && ["PASS", "FAIL", "REVIEW"].includes(r.verdict)).map(r => ({ id: r.id, verdict: r.verdict, p: typeof r.p === "number" ? +r.p.toFixed(2) : null, date }));
  const all = [...log, ...entries], flips = {}, add = [];
  for (const id of new Set(entries.map(e => e.id))) {
    const recent = flipsOf(all.filter(e => e.id === id)).filter(d => day(date) - day(d) < WINDOW_DAYS * DAY && day(d) <= day(date));
    flips[id] = recent; if (recent.length >= FLIPS_TO_QUARANTINE && !already.has(id)) add.push({ id, flips: recent });
  }
  return { entries, flips, add };
}

export function record(results, { date = new Date().toISOString().slice(0, 10), log = FLAKE_LOG(), quarantine = QUARANTINE() } = {}) {
  const q = loadQuarantine(quarantine); const p = plan(readLog(log), results, date, quarantinedIds(q));
  if (p.entries.length) fs.appendFileSync(log, p.entries.map(e => JSON.stringify(e)).join("\n") + "\n");
  for (const a of p.add) q.cases.push({ id: a.id, since: date, fix_by: addDays(date, FIX_BY_DAYS), reason: `flipped ${a.flips.length}x in ${WINDOW_DAYS} days (${a.flips.join(", ")})`, flips: a.flips });
  if (p.add.length) fs.writeFileSync(quarantine, JSON.stringify({ ...q, cases: q.cases }, null, 1) + "\n");
  return { logged: p.entries.length, quarantined: p.add.map(a => a.id) };
}

/* What CI does with a results list: quarantined cases are reported as failing but cannot block; calibration cases are never excused. */
export function gate(results, q = loadQuarantine(), today = new Date().toISOString().slice(0, 10)) {
  const ids = quarantinedIds(q), by = Object.fromEntries(q.cases.map(c => [c.id, c]));
  const notPass = results.filter(r => !r.expect_fail && r.verdict !== "PASS");
  const quarantined = notPass.filter(r => ids.has(r.id)).map(r => ({ ...r, fix_by: by[r.id].fix_by, overdue: !!by[r.id].fix_by && by[r.id].fix_by < today }));
  return { blocking: notPass.filter(r => !ids.has(r.id)), quarantined, overdue: q.cases.filter(c => c.fix_by && c.fix_by < today) };
}

export function run(argv) {
  const [cmd, ...a] = argv; const opt = k => (a.includes(k) ? a.splice(a.indexOf(k), 2)[1] : undefined);
  const date = opt("--date");
  if (cmd === "record" && a[0]) { const r = record(JSON.parse(fs.readFileSync(a[0], "utf8")).results || [], date ? { date } : {}); console.log(`logged ${r.logged} case results` + (r.quarantined.length ? `; QUARANTINED ${r.quarantined.join(", ")}` : "")); return 0; }
  if (cmd === "list") { const q = loadQuarantine(), t = new Date().toISOString().slice(0, 10); if (!q.cases.length) console.log("quarantine is empty"); for (const c of q.cases) console.log(`${c.id}  since ${c.since}  fix by ${c.fix_by}${c.fix_by < t ? "  OVERDUE" : ""}  ${c.reason}`); return 0; }
  if (cmd === "check" && a[0]) {
    const g = gate(JSON.parse(fs.readFileSync(a[0], "utf8")).results || []);
    for (const r of g.quarantined) console.log(`QUARANTINED  ${r.id} ${r.verdict}${r.p != null ? " " + r.p : ""}  failing, does not block (fix by ${r.fix_by}${r.overdue ? ", OVERDUE" : ""})`);
    for (const r of g.blocking) console.log(`BLOCKING     ${r.id} ${r.verdict}`);
    return g.blocking.length ? 1 : 0;
  }
  if (cmd === "release" && a[0]) { const f = QUARANTINE(), q = loadQuarantine(f), n = q.cases.length; q.cases = q.cases.filter(c => c.id !== a[0]); fs.writeFileSync(f, JSON.stringify(q, null, 1) + "\n"); console.log(n === q.cases.length ? `${a[0]} was not quarantined` : `released ${a[0]}`); return 0; }
  console.error("usage: node jev/flake.mjs record <results.json> [--date D] | list | check <results.json> | release <TC-id>"); return 64;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
