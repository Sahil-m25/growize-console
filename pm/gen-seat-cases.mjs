// M19-S11: per-seat Jev UI case generator for the merged Growize Console.
// Reads the console's own seat tables (never retyped here) and emits plain-language cases that
// pm/jev-ui-runner.mjs runs unchanged:
//   - the lead side:      console/src/domain/nav.ts  (NAV, SEATDEF)   + console/fixtures/book/people.ts (PEOPLE)
//   - the Investors side: console/src/lib/im/constants.ts (ROLE, NAV) + the person -> role map in console/fixtures/im/demo.ts
//   - the merged rail:    console/src/domain/signin.ts (MERGE: Investors page -> rail name, D98)
// Per signing-in person it emits: the rail (grouped facts; the last fact is that the menu ends with the merge page, because the judge counts "N links" unreliably), the landing page, and one "open this page"
// case per rail entry. Sahil (super user, D68/D110) gets his own set, GEN-SAHIL-*, which also checks the
// Lead side / Investors side switch and opens every rail page.
// Usage:  node pm/gen-seat-cases.mjs [--out pm/generated/ui-cases-seats.json] [--seat sahil] [--no-pages]
//   then: ONLY=$(node -e 'console.log(require("./pm/generated/ui-cases-seats.json").cases.filter(c=>/^GEN-SAHIL-/.test(c.id)).map(c=>c.id))') node pm/jev-ui-runner.mjs ...
// The rule for who sees which Investors page mirrors console/src/lib/im/selectors.ts navFor(); where a screen
// and this table disagree the generated case fails, which is the point (drift between seat table and screen).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, "..");
const arg = n => { const i = process.argv.indexOf("--" + n); return i < 0 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true); };
const out = arg("out") || path.join(here, "generated", "ui-cases-seats.json"), onlySeat = arg("seat"), pages = !process.argv.includes("--no-pages");

// the TypeScript tables import types only, so Node's type stripping loads them as they are
const imp = p => import(pathToFileURL(path.join(root, "console", p)).href);
const nav = await imp("src/domain/nav.ts"), ppl = await imp("fixtures/book/people.ts"), im = await imp("src/lib/im/constants.ts");
const signin = fs.readFileSync(path.join(root, "console/src/domain/signin.ts"), "utf8");
const MERGE = Object.fromEntries([...signin.match(/export const MERGE[^=]*=\s*\{([^}]*)\}/)[1].matchAll(/(\w+)\s*:\s*"(\w+)"/g)].map(m => [m[2], m[1]]));   // Investors view -> lead key
// the person -> Investors role map is a literal in the fixture (imx.js 82-93); read it as text so the table stays the source
const imRole = Object.fromEntries([...fs.readFileSync(path.join(root, "console/fixtures/im/demo.ts"), "utf8").slice(0, 6000).matchAll(/^\s*(\w+)\s*:\{n:"([^"]+)",\s*i:"\w+",\s*r:"(\w+)"/gm)].map(m => [m[1], { name: m[2], role: m[3] }]));

// rail names of the merged console (D98): lead NAV titles, Investors pages renamed through MERGE, plus the Investors-only pages
const LEADNAME = Object.fromEntries(nav.NAV.map(n => [n.k, n.t]));
const IMNAME = { dash: "Today", inv: "Investors", farms: "Farms", txn: "Payments", docs: "Documents", tkt: "Tickets", upd: "Investor updates", ins: "Numbers", sys: "System", act: "Activity", team: "Teams" };
for (const [v, k] of Object.entries(MERGE)) if (LEADNAME[k] && !IMNAME[v]) IMNAME[v] = LEADNAME[k];
const ORDER = ["Today", "Leads", "Activity", "Events", "Investors", "Farms", "Tickets", "Investor updates", "Payments", "Documents", "Transfers", "Plan", "Numbers", "Teams", "System"];

const leadRail = seat => nav.NAV.filter(n => !n.bell && n.k !== "me" && (nav.SEATDEF[seat] || []).includes(n.k)).map(n => n.t);
const may = (role, c) => (im.ROLE[role].can || []).includes(c);
const imRail = role => {
  const sys = im.ROLE[role].tm === "sys";
  return im.NAV.filter(n => !(n.not === "sys" && sys))
    .filter(n => role === "di" || !n.needs || n.needs.some(c => may(role, c)) || (role === "audit" && !n.needs.includes("sys")))
    .map(n => IMNAME[n.k]);
};
const railOf = (k) => {
  const p = ppl.PEOPLE[k], r = imRole[k];
  const names = new Set([...(p && !p.ext && (nav.DEFSEATS.includes(p.seat)) ? leadRail(p.seat) : []), ...(r ? imRail(r.role) : [])]);
  return ORDER.filter(n => names.has(n));
};

// who signs in: everyone either side admits (the lead side's three default seats, the Investors side's roles)
const people = Object.keys(ppl.PEOPLE).filter(k => { const p = ppl.PEOPLE[k]; return (p.on && !p.ext && nav.DEFSEATS.includes(p.seat)) || imRole[k]; });
const first = n => n.split(" ")[0];
const landing = k => { const p = ppl.PEOPLE[k], r = imRole[k]; if (r && !(p && nav.DEFSEATS.includes(p.seat))) return railOf(k).includes("Today") ? `${first(r.name)}'s day` : railOf(k)[0];
  return p.seat === "ir" ? "Your follow-ups" : "Team follow-ups"; };
const chunk = (a, n) => a.length ? [a.slice(0, n), ...chunk(a.slice(n), n)] : [];
const list = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];

const cases = [];
for (const k of people) {
  if (onlySeat && onlySeat !== true && onlySeat !== k) continue;
  const name = (ppl.PEOPLE[k] || {}).n || imRole[k].name, rail = railOf(k), seatTag = k === "sahil" ? "SAHIL" : k.toUpperCase();
  const base = { story: "M19-S11", seat: k, fixtures: ["DEMO_DATA"], group: "GEN" }, signIn = `Press ${name} on the sign-in screen`;
  const lead = k === "sahil" ? "Super user" : "";
  cases.push({ id: `GEN-${seatTag}-RAIL`, ...base, title: `${name}: the rail holds exactly the pages the seat table gives`, steps: [signIn],
    expected: [...chunk(rail, 4).map(g => `The menu shows ${list(g)}.`), `The menu ends with 'How the merge works'.`] });
  cases.push({ id: `GEN-${seatTag}-LANDING`, ...base, title: `${name}: signs in and lands on the right page`, steps: [signIn],
    expected: [`The page shows '${landing(k)}'.`] });
  if (k === "sahil") cases.push({ id: `GEN-SAHIL-SIDES`, ...base, title: "Sahil: Today offers the Lead side and the Investors side", steps: [signIn],
    expected: ["The page offers a 'Lead side' switch and an 'Investors side' switch."] });
  if (pages) for (const pg of rail) {
    if (pg === landing(k).replace(/'s day$/, "")) continue;
    cases.push({ id: `GEN-${seatTag}-OPEN-${pg.toUpperCase().replace(/[^A-Z]+/g, "")}`, ...base, title: `${name}: opens ${pg} from the menu`, steps: [signIn, `Open ${pg} from the menu`],
      expected: [`The ${pg} page is showing.`] });
  }
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ note: `Generated by pm/gen-seat-cases.mjs from the console seat tables (nav.ts, people.ts, im/constants.ts, signin.ts MERGE). ${cases.length} cases for ${new Set(cases.map(c => c.seat)).size} seats. Do not edit by hand; run the generator again.`, cases }, null, 1));
const bySeat = {}; for (const c of cases) bySeat[c.seat] = (bySeat[c.seat] || 0) + 1;
console.log(`wrote ${cases.length} cases -> ${path.relative(root, out)}`, bySeat);
