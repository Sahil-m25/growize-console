"use client";

/* ── one row of tiles that each pop a panel — doorRow(items), ir-console-redesigned.html:2522.
   `Doors` in `@/features/lead` is the same idea wired to `leadDoors()` and a lead id; this is the
   id-less version the weekly card uses to open `today.closers` / `today.owed` / `today.why`
   (registered in `./panels`). ────────────────────────────────────────────────────────────────── */

import type { IconName } from "@/components/ui";
import { Icon } from "@/components/ui";
import { useConsole } from "@/lib/store";
import type { DrawerKind } from "@/lib/store";

export type DoorItem = { k: string; t: string; i?: IconName; v: string; cls?: string } | null;

export function DoorRow({ items }: { items: DoorItem[] }) {
  const { state, dispatch } = useConsole();
  const open = (k: string) => state.DRW?.k === `p:${k}`;
  const shown = items.filter((x): x is NonNullable<DoorItem> => !!x);
  if (!shown.length) return null;
  return (
    <div className="doors">
      {shown.map((x) => (
        <button
          type="button"
          key={x.k}
          className={`door ${open(x.k) ? "on" : ""}`}
          id={`door-${x.k.replace(/\./g, "-")}`}
          aria-haspopup="dialog"
          aria-expanded={open(x.k) ? "true" : "false"}
          onClick={() => dispatch({ type: "openDrawer", k: `p:${x.k}` as DrawerKind })}
        >
          <span className="dt">
            {x.i ? <Icon name={x.i} /> : null}
            {x.t}
          </span>
          <span className={`dv ${x.cls || ""}`}>{x.v}</span>
        </button>
      ))}
    </div>
  );
}
