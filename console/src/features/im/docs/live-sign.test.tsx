/* W3-E2E-8: Documents > Out for signature prints a live expiry as a day ("expires 23 Oct"), never the ISO stamp, and names the sender
   (Sign's owner name, or the sender's user id resolved from the people directory) instead of a bare dash. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImState } from "@/lib/im";

vi.mock("@/lib/data/endpoints/documents", async (orig) => {
  const m = await orig<typeof import("@/lib/data/endpoints/documents")>();
  return { ...m, documentsList: { ...m.documentsList, fixture: (b: never, a: never) => {
    const r = m.documentsList.fixture!(b, a) as { ok: boolean; data?: { rows: { sign: unknown; state: string; key: string }[] } & Record<string, unknown> };
    if (!r.ok) return r;
    const rows = r.data!.rows.map((d, i) => ({ ...d, state: "sent", key: "k" + i, sign: { status: "inprogress", sentAt: "2026-10-09T12:05+05:30",
      expiresAt: "2026-10-23T12:05+05:30", label: "Sent", sentBy: i === 0 ? "Meena Iyer" : null, sentById: i === 1 ? "meena" : null } }));
    return { ...r, data: { ...r.data, rows } };
  } } };
});

const { ImDocs } = await import("./index");
const html = (me: string) => renderToStaticMarkup(<ImDocs s={{ data: imDemoData(), ui: initialImUi() } as ImState} me={me} dispatch={() => {}} />);

describe("live Sign rows on Documents", () => {
  it("expiry reads as a day; the sender is named", () => {
    const h = html("harsha");
    expect(h).toContain("expires 23 Oct");
    expect(h).not.toContain("2026-10-23T12:05");
    expect(h).toContain("Meena");
    expect(h).not.toMatch(/<td class="sm">—\s*<span class="mono">/);
  });
});
