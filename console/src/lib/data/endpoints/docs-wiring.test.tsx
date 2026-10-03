/* M12 (phase 2b, D104) — documents, sign, emails: both halves of each endpoint. */
import { describe, expect, it, vi } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImAction, type ImState } from "@/lib/im";
import { initialState, reducer } from "@/lib/state";
import type { PersonKey } from "@/domain";
import { demoBook } from "@fixtures/book";
import { liveRead, runWrite } from "../api";
import { documentUpload, documentsList, leadDocumentsList } from "./documents";
import { signBlock, signPrefill, signRemind, signSend, signTemplates } from "./sign";
import { emailOpen } from "./emails";

const demo = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("documents list — fixture half", () => {
  it("Finance sees papers and a count of what is out; a seat off the route is refused", () => {
    const r = documentsList.fixture({ s: demo(), me: "harsha" }, "all");
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.data.rows.length).toBeGreaterThan(0); expect(r.data.rows.every(x => x.paper !== "nda")).toBe(true); }
    const no = documentsList.fixture({ s: demo(), me: "pradeep" }, "all");
    expect(no.ok).toBe(false);
  });
  it("paths", () => {
    expect(signPrefill.path({ paper: "fema", id: "a b" })).toBe("/api/documents/sign/prefill?paper=fema&id=a%20b");
    expect(signPrefill.path({ paper: "fema", id: null })).toBeNull();
    expect(emailOpen.path({ kind: "investor", id: "I1", messageId: "m/1", ownerId: "u1" } as never)).toBe("/api/emails/investor/I1/m%2F1?owner=u1");
  });
});

describe("sign — fixture writes run the reducer action they replace", () => {
  it("remind dispatches remindSign; block dispatches blockDoc with the reason", async () => {
    const s = demo(), seen: ImAction[] = [];
    const d = s.data.DOCS.find(x => x.state === "awaiting")!;
    await runWrite("fixture", signRemind, { s, me: "harsha" }, (a: ImAction) => seen.push(a), { paper: "fema", recordId: d.id, did: d.id });
    await runWrite("fixture", signBlock, { s, me: "harsha" }, (a: ImAction) => seen.push(a), { paper: "fema", recordId: d.id, reason: "wrong name", expectedModifiedTime: "", did: d.id });
    expect(seen.map(a => a.type)).toEqual(["remindSign", "blockDoc"]);
  });
});

describe("live halves", () => {
  it("send posts JSON with one Idempotency-Key, reused on retry", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json(200, { sent: { paper: "fema", recordId: "1", requestId: "r", state: "sent", label: "Sent" } }));
    const args = { paper: "fema" as const, recordId: "1", method: "email-otp" as const, templateId: "", expectedModifiedTime: "t", book: { inv: "x", tpl: "y", sig: "z" } };
    await runWrite("live", signSend, { s: demo(), me: "harsha" }, () => {}, args, { idempotencyKey: "K1", fetch: f });
    await runWrite("live", signSend, { s: demo(), me: "harsha" }, () => {}, args, { idempotencyKey: "K1", fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/documents/sign/send");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toMatchObject({ paper: "fema", method: "email-otp" });
    expect(new Headers(f.mock.calls[0][1]!.headers).get("Idempotency-Key")).toBe("K1");
    expect(new Headers(f.mock.calls[1][1]!.headers).get("Idempotency-Key")).toBe("K1");
  });
  it("upload sends the raw bytes with the content type and the query the route reads", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json(200, { uploaded: { scope: "personal", recordId: "C1", slot: "fema", attachmentId: "a", fileName: "f.pdf", size: 3, duplicate: false, recovered: false } }));
    const a = { scope: "personal" as const, recordId: "C1", slot: "fema", name: "f.pdf", expected: "T", bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf",
      book: { key: "k", Scope: "Personal" as const, Doc_Type: "FEMA declaration", Investor: "i", LLP: null, File_Size: 3, File_Type: "PDF" } };
    const r = await runWrite("live", documentUpload, { s: demo(), me: "harsha" }, () => {}, a, { idempotencyKey: "K2", fetch: f });
    expect(r.ok).toBe(true);
    expect(f.mock.calls[0][0]).toBe("/api/documents/upload?scope=personal&id=C1&slot=fema&name=f.pdf&expected=T");
    const init = f.mock.calls[0][1]!;
    expect(init.body).toBeInstanceOf(Blob);
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/pdf");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("K2");
  });
});

describe("documents list — Lead side (M12-S03-W2)", () => {
  const as = (k: string) => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
  it("an IR reads the NDA rows of their own leads: 'all' lists the signed one, 'out' none; the route's paths", () => {
    const all = leadDocumentsList.fixture(as("rohit"), "all"), out = leadDocumentsList.fixture(as("rohit"), "out");
    expect(all.ok && out.ok).toBe(true);
    if (!all.ok || !out.ok) return;
    expect(all.data.side).toBe("lead");
    expect(all.data.rows.length).toBeGreaterThan(0);
    expect(all.data.rows.every(r => r.paper === "nda" && r.module === "Leads" && r.state === "verified")).toBe(true);
    expect(out.data.rows).toEqual([]);
    expect(out.data.outCount).toBe(0);
    expect(all.data.actions).toEqual({ send: false, verify: false });
    expect(leadDocumentsList.path("all")).toBe("/api/documents/list?cut=all");
    expect(leadDocumentsList.path(null)).toBeNull();
  });
  it("a seat with no Documents page is refused (403)", () => {
    const r = leadDocumentsList.fixture(as("jhalak"), "all");
    expect(!r.ok && r.status).toBe(403);
  });
});

describe("sign template picker (M12-S04-W2)", () => {
  it("live: reads GET /api/documents/sign/templates and picks the list; the send then carries the chosen templateId", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json(200, { templates: [{ templateId: "90071992547409970", name: "Supplementary" }] }));
    const r = await liveRead(signTemplates, signTemplates.path(true)!, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/documents/sign/templates");
    expect(r.state === "ok" && r.data).toEqual([{ templateId: "90071992547409970", name: "Supplementary" }]);
    expect(signTemplates.path(false)).toBeNull();
    const g = vi.fn(async (_u: string, _i?: RequestInit) => json(200, { sent: { paper: "supplementary", recordId: "1", requestId: "r", state: "sent", label: "Sent" } }));
    await runWrite("live", signSend, { s: demo(), me: "harsha" }, () => {},
      { paper: "supplementary", recordId: "1", method: "aadhaar", templateId: "90071992547409970", expectedModifiedTime: "t", book: { inv: "x", tpl: "y", sig: "z" } }, { idempotencyKey: "K3", fetch: g });
    expect(JSON.parse(g.mock.calls[0][1]!.body as string).templateId).toBe("90071992547409970");
  });
  it("fixture: a sending seat reads an empty list (the demo has no Zoho Sign templates); a seat that does not send is refused", () => {
    const ok = signTemplates.fixture({ s: demo(), me: "harsha" }, true);
    expect(ok.ok && ok.data).toEqual([]);
    const no = signTemplates.fixture({ s: demo(), me: "latha" }, true);
    expect(!no.ok && no.status).toBe(403);
  });
  it("a refused read carries the route's own words (403 on a seat that sends nothing)", async () => {
    const f = vi.fn(async () => json(403, { error: "Sending belongs to Finance Operations, Compliance and the Head of Finance.", code: "seat-denied" }));
    const r = await liveRead(signTemplates, "/api/documents/sign/templates", { fetch: f });
    expect(r.state === "error" && r.err.status).toBe(403);
  });
});

describe("the attachment line carries slot and uploader (M12-S01-W2)", () => {
  it("fixture: a paper filed to a typed slot has its slot's name; an upload says who filed it; a plain attachment has no slot", async () => {
    const { investorDocuments } = await import("./documents");
    const s = demo();
    const inv = s.data.INV[0]!.id;
    s.data.UPLOADS = [
      { id: "UP-1", key: "k1", Scope: "Personal", Doc_Type: "PAN proof", Investor: inv, LLP: null, File_Name: "pan.pdf", File_Size: 10, File_Type: "PDF", by: "harsha", at: "02 Sep 10:00" },
      { id: "UP-2", key: "k2", Scope: "Personal", Doc_Type: "Other", Investor: inv, LLP: null, File_Name: "note.pdf", File_Size: 10, File_Type: "PDF", by: "harsha", at: "02 Sep 10:05" },
    ] as never;
    const r = investorDocuments.fixture({ s, me: "harsha" }, inv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.data.personal ?? []).map(f => [f.slot, f.by])).toEqual([["PAN proof", expect.stringContaining("Harsha")], [null, expect.stringContaining("Harsha")]]);
  });
});
