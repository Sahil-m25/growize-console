/* M19-S06-T01 — the NDA gate: no deck (or webinar) email before the NDA is back signed (D60, EMMAT).
 * Drives the real sender (server/leads/email.ts) with a stubbed CRM; no request leaves the process. */
import { beforeAll, describe, expect, it } from "vitest";
import { createEmailSender, EMAIL_REASON, EMAIL_TEMPLATES, type NdaReader } from "../leads/email";
import { userCredential, type UserCredential } from "../../lib/zoho/client";
import { createMemorySink, createOpsLog } from "../../lib/zoho/log";

const P = "9007199254";
const IR = `${P}740995001`;
const LEAD = `${P}740996101`;
const LOADED = "2026-09-27T09:00:00+05:30";
const now = Date.parse("2026-09-28T05:30:00Z");
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });

let credential: UserCredential;
beforeAll(async () => {
  credential = await userCredential({ access_token: "synthetic-token", api_domain: "https://www.zohoapis.in", expires_in: 3_600 },
    { recordIdPrefix: P, gate: gate(), log: createOpsLog(createMemorySink()), clock: () => now,
      fetch: async () => new Response(JSON.stringify({ users: [{ id: IR, status: "active" }] }), { status: 200 }) } as never);
});

function rig(nda: NdaReader | null) {
  const sent: string[] = [];
  const crm = {
    async getRecord() {
      return { ok: true, value: { id: LEAD, Modified_Time: LOADED, Owner: { id: IR }, Email: "synthetic.lead@example.com",
        Consent_Email: true, Email_Opt_Out: false, Full_Name: "Synthetic Lead", Lost_At: null } };
    },
    async fromAddresses() { return { ok: true, value: [{ email: "synthetic.ir@agresearchlabs.com", type: "primary", userName: null, isDefault: true }] }; },
    async sendMail(_c: unknown, _m: string, id: string) { sent.push(id); return { ok: true, value: { sent: true, messageId: "m1" } }; },
    async update() { return { ok: true, value: { id: LEAD } }; },
  };
  // M12-S13: the deck goes out only through the deck mailer (the approved deck attached).
  const deck = { async send(_c: unknown, id: string) { sent.push(id); return { ok: true, value: { sent: true, messageId: "d1" } }; } };
  const access = { async recheck(c: UserCredential) { return { actor: { userId: c.userId }, mayRecordFollowup: true, teamOwnerIds: [] }; } };
  const followups = { async save() { return { ok: true, value: { touchId: `${P}740997701` } }; } };
  const svc = createEmailSender({ crm, followups, access, log: createOpsLog(createMemorySink()), recordIdPrefix: P,
    orgDomains: ["agresearchlabs.com"], nda, deck, clock: () => now } as never);
  const send = (template: string) => svc.send({ credential, sessionId: "session_fixture_rules_0001" },
    { leadId: LEAD, expectedModifiedTime: LOADED, template, subject: "Growize", message: "Hello" });
  return { send, sent };
}

describe("NDA gate", () => {
  it("only the material templates (deck, webinar) need the NDA", () => {
    expect(Object.entries(EMAIL_TEMPLATES).filter(([, t]) => t.needsNda).map(([k]) => k).sort()).toEqual(["deck", "webinar"]);
  });
  it("refuses the deck when the NDA is not back — and sends nothing", async () => {
    const r = rig({ async signed() { return false; } });
    const res = await r.send("deck");
    expect(res).toEqual({ ok: false, kind: "refused", reasonCode: "nda-not-back", reason: EMAIL_REASON["nda-not-back"] });
    expect(r.sent).toEqual([]);
  });
  it("fails closed with no NDA reader or a reader that throws", async () => {
    for (const nda of [null, { async signed(): Promise<boolean> { throw new Error("sign down"); } }]) {
      const r = rig(nda);
      expect(await r.send("webinar")).toMatchObject({ ok: false, reasonCode: "nda-not-back" });
      expect(r.sent).toEqual([]);
    }
  });
  it("sends the deck once the NDA is signed, and the intro never waits for it", async () => {
    const signed = rig({ async signed(_c, id) { return id === LEAD; } });
    expect(await signed.send("deck")).toMatchObject({ ok: true, value: { sent: true } });
    const none = rig(null);
    expect(await none.send("intro")).toMatchObject({ ok: true, value: { sent: true } });
    expect(none.sent).toEqual([LEAD]);
  });
});
