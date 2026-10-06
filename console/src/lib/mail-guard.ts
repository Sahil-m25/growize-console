/**
 * D131 — the sandbox mail sink. One guard for every outbound mail path (CRM send_mail, Zoho Sign recipients, the alert mailer).
 *
 * When ZOHO_CRM_ENVIRONMENT is not production (i.e. "sandbox"; any unknown value fails closed too), a message may leave only if
 * EVERY recipient matches GZ_SANDBOX_MAIL_ALLOW: a comma-separated list of domains ("agresearchlabs.com") and/or exact addresses
 * ("qa@example.com"). Unset or empty -> "agresearchlabs.com". All-or-nothing: one disallowed or malformed recipient refuses the lot.
 * Production behaviour is untouched. A refusal is the code `sandbox-mail-blocked`; the log line carries a hash of each recipient, never the address.
 */
import { createHash } from "node:crypto";

export const SANDBOX_MAIL_BLOCKED = "sandbox-mail-blocked" as const;
export const DEFAULT_SANDBOX_MAIL_ALLOW = "agresearchlabs.com";

type EnvLike = Readonly<Record<string, string | undefined>>;
const processEnv = (): EnvLike => (typeof process !== "undefined" && process.env ? process.env : {});

export class MailBlockedError extends Error {
  readonly code = SANDBOX_MAIL_BLOCKED;
  constructor() { super(`${SANDBOX_MAIL_BLOCKED}: a recipient is outside GZ_SANDBOX_MAIL_ALLOW; nothing was sent.`); this.name = "MailBlockedError"; }
}

/** True when the deployment is anything but production — the guard is then enforced. */
export function mailGuardActive(env: EnvLike = processEnv()): boolean {
  const v = (env.ZOHO_CRM_ENVIRONMENT ?? "").trim().toLowerCase();
  return !(v === "" || v === "production");
}

const normalize = (raw: string): string | null => {
  const m = /<([^<>]+)>\s*$/.exec(raw.trim());
  const a = (m ? m[1]! : raw).trim().toLowerCase();
  const at = a.indexOf("@");
  return at > 0 && at === a.lastIndexOf("@") && at < a.length - 1 && !/\s/.test(a) ? a : null;
};

export function sandboxMailAllowList(env: EnvLike = processEnv()): { readonly domains: ReadonlySet<string>; readonly addresses: ReadonlySet<string> } {
  const raw = (env.GZ_SANDBOX_MAIL_ALLOW ?? "").trim() || DEFAULT_SANDBOX_MAIL_ALLOW;
  const domains = new Set<string>(), addresses = new Set<string>();
  for (const part of raw.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean)) {
    if (part.includes("@") && !part.startsWith("@")) addresses.add(part);
    else domains.add(part.replace(/^@/, ""));
  }
  return { domains, addresses };
}

/** Pure check: does this recipient list pass? Production: always. Sandbox: every recipient allowed, and at least the list is well-formed. */
export function mailRecipientsAllowed(recipients: readonly string[], env: EnvLike = processEnv()): boolean {
  if (!mailGuardActive(env)) return true;
  const { domains, addresses } = sandboxMailAllowList(env);
  return recipients.every((r) => {
    const a = typeof r === "string" ? normalize(r) : null;
    return a !== null && (addresses.has(a) || domains.has(a.slice(a.indexOf("@") + 1)));
  });
}

export const hashRecipient = (r: string): string => createHash("sha256").update(String(r).trim().toLowerCase()).digest("hex").slice(0, 12);

/**
 * Throws MailBlockedError (and writes one log line with hashed recipients) when the send must be refused. Call BEFORE any network
 * call, so a refused send is never partial. `path` names the caller ("crm-send-mail", "sign-submit", "alert").
 */
export function assertMailAllowed(recipients: readonly string[], path: string, env: EnvLike = processEnv(), sink: (line: string) => void = (l) => console.warn(l)): void {
  if (mailRecipientsAllowed(recipients, env)) return;
  try { sink(JSON.stringify({ event: SANDBOX_MAIL_BLOCKED, path, recipients: recipients.map(hashRecipient) })); } catch { /* logging never changes the refusal */ }
  throw new MailBlockedError();
}
