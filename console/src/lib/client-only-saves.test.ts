/* D132 — THE CLIENT-ONLY-SAVE GUARD. A reducer action changes only this browser's copy (lib/console-save createConsoleWriter:
   live, a business write that is dispatched is applied locally and never queued, never sent). So on the live console every
   persistent action a screen can dispatch must either go through its route (WriteEndpoint + useApiWrite: the dispatch then lives
   in the endpoint's fixture half, under lib/data/endpoints, which this scan does not read) or sit behind a live-mode guard
   (hidden / disabled / "Not available yet" / fixture-only branch).

   This test enumerates every `dispatch({ type: "…" })` in src/features and src/components (comments stripped), classifies the
   action — persistent (lead side: BUSINESS_WRITES; Investors side: every ImAction not in IM_LOCAL) or purely local UI state
   (the explicit allow-lists below; an action type in neither fails, so a new one has to be classified) — and decides whether the
   site is guarded by a live-mode check in its enclosing function. An unguarded persistent site that is not in KNOWN (still
   client-only, listed in docs/decisions/D132 for an owner) or HAND_CHECKED (guarded in a way the scan cannot see) fails, and so
   does a KNOWN / HAND_CHECKED entry that no longer occurs, so the lists cannot go stale silently. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BUSINESS_WRITES } from "./console-save";

const SRC = path.resolve(__dirname, "..");

/** Lead-side actions that are UI state only (drafts, filters, navigation, local toggles). */
const LEAD_LOCAL = new Set([
  "setUi", "openDrawer", "closeDrawer", "go", "setFilter", "setSort", "setScope", "setSide", "setTheme", "setSel", "setSec", "tSet",
  "im", "toLeads", "setAddF", "setAsTo", "setCon", "setLQ", "setNXD", "setTD", "setClaim", "quickDate", "seedNext", "seedTouch",
  "discardFollowup", "hideRef", "editPerson", "startPerson", "cancelPerson", "startTemp", "useTemp", "dropTemp", "setOutWhy",
  "startPaymentReport", "armFail", "availLive", "mset", "setDraft", "note", "noteClose", "revCancel", "refAsk", "hideAll",
]);
/** Investors-side actions that are UI state only. Every other ImAction is a write. */
const IM_LOCAL = new Set([
  "refAsk", "hideAll", "revCancel", "go", "setSec", "openDrawer", "closeDrawer", "setPerson", "setSel", "setDraft", "setFilter",
  "confirmYes", "noteClose", "note", "mset", "im", "setSide",
]);

/** Still client-only on the live console: an owner or schema decision is owed (docs/decisions/D132-client-only-saves.md). */
const KNOWN: Record<string, string> = {
  "features/goals/PlanPage.tsx#setPeriodDate": "Plan periods: no Zoho home (Sales_Plans not wired); IR Manager / BU seats",
  "features/goals/PlanPage.tsx#setGrain": "Plan grain: no route",
  "features/goals/PlanPage.tsx#addPeriod": "Plan period add: no route",
  "features/goals/PlanPage.tsx#setNum": "Plan targets: no route",
  "features/goals/PlanPage.tsx#setBaseline": "Plan baseline: no route",
  "features/goals/drawers.tsx#setReleased": "units released for sale (lead-side dial): no route — the Investors side's /api/farms/[id]/release is the real one",
  "features/goals/drawers.tsx#setGrain": "Plan grain (confirm drawer): no route",
  "features/goals/drawers.tsx#dropPeriod": "Plan period remove: no route",
  "features/goals/drawers.tsx#bump": "Plan deliverable units: no route",
  "features/numbers/drawers.tsx#setRecov": "Numbers recovery action: no route",
  "features/numbers/drawers.tsx#clearRecov": "Numbers recovery action clear: no route",
  "features/people/drawers.tsx#grantTemp": "temporary access grant: no route (C4: TEMP empty live until built)",
  "features/people/Access.tsx#revokeTemp": "temporary access revoke: no route (only reachable once grantTemp exists)",
  "features/people/drawers.tsx#addPerson": "add a team member: no route (People page; live reachability not verified)",
  "features/people/drawers.tsx#removePerson": "leaver flow: no route (People page; live reachability not verified)",
  "features/lead/drawers/investor-copy.tsx#copyInvestor": "investor copy (demo projection): no route; live reachability not verified",
  "features/pay/PayPage.tsx#showRef": "receipt reference reveal: no route; likely unreachable live (the lead side never reads Receipts, D69)",
};
/** Guarded on the live console in a way this scan cannot see (verified by reading the site). */
const HAND_CHECKED: Record<string, string> = {
  "features/add/AddPage.tsx#flagDupe": "live renders 'Not available yet' text in place of the button (AddPage, `mgr && live`)",
  "features/im/common.tsx#reveal": "live records never carry identity (pan/acct null), so Pii answers 'not on file' before the reveal button",
  "features/lead/LeadPage.tsx#lpRestore": "restores a fixture snapshot only: live notices carry snap null and an undoToken goes to the route",
  "features/lead/drawers/touch.tsx#dropTouch": "the Remove buttons render only under `canWork(state, l) && !live`",
};

const read = (f: string) => fs.readFileSync(path.join(SRC, f), "utf8");
const imTypes = new Set(["lib/im/types.ts", "lib/im/money-types.ts", "lib/im/paper2-types.ts"]
  .flatMap(f => [...read(f).matchAll(/\|\s*\{\s*type:\s*"(\w+)"/g)].map(m => m[1]!)));
const leadTypes = new Set([...read("lib/state.ts").split("export type Action =")[1]!.split(/\n\S/)[0]!.matchAll(/type:\s*"(\w+)"/g)].map(m => m[1]!));

function files(dir: string): string[] {
  return fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}
/** Comments blanked (line structure kept), so a dispatch quoted in a comment is not a site. */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
/** A live-mode flag (`live`, `liveMode`, `apiLive`, `financeLive` …), never a function call such as tLive(). */
const L = String.raw`(?:\b[a-z]\w*Live|\blive(?:Mode)?)\b(?!\s*\()`;
const GUARD = new RegExp([String.raw`\bif\s*\(\s*!?` + L, "!?" + L + String.raw`\s*(\?|&&|\|\|)`, String.raw`(&&|\|\|)\s*!?` + L,
  String.raw`disabled=\{[^}]*` + L, String.raw`mode\s*[!=]==\s*"(fixture|live)"`, String.raw`\bFIXTURES\b`, String.raw`\bfixtures\b`].join("|"));
const FN_START = /^(export\s+)?(default\s+)?(async\s+)?function\s|^(export\s+)?const\s+[A-Za-z]\w*\s*[:=]/;

type Site = { key: string; file: string; line: number; action: string; side: "lead" | "im"; guarded: boolean };
function sites(): Site[] {
  const out: Site[] = [];
  for (const file of [...files("features"), ...files("components")]) {
    const lines = strip(read(file)).split("\n");
    lines.forEach((l, i) => {
      for (const m of l.matchAll(/dispatch\(\s*\{\s*type:\s*"(\w+)"/g)) {
        let start = i;
        while (start > 0 && !FN_START.test(lines[start]!)) start--;
        const side = file.startsWith("features/im/") ? "im" : "lead";
        out.push({ key: `${file}#${m[1]}`, file, line: i + 1, action: m[1]!, side, guarded: GUARD.test(lines.slice(start, i + 1).join("\n")) });
      }
    });
  }
  return out;
}
const persistent = (s: Site) => (s.side === "im" ? imTypes.has(s.action) && !IM_LOCAL.has(s.action) : BUSINESS_WRITES.has(s.action));
/** Does any endpoint's fixture half run this action (i.e. a route already exists for it)? */
const endpointText = files("lib/data/endpoints").map(read).join("\n") + read("features/lead/followupWrites.ts");
const mapped = (a: string) => new RegExp(`type:\\s*"${a}"`).test(endpointText);

describe("D132 client-only-save guard", () => {
  const all = sites();
  it("finds the screens' dispatches (the scan is not empty)", () => {
    expect(all.length).toBeGreaterThan(100);
  });
  it("every dispatched action type is classified: a write, or listed as local UI state", () => {
    const unknown = [...new Set(all.filter(s => !persistent(s) && !(s.side === "im" ? IM_LOCAL : LEAD_LOCAL).has(s.action))
      .map(s => `${s.side}:${s.action} (${s.file}:${s.line})${s.side === "lead" && !leadTypes.has(s.action) && !imTypes.has(s.action) ? " — not a known action" : ""}`))];
    expect(unknown, "classify these as a write (BUSINESS_WRITES / ImAction) or add them to LEAD_LOCAL / IM_LOCAL").toEqual([]);
  });
  it("no persistent action is dispatched on the live console without a route or a live-mode guard", () => {
    const bad = all.filter(s => persistent(s) && !s.guarded);
    const listed = (k: string) => k in KNOWN || k in HAND_CHECKED;
    const fresh = bad.filter(s => !listed(s.key))
      .map(s => `${s.file}:${s.line} ${s.action} — ${mapped(s.action) ? "a route exists (lib/data/endpoints): call it with useApiWrite" : "no route: build one, or guard it live (\"Not available yet\")"}`);
    expect(fresh, "client-only saves: these change only this browser's copy on the live console").toEqual([]);
    const stale = Object.keys({ ...KNOWN, ...HAND_CHECKED }).filter(k => !bad.some(s => s.key === k));
    expect(stale, "listed but no longer an unguarded dispatch: take them off KNOWN / HAND_CHECKED").toEqual([]);
  });
});
