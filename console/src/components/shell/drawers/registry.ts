"use client";

/* =================================================================================================
   THE DRAWER REGISTRY — the prototype's DRAWERS object. 03-app.js 6214–6998.

   "every drawer body in one registry, so a screen opens one by name and nothing else has to know
   how a drawer works. `lead:true` means the drawer is about a record and closes itself if that
   record goes out of reach."

   The shell owns the frame, the docked/overlay behaviour, the open/close/sync logic and the routing
   to a body. It draws the three bodies that are the shell's own — presence, help and absence. The
   other twenty-one are per-page and belong to the page agents, who register them from their own
   feature module:

       // src/features/lead/drawers.ts
       "use client";
       import { registerDrawer } from "@/components/shell/drawers/registry";
       registerDrawer("forecast", { lead: true, w: 430, title: (s, a) => a.lead!.n, Body, Foot });

   and import that module from the feature's client entry so the registration runs before the
   drawer can be opened. A kind that is not registered opens nothing and closes itself, which is
   exactly what the prototype's `if(!DRAWERS[k]) return;` does.

   `title` and `sub` are strings, not nodes, because the prototype's `t` and `sub` always are —
   the title is also the dialog's aria-label, and an aria-label cannot be an element.
   ============================================================================================== */

import { createElement, type ComponentType } from "react";
import type { Lead } from "@/domain";
import type { ConsoleState, DrawerKind } from "@/lib/store";
import { useConsole } from "@/lib/store";
import { canOpenDrawer } from "@/lib/selectors";

/* what every part of a drawer is handed: the id it was opened with, and — for a `lead` drawer —
   the record itself, already looked up and already known to be reachable */
export type DrawerProps = {
  id: string | null;
  lead: Lead | null;
};

export type DrawerDef = {
  /** DRAWERS[k].w — the docked column's width in px. 430 when unset, as the prototype. */
  w?: number;
  /** DRAWERS[k].lead — this drawer is about a lead record and closes if it goes out of reach */
  lead?: boolean;
  /** DRAWERS[k].ok — a drawer about anything else says when it is stale */
  ok?: (state: ConsoleState, id: string | null) => boolean;
  /** DRAWERS[k].t — the <h2> in the header, and the dialog's aria-label */
  title: (state: ConsoleState, a: DrawerProps) => string;
  /** DRAWERS[k].sub — the line under it */
  sub?: (state: ConsoleState, a: DrawerProps) => string;
  /** DRAWERS[k].body */
  Body: ComponentType<DrawerProps>;
  /** DRAWERS[k].foot */
  Foot?: ComponentType<DrawerProps>;
};

const DRAWERS: Partial<Record<DrawerKind, DrawerDef>> = {};

export function registerDrawer(k: DrawerKind, def: DrawerDef): void {
  const protect = (Body: ComponentType<DrawerProps>): ComponentType<DrawerProps> => props => {
    const {state} = useConsole(), id = props.id || props.lead?.id || null;
    if (!canOpenDrawer(state,k,id)) return createElement("div",{className:"empty"},"This drawer is unavailable.");
    return createElement(Body,{key:`${state.WHO}:${id}`,id,lead:id ? state.LEADS.find(l=>l.id === id) || null : null});
  };
  const readable = (state: ConsoleState, props: DrawerProps) => {
    const id=props.id || props.lead?.id || null;
    return canOpenDrawer(state,k,id) ? {id,lead:state.LEADS.find(l=>l.id === id) || null} : null;
  };
  DRAWERS[k] = def.lead ? {...def,Body:protect(def.Body),...(def.Foot ? {Foot:protect(def.Foot)} : {}),
    title:(state,props)=>{const a=readable(state,props);return a ? def.title(state,a) : "Unavailable";},
    sub: def.sub ? (state,props)=>{const a=readable(state,props);return a ? def.sub!(state,a) : "Unavailable";} : undefined} : def;
}

export function drawerDef(k: DrawerKind): DrawerDef | undefined {
  return DRAWERS[k];
}

/** every kind that has a body right now — the shell's three, plus whatever the pages registered */
export function registeredKinds(): DrawerKind[] {
  return Object.keys(DRAWERS) as DrawerKind[];
}
