// TC-E15-001 (M18-S01) — every page renders quickly for the largest book. Signed in as Tasneem (IR Manager, 18 leads in scope)
// on a LOCAL build (npm run build:local, start:local): open each page of the rail and the first lead page once (warm-up), then
// open them all again and time each one — from the click on its rail link until the path has changed and two animation frames
// have painted. Pass: every page opens, the slowest warm open is under --max (default 300 ms), none at or over it. The case's
// "13 pages" was the prototype's rail; the console's rail has fewer distinct pages (Today lists three links to /today) — the count is reported. A timing is a measurement on this machine, not a screen fact, so it is a script and not a Jev case.
//
//   node console/scripts/render-timing.mjs http://localhost:3176 [--who "Tasneem Qureshi"] [--max 300] [--out timing.json]
// Exit 0 all inside the limit · 1 over it, or a page did not open · 2 bad arguments / no browser.
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url); const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2); const url = (argv.find(a => /^https?:/.test(a)) || "").replace(/\/+$/, "");
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const who = opt("who", "Tasneem Qureshi"), max = +opt("max", 300), outFile = opt("out", null);
if (!url || !(max > 0)) { console.error("usage: node console/scripts/render-timing.mjs <url> [--who name] [--max ms] [--out f.json]"); process.exit(2); }
let chromium; for (const m of ["playwright", path.resolve("node_modules/playwright"), path.resolve(here, "..", "node_modules", "playwright")]) { try { ({ chromium } = require(m)); break; } catch {} }
if (!chromium) { console.error("render-timing: playwright not found"); process.exit(2); }
const browser = await chromium.launch(fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(url + "/");
await page.getByRole("button", { name: new RegExp(who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
await page.waitForFunction(() => document.querySelectorAll("aside a[href], nav a[href]").length > 1, null, { timeout: 15000 });
const rail = await page.evaluate(() => [...new Set([...document.querySelectorAll("aside a[href], nav a[href]")].filter(e => e.offsetParent).map(e => e.getAttribute("href")).filter(h => h && h.startsWith("/") && !h.startsWith("//") && !h.startsWith("/api/")))]);
/* the first lead page: from the Leads list, the first lead's name button (a lead is opened by a button, not a link) */
const openLead = async () => {
  const t = await page.evaluate(async () => {
    const b = document.querySelector(".g2-row .work-name"); if (!b) return { error: "no lead on the Leads page" };
    const t0 = performance.now(); b.click();
    await new Promise(done => { const end = performance.now() + 8000; const tick = () => (/^\/leads\/[A-Za-z0-9]/.test(location.pathname) ? requestAnimationFrame(() => requestAnimationFrame(done)) : performance.now() > end ? done() : setTimeout(tick, 0)); tick(); });
    if (!/^\/leads\/[A-Za-z0-9]/.test(location.pathname)) return { error: "the lead page did not open" };
    return { ms: Math.round(performance.now() - t0), path: location.pathname };
  });
  return t;
};
/* a click on the rail link, until the path is the link's and two frames have painted (client navigation: no reload) */
const open = href => page.evaluate(async h => {
  const t = performance.now();
  const a = document.querySelector(`a[href="${h}"]`);
  if (!a) return { error: "link not in the page" };
  a.click();
  await new Promise(done => { const end = performance.now() + 8000; const tick = () => (location.pathname === h ? requestAnimationFrame(() => requestAnimationFrame(done)) : performance.now() > end ? done() : setTimeout(tick, 0)); tick(); });
  if (location.pathname !== h) return { error: "the page did not open (still on " + location.pathname + ")" };
  return { ms: Math.round(performance.now() - t) };
}, href);
const times = {};
for (let pass = 0; pass < 2; pass++) {
  for (const h of rail) {
    const r = await open(h); if (r.error) { console.error(`${h}: ${r.error}`); process.exit(1); }
    await page.waitForTimeout(150);
    times[h] = r.ms;                                         /* the second pass overwrites the first: warm numbers */
  }
  await open("/leads"); await page.waitForSelector(".g2-row .work-name", { timeout: 15000 });
  const r = await openLead(); if (r.error) { console.error(r.error); process.exit(1); }
  await page.waitForTimeout(150);
  times["/leads/<first lead>"] = r.ms;
}
await browser.close();
const worst = Math.max(...Object.values(times)), slow = Object.keys(times).filter(k => times[k] >= max);
const report = { who, pagesChecked: Object.keys(times).length, maxWarmRenderMs: worst, pagesAtLimitOrMore: slow, limitMs: max, warmMs: times };
console.log(JSON.stringify(report, null, 1));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
process.exit(slow.length ? 1 : 0);
