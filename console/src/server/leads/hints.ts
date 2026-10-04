/**
 * M12-S11-T03 — THE IR'S WORD beside Finance's queue: "they say it's signed", read by lead and matched to the ONE
 * document it is about.
 *
 * A hint is the round's said stamp the IR wrote from the lead page row (server/leads/paperwork.ts ROUND_FIELDS:
 * <round>_Said_At / _Said_By on the Lead — PROPOSED fields, M12-S11-T01). It is what the investor told the IR, not
 * a signature (D72): only Zoho Sign's completion or Finance's verification makes one, and a verified paper carries
 * no hint. Read on the reader's own token (D53; Finance reads IR-owned leads through the sharing rule T01 asks for).
 *
 * Matching fixes the prototype, which showed a supplementary note on ANY document of the investor
 * (features/im/drawers verifyBody matched by investor only; lib/im/selectors let a note with no `doc` match every
 * round): a hint matches a document only when the document's paper is the hint's round — the NDA row of that lead,
 * or the supplementary agreement of an allotment whose Contact came from that lead. FEMA and the allocation letter
 * never carry one (the IR has no beat on them).
 *
 * A failed read is said, never guessed: `rankForFinance` falls back to age order and flags that the IR's side
 * could not be read. Logs hold ids and codes only.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { LEADS_MODULE } from "./capture";
import { ROUND_FIELDS, type RoundKey } from "./paperwork";

const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
export const IN_LIMIT = 100;

/** A Finance document's paper (server/documents/list.ts Paper) and the round an IR hint can be about. */
export type DocPaper = "nda" | "fema" | "supplementary" | "allocation-letter";
const PAPER_OF_ROUND: Readonly<Record<RoundKey, DocPaper>> = Object.freeze({ nda: "nda", supp: "supplementary" });
const VERIFIED_FIELD: Readonly<Record<RoundKey, string | null>> = Object.freeze({ nda: "NDA_Verified_At", supp: null });

export interface Hint {
  readonly leadId: string;
  readonly round: RoundKey;
  readonly paper: DocPaper;
  /** The IR who said it (Zoho user id and the name Zoho returns for the lookup). */
  readonly by: { readonly id: string; readonly name: string | null } | null;
  readonly at: string;
  readonly words: string;
}
export const HINT_WORDS: Readonly<Record<RoundKey, string>> = Object.freeze({
  nda: "They say the NDA is signed and sent",
  supp: "They say the supplementary is signed and sent",
});
export const NOT_A_SIGNATURE = "That is what they were told, not a signature.";
export const NO_WORD = "No word from the IR yet.";

export type HintsResult =
  | { readonly ok: true; readonly hints: ReadonlyMap<string, readonly Hint[]> }
  | { readonly ok: false; readonly errorKind: ZohoFailureKind | "unexpected" | "invalid" };

const idOf = (v: unknown): string | null => {
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const nameOf = (v: unknown): string | null => {
  const n = v && typeof v === "object" ? (v as { name?: unknown }).name : undefined;
  return typeof n === "string" && n.trim() && n.length <= 120 ? n.trim() : null;
};

/** The hints on one Lead record (pure). A round already verified carries none. */
export function hintsOf(L: ZohoRecord): Hint[] {
  const out: Hint[] = [];
  for (const rk of ["nda", "supp"] as const) {
    const f = ROUND_FIELDS[rk];
    const at = L[f.saidAt];
    if (typeof at !== "string" || !DATETIME.test(at)) continue;
    const vf = VERIFIED_FIELD[rk];
    if (vf && typeof L[vf] === "string" && L[vf]) continue;
    const byId = idOf(L[f.saidBy]);
    out.push(Object.freeze({ leadId: L.id, round: rk, paper: PAPER_OF_ROUND[rk], by: byId ? { id: byId, name: nameOf(L[f.saidBy]) } : null, at, words: HINT_WORDS[rk] }));
  }
  return out;
}

export { hintForDocument, rankForFinance } from "../../lib/selectors/finance-rank";

export interface HintDependencies {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

export function createHintReader(deps: HintDependencies) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("The hint reader needs crm.coql, the ops log and the record-id prefix.");
  }
  const { crm, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const fail = (userId: string, kind: ZohoFailureKind | "unexpected" | "invalid", ids: readonly string[]): HintsResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "lead-hints", reason: `read-${kind}`, recordIds: ids.filter(validId).slice(0, 20) });
    return { ok: false, errorKind: kind };
  };
  const SELECT = ["id", ...Object.values(ROUND_FIELDS).flatMap((f) => [f.saidAt, f.saidBy]), "NDA_Verified_At"].join(", ");

  return Object.freeze({
    /** Hints for these leads on the reader's own token, ≤100 ids per COQL call. */
    async byLeads(cred: UserCredential, leadIds: readonly string[], signal?: AbortSignal): Promise<HintsResult> {
      const ids = [...new Set(leadIds)].filter(validId);
      const map = new Map<string, Hint[]>();
      for (let i = 0; i < ids.length; i += IN_LIMIT) {
        const chunk = ids.slice(i, i + IN_LIMIT);
        let r: Awaited<ReturnType<typeof crm.coql>>;
        try { r = await crm.coql(cred, `select ${SELECT} from ${LEADS_MODULE} where id in (${chunk.map((x) => `'${x}'`).join(", ")}) limit 0, ${IN_LIMIT}`, { signal }); }
        catch { return fail(cred.userId, "unexpected", chunk); }
        if (!r.ok) return fail(cred.userId, r.error.kind, chunk);
        if (r.value.invalidRecordIds) return fail(cred.userId, "invalid", chunk);
        for (const L of r.value.records) {
          if (!validId(L.id) || !chunk.includes(L.id)) continue;
          const h = hintsOf(L);
          if (h.length) map.set(L.id, h);
        }
      }
      return { ok: true, hints: map };
    },

    /** Which lead each Contact came from (Contacts.Origin_Lead), so an allotment paper can find its hint. */
    async leadsForContacts(cred: UserCredential, contactIds: readonly string[], signal?: AbortSignal)
      : Promise<{ readonly ok: true; readonly leads: ReadonlyMap<string, string> } | { readonly ok: false }> {
      const ids = [...new Set(contactIds)].filter(validId);
      const map = new Map<string, string>();
      for (let i = 0; i < ids.length; i += IN_LIMIT) {
        const chunk = ids.slice(i, i + IN_LIMIT);
        let r: Awaited<ReturnType<typeof crm.coql>>;
        try { r = await crm.coql(cred, `select id, Origin_Lead from Contacts where id in (${chunk.map((x) => `'${x}'`).join(", ")}) limit 0, ${IN_LIMIT}`, { signal }); }
        catch { fail(cred.userId, "unexpected", chunk); return { ok: false }; }
        if (!r.ok || r.value.invalidRecordIds) { fail(cred.userId, r.ok ? "invalid" : r.error.kind, chunk); return { ok: false }; }
        for (const c of r.value.records) { const l = idOf(c.Origin_Lead); if (validId(c.id) && l && validId(l)) map.set(c.id, l); }
      }
      return { ok: true, leads: map };
    },
  });
}
export type HintReader = ReturnType<typeof createHintReader>;
