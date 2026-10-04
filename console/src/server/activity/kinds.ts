/**
 * M15-S03 — WHAT KIND OF THING HAPPENED, AND ON WHICH SIDE, from a Zoho module and action.
 *
 * The archive keeps the raw module and action codes; the kind is decided at read time, so this table can
 * change without rewriting an append-only archive. The kind vocabularies are the prototype's two KINDS
 * (lead side: vActivity; Investors side: vAct). PROVISIONAL: the module → kind table is ours, from the
 * modules the console writes (server/data/projections.ts MODULES and the lead-side activity modules);
 * the live audit export's module labels are confirmed on the sandbox (M02-S10).
 */

export type Side = "lead" | "investors";
export const SIDES: readonly Side[] = Object.freeze(["lead", "investors"]);

export const LEAD_KINDS: Readonly<Record<string, string>> = Object.freeze({
  msg: "WhatsApp", call: "Calls", email: "Emails", visit: "Visits", stage: "Stages", mat: "Material", pack: "Pack",
  money: "Payments", doc: "Documents", admin: "Admin", roster: "Roster", note: "Notes",
});
export const INVESTOR_KINDS: Readonly<Record<string, string>> = Object.freeze({
  money: "Money", doc: "Documents", pii: "Identity", kyc: "KYC", tkt: "Tickets", upd: "Updates", farm: "Land", care: "Account care", admin: "Admin",
});
export const kindsOf = (side: Side): Readonly<Record<string, string>> => (side === "lead" ? LEAD_KINDS : INVESTOR_KINDS);

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Module (api name or label, any case) → side and kind. Unknown modules are not listed on either side. */
const MODULE_KIND: Readonly<Record<string, readonly [Side, string]>> = Object.freeze({
  leads: ["lead", "stage"], calls: ["lead", "call"], emails: ["lead", "email"], email: ["lead", "email"],
  events: ["lead", "visit"], meetings: ["lead", "visit"], notes: ["lead", "note"], tasks: ["lead", "note"],
  whatsapp: ["lead", "msg"], whatsapp_messages: ["lead", "msg"], lead_claims: ["lead", "money"], claims: ["lead", "money"],
  contacts: ["investors", "care"], cases: ["investors", "tkt"], receipts: ["investors", "money"], arl_transactions: ["investors", "money"],
  payments: ["investors", "money"], llp_unitallocation_module: ["investors", "farm"], llp_creation_module: ["investors", "farm"],
  arl_holdings: ["investors", "farm"], investor_updates: ["investors", "upd"], attachments: ["investors", "doc"], documents: ["investors", "doc"],
  users: ["investors", "admin"], roles: ["investors", "admin"], profiles: ["investors", "admin"],
});

/** The modules a record id can be checked in with COQL (the reader's own token). */
export const CHECKABLE_MODULES: Readonly<Record<string, string>> = Object.freeze({
  leads: "Leads", calls: "Calls", events: "Events", meetings: "Events", tasks: "Tasks", notes: "Notes",
  contacts: "Contacts", cases: "Cases", receipts: "Receipts", arl_transactions: "ARL_Transactions",
  llp_unitallocation_module: "LLP_UnitAllocation_Module", llp_creation_module: "LLP_Creation_Module", arl_holdings: "ARL_Holdings",
  investor_updates: "Investor_Updates",
});
export const checkableModule = (module: string): string | null => CHECKABLE_MODULES[norm(module)] ?? null;

export function classify(module: string, action: string): { readonly side: Side; readonly kind: string } | null {
  const m = MODULE_KIND[norm(module)];
  if (!m) return null;
  const a = norm(action);
  // A Contact's KYC fields and a user's roster changes read as their own kinds.
  if (m[1] === "care" && /kyc/.test(a)) return { side: m[0], kind: "kyc" };
  if (m[0] === "investors" && m[1] === "admin" && /role|profile|territor/.test(a)) return { side: m[0], kind: "admin" };
  return { side: m[0], kind: m[1] };
}

/** Plane C actions (D47) shown on the Activity page: reveals and step-ups are Identity; seat, grant, console-access
 *  and reporting-line changes and a test sign-in link (M10-S23) are Admin; an app-access release (M08-S08-NOTE-10)
 *  is Account care. */
export const PLANE_C_ADMIN: ReadonlySet<string> = new Set(["seat-change", "grant-change", "access-granted", "access-ended", "manager-change",
  "test-link-issued"]);
export function classifyPlaneC(action: string): { readonly side: Side; readonly kind: string } | null {
  if (action === "reveal" || action === "step-up") return { side: "investors", kind: "pii" };
  if (action === "app-access-released") return { side: "investors", kind: "care" };
  if (PLANE_C_ADMIN.has(action)) return { side: "investors", kind: "admin" };
  return null;
}

const LEAD_VERB: Readonly<Record<string, string>> = Object.freeze({
  msg: "WhatsApp sent", call: "Call logged", email: "Email sent", visit: "Visit recorded", stage: "Lead updated",
  mat: "Material sent", pack: "Produce pack", money: "Recorded payment", doc: "Sent document", admin: "Admin action", roster: "Roster change", note: "Note added",
});

/** The row's one-line description: the action and the module, never a value. */
export function describe(side: Side, kind: string, action: string, module: string): string {
  const verb = action.replace(/[-_]+/g, " ").trim();
  const v = verb ? verb[0]!.toUpperCase() + verb.slice(1) : "Changed";
  if (side === "lead" && (kind === "call" || kind === "msg" || kind === "email" || kind === "visit" || kind === "note") && /^(added|created)$/i.test(verb)) return LEAD_VERB[kind]!;
  return `${v} · ${module.replace(/_/g, " ")}`;
}
