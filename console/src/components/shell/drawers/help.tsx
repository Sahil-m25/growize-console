"use client";

/* HELP — DRAWERS.help, 03-app.js 6881–6910.

   Opened by the ? in the top bar or by pressing ? anywhere, and always about the screen you are on:
   DRW.id is the view key. Below the screen's own note, the two things that are true everywhere —
   what the glyphs and the colours mean — and the answers, searchable. */

import { FAQ, HELP } from "@/domain";
import type { PersonKey } from "@/domain";
import { accountAllowed, mgrOf, P } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { ActLegend } from "@/components/ui";
import { rich } from "../rich";
import { registerDrawer, type DrawerProps } from "./registry";

type HelpEntry = { t: string; p: string; b?: string[] };
const HELPMAP = HELP as unknown as Record<string, HelpEntry | undefined>;
const FAQLIST = FAQ as unknown as readonly { q: string; a: string }[];

/* An Investors-side screen has no entry of its own yet: say so plainly rather than describe "My day" (B-24). */
const IM_FALLBACK: HelpEntry = {
  t: "Investors",
  p: "This screen belongs to the Investors side. Use the left rail to move between investors, payments, documents and the team. Everything shown is read from Zoho as you, so what you see is what your seat may see.",
};

function Body({ id }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const h = HELPMAP[id ?? state.VIEW] ?? HELPMAP[state.VIEW] ?? (accountAllowed(state) ? (HELPMAP.today as HelpEntry) : IM_FALLBACK);
  const HQ = state.ui.HQ;
  const q = (HQ || "").trim().toLowerCase();
  const fq = FAQLIST.filter((x) => !q || (x.q + " " + x.a).toLowerCase().indexOf(q) >= 0);

  return (
    <>
      <p className="lbl" style={{ marginTop: 0 }}>
        On this screen
      </p>
      <p style={{ fontSize: "var(--text-body)", lineHeight: 1.55, margin: "0 0 10px" }}>{rich(h.p)}</p>
      {h.b && h.b.length ? (
        <div className="ticks">
          {h.b.map((x, i) => (
            <div className="tk on" key={i}>
              <span className="box">✓</span>
              <span className="t">{rich(x)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <details className="ux-disclosure">
        <summary>Symbols and status colours</summary>
        <div className="ux-section">
          <p className="sm" style={{ margin: "0 0 7px" }}>
            A colour is a person; a glyph is a kind of action; green, amber and red only ever mean
            whether a lead is in trouble.
          </p>
          <ActLegend />
          <div className="leg" style={{ marginTop: "9px" }}>
            <span>
              <span className="rag green" />
              on track
            </span>
            <span>
              <span className="rag amber" />
              slipping
            </span>
            <span>
              <span className="rag red" />
              breached
            </span>
          </div>
        </div>
      </details>

      <div className="drwsec">
        <p className="lbl">Find an answer</p>
        <input
          className="inp"
          id="hq"
          aria-label="Find an answer"
          style={{ width: "100%", marginBottom: "8px" }}
          placeholder="Search the answers…"
          value={HQ}
          onChange={(e) => dispatch({ type: "setUi", patch: { HQ: e.target.value } })}
        />
        {fq.length ? (
          fq.map((x) => (
            <details className="faq" key={x.q}>
              <summary>{x.q}</summary>
              <p>{rich(x.a)}</p>
            </details>
          ))
        ) : (
          <p className="sm" style={{ margin: 0 }}>
            Nothing matches “{HQ}”. Ask{" "}
            {mgrOf(state.PEOPLE, state.WHO) ? <>{P(state.PEOPLE, mgrOf(state.PEOPLE, state.WHO)!).n}, or </> : null}
            Digital Infrastructure if it looks like the console itself is wrong.
          </p>
        )}
      </div>
    </>
  );
}

function Foot(_: DrawerProps) {
  return (
    <span className="sm">
      Esc closes this. <span className="kbd">?</span> in the top bar opens it wherever you are.
    </span>
  );
}

registerDrawer("help", {
  w: 440,
  title: () => "Help",
  sub: (state, a) => (HELPMAP[a.id ?? state.VIEW] ?? {}).t ?? "How this works",
  Body,
  Foot,
});
