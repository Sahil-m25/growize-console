"use client";

/* ── 2. LEADS — vLeads. growize-console-merged (ir-merged.js 4767–4900) ─────────────────────────
   D59: one workspace — the count line (which names the lost leads it holds back, with a Show),
   a toolbar (the list filter plus a Filters disclosure whose options carry their own counts), the
   active cuts as removable chips, "Needs an owner" named once at the top, and a table whose row
   opens the lead. The book rail, its "leads.more" panel and the Book summary grid were removed
   in the merged prototype: every row in them cut the book a second time.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type { ReactNode } from "react";
import { LADDER } from "@/domain";
import type { Lead, PersonKey, SortKey } from "@/domain";
import { UNIT } from "@/domain";
import { money } from "@/lib/format";
import {
  acting,
  bookFor,
  canAssign,
  canReach,
  covOf,
  EXC,
  hl,
  isIR,
  knownUnitIntent,
  lost,
  converted,
  P,
  passes,
  passesNoLost,
  scopeOf,
  seesTeam,
  sortOf,
  SORTS,
  teamBook,
} from "@/lib/selectors";
import type { ExcKey, LeadFilters } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { Icon } from "@/components/ui";
import { FUCHANNELS, fuLatest } from "@/features/today/work";
/* p:add.quick is registered by the shell (components/shell/drawers); the lead drawers load on demand
   in useGoLead. The list itself registers nothing, which keeps this route's chunk small. */

import { useAssignToMe } from "@/lib/data/endpoints/ownership";
import { LeadsIcon } from "./icons";
import { useGoLead } from "./nav";
import { uiLlost, uiSort } from "./ui";

export function LeadsPage() {
  const { state, dispatch } = useConsole();
  /* C3: "Assign to me" is POST /api/leads/[id]/assign (self only); fixture: the reducer */
  const { assign: assignToMe, error: assignErr, pending: assigning } = useAssignToMe();
  const goLead = useGoLead("leads");
  const ui = state.ui;
  const LQ = ui.LQ ?? "";
  const LSORT = uiSort(ui);
  const LLOST = uiLlost(ui);
  const LSTAGEMODE = ui.LSTAGEMODE === "from" ? "from" : "at";
  const LQUIET = ui.LQUIET ?? null;
  const q = LQ.trim();

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

  const stageOptions = LADDER.map((s, i) => ({ i: i + 1, t: s.t, n: owned.filter((l) => l.done === i + 1).length }))
    .filter((x) => x.n || f.LSTAGE === x.i);
  const ownerOptions = [...new Set(owned.map((l) => l.own as PersonKey))];
  const sourceOptions = [...new Set(all.map((l) => l.src).filter(Boolean))].sort();
  const sourceChoices = [...new Set([...sourceOptions, ...(f.LSRC ? [f.LSRC] : [])])];
  /* "dormant" is a cut Numbers can land on; the merged prototype's own list does not offer it */
  const exceptions = (Object.entries(EXC) as [ExcKey, [string, (c: typeof state, l: Lead) => boolean]][])
    .filter(([k]) => k !== "dormant" || f.LFILT === k)
    .map(([k, [t, fn]]) => ({ k, t, n: owned.filter((l) => fn(state, l)).length }))
    .filter((x) => x.n || f.LFILT === x.k);
  /* leadAdvancedCount() */
  const advanced = [f.LFILT, f.LSRC, f.LSTAGE, f.LOWN, LLOST, LQUIET, LSORT !== "name"].filter(Boolean).length;

  const set = (patch: Record<string, unknown>) => dispatch({ type: "setUi", patch });
  const setLQ = (v: string) => dispatch({ type: "setLQ", v });
  /* resetLeadCuts() */
  const resetAll = () => {
    set({ LFILT: null, LSRC: null, LSTAGE: null, LSTAGEMODE: "at", LOWN: null, LLOST: false, LQUIET: null });
    dispatch({ type: "setSort", v: "name" });
  };

  type Chip = { t: string; c: () => void };
  const chips: Chip[] = (
    [
      f.LSTAGE
        ? { t: LADDER[f.LSTAGE - 1].t + (LSTAGEMODE === "from" ? " or past it" : ""), c: () => set({ LSTAGE: null }) }
        : null,
      f.LFILT ? { t: EXC[f.LFILT][0], c: () => set({ LFILT: null }) } : null,
      f.LSRC ? { t: f.LSRC, c: () => set({ LSRC: null }) } : null,
      f.LOWN ? { t: P(state.PEOPLE, f.LOWN).n, c: () => set({ LOWN: null }) } : null,
      LQUIET ? { t: LQUIET + " days +", c: () => set({ LQUIET: null }) } : null,
      LLOST ? { t: "Lost leads shown", c: () => set({ LLOST: false }) } : null,
      LSORT !== "name" ? { t: SORTS[LSORT].t, c: () => dispatch({ type: "setSort", v: "name" }) } : null,
    ] as (Chip | null)[]
  ).filter((x): x is Chip => !!x);

  /* leadCuts(all) — every cut the list is under, named, with the way out of each */
  const lostShown = !!(LLOST || f.LFILT === "lost" || f.LSTAGE || LQUIET || q);
  const lostHeld = all.filter((l) => lost(l) && passesNoLost(state, l, f)).length;
  type Cut = { t: ReactNode; b: string; c: () => void; lost?: true };
  const cuts: Cut[] = [];
  if (q) cuts.push({ t: <>the search <b>“{q}”</b></>, b: "Clear the search", c: () => setLQ("") });
  if (f.LSTAGE) cuts.push({ t: <>the stage <b>{LADDER[f.LSTAGE - 1].t}</b></>, b: "Clear the stage", c: () => set({ LSTAGE: null }) });
  if (f.LFILT) cuts.push({ t: <>the <b>{EXC[f.LFILT][0]}</b> cut</>, b: `Clear “${EXC[f.LFILT][0]}”`, c: () => set({ LFILT: null }) });
  if (f.LSRC) cuts.push({ t: <>the source <b>{f.LSRC}</b></>, b: "Clear the source", c: () => set({ LSRC: null }) });
  if (f.LOWN) cuts.push({ t: <>the owner <b>{P(state.PEOPLE, f.LOWN).n}</b></>, b: "Clear the owner", c: () => set({ LOWN: null }) });
  if (!lostShown && lostHeld)
    cuts.push({ t: <><b>{lostHeld}</b> closed as lost, held back</>, b: "Show the lost leads", c: () => set({ LLOST: true }), lost: true });
  const lostCut = cuts.find((c) => c.lost);
  /* GC-1523: converted leads are investors now — off the default list, counted here, one click to their own cut */
  const convHeld = f.LFILT || f.LSTAGE || q ? 0 : all.filter((l) => converted(l) && passesNoLost(state, l, f)).length;

  const book = team ? "the team's book" : "your book";
  const heading = (
    <div className="ph">
      <div>
        <h1>Leads</h1>
        <p className="sub">
          {all.length ? (
            <>
              {list.length === all.length ? `${all.length} in ${book}` : `${list.length} of ${all.length} in ${book}`}
              {lostCut ? (
                <>
                  {" · "}
                  {lostCut.t}{" "}
                  <button type="button" className="lnk g2-lnk" onClick={lostCut.c}>
                    Show
                  </button>
                </>
              ) : null}
              {convHeld ? (
                <>
                  {" · "}
                  <b>{convHeld}</b> converted to investors{" "}
                  <button type="button" className="lnk g2-lnk" onClick={() => set({ LFILT: "converted" })}>
                    Show
                  </button>
                </>
              ) : null}
            </>
          ) : team ? (
            "Your team's investor records"
          ) : (
            "Your assigned investor records"
          )}
        </p>
      </div>
      <div className="sp" />
    </div>
  );

  const page = (content: ReactNode) => (
    <section className="rd-leads g2-leads" aria-label="Investor records">
      {content}
    </section>
  );

  if (!all.length) {
    const canSeeTeamBook = !team && seesTeam(state) && teamBook(state).length > 0;
    return page(
      <>
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
      </>,
    );
  }

  const filterPanel = (
    <details className="ux-disclosure ux-inline-filter" data-ux-key="leads-filters">
      <summary>Filters{advanced ? " · " + advanced : ""}</summary>
      <div className="cb ux-filter-fields">
        <label className="fi">
          <span>Needs attention</span>
          <select className="selw" id="lead-exception" value={f.LFILT ?? ""} onChange={(e) => set({ LFILT: e.target.value || null })}>
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
            id="lead-stage"
            value={f.LSTAGE ?? ""}
            onChange={(e) => set({ LSTAGE: e.target.value ? +e.target.value : null, LSTAGEMODE: "at" })}
          >
            <option value="">Any stage</option>
            {stageOptions.map((x) => (
              <option value={x.i} key={x.i}>
                {x.t} · {x.n}
              </option>
            ))}
          </select>
        </label>
        {team ? (
          <label className="fi">
            <span>Owner</span>
            <select className="selw" id="lead-owner" value={f.LOWN ?? ""} onChange={(e) => set({ LOWN: e.target.value || null })}>
              <option value="">Any owner</option>
              {ownerOptions.map((k) => (
                <option value={k} key={k}>
                  {P(state.PEOPLE, k).n} · {owned.filter((l) => l.own === k).length}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="fi">
          <span>Source</span>
          <select className="selw" id="lead-source" value={f.LSRC ?? ""} onChange={(e) => set({ LSRC: e.target.value || null })}>
            <option value="">Any source</option>
            {sourceChoices.map((s) => (
              <option value={s} key={s}>
                {s} · {all.filter((l) => l.src === s).length}
              </option>
            ))}
          </select>
        </label>
        <label className="fi">
          <span>Order</span>
          <select className="selw" id="lead-sort" value={LSORT} onChange={(e) => dispatch({ type: "setSort", v: e.target.value })}>
            {(Object.entries(SORTS) as [SortKey, { t: string }][]).map(([k, v]) => (
              <option value={k} key={k}>
                {k === "urgent" ? "Needs action first" : v.t}
              </option>
            ))}
          </select>
        </label>
        <label className="ux-secondary">
          <input type="checkbox" checked={LLOST} onChange={(e) => set({ LLOST: e.target.checked })} /> Include leads closed as lost
        </label>
      </div>
    </details>
  );

  /* D59 · on Leads this box is the finder; the top-bar Find investor is hidden here */
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
          placeholder="Filter this list — name, phone, email or event"
          aria-label="Filter this list"
          onChange={(e) => setLQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setLQ("");
            }
          }}
        />
        {q ? (
          <button type="button" className="x" aria-label="Clear search" onClick={() => setLQ("")}>
            <Icon name="x" />
          </button>
        ) : null}
      </div>
      {filterPanel}
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
        {assignErr ? <p className="ux-date-error" role="alert" style={{ margin: "0 0 9px" }}>{assignErr}</p> : null}
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
              <button type="button" className="act" disabled={assigning} onClick={() => void assignToMe(l.id)}>
                Assign to me
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  ) : null;

  const teamHasMatches = !team && seesTeam(state) && teamBook(state).some((l) => passes(state, l, f));
  const hasInt = rows.some((l) => knownUnitIntent(l));
  const otherCuts = cuts.filter((c) => c !== lostCut);

  const table = rows.length ? (
    <section className="card ux-overflow rd-lead-table-card">
      <table className="ux-leads-table g2-leads-table">
        <caption className="rd-sr-only">
          {team ? "Team" : "Your"} investor records, ordered by {SORTS[LSORT].t.toLowerCase()}. Select a row to open the lead.
        </caption>
        <thead>
          <tr>
            <th scope="col">Investor</th>
            <th scope="col">Stage</th>
            <th scope="col">Last contact</th>
            {hasInt ? <th scope="col">Interest</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const c = fuLatest(state, l);
            return (
              <tr
                key={l.id}
                className="g2-row"
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("button,a,input,select,label")) goLead(l.id);
                }}
              >
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
                  <span className={`tag ${converted(l) ? "go" : ""}`}>{lost(l) ? "Closed as lost" : converted(l) ? "Converted" : LADDER[Math.max(0, l.done - 1)].t}</span>
                </td>
                <td data-label="Last contact">
                  {c ? (
                    <>
                      {FUCHANNELS[c.channel] || c.channel}
                      <div className="ux-list-meta">{c.at || ""}</div>
                    </>
                  ) : (
                    <span className="ux-secondary">None yet</span>
                  )}
                </td>
                {hasInt ? (
                  <td data-label="Interest">
                    {knownUnitIntent(l) ? (
                      <>
                        <b>
                          {l.units} unit{l.units === 1 ? "" : "s"}
                        </b>
                        <div className="ux-list-meta">{money(l.units * UNIT)}</div>
                      </>
                    ) : (
                      <span className="ux-secondary">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  ) : unowned.length ? null : (
    <section className="card ux-empty">
      <h2>No matching leads</h2>
      <p>
        {cuts.length ? (
          <>
            Nothing matches{" "}
            {otherCuts.map((c, i) => (
              <span key={i}>
                {i ? ", " : ""}
                {c.t}
              </span>
            ))}
            .{lostCut ? <> {lostCut.t}.</> : null}
          </>
        ) : (
          "Clear the filters to see your investor records."
        )}
      </p>
      <div className="ux-primary">
        {advanced ? (
          <button type="button" className="act" onClick={resetAll}>
            Clear filters
          </button>
        ) : null}
        {q ? (
          <button type="button" className="btn" onClick={() => setLQ("")}>
            Clear search
          </button>
        ) : null}
        {lostCut ? (
          <button type="button" className="btn" onClick={lostCut.c}>
            {lostCut.b}
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

  return page(
    <>
      {heading}
      <div className="rd-lead-workspace">
        {toolbar}
        {activeChips}
        {unassigned}
        {table}
      </div>
    </>,
  );
}
