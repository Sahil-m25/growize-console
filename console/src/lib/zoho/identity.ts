/**
 * THE IDENTITY WALL, CONSOLE SIDE (M02-S04, D13/D22/D52 point 8, rule 7).
 *
 * Zoho's field-level security is the wall; this is our own guard behind it. A record GET never asks
 * for pan / bank_account / Aadhaar_Number, so they are not on the wire until a reveal, which is a second
 * GET `?fields=<one field>` behind a reason and step-up (M01-S10). Everything shown by default is a mask.
 */

export const IDENTITY_FIELDS = ["pan", "bank_account", "Aadhaar_Number"] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

/** Who may reveal what (Zoho FLS: pan = Head of Finance + Compliance; bank_account = Head of Finance + Finance). Aadhaar: nobody. */
export const REVEAL_ROLES: Readonly<Record<"pan" | "bank_account", readonly string[]>> = {
  pan: ["head_of_finance", "compliance"],
  bank_account: ["head_of_finance", "finance"],
};

export const canReveal = (role: string, field: "pan" | "bank_account"): boolean => REVEAL_ROLES[field].includes(role);

/** Record GET fields: the caller's list minus every identity field. */
export const safeFields = (fields: readonly string[]): string[] => fields.filter((f) => !(IDENTITY_FIELDS as readonly string[]).includes(f));

/** The reveal call's only field. Anything but a revealable field, or a seat without the right, is refused. */
export function revealFields(role: string, field: string): string[] {
  if (field !== "pan" && field !== "bank_account") throw new Error("not revealable: " + field);
  if (!canReveal(role, field)) throw new Error("seat may not reveal " + field);
  return [field];
}

/** 'AFT•••••L' — first three and last one of a PAN. */
export const maskPan = (v: string): string => (v.length < 5 ? "•".repeat(v.length) : v.slice(0, 3) + "•••••" + v.slice(-1));
/** '•••• •••• 1208' — last four only, for a bank account or an Aadhaar. */
export const maskLast4 = (v: string): string => "•••• •••• " + v.replace(/\s/g, "").slice(-4);

/** Response shaper: a record from Zoho comes out with masked forms only, whatever it carried. */
export function shapeIdentity<T extends Record<string, unknown>>(rec: T): Omit<T, IdentityField> & { pan_masked?: string; bank_masked?: string; aadhaar_masked?: string } {
  const { pan, bank_account, Aadhaar_Number, ...rest } = rec as Record<string, unknown>;
  const out: Record<string, unknown> = { ...rest };
  if (typeof pan === "string" && pan) out.pan_masked = maskPan(pan);
  if (typeof bank_account === "string" && bank_account) out.bank_masked = maskLast4(bank_account);
  if (typeof Aadhaar_Number === "string" && Aadhaar_Number) out.aadhaar_masked = maskLast4(Aadhaar_Number);
  return out as never;
}

const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const ACCOUNT_RE = /\b\d{9,18}\b/g;
const AADHAAR_RE = /\b\d{4}\s\d{4}\s\d{4}\b/g;

/** safeNote: a PAN, Aadhaar or account number typed into a note or log line is masked for a seat that may not read it. */
export function safeNote(text: string, role: string): string {
  let t = text.replace(AADHAAR_RE, maskLast4);
  if (!canReveal(role, "pan")) t = t.replace(PAN_RE, maskPan);
  if (!canReveal(role, "bank_account")) t = t.replace(ACCOUNT_RE, maskLast4);
  return t;
}
