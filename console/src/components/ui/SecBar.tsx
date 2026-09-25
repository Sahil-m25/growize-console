"use client";

/* SECTIONS, ONE AT A TIME — the prototype's secBar(). 03-app.js 4061–4072.

   A wide screen is not a licence to run two unrelated stacks of cards down it: two stacks have no
   reading order between them, so the eye zig-zags and nothing is ever finished. Instead a row of
   section chips, and two or three full-width cards on ONE topic at a time. Which section you were
   last on is remembered per screen. */

import { secOf, useConsole } from "@/lib/store";

export type Section = { k: string; t: string; n?: number | string; warn?: boolean };

export function SecBar({ v, list }: { v: string; list: readonly Section[] }) {
  const { state, dispatch } = useConsole();
  const cur = secOf(state, v, list);
  return (
    <div className="secbar" role="tablist" aria-label="Sections">
      {list.map((x) => (
        <button
          type="button"
          key={x.k}
          className={`sc ${cur === x.k ? "on" : ""}`}
          role="tab"
          aria-selected={cur === x.k ? "true" : "false"}
          id={`sec-${v}-${x.k}`}
          onClick={() => {
            dispatch({ type: "setSec", view: v, k: x.k });
            /* setSec() puts the section column back at the top — you are on a new topic */
            const n = document.querySelector(".secw");
            if (n) n.scrollTop = 0;
          }}
        >
          {x.t}
          {x.n ? <i className={x.warn ? "warn" : ""}>{x.n}</i> : null}
        </button>
      ))}
    </div>
  );
}
