// Jev UI runner: runs plain-language test cases through the visible UI in a real browser.
// Each step is written the way a tester would say it ("Press 'Assign to me' on Ritu Anand's row").
// For every step the runner lists the controls on screen and Jev picks the one the step means (Choice);
// quoted text in the step is what gets typed. No app internals are used, so the same cases run on the
// prototype today and on the built app later. At the end Jev judges the screen against the expected result (Noul).
//
// Usage: node jev-ui-runner.mjs <cases.json> <url-or-html> [out.json]   (env ONLY=UI-001,UI-002 runs a subset)
// Preconditions are named fixtures (FIXTURES=fixtures.json): { "<name>": { "description", "prototype": "JS run in the prototype page",
// "staging": "how the record is seeded in the Zoho sandbox for the built app" } }. A case lists the fixtures it needs in `fixtures`.
// Writing cases: one action per step, using the visible label ("Press 'Assign to me' on Ritu Anand's row", "Type 'Rahul' in the find-an-investor box");
// expected = a list of separate facts about what the screen shows after the steps (no "no longer", no internal names).
// Calibration: cases with expect_fail are deliberately wrong; a run where any of them PASSES is not trusted.
// Flags: --retry-review runs a REVIEW case once more and keeps the better-evidenced result (M19-S08; see docs/runbooks/jev-rebaseline.md).
// Waits (M19-S08): after each step the runner waits for the page to settle (no request in flight and no DOM change for SETTLE_MS, default 250,
// capped at SETTLE_CAP_MS, default 6000), not a fixed 300 ms. A case's `wait` still sets the quiet time and, when it is longer than
// the cap, lifts the cap to wait + 1 s for that case (M19-S08-NOTE-2: TC-E07-012 waits 11 s for the 10 s Undo window to close).
// Key: TYPESAFE_API_KEY, or TS_KEY_FILE, or .typesafe-key at the repo root (never commit it) — looked up by jev/client.mjs.
// Result per case: PASS (p ≥ PASS_AT, default 0.80 — see calibration note below) · FAIL (p ≤ 0.10) · REVIEW (between, or a step Jev was unsure about: top choice < 0.60).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createClient, findKey } from "../jev/client.mjs";
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
let chromium; for (const m of ["playwright", path.resolve("node_modules/playwright"), path.resolve(here, "..", "console", "node_modules", "playwright")]) { try { ({ chromium } = require(m)); break; } catch {} }
if (!chromium) { console.error("playwright not found: run scripts/setup (console/node_modules/playwright)"); process.exit(2); }
// D107 (M19-S13): the fetch goes through the one Jev client (key lookup, retry, cache, log in jev/logs/calls.jsonl).
// Only the fetch moved: the questions below, STEP_MIN, PASS_AT and the verdict logic are unchanged
// (jev/questions/pick-control.mjs and judge-fact.mjs hold byte-identical copies, checked by jev/test/questions.test.mjs).
if (!findKey()) throw new Error("No TypeSafe key");
const client = createClient({ retries: 4, backoffMs: 2000 });
const argv = process.argv.slice(2); const RETRY_REVIEW = argv.includes("--retry-review") || process.env.JEV_RETRY_REVIEW === "1";
const [casesFile, target, outArg] = argv.filter(a => a !== "--retry-review");
const cases = JSON.parse(fs.readFileSync(casesFile, "utf8")).cases;
const url = /^https?:/.test(target) ? target : "file://" + path.resolve(target);
const STEP_MIN = 0.6;
// PASS threshold measured on this project (24 Sep 2026, jev-calibrate.mjs): at 0.80, 0 clear false passes in 375 near-miss wrong facts
// and 14/14 seeded-wrong cases caught, while 92% of true cases pass (80% at 0.90). Re-measure after big UI changes.
const PASS_AT = +(process.env.PASS_AT || 0.8);
const FIX = process.env.FIXTURES && fs.existsSync(process.env.FIXTURES) ? JSON.parse(fs.readFileSync(process.env.FIXTURES, "utf8")) : {};
// Investors-side fixtures are filed as "IM:<NAME>" while ui-cases.json cites them bare (same rule as the app's resolveFixture).
for (const k of Object.keys(FIX)) if (k.startsWith("IM:") && !FIX[k.slice(3)]) FIX[k.slice(3)] = FIX[k];
// M19-S08: the settle wait. The page counts DOM changes and requests in flight (init script); this side polls both
// on its own clock, so it also works under page.clock.install.
const SETTLE_MS = +(process.env.SETTLE_MS || 250), SETTLE_CAP_MS = +(process.env.SETTLE_CAP_MS || 6000);
const tracker = () => {
  if (window.__jevSettle) return; const st = window.__jevSettle = { mut: 0, inflight: 0 };
  const F = window.fetch; if (F) window.fetch = function () { st.inflight++; const done = () => { st.inflight--; }; const p = F.apply(this, arguments); p.then(done, done); return p; };
  const send = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function () { st.inflight++; let d = false; const done = () => { if (!d) { d = true; st.inflight--; } }; this.addEventListener("loadend", done); return send.apply(this, arguments); };
  const watch = () => new MutationObserver(rs => { for (const r of rs) if (r.type !== "attributes" || r.attributeName !== "data-jevid") { st.mut++; break; } })
    .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  watch();
};
async function settle(page, quiet = SETTLE_MS, cap = Math.max(SETTLE_CAP_MS, quiet + 1000)) {
  const t0 = Date.now(); let last = null, since = t0;
  while (Date.now() - t0 < cap) {
    const s = await page.evaluate(() => window.__jevSettle ? { m: window.__jevSettle.mut, f: window.__jevSettle.inflight } : null).catch(() => null);
    const now = Date.now(); const key = s ? s.m + "/" + s.f : "x";
    if (key !== last || !s || s.f > 0) { last = key; since = now; }   // a change, or something still in flight, restarts the quiet time
    else if (now - since >= quiet) return { waited: now - t0, capped: false };
    await new Promise(r => setTimeout(r, 40));
  }
  return { waited: Date.now() - t0, capped: true };
}
const wrap = code => `(async()=>{ ${code && /\breturn\b/.test(code) ? code : (code || "")} })()`;

const jev = (state, questions) => client.ask(state, questions, { caller: "ui-runner", def: "pick" in questions ? "pick-control@1" : "judge-fact@1" });

// What a person can see and use right now: controls with their visible name and the row they sit in.
async function controls(page) {
  return page.evaluate(() => {
    document.querySelectorAll("[data-jevid]").forEach(e => e.removeAttribute("data-jevid"));
    const sel = "summary, button, a[href], a[role], a[onclick], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=link], [onclick]";
    const seen = new Set(), out = [];
    for (const e of document.querySelectorAll(sel)) {
      if (!e.offsetParent || seen.has(e)) continue; seen.add(e);
      // inside a closed section it is not usable yet (a section's own header stays usable; headers nested in a closed section do not)
      let box = e.closest("details"); const hdr = e.closest("summary");
      if (hdr && box && hdr.parentElement === box) box = box.parentElement && box.parentElement.closest("details");
      if (box && !box.open) continue;
      const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      const lab = e.id && document.querySelector(`label[for="${e.id}"]`);
      // a box is named by its label (explicit, wrapping, aria-labelledby, or the text just before it), never by what is typed in it
      const isBox = /INPUT|TEXTAREA|SELECT/.test(e.tagName);
      const lby = e.getAttribute("aria-labelledby") && document.getElementById(e.getAttribute("aria-labelledby"));
      let near = "";
      if (isBox && !lab && !e.getAttribute("aria-label")) {
        const wrap = e.closest("label"); if (wrap) near = wrap.innerText;
        for (let n = e.previousElementSibling, k = 0; !near && n && k < 3; n = n.previousElementSibling, k++) if (n.innerText && n.innerText.trim()) near = n.innerText;
        if (!near && e.parentElement) { const t = e.parentElement.innerText.trim(); if (t && t.length < 60) near = t; }
      }
      const label = (e.getAttribute("aria-label") || (lab && lab.innerText) || (lby && lby.innerText) || near || "").trim().replace(/\s+/g, " ");
      const name = (isBox ? (label || e.placeholder || e.title || "") : (label || e.innerText || e.title || e.value || "")).trim().replace(/\s+/g, " ").slice(0, 70);
      const current = isBox && e.tagName !== "SELECT" && e.value ? e.value.slice(0, 40) : "";
      const kind = e.tagName === "SUMMARY" ? "section header (opens/closes a section)" : e.tagName === "SELECT" ? "dropdown" : /INPUT|TEXTAREA/.test(e.tagName) ? "text box" : e.tagName === "A" ? "link" : "button";
      // the smallest surrounding area whose text says more than the control itself (e.g. the lead's row)
      let ctx = "", up = e.parentElement;
      for (let k = 0; up && k < 8; k++, up = up.parentElement) {
        const t = up.innerText.trim().replace(/\s+/g, " ");
        if (t.length > name.length + 3) { ctx = t.slice(0, 110); break; }
      }
      const where = e.closest("dialog, [role=dialog], [class*=drawer], [class*=modal], [class*=panel]") ? "panel" : e.closest("nav, aside") ? "menu" : e.closest("header") ? "top bar" : "page";
      const opts = e.tagName === "SELECT" ? [...e.options].map(o => o.text).slice(0, 16).join(" / ") : "";
      // a whole row that is clickable AND contains its own named control: keep the inner, more specific one
      const inner = [...e.querySelectorAll(sel)].find(x => x !== e && x.offsetParent && name.startsWith((x.innerText || "").trim().replace(/\s+/g, " ").slice(0, 20)) && (x.innerText || "").trim());
      if (inner) continue;
      e.setAttribute("data-jevid", out.length);
      out.push({ id: out.length, current, kind: kind + (e.disabled || e.getAttribute("aria-disabled") === "true" ? " (disabled)" : ""), disabled: !!(e.disabled || e.getAttribute("aria-disabled") === "true"), name, where, ctx: ctx === name ? "" : ctx, opts });
      if (out.length >= 110) break;
    }
    return out;
  });
}
const screen = page => page.evaluate(() => {
  let main = document.querySelector("#pane, main");
  if (!main || !main.offsetParent || main.innerText.trim().length < 20) main = document.body;   // e.g. the sign-in screen sits outside the page area
  const panelEls = [...document.querySelectorAll("dialog[open], [class*=drawer], [class*=modal], [role=dialog]")].filter(e => e.offsetParent && !(main.contains(e) && main !== document.body));
  const panelsTop = panelEls.filter(e => !panelEls.some(o => o !== e && o.contains(e)));
  const panel = panelsTop.map(e => e.innerText).join("\n");
  const menu = [...document.querySelectorAll("nav a, aside a")].filter(e => e.offsetParent).map(e => e.innerText.trim().replace(/\s+/g, " "));
  const notice = [...document.querySelectorAll("[role=status], [aria-live], [class*=toast], [class*=notice]")].filter(e => e.offsetParent).map(e => e.innerText.trim()).join(" | ");
  // pop-ups outside the page area: search results, menus, lists tied to the focused box
  const pops = new Set([...document.querySelectorAll("[role=listbox], [role=menu], [role=option], [class*=result], [class*=suggest], [class*=dropdown]")]);
  const f = document.activeElement; const ctl = f && (f.getAttribute("aria-controls") || f.getAttribute("list"));
  if (ctl && document.getElementById(ctl)) pops.add(document.getElementById(ctl));
  const popup = [...pops].filter(e => e.offsetParent && !main.contains(e) && ![...pops].some(o => o !== e && o.contains(e))).map(e => e.innerText.trim()).filter(Boolean).join("\n").slice(0, 1500);
  // the page as rows: each control's smallest surrounding area, so facts stay attached to the right lead
  const desc = x => {
    const lab = (x.id && document.querySelector(`label[for="${x.id}"]`)) || x.closest("label");
    if (x.tagName === "SELECT") {   // a dropdown: its label and what it currently shows, not every option
      const l = (x.getAttribute("aria-label") || (lab && lab.innerText) || "").trim().replace(/\s+/g, " ").slice(0, 40);
      const cur = x.options[x.selectedIndex] ? x.options[x.selectedIndex].text.trim().slice(0, 50) : "";
      return `${l || "dropdown"} (dropdown showing '${cur}')` + (x.disabled ? " (locked)" : "");
    }
    let n = (x.getAttribute("aria-label") || (lab && lab.innerText) || x.innerText || x.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 50);
    if (!n) return "";
    if (x.type === "checkbox" || x.type === "radio") n += x.checked ? " (ticked)" : " (not ticked)";
    if (x.disabled || x.getAttribute("aria-disabled") === "true") n += " (locked" + (x.title || x.closest("[title]")?.title ? ": " + (x.title || x.closest("[title]").title).slice(0, 80) : "") + ")";
    return n;
  };
  const rows = [], boxes = [];
  // R5 (TC-IM10-001): a dropdown's options are in the row's text, and collapsing whitespace glued them into one run
  // ("Head of Finance Finance Operations ..."). Mark where the options start and stop, and separate them.
  const optsApart = b => { let t = b.innerText.trim(); for (const x of b.querySelectorAll("select")) { const raw = (x.innerText || "").trim(); if (raw && t.includes(raw)) t = t.replace(raw, "(options: " + [...x.options].map(o => o.text.trim()).join(" | ") + ")"); } return t; };
  const ctlSel = "button, a, [role=button], select, input";
  const rowsOf = (root, where) => {
    const boxes = [];
    for (const e of root.querySelectorAll(ctlSel)) {
      if (!e.offsetParent) continue; let up = e.parentElement;
      const nm = (e.innerText || "").trim();
      for (let k = 0; up && up !== root && k < 8; k++, up = up.parentElement) {
        const t = up.innerText.trim().replace(/\s+/g, " ");
        if (t.length > nm.length + 3) { if (t.length < 700 && !boxes.includes(up)) boxes.push(up); break; }
      }
    }
    // keep the outermost of nested boxes, and list each row's own controls so "offers X" / "X is locked" can be judged
    for (const b of boxes.filter(b => !boxes.some(o => o !== b && o.contains(b))))
      rows.push({ where, text: optsApart(b).replace(/\s+/g, " ").slice(0, 500), buttons: [...b.querySelectorAll(ctlSel)].filter(x => x.offsetParent).map(desc).filter(Boolean) });
  };
  rowsOf(main, "page"); panelsTop.forEach(p => rowsOf(p, "panel"));
  const top = document.querySelector("header, [class*=topbar], [class*=top-bar]");
  const top_bar_text = top && top.offsetParent ? top.innerText.trim().replace(/\s+/g, " ").slice(0, 300) : "";
  const top_bar = top && top.offsetParent ? [...top.querySelectorAll("button, a, input")].filter(x => x.offsetParent).map(x => (x.getAttribute("aria-label") || x.innerText || x.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 50)).filter(Boolean) : [];
  return { menu, top_bar, top_bar_text, notice, panel: panel.slice(0, 3000), popup, rows: rows.slice(0, 90), page: main.innerText.replace(/\n{2,}/g, "\n").slice(0, 9000) };
});

const browser = await chromium.launch(fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {});
const results = [];
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
async function runCase(c) {
  // On staging, people sign in through Zoho: a saved session per seat (SESSIONS_DIR/<seat>.json, E16-S02) replaces the sign-in step.
  const sess = process.env.SESSIONS_DIR && c.seat && path.join(process.env.SESSIONS_DIR, c.seat + ".json");
  const useSess = sess && fs.existsSync(sess);
  const ctx = await browser.newContext({ viewport: { width: c.width || 1440, height: 900 }, ...(useSess ? { storageState: sess } : {}) });
  const page = await ctx.newPage();
  await page.addInitScript(tracker);
  if (useSess) c = { ...c, steps: c.steps.filter(st => !/sign-in screen|'Signed in as'/i.test(st)) };
  // D98: the merged console has one sign-in screen; the old Investors-portal cases pick the person from a 'Signed in as' dropdown.
  c = { ...c, steps: c.steps.map(st => st.replace(/^Choose '([^'—]+?)\s*—[^']*' in the 'Signed in as' dropdown$/, "Press $1 on the sign-in screen")) };
  await page.addInitScript(() => document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (a && /^(tel|mailto|sms|whatsapp|intent):|wa\.me/i.test(a.getAttribute("href"))) e.preventDefault();   // no dialer / mail app in a test
  }, true));
  const clock = c.clock || process.env.CLOCK;   // e.g. "2026-08-28T10:00:00+05:30" so time-of-day labels do not drift during a run
  if (clock) await page.clock.install({ time: new Date(clock) });
  const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => { errors.push("native dialog: " + d.message()); d.dismiss(); });
  let result; const trace = []; let unsure = false, runError = null;
  try {
    await page.goto(url); await settle(page);
    const runFix = async (later) => { for (const f of c.fixtures || []) {
      if (!!(FIX[f] && FIX[f].after_signin) !== later) continue;
      if (!FIX[f]) throw new Error("unknown fixture " + f);
      if (/^file:/.test(url)) { if (FIX[f].prototype) await page.evaluate(wrap(FIX[f].prototype)); }
      else if (process.env.SEED_CMD) {   // the app's own seeding: local fixture mode now, the Zoho sandbox later (E16-S03)
        const { execSync } = await import("node:child_process");
        execSync(`${process.env.SEED_CMD} ${f}`, { stdio: "inherit", timeout: 120000 });
      }
      else if (!FIX[f].seeded) throw new Error(`fixture ${f} has no staging seed yet (set SEED_CMD)`);
    } };
    await runFix(false);
    for (const [si, step] of c.steps.entries()) {
      if (si === 1) { await runFix(true); await settle(page); }
      const els = await controls(page);
      const criteria = { none: "No control on screen does what this step says.", look_only: "This step only asks to look or check something; nothing needs pressing or typing." };
      els.forEach(e => criteria["e" + e.id] = `${e.kind} "${e.name}"${e.current ? ` (currently holds "${e.current}")` : ""} in the ${e.where}` + (e.ctx ? ` — its row/area reads: "${e.ctx}"` : "") + (e.opts ? ` — options: ${e.opts}` : ""));
      if (process.env.JEV_DEBUG) fs.appendFileSync("jev-ui-debug.log", JSON.stringify({ case: c.id, step, criteria }) + "\n");
      // Known rule in code first: if the step names exactly one control by its full visible label, use it.
      const low = step.toLowerCase();
      // (a) the step names one control by its full visible label, or (b) the step's object ("Tasneem Qureshi", 'Assign to me')
      //     appears in exactly one control's label and the step does not point at a particular row.
      const FILL = /\b(press|click|tap|open|select|choose|the|a|from|in|on|menu|button|link|page|tab)\b/g;
      let named = els.filter(e => e.name.length >= 3 && low.includes(e.name.toLowerCase())
        && low.replace(e.name.toLowerCase(), " ").replace(FILL, " ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).length === 0);
      if (named.length !== 1 && !/'s row|’s row| row\b| for [A-Z]/.test(step)) {
        const obj = ((step.match(/['‘“"]([^'’”"]+)['’”"]/) || [])[1] || step.replace(/^(press|click|tap|open|select|choose)\s+/i, "")
          .replace(/\s+(on|in|from) the (sign-in screen|menu|top bar|sidebar)\.?$/i, "")).toLowerCase().trim();
        const hits = obj.length >= 3 && !/^(type|choose)\b/i.test(step) ? els.filter(e => !e.disabled && e.name.toLowerCase().includes(obj)) : [];
        if (hits.length === 1) named = hits;
      }
      const a = named.length === 1 ? { choice: "e" + named[0].id, probabilities: { ["e" + named[0].id]: 1 }, by: "label" }
        : (await jev({ test: c.title, signed_in_as: c.seat || null, step, earlier_steps: trace.map(t => t.step), screen_heading: await page.evaluate(() => { const m = document.querySelector("#pane, main"); return m && m.offsetParent ? m.innerText.slice(0, 200) : ""; }) },
        { pick: { type: "choice", instructions: "A tester is running a UI test in this app. Which control on the screen does `step` tell them to press, type into or choose from? In this app, pressing a person's name (or their row) opens that person's record, menu links open pages, and the top-bar box searches. Pick the control a careful person would use; choose none only if nothing on screen could do it.", criteria } })).pick;
      const pick = a.choice, conf = a.probabilities?.[pick] ?? a.confidence;
      const t = { step, pick, name: els[+String(pick).slice(1)]?.name, p: +(+conf).toFixed(2), by: a.by || "jev" };
      if (a.probabilities) t.top = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => k + ':' + v.toFixed(2)).join(' ');
      trace.push(t);
      if (conf < STEP_MIN) unsure = true;
      if (pick === "none") { t.problem = "no matching control"; break; }
      if (pick === "look_only") continue;
      const el = els[+pick.slice(1)]; const loc = page.locator(`[data-jevid="${el.id}"]`);
      const quoted = (step.match(/['‘“"]([^'’”"]+)['’”"]/) || [])[1];
      if (el.kind.startsWith("text box")) { await loc.fill(quoted ?? "", { timeout: 8000 }); if (/\bpress enter\b/i.test(step)) await loc.press("Enter"); else await loc.evaluate(x => {   // leave the field (fields that save on leaving save), except search boxes, which keep their results open
          const search = x.type === "search" || x.getAttribute("role") === "combobox" || x.hasAttribute("list") || x.getAttribute("aria-autocomplete") || /search|find/i.test(x.placeholder + " " + (x.getAttribute("aria-label") || ""));
          if (!search) { x.dispatchEvent(new Event("change", { bubbles: true })); x.blur(); }
        }, null, { timeout: 3000 }).catch(() => {}); }
      else if (el.kind.startsWith("dropdown")) await loc.selectOption({ label: quoted ?? "" }, { timeout: 8000 });
      else if (el.disabled) { t.problem = "control is disabled"; t.disabled = true; }
      else await loc.click({ timeout: 8000 });
      const w = await settle(page, c.wait || SETTLE_MS); t.settled = w.waited; if (w.capped) t.settle_capped = true;
    }
    if (c.steps.length === 1) await runFix(true);
    const seen = await screen(page);
    // Each expected fact is judged on its own; the case passes only if every fact holds (policy in code, not in the prompt).
    const facts = Array.isArray(c.expected) ? c.expected : [c.expected];
    const qs = {};
    facts.forEach((f, i) => qs["f" + i] = { type: "noul",
      instructions: `A tester ran \`steps\` in the app. Using only \`what_the_screen_shows\` (menu = every navigation link visible — a page not in this list is not shown; top_bar = the controls in the top bar; top_bar_text = everything written in the top bar, including status; notice = status messages; panel = any open panel; popup = search results or lists open over the page; rows = each row/area of the page with its text and the buttons it offers; page = the main page text), is this fact true: "${f}"? Judge facts, not exact wording.`,
      criteria: { true: "Yes — the screen shows this fact.", false: "No — the screen contradicts it or does not show it." } });
    const ans = await jev({ test: c.title, signed_in_as: c.seat || null, steps: c.steps, what_the_screen_shows: seen, step_trace: trace.map(({ step, name }) => ({ step, pressed: name })) }, qs);
    const factP = facts.map((f, i) => ({ fact: f, p: ans["f" + i].noul ?? ans["f" + i].probability }));
    const p = Math.min(...factP.map(x => x.p));
    const stuck = trace.some(t => t.problem === "no matching control");   // a step could not be done: never a PASS
    const verdict = errors.length ? "FAIL" : p >= PASS_AT && !unsure && !stuck ? "PASS" : p <= 0.1 ? "FAIL" : "REVIEW";
    result = { id: c.id, story: c.story, title: c.title, verdict, p, facts: factP, unsure_step: unsure, expect_fail: !!c.expect_fail, trace, errors, screen: seen };
  } catch (e) { runError = String(e.message || e).slice(0, 300); result = { id: c.id, title: c.title, verdict: "FAIL", runError, trace, errors }; }
  await ctx.close();
  return result;
}
// M19-S08: --retry-review. A REVIEW (not a crash) is run once more; a decisive verdict (PASS or FAIL) is better evidence than a REVIEW,
// and between two REVIEWs the one with no unsure step and the higher score wins. Both verdicts stay in the result.
const rank = r => (r.verdict === "REVIEW" ? 0 : 2) + (r.unsure_step ? 0 : 1) + (r.p ?? 0) / 10;
for (const c of cases.filter(c => !only || only.includes(c.id))) {
  let r = await runCase(c);
  if (RETRY_REVIEW && r.verdict === "REVIEW" && !r.runError) {
    const r2 = await runCase(c); const keep = rank(r2) > rank(r) ? r2 : r, other = keep === r ? r2 : r;
    r = { ...keep, retried: true, first_attempts: [{ verdict: other.verdict, p: other.p }] };
  }
  results.push(r);
}
await browser.close();
const out = outArg || casesFile.replace(/\.json$/, "") + ".ui-results.json";
fs.writeFileSync(out, JSON.stringify({ ran: new Date().toISOString(), target: path.basename(target), results }, null, 1));
const cal = results.filter(r => r.expect_fail);
if (cal.some(r => r.verdict === "PASS")) console.log("!! A calibration case PASSED — the judge is not trustworthy for this run.");
console.log(`calibration: ${cal.filter(r => r.verdict === "FAIL").length}/${cal.length} seeded-wrong cases caught`);
for (const r of results) console.log(r.verdict.padEnd(6), r.id, (r.p ?? "").toString().padEnd(5), r.expect_fail ? "(seeded wrong expectation)" : "", r.runError || "",
  (r.facts || []).filter(f => f.p < 0.9).map(f => `\n        ✗ ${f.p.toFixed(2)} ${f.fact}`).join(""),
  "\n        " + r.trace.map(t => `${t.pick}${t.name ? "=" + JSON.stringify(t.name) : ""}@${t.p}`).join(" → "));
