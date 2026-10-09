/* G1 (D136 proposed) — Finance's to-do: "Send the NDA — requested by <IR> n days ago" and the honest note when the IRs' requests
   cannot all be read. The route's answer is fed through a mocked read (the fixture book has no request fields).
   Run: npx vitest run src/features/im/dash/send-requests.test.tsx */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { imReducer, initialImUi } from "@/lib/im";
import type { ImAction, ImState } from "@/lib/im";

const LEAD = "9007199254740996101", CONTACT = "9007199254740997101";
const h = vi.hoisted(() => ({ queue: null as unknown }));
vi.mock("@/lib/data/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/data/api")>("@/lib/data/api");
  return { ...real, useApiRead: (ep: { path: (a: unknown) => string | null }, _b: unknown, a: unknown) =>
    ep.path(a) === "/api/queues/investors" ? { state: "ok", data: h.queue } : { state: "loading" } };
});
const { ImDash, QRow, sendIt } = await import("./index");

const st = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const text = (x: string) => x.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const ndaRow = { key: `send:nda:${LEAD}`, kind: "send" as const, investor: { id: LEAD, name: "Kiran Synthetic" }, text: "Send the NDA — requested by Rohit Iyer 2 days ago",
  urg: "now" as const, days: 2, action: "Send it" as const, ref: { leadId: LEAD, paper: "nda" } };
const suppRow = { ...ndaRow, key: `send:supp:${LEAD}`, investor: { id: CONTACT, name: "Kiran Investor" }, text: "Send the supplementary agreement — requested by Rohit Iyer today",
  ref: { leadId: LEAD, contactId: CONTACT, paper: "supplementary" } };
const queue = (rows: unknown[], requestsNote: string | null) => ({ side: "money", readOnly: false, rows, waiting: rows.length, today: rows.length, problems: [], asOf: 0, requestsNote });

describe("G1 on Finance's day", () => {
  it("the request is a row with its own words and a Send it button; the note says when requests may be missing", () => {
    h.queue = queue([ndaRow], "Requests to send an NDA show only for leads Zoho shares with Finance.");
    const t = text(renderToStaticMarkup(<ImDash s={st()} me="harsha" dispatch={() => {}} />));
    expect(t).toContain("Kiran Synthetic Send the NDA — requested by Rohit Iyer 2 days ago");
    expect(t).toContain("Send it");
    expect(t).toContain("Requests to send an NDA show only for leads Zoho shares with Finance.");
  });
  it("no note when the requests were read in full", () => {
    h.queue = queue([], null);
    expect(renderToStaticMarkup(<ImDash s={st()} me="harsha" dispatch={() => {}} />)).not.toContain("data-requests-note");
  });
  it("QRow renders the send row's control", () => {
    const html = renderToStaticMarkup(<QRow s={st()} me="harsha" dispatch={() => {}} x={ndaRow} />);
    expect(html).toMatch(/<button class="act">Send it<\/button>/);
  });
});

describe("G1 Send it opens the send panel", () => {
  const run = (ref: Parameters<typeof sendIt>[1]) => {
    const seen: ImAction[] = [];
    let s = st();
    sendIt((a) => { seen.push(a); s = imReducer(s, "harsha", a); }, ref);
    return { seen, s };
  };
  it("an NDA opens Documents › Send one on that lead, with the NDA template", () => {
    const { s } = run(ndaRow.ref);
    expect(s.ui.VIEW).toBe("docs");
    expect(s.ui.SEC.docs).toBe("send");
    expect([s.ui.drafts.DTPL, s.ui.drafts.DLEAD]).toEqual(["Non-disclosure agreement", LEAD]);
  });
  it("a supplementary with an investor record opens that investor's send drawer on the supplementary", () => {
    const { seen } = run(suppRow.ref);
    expect(seen).toEqual([{ type: "openDrawer", k: "send", id: CONTACT, seed: { DTPL: "Supplementary agreement" } }]);
  });
  it("the send panel opened on the lead names it and offers no investor picker; 'Pick an investor instead' is there", async () => {
    const { SendPanel } = await import("../docs/index");
    const { s } = run(ndaRow.ref);
    const html = renderToStaticMarkup(<SendPanel s={s} me="harsha" dispatch={() => {}} />);
    expect(html).toContain(`data-send-lead="${LEAD}"`);
    expect(text(html)).toContain("The NDA an IR asked for.");
    expect(html).toContain("Pick an investor instead");
    expect(html).not.toContain('id="dsel"');
  });
});
