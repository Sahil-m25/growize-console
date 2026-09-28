/* ── @/lib/data — THE ONE DATA INTERFACE (phase 1) ───────────────────────────────────────────
   Every record collection the console holds arrives through a `Dataset`. Pages never import a
   record: the client store hydrates from `GET /api/data`, which asks `getSource()`. Constants that
   are product rules or copy (LADDER, ST, NAV, SEAT, PAGECAPS, KINDS, CKS, HELP…) stay in
   `@/domain`; nothing here is a rule, everything here is a record.

   The clock travels as a naive wall-clock ISO string ("2026-08-28T00:00") read in Asia/Kolkata
   (CLAUDE.md rule 9) — see ./clock.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type {
  Absence, Account, CallRec, CapGrid, Check, Claim, Cover, DocRec, EventRec, ExtRec, InteractionRec, Inventory, Lead,
  LeadId, LogEntry, MoveReq, Note, PaperRow, PayRec, Person, PersonKey, Plan, RecovRec,
  Sendable, SheetRec, Stamp, TempGrant, XferRow,
} from "@/domain";
import type { ImData, RecEmail } from "@/lib/im";

/* ---- the Finance projection the lead side reads (Investors pages → lead) ------------------- */
export type FinancePaymentRow = {
  id: string; kind: string; amount: number; mode: string; reference: string; on: string;
  recordedBy: string; recordedByName: string; reconciliation: string; note: string | null;
  reversed?: boolean;
};
export type FinanceDocumentRow = {
  id: string; title: string; class: string; state: string;
  sentOn: string | null; sentBy: string; sentByName: string;
  signatureMethod: string | null; signatureReference: string | null; completedOn: string | null;
  verifiedBy: string | null; verifiedByName: string | null; expiresOn: string | null; reason: string | null;
};
export type FinanceAccount = {
  leadId: string; accountId: string; holdEnds: string | null;
  payments: FinancePaymentRow[]; documents: FinanceDocumentRow[]; units: number; unitPrice: number;
};
export type FinanceMirror = { source: string; mode: string; accounts: FinanceAccount[] };

/* ---- the dataset ---------------------------------------------------------------------------- */
export type Dataset = {
  /** the lead side's clock, naive wall-clock ISO in Asia/Kolkata */
  NOW: string;
  TODAY: string;
  LEADS: Lead[];
  PEOPLE: Record<PersonKey, Person>;
  /** who may be offered on the sign-in screen, in the record's order (admission decides) */
  SIGNINS: PersonKey[];
  PLAN: Plan;
  EVENTS: EventRec[];
  LOG: LogEntry[];
  DOCS: DocRec[];
  INV: Inventory;
  TEMP: TempGrant[];
  /** the prototype's GRANT — per-person capability overrides */
  GRANT: Record<PersonKey, CapGrid>;
  COVER: Record<PersonKey, Cover>;
  AVAIL: Record<PersonKey, Absence>;
  PAY: Record<LeadId, PayRec>;
  CLAIM: Record<LeadId, Claim>;
  CLAIMARCHIVE: Record<LeadId, Claim[]>;
  REQ: Record<LeadId, MoveReq>;
  EXT: Record<LeadId, ExtRec>;
  XFER: XferRow[];
  ACCT: Record<LeadId, Account>;
  /** the last ARL ID minted; the next one is this plus one */
  ARLSEQ: number;
  PAPER: Record<LeadId, PaperRow>;
  SENT: Record<LeadId, Partial<Record<Sendable, string>>>;
  NOTES: Record<LeadId, Note[]>;
  CALLS: Record<LeadId, CallRec>;
  PACK: Record<LeadId, number>;
  PACKAT: Record<string, Stamp>;
  RECOV: Record<string, RecovRec>;
  SHEET: Record<string, SheetRec>;
  INTERACTIONS: Record<LeadId, InteractionRec[]>;
  /** the event sheet's sample rows — the names and notes a sheet load mints leads from */
  SHEETNAMES: string[];
  SHEETNOTES: string[];
  FINMIRROR: FinanceMirror;
  /** System's checks — who owns each part and since when it has been in its state (records, not
   *  rules: the demo list is in `console/fixtures/book/system.ts`); absent = none recorded */
  CHECKS?: Check[];
  /** a lead's emails, as the Zoho CRM Emails API returns them (M12-S09); absent = none */
  LEADMAIL?: RecEmail[];
  /** the lead and event a fresh session opens on, when the book has them */
  LEAD: LeadId;
  EVID: string;
  /** the Investors side */
  im: ImData;
  /** fixture mode only: a clock fixture's pinned time of day on NOW ("HH:mm"); absent = the wall clock's hour */
  CLOCKPIN?: string | null;
  /** fixture mode only: the "How the merge works" panel's content (it names demo people, so it is
   *  data that travels with the demo book, never a bundled module); absent = none */
  MERGENOTES?: NoteBlock[];
};

/* ---- fixture-mode prototype documentation ("How the merge works") -------------------------- */
/** a run of text; `b` = bold */
export type NoteRun = { t: string; b?: boolean };
/** a "try them" chip: sign in as `k`, open `page` (on `side`, if given) */
export type NoteStep = { k: PersonKey; page: string; side?: "im"; t: string };
export type NoteBlock =
  | { kind: "h"; t: string }
  | { kind: "p"; runs: NoteRun[] }
  | { kind: "table"; head: string[]; rows: NoteRun[][][] }
  | { kind: "steps"; steps: NoteStep[] }
  | { kind: "ul"; items: NoteRun[][] };

/** Where records come from. Phase 1: the fixture book or nothing; phase 2: Zoho. */
export interface DataSource {
  load(): Promise<Dataset>;
}

/** What `GET /api/data` answers. `actions` are lead-side store actions a fixture asks the client to
 *  dispatch after hydrating; `version` changes whenever the applied fixtures do. */
export type DataPayload = { ds: Dataset; actions: unknown[]; version: number; fixtures: boolean };
