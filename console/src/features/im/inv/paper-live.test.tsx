/* W3-E2E-3: the investor record's Paper tab, live, reads the signing request on the allotment (the field Documents and the Send
   panel read): a sent supplementary reads "out for signature" with its day, and Send it is not offered. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImState } from "@/lib/im";
import type { DocRow } from "@/server/documents/list";
import { liveRounds, SecPaperLive } from "./index";

const row = (o: Partial<DocRow>): DocRow => ({
  key: "supplementary:1454168000003024816", paper: "supplementary", label: "Supplementary agreement", scope: "allotment", module: "LLP_UnitAllocation_Module",
  recordId: "1454168000003024816", party: "Prakash Bhat", contactId: "1454168000003024655", llpId: null, requestId: "9908441718390141010",
  method: "Email OTP", state: "sent", verifiedAt: null, yourMove: null,
  sign: { status: "inprogress", sentAt: "2026-10-09T12:05+05:30", sentBy: null, sentById: "meena", expiresAt: "2026-10-23T12:05+05:30", label: "Sent" }, ...o,
}) as DocRow;

const html = (rows: DocRow[], me = "meena") => {
  const s: ImState = { data: imDemoData(), ui: initialImUi() };
  const x = s.data.INV[0]!;
  return renderToStaticMarkup(<SecPaperLive s={s} me={me} dispatch={() => {}} x={x} papers={{ rows }} />);
};

describe("record > Paper, live", () => {
  it("a supplementary Finance sent reads out for signature, with its day, and Send it is not offered", () => {
    const h = html([row({})]);
    expect(h).toContain("with the IR");
    expect(h).toContain("Out for signature — the IR is chasing");
    expect(h).toContain("sent 09 Oct");
    expect(h).not.toContain("Send it");
    expect(h).not.toContain("Not sent yet");
    expect(h).toContain("1 document with a signing request");
    expect(h).toContain("link expires 23 Oct");
  });
  it("nothing sent: not sent, Send it offered; verified: signed; Sign says signed: verify it; declined: send again", () => {
    expect(html([])).toContain("Send it");
    expect(liveRounds([row({ state: "verified", verifiedAt: "2026-10-10T10:00" })])[0]).toMatchObject({ tone: "go", tag: "signed" });
    expect(liveRounds([row({ state: "signed" })])[0]).toMatchObject({ tone: "late", tag: "verify it" });
    const declined = liveRounds([row({ sign: { status: "declined", sentAt: "2026-10-09T12:05+05:30", sentBy: null, expiresAt: null, label: "Declined" } })])[0]!;
    expect(declined).toMatchObject({ tone: "due", tag: "send again" });
  });
  it("a loading or failed read says so instead of drawing the demo book", () => {
    const s: ImState = { data: imDemoData(), ui: initialImUi() };
    const x = s.data.INV[0]!;
    expect(renderToStaticMarkup(<SecPaperLive s={s} me="meena" dispatch={() => {}} x={x} papers={{ loading: true }} />)).toContain("Reading the papers");
    expect(renderToStaticMarkup(<SecPaperLive s={s} me="meena" dispatch={() => {}} x={x} papers={{ error: "Zoho is not answering." }} />)).toContain("Zoho is not answering.");
  });
});
