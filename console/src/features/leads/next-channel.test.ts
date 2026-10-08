/* B-25 — the next-step drawer never defaults to a channel the lead gave no permission for: picking "Call back" on a lead with
   no call permission leaves the channel on "other" (so Save is not a 403 no-consent), and with permission it is "call". */
import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer, type ConsoleState } from "@/lib/state";
import type { Lead, PersonKey } from "@/domain";

const signedIn = (): ConsoleState => reducer(initialState(demoBook()), { type: "signIn", k: "rohit" as PersonKey });
function withLead(patch: Partial<Lead>): { state: ConsoleState; id: string } {
  const s = signedIn();
  const target = s.LEADS.find((l) => l.own === "rohit" && !l.lost && !l.nx);
  if (!target) throw new Error("no open lead without a next step in rohit's demo book");
  const state = { ...s, LEADS: s.LEADS.map((l) => (l.id === target.id ? { ...l, ...patch } as Lead : l)) };
  return { state, id: target.id };
}
const open = (s: ConsoleState, id: string) => reducer(s, { type: "openDrawer", k: "next", id } as never);
const pick = (s: ConsoleState, t: string) => reducer(s, { type: "setNXD", k: "t", v: t } as never);
const ch = (s: ConsoleState) => (s.ui as { NXD?: { ch?: string } }).NXD?.ch;

describe("next-step channel default (B-25)", () => {
  it("no permission on any channel: Call back keeps the channel on other", () => {
    const { state, id } = withLead({ consent: false, con: {} });
    const s = pick(open(state, id), "Call back");
    expect(s.DRW).toMatchObject({ k: "next", id });
    expect(ch(s)).toBe("other");
  });
  it("permission on WhatsApp only: Call back is other", () => {
    const { state, id } = withLead({ consent: true, con: { msg: true, call: false, email: false } });
    expect(ch(pick(open(state, id), "Call back"))).toBe("other");
  });
  it("permission on call: Call back is call", () => {
    const { state, id } = withLead({ consent: true, con: { msg: false, call: true, email: false } });
    expect(ch(pick(open(state, id), "Call back"))).toBe("call");
  });
});
