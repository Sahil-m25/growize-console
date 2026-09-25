# console — the IR lead console

Fourteen screens. The IR owns and moves the lead; Finance confirms; nothing transfers (D9).

`prototype/ir-console.html` is the visual truth: every screen, every state, in one file. Build against
it. Where the prototype and the Build Book disagree, the Build Book is right and the prototype is stale
— say so rather than quietly following the picture.

## The application

Next.js 15 App Router, React 19, TypeScript strict (**D26**). The dependency list is `next`, `react`,
`react-dom` and the types — no UI kit, no state library, no CSS framework, no date or chart library,
per `docs/stages/STAGE-1.md` §1.1.

```
npm install
npm run dev        # http://localhost:3001
npm run typecheck  # tsc --noEmit
npm run build
```

| Where | What |
|---|---|
| `src/app/console.css` | **the prototype's `<style>` block, verbatim.** The design system. A change here is a design change and belongs in `docs/design-spec.html` first. |
| `src/domain/**` | the prototype's constants and fixtures, typed, under their prototype names — `PEOPLE`, `LADDER`, `ST`, `PLAN`, `LEADS`, `EVENTS`, `LOG`, `ROUNDS`, `PAGECAPS` … |
| `src/domain/seed.ts` | `seedPaper()` — the paper, accounts and transfers **derived** from each lead's own ladder, never typed a second time |
| `src/lib/selectors/**` | the prototype's pure functions, under their prototype names, taking an explicit read context. No mutation, no DOM, and the clock is passed in |
| `src/lib/format.ts` | the clock and the formatting. The **one** wall-clock read in the port lives here |
| `src/lib/store.tsx` | the prototype's global object graph and `draw()` as one context and one reducer. Cases are named after the prototype's mutators; four feature slices are composed at the bottom |
| `src/components/shell/**` | the rail, the top bar, the drawer frame and the drawer registry |
| `src/features/<page>/**` | one directory per screen |

## What is not here yet

Every write is local reducer state. There is no Zoho, no Supabase, no sign-in, no job — that is
STAGE-1 1.2 to 1.8, and these pages are the shape those reads and writes land in. The role gate in
`src/components/shell/Shell.tsx` is the front end's half only; §1.3 requires the backend to refuse the
same identity, and the file carries that TODO.

## The fidelity check

The port is checked against the prototype by execution, not by eye. `docs/SESSIONS.md` (9 Sep) records
the method and the counts: the prototype run in a `vm` sandbox and diffed constant by constant and
selector by selector, then every screen rendered in a browser beside the prototype at the same
viewport for every persona. Re-run it after any change to `console.css`, `src/domain/**` or
`src/lib/selectors/**`.

The current reviewed standalone UI is `prototype/ir-console-redesigned.html`. Its alignment and
privacy changes, and the corresponding port access fixes, are described in
[D37](../docs/decisions/D37-workflow-alignment-and-user-data-visibility.md). Run
`node prototype/ux-audit/verify-redesigned.cjs` for that prototype and
`node --test privacy-port-regression.cjs` for the port's user and record access regressions.
These checks do not certify production backend authorization or a rendered browser layout.

The current access model is recorded in [D40](../docs/decisions/D40-console-roles-and-explicit-sensitive-access.md): lead operators and business viewers, optional own-assigned Channel Partners, account-menu Profile, and explicitly granted payment/document views.
Its IR sensitive-view default is superseded by [D42](../docs/decisions/D42-ir-read-only-finance-history-mirror.md): IRs read Finance payment/document history for currently owned, assigned-secondary or live-covered leads. Finance's Investor Management portal remains the sole writer. The shared `src/domain/finance-mirror-demo.json` projection supplies actual portal demo receipt/document IDs and dates; this is not a live integration or a complete document version archive.
Connection status and local pending-save behavior are recorded in [D41](../docs/decisions/D41-connection-freshness-and-pending-saves.md). Run `node save-queue-regression.cjs` for the shared elapsed-time/session controller. The prototype verifier includes save integration tests. Queued work is in memory only; neither version claims a live backend or upstream uptime.

The content-sizing follow-up is recorded in
[D38](../docs/decisions/D38-content-sized-drawers-and-layouts.md): timeline utility columns,
available-width Activity/System layouts, content-height panels and compact footer actions.
The same regression commands include the focused sizing checks.

The IR's simplified Today and **Your week** section are recorded in
[D39](../docs/decisions/D39-ir-weekly-work-and-focused-today.md). The weekly view shows leads
added and human follow-ups recorded, scoped to the current IR and readable investors, alongside
the retained closing shortlist. First-contact and next-step actions stay in the queue; the full
book stays in Leads. Manager planning and Finance workflows keep their separate views.

Investor copy status and manual recovery are recorded in [D43](../docs/decisions/D43-investor-copy-gate-and-manual-recovery.md). Signed required agreements plus Finance-confirmed payment of at least 10% qualify the copy; the lead and IR owner remain. Both console versions separately track the three already-existing portal demo accounts and allow authorized integration administrators to recover missing local tracking without changing a lead or Finance record. The interface marks this local demo: no live investor intake, destination creation or remote acknowledgement is connected. The prototype verifier and port privacy regressions include source-evidence, idempotency, authority and queued-replay checks.

[D44](../docs/decisions/D44-active-secondary-access-and-manager-finance-views.md) removes access from dormant secondary assignments: the secondary sees the lead/history/Finance mirror only after ownership transfer, an authorized live handover or active valid primary leave. The IR manager receives read-only Payments/Documents for assigned primary owners within their genuine team. Both versions close stale reads and actions on return, expiry or revocation; source writes, unrelated teams and organisation-wide Finance totals remain restricted.
