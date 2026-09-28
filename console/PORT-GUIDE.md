# PORT-GUIDE — the contract every agent on this port codes against

We are porting `console/prototype/ir-console.html` (a 7,995-line vanilla-JS SPA) to
**Next.js 15 App Router + React 19 + TypeScript**, frontend only, prototype demo data as fixtures.

## The reference files (read these, not a summary of them)

| File | What |
|---|---|
| `/home/claude/build/ref/03-app.js` | the prototype's entire `<script>`, 7,204 lines, line 1 here = line 791 of the HTML |
| `/home/claude/build/ref/01-styles.css` | the prototype's entire `<style>`, verbatim — **already copied to `src/app/console.css`** |
| `/home/claude/build/ref/02-body.html` | the app shell markup |
| `/mnt/user-data/uploads/Growize Business Unit/growize/console/prototype/ir-console.html` | the original, if you need it |

**Read the actual prototype lines for whatever you are porting.** Do not invent behaviour, labels,
copy, thresholds or colours. Every string a user sees is already written; copy it exactly, including
the em dashes, the `₹`, the lowercase, and the past-tense button wording.

## Data and sign-in (phase 1 foundation, 27 Sep 2026)

- **No record lives in `src/`.** Records come through `@/lib/data` (`Dataset`, `DataSource`, `getSource()`):
  `GET /api/data` serves the empty book (real Asia/Kolkata clock) unless `FIXTURE_MODE=local`, when it
  serves the demo book from `console/fixtures/book/` plus applied fixtures (`console/fixtures/apply.ts`).
  `@/domain` keeps rules and copy only. Read records from `state`, never import them.
- **Nobody is signed in by default.** `state.authed`/`state.WHO` come from the session (`/api/session`
  cookie) or a press on the sign-in screen (`useSession().signIn(k)`); `useSession().signOut(why)` ends it.

## Non-negotiable rules (from `docs/stages/STAGE-1.md` §1.1 and `CLAUDE.md`)

- **No UI kit, no component library, no state library, no CSS framework, no ORM, no date library.**
  React + `next` + the CSS that is already there. If you want a dependency, you may not have it.
- **No new CSS classes** unless the prototype has no class for the thing. `src/app/console.css` is
  verbatim and is the design system. Use its class names exactly (`.card`, `.pav`, `.chip`, `.ag`,
  `.rail nav a.on`, …). Do not add inline styles where a class exists. Do not restyle.
- **Keep the prototype's identifiers.** A ported function keeps its prototype name (`rag`, `nextUp`,
  `prNext`, `needFor`, `reachOf`, `capsFor`, `todayList`, `fcRoll`, `kpis`, …). A ported constant
  keeps its name in SCREAMING_CASE (`PEOPLE`, `LADDER`, `ST`, `PLAN`, `GOALS`, `SOURCES`, `UNIT`,
  `PAGECAPS`, `SEATCAPS`, `SEATSCREENS`, `TOUCHSLA`, `KINDS`, `VERB`, `ACTFAM`, `EVENTS`, `DOCS`,
  `INV`, `TEMP`, `LOG`, `ROUNDS`, `SORTS`, `DTPLS`, `SIGNINS`, `COVER`). This is what makes six
  agents' work link up without a meeting.
- Every component that uses the store is a client component: `"use client"` at the top.
- `strict: true`. No `any` in an exported signature. `unknown` + a narrow is fine.
- Ports of `innerHTML` template strings become JSX. `esc()` disappears — React escapes. Where the
  prototype builds HTML with `hl()` (search highlighting), return `ReactNode`, never
  `dangerouslySetInnerHTML`.

## Directory ownership — do not write outside your own

```
src/domain/**              → agent: domain
src/lib/selectors/**       → agent: selectors
src/lib/store.tsx          → agent: shell
src/lib/format.ts          → agent: selectors
src/components/shell/**    → agent: shell
src/app/layout.tsx         → agent: shell
src/app/page.tsx           → agent: shell
src/components/ui/**       → agent: shell
src/features/today/**      src/features/leads/**   src/features/lead/**      → agent: pages-a
src/features/add/**        src/features/events/**  src/features/updates/**
src/features/activity/**                                                     → agent: pages-b
src/features/people/**     src/features/me/**      src/features/goals/**
src/features/system/**                                                       → agent: pages-c
src/features/numbers/**    src/features/pay/**     src/features/docs/**
src/features/xfer/**                                                         → agent: pages-d
src/app/<route>/page.tsx                            → the page agent that owns that feature
```

If you need something that belongs to another agent, **assume it exists with the name below and
import it.** Do not create it. Do not stub it in your own directory.

## The store — `@/lib/store`

The prototype is a global mutable object graph plus `draw()`. In React that is one context with a
reducer. Assume exactly this API:

```ts
// src/lib/store.tsx
export type ConsoleState = {
  WHO: PersonKey;            // the signed-in person
  ROLE: SeatKey;             // roleOf(WHO), derived, kept for the prototype's reads
  VIEW: NavKey;              // current page key — the router is the source of truth, mirrored here
  NOW: Date;                 // the prototype's frozen clock — 28 Aug 2026
  TODAY: Date;
  LEADS: Lead[];
  PEOPLE: Record<PersonKey, Person>;
  PLAN: Plan;
  EVENTS: EventRec[];
  LOG: LogEntry[];
  PAPER: Record<LeadId, PaperRow>;
  DOCS: DocRec[];
  INV: Inventory;
  TEMP: TempGrant[];
  TEMPON: string | null;
  CAPS: Record<PersonKey, Record<NavKey, string[]>>;  // per-person capability overrides
  COVER: Record<PersonKey, Cover>;
  SC: { today: Scope; leads: Scope; activity: Scope };   // "mine" | "team"
  SEC: Record<string, string>;                            // per-page section tab
  DRW: DrawerState | null;
  // page-local form state the prototype kept as globals — see each feature's own slice
  ui: UiState;
};

export function useConsole(): {
  state: ConsoleState;
  dispatch: React.Dispatch<Action>;
};

// convenience hooks, all client-side
export function useMe(): Person;                 // PEOPLE[state.WHO]
export function useRole(): SeatKey;              // state.ROLE
export function useScope(view: "today"|"leads"|"activity"): Scope;
export function useLeads(): Lead[];              // state.LEADS
```

Actions are plain objects named after the prototype's mutator:
`{type:"logTouch", id, k}`, `{type:"tick", id}`, `{type:"assign", id, to}`,
`{type:"saveNext", id, next}`, `{type:"setFc", id, c}`, `{type:"closeLost", id, why, note}`,
`{type:"prSend", id, rk}`, `{type:"setScope", view, to}`, `{type:"setSec", view, k}`,
`{type:"openDrawer", k, id, seed}`, `{type:"closeDrawer"}`, `{type:"setPerson", k}`, …

A page that only reads calls `useConsole().state`. A page that writes dispatches. **Never mutate
state objects in a component.**

## Routing

Prototype `go(k, id)` → Next routes. The nav key maps to the path:

| key | path | key | path |
|---|---|---|---|
| `today` | `/today` | `events` | `/events` (one event: `/events/[id]`) |
| `leads` | `/leads` (one lead: `/leads/[id]`) | `pay` | `/pay` |
| `updates` | `/updates` | `docs` | `/docs` |
| `add` | `/add` | `xfer` | `/xfer` |
| `activity` | `/activity` | `numbers` | `/numbers` |
| `people` | `/people` | `system` | `/system` |
| `goals` | `/goals` (titled **Plan**) | `me` | `/me` |

`/` redirects to the signed-in person's landing page (`landSafe()` in the prototype, line ~7145 of
`03-app.js`). A route the person's role may not reach redirects to their landing page — the
prototype's `navFor()` is the gate, and it is enforced in the layout, not only by hiding the link.

## Fidelity checks you must run before you hand back

1. `npx tsc --noEmit` from `console/` — zero errors in **your** files.
2. Open the prototype in a browser at the same viewport and compare your page to it, region by
   region: the same headings, the same order of blocks, the same counts, the same empty states.
3. Every user-visible string is byte-identical to the prototype's.
4. No `dangerouslySetInnerHTML` anywhere in your files.

## What you hand back

Ten lines maximum: the files you created, the prototype line ranges each one ports, anything in the
prototype you could **not** port and why, and any place the prototype contradicts
`docs/stages/STAGE-2.md` (the sheet wins — say so, do not silently follow the picture).
