/* ── im/paper2.ts — uploads, Zoho Sign status, record emails and the IR wall (not in the prototype) ──
   The rules behind four later stories, as pure functions the pages and the reducer both ask:
     M12-S02  upload a document (D71): 20 MB, PDF/JPG/PNG only, a scope and a typed slot, the
              uploader's own seat, a second press never attaches twice
     M12-S05  signature status (D72): Sent / Viewed / Signed / Declined / Expired / Recalled, remind,
              recall with a reason; a declined request heads Finance's queue (selectors.finQueue)
     M12-S09  a record's emails (D72): only on a record the viewer can open; an IR sees an
              investor's emails only when the investor came from that IR's own lead (D69)
     M09-S08  an IR sees only investors from their own leads (D69): the rows and columns phase 2
              serves an IR seat. In the merged prototype an IR has no Investors page at all (IRs are
              named on this side, never seated — IRN), so nothing renders it yet.
   Phase 1 sends nothing anywhere: an upload records the file's name, size and slot only.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import { I, may, pageReadable, who } from "./selectors";
import type { Gate } from "./rules";
import type {
  ImCtx, ImDoc, ImInvestor, ImScope, ImSign, ImSignSt, ImUpload, Paper2Action, RecEmail,
} from "./types";

const OK: Gate = { ok: true };
const no = (msg: string | null = null): Gate => ({ ok: false, msg });

/* ============================ M12-S02 uploads ============================ */
export const UPLOAD_MAX_MB = 20;
export const UPLOAD_MAX = UPLOAD_MAX_MB * 1024 * 1024;
/** the allowlist (D71): by MIME type, or by extension when the browser gives none */
export const UPLOAD_KINDS = [
  { k: "PDF", mime: ["application/pdf"], ext: ["pdf"] },
  { k: "JPG", mime: ["image/jpeg", "image/jpg", "image/pjpeg"], ext: ["jpg", "jpeg"] },
  { k: "PNG", mime: ["image/png"], ext: ["png"] },
] as const;
export const UPLOAD_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

/** The three scopes (D70) as the picker offers them. */
export const SCOPES: { k: ImScope; t: string; d: string }[] = [
  { k: "Personal", t: "Personal", d: "on the investor — KYC, bank and nominee papers" },
  { k: "Allotment", t: "Allotment", d: "on the investor's holding in one farm — agreements and receipts" },
  { k: "Project", t: "Farm", d: "on the farm LLP — every holder of that farm sees it" },
];
/** The typed slots per scope. A slot with a `field` is a Zoho file-upload field and holds one file
 *  (ZFS, then the field); "Other" and payment proofs are free attachments (Attachments API).
 *  The list itself is still open (OD8) — these are the examples D70 and the mapping name. */
export const SLOTS: Record<ImScope, { t: string; field: string | null }[]> = {
  Personal: [
    { t: "PAN proof", field: "PAN_Proof" }, { t: "Bank proof", field: "Bank_Proof" },
    { t: "FEMA declaration", field: "FEMA_Declaration" }, { t: "Other", field: null },
  ],
  Allotment: [
    { t: "Signed NDA", field: "Signed_NDA" }, { t: "Supplementary agreement", field: "Supplementary_Agreement" },
    { t: "Allocation letter", field: "Allocation_Letter" }, { t: "Unit certificate", field: "Unit_Certificate" },
    { t: "Payment proof", field: null }, { t: "Other", field: null },
  ],
  Project: [
    { t: "LLP deed", field: "LLP_Deed" }, { t: "Insurance", field: "Insurance_Policy" },
    { t: "Farm report", field: null }, { t: "Annual accounts", field: null }, { t: "Other", field: null },
  ],
};
export const slotOf = (scope: ImScope, t: string) => (SLOTS[scope] || []).find(x => x.t === t) || null;

/** "PDF" | "JPG" | "PNG", or null when the file is not on the allowlist */
export function fileKind(name: string, type: string): "PDF" | "JPG" | "PNG" | null {
  const t = (type || "").toLowerCase(), ext = (name.split(".").pop() || "").toLowerCase();
  const k = UPLOAD_KINDS.find(x => (x.mime as readonly string[]).includes(t))
    || (!t || t === "application/octet-stream" ? UPLOAD_KINDS.find(x => (x.ext as readonly string[]).includes(ext)) : undefined);
  return k ? k.k : null;
}
/** 1.2 MB, 830 KB — how a size is said on the page */
export function fileSize(n: number): string {
  if (n >= 1024 * 1024) return (Math.round((n / (1024 * 1024)) * 10) / 10).toLocaleString("en-IN") + " MB";
  return Math.max(1, Math.round(n / 1024)).toLocaleString("en-IN") + " KB";
}

/** The file itself: not empty, 20 MB or less, a PDF, JPG or PNG. Checked before anything is sent. */
export function uploadCheck(f: { name: string; size: number; type: string }): Gate {
  if (!f || !f.name) return no("Choose a file first.");
  if (!(f.size > 0)) return no(f.name + " is empty. Nothing was sent.");
  if (f.size > UPLOAD_MAX)
    return no(f.name + " is " + (fileSize(f.size) === UPLOAD_MAX_MB + " MB" ? "just over " + UPLOAD_MAX_MB + " MB" : fileSize(f.size))
      + ". The limit is " + UPLOAD_MAX_MB + " MB a file. Nothing was sent.");
  if (!fileKind(f.name, f.type))
    return no(f.name + " is not a PDF, JPG or PNG. Only those three can be uploaded. Nothing was sent.");
  return OK;
}
export const mayUpload = (s: ImCtx, WHO: string): boolean => may(s, WHO, "doc");
export const UPLOAD_REFUSED = "Uploading belongs to Finance Operations, Compliance and the Head of Finance.";

type UploadReq = Extract<Paper2Action, { type: "uploadDoc" }>;
/** Everything an upload must satisfy, in order: the seat, the target, the slot, then the file. */
export function uploadGate(s: ImCtx, WHO: string, a: Omit<UploadReq, "type" | "key">): Gate {
  if (!mayUpload(s, WHO)) return no(UPLOAD_REFUSED);
  if (!SCOPES.some(x => x.k === a.Scope)) return no("Pick where the file belongs: Personal, Allotment or Farm.");
  if (!slotOf(a.Scope, a.Doc_Type)) return no("Pick which paper this is.");
  if (a.Scope !== "Project") {
    const x = I(s, WHO, a.Investor);
    if (!x) return no("Pick the investor it belongs to.");
    if (a.Scope === "Allotment" && !(a.LLP && x.blocks[a.LLP]))
      return no(x.n + " holds nothing on that farm, so there is no allotment to file it on.");
  } else if (!a.LLP || !s.data.FARMS.some(f => f.k === a.LLP)) return no("Pick the farm it belongs to.");
  return uploadCheck({ name: a.File_Name, size: a.File_Size, type: a.File_Type });
}
/** One key per chosen file and target — a second press with the same key attaches nothing. */
export const uploadKey = (f: { name: string; size: number; lastModified?: number },
  t: { Scope: ImScope; Doc_Type: string; Investor: string | null; LLP: string | null }): string =>
  [t.Scope, t.Investor || "", t.LLP || "", t.Doc_Type, f.name, f.size, f.lastModified || 0].join("|");
/** the file already in a typed slot (a file-upload field holds one) */
export function slotTaken(s: ImCtx, a: { Scope: ImScope; Doc_Type: string; Investor: string | null; LLP: string | null }): ImUpload | null {
  const sl = slotOf(a.Scope, a.Doc_Type);
  if (!sl || !sl.field) return null;
  return (s.data.UPLOADS || []).find(u => u.Scope === a.Scope && u.Doc_Type === a.Doc_Type
    && (u.Investor || null) === (a.Scope === "Project" ? null : a.Investor) && (u.LLP || null) === (a.Scope === "Personal" ? null : a.LLP)) || null;
}
/** What the upload list shows this seat: an investor's own and allotment papers when the investor is
 *  readable, farm papers to anyone who reads Documents. `inv` narrows it to one investor's record
 *  (their papers plus the farm papers of the farms they hold). */
export function uploadsFor(s: ImCtx, WHO: string, inv?: string): ImUpload[] {
  const all = s.data.UPLOADS || [];
  const x = inv ? I(s, WHO, inv) : null;
  if (inv && !x) return [];
  return all.filter(u => u.Scope === "Project"
    ? (x ? !!x.blocks[u.LLP || ""] : pageReadable(s, WHO, "docs"))
    : !!I(s, WHO, u.Investor) && (!x || u.Investor === x.id));
}
/** where an upload is filed, said plainly */
export function uploadWhere(s: ImCtx, u: Pick<ImUpload, "Scope" | "Investor" | "LLP">): string {
  const farm = u.LLP ? (s.data.FARMS.find(f => f.k === u.LLP) || { n: "Block " + u.LLP }).n : "";
  return u.Scope === "Personal" ? "Personal" : u.Scope === "Allotment" ? "Allotment · " + farm : "Farm · " + farm;
}

/* ============================ M12-S05 signature status ============================ */
export type SignChip = { st: ImSignSt; t: string; c: string };
/** The chip a document row carries. A document that was never signed (a receipt) has none. */
export function signChip(s: ImCtx, d: ImDoc): SignChip | null {
  if (!d.sig) return null;
  const r: ImSign | undefined = (s.data.SIGN || {})[d.id];
  if (d.state === "signed") return { st: "signed", t: "Signed", c: "go" };
  const st = r ? r.st : d.state === "awaiting" ? "sent" : null;
  switch (st) {
    case "sent": return { st, t: "Sent", c: "" };
    case "viewed": return { st, t: "Viewed" + (r && r.viewedAt ? " " + r.viewedAt : ""), c: "due" };
    case "declined": return { st, t: "Declined" + (r && r.why ? " — " + r.why : ""), c: "late" };
    case "expired": return { st, t: "Expired", c: "late" };
    case "recalled": return { st, t: "Recalled", c: "late" };
    case "signed": return { st, t: "Signed", c: "go" };
    default: return null;
  }
}
/** a request still with the investor: it can be reminded or recalled */
export const signOpen = (s: ImCtx, d: ImDoc | null | undefined): boolean => {
  if (!d || !d.sig || d.state !== "awaiting") return false;
  const c = signChip(s, d);
  return !!c && (c.st === "sent" || c.st === "viewed");
};
export const lastReminder = (s: ImCtx, did: string): { at: string; by: string } | null =>
  (((s.data.SIGN || {})[did] || { reminded: [] }).reminded || [])[0] || null;
export function remindGate(s: ImCtx, WHO: string, did: string): Gate {
  if (!may(s, WHO, "doc")) return no("Reminders belong to Finance Operations, Compliance and the Head of Finance.");
  const d = s.data.DOCS.find(x => x.id === did);
  if (!d || !I(s, WHO, d.inv)) return no();
  if (!signOpen(s, d)) return no(d.t + " is not waiting on a signature, so there is nothing to remind anybody of.");
  return OK;
}
export const RECALLWHY = ["Wrong document sent", "Wrong investor or details", "Terms changed", "Investor asked for a new copy"];
export function recallGate(s: ImCtx, WHO: string, did: string, why: string): Gate {
  if (!may(s, WHO, "doc")) return no("Recalling belongs to Finance Operations, Compliance and the Head of Finance.");
  const d = s.data.DOCS.find(x => x.id === did);
  if (!d || !I(s, WHO, d.inv)) return no();
  if (!signOpen(s, d)) return no(d.t + " is not waiting on a signature, so there is nothing to recall.");
  if (!(why || "").trim()) return no("Say why it is being recalled — the reason goes in the log with your name.");
  return OK;
}

/* ============================ M12-S09 a record's emails ============================ */
/* stamps are "31 Aug 19:05" in one year; the newest first */
const stampKey = (t: string): number => {
  const m = /^(\d{2}) (\w{3}) (\d{2}):(\d{2})$/.exec(t); if (!m) return 0;
  const mon = "JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(m[2]) / 3;
  return ((mon * 31 + +m[1]) * 24 + +m[3]) * 60 + +m[4];
};
const newestFirst = (a: RecEmail, b: RecEmail) => stampKey(b.sent_time) - stampKey(a.sent_time);
/** An investor's emails for this viewer, or null when the viewer cannot open the investor (the page
 *  then refuses and nothing is read). A seat that reads the investor sees them; an IR sees them only
 *  for an investor that came from their own lead (D69). */
export function investorEmails(s: ImCtx, WHO: string, id: string): RecEmail[] | null {
  if (!I(s, WHO, id) && !irMayOpen(s, WHO, id)) return null;
  return (s.data.EMAILS || []).filter(e => e.module === "Contacts" && e.record === id).sort(newestFirst);
}
/** A lead's own emails (the caller has already checked the lead opens for this person). */
export const leadEmails = (mail: RecEmail[] | undefined, leadId: string): RecEmail[] =>
  (mail || []).filter(e => e.module === "Leads" && e.record === leadId).sort(newestFirst);
/** The investor a lead became, and that investor's emails — only when the viewer may read the
 *  investor: an Investors-side seat that reads them, or the IR whose own lead it was (D69). */
export function leadInvestorEmails(s: ImCtx, WHO: string, leadId: string): { x: ImInvestor; mail: RecEmail[] } | null {
  const x = s.data.INV.find(i => i.lead === leadId);
  if (!x) return null;
  const mail = investorEmails(s, WHO, x.id);
  return mail ? { x, mail } : null;
}

/* ============================ M09-S08 the IR wall ============================ */
/** The investors an IR may see: those whose originating lead that IR owned at "Said yes"
 *  (Contacts.Originating_IR — `ir` here). Nobody else's, whoever holds the lead today. */
export const irInvestors = (s: ImCtx, irKey: string): ImInvestor[] =>
  !irKey || s.data.P[irKey] ? [] : s.data.INV.filter(x => x.ir === irKey);
/** a direct link to one investor: opens only for the IR it came from */
export const irMayOpen = (s: ImCtx, irKey: string, id: string | null | undefined): boolean =>
  !!id && irInvestors(s, irKey).some(x => x.id === id);
/** The IR's columns: who, which code, which farms, where it stands, which lead — no money, no identity. */
export const IR_COLS = ["Investor", "ARL ID", "Farms", "State", "Lead"] as const;
export type IrRow = { n: string; id: string; farms: string; st: ImInvestor["st"]; lead: string | null };
export const irRow = (x: ImInvestor): IrRow => ({
  n: x.n, id: x.id, st: x.st, lead: x.lead || null,
  farms: Object.entries(x.blocks).map(([k, n]) => "Block " + k + " ×" + n).join(", ") || "—",
});
export const irRows = (s: ImCtx, irKey: string): IrRow[] => irInvestors(s, irKey).map(irRow);

/** who a person is, for an email or upload line */
export const whoName = (s: ImCtx, k: string): string => who(s, k).n;
