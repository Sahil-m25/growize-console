/* M12-S11-NOTE-3 / M12-S12-NOTE-2 — Finance's queue order and the agreed-draft offer: both halves of each endpoint. */
import { describe, expect, it } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImInbox, type ImState } from "@/lib/im";
import { renderToStaticMarkup } from "react-dom/server";
import { AgreedDraftOffer } from "@/features/im/paper2/AgreedDraft";
import { liveRead } from "../api";
import { paperworkQueue, NOT_A_SIGNATURE } from "./paperwork";
import { signPrefill } from "./sign";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** two papers out for two investors the Finance seat can read: an old allocation letter, and a newer supplementary the IR says is signed */
function book(): { s: ImState; supp: string; alloc: string } {
  const data = imDemoData();
  const [a, b] = data.INV.filter(x => x.lead && x.st !== "lapsed");
  data.DOCS = data.DOCS.filter(d => d.inv !== a.id && d.inv !== b.id);
  data.DOCS.push(
    { id: "D-901", inv: b.id, t: "Allocation letter", cls: "Commercial", state: "awaiting", sent: "01 Aug 10:00", by: "harsha", sig: "Aadhaar OTP", ref: null, exp: "15 Sep" } as never,
    { id: "D-902", inv: a.id, t: "Supplementary agreement", cls: "Commercial", state: "awaiting", sent: "10 Sep 10:00", by: "harsha", sig: "Aadhaar OTP", ref: null, exp: "30 Sep" } as never);
  data.INBOX.unshift({ id: "N-901", inv: a.id, kind: "signed", doc: "supp", at: "01 Sep 18:10", ir: "rohit", state: "seen", t: "x", d: "y" } as ImInbox);
  return { s: { data, ui: initialImUi() }, supp: "D-902", alloc: "D-901" };
}

describe("Finance's queue — fixture half", () => {
  it("the IR's word first (on that paper only), then the oldest; a seat that does not verify is refused", () => {
    const { s, supp, alloc } = book();
    const r = paperworkQueue.fixture({ s, me: "harsha" }, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.data.rows.map(x => x.recordId);
    expect(ids.indexOf(supp)).toBe(0);
    expect(ids.indexOf(alloc)).toBeGreaterThan(0);
    expect(r.data.rows[0]!.hint).toMatchObject({ paper: "supplementary", words: "They say the supplementary is signed and sent" });
    expect(r.data.rows.filter(x => x.hint).length).toBe(1);
    expect(r.data.irSideRead).toBe(true);
    expect(r.data.outCount).toBe(r.data.rows.length);
    expect(NOT_A_SIGNATURE).toMatch(/not a signature/);
    expect(paperworkQueue.fixture({ s, me: "pradeep" }, true).ok).toBe(false);
  });
  it("the path reads nothing for a seat that does not work the queue", () => {
    expect(paperworkQueue.path(true)).toBe("/api/documents/queue");
    expect(paperworkQueue.path(false)).toBeNull();
  });
});

describe("Finance's queue — live half", () => {
  it("reads the route and returns its queue; a 403 and a 503 come back as the route's own words", async () => {
    const queue = { rows: [{ key: "supplementary:1", recordId: "1", hint: null, leadId: null }], outCount: 1, irSideRead: false, note: "The IR's side could not be read; this is in age order." };
    const seen: string[] = [];
    const ok = await liveRead(paperworkQueue, paperworkQueue.path(true)!, { fetch: async (u: string) => { seen.push(u); return json(200, { queue }); } } as never);
    expect(seen).toEqual(["/api/documents/queue"]);
    expect(ok.state === "ok" && ok.data).toEqual(queue);
    const no = await liveRead(paperworkQueue, paperworkQueue.path(true)!, { fetch: async () => json(403, { error: "Finance works the paperwork queue.", code: "seat-denied" }) } as never);
    expect(no.state).toBe("error");
    const down = await liveRead(paperworkQueue, paperworkQueue.path(true)!, { fetch: async () => json(503, { error: "Zoho is not answering. Try again.", code: "server-error" }) } as never);
    expect(down.state === "error" && down.err.status).toBe(503);
  });
});

describe("the agreed draft in the prefill", () => {
  it("live: the prefill's agreedDraft comes through as the route sent it", async () => {
    const prefill = { paper: "supplementary", recordId: "1", recipient: null, nri: false, methods: ["email-otp"], methodNote: null, modifiedTime: null, current: null, maySend: true, note: null,
      agreedDraft: { ref: "https://workdrive.zoho.in/SUPP-L5-final", version: 2, at: "2026-09-26T11:00:00+05:30" } };
    const r = await liveRead(signPrefill, signPrefill.path({ paper: "supplementary", id: "1" })!, { fetch: async () => json(200, { prefill }) } as never);
    expect(r.state === "ok" && r.data.agreedDraft).toEqual(prefill.agreedDraft);
  });
  it("fixture: the Investors book holds no agreed draft, so none is offered", () => {
    const { s } = book();
    const x = s.data.INV.find(i => i.lead)!;
    const r = signPrefill.fixture({ s, me: "harsha" }, { paper: "supplementary", id: x.id });
    expect(r.ok && r.data.agreedDraft).toBeNull();
  });
});

describe("the offer on the send flow", () => {
  it("names the agreed draft, its version and a link; an attachment is named as such", () => {
    const link = renderToStaticMarkup(<AgreedDraftOffer draft={{ ref: "https://workdrive.zoho.in/SUPP-L5-final", version: 2, at: "2026-09-26T11:00:00+05:30" }} />);
    expect(link).toContain("Agreed final draft (draft 2)");
    expect(link).toContain('href="https://workdrive.zoho.in/SUPP-L5-final"');
    const att = renderToStaticMarkup(<AgreedDraftOffer draft={{ ref: "attachment:9007199254740999502", version: null, at: null }} />);
    expect(att).toContain("on the lead as an attachment");
    expect(att).not.toContain("href=");
  });
});
