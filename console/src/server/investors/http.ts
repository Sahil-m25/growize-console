/**
 * Route-side helpers for the Investors API (M09-S02/S03, M08-S07): one live context per request on the
 * signed-in person's own token (D53), and the one way a refusal or a Zoho failure is answered. Bodies
 * carry reason codes, never values; every answer is no-store (D45: nothing kept client-side).
 */

import type { LiveContext } from "../data/zoho-source";

export const NO_STORE = Object.freeze({ "Cache-Control": "no-store" });

/** The live context, or the answer to give when there is none (not configured → 503; signed out → 401). */
export async function investorsContext(): Promise<{ ok: true; ctx: LiveContext } | { ok: false; response: Response }> {
  const { zohoSignInConfigured } = await import("../oauth/runtime");
  if (!zohoSignInConfigured()) return { ok: false, response: Response.json({ error: "Investors are read from Zoho once sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE }) };
  const { liveContext } = await import("../data/zoho-source");
  const ctx = await liveContext();
  if (!ctx) return { ok: false, response: Response.json({ session: null, signedOut: null }, { status: 401, headers: NO_STORE }) };
  return { ok: true, ctx };
}

/** Zoho answered, and said no — not an outage, so never "not answering" and never a retry hint (B-02, B-08). */
export const SOURCE_REFUSED: Readonly<Record<string, readonly [number, string]>> = Object.freeze({
  /* COQL rejects a column the token's profile cannot see (or that does not exist) with 400 INVALID_QUERY. */
  "invalid-data": [502, "Zoho refused this read: a field it asks for is hidden from your seat or missing in Zoho. Tell Digital Infrastructure."] as const,
  /* The profile has no permission on the module. */
  "forbidden": [403, "Zoho does not let your seat read this."] as const,
  /* Zoho answered with a record the console cannot read (e.g. a reservation with no unit price). */
  "source-invalid": [502, "Zoho returned a record this console cannot read. Tell Digital Infrastructure."] as const,
});

/** A refusal or a source error as an HTTP answer. Refusals are 403 — never "not found" (the guard's rule). */
export function failureResponse(r: { readonly kind: string; readonly reason?: string; readonly errorKind?: string }): Response {
  if (r.kind === "refused") return Response.json({ error: "This investor is not part of your book.", code: r.reason ?? "refused" }, { status: 403, headers: NO_STORE });
  if (r.kind === "conflict") return Response.json({ error: "Changed by someone else — reload.", code: "conflict" }, { status: 409, headers: NO_STORE });
  const refused = r.errorKind ? SOURCE_REFUSED[r.errorKind] : undefined;
  if (refused) return Response.json({ error: refused[1], code: r.errorKind }, { status: refused[0], headers: NO_STORE });
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind ?? "source-error" }, { status: 503, headers: NO_STORE });
}
