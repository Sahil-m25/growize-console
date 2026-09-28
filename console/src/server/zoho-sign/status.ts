/**
 * M12-S05 — the per-viewer Zoho Sign status reader that server/documents/list.ts takes as `signStatus` (its
 * SignStatusReader): each request re-read on the VIEWER's own token (D53), at most MAX_STATUS_READS a page,
 * nothing cached (D52). A request the viewer's token cannot read simply has no live status (row `sign: null`).
 * Wiring it into the Documents list composition is the list owner's one-line change (see BLOCKED).
 */

import type { UserCredential } from "../../lib/zoho/client";
import type { SignStatus, SignStatusReader } from "../documents/list";
import type { SignApi } from "./api";
import { signStateOf, STATE_LABEL } from "./papers";

export const MAX_STATUS_READS = 50;
const iso = (ms: number | null): string | null => (ms === null ? null : `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 16)}+05:30`);

export function createSignStatusReader(sign: Pick<SignApi, "getRequest">): SignStatusReader {
  return async (cred: UserCredential, requestIds: readonly string[], signal?: AbortSignal) => {
    const out = new Map<string, SignStatus>();
    for (const id of [...new Set(requestIds)].slice(0, MAX_STATUS_READS)) {
      const r = await sign.getRequest(cred, id, { signal });
      if (!r.ok) continue;
      const st = signStateOf(r.value);
      // list.ts treats /^(completed|signed)$/ as signed: pass Zoho's word for completed, our state otherwise.
      out.set(id, Object.freeze({ status: st === "signed" ? "completed" : st, sentAt: iso(r.value.sentAt), sentBy: null, expiresAt: iso(r.value.expiresAt), label: STATE_LABEL[st] } as SignStatus));
    }
    return out;
  };
}
