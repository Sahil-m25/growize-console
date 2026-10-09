// M18-S02-T01 / NOTE-3: the API half of the per-seat matrix.  Companion to pm/gen-seat-cases.mjs (UI cases).
// For EVERY seat x page x action it emits TC-PM-<SEAT>-<PAGE>-<ACTION>: the route either serves (with only the fields that seat may see)
// or refuses with the right code. The expectation is DERIVED here, from the policy tables, never retyped and never read back from the
// routes under test:
//   door      who holds the page the route names       console/src/domain/nav.ts (SEATDEF, MERGE) + console/src/lib/im/constants.ts (ROLE, NAV)
//                                                       + the seat sides in server/access/policy.ts (ZOHO_SEAT_SIDES) + docs/ACCESS-PLAN.md §1
//             rule that guards a route                  server/access/guard-core.ts API_ROUTES (page | session | open)
//   rights    what the handler decides inside           the Investors capabilities (ROLE[..].can), the lead-side SEATCAPS, the book
//                                                       scopes (server/data/scope.ts) — table RIGHTS below, one row per route x method, each
//                                                       citing the handler line that applies it
//   identity  what a seat may see of PAN / bank         ROLE[..].can has `pii` / `bank`  (docs/ACCESS-PLAN.md §3: PAN+Aadhaar -> Head of Finance + Compliance;
//                                                       bank -> Head of Finance + Finance Operations; the console masks every one, a reveal is a second call)
//   books     whose records a seat may read             server/data/scope.ts scopesFor (user | subtree | own-lead | own-book | org | all | none)
// Routes and methods come from the contract table (console/src/server/http/contract/contract-table.cjs + contract-table.json).
// The harness (console/src/server/http/contract/api-matrix.test.cjs) runs every case against the real route handlers on the contract-suite rig.
// Usage:  node pm/gen-api-matrix.mjs [--out pm/generated/api-matrix.json] [--check]      (--check: fail if the committed file is stale)
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, "..");
const arg = n => { const i = process.argv.indexOf("--" + n); return i < 0 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true); };
const out = arg("out") && arg("out") !== true ? path.resolve(arg("out")) : path.join(here, "generated", "api-matrix.json");

const require = createRequire(import.meta.url);
const contractDir = path.join(root, "console/src/server/http/contract");
const H = require(path.join(contractDir, "harness.cjs"));            // the TypeScript loader of the contract suite (and its seat list)
const T = require(path.join(contractDir, "contract-table.cjs"));
const dom = H.load("domain"), im = H.load("lib/im/constants.ts");
const { ZOHO_SEAT_SIDES } = H.load("server/access/policy.ts");
const { CONSOLE_SEAT } = H.load("server/oauth/user-session.ts");
const { scopesFor } = H.load("server/data/scope.ts");

/* ---- seats: the console tokens that can sign in, with the two sides each sits on --------------------------------------------- */
const zohoOf = Object.fromEntries(Object.entries(CONSOLE_SEAT).filter(([, t]) => t).map(([z, t]) => [t, z]));
const WHO = "554023000000100001";                                      // any well-formed Zoho user id: scopesFor only needs the shape
const SEATS = H.SEATS.map(token => {
  const sides = ZOHO_SEAT_SIDES[zohoOf[token]], role = sides.im ? im.ROLE[sides.im] : null, can = role ? role.can : [];
  const sc = scopesFor(token, WHO);
  return { token, zoho: zohoOf[token], lead: sides.lead, im: sides.im, caps: [...can],
    admitted: dom.DEFSEATS.includes(sides.lead) || sides.im !== null,   // D60: a default lead seat, or any Investors seat; the rest sign in only by grant
    identity: { pii: can.includes("pii"), bank: can.includes("bank") },
    books: Object.fromEntries(Object.entries(sc).map(([b, s]) => [b, s.kind])) };
});

/* ---- door: does a seat hold a page? (derived from the nav and capability tables; not from navFor / seatPresets) ----------------- */
const imView = page => dom.MERGE[page];                                // lead page key -> Investors view key (D98)
const imHolds = (role, view) => {                                      // the Investors rail rule (im/constants NAV: not / needs)
  const n = im.NAV.find(x => x.k === view); if (!n) return false;
  const r = im.ROLE[role], sys = r.tm === "sys";
  if (n.not === "sys" && sys) return false;
  return role === "di" || !n.needs || n.needs.some(c => r.can.includes(c)) || (role === "audit" && !n.needs.includes("sys"));
};
const holdsPage = (s, page) => {
  if (!s.admitted) return false;
  if (dom.DEFSEATS.includes(s.lead) && dom.SEATDEF[s.lead].includes(page)) return true;       // lead side default reach
  if (s.im && imView(page) && imHolds(s.im, imView(page))) return true;                        // Investors side
  if (s.token === "ir" && page === "inv") return true;                                         // D113 ruling 2: the IR's own half of Investors
  return false;
};

/* ---- rights: what the handler decides after the door ------------------------------------------------------------------------- */
// rule kinds: {caps:[any-of Investors caps]} · {leadCap:[page, cap]} (SEATCAPS of the lead seat) · {book:[name, [kinds...]]} (scopesFor)
//             · {stepUp:true}: the route asks step-up before anything else, so EVERY seat is refused (no step-up in the suite)
//             · {none:true}: nobody holds it in this rig (a super-user-only or log/system right no console token carries)
// `src` names the handler line that applies the rule. A route x method not listed here is door-only: the harness says so, it does not guess.
const RIGHTS = {
  "GET /api/payments":                  { caps: ["pay", "bank"], src: "server/money/register.ts:162 (payments-register capability-missing)" },
  "GET /api/payouts":                   { caps: ["pay", "bank"], src: "server/payouts/authority.ts:20 (read = pay || bank)" },
  "GET /api/payouts/allotments/[id]":   { caps: ["pay", "bank"], src: "server/payouts/authority.ts:20" },
  "POST /api/payouts/[id]/paid":        { caps: ["pay"], src: "server/payouts/authority.ts:19 (pay)" },
  "POST /api/payouts/schedule":         { caps: ["pay"], src: "server/payouts/authority.ts:19 (pay)" },
  "GET /api/claims":                    { caps: ["pay"], src: "server/money/runtime.ts:102 (mayAnswer = pay)" },
  "GET /api/claims/[id]":               { caps: ["pay"], src: "server/money/runtime.ts:102" },
  "POST /api/claims/[id]/confirm":      { caps: ["pay"], src: "server/money/claim-answer.ts:247 (not-finance)" },
  "POST /api/claims/[id]/not-there":    { caps: ["pay"], src: "server/money/claim-answer.ts:247" },
  "POST /api/receipts":                 { caps: ["pay"], src: "server/money/record-receipt.ts:309 (read-only; mayRecord = pay)" },
  "POST /api/receipts/prepare":         { caps: ["pay"], src: "server/money/record-receipt.ts:297" },
  "POST /api/receipts/[id]/match":      { caps: ["pay"], src: "server/money/runtime.ts:58 (mayMatch = pay)" },
  "POST /api/receipts/[id]/reveal":     { stepUp: true, caps: ["bank"], src: "app/api/receipts/[id]/reveal: step-up first, then server/money/runtime.ts:86 (mayReveal = bank)" },
  "POST /api/statements":               { caps: ["pay"], src: "server/money/runtime.ts:135 (mayUpload = pay)" },
  "POST /api/investors/add-paid":       { caps: ["pay"], src: "app/api/investors/add-paid/route.ts:41 (mayAdd)" },
  "POST /api/investors/[id]/contact":   { caps: ["care"], src: "server/investors/care-runtime.ts mayCare (imCan care; KAM own book) — app/api/investors/[id]/contact seat-denied first" },
  "PUT /api/investors/[id]/details":    { caps: ["details"], src: "server/investors/care.ts admit (authority.allow details: seat-denied)" },
  "POST /api/investors/[id]/kyc":       { caps: ["kyc"], src: "server/investors/care.ts admit (authority.allow kyc: seat-denied)" },
  "POST /api/investors/[id]/unlock":    { caps: ["pay"], src: "app/api/investors/[id]/unlock/route.ts:37 (mayChange = pay; G2 matched 10% decided in server/investors/unlock; GC-1526 override :43 = Finance Operations / Head of Finance only)" },
  "DELETE /api/investors/[id]/unlock":  { caps: ["pay"], src: "app/api/investors/[id]/unlock/route.ts:37" },
  "POST /api/holds/[id]/extend":        { caps: ["refund"], src: "server/holds/extend.ts:69 (no-extend-right = refund)" },
  "POST /api/holds/[id]/release":       { stepUp: true, caps: ["refund"], src: "step-up first, then server/holds/lapse.ts:105 (refund)" },
  "GET /api/holds":                     { book: ["money", ["org", "all"]], src: "server/holds/holds.ts:130 (holdsBookOf: money + whole book)" },
  "POST /api/farms/[id]/release":       { caps: ["farm"], src: "server/farms/release.ts:58 (imCan farm)" },
  "DELETE /api/farms/[id]/release":     { caps: ["farm"], src: "server/farms/release.ts:58" },
  "GET /api/logs":                      { caps: ["log"], src: "server/logs/reader.ts:127 (logAccessOf: log, or the auditor)" },
  "GET /api/system":                    { caps: ["sys"], src: "server/system/facts.ts mayReadSystem (sys)" },
  "POST /api/events":                   { leadCap: ["events", "edit"], src: "server/events/caps.ts (events . edit)" },
  "PATCH /api/events/[id]":             { leadCap: ["events", "edit"], src: "server/events/caps.ts" },
  "DELETE /api/events/[id]":            { leadCap: ["events", "edit"], src: "server/events/caps.ts" },
  "GET /api/investors/[id]":            { book: ["investors", ["own-lead", "own-book", "subtree", "org", "all"]], src: "server/investors/record.ts:53 (sectionsFor null for none/user)" },
  "GET /api/investors/[id]/record":     { book: ["investors", ["own-lead", "own-book", "subtree", "org", "all"]], src: "server/investors/record.ts:53" },
  "GET /api/investors/[id]/allotments": { book: ["investors", ["own-lead", "own-book", "subtree", "org", "all"]], src: "server/investors/allotments.ts:172" },
  "GET /api/investors/[id]/money":      { book: ["investors", ["org", "all"]], src: "server/investors/allotments.ts:174 (requireMoney: Money section = Finance side only, record.ts:44-60)" },
  "GET /api/investors/[id]/holdings":   { book: ["holdings", ["org", "all"]], src: "server/investors/holdings.ts:88 (seesHoldings: holdings org|all and Money section)" },
  "GET /api/investors/finance":         { book: ["investors", ["org", "all"]], src: "server/investors/finance-list.ts:194" },
  "GET /api/investors/am":              { book: ["investors", ["own-book", "subtree"]], src: "server/investors/am-service.ts:206 (a KAM or the Head of AM only)" },
  "GET /api/investors/am/managers":     { book: ["investors", ["own-book", "subtree"]], src: "server/investors/am-service.ts:206" },
  "GET /api/investors/mine":            { book: ["investors", ["own-lead"]], src: "server/investors/ir-list.ts:110 (the IR's own-lead scope only)" },
  "GET /api/investors/[id]/test-link":  { none: true, src: "app/api/investors/[id]/test-link: super user only (M10-S23), no console token is the super user" },
  "POST /api/investors/[id]/test-link": { none: true, src: "same" },
  "PUT /api/investors/[id]/kam":        { caps: ["assign"], src: "app/api/investors/[id]/kam/route.ts:39 (mayAssign = imCan assign: Head of Finance, Head of AM)" },
  "POST /api/events/[id]/sheet":        { leadCap: ["events", "load"], src: "server/events/http.ts:36 (events . load; D115: the Digital Infrastructure seat loads only as the super administrator, no console token is one)" },
  "PUT /api/users/[id]":                { stepUp: true, caps: [], src: "app/api/users/[id]/route.ts:5 (a live step-up is asked first)" },
  "POST /api/updates":                  { caps: ["upd"], src: "server/cases/rights.ts upd; server/updates/publish.ts kindsFor (a seat with no kind is read-only)" },
  "GET /api/documents/sign/dead-letters": { none: true, src: "app/api/documents/sign/dead-letters/route.ts:13 (Digital Infrastructure only; no console token is that seat)" },
  "GET /api/numbers/investors-today":   { book: ["investors", ["own-lead", "own-book", "subtree", "org", "all"]], src: "server/numbers/investors-today.ts:~130 (sectionsFor null refuses no-book)" },
  "GET /api/queues/investors":          { book: ["investors", ["own-lead", "own-book", "subtree", "org", "all"]], src: "server/queues: sectionsFor null refuses no-book (IR refused by design, own-lead gets rows)" },
};
// the IR holds an own-lead investors scope but the queues reader refuses an IR (M05-S07/S08: "IR refused"): carve it out of the derived rule
RIGHTS["GET /api/queues/investors"].book = ["investors", ["own-book", "subtree", "org", "all"]];

const holdsRight = (s, r) => {
  if (r.none || r.stepUp) return false;                                // refused for every seat in the rig (step-up never given / nobody holds it)
  if (r.caps) return r.caps.some(c => s.caps.includes(c));
  if (r.leadCap) { const c = dom.SEATCAPS[s.lead]; return dom.DEFSEATS.includes(s.lead) && !!c && (c[r.leadCap[0]] || []).includes(r.leadCap[1]); }
  if (r.book) return r.book[1].includes(s.books[r.book[0]]);
  return true;
};

/* ---- the matrix --------------------------------------------------------------------------------------------------------------- */
const slug = r => r.replace(/^\/api\//, "").replace(/\[([a-z]+)\]/gi, (_, p) => p === "kind" ? "KIND" : "ID").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
const pageOf = row => row.rule && row.rule.kind === "page" ? row.rule.page : row.rule && row.rule.kind === "open" ? "open" : row.route.split("/")[2];
const rows = T.table().filter(r => !r.excluded);
const cases = [], drift = [];
for (const row of rows) {
  const open = !row.rule || row.rule.kind === "open";
  for (const method of row.methods) {
    const key = `${method} ${row.route}`, right = RIGHTS[key] || null;
    for (const s of SEATS) {
      let door, doorCode = null;
      if (open) door = "serve";
      else if (!s.admitted) { door = "refuse"; doorCode = "no-grant"; }
      else if (row.rule.kind === "session") door = "serve";
      else if (holdsPage(s, row.rule.page)) door = "serve";
      else { door = "refuse"; doorCode = "page"; }
      // the contract table derives the same door from the front end's navFor: any disagreement is drift, named
      if (!open && row.seats !== "*" && row.seats.includes(s.token) !== (door === "serve")) drift.push(`${s.token} ${key}: derived ${door}, contract table says ${row.seats.includes(s.token) ? "serve" : "refuse"}`);
      let expect, holds = null;
      if (door === "refuse") expect = "refuse-door";
      else if (open) expect = "open";
      else if (!right) expect = "door-only";
      else { holds = holdsRight(s, right); expect = right.stepUp ? "refuse-stepup" : holds ? "serve" : "refuse-right"; }
      const page = pageOf(row), action = `${method}-${slug(row.route)}`;
      cases.push({ id: `TC-PM-${s.token.toUpperCase()}-${String(page).toUpperCase()}-${action}`, story: "M18-S02-T01", seat: s.token, page, route: row.route, method,
        params: row.params, door, doorCode, expect, right: right ? { rule: Object.fromEntries(Object.entries(right).filter(([k]) => k !== "src")), holds, src: right.src } : null });
    }
  }
}
const ids = cases.map(c => c.id), dup = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dup.length) { console.error("duplicate case ids", [...new Set(dup)].slice(0, 5)); process.exit(1); }
for (const k of Object.keys(RIGHTS)) if (!rows.some(r => r.methods.some(m => `${m} ${r.route}` === k))) { console.error(`RIGHTS names a route x method that does not exist: ${k}`); process.exit(1); }
if (drift.length) { console.error("the derived door disagrees with the contract table (navFor / seatPresets):\n  " + drift.join("\n  ")); process.exit(1); }

const tally = {}; for (const c of cases) tally[c.expect] = (tally[c.expect] || 0) + 1;
const doc = { note: `Generated by pm/gen-api-matrix.mjs from the access policy (nav.ts, im/constants.ts, policy.ts, guard-core.ts API_ROUTES, scope.ts) and the route contract table. ${cases.length} cases for ${SEATS.length} seats x ${rows.reduce((n, r) => n + r.methods.length, 0)} route-methods. Do not edit by hand; run the generator again.`,
  seats: SEATS, tally, cases };
// seats pretty-printed, one case per line (a diff of the policy reads as a diff of lines)
const text = `{\n "note": ${JSON.stringify(doc.note)},\n "seats": ${JSON.stringify(doc.seats, null, 1).replace(/\n/g, "\n ")},\n "tally": ${JSON.stringify(doc.tally)},\n "cases": [\n${cases.map(c => "  " + JSON.stringify(c)).join(",\n")}\n ]\n}\n`;
if (arg("check")) {
  const have = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (have !== text) { console.error(`${path.relative(root, out)} is stale: run node pm/gen-api-matrix.mjs`); process.exit(1); }
  console.log(`ok: ${path.relative(root, out)} is current (${cases.length} cases)`); process.exit(0);
}
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, text);
const bySeat = {}; for (const c of cases) bySeat[c.seat] = (bySeat[c.seat] || 0) + 1;
console.log(`wrote ${cases.length} cases -> ${path.relative(root, out)}`, tally, bySeat);
