"use client";

/* ── the status line — ir-merged.js 10858 (say) and 10866 (sayLast). Every write ends in a log
   line, so the announcement is taken from the log: a path that records something cannot be silent,
   and one that records nothing cannot claim it did. A write that did not happen has no line, so it
   says so itself (`say`, from commit()'s refusal and queue branches, ir-merged.js 2373 / 2413).
   Mounted by the lead page; the prototype's `#live` sits in the shell. ─────────────────────── */

import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "@/domain";
import { logNote, openable } from "@/lib/selectors";
import { useConsole } from "@/lib/store";

const listeners = new Set<(m: string) => void>();
export function say(msg: string): void { listeners.forEach((f) => f(msg)); }

export function Live() {
  const { state } = useConsole();
  const [msg, setMsg] = useState("");
  const saidLast = useRef<LogEntry | null | undefined>(undefined);
  useEffect(() => {
    const f = (m: string) => { setMsg(""); setTimeout(() => setMsg(m), 60); };
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  const top = state.LOG[0] || null;
  useEffect(() => {
    if (saidLast.current === undefined) { saidLast.current = top; return; }
    if (!top || top === saidLast.current) return;
    const fresh: LogEntry[] = [];
    for (let i = 0; i < state.LOG.length && i < 4 && state.LOG[i] !== saidLast.current; i++) fresh.unshift(state.LOG[i]);
    saidLast.current = top;
    const ids = new Set(openable(state).map((l) => l.id));
    const allowed = fresh.filter((e) => e.who === state.WHO && (!e.lead || ids.has(e.lead)));
    if (!allowed.length) return;
    say(allowed.map((e) => {
      const l = e.lead ? state.LEADS.find((x) => x.id === e.lead) : null;
      const n = logNote(state, e);
      return e.what + (l ? " — " + l.n : "") + (n ? ", " + n : "");
    }).join(". ") + ". Recorded " + allowed[allowed.length - 1].at + ".");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top]);
  return <div id="live" className="vh" role="status" aria-live="polite" aria-atomic="true">{msg}</div>;
}
