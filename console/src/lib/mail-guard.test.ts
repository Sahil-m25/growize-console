import { describe, expect, it } from "vitest";
import { assertMailAllowed, hashRecipient, mailGuardActive, mailRecipientsAllowed, MailBlockedError, SANDBOX_MAIL_BLOCKED } from "./mail-guard";
import { createOutboxMailer, guardAlertMailer } from "../server/ops/alerts";

const SB = { ZOHO_CRM_ENVIRONMENT: "sandbox" };

describe("D131 sandbox mail guard", () => {
  it("production (unset or explicit) is untouched, whatever the allow list says", () => {
    for (const env of [{}, { ZOHO_CRM_ENVIRONMENT: "production" }, { ZOHO_CRM_ENVIRONMENT: " Production ", GZ_SANDBOX_MAIL_ALLOW: "nobody.example" }]) {
      expect(mailGuardActive(env)).toBe(false);
      expect(mailRecipientsAllowed(["real.person@gmail.com", "not even an address"], env)).toBe(true);
      const lines: string[] = [];
      expect(() => assertMailAllowed(["real.person@gmail.com"], "t", env, (l) => lines.push(l))).not.toThrow();
      expect(lines).toEqual([]);
    }
  });

  it("sandbox defaults to agresearchlabs.com: allows it, denies everyone else", () => {
    expect(mailRecipientsAllowed(["tech+gzseed-l1@agresearchlabs.com"], SB)).toBe(true);
    expect(mailRecipientsAllowed(["Tech@AgResearchLabs.com"], SB)).toBe(true);
    expect(mailRecipientsAllowed(["Seed <tech+x@agresearchlabs.com>"], SB)).toBe(true);
    expect(mailRecipientsAllowed(["anand.pillai@gmail.com"], SB)).toBe(false);
    expect(mailRecipientsAllowed(["x@evil-agresearchlabs.com", "x@agresearchlabs.com.evil.io", "x@sub.agresearchlabs.com"], SB)).toBe(false);
    expect(mailRecipientsAllowed(["a@b@agresearchlabs.com"], SB)).toBe(false);
    expect(mailRecipientsAllowed(["garbage"], SB)).toBe(false);
    expect(mailRecipientsAllowed(["x@agresearchlabs.com"], { ...SB, GZ_SANDBOX_MAIL_ALLOW: "  " })).toBe(true);
  });

  it("an unknown environment value fails closed (guard stays on)", () => {
    expect(mailGuardActive({ ZOHO_CRM_ENVIRONMENT: "staging" })).toBe(true);
  });

  it("GZ_SANDBOX_MAIL_ALLOW takes domains and exact addresses", () => {
    const env = { ...SB, GZ_SANDBOX_MAIL_ALLOW: "example.org, @qa.test ,Lead@partner.com" };
    expect(mailRecipientsAllowed(["a@example.org", "b@qa.test", "lead@partner.com"], env)).toBe(true);
    expect(mailRecipientsAllowed(["other@partner.com"], env)).toBe(false);
    expect(mailRecipientsAllowed(["x@agresearchlabs.com"], env)).toBe(false); // an explicit list replaces the default
  });

  it("multi-recipient is all-or-nothing", () => {
    expect(mailRecipientsAllowed(["a@agresearchlabs.com", "b@agresearchlabs.com"], SB)).toBe(true);
    expect(mailRecipientsAllowed(["a@agresearchlabs.com", "real@gmail.com"], SB)).toBe(false);
    expect(mailRecipientsAllowed(["real@gmail.com", "a@agresearchlabs.com"], SB)).toBe(false);
  });

  it("a refusal throws sandbox-mail-blocked and logs only hashes", () => {
    const lines: string[] = [];
    let err: unknown;
    try { assertMailAllowed(["a@agresearchlabs.com", "Real.Person@gmail.com"], "crm-send-mail", SB, (l) => lines.push(l)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(MailBlockedError);
    expect((err as MailBlockedError).code).toBe(SANDBOX_MAIL_BLOCKED);
    expect(String(err)).not.toContain("gmail");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/@|gmail|agresearchlabs/);
    const rec = JSON.parse(lines[0]!);
    expect(rec).toEqual({ event: "sandbox-mail-blocked", path: "crm-send-mail", recipients: [hashRecipient("a@agresearchlabs.com"), hashRecipient("real.person@gmail.com")] });
  });

  it("the alert mailer wrapper refuses a disallowed recipient without delivering, and passes allowed/null through", async () => {
    const prev = { e: process.env.ZOHO_CRM_ENVIRONMENT, a: process.env.GZ_SANDBOX_MAIL_ALLOW };
    process.env.ZOHO_CRM_ENVIRONMENT = "sandbox"; delete process.env.GZ_SANDBOX_MAIL_ALLOW;
    const warn = console.warn; console.warn = () => {};
    try {
      const inner = createOutboxMailer();
      const m = guardAlertMailer(inner);
      await m.send({ to: "ops@agresearchlabs.com", subject: "s", text: "t" });
      await m.send({ to: null, subject: "s", text: "t" });
      await expect(m.send({ to: "ops@agresearchlabs.com, boss@gmail.com", subject: "s", text: "t" })).rejects.toBeInstanceOf(MailBlockedError);
      expect(inner.sent()).toHaveLength(2);
      process.env.ZOHO_CRM_ENVIRONMENT = "production";
      await m.send({ to: "boss@gmail.com", subject: "s", text: "t" });
      expect(inner.sent()).toHaveLength(3);
    } finally {
      console.warn = warn;
      if (prev.e === undefined) delete process.env.ZOHO_CRM_ENVIRONMENT; else process.env.ZOHO_CRM_ENVIRONMENT = prev.e;
      if (prev.a === undefined) delete process.env.GZ_SANDBOX_MAIL_ALLOW; else process.env.GZ_SANDBOX_MAIL_ALLOW = prev.a;
    }
  });
});
