# Wiring a screen to its /api route — phase 2b (D104)

**Gate:** the screen no longer reads or writes that data through the demo reducer; it goes through `@/lib/data/api`
→ the route. Its Jev UI cases still pass with FIXTURE_MODE=local; `npm run typecheck` and `npm test` pass. No live Zoho.
Pilots to copy: `endpoints/farms.ts` (read list + one), `endpoints/receipts.ts` (write), `endpoints/investors.ts` (record).

## The pattern (do not invent another)
- The screen calls `useApiRead(endpoint, book, args)` / `useApiWrite(endpoint, book, dispatch)` from `console/src/lib/data/api.ts`.
- An **endpoint** (`console/src/lib/data/endpoints/<area>.ts`) has two halves returning ONE type — the route's own answer:
  - **live**: `path(args)` + `pick(json)` (+ `method`, `body`, `idempotent` for writes). Fetches the route on the session.
  - **fixture**: `fixture(book, args)` projects that same type from the client's demo book with the existing `@/lib/im` /
    `@/lib/selectors` functions; a write's fixture runs the reducer action it replaces (`imFixtureWrite`).
- Mode comes from the hydrated payload (`state.FIXTURES`, `ApiModeProvider` in store.tsx). Never check `FIXTURE_MODE` yourself.
- Why not serve fixtures from the route: the demo book is mutated by the (still unwired) reducer screens; a server-side
  fixture would be a second copy that misses those writes (e.g. TC-IM06-008 verifies a letter, then reads Farms). Rule 1.

## Steps per unit (≈30 min)
1. Read the unit's `detail`, the route file(s) under `console/src/app/api/...`, and the server reader for its answer type.
2. Add or extend `console/src/lib/data/endpoints/<area>.ts` (one file per rail area; create it if missing):
   - `import type { X } from "@/server/..."` for the answer type. **Type-only** — never a value import from `@/server` in client code.
   - Read: `ReadEndpoint<ImBook | ConsoleState, Args, T>`; `path` returns `null` when there is nothing to read (no id).
   - Write: `WriteEndpoint<ImBook, Args, T, ImDispatch>`; body exactly as the route documents it (`expectedModifiedTime`,
     `{version}`, …); `idempotent: true` when the route takes an Idempotency-Key; `onLiveError: imLiveError` on the Investors side.
   - `T` = the part of the route's answer the screen uses (e.g. `Pick<MatchView, "receiptId" | "state">`). The fixture must
     type-check against it — that is the parity check. Fields the screen does not read yet may be empty/null in the fixture,
     with a comment naming the unit that will read them.
   - Refusals in the fixture mirror the route: 403 a seat without the page, 404 an id the seat cannot see (use the same `I()`/
     `pageReadable()` the screen used). Lead side: book = `useConsole().state` (ConsoleState); Investors side: `{ s, me }`.
3. Change the screen: call the hook **before any early return** (rules of hooks). Render from `r.data` (`state` is
   `idle | loading | ok | error`); show `loading` as one quiet line and an error as `r.err.error` in the page (`role="alert"`).
   A drawer `body`/`sub` is a plain function — render a component (`body: c => <LlpBody {...c} />`) so it may use hooks.
   Keep navigation/UI actions (`openDrawer`, `go`, `setSec`) on dispatch — only DATA moves to the adapter.
   Writes: `const w = useApiWrite(ep, { s, me }, dispatch)`; `void w(args)`; for Idempotency-Key retries keep the key and
   pass `{ idempotencyKey }` again. A live 409 already reads "Changed by someone else — reload." (`CHANGED`).
4. Remove gates that looked the record up in the book only to decide whether to show it (e.g. `moneyDrawerReadable` "llp"
   now checks `!!id`; the route answers 404). Keep permission gates (`may`, `pageReadable`) — they are seat rules.
5. Tests: add cases to `console/src/lib/data/api.test.tsx` (or `endpoints/<area>.test.tsx`): fixture half for 2 seats
   (one allowed, one refused/404) asserting the numbers the UI cases assert; `path()` for the id; for a write, `runWrite
   ("live", …)` with a `vi.fn` fetch asserting URL + body (+ Idempotency-Key), and `runWrite("fixture", …)` asserting the
   reducer action dispatched. Existing `render.test.tsx` must keep passing unchanged (default mode is fixture).

## Verify
- `cd console && npx vitest run src/lib/data src/features/im` (fast), `npm run typecheck`, then `npm test` (~10 min).
- Jev: `npm run build:local && PORT=<free port> npm run start:local` (background), then from the repo root
  `APP_URL=http://localhost:<port> node autopilot/test-story.mjs console <STORY>` for the unit's story AND every story whose
  UI cases open the same page (grep `pm/plan-merged/ui-cases.json` for the page name). Never `--regression` (it writes progress.json).
- Do not record done / edit BLOCKED.md, progress.json, queue.json, status.json — the coordinator does.

## Pitfalls hit in the pilots
- The route's contract and the prototype differ in places. The fixture follows the **route** (the decision), and you
  report the visible difference as `PROVISIONAL:`. Examples: record sections come from `sectionsFor` (Finance has no Care;
  the FEMA banner shows only where Money shows); LLP SPOCs carry no role ("SPOC 1/2"); `freeUnits` is floored at 0.
  Never edit a UI case's expected facts; if the route's rule breaks one, stop and write `FACT CHANGE PROPOSED:`.
- Keep the book's own object where the route returns the prototype shape (`record.investor` is the book's `ImInvestor`)
  so the not-yet-wired sections under it render unchanged.
- In fixture mode the reducer still shows its own refusal note; `imFixtureWrite` also returns it as a 422/428 so the
  caller can react. Do not show it twice.
- Live mode still has an empty Investors book: selectors that take `s` (badge counts, `mayMatch`) return nothing live
  until their own unit wires them. That is expected; do not "fix" it by fetching extra data outside your unit.
- Do not import `@/lib/data/api` from `@/lib/data/index.ts` or any server module ("use client", React hooks).
- `useApiRead` with a changing `args` object: `path(args)` is the cache key — make it encode every argument.
- `npm run build:local` rewrites `console/next-env.d.ts` (`.next-local`): `git checkout console/next-env.d.ts` before committing.
  Never `git add` `console/node_modules` (a symlink in the worktrees). Stop only YOUR server (find the pid by its cwd; a
  `pkill -f` pattern also matches your own shell and other agents' servers). Load is high: a vitest 5 s timeout
  (fixtures/apply.test.ts) can flake — re-run that file alone before calling it a failure.
- Cases that name the old portal rail ("Press 'Transactions'") fail before and after wiring (FACT CHANGE already in
  BLOCKED.md, M10-S02-NOTE-1). Prove your screen with a scratch copy of the case using the merged name (never edit ui-cases.json).
