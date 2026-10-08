/* B-06a — receipts (and Finance's payment-report answers) are switched off until two secrets are set. The gate says exactly
 * which setting is wrong, by NAME, in the server log — never a value — and the page reads an honest sentence, not "once it
 * is connected". Run: npx vitest run src/app/api/receipts/compose-config.test.ts */
import { afterEach, describe, expect, it, vi } from "vitest";
import { RECEIPTS_OFF, receiptsConfigProblems, receiptsConfigured } from "./compose";

const PREFIX = { ZOHO_CRM_RECORD_ID_PREFIX: "554023" };
const env = (o: Record<string, string | undefined>) => ({ ...PREFIX, ...o }) as unknown as NodeJS.ProcessEnv;
const I = "i".repeat(32), C = "c".repeat(48);

afterEach(() => vi.restoreAllMocks());

describe("receiptsConfigProblems", () => {
  it("is empty with a prefix and two distinct secrets of at least 32 bytes", () => {
    expect(receiptsConfigProblems(env({ RECEIPT_IDEMPOTENCY_SECRET: I, RECEIPT_CONTEXT_SIGNING_SECRET: C }))).toEqual([]);
  });
  it("names each missing secret", () => {
    expect(receiptsConfigProblems(env({}))).toEqual(["RECEIPT_IDEMPOTENCY_SECRET is missing", "RECEIPT_CONTEXT_SIGNING_SECRET is missing"]);
    expect(receiptsConfigProblems(env({ RECEIPT_IDEMPOTENCY_SECRET: I }))).toEqual(["RECEIPT_CONTEXT_SIGNING_SECRET is missing"]);
  });
  it("names a secret under 32 bytes, identical secrets and a bad prefix", () => {
    expect(receiptsConfigProblems(env({ RECEIPT_IDEMPOTENCY_SECRET: "short", RECEIPT_CONTEXT_SIGNING_SECRET: C })))
      .toEqual(["RECEIPT_IDEMPOTENCY_SECRET is shorter than 32 bytes"]);
    expect(receiptsConfigProblems(env({ RECEIPT_IDEMPOTENCY_SECRET: C, RECEIPT_CONTEXT_SIGNING_SECRET: C })))
      .toEqual(["RECEIPT_IDEMPOTENCY_SECRET and RECEIPT_CONTEXT_SIGNING_SECRET are the same value; they must differ"]);
    expect(receiptsConfigProblems({ RECEIPT_IDEMPOTENCY_SECRET: I, RECEIPT_CONTEXT_SIGNING_SECRET: C } as unknown as NodeJS.ProcessEnv))
      .toEqual(["ZOHO_CRM_RECORD_ID_PREFIX is missing or not 6–16 digits"]);
  });
});

describe("receiptsConfigured", () => {
  it("is false while a secret is missing, and logs the names once — never a value", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = /* synthetic, never-live */ "s3cr3t-value-that-must-never-be-logged-xxxxxxxxxx";
    expect(receiptsConfigured(env({ RECEIPT_IDEMPOTENCY_SECRET: secret }))).toBe(false);
    expect(receiptsConfigured(env({ RECEIPT_IDEMPOTENCY_SECRET: secret }))).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
    const line = String(err.mock.calls[0][0]);
    expect(line).toMatch(/RECEIPT_CONTEXT_SIGNING_SECRET is missing/);
    expect(line).not.toContain(secret);
    expect(receiptsConfigured(env({ RECEIPT_IDEMPOTENCY_SECRET: I, RECEIPT_CONTEXT_SIGNING_SECRET: C }))).toBe(true);
  });
  it("the page's sentence says receipts are switched off, names no setting and no value", () => {
    expect(RECEIPTS_OFF).toMatch(/switched off/);
    expect(RECEIPTS_OFF).not.toMatch(/RECEIPT_|once it is connected/);
  });
});
