/**
 * My badge — colour, shape and initials — kept per person in the console's own shared state store (Plane C side, J15),
 * never in Zoho (the Zoho User has no field for it, and it is a UI preference, not a business fact). Only my own entry
 * is ever written: the id comes from the signed-in session, never from the request. Nothing here is a record (rule 1):
 * three short values keyed by a Zoho user id.
 */

import type { SharedState } from "../state/shared-state";

export interface MyStyle { readonly c?: number; readonly sq?: boolean; readonly i?: string }
export type StyleResult =
  | { readonly ok: true; readonly value: MyStyle }
  | { readonly ok: false; readonly reasonCode: "invalid-request" | "invalid-colour" | "invalid-initials" | "unavailable"; readonly reason: string };

const USER_ID = /^\d{15,25}$/;
const REASON = {
  "invalid-request": "the request is invalid",
  "invalid-colour": "pick one of the eight badge colours",
  "invalid-initials": "initials are letters and numbers, one or two of them",
  unavailable: "the console could not keep the change, try again",
} as const;
const keyOf = (userId: string) => `me-style|${userId}`;

/** Parse what was stored; anything that is not exactly our three fields is dropped. */
function parse(raw: string | null): MyStyle {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...(typeof o.c === "number" && Number.isInteger(o.c) && o.c >= 1 && o.c <= 8 ? { c: o.c } : {}),
      ...(typeof o.sq === "boolean" ? { sq: o.sq } : {}),
      ...(typeof o.i === "string" && /^[A-Z0-9]{1,2}$/.test(o.i) ? { i: o.i } : {}),
    };
  } catch { return {}; }
}

export function createStyle(deps: { readonly state: SharedState }) {
  const { state } = deps;
  const refuse = (reasonCode: keyof typeof REASON): StyleResult => ({ ok: false, reasonCode, reason: REASON[reasonCode] });
  const get = async (userId: string): Promise<MyStyle> => {
    if (!USER_ID.test(userId)) return {};
    try { return parse(await state.get(keyOf(userId))); } catch { return {}; }
  };
  return Object.freeze({
    get,
    /** Everyone's badge for the people list (a failed read answers nothing for that person, never a guess). */
    async getMany(userIds: readonly string[]): Promise<Readonly<Record<string, MyStyle>>> {
      const out: Record<string, MyStyle> = {};
      const ids = userIds.slice(0, 500);
      for (let i = 0; i < ids.length; i += 16) { // bounded fan-out: one state read per person
        await Promise.all(ids.slice(i, i + 16).map(async (id) => { const s = await get(id); if (Object.keys(s).length) out[id] = s; }));
      }
      return out;
    },
    /** Merge a change into MY entry. `userId` is the session's own id. */
    async set(userId: string, change: { readonly c?: unknown; readonly sq?: unknown; readonly i?: unknown }): Promise<StyleResult> {
      if (!USER_ID.test(userId) || !change || typeof change !== "object") return refuse("invalid-request");
      const next: { c?: number; sq?: boolean; i?: string } = {};
      if (change.c !== undefined) {
        const c = typeof change.c === "number" ? Math.round(change.c) : NaN;
        if (!(c >= 1 && c <= 8)) return refuse("invalid-colour");
        next.c = c;
      }
      if (change.sq !== undefined) {
        if (typeof change.sq !== "boolean") return refuse("invalid-request");
        next.sq = change.sq;
      }
      if (change.i !== undefined) {
        const i = typeof change.i === "string" ? change.i.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2) : "";
        if (!i) return refuse("invalid-initials");
        next.i = i;
      }
      if (!Object.keys(next).length) return refuse("invalid-request");
      try {
        const merged = { ...parse(await state.get(keyOf(userId))), ...next };
        await state.set(keyOf(userId), JSON.stringify(merged));
        return { ok: true, value: merged };
      } catch { return refuse("unavailable"); }
    },
  });
}
