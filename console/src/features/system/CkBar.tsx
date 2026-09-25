"use client";

/* ckBar() — 03-app.js:5277. Twenty-one days of one check, oldest on the left, each day carrying the
   date it stands for and what the record says the state was. */

import { CKDAYS, CKS } from "@/domain";
import type { Check } from "@/domain";
import { dLabel } from "@/lib/format";
import { ckHist } from "./checks";

export function CkBar({ c, NOW }: { c: Check; NOW: Date }) {
  return (
    <span className="hist" title={`${CKDAYS} days, oldest first`}>
      {ckHist(c, NOW).map((x, i) => (
        <i
          key={i}
          className={x.s === "ok" ? "" : x.s === "warn" ? "w" : "f"}
          title={`${dLabel(x.d)} — ${CKS[x.s].t}, from the dates on this check`}
        />
      ))}
    </span>
  );
}
