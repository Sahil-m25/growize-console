"use client";

/* ── 2. LEADS — vLeads. ir-console-redesigned.html 7415–7454 ────────────────────────────────────
   The redesign folds search, filters and the table into one workspace: a toolbar (search plus a
   filter disclosure that only says "Filters · 2" when something is actually set), the active cuts
   as removable chips, "Needs an owner" named once at the top instead of mixed into the table, a
   five-column table that leads with the one thing to do next, and a closed "Book summary"
   disclosure instead of always-open totals. `hl()` marks the search hits; it returns ReactNode
   here, never dangerouslySetInnerHTML. The rail beside the table is gone — `vLeads` (7415-7450)
   ends at the summary disclosure; the book's other cuts (forecast/source/owner) only ever open
   from the "leads.more" panel door on `<BookRail part="main">` (`./drawer.tsx`).

   `LeadFilters.LLOST` ("Include leads closed as lost", ir-console-redesigned.html:7362-7366,
   7383) and `EXC.consent`'s "Permission missing" wording (7365, 7382) now live in
   `src/lib/selectors/leads.ts`'s `passes`/`passesNoLost`/`EXC` directly — this page just sets
   `f.LLOST` on the filters object it already builds.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { LADDER, ST, UNIT } from "@/domain";
import type { Lead, PersonKey, SortKey } from "@/domain";
import { money } from "@/lib/format";
import {
  acting,
  active,
  bookFor,
  canAssign,
  canReach,
  covOf,
  EXC,
  hasNext,
  hl,
  isIR,
  knownUnitIntent,
  lost,
  nextUp,
  nxWhen,
  P,
  passes,
  QUIET,
  quietDays,
  scopeOf,
  seesTeam,
  sortOf,
  SORTS,
  stageAtLeast,
  teamBook,
} from "@/lib/selectors";
import type { ExcKey, LeadFilters } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { Icon } from "@/components/ui";
import "./drawer"; /* registers p:leads.more before BookRail's door can open it */
import "./followupDrawer"; /* registers p:followup before WorkAction's "Record follow-up" can open it */
import { WorkAction } from "./WorkAction";
import "@/features/lead/drawers"; /* register the lead drawers before anything opens one */
import "@/features/add"; /* registers p:add.quick before the empty-book state can open it */

import { LeadsIcon } from "./icons";
import { useGoLead } from "./nav";
import { uiLlost, uiSort } from "./ui";

export function LeadsPage() {
  const { state, dispatch } = useConsole();
  const goLead = useGoLead("leads");
  const ui = state.ui;
  const LQ = ui.LQ ?? "";
  const LSORT = uiSort(ui);
  const LLOST = uiLlost(ui);
  const LSTAGEMODE = ui.LSTAGEMODE === "from" ? "from" : "at";
  const LQUIET = ui.LQUIET ?? null;

  const team = scopeOf(state, "leads") === "team";
  const all = bookFor(state, "leads");
  const f: LeadFilters = {
    LQ,
    LFILT: (ui.LFILT ?? null) as ExcKey | null,
    LSRC: ui.LSRC ?? null,
    LSTAGE: ui.LSTAGE ?? null,
    LSTAGEMODE,
    LOWN: (ui.LOWN ?? null) as PersonKey | null,
    LLOST,
    LQUIET,
  };
  const list = all
    .filter((l) => passes(state, l, f))
    .slice()
    .sort(sortOf(state, LSORT));
  const rows = list.filter((l) => l.own);
  const unowned = list.filter((l) => !l.own);
  const owned = all.filter((l) => l.own);
  const canCapture = canReach(state, "add");

  const stageOptions = LADDER.map((s, i) => ({
    i: i + 1,
    t: s.t,
    n: owned.filter((l) => (LSTAGEMODE === "from" ? stageAtLeast(l, i + 1) : l.done === i + 1)).length,
  })).filter((x) => x.n || f.LSTAGE === x.i);
  const ownerOptions = [...new Set(owned.map((l) => l.own as PersonKey))];
  const sourceOptions = [...new Set(all.map((l) => l.src).filter(Boolean))].sort();
  const sourceChoices = [...new Set([...sourceOptions, ...(f.LSRC ? [f.LSRC] : [])])];
  const exceptions = (Object.entries(EXC) as [ExcKey, [string, (c: typeof state, l: Lead) => boolean]][])
    .map(([k, [t, fn]]) => ({ k, t, n: owned.filter((l) => fn(state, l)).length }))
    .filter((x) => x.n || f.LFILT === x.k);
  const quietOptions = QUIET.map(([d, t]) => ({
    d, t, n: owned.filter((l) => (quietDays(state, l) ?? -1) >= d).length,
  }));
  const advanced = [f.LFILT, f.LSRC, f.LSTAGE, f.LOWN, LLOST, LQUIET, LSORT !== "urgent"].filter(Boolean).length;

  const set = (patch: Record<string, unknown>) => dispatch({ type: "setUi", patch });
  const resetAll = () =>
    set({
      LFILT: null, LSRC: null, LSTAGE: null, LSTAGEMODE: "at", LOWN: null, LLOST: false,
      LQUIET: null, LSORT: "urgent",
    });

  type Chip = { t: string; c: () => void };
  const chips: Chip[] = (
    [
      f.LSTAGE
        ? { t: LADDER[f.LSTAGE - 1].t + (LSTAGEMODE === "from" ? " or past it" : ""), c: () => set({ LSTAGE: null }) }
        : null,
      f.LFILT ? { t: EXC[f.LFILT][0], c: () => set({ LFILT: null }) } : null,
      f.LSRC ? { t: f.LSRC, c: () => set({ LSRC: null }) } : null,
      f.LOWN ? { t: P(state.PEOPLE, f.LOWN).n, c: () => set({ LOWN: null }) } : null,
      LQUIET ? { t: (QUIET.find((x) => x[0] === LQUIET)?.[1] ?? LQUIET + " days +"), c: () => set({ LQUIET: null }) } : null,
      LLOST ? { t: "Include closed leads", c: () => set({ LLOST: false }) } : null,
      LSORT !== "urgent" ? { t: SORTS[LSORT].t, c: () => dispatch({ type: "setSort", v: "urgent" }) } : null,
    ] as (Chip | null)[]
  ).filter((x): x is Chip => !!x);

  const heading = (
    <div className="ph">
      <div>
        <h1>Leads</h1>
        <p className="sub">
          {all.length
            ? `${list.length} shown · ${all.length} in ${team ? "your team's book" : "your book"}`
            : team
              ? "Your team's investor records"
              : "Your assigned investor records"}
        </p>
      </div>
      <div className="sp" />
    </div>
  );

  if (!all.length) {
    const canSeeTeamBook = !team && seesTeam(state) && teamBook(state).length > 0;
    return (
      <section className="rd-leads" aria-label="Investor records">
        {heading}
        <section className="card ux-empty">
          <span className="rd-empty-icon" aria-hidden="true">
            <LeadsIcon name="leads" />
          </span>
          <h2>{team ? "No leads yet" : "No leads assigned to you"}</h2>
          <p>
            {canSeeTeamBook
              ? "You can review the team's leads from here."
              : canCapture
                ? "Add a lead to start their investor record."
                : "New investor records will appear when your team assigns them to you."}
          </p>
          <div className="ux-primary">
            {canSeeTeamBook ? (
              <button type="button" className="act" onClick={() => dispatch({ type: "setScope", view: "leads", to: "team" })}>
                View team leads
              </button>
            ) : null}
            {canCapture ? (
              <button type="button" className="btn" onClick={() => dispatch({ type: "openDrawer", k: "p:add.quick" })}>
                Add first lead
              </button>
            ) : null}
          </div>
        </section>
      </section>
    );
  }

  const toolbar = (
    <div className="ux-toolbar rd-lead-toolbar">
      <div className="srch">
        <Icon name="search" />
        <input
          id="lq"
          type="search"
          value={LQ}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search investors by name, phone, email or event"
          aria-label="Find an investor"
          onChange={(e) => dispatch({ type: "setLQ", v: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              dispatch({ type: "setLQ", v: "" });
            }
          }}
        />
        {LQ ? (
          <button type="button" className="x" aria-label="Clear search" onClick={() => dispatch({ type: "setLQ", v: "" })}>
            <Icon name="x" />
          </button>
        ) : null}
      </div>
      <details className="ux-disclosure ux-inline-filter" data-ux-key="leads-filters">
        <summary>Filters{advanced ? " · " + advanced : ""}</summary>
        <div className="cb ux-filter-fields">
          <label className="fi">
            <span>Needs attention</span>
            <select
              className="selw"
              value={f.LFILT ?? ""}
              onChange={(e) => set({ LFILT: e.target.value || null })}
            >
              <option value="">Any status</option>
              {exceptions.map((x) => (
                <option value={x.k} key={x.k}>
                  {x.t} · {x.n}
                </option>
              ))}
            </select>
          </label>
          <label className="fi">
            <span>Journey stage</span>
            <select
              className="selw"
              value={f.LSTAGE ?? ""}
              onChange={(e) => set({ LSTAGE: e.target.value ? +e.target.value : null })}
            >
              <option value="">Any stage</option>
              {stageOptions.map((x) => (
                <option value={x.i} key={x.i}>
                  {x.t} · {x.n}
                </option>
              ))}
            </select>
          </label>
          <select
            className="selw"
            aria-label="Stage match"
            value={LSTAGEMODE}
            onChange={(e) => set({ LSTAGEMODE: e.target.value === "from" ? "from" : "at" })}
          >
            <option value="at">on this rung</option>
            <option value="from">this rung or past it</option>
          </select>
          {team ? (
            <label className="fi">
              <span>Owner</span>
              <select
                className="selw"
                value={f.LOWN ?? ""}
                onChange={(e) => set({ LOWN: e.target.value || null })}
              >
                <option value="">Any owner</option>
                {ownerOptions.map((k) => (
                  <option value={k} key={k}>
                    {P(state.PEOPLE, k).n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="fi">
            <span>Source</span>
            <select
              className="selw"
              value={f.LSRC ?? ""}
              onChange={(e) => set({ LSRC: e.target.value || null })}
            >
              <option value="">Any source</option>
              {sourceChoices.map((s) => (
                <option value={s} key={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="fi">
            <span>Not contacted for</span>
            <select
              className="selw"
              id="lead-quiet"
              value={f.LQUIET ?? ""}
              onChange={(e) => set({ LQUIET: e.target.value ? +e.target.value : null })}
            >
              <option value="">Any time</option>
              {quietOptions.map((x) => (
                <option value={x.d} key={x.d}>
                  {x.t} · {x.n}
                </option>
              ))}
            </select>
          </label>
          <label className="fi">
            <span>Order</span>
            <select
              className="selw"
              value={LSORT}
              onChange={(e) => dispatch({ type: "setSort", v: e.target.value })}
            >
              {(Object.entries(SORTS) as [SortKey, { t: string }][]).map(([k, v]) => (
                <option value={k} key={k}>
                  {k === "urgent" ? "Needs action first" : v.t}
                </option>
              ))}
            </select>
          </label>
          <label className="ux-secondary">
            <input type="checkbox" checked={LLOST} onChange={(e) => set({ LLOST: e.target.checked })} /> Include
            leads closed as lost
          </label>
          <p className="ux-secondary">
            Use these to find a specific group. The default list already puts urgent work first.
          </p>
        </div>
      </details>
    </div>
  );

  const activeChips = chips.length ? (
    <div className="ux-active-filters">
      {chips.map((x) => (
        <button type="button" className="chip on" key={x.t} onClick={x.c} aria-label={`Remove ${x.t} filter`}>
          {x.t} ×
        </button>
      ))}
      <button type="button" className="chip" onClick={resetAll}>
        Clear filters
      </button>
    </div>
  ) : null;

  const unassigned = unowned.length ? (
    <section className="card ux-section rd-unassigned">
      <div className="ch">
        <h2>Needs an owner</h2>
        <span className="tag due">{unowned.length}</span>
      </div>
      <div className="cb">
        {unowned.map((l) => (
          <div className="ur" key={l.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <button type="button" className="work-name" onClick={() => goLead(l.id)}>
                {hl(l.n, LQ)}
              </button>
              <div className="ux-list-meta">
                {l.src || "Source not recorded"} · {l.at[0]}
              </div>
            </div>
            {canAssign(state) ? (
              <button type="button" className="btn" onClick={() => goLead(l.id, "owner")}>
                Assign owner
              </button>
            ) : isIR(state.ROLE) ? (
              <button type="button" className="act" onClick={() => dispatch({ type: "assign", id: l.id, to: state.WHO })}>
                Assign to me
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  ) : null;

  const teamHasMatches = !team && seesTeam(state) && teamBook(state).some((l) => passes(state, l, f));

  const table = rows.length ? (
    <section className="card ux-overflow rd-lead-table-card">
      <table className="ux-leads-table">
        <caption className="rd-sr-only">
          {team ? "Team" : "Your"} investor records, ordered by {SORTS[LSORT].t.toLowerCase()}
        </caption>
        <thead>
          <tr>
            <th scope="col">Investor</th>
            <th scope="col">Stage</th>
            <th scope="col">Next action</th>
            <th scope="col">Interest</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const u = nextUp(state, l);
            const known = knownUnitIntent(l);
            const dated = hasNext(l) && !u.t.includes(l.nx!.by) && !u.t.includes("today");
            return (
              <tr key={l.id}>
                <td>
                  <button type="button" className="work-name" onClick={() => goLead(l.id)}>
                    {hl(l.n, LQ)}
                  </button>
                  <div className="ux-list-meta">
                    {team ? P(state.PEOPLE, l.own as PersonKey).n : l.city || "City not recorded"}
                    {covOf(state, l) ? ` · covered by ${P(state.PEOPLE, acting(state, l) as PersonKey).n}` : ""}
                  </div>
                </td>
                <td data-label="Stage">
                  <span className="tag">{lost(l) ? "Closed as lost" : LADDER[Math.max(0, l.done - 1)].t}</span>
                </td>
                <td data-label="Next">
                  <b>{hl(u.t, LQ)}</b>
                  {dated ? <div className="ux-list-meta">{nxWhen(l)}</div> : null}
                </td>
                <td data-label="Interest">
                  {known ? (
                    <>
                      <b>
                        {l.units} unit{l.units === 1 ? "" : "s"}
                      </b>
                      <div className="ux-list-meta">{money(l.units * UNIT)}</div>
                    </>
                  ) : (
                    <span className="ux-secondary">Not discussed</span>
                  )}
                </td>
                <td>
                  {lost(l) || l.done >= ST.ONBOARDED ? (
                    <span className="ux-secondary">—</span>
                  ) : (
                    <WorkAction l={l} u={u} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  ) : unowned.length ? null : (
    <section className="card ux-empty">
      <h2>No matching leads</h2>
      <p>{LQ ? "Try a different search or clear the filters." : "Clear the filters to see your investor records."}</p>
      <div className="ux-primary">
        {advanced ? (
          <button type="button" className="act" onClick={resetAll}>
            Clear filters
          </button>
        ) : null}
        {LQ ? (
          <button type="button" className="btn" onClick={() => dispatch({ type: "setLQ", v: "" })}>
            Clear search
          </button>
        ) : null}
        {teamHasMatches ? (
          <button type="button" className="btn" onClick={() => dispatch({ type: "setScope", view: "leads", to: "team" })}>
            Search team leads
          </button>
        ) : null}
      </div>
    </section>
  );

  const activeCount = all.filter(active).length;
  const lostCount = all.filter((l) => lost(l)).length;
  const onboardedCount = all.filter((l) => l.done >= ST.ONBOARDED).length;

  const summary = (
    <details className="ux-disclosure" data-ux-key="leads-summary">
      <summary>Book summary</summary>
      <div className="cb">
        <p className="ux-secondary">
          {activeCount} active · {lostCount} closed as lost · {onboardedCount} onboarded
        </p>
        <div className="ux-card-grid">
          {stageOptions.map((x) => (
            <div key={x.i}>
              <b>{x.n}</b>
              <div className="ux-secondary">{x.t}</div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );

  return (
    <section className="rd-leads" aria-label="Investor records">
      {heading}
      <div className="rd-lead-workspace">
        {toolbar}
        {activeChips}
        {unassigned}
        {table}
      </div>
      {summary}
    </section>
  );
}
