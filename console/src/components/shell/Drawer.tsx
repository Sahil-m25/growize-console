"use client";

/* =================================================================================================
   THE DRAWER — one overlay for the whole product. 03-app.js 6157–6212, plus the key handling at
   7161–7198.

   Everything that used to open inline and push the page down opens here instead. On a wide screen
   it DOCKS as a third grid column, so the space beside a reading column becomes the place detail
   lives rather than dead air; below 1360px it slides over with a scrim and is a modal, and Tab
   stays inside it. The page behind never moves either way — that is the whole point: you never
   lose your place.
   ============================================================================================== */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canOpenDrawer, openable } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { Icon } from "@/components/ui";
import { useDocked } from "./useDocked";
import { drawerDef } from "./drawers";

/** DRAWERS[k].w defaults to 430 — the docked column's width. drwSync's `--dw`, 03-app.js:6206 */
export const DRW_DEFAULT_W = 430;

type PopoutRefs = { h2: HTMLElement; sub: HTMLElement; body: HTMLElement; foot: HTMLElement };

/* SEPARATE WINDOWS — popoutDrawer(), 03-app.js:11771-11800. The window owns no state of its own:
   it is a plain document with four containers, and the same React tree that fills the docked
   drawer is portalled into them instead, so every drawer re-render updates the window too.
   ponytail: no "browser blocked the pop-up" retry banner and no draft-recovery for the window the
   prototype gives a lost pop-up — a blocked window silently stays docked here. Add the banner if
   a user actually hits a popup blocker. */
function usePopout(openKey: string | null) {
  const [win, setWin] = useState<Window | null>(null);
  const [refs, setRefs] = useState<PopoutRefs | null>(null);
  const keyRef = useRef<string | null>(null);

  /* the window is about a specific drawer; a different drawer opening closes it rather than
     silently repainting it with somebody else's record */
  useEffect(() => {
    if (openKey === keyRef.current) return;
    keyRef.current = openKey;
    setWin((w) => {
      w?.close();
      return null;
    });
    setRefs(null);
  }, [openKey]);

  useEffect(
    () => () => {
      win?.close();
    },
    [win],
  );

  const open = () => {
    if (!openKey || typeof window === "undefined") return;
    if (win && !win.closed) {
      win.focus();
      return;
    }
    /* a phone has no windows — the bottom sheet this product already draws is the right thing */
    if (window.matchMedia("(max-width:760px)").matches) return;
    let w: Window | null = null;
    try {
      w = window.open(
        "",
        `gz_${openKey.replace(/[^a-z0-9]/gi, "_")}`,
        "popup=yes,width=430,height=760,resizable=yes,scrollbars=yes",
      );
    } catch {
      /* blocked — stays docked */
    }
    if (!w || w.closed || typeof w.document === "undefined") return;
    const doc = w.document;
    const theme = document.documentElement.getAttribute("data-theme");
    doc.open();
    doc.write(
      `<!doctype html><html lang="en"${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Growize</title>` +
        [...document.querySelectorAll('link[rel="stylesheet"]')].map((n) => n.outerHTML).join("") +
        (document.querySelector("style")?.outerHTML ?? "") +
        `</head><body class="ux-refined ux-redesign"><div class="pop"><header class="drwh">` +
        `<div class="drw-heading"><h2 id="pop-h"></h2><div class="sub" id="pop-sub"></div></div></header>` +
        `<div class="drwb" id="pop-body"></div><footer class="drwf" id="pop-foot" hidden></footer></div></body></html>`,
    );
    doc.close();
    const h2 = doc.getElementById("pop-h");
    const sub = doc.getElementById("pop-sub");
    const body = doc.getElementById("pop-body");
    const foot = doc.getElementById("pop-foot");
    if (!h2 || !sub || !body || !foot) {
      w.close();
      return;
    }
    w.addEventListener("pagehide", () => {
      setWin(null);
      setRefs(null);
    });
    setRefs({ h2, sub, body, foot });
    setWin(w);
  };

  return { popped: !!(win && !win.closed && refs), refs, open };
}

export function Drawer() {
  const { state, dispatch } = useConsole();
  const docked = useDocked();
  const ref = useRef<HTMLElement | null>(null);
  /* the id of the control that opened it, so focus goes back there — DRWRET, 03-app.js:6159 */
  const ret = useRef<string | null>(null);
  const openKey = state.DRW ? `${state.DRW.k}|${state.DRW.id ?? ""}` : null;
  const popout = usePopout(openKey);

  const DRW = state.DRW;
  const d = DRW ? drawerDef(DRW.k) : undefined;
  /* drwLead() — a drawer is about one lead unless it says otherwise. 03-app.js:6179 */
  const lead = DRW && DRW.id ? (state.LEADS.find((x) => x.id === DRW.id) ?? null) : null;

  /* drwCheck() — the one place a drawer is invalidated: its key is unknown, or its record is no
     longer reachable. 03-app.js:6181 */
  let stale = false;
  if (DRW) {
    if (!d || !canOpenDrawer(state, DRW.k, DRW.id)) stale = true;
    else if (d.lead && !(DRW.id && openable(state).some((x) => x.id === DRW.id))) stale = true;
    else if (d.ok && !d.ok(state, DRW.id)) stale = true;
  }

  useEffect(() => {
    if (stale) dispatch({ type: "closeDrawer" });
  }, [stale, dispatch]);

  /* was a drawer open on the previous commit? Without this the close branch below would run on
     the very first render and steal focus into the pane before anybody had opened anything. */
  const wasOpen = useRef(false);

  /* DRWJUST — just opened: move focus into it once, then leave focus alone. 03-app.js:7085 */
  useEffect(() => {
    if (!openKey) {
      if (!wasOpen.current) return;
      wasOpen.current = false;
      /* back where it was opened from; if that control has since gone, the pane itself takes
         focus. 03-app.js:6173 */
      const n =
        (ret.current && document.getElementById(ret.current)) || document.getElementById("pane");
      if (n) {
        if (n.id === "pane") n.setAttribute("tabindex", "-1");
        n.focus();
      }
      ret.current = null;
      return;
    }
    wasOpen.current = true;
    const active = document.activeElement as HTMLElement | null;
    if (active && active.id && !ref.current?.contains(active)) ret.current = active.id;
    const root = ref.current;
    const n =
      root?.querySelector<HTMLElement>(".drwb select,.drwb input,.drwb textarea,.drwb button") ??
      document.getElementById("drwx");
    if (n) n.focus();
  }, [openKey]);

  /* Escape always closes the drawer, wherever the caret is; and while it is a modal — the narrow
     layout, where it covers the page — Tab stays inside it. 03-app.js:7164 */
  useEffect(() => {
    if (!openKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dispatch({ type: "closeDrawer" });
        return;
      }
      if (e.key !== "Tab" || docked) return;
      const root = ref.current;
      if (!root) return;
      const f = [
        ...root.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openKey, docked, dispatch]);

  if (!DRW || !d || stale) return null;
  if (d.lead && !lead) return null;

  const a = { id: DRW.id, lead };
  const t = d.title(state, a);
  const sub = d.sub ? d.sub(state, a) : "";
  const { Body, Foot } = d;

  /* popped out: the window IS the drawer now, so the docked copy stands down rather than showing
     the same record twice. Closing the window (pagehide, above) brings the docked copy straight
     back, because nothing here ever cleared DRW. */
  if (popout.popped && popout.refs) {
    popout.refs.foot.hidden = !Foot;
    return (
      <>
        {createPortal(t, popout.refs.h2)}
        {createPortal(sub || null, popout.refs.sub)}
        {createPortal(<Body {...a} />, popout.refs.body)}
        {Foot ? createPortal(<Foot {...a} />, popout.refs.foot) : null}
      </>
    );
  }

  return (
    <>
      {docked ? null : (
        <div className="scrim" onClick={() => dispatch({ type: "closeDrawer" })} />
      )}
      <aside
        ref={ref}
        className="drw"
        id="drw"
        role="dialog"
        aria-modal={docked ? "false" : "true"}
        aria-label={t}
        style={{ ["--dw" as string]: `${d.w ?? DRW_DEFAULT_W}px` }}
      >
        <header className="drwh">
          <div className="drw-heading">
            <h2>{t}</h2>
            {sub ? <div className="sub">{sub}</div> : null}
          </div>
          <div className="drw-header-actions">
            <button
              type="button"
              className="drwx"
              onClick={popout.open}
              aria-label="Open this panel in a separate window"
              title="Open this panel in a separate window"
            >
              <Icon name="external" />
            </button>
            <button
              type="button"
              className="drwx"
              id="drwx"
              onClick={() => dispatch({ type: "closeDrawer" })}
              aria-label={`Close “${t}”`}
              title={`Close “${t}” (Esc)`}
            >
              <Icon name="x" />
            </button>
          </div>
        </header>
        <div className="drwb">
          <Body {...a} />
        </div>
        {Foot ? (
          <footer className="drwf">
            <Foot {...a} />
          </footer>
        ) : null}
      </aside>
    </>
  );
}
