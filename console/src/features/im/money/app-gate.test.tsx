/* G2 / GC-1526 (D136 proposed) — the App account card's 10% gate and Finance's override, rendered from the endpoint's fixture half.
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

describe("G2: Send welcome and unlock waits for the 10%", () => {
  it("no matched advance: the button is disabled and says why", () => {
    const h = card(held([{ kind: "advance", rec: "pending" }]), "harsha");
    expect(unlockButton(h)).toMatch(/disabled=""/);
    expect(unlockButton(h)).toContain("Waits for the 10% advance");
    expect(text(h)).toContain("Waits for the 10% advance — no matched Advance or Full receipt yet.");
  });
  it("a matched advance (or a matched full payment) opens it", () => {
    for (const kind of ["advance", "full"] as const) {
      const h = card(held([{ kind, rec: "matched" }]), "harsha");
      expect(unlockButton(h)).not.toMatch(/disabled/);
      expect(h).not.toContain("data-gate");
      expect(h).not.toContain("Unlock without the 10%");
    }
  });
  it("a matched balance or refund alone is not the 10%", () => {
    expect(unlockButton(card(held([{ kind: "balance", rec: "matched" }, { kind: "refund", rec: "matched" }]), "harsha"))).toMatch(/disabled=""/);
  });
});

describe("GC-1526: the override is Finance Operations' and the Head of Finance's only", () => {
  it("Head of Finance and Finance Operations see 'Unlock without the 10%…'", () => {
    expect(card(held(), "harsha")).toContain("Unlock without the 10%…");
    expect(card(held(), "meena")).toContain("Unlock without the 10%…");
  });
  it("the super user, a KAM and the Auditor never see it", () => {
    for (const me of ["sahil", "imran", "latha"]) expect([me, card(held(), me).includes("Unlock without the 10%")]).toEqual([me, false]);
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
