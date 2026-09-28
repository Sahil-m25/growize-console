/* ── im/paper2-types.ts — uploads, Zoho Sign status and record emails (not in the prototype) ──
   D71 (upload straight from the console: Attachments API / ZFS + file-upload fields, 20 MB, an
   allowlist, the uploader's own token, no copy kept), D72 (Zoho Sign status from webhooks, remind
   and recall; a record's emails through the Zoho CRM Emails API with the viewer's own token) and
   D69 (an IR sees an investor only when the investor came from that IR's own lead).

   Field names follow pm/plan-merged/zoho-field-mapping.json: the "Documents" module row (Doc_Type,
   Scope, Investor, Allotment, LLP, Sign_Request_Id, Sent_At, Signed_At, File) and the Emails API's
   own keys (from, to, subject, sent_time, content, message_id), so phase 2 swaps the source only.
   ────────────────────────────────────────────────────────────────────────────────────────── */

/** Documents.Scope (D70): personal papers live on the Contact, agreements on the allotment, farm
 *  papers on the LLP. */
export type ImScope = "Personal" | "Allotment" | "Project";

/** One file uploaded from the console (M12-S02). Phase 1 keeps what the list shows — never the file. */
export type ImUpload = {
  id: string;
  Scope: ImScope;
  /** Documents.Doc_Type — the typed slot ("Signed NDA") or "Other" for a free attachment */
  Doc_Type: string;
  /** Investor → Contacts (ARL id); null for a Project upload */
  Investor: string | null;
  /** the farm LLP's Block_Code for an Allotment or Project upload; null for Personal */
  LLP: string | null;
  /** File — the name, size (bytes) and type of the file as chosen */
  File_Name: string;
  File_Size: number;
  File_Type: string;
  /** who uploaded it and when (Zoho records the uploader from their own token) */
  by: string;
  at: string;
  /** the double-press guard: one key per chosen file and target; a second press with it is ignored */
  key: string;
};

/** A Zoho Sign request's status (webhook values, D72). */
export type ImSignSt = "sent" | "viewed" | "signed" | "declined" | "expired" | "recalled";
/** What the console knows of one document's Zoho Sign request, by document id. */
export type ImSign = {
  Sign_Request_Id: string;
  st: ImSignSt;
  /** when the investor opened it (the "viewed" webhook) */
  viewedAt?: string;
  /** a decline's reason, or a recall's */
  why?: string;
  /** reminders sent, newest first */
  reminded?: { at: string; by: string }[];
  recalled?: { at: string; by: string };
};

/** One email on a record, as the Zoho CRM Emails API returns it (GET /{module}/{id}/Emails). */
export type RecEmail = {
  message_id: string;
  /** the record it is filed on: an investor (Contacts, ARL id) or a lead (Leads, lead id) */
  module: "Contacts" | "Leads";
  record: string;
  from: { user_name: string; email: string };
  to: { user_name: string; email: string }[];
  subject: string;
  /** "31 Aug 19:05" — the book's own stamp format */
  sent_time: string;
  /** the body, shown read-only; never stored outside Zoho in phase 2 */
  content: string;
};

export type Paper2Action =
  | {
      type: "uploadDoc"; key: string; Scope: ImScope; Doc_Type: string; Investor: string | null; LLP: string | null;
      File_Name: string; File_Size: number; File_Type: string;
    }
  | { type: "remindSign"; did: string }
  | { type: "recallSign"; did: string; why: string };
