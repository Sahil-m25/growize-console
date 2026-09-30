"use client";

/* =================================================================================================
   THE STORE — the prototype's global mutable object graph, plus draw(), expressed as one React
   context and one reducer.

   The prototype is a set of global records and eighty free functions that mutate them and call
   draw(). Here: one immutable state object, one reducer whose cases are named after those very
   mutators, and a provider mounted once in app/layout.tsx. Nothing is persisted in the browser.

   The records are not in this file. They arrive through the one data interface (@/lib/data):
   the provider hydrates from GET /api/data — the empty book by default, the demo book only in
   FIXTURE_MODE=local — and nobody is signed in until the session says so (GET /api/session) or a
   person is pressed on the sign-in screen. The clock comes with the data, as Kolkata wall time,
   and is never read from new Date() at render time.
   ============================================================================================== */

import {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export * from "./state";
import { reducer, initialState, LEAD_WRITES } from "./state";
import type { Action, ConsoleState } from "./state";
import type { SaveEntry, SaveResult } from "./save-queue";
import { createConsoleWriter } from "./console-save";
import { ApiModeProvider } from "@/lib/data/api";
import { installErrorBeacon, sendErrorBeacon } from "@/lib/zoho/error-beacon";
import { consoleAccount, scopeOf } from "@/lib/selectors";
import { pinClock } from "@/lib/format";
import type { Ctx as SelectorCtx } from "@/lib/selectors";
import type { DataPayload } from "@/lib/data/types";
import type { Session } from "@/lib/data/session";
import type { Lead, Person, PersonKey, Scope, SeatKey } from "@/domain";
import type { SignOutWhy } from "@/domain";

type ConsoleCtx = {
  state: ConsoleState;
  dispatch: (action: Action) => SaveResult | undefined;
  saves: SaveEntry[];
  browserOnline: boolean | null;
  lastLocalUpdate: number | null;
  retrySave: (key: string) => void;
  /** M01-S03: when the last GET /api/data succeeded (epoch ms, null before the first), and whether
   *  the most recent one failed; reloadData() reads it again */
  dataRead: { at: number | null; failed: boolean };
  reloadData: () => void;
};

const Ctx = createContext<ConsoleCtx | null>(null);

export function ConsoleProvider({ children, initial }: { children: ReactNode; initial?: DataPayload }) {
  const [state, setState] = useState(() => {
    const s0 = initialState();
    if (!initial) return s0;
    pinClock(initial.ds.CLOCKPIN);
    return reducer(s0, { type: "hydrate", ds: initial.ds, version: initial.version, fixtures: initial.fixtures });
  });
  const stateRef = useRef(state), sessionRef = useRef(0), onlineRef = useRef(false);
  const [saves, setSaves] = useState<SaveEntry[]>([]);
  const [browserOnline, setBrowserOnline] = useState<boolean | null>(null);
  const [lastLocalUpdate, setLastLocalUpdate] = useState<number | null>(null);
  const [dataRead, setDataRead] = useState<{ at: number | null; failed: boolean }>({ at: null, failed: false });
  const loadRef = useRef<() => Promise<unknown>>(() => Promise.resolve(null));
  /* the first paint's records came with the page (the same payload GET /api/data serves): that read
     succeeded when the page arrived, so it counts as the last good read until the next one */
  const hadInitial = useRef(!!initial);
  useEffect(() => {
    if (hadInitial.current) setDataRead(d => (d.at == null ? { ...d, at: Date.now() } : d));
  }, []);
  const [writer] = useState(() => createConsoleWriter({
    clock: Date.now,
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    isOnline: () => onlineRef.current,
    currentSession: () => consoleAccount(stateRef.current.PEOPLE, stateRef.current.WHO, stateRef.current.CAPS)
      ? { actor: stateRef.current.WHO, session: sessionRef.current } : null,
    read: () => stateRef.current,
    write: next => {
      if (next.WHO !== stateRef.current.WHO) { sessionRef.current++; setLastLocalUpdate(null); }
      stateRef.current = next;
      setState(next);
    },
    reduce: reducer,
    leadWrites: LEAD_WRITES,
    onChange: change => {
      setSaves(change.entries);
      if (change.kind === "completed") setLastLocalUpdate(Date.now());
      /* M18-S04-W1: a save the queue gave up on feeds the failed-saves alert (≥3 in 10 minutes). Only the source and the
         page route go — never the message or the typed text (error-beacon allow-list). Live mode only: the demo book has no Zoho. */
      if (change.kind === "failed" && !stateRef.current.FIXTURES && typeof window !== "undefined")
        sendErrorBeacon({ source: "save-failed", route: window.location.pathname });
    },
  }));
  /* THE DATA HALF AND THE SESSION. Records arrive from GET /api/data (one interface, @/lib/data);
     the person from the session cookie (GET /api/session). In fixture mode the page also polls the
     applied-fixture version every 250 ms and re-hydrates when it moves, so a fixture the UI-case
     runner applies after page load changes the screens under it (who is signed in, the route, the
     open drawer and every draft are kept). */
  useEffect(() => {
    let dead = false, busy = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    /* a fixture's client actions arrive with every load while it stays applied; each runs once
       (a fresh load of "/" clears the fixtures and remounts this provider, so the set starts empty) */
    const ran = new Set<string>();
    const load = async (): Promise<DataPayload | null> => {
      const r = await fetch("/api/data", { cache: "no-store" }).catch(() => null);
      if (dead) return null;
      const p = r && r.ok ? ((await r.json().catch(() => null)) as DataPayload | null) : null;
      if (dead) return null;
      if (!p) { setDataRead(d => ({ ...d, failed: true })); return null; }
      setDataRead({ at: Date.now(), failed: false });
      pinClock(p.ds.CLOCKPIN);
      writer.apply({ type: "hydrate", ds: p.ds, version: p.version, fixtures: p.fixtures });
      for (const x of p.actions as { fx: string; a: Action }[]) {
        if (!x || ran.has(x.fx)) continue;
        ran.add(x.fx);
        if (x.a.type === "fixture" && x.a.k === "offline") {
          /* BROWSER_OFFLINE — the prototype's own fixture: the browser says it lost its connection */
          Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
          window.dispatchEvent(new Event("offline"));
        } else writer.apply(x.a);
      }
      return p;
    };
    loadRef.current = load;
    void (async () => {
      const [p, sess] = await Promise.all([
        load(),
        fetch("/api/session", { cache: "no-store" }).then((r) => r.json() as Promise<{ session: Session | null }>).catch(() => ({ session: null })),
      ]);
      if (dead) return;
      if (sess.session && !stateRef.current.authed) {
        writer.apply({ type: "signIn", k: sess.session.who });
        /* a session this book no longer admits is not a session */
        if (!stateRef.current.authed) void fetch("/api/session", { method: "DELETE" }).catch(() => {});
      }
      if (p?.fixtures) {
        timer = setInterval(() => {
          if (busy) return;
          busy = true;
          void fetch("/api/data/version", { cache: "no-store" })
            .then((r) => (r.ok ? (r.json() as Promise<{ version: number }>) : null))
            .then((v) => (v && v.version !== stateRef.current.DATAVER ? load() : null))
            .catch(() => null)
            .finally(() => { busy = false; });
        }, 250);
      }
    })();
    return () => {
      dead = true;
      if (timer) clearInterval(timer);
    };
  }, [writer]);
  /* M18-S04-W1: uncaught errors and unhandled rejections in the browser reach Plane B (live mode, once a payload has said so) */
  const beaconOn = dataRead.at !== null && !state.FIXTURES;
  useEffect(() => (beaconOn ? installErrorBeacon() : undefined), [beaconOn]);
  useEffect(() => {
    const connection = () => {
      onlineRef.current = navigator.onLine;
      setBrowserOnline(onlineRef.current);
      if (onlineRef.current) writer.reconnect();
    };
    connection();
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    return () => {
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      writer.reset();
    };
  }, [writer]);
  const value = useMemo(() => ({ state, dispatch: writer.apply, saves, browserOnline, lastLocalUpdate,
    retrySave: (key: string) => { writer.retry(key); },
    dataRead, reloadData: () => { void loadRef.current(); },
  }), [state, writer, saves, browserOnline, lastLocalUpdate, dataRead]);
  /* phase 2b (D104): a wired screen's reads and writes go through @/lib/data/api, which serves the demo book
     only when the hydrated payload says fixture mode — otherwise the /api routes */
  return <Ctx.Provider value={value}><ApiModeProvider fixtures={state.FIXTURES}>{children}</ApiModeProvider></Ctx.Provider>;
}

export function useConsole(): ConsoleCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConsole must be used inside <ConsoleProvider>");
  return c;
}

/* ---- convenience hooks, all client-side ------------------------------------------------------- */

export function useMe(): Person {
  const { state } = useConsole();
  return state.PEOPLE[state.WHO];
}

export function useRole(): SeatKey {
  return useConsole().state.ROLE;
}

export function useLeads(): Lead[] {
  return useConsole().state.LEADS;
}

/* The one place the store and the selectors meet. Every selector in the shell is called with this. */
export function useCtx(): SelectorCtx {
  return useConsole().state;
}

/* scopeOf(v) — 03-app.js:1345. A seat that cannot see a team is always "mine", whatever SC says. */
export function useScope(view: "today" | "leads" | "activity"): Scope {
  const { state } = useConsole();
  return scopeOf(state, view);
}

/* ---- section tabs — secOf, 03-app.js:4062 ------------------------------------------------------
   Which section you were last on is remembered per screen, so leaving and coming back does not lose
   your place. An unknown or stale key falls back to the first section in the list. */
export function secOf(state: ConsoleState, v: string, list: readonly { k: string }[]): string {
  const ok = list.map((x) => x.k);
  const cur = state.SEC[v];
  return cur !== undefined && ok.indexOf(cur) >= 0 ? cur : (ok[0] ?? "");
}

/* ---- the doors — signIn(k) / signOut(why), ir-merged.js 11072-11075 ----------------------------
   The client keeps WHO in state the moment the person is pressed (the UI-case runner waits only a
   few hundred milliseconds); the session cookie follows in the background. */
export function useSession(): { signIn: (k: PersonKey) => void; signOut: (why?: SignOutWhy) => void } {
  const { dispatch } = useConsole();
  return useMemo(() => ({
    signIn: (k: PersonKey) => {
      dispatch({ type: "signIn", k });
      void fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ who: k }) }).catch(() => {});
    },
    signOut: (why?: SignOutWhy) => {
      dispatch({ type: "signOut", why });
      void fetch("/api/session", { method: "DELETE" }).catch(() => {});
    },
  }), [dispatch]);
}

