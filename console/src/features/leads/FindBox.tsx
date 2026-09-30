"use client";

/* ── D60 b · FIND INVESTOR — the top-bar box. ir-merged.js 10898–10997, markup 2828–2831 ───────
   Typing lists the matches under it; Enter (or a press) opens one. It never moves you until you
   choose. The scope and the matching are `@/lib/selectors/find`; this is only the combobox. */

import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { LeadId, NavKey } from "@/domain";
import { LADDER } from "@/domain";
import { norm } from "@/lib/format";
import { digits, lost, numeric, P, teamName } from "@/lib/selectors";
import { FQMAX, fqFind, fqPhoneOK, fqPool, fqTeamOf, orgSearchScope } from "@/lib/selectors/find";
import { useConsole } from "@/lib/store";

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

export function FindBox() {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const [FQ, setFQ] = useState("");
  const [FQI, setFQI] = useState(0);
  const [focused, setFocused] = useState(false);

  const q = FQ.trim();
  const all = q ? fqFind(state, q) : [];
  const shown = all.slice(0, FQMAX);
  const FQHITS = shown.map((x) => x.l.id);
  const i0 = Math.min(FQI, Math.max(0, shown.length - 1));
  const org = orgSearchScope(state);
  const more = all.length - shown.length;
  const open = !!q && focused;

  const fqClose = (blur: boolean) => {
    setFQ("");
    setFQI(0);
    if (blur) (document.getElementById("fq") as HTMLInputElement | null)?.blur();
  };
  /* fqOpen — the lead page, remembering where it was opened from */
  const fqOpen = (id: LeadId) => {
    if (!fqPool(state).some((x) => x.id === id)) return;
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
      if (!FQHITS.length) return;
      setFQI((i0 + (e.key === "ArrowDown" ? 1 : -1) + FQHITS.length) % FQHITS.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (FQHITS[i0]) fqOpen(FQHITS[i0]);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      fqClose(true);
    }
  };

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
        aria-activedescendant={open && shown.length ? "fqo-" + i0 : undefined}
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
            <div className="d60b-hd">{org ? "All leads in the organisation" : "Your book"}</div>
            {shown.length ? (
              shown.map((x, i) => {
                const l = x.l;
                const d = fqPhoneOK(state, l) ? digits(l.ph) : "";
                const m = l.own ? fqTeamOf(state, l.own) : null;
                return (
                  <a
                    className="d60b-opt"
                    role="option"
                    id={"fqo-" + i}
                    key={l.id}
                    aria-selected={i === i0}
                    data-id={l.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => fqOpen(l.id)}
                    onMouseMove={() => (i === i0 ? null : setFQI(i))}
                  >
                    <div className="d60b-l1">
                      <b>{fqMark(l.n, FQ)}</b>
                      {d ? <span className="d60b-ph">•• {d.slice(-4)}</span> : null}
                      {x.mine ? null : <span className="tag d60b-ro">View only</span>}
                    </div>
                    <div className="d60b-l2">
                      <span className="tag">{lost(l) ? "Closed as lost" : LADDER[Math.max(0, l.done - 1)].t}</span>
                      <span className="d60b-own">
                        {l.own ? (
                          <>
                            {P(state.PEOPLE, l.own).n}
                            {org ? <span className="d60b-team"> · {m ? teamName(state.PEOPLE, m) : "No team"}</span> : null}
                          </>
                        ) : (
                          "No owner yet"
                        )}
                      </span>
                    </div>
                  </a>
                );
              })
            ) : (
              <div className="d60b-none">
                No investor matches “{q}”.{org ? "" : " Only your own book is searched."}
              </div>
            )}
            {more > 0 ? <div className="d60b-more">{more} more — keep typing to narrow it down</div> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
