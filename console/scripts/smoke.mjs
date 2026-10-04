// M19-S07 — the smoke suite: is the app up and sane, in under 3 minutes, against ANY url.
//
//   node console/scripts/smoke.mjs <url> [--mode deploy|production] [--out smoke.json] [--jev] [--budget-s 180]
//        [--ir "Rohit Deshpande"] [--inv "Meena Raghavan"]      who to pick on the fixture sign-in screen (local/demo builds)
//        [--storage-ir f.json] [--storage-inv f.json]           saved Playwright sessions instead (staging/production: sign-in is Zoho)
//        [--alert-webhook https://…]                            POST {text} here when it fails (or SMOKE_ALERT_WEBHOOK); not the app
//
// Checks (each is one line of the report; HTTP ones use fetch, page ones a real browser):
//   boots               GET / answers < 500 with an HTML page
//   sign-in screen      a signed-out visitor sees the sign-in screen (Zoho button, or the people list on a fixture build)
//   rail: IR side       signed in as an IR seat: every rail link opens and draws its page
//   rail: Investors     the same for an Investors-side seat
//   /api/data           answers JSON with Cache-Control: no-store, never a 5xx
//   security headers    CSP (no unsafe-inline/eval script), HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy on /, /api/data and a 404
//   no native dialogs   no alert/confirm/prompt fired and no uncaught page error during any page visit
//   --jev               the six plain-language cases of pm/smoke-cases.json through the Jev runner (deploy mode only: it saves a note on a test lead)
// A page check with no way to sign in (production, no --storage-*) is SKIPPED, loudly, never passed.
//
// Production mode is READ-ONLY by construction: the HTTP helper refuses anything but GET/HEAD/OPTIONS, the browser aborts every other
// method, nothing is clicked except rail links, and the test API must be shut (GET /api/test/* ≥ 400) and /api/data must refuse a visitor with no session.
// Exit: 0 all pass · 1 a check failed or the 3-minute budget was beaten · 2 bad arguments · (browser missing = a failed check, not an exit 2).
import fs from "node:fs"; import path from "node:path"; import { spawnSync } from "node:child_process";
import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { missingHeaders, cspProblem, parseArgs, isRead, summarise } = require("./smoke.lib.cjs");
const here = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(here, "..", "..");

const o = parseArgs(process.argv.slice(2));
if (o.errors.length) { console.error("smoke: " + o.errors.join("; ") + "\nusage: node scripts/smoke.mjs <url> [--mode deploy|production] [--out f.json] [--jev] [--budget-s 180] [--ir name] [--inv name] [--storage-ir f] [--storage-inv f] [--alert-webhook url]"); process.exit(2); }
const base = o.url.replace(/\/+$/, ""); const prod = o.mode === "production";
const t0 = Date.now(); const results = [];

const http = async (p, init = {}) => {
  const method = (init.method || "GET").toUpperCase();
  if (prod && !isRead(method)) throw new Error(`read-only mode refused ${method} ${p}`);
  return fetch(base + p, { redirect: "manual", signal: AbortSignal.timeout(20000), ...init, method });
};
async function check(name, fn) {
  const t = Date.now(); let r;
  try { r = (await fn()) || {}; } catch (e) { r = { ok: false, detail: String(e && e.message || e).slice(0, 300) }; }
  const row = { name, ok: r.skipped ? false : r.ok !== false, skipped: !!r.skipped, ms: Date.now() - t, detail: r.detail || "" };
  results.push(row); console.log(`${row.skipped ? "SKIP" : row.ok ? "PASS" : "FAIL"}  ${name.padEnd(20)} ${String(row.ms).padStart(5)} ms  ${row.detail}`);
}

// ---------- HTTP ----------
await check("boots", async () => {
  let r; for (let i = 0; i < 6; i++) { try { r = await http("/"); if (r.status < 500) break; } catch (e) { r = null; } await new Promise(s => setTimeout(s, 5000)); }   // a deploy may still be starting
  if (!r) return { ok: false, detail: "no answer from " + base };
  const html = await r.text();
  if (r.status >= 500) return { ok: false, detail: "GET / -> " + r.status };
  if (!/text\/html/.test(r.headers.get("content-type") || "") && r.status < 300) return { ok: false, detail: "GET / is not HTML" };
  return { detail: `GET / -> ${r.status}, ${html.length} bytes` };
});

await check("/api/data", async () => {
  const r = await http("/api/data"); const ct = r.headers.get("content-type") || "", cc = r.headers.get("cache-control") || "";
  if (r.status >= 500) return { ok: false, detail: "GET /api/data -> " + r.status };
  if (!/json/.test(ct)) return { ok: false, detail: `GET /api/data -> ${r.status} ${ct} (not JSON)` };
  if (!/no-store/.test(cc)) return { ok: false, detail: "Cache-Control is not no-store: " + cc };
  const body = await r.json().catch(() => undefined); if (body === undefined) return { ok: false, detail: "body is not JSON" };
  // production: a visitor with no session must be refused (a 200 there means fixture data is being served)
  if (prod && r.status !== 401 && r.status !== 403) return { ok: false, detail: `a visitor with no session got ${r.status}; production must answer 401/403` };
  return { detail: `GET /api/data -> ${r.status} JSON, no-store` };
});

await check("security headers", async () => {
  const bad = [];
  for (const p of ["/", "/api/data", "/__smoke-no-such-page"]) {
    const r = await http(p); const miss = missingHeaders(r.headers);
    if (miss.length) bad.push(`${p} lacks ${miss.join(", ")}`);
    if (p === "/") { const c = cspProblem(r.headers.get("content-security-policy")); if (c) bad.push("/ CSP: " + c); }
  }
  return bad.length ? { ok: false, detail: bad.join("; ") } : { detail: "6 headers on /, /api/data and a 404; CSP script-src has no inline/eval" };
});

if (prod) await check("test API shut", async () => {
  const bad = [];
  for (const p of ["/api/test/reset", "/api/test/fixture/DEMO_STAFF"]) { const r = await http(p); if (r.status < 400) bad.push(`GET ${p} -> ${r.status}`); }
  return bad.length ? { ok: false, detail: "the test API answers in production: " + bad.join(", ") } : { detail: "GET /api/test/* refused" };
});

// ---------- browser ----------
let chromium;
for (const m of ["playwright", path.resolve("node_modules/playwright"), path.resolve(here, "..", "node_modules", "playwright")]) { try { ({ chromium } = require(m)); break; } catch {} }
const dialogs = [], pageErrors = [], writes = [];
let browser;
const open = async (state) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(state ? { storageState: state } : {}) });
  const page = await ctx.newPage();
  page.on("dialog", d => { dialogs.push(`${d.type()}: ${d.message().slice(0, 80)}`); d.dismiss(); });
  page.on("pageerror", e => pageErrors.push(String(e.message).slice(0, 120)));
  if (prod) await page.route("**/*", rt => isRead(rt.request().method()) ? rt.continue() : (writes.push(rt.request().method() + " " + rt.request().url()), rt.abort()));
  return { ctx, page };
};
const text = page => page.evaluate(() => { const m = document.querySelector("#pane, main") || document.body; return m.innerText.trim(); });
const railLinks = page => page.evaluate(() => [...new Set([...document.querySelectorAll("aside a[href], nav a[href]")].filter(e => e.offsetParent).map(e => e.getAttribute("href")).filter(h => h && h.startsWith("/") && !h.startsWith("//")))]);

async function side(name, person, storage) {
  await check("rail: " + name, async () => {
    if (!chromium || !browser) return { ok: false, detail: "browser unavailable (playwright / chromium not found)" };
    if (storage && !fs.existsSync(storage)) return { ok: false, detail: "saved session not found: " + storage };
    const { ctx, page } = await open(storage || null);
    try {
      await page.goto(base + "/", { timeout: 30000 });
      if (!storage) {
        const btn = page.getByRole("button", { name: new RegExp(person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first();
        if (!(await btn.isVisible({ timeout: 8000 }).catch(() => false))) return { skipped: true, detail: `no way to sign in: no "${person}" on the sign-in screen and no --storage-${name.startsWith("IR") ? "ir" : "inv"} session` };
        await btn.click();
      }
      await page.waitForFunction(() => document.querySelectorAll("aside a[href], nav a[href]").length > 1, null, { timeout: 15000 }).catch(() => {});
      const links = await railLinks(page);
      if (links.length < 2) return { ok: false, detail: "no rail after sign-in (signed-in page shows no menu)" };
      const bad = [];
      for (const href of links) {
        const resp = await page.goto(base + href, { timeout: 30000 });
        const okText = await page.waitForFunction(() => { const m = document.querySelector("#pane, main") || document.body; return m.innerText.trim().length > 20; }, null, { timeout: 15000 }).then(() => true, () => false);
        const here_ = new URL(page.url()).pathname;
        if (resp && resp.status() >= 400) bad.push(`${href} -> ${resp.status()}`);
        else if (!okText) bad.push(`${href} drew nothing`);
        else if (here_ === "/" || /sign.?in|auth/.test(here_)) bad.push(`${href} bounced to ${here_}`);
        else if (!/^\/api\//.test(href) && !(await text(page)).length) bad.push(`${href} is empty`);
      }
      return bad.length ? { ok: false, detail: `${bad.length}/${links.length} rail pages broken: ${bad.join("; ")}` } : { detail: `${links.length} rail pages open as ${storage ? "saved session" : person}: ${links.join(" ")}` };
    } finally { await ctx.close(); }
  });
}

if (chromium) browser = await chromium.launch(fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {}).catch(e => { console.error("smoke: " + e.message.split("\n")[0]); return undefined; });

await check("sign-in screen", async () => {
  if (!browser) return { ok: false, detail: "browser unavailable (playwright / chromium not found)" };
  const { ctx, page } = await open(null);
  try {
    await page.goto(base + "/", { timeout: 30000 });
    const seen = await page.waitForFunction(() => /Continue with Zoho/i.test(document.body.innerText) ? "Zoho button" : [...document.querySelectorAll("button")].filter(b => b.offsetParent).length > 3 ? "people list" : false, null, { timeout: 15000 }).then(h => h.jsonValue(), () => false);
    return seen ? { detail: "signed-out visitor sees the sign-in screen (" + seen + ")" } : { ok: false, detail: "no sign-in screen for a signed-out visitor: " + (await text(page)).slice(0, 80).replace(/\s+/g, " ") };
  } finally { await ctx.close(); }
});
await side("IR side", o.ir, o.storageIr);
await side("Investors side", o.inv, o.storageInv);
if (browser) await browser.close();

await check("no native dialogs", async () => {
  if (!browser && !chromium) return { ok: false, detail: "browser unavailable" };
  const bad = [...dialogs.map(d => "dialog " + d), ...pageErrors.map(e => "page error " + e)];
  return bad.length ? { ok: false, detail: bad.slice(0, 5).join("; ") } : { detail: "0 dialogs, 0 uncaught page errors" };
});

// production mode: nothing the browser did was a write (the sign-in picker of a fixture build is one — production has only Zoho)
if (prod) await check("read-only", async () => writes.length ? { ok: false, detail: "the browser tried to write: " + [...new Set(writes)].slice(0, 4).join("; ") } : { detail: "0 non-GET requests left the browser" });

// ---------- Jev (deploy mode) ----------
if (o.jev) await check("Jev: 6 smoke cases", async () => {
  const out = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "smoke-")), "jev.json");
  spawnSync(process.execPath, [path.join(ROOT, "pm/jev-ui-runner.mjs"), "--retry-review", path.join(ROOT, "pm/smoke-cases.json"), base, out], { cwd: ROOT, stdio: "inherit", env: { ...process.env, APP_URL: base } });
  if (!fs.existsSync(out)) return { ok: false, detail: "the Jev runner wrote no result" };
  const r = JSON.parse(fs.readFileSync(out, "utf8")).results || []; const bad = r.filter(x => x.verdict !== "PASS");
  return bad.length || !r.length ? { ok: false, detail: bad.map(x => `${x.id} ${x.verdict}`).join(", ") || "no cases ran" } : { detail: `${r.length}/${r.length} PASS` };
});

const sum = summarise(results, { mode: o.mode, budgetS: o.budgetS, elapsedMs: Date.now() - t0 });
console.log("\n" + sum.line);
for (const f of sum.failed) console.log("  FAIL " + f.name + ": " + f.detail);
if (o.out) fs.writeFileSync(o.out, JSON.stringify({ ran: new Date().toISOString(), url: base, mode: o.mode, ok: sum.ok, elapsed_ms: Date.now() - t0, results }, null, 1));
if (!sum.ok && o.alertWebhook) {
  const text_ = `Growize ${o.mode} smoke FAILED on ${base}: ${sum.failed.map(f => f.name + " (" + f.detail.slice(0, 120) + ")").join("; ") || "over the time budget"}`;
  await fetch(o.alertWebhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: text_ }), signal: AbortSignal.timeout(15000) })
    .then(r => console.log("alert sent: " + r.status), e => console.log("alert NOT sent: " + e.message));
}
process.exit(sum.code);
