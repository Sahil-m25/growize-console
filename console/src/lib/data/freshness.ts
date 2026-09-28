/* ── @/lib/data/freshness — how current the screen's data is (M01-S03 T04, D45 rule 8) ─────────
   The top bar says whether what is on screen is live, stale or failed, from the data adapter's own
   record of its last successful read — never a made-up refresh time. Phase 1 has no Zoho: "live"
   means the last successful GET /api/data. Past the five-minute ceiling the data is stale; a failed
   read says so, with a Retry, and the page shows an error block instead of passing old numbers off
   as current.
   ────────────────────────────────────────────────────────────────────────────────────────── */

/** the cache ceiling (CLAUDE.md rule 8): five minutes */
export const FRESH_MS = 5 * 60 * 1000;

export type Fresh = {
  tone: "reading" | "live" | "stale" | "error";
  /** the top bar's line, or "" when there is nothing yet to say */
  line: string;
  /** offer Retry */
  retry: boolean;
  /** the page shows the error block */
  block: string | null;
};

/** hh:mm in Asia/Kolkata (rule 9) */
export const hhmm = (ms: number): string =>
  new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/**
 * @param at     when the last read succeeded (epoch ms), or null when none has
 * @param failed the most recent read failed
 * @param now    the wall clock (epoch ms)
 */
export function freshness(at: number | null, failed: boolean, now: number, fmt: (ms: number) => string = hhmm): Fresh {
  const old = at != null && now - at > FRESH_MS;
  if (!failed) {
    if (at == null) return { tone: "reading", line: "", retry: false, block: null };
    return old
      ? { tone: "stale", line: "Data read " + fmt(at) + " · over 5 minutes ago", retry: true, block: null }
      : { tone: "live", line: "Data read " + fmt(at), retry: false, block: null };
  }
  if (at != null && !old)
    return { tone: "stale", line: "Could not refresh · showing data read " + fmt(at), retry: true,
      block: "The last read failed. What you see was read at " + fmt(at) + ", under five minutes ago." };
  return {
    tone: "error", line: "Data could not be read" + (at != null ? " · last read " + fmt(at) : ""), retry: true,
    block: "The data source did not answer, so nothing here is shown as current"
      + (at != null ? " — what you see was read at " + fmt(at) + " and may be out of date." : "."),
  };
}
