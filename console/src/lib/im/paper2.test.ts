import { describe, expect, it } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import {
  fileKind, finQueue, initialImUi, investorEmails, invMatch, invRows, irInvestors, irMayOpen, irRow, irRows, IR_COLS,
  leadEmails, leadInvestorEmails, mineQueue, recallGate, remindGate, signChip, slotTaken, uploadCheck, uploadGate,
  uploadKey, uploadsFor, UPLOAD_MAX, imReducer,
} from "@/lib/im";
import type { ImAction, ImState } from "@/lib/im";
import { LEADMAIL } from "@fixtures/book/emails";

const demo = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const act = (s: ImState, WHO: string, ...as: ImAction[]) => as.reduce((x, a) => imReducer(x, WHO, a), s);
const MB = 1024 * 1024;
const up = (o: Partial<Extract<ImAction, { type: "uploadDoc" }>> = {}): Extract<ImAction, { type: "uploadDoc" }> => ({
  type: "uploadDoc", key: "k1", Scope: "Allotment", Doc_Type: "Signed NDA", Investor: "ARL-INV-0208", LLP: "B",
  File_Name: "nda-signed.pdf", File_Size: 2 * MB, File_Type: "application/pdf", ...o,
});

describe("M12-S02 upload rules", () => {
  it("allows PDF, JPG and PNG up to 20 MB, by type or by extension", () => {
    expect(fileKind("a.pdf", "application/pdf")).toBe("PDF");
    expect(fileKind("a.JPEG", "")).toBe("JPG");
    expect(fileKind("a.png", "image/png")).toBe("PNG");
    expect(fileKind("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBeNull();
    expect(fileKind("a.pdf", "image/heic")).toBeNull();
    expect(uploadCheck({ name: "a.pdf", size: UPLOAD_MAX, type: "application/pdf" })).toEqual({ ok: true });
  });
  it("refuses a file over 20 MB naming the limit, and a type off the allowlist", () => {
    const big = uploadCheck({ name: "scan.pdf", size: UPLOAD_MAX + 1, type: "application/pdf" });
    expect(big).toEqual({ ok: false, msg: "scan.pdf is just over 20 MB. The limit is 20 MB a file. Nothing was sent." });
    const huge = uploadCheck({ name: "scan.pdf", size: 23.4 * MB, type: "application/pdf" });
    expect(huge.ok ? "" : huge.msg).toContain("is 23.4 MB. The limit is 20 MB");
    const heic = uploadCheck({ name: "photo.heic", size: MB, type: "image/heic" });
    expect(heic).toEqual({ ok: false, msg: "photo.heic is not a PDF, JPG or PNG. Only those three can be uploaded. Nothing was sent." });
    expect(uploadCheck({ name: "x.pdf", size: 0, type: "application/pdf" }).ok).toBe(false);
  });
  it("checks the seat, the target and the slot", () => {
    const s = demo();
    const t = { Scope: "Allotment" as const, Doc_Type: "Signed NDA", Investor: "ARL-INV-0208", LLP: "B", File_Name: "a.pdf", File_Size: MB, File_Type: "application/pdf" };
    expect(uploadGate(s, "harsha", t)).toEqual({ ok: true });
    expect(uploadGate(s, "latha", t)).toEqual({ ok: false, msg: "Uploading belongs to Finance Operations, Compliance and the Head of Finance." });
    expect(uploadGate(s, "imran", t).ok).toBe(false);
    expect(uploadGate(s, "harsha", { ...t, LLP: "A" }).ok ? "" : (uploadGate(s, "harsha", { ...t, LLP: "A" }) as { msg: string }).msg)
      .toBe("Prakash Bhat holds nothing on that farm, so there is no allotment to file it on.");
    expect(uploadGate(s, "harsha", { ...t, Doc_Type: "Invented slot" }).ok).toBe(false);
    expect(uploadGate(s, "harsha", { ...t, Scope: "Project", Investor: null, LLP: "A", Doc_Type: "Farm report" }).ok).toBe(true);
  });
  it("records the upload once, as the uploader, and a second press with the same key attaches nothing", () => {
    const s0 = demo(), n0 = s0.data.UPLOADS!.length;
    const s1 = act(s0, "meena", up());
    expect(s1.data.UPLOADS!.length).toBe(n0 + 1);
    expect(s1.data.UPLOADS![0]).toMatchObject({ id: "UP-003", Doc_Type: "Signed NDA", File_Name: "nda-signed.pdf", File_Size: 2 * MB, by: "meena", at: "02 Sep 00:00" });
    expect(s1.data.LOG[0]).toMatchObject({ who: "meena", what: "Uploaded a document", inv: "ARL-INV-0208", kind: "doc" });
    const s2 = act(s1, "meena", up());
    expect(s2.data.UPLOADS!.length).toBe(n0 + 1);
    expect(s2.ui.NOTE).toBeNull();
  });
  it("refuses in-page and stores nothing for an oversized or off-list file", () => {
    const s = act(demo(), "harsha", up({ File_Size: 21 * MB, key: "big" }));
    expect(s.data.UPLOADS!.length).toBe(2);
    expect(s.ui.NOTE).toEqual({ kind: "refuse", msg: "nda-signed.pdf is 21 MB. The limit is 20 MB a file. Nothing was sent." });
  });
  it("asks before replacing the one file a typed slot holds", () => {
    const s1 = act(demo(), "meena", up());
    expect(slotTaken(s1, { Scope: "Allotment", Doc_Type: "Signed NDA", Investor: "ARL-INV-0208", LLP: "B" })!.File_Name).toBe("nda-signed.pdf");
    const s2 = act(s1, "harsha", up({ key: "k2", File_Name: "nda-v2.pdf" }));
    expect(s2.ui.NOTE!.kind).toBe("ask");
    expect(s2.data.UPLOADS!.filter(u => u.Doc_Type === "Signed NDA").length).toBe(1);
    const s3 = act(s2, "harsha", { type: "confirmYes" });
    const nda = s3.data.UPLOADS!.filter(u => u.Doc_Type === "Signed NDA");
    expect(nda.map(u => u.File_Name)).toEqual(["nda-v2.pdf"]);
    expect(s3.data.LOG[0].what).toBe("Replaced an uploaded document");
  });
  it("lists an investor's own papers plus the farm papers of the farms they hold", () => {
    const s = demo();
    expect(uploadsFor(s, "harsha", "ARL-INV-0208").map(u => u.id)).toEqual(["UP-001"]);
    expect(uploadsFor(s, "harsha", "ARL-INV-0205").map(u => u.id)).toEqual(["UP-002"]);
    expect(uploadsFor(s, "harsha").map(u => u.id)).toEqual(["UP-002", "UP-001"]);
    expect(uploadsFor(s, "imran", "ARL-INV-0208")).toEqual([]);
  });
  it("keys a pick by file and target", () => {
    const t = { Scope: "Personal" as const, Doc_Type: "PAN proof", Investor: "ARL-INV-0205", LLP: null };
    expect(uploadKey({ name: "a.pdf", size: 10, lastModified: 5 }, t)).toBe("Personal|ARL-INV-0205||PAN proof|a.pdf|10|5");
  });
});

describe("M12-S05 signature status, reminder, recall", () => {
  const d041 = (s: ImState) => s.data.DOCS.find(d => d.id === "D-041")!;
  it("reads Viewed with its time, Signed from the document, and nothing for a receipt", () => {
    const s = demo();
    expect(signChip(s, d041(s))).toEqual({ st: "viewed", t: "Viewed 31 Aug 19:05", c: "due" });
    const signedDoc = s.data.DOCS.find(d => d.state === "signed" && d.sig)!;
    expect(signChip(s, signedDoc)!.t).toBe("Signed");
    const receipt = s.data.DOCS.find(d => !d.sig);
    if (receipt) expect(signChip(s, receipt)).toBeNull();
    s.data.SIGN!["D-041"] = { Sign_Request_Id: "x", st: "declined", why: "Wrong unit count" };
    expect(signChip(s, d041(s))!.t).toBe("Declined — Wrong unit count");
  });
  it("a reminder is recorded with its time; only a doc seat on an open request may send one", () => {
    const s = act(demo(), "meena", { type: "remindSign", did: "D-041" });
    expect(s.data.SIGN!["D-041"].reminded).toEqual([{ at: "02 Sep 00:00", by: "meena" }]);
    expect(s.data.LOG[0].what).toBe("Sent a signature reminder");
    expect(remindGate(s, "latha", "D-041").ok).toBe(false);
    const signedDoc = s.data.DOCS.find(d => d.state === "signed" && d.sig)!;
    expect(remindGate(s, "harsha", signedDoc.id).ok).toBe(false);
  });
  it("a recall needs a reason, then reads Recalled and leaves the round blocked", () => {
    const s0 = demo();
    expect(recallGate(s0, "harsha", "D-041", " ")).toEqual({ ok: false, msg: "Say why it is being recalled — the reason goes in the log with your name." });
    const s = act(s0, "harsha", { type: "recallSign", did: "D-041", why: "Wrong document sent" });
    expect(signChip(s, d041(s))).toEqual({ st: "recalled", t: "Recalled", c: "late" });
    expect(d041(s)).toMatchObject({ state: "blocked", why: "Recalled — Wrong document sent", vby: "harsha" });
    expect(s.data.LOG[0]).toMatchObject({ what: "Recalled a signature request", note: "FEMA declaration · Wrong document sent" });
    expect(remindGate(s, "harsha", "D-041").ok).toBe(false);
  });
  it("a declined request heads Finance's queue", () => {
    const s = demo();
    const n0 = mineQueue(s, "meena").length;
    s.data.SIGN!["D-041"] = { Sign_Request_Id: "x", st: "declined", why: "Will sign a corrected copy" };
    d041(s).state = "blocked";
    const q = finQueue(s, "meena");
    expect(q[0]).toMatchObject({ kind: "declined", urg: "now", t: "FEMA declaration declined — Will sign a corrected copy" });
    expect(q[0].inv.id).toBe("ARL-INV-0209");
    expect(mineQueue(s, "meena").length).toBe(n0 + 1);
    expect(mineQueue(s, "latha").some(x => x.kind === "declined")).toBe(false);
  });
});

describe("M12-S09 a record's emails", () => {
  it("lists an investor's emails, newest first, to a seat that reads the investor", () => {
    const s = demo();
    expect(investorEmails(s, "harsha", "ARL-INV-0208")!.map(e => e.message_id)).toEqual(["EM-0208-3", "EM-0208-2", "EM-0208-1"]);
  });
  it("refuses a record the person cannot open", () => {
    const s = demo();
    expect(investorEmails(s, "imran", "ARL-INV-0208")).toBeNull();      /* not in Imran's book */
    expect(investorEmails(s, "imran", "ARL-INV-0205")!.length).toBe(1); /* Radhika is Imran's */
    expect(investorEmails(s, "pradeep", "ARL-INV-0208")).toBeNull();    /* a system seat reads no investor */
  });
  it("an IR sees an investor's emails only for the investor from their own lead", () => {
    const s = demo();
    expect(investorEmails(s, "rohit", "ARL-INV-0208")!.length).toBe(3);   /* L6 was Rohit's */
    expect(investorEmails(s, "kavya", "ARL-INV-0208")).toBeNull();
    expect(leadInvestorEmails(s, "rohit", "L6")!.x.id).toBe("ARL-INV-0208");
    expect(leadInvestorEmails(s, "kavya", "L6")).toBeNull();
    expect(leadInvestorEmails(s, "kavya", "L7")!.mail.length).toBe(2);
    expect(leadInvestorEmails(s, "rohit", "L4")).toBeNull();              /* L4 is not an investor */
    expect(leadEmails(LEADMAIL, "L6").map(e => e.message_id)).toEqual(["EL-L6-2", "EL-L6-1"]);
  });
});

describe("M09-S08 an IR sees only investors from their own leads", () => {
  it("lists only the investors whose originating IR is this IR", () => {
    const s = demo();
    const r = irInvestors(s, "rohit").map(x => x.id);
    expect(r).toEqual(["ARL-INV-0206", "ARL-INV-0208", "ARL-INV-0212", "ARL-INV-0215", "ARL-INV-0218"]);
    expect(irInvestors(s, "kavya").every(x => x.ir === "kavya")).toBe(true);
    expect(irInvestors(s, "harsha")).toEqual([]);   /* a seated person is not an IR */
  });
  it("refuses a direct link to another IR's investor", () => {
    const s = demo();
    expect(irMayOpen(s, "rohit", "ARL-INV-0208")).toBe(true);
    expect(irMayOpen(s, "rohit", "ARL-INV-0209")).toBe(false);   /* Kavya's lead */
  });
  it("shows no money or identity columns", () => {
    const s = demo();
    expect(IR_COLS).toEqual(["Investor", "ARL ID", "Farms", "State", "Lead"]);
    const row = irRows(s, "rohit").find(x => x.id === "ARL-INV-0208")!;
    expect(row).toEqual({ n: "Prakash Bhat", id: "ARL-INV-0208", farms: "Block B ×1", st: "reserved", lead: "L6" });
    expect(Object.keys(irRow(s.data.INV[0])).sort()).toEqual(["farms", "id", "lead", "n", "st"]);
  });
});

describe("M09-S07 investor search", () => {
  const rows = (WHO: string, IQ: string, IFILT: string | null = null) => {
    const s = demo(); s.ui.IQ = IQ; s.ui.IFILT = IFILT; return invRows(s, WHO).map(x => x.n);
  };
  it("'Mysuru' lists exactly Prakash Bhat and Harish Gowda", () => {
    expect(rows("harsha", "Mysuru")).toEqual(["Prakash Bhat", "Harish Gowda"]);
  });
  it("an ARL code lists that one investor", () => {
    expect(rows("harsha", "ARL-INV-0216")).toEqual(["Harish Gowda"]);
  });
  it("finds by phone digits and by farm", () => {
    expect(rows("harsha", "97400 555")).toEqual(["Prakash Bhat"]);
    const s = demo();
    const b = s.data.INV.filter(x => x.blocks.B).map(x => x.n);
    expect(rows("harsha", "Block B")).toEqual(b);
    expect(invMatch(s, s.data.INV[0], "doddaballapura")).toBe(true);
  });
  it("combines with the exception chips", () => {
    expect(rows("harsha", "Mysuru", "hold")).toEqual(["Prakash Bhat"]);
    expect(rows("harsha", "Harish", "hold")).toEqual([]);
  });
  it("a KAM's search never leaves their book", () => {
    expect(rows("imran", "Prakash")).toEqual([]);
    expect(rows("imran", "Radhika")).toEqual(["Radhika Menon"]);
  });
});

describe("M15-S03 the Auditor reads the Finance trail (TC-IM10-008)", () => {
  it("lists the Finance people's entries, read only, with a Person view; other seats are unchanged", async () => {
    const { activityBase, activityActors, finSeats } = await import("@/lib/im");
    const s = demo();
    const rows = activityBase(s, "latha");
    expect(rows).toHaveLength(12); // the demo book: Meena, Fahad and Harsha
    const fin = new Set([...finSeats(s), "latha"]);
    expect(rows.every(e => fin.has(e.who))).toBe(true);
    expect(activityActors(s, "latha").has("meena")).toBe(true);
    expect(activityActors(s, "imran").has("meena")).toBe(false);
  });
});
