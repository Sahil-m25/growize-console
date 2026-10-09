/* G2 / GC-1526 (D136) + D137 ruling 2 — the App account card's 10% gate and Finance's override, rendered from the endpoint's fixture half.
   Run: npx vitest run src/features/im/money/app-gate.test.tsx */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImState, ImTxn } from "@/lib/im";
import { AppAccessCard, AppOverride } from "./record";

const ID = "ARL-INV-0205";
/** the investor on Hold, with only the receipts given (none: the 10% is not verified) */
const held = (txns: Partial<ImTxn>[] = []): ImState => {
  const s: ImState = { data: imDemoData(), ui: initialImUi() };
  s.data.ACCESS = { ...(s.data.ACCESS || {}), [ID]: { App_Access: "Hold", App_Welcome_At: null, App_Welcome_Channel: null } };
  s.data.TXN = [...s.data.TXN.filter(t => t.inv !== ID), ...txns.map((t, i) => ({ id: "T-G2-" + i, inv: ID, amt: 500000, mode: "NEFT", utr: "X", on: "02 Sep 10:00", by: "meena", ...t }) as ImTxn)];
  return s;
};
const card = (s: ImState, me: string) => renderToStaticMarkup(<AppAccessCard s={s} me={me} dispatch={() => {}} x={s.data.INV.find(x => x.id === ID)!} />);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const unlockButton = (h: string) => /<button[^>]*>Send welcome and unlock<\/button>/.exec(h)?.[0] ?? "";

/** 10% of what ARL-INV-0205 commits in the demo book (units × ₹25,00,000) */
const tenOf = (s: ImState) => Math.ceil(s.data.INV.find(x => x.id === ID)!.units * 2_500_000 / 10);

describe("G2 + D137: Send welcome and unlock waits for matched money summing to 10%", () => {
  it("nothing matched (a pending advance): the button is disabled, says why, and the trail shows what is recorded", () => {
    const h = card(held([{ kind: "advance", rec: "pending" }]), "harsha");
    expect(unlockButton(h)).toMatch(/disabled=""/);
    expect(unlockButton(h)).toContain("Waits for the 10%");
    expect(text(h)).toContain("Waits for the 10% — the matched receipts do not reach 10% of the committed amount yet.");
    expect(h).toContain('data-trail="ten-percent"');
    expect(text(h)).toContain("recorded and waiting for Finance to match it");
  });
  it("a matched advance or full payment of at least 10% opens it", () => {
    for (const kind of ["advance", "full"] as const) {
      const s = held();
      const h = card(held([{ kind, rec: "matched", amt: tenOf(s) }]), "harsha");
      expect(unlockButton(h)).not.toMatch(/disabled/);
      expect(h).not.toContain("data-gate");
      expect(h).not.toContain("Unlock without the 10%");
    }
  });
  it("D137 ruling 2(a): two matched part payments that together reach 10% open it; one part under 10%, or a refund, does not", () => {
    const t = tenOf(held());
    expect(unlockButton(card(held([{ kind: "balance", rec: "matched", amt: Math.ceil(t / 2) }, { kind: "balance", rec: "matched", amt: Math.ceil(t / 2) }]), "harsha"))).not.toMatch(/disabled/);
    expect(unlockButton(card(held([{ kind: "balance", rec: "matched", amt: t - 1 }]), "harsha"))).toMatch(/disabled=""/);
    expect(unlockButton(card(held([{ kind: "refund", rec: "matched", amt: t }]), "harsha"))).toMatch(/disabled=""/);
  });
  it("the trail masks the reference to its last four", () => {
    const h = card(held([{ kind: "balance", rec: "matched", amt: 1000, utr: "SYNTHUTRGATE0009876" }]), "harsha");
    expect(h).toContain("••• 9876");
    expect(h).not.toContain("SYNTHUTRGATE0009876");
  });
});

describe("GC-1526 + D137 2(b): the override is Finance Operations', the Head of Finance's and Digital Infrastructure's", () => {
  it("Head of Finance, Finance Operations and the super user (Digital Infrastructure) see 'Unlock without the 10%…'", () => {
    expect(card(held(), "harsha")).toContain("Unlock without the 10%…");
    expect(card(held(), "meena")).toContain("Unlock without the 10%…");
    expect(card(held(), "sahil")).toContain("Unlock without the 10%…");
  });
  it("a KAM and the Auditor never see it", () => {
    for (const me of ["imran", "latha"]) expect([me, card(held(), me).includes("Unlock without the 10%")]).toEqual([me, false]);
    expect(card(held(), "imran")).toContain("Finance controls app access.");
  });
  it("step one asks for the reason (10+ characters) and Continue stays shut until it is long enough", () => {
    const short = renderToStaticMarkup(<AppOverride name="Asha" start="why" reason="too short" onUnlock={async () => true} />);
    expect(short).toContain("<textarea");
    expect(text(short)).toContain("At least 10 characters.");
    expect(/<button[^>]*>Continue<\/button>/.exec(short)?.[0]).toMatch(/disabled=""/);
    const long = renderToStaticMarkup(<AppOverride name="Asha" start="why" reason="Paid by cheque, clearing Monday" onUnlock={async () => true} />);
    expect(/<button[^>]*>Continue<\/button>/.exec(long)?.[0]).not.toMatch(/disabled/);
  });
  it("step two is an on-page confirmation, never a native dialog", () => {
    const h = renderToStaticMarkup(<AppOverride name="Asha" start="confirm" reason="Paid by cheque, clearing Monday" onUnlock={async () => true} />);
    expect(text(h)).toContain("Unlock Asha's app without a verified 10%?");
    expect(text(h)).toContain("Your reason is written on their record under your name.");
    expect(h).toContain("Yes, unlock without the 10%");
    expect(h).toContain("Back");
    expect(h).toContain('role="alert"');
  });
});
