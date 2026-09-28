"use client";

/* HOW THE MERGE WORKS — merge-glue.js 155–229: panel("merge.notes") and its "try them" chips
   (mTry/mStep/mArrow). Opened from the rail foot's link (Rail.tsx), in fixture mode only
   (state.FIXTURES). Its content is prototype documentation about the demo people, so it is DATA
   that arrives with the demo book (Dataset.MERGENOTES → state.MERGENOTES, written in
   console/fixtures/merge-notes.ts); this file only renders blocks and holds no name. A chip signs
   in as that person and opens that page, on the side it names. */

import { Fragment, type ReactNode } from "react";
import type { NavKey } from "@/domain";
import type { NoteBlock, NoteRun, NoteStep } from "@/lib/data/types";
import { MT, navFor, P } from "@/lib/selectors";
import { signInAdmits } from "@/lib/data/admission";
import { reducer } from "@/lib/state";
import { useConsole, useSession } from "@/lib/store";
import { Pav } from "@/components/ui";
import { useRouter } from "next/navigation";
import { announceNav, pathOf, type View } from "@/components/shell/routes";
import { registerDrawer } from "./registry";

function MStep({ k, page, side, t }: NoteStep) {
  const { state, dispatch } = useConsole();
  const { signIn } = useSession();
  const router = useRouter();
  /* mTry(k,page,side) — merge-glue.js:163 */
  const mTry = () => {
    if (!signInAdmits({ PEOPLE: state.PEOPLE, GRANT: state.CAPS, im: state.IM }, k)) return;
    signIn(k);
    if (side) dispatch({ type: "setSide", k: page, s: side });
    const next = reducer(state, { type: "signIn", k });
    if (navFor(next).some((n) => n.k === page)) {
      dispatch({ type: "go", v: page as NavKey });
      announceNav(pathOf(page as View));
      router.push(pathOf(page as View));
    }
  };
  return (
    <a
      className="chip"
      role="button"
      tabIndex={0}
      onClick={mTry}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          mTry();
        }
      }}
      title={`Sign in as ${P(state.PEOPLE, k).n} and open ${MT[page] || page}`}
    >
      <Pav k={k} /> {t}
    </a>
  );
}

const MArrow = () => (
  <span className="sm" aria-hidden="true">
    →
  </span>
);

function Runs({ runs }: { runs: NoteRun[] }) {
  return (
    <>
      {runs.map((r, i) => (r.b ? <b key={i}>{r.t}</b> : <Fragment key={i}>{r.t}</Fragment>))}
    </>
  );
}

/** The blocks, rendered; `Step` is the chip (MStep in the console, swappable in tests). */
export function MergeBlocks({ blocks, Step = MStep }: { blocks: readonly NoteBlock[]; Step?: (s: NoteStep) => ReactNode }) {
  return (
    <div className="mn">
      {blocks.map((bl, i) => {
        switch (bl.kind) {
          case "h":
            return <h3 key={i}>{bl.t}</h3>;
          case "p":
            return (
              <p key={i}>
                <Runs runs={bl.runs} />
              </p>
            );
          case "table":
            return (
              <table key={i}>
                <thead>
                  <tr>
                    {bl.head.map((c, j) => (
                      <th key={j}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bl.rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, m) => (
                        <td key={m}>
                          <Runs runs={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "steps":
            return (
              <div className="steps" key={i}>
                {bl.steps.map((st, j) => (
                  <Fragment key={j}>
                    {j > 0 && <MArrow />}
                    <Step {...st} />
                  </Fragment>
                ))}
              </div>
            );
          case "ul":
            return (
              <ul key={i}>
                {bl.items.map((it, j) => (
                  <li key={j}>
                    <Runs runs={it} />
                  </li>
                ))}
              </ul>
            );
        }
      })}
    </div>
  );
}

function Body() {
  const { state } = useConsole();
  return <MergeBlocks blocks={state.MERGENOTES} />;
}

registerDrawer("p:merge.notes", { w: 640, ok: (state) => state.FIXTURES, title: () => "How the merge works", Body });
