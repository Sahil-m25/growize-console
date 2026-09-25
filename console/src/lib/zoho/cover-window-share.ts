/* Cover windows as record-level sharing (D44, M02-S09). A window opening shares the lead with the
 * covering IR; closing revokes it. Runs as the "cover-window-share" service job (D53): the caller
 * mints the credential and reads the window list; wiring to the schedule is S3.
 * Logs nothing itself — the client's ops log already holds job, record ids, status and timing. */
import type { ServiceCredential, ZohoServiceClient } from "./client";

export interface CoverWindow {
  readonly leadId: string;
  /** The covering IR's Zoho user id. */
  readonly coverUserId: string;
  readonly state: "open" | "closed";
}
export interface CoverWindowResult {
  readonly leadId: string;
  readonly state: CoverWindow["state"];
  readonly ok: boolean;
}

/** Applies each window in turn. A failed window is reported and does not stop the rest. */
export async function runCoverWindowShare(
  client: ZohoServiceClient,
  as: ServiceCredential,
  windows: readonly CoverWindow[],
): Promise<CoverWindowResult[]> {
  const out: CoverWindowResult[] = [];
  for (const w of windows) {
    const r =
      w.state === "open"
        ? await client.share(as, "Leads", w.leadId, w.coverUserId, "read_write")
        : await client.unshare(as, "Leads", w.leadId, w.coverUserId);
    out.push({ leadId: w.leadId, state: w.state, ok: r.ok });
  }
  return out;
}
