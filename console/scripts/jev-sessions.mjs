// M19-S02-T01 — saved test sign-ins, one per seat, so the Jev runner never meets a Zoho password prompt.
//   node console/scripts/jev-sessions.mjs sign-in [seat ...]   opens a browser per seat at <staging>/api/auth/zoho; the
//        sandbox user signs in (typed by hand, or filled from JEV_PW_<SEAT> when config.seats.<seat>.login is set);
//        when /api/session answers with that seat the Playwright storageState is saved to its configured path.
//   node console/scripts/jev-sessions.mjs check [seat ...]      reports, per seat, whether the saved session still
//        signs in (server sessions last 12 h — re-run sign-in each testing day). Exit 1 if any is missing/expired.
// Seats, paths and sandbox logins come from console/scripts/jev-staging.config.json (see the .example file).
// Session files hold live cookies: keep sessionsDir outside the repo (default ~/.growize-jev/sessions).
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { loadConfig, sessionPath } = require("./jev-lib.cjs");

export async function whoIs(request, base) {
  const r = await request.get(new URL("/api/session", base).href).catch(() => null);
  if (!r || !r.ok()) return null;
  const j = await r.json().catch(() => ({})); return j.session || null;
}
/* Does the session belong to this seat? The app's session has { who, seat }; config may name the person key. */
export const matchesSeat = (session, seat, seatCfg = {}) => !!session && [seatCfg.who || seat].includes(session.who);

async function signIn(chromium, cfg, seat) {
  const sc = cfg.seats[seat] || {}; const out = sessionPath(cfg, seat);
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(new URL(cfg.signIn.startPath, cfg.baseUrl).href);
  const pw = process.env["JEV_PW_" + seat.toUpperCase()];
  if (sc.login && pw) {   // best effort on Zoho's login page; a person finishes it if the page differs or asks for OTP
    const s = { user: "#login_id", next: "#nextbtn", password: "#password", ...(cfg.signIn.selectors || {}) };
    try { await page.fill(s.user, sc.login, { timeout: 15000 }); await page.click(s.next); await page.fill(s.password, pw, { timeout: 15000 }); await page.click(s.next); }
    catch { console.log(`  ${seat}: could not fill the Zoho page — finish the sign-in by hand`); }
  } else console.log(`  ${seat}: sign in as ${sc.login || "the " + seat + " sandbox user"} in the opened window`);
  const until = Date.now() + cfg.signIn.timeoutMs; let session = null;
  while (Date.now() < until) {
    session = await whoIs(ctx.request, cfg.baseUrl);
    if (session) break; await page.waitForTimeout(2000);
  }
  let ok = false;
  if (!session) console.log(`  ${seat}: timed out, nothing saved`);
  else if (!matchesSeat(session, seat, sc)) console.log(`  ${seat}: signed in as ${session.who}, not ${sc.who || seat} — nothing saved`);
  else { fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 }); await ctx.storageState({ path: out }); fs.chmodSync(out, 0o600); ok = true; console.log(`  ${seat}: saved ${out}`); }
  await browser.close(); return ok;
}

async function check(pw, cfg, seat) {
  const p = sessionPath(cfg, seat);
  if (!fs.existsSync(p)) return { seat, ok: false, why: "no saved session" };
  const ctx = await pw.request.newContext({ storageState: p });
  const s = await whoIs(ctx, cfg.baseUrl); await ctx.dispose();
  return { seat, ok: matchesSeat(s, seat, cfg.seats[seat]), why: s ? `signed in as ${s.who}` : "expired or revoked" };
}

if (process.argv[1]?.endsWith("jev-sessions.mjs")) {
  const [cmd, ...only] = process.argv.slice(2); const cfg = loadConfig();
  if (!["sign-in", "check"].includes(cmd)) { console.error("usage: jev-sessions.mjs sign-in|check [seat ...]"); process.exit(64); }
  if (!cfg.baseUrl) { console.error("no staging URL: set STAGING_URL or baseUrl in the config"); process.exit(2); }
  const seats = only.length ? only : Object.keys(cfg.seats);
  if (!seats.length) { console.error("no seats configured"); process.exit(2); }
  let pw; for (const m of ["playwright", path.resolve("node_modules/playwright"), path.resolve(import.meta.dirname, "..", "node_modules", "playwright")]) { try { pw = require(m); break; } catch {} }
  if (!pw) { console.error("playwright not found (console/node_modules/playwright)"); process.exit(2); }
  let bad = 0;
  for (const seat of seats) {
    if (cmd === "sign-in") bad += (await signIn(pw.chromium, cfg, seat)) ? 0 : 1;
    else { const r = await check(pw, cfg, seat); if (!r.ok) bad++; console.log(`${r.ok ? "ok  " : "FAIL"} ${seat.padEnd(10)} ${r.why}`); }
  }
  process.exit(bad ? 1 : 0);
}
