"use client";

/* ── D60 b · FIND INVESTOR — the top-bar box. ir-merged.js 10898–10997, markup 2828–2831 ───────
   Typing lists the matches under it; Enter (or a press) opens one. It never moves you until you
   choose. M06-S03-W2 (D110): the results are GET /api/leads/search's (endpoints/search topSearch) and
   their scope follows the seat — an IR their own book, an IR Manager the team, Digital Infrastructure and
   the business owner leads AND investors (each hit carries its kind and opens its record), Finance/KAM/
   Head of AM investors within their scope. This is only the combobox. */

import { useEffect, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { LeadId, NavKey } from "@/domain";
import { norm } from "@/lib/format";
import { numeric, P, teamName } from "@/lib/selectors";
import { fqPool, fqTeamOf } from "@/lib/selectors/find";
import { useConsole } from "@/lib/store";
import { useApiMode, useApiRead } from "@/lib/data/api";
import { topSearch } from "@/lib/data/endpoints/search";
import type { SeatHit } from "@/server/leads/seat-search";

/* fqMark — the match, shown; a numeric query marks nothing (the phone is shown as its last four) */
function fqMark(s: string, FQ: string): ReactNode[] {
  const q = norm(FQ).trim();
  if (!q || numeric(q)) return [s];
  const toks = [...new Set(q.split(/\s+/).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp("(" + toks.join("|") + ")", "gi");
  return s.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

const LEAD_HEAD = { all: "All leads in the organisation", team: "Your team's leads", yours: "Your book" } as const;
const INV_HEAD: Record<string, string> = { all: "All investors", org: "All investors", subtree: "Your team's accounts", "own-book": "Your accounts", "own-lead": "Your investors" };

export function FindBox() {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const mode = useApiMode();
  const [FQ, setFQ] = useState("");
  const [FQI, setFQI] = useState(0);
  const [focused, setFocused] = useState(false);

  const q = FQ.trim();
  /* live: one request per pause in typing (200 ms), not per key; fixture: at once, as the prototype */
  const [dq, setDq] = useState("");
  useEffect(() => {
    if (mode === "fixture") return;
    const t = setTimeout(() => setDq(q), 200);
    return () => clearTimeout(t);
  }, [q, mode]);
  const r = useApiRead(topSearch, state, mode === "fixture" ? q : dq);
  const res = r.state === "ok" ? r.data : null;
  const shown: SeatHit[] = res ? res.hits : [];
  const leads = shown.filter((h) => h.kind === "lead");
  const invs = shown.filter((h) => h.kind === "investor");
  /* the kind chip, where both kinds are in the list (D110: org seats search leads AND investors) */
  const both = leads.length > 0 && invs.length > 0;
  const order = [...leads, ...invs];
  const i0 = Math.min(FQI, Math.max(0, order.length - 1));
  const org = !!res && (res.book === "all" || (res.book === null && res.investorBook !== null && res.investorBook !== "own-book" && res.investorBook !== "own-lead"));
  const more = res ? res.more : 0;
  const open = !!q && focused;

  const fqClose = (blur: boolean) => {
    setFQ("");
    setFQI(0);
    if (blur) (document.getElementById("fq") as HTMLInputElement | null)?.blur();
  };
  /* fqOpen — the record, remembering where it was opened from. A lead opens its lead page; an investor
     (D110: org and Investors seats) opens its record on the Investors page. */
  const fqOpen = (h: SeatHit) => {
    if (h.kind === "investor") {
      fqClose(true);
      dispatch({ type: "im", a: { type: "go", v: "inv", id: h.id } });
      router.push("/inv");
      return;
    }
    const id = h.id as LeadId;
    /* fixture: only a lead the prototype's pool holds; live: the route already cut the hits to the book */
    if (mode === "fixture" && !fqPool(state).some((x) => x.id === id)) return;
    const onLead = typeof window !== "undefined" && window.location.pathname.startsWith("/leads/");
    const from = (onLead ? state.ui.FROM || "leads" : state.VIEW) as NavKey;
    fqClose(true);
    dispatch({ type: "go", v: "leads", id });
    dispatch({ type: "setUi", patch: { FROM: from } });
    router.push(`/leads/${encodeURIComponent(id)}`);
  };
  const fqKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!order.length) return;
      setFQI((i0 + (e.key === "ArrowDown" ? 1 : -1) + order.length) % order.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (order[i0]) fqOpen(order[i0]);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      fqClose(true);
    }
  };
  const opt = (h: SeatHit, i: number, children: ReactNode) => (
    <a
      className="d60b-opt"
      role="option"
      id={"fqo-" + i}
      key={h.kind + h.id}
      aria-selected={i === i0}
      data-id={h.id}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => fqOpen(h)}
      onMouseMove={() => (i === i0 ? null : setFQI(i))}
    >
      {children}
    </a>
  );

  return (
    <div
      className="btn d60b-find"
      id="findb"
      role="search"
      title="Find an investor (Ctrl/Cmd + K)"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("#fqlist")) document.getElementById("fq")?.focus();
      }}
    >
      <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="7.5" />
        <path d="m16 16 5 5" />
      </svg>
      <input
        id="fq"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="fqlist"
        aria-autocomplete="list"
        aria-activedescendant={open && order.length ? "fqo-" + i0 : undefined}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        placeholder="Find investor"
        aria-label="Find an investor by name, phone, email or city"
        aria-keyshortcuts="Control+K Meta+K"
        value={FQ}
        onChange={(e) => {
          setFQ(e.target.value);
          setFQI(0);
        }}
        onKeyDown={fqKey}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 0)}
      />
      <kbd aria-hidden="true">Ctrl K</kbd>
      <div id="fqlist" className="d60b-res" role="listbox" aria-label="Matching investors" hidden={!open}>
        {open ? (
          <>
            {r.state === "loading" || (mode !== "fixture" && dq !== q) ? <div className="d60b-none">Searching…</div>
              : r.state === "error" ? (
                <div className="d60b-none" role="alert">
                  {r.err.code === "term-too-short" ? "Keep typing — two letters or three digits." : r.err.error}
                </div>
              ) : res ? (
                <>
                  {res.book !== null ? <div className="d60b-hd">{LEAD_HEAD[res.book]}</div> : null}
                  {leads.map((h, i) => h.kind === "lead" ? opt(h, i, (() => {
                    const m = h.ownerId && state.PEOPLE[h.ownerId] ? fqTeamOf(state, h.ownerId) : null;
                    return (
                      <>
                        <div className="d60b-l1">
                          <b>{fqMark(h.name, FQ)}</b>
                          {h.phoneLast4 ? <span className="d60b-ph">•• {h.phoneLast4}</span> : null}
                          {both ? <span className="tag d60b-kind">Lead</span> : null}
                          {h.mine ? null : <span className="tag d60b-ro">View only</span>}
                        </div>
                        <div className="d60b-l2">
                          {h.stage ? <span className="tag">{h.stage}</span> : null}
                          <span className="d60b-own">
                            {h.ownerId ? (
                              state.PEOPLE[h.ownerId] ? (
                                <>
                                  {P(state.PEOPLE, h.ownerId).n}
                                  {org ? <span className="d60b-team"> · {m ? teamName(state.PEOPLE, m) : "No team"}</span> : null}
                                </>
                              ) : "Owned in Zoho"
                            ) : (
                              "No owner yet"
                            )}
                          </span>
                        </div>
                      </>
                    );
                  })()) : null)}
                  {res.book !== null && !leads.length ? (
                    <div className="d60b-none">
                      No investor matches “{q}”.{res.book === "yours" ? " Only your own book is searched." : ""}
                    </div>
                  ) : null}
                  {res.investorBook !== null && (invs.length || res.book === null) ? <div className="d60b-hd">{INV_HEAD[res.investorBook] ?? "Investors"}</div> : null}
                  {invs.map((h, j) => h.kind === "investor" ? opt(h, leads.length + j, (
                    <>
                      <div className="d60b-l1">
                        <b>{fqMark(h.name, FQ)}</b>
                        {h.phoneLast4 ? <span className="d60b-ph">•• {h.phoneLast4}</span> : null}
                        <span className="tag d60b-kind">Investor</span>
                      </div>
                      <div className="d60b-l2">
                        <span className="tag">{h.code}</span>
                        {h.city ? <span className="d60b-own">{h.city}</span> : null}
                      </div>
                    </>
                  )) : null)}
                  {res.investorBook !== null && res.book === null && !invs.length ? <div className="d60b-none">No investor matches “{q}”.</div> : null}
                </>
              ) : null}
            {more > 0 ? <div className="d60b-more">{more} more — keep typing to narrow it down</div> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
