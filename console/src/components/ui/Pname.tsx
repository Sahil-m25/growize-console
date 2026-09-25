"use client";

/* A badge and the name beside it — the prototype's pname(). 03-app.js 32–34. */

import type { ReactNode } from "react";
import type { PersonKey } from "@/domain";
import { P } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { Pav, type PavSize } from "./Pav";

export function Pname({
  k,
  b,
  nw,
  first,
  cls,
  size,
  hl,
}: {
  k: PersonKey;
  /** pname's `o.b` — the name in semibold */
  b?: boolean;
  /** pname's `o.nw` — never wrap the name */
  nw?: boolean;
  /** pname's `o.first` — the first name only */
  first?: boolean;
  cls?: string;
  size?: PavSize;
  /** pname's `o.hl` — the name already marked up by the Leads search */
  hl?: ReactNode;
}) {
  const { state } = useConsole();
  const n = P(state.PEOPLE, k).n;
  return (
    <span className={`pnm ${b ? "b" : ""}`}>
      <Pav k={k} cls={cls} size={size} />
      <span className={`pnt ${nw ? "nw" : ""}`}>
        {hl != null ? hl : first ? String(n).split(" ")[0] : n}
      </span>
    </span>
  );
}
