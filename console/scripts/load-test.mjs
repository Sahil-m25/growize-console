#!/usr/bin/env node
// M18-S01-T01 — LOAD TEST: 6 lead-side and 15 Investors-side restricted sandbox seats working the main pages for
// 20 minutes against staging. Records p95 page data time (slowest API read of each page), 429s by cause from the
// body, and — from Plane B (ops-<day>.jsonl under the staging LOG_DIR) — the in-flight peak against the 12/8 gate
// and Zoho's own 429s. It can only be proven on staging (M02-S10 sandbox + seeded users); pure parts are in
// load-test.lib.cjs and tested by load-test.test.cjs.
//
// Usage: node console/scripts/load-test.mjs [--config file] [--base-url url] [--duration-ms n] [--log-dir dir] [--out file] [--dry-run]
// Exit: 0 every acceptance check passed · 1 a check failed or was not measured · 2 configuration problem.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const L = require('./load-test.lib.cjs');
const { cookieFromStorageState } = require('./leak-matrix.lib.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const flag = (n) => args.includes(n);
const die = (m) => { console.error('load-test: ' + m); process.exit(2); };
const home = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

const cfgPath = path.resolve(opt('--config') || process.env.LOAD_TEST_CONFIG || path.join(here, 'load-test.config.json'));
if (!fs.existsSync(cfgPath)) die(`no config at ${cfgPath} (copy load-test.config.example.json)`);
let cfg, plan, run;
try {
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (opt('--duration-ms')) cfg.durationMs = Number(opt('--duration-ms'));
  run = L.settings(cfg);
  plan = L.planSeats(cfg);
  for (const s of plan.seats) s.pages = L.pagesFor(cfg, s);
} catch (e) { die(e.message); }
const baseUrl = opt('--base-url') || process.env.STAGING_URL || cfg.baseUrl;
if (!baseUrl || /example\.invalid/.test(baseUrl)) die('set baseUrl (or STAGING_URL) to the staging deployment');
const u = new URL(baseUrl);
if (u.port === '3001') die("port 3001 is the front-end loop's; point at staging");
const logDir = opt('--log-dir') || cfg.logDir || '';
for (const w of plan.warnings) console.log('warn: ' + w);

if (flag('--dry-run')) {
  console.log(JSON.stringify({ baseUrl: u.origin, durationMs: run.durationMs, rampMs: run.rampMs, thinkMs: run.thinkMs, logDir: logDir || null,
    seats: plan.seats.map((s) => ({ seat: s.seat, side: s.side, pages: s.pages })) }, null, 1));
  process.exit(0);
}

const sessionsDir = home(cfg.sessionsDir || '~/.growize-jev/sessions');
const cookieOf = {};
for (const [name, s] of Object.entries(cfg.seats)) {
  if (s.cookie) { cookieOf[name] = s.cookie; continue; }
  const p = path.resolve(sessionsDir, home(s.storageState));
  if (!fs.existsSync(p)) die(`seat ${name}: no saved session at ${p} (run jev-sessions.mjs sign-in as that sandbox user)`);
  cookieOf[name] = cookieFromStorageState(JSON.parse(fs.readFileSync(p, 'utf8')), baseUrl);
  if (!cookieOf[name]) die(`seat ${name}: the saved session has no cookie for ${u.hostname}`);
}

async function read(seat, p) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), run.timeoutMs);
  try {
    const res = await fetch(new URL(p, baseUrl), { headers: { cookie: cookieOf[seat.name], accept: 'application/json' }, redirect: 'manual', signal: ctl.signal });
    const text = await res.text(); // page data time includes the body
    return { status: res.status, cause: res.status >= 400 ? L.causeOf429(res.status, undefined, text) : null };
  } catch {
    return { status: null, cause: null };
  } finally { clearTimeout(t); }
}

const samples = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = Date.now();
const deadline = startedAt + run.rampMs + run.durationMs;
async function work(seat, i) {
  await sleep(Math.round((run.rampMs * i) / plan.seats.length));
  let k = Math.floor(Math.random() * seat.pages.length);
  while (Date.now() < deadline) {
    const page = seat.pages[k++ % seat.pages.length];
    const t0 = performance.now();
    const at = Date.now();
    const got = await Promise.all(page.paths.map((p) => read(seat, p)));
    samples.push({ seat: seat.seat, side: seat.side, page: page.name, startedAt: at, ms: Math.round(performance.now() - t0),
      statuses: got.map((g) => g.status), causes: got.map((g) => g.cause) });
    await sleep(L.thinkFor(run.thinkMs));
  }
}
const ticker = setInterval(() => {
  const s = L.summarise(samples);
  console.log(`${Math.round((Date.now() - startedAt) / 1000)}s · ${s.pages} pages · p95 ${s.p95 ?? '-'} ms · failed ${s.failed} · 429 ${JSON.stringify(s.causes)}`);
}, 60_000);
await Promise.all(plan.seats.map((s, i) => work(s, i)));
clearInterval(ticker);
const endedAt = Date.now();

// Only the steady window (after ramp-up) counts toward the acceptance figures.
const steady = samples.filter((s) => s.startedAt >= startedAt + run.rampMs);
const summary = L.summarise(steady);
let planeB = null;
if (logDir) {
  const records = [];
  for (const day of L.logDays(startedAt, endedAt)) {
    const f = path.join(home(logDir), `ops-${day}.jsonl`);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) { if (!line) continue; try { records.push(JSON.parse(line)); } catch { /* a torn last line */ } }
  }
  planeB = L.planeBPeaks(records, startedAt, endedAt);
}
const v = L.verdict(summary, planeB, run.limits);
const report = { baseUrl: u.origin, startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(),
  seats: { lead: plan.seats.filter((s) => s.side === 'lead').length, investors: plan.seats.filter((s) => s.side === 'investors').length },
  warnings: plan.warnings, summary, planeB, verdict: v };
const out = opt('--out');
if (out) fs.writeFileSync(path.resolve(out), JSON.stringify(report, null, 1));
for (const c of v.checks) console.log(`${c.ok === true ? 'ok  ' : c.ok === false ? 'FAIL' : 'n/a '} ${c.name}: ${c.value ?? '-'} (limit ${c.limit ?? '-'})`);
for (const p of summary.byPage.slice(0, 6)) console.log(`     ${p.side}:${p.page} n ${p.n} p50 ${p.p50} p95 ${p.p95} max ${p.max} failed ${p.failed}`);
if (!logDir) console.log('n/a: pass --log-dir (the staging LOG_DIR) to measure the gate peak and Zoho 429s from Plane B');
process.exit(v.pass ? 0 : 1);
