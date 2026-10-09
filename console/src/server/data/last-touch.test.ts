/* W2-IRB-2: a follow-up saved as "Interested" / "Not now" reads back under that outcome, not as "Reply received" / "Connected". */
import { describe, expect, it } from "vitest";
import { lastTouchOf, stampOf } from "./live";
import { fuLatest } from "@/features/today/work";
import type { Lead } from "@/domain/types";

const L1 = "1454168000000000001";
const row = (o: Record<string, unknown>) => ({ Lead: { id: L1 }, ...o }) as never;

describe("last touch with its outcome", () => {
  it("reads the outcome off Note (before ' — '), inbound from Is_Reply, newest wins, a voided touch is skipped", () => {
    const m = lastTouchOf([
      row({ Channel: "Call", Occurred_At: "2026-10-08T10:00:00+05:30", Is_Reply: false, Note: "Connected" }),
      row({ Occurred_At: "2026-10-08T22:15:00+05:30", Is_Reply: true, Note: "Interested — call back tomorrow" }),
      row({ Channel: "Call", Occurred_At: "2026-10-09T09:00:00+05:30", Is_Reply: false, Note: "Not now", Voided_At: "2026-10-09T09:05:00+05:30" }),
    ]);
    expect(m.get(L1)).toEqual({ channel: "reply", outcome: "Interested", at: stampOf("2026-10-08T22:15:00+05:30") });
  });
  it("W3-E2E-1: a WhatsApp touch saved as 'Reply received' (Is_Reply true, Channel set) keeps WhatsApp; only a channel-less reply is 'reply'", () => {
    const wa = lastTouchOf([row({ Channel: "WhatsApp", Occurred_At: "2026-10-09T11:53:00+05:30", Is_Reply: true, Note: "Reply received" })]);
    expect(wa.get(L1)).toMatchObject({ channel: "msg", outcome: "Reply received" });
    const bare = lastTouchOf([row({ Occurred_At: "2026-10-09T11:53:00+05:30", Is_Reply: true, Note: "Reply received" })]);
    expect(bare.get(L1)).toMatchObject({ channel: "reply" });
  });
  it("W4-E-3: two touches in the same minute - the one entered last wins whatever order the rows come in (Created_Time, then id)", () => {
    const call = row({ id: "1454168000003084069", Channel: "Call", Occurred_At: "2026-10-09T18:38:00+05:30", Created_Time: "2026-10-09T18:38:05+05:30", Is_Reply: false, Note: "Connected" });
    const wa = row({ id: "1454168000003021149", Channel: "WhatsApp", Occurred_At: "2026-10-09T18:38:00+05:30", Created_Time: "2026-10-09T18:38:41+05:30", Is_Reply: true, Note: "Reply received" });
    for (const rows of [[wa, call], [call, wa]]) expect(lastTouchOf(rows).get(L1)).toMatchObject({ channel: "msg", outcome: "Reply received" });
    /* no Created_Time on either: the higher id is the later entry */
    const a = row({ id: "1454168000000000010", Channel: "Call", Occurred_At: "2026-10-09T18:38:00+05:30", Note: "Connected" });
    const b = row({ id: "1454168000000000020", Channel: "WhatsApp", Occurred_At: "2026-10-09T18:38:00+05:30", Note: "Reply received" });
    for (const rows of [[a, b], [b, a]]) expect(lastTouchOf(rows).get(L1)).toMatchObject({ channel: "msg" });
  });
  it("a touch with no outcome (older rows) says nothing, so the generic line stands", () => {
    expect(lastTouchOf([row({ Channel: "Call", Occurred_At: "2026-10-08T10:00:00+05:30", Is_Reply: false })]).size).toBe(0);
  });
  it("fuLatest shows the saved outcome in place of the generic 'Reply received' for the same moment", () => {
    const at = stampOf("2026-10-08T22:15:00+05:30");
    const l = { id: L1, own: "u1", touch: { msg: [], email: [], call: [], visit: [] }, reply: at, lastTouch: { channel: "reply", outcome: "Not now", at } } as unknown as Lead;
    const last = fuLatest({ NOW: new Date(2026, 9, 9) } as never, l);
    expect([last?.channel, last?.outcome, last?.at]).toEqual(["reply", "Not now", at]);
    const plain = fuLatest({ NOW: new Date(2026, 9, 9) } as never, { ...l, lastTouch: undefined } as Lead);
    expect(plain?.outcome).toBe("Reply received");
  });
});
