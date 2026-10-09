/* GC-1525 — App activity: the card on the record, the "App:" column on My accounts and the IR's Investors, and the cut
   "Invited, never signed in". The demo book (fixture mode) has App_Access / App_Welcome_* only, so an invited account
   reads "never signed in"; the card itself is also fed every combination of facts.
   Run: npx vitest run src/features/im/inv/app-activity.test.tsx */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, nowFull } from "@/lib/im";
import type { ImUi } from "@/lib/im";
import type { AppActivity } from "@/lib/im/app-activity";
import { ImInv } from "./index";
import { AppActivityView, AppBadge } from "./AppActivity";

vi.mock("@/features/leads/nav", () => ({ useGoLead: () => () => {} }));

const text = (h: string) => h.replace(/<br\/?>/g, " ").replace(/<[^>]+>/g, "")
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const render = (me: string, ui: Partial<ImUi> = {}, irSeat = false) => {
  const s = { data: imDemoData(), ui: { ...initialImUi(), ...ui } };
  const html = renderToStaticMarkup(<ImInv s={s} me={me} dispatch={() => {}} irSeat={irSeat} />);
  return { html, t: text(html), s };
};
const rec = (me: string, id: string, irSeat = false) => render(me, { SEL: id, SEC: { ["inv:" + id]: "who" } }, irSeat);
const NOW = nowFull("2026-10-09T10:00");
const A = (p: Partial<AppActivity> = {}): AppActivity => ({
  contactId: "c1", access: "Invite", welcomeAt: "2026-10-06T09:30:00+05:30", welcomeChannel: "WhatsApp",
  firstSignInAt: null, lastSignInAt: null, signInCount: null, lastFailedAt: null, failedCount: null, ...p,
});
const view = (a: AppActivity, off = false) => text(renderToStaticMarkup(<AppActivityView a={a} now={NOW} off={off} />));

describe("the App activity card", () => {
  it("invited, never signed in: the health line, the welcome (time, channel) and empty sign-in rows", () => {
    const t = view(A());
    expect(t).toContain("App activity");
    expect(t).toContain("Invited 3 days ago — never signed in");
    expect(t).toContain("AccountInvited");
    expect(t).toContain("Welcomedelivered 06 Oct 09:30 by whatsapp");
    expect(t).toContain("First sign-innever");
    expect(t).toContain("Last sign-innever");
    expect(t).toContain("Sign-ins0");
    expect(t).toContain("Last failednone");
  });
  it("signed in twice, last 08 Oct (IST)", () => {
    const t = view(A({ firstSignInAt: "2026-10-07T10:00:00+05:30", lastSignInAt: "2026-10-08T11:00:00+05:30", signInCount: 2 }));
    expect(t).toContain("Signed in 2 times, last 08 Oct");
    expect(t).toContain("First sign-in07 Oct 10:00");
    expect(t).toContain("Last sign-in08 Oct 11:00");
    expect(t).toContain("Sign-ins2");
  });
  it("failed sign-ins since the last success", () => {
    const t = view(A({ lastSignInAt: "2026-10-07T11:00:00+05:30", firstSignInAt: "2026-10-07T11:00:00+05:30", signInCount: 1, lastFailedAt: "2026-10-08T12:00:00+05:30", failedCount: 2 }));
    expect(t).toContain("2 failed sign-ins since last success");
    expect(t).toContain("Last failed08 Oct 12:00 2 since last success");
  });
  it("no account and on hold read as such, with no sign-in rows invented", () => {
    expect(view(A({ access: null, welcomeAt: null, welcomeChannel: null }))).toContain("No app account yet");
    const hold = view(A({ access: "Hold", welcomeAt: null, welcomeChannel: null }));
    expect(hold).toContain("On hold — no invite sent");
    expect(hold).toContain("Welcomenot sent");
  });
  it("Zoho has no sign-in fields yet: the account facts stand, the page says why the sign-in rows are missing, nothing is blank", () => {
    const t = view(A(), true);
    expect(t).toContain("Invited — sign-in activity is not recorded yet");
    expect(t).toContain("Welcomedelivered 06 Oct 09:30");
    expect(t).not.toContain("First sign-in");
    expect(t).toContain("has not started writing it back");
  });
});

describe("the badge", () => {
  const b = (a: AppActivity | undefined, loaded = true, off = false) => text(renderToStaticMarkup(<AppBadge a={a} loaded={loaded} unavailable={off} />));
  it("never signed in / last seen / not loaded yet", () => {
    expect(b(A())).toBe("App: never signed in");
    expect(b(A({ lastSignInAt: "2026-10-08T11:00:00+05:30", signInCount: 2 }))).toBe("App: last seen 08 Oct");
    expect(b(undefined, false)).toBe("…");
    expect(b(A(), true, true)).toBe("App: —");
  });
});

describe("the lists and the record in the page", () => {
  it("KAM (imran) My accounts: an App column with a badge per account, and the cut for the invited who never signed in", () => {
    const { t, html } = render("imran");
    expect(t).toContain("TierManagerLast heardNext owedLandApp");
    expect(html.match(/App: (never signed in|on hold|no account|last seen)/g)?.length).toBe(4);
    expect(t).toMatch(/Invited, never signed in \d/);
  });
  it("the cut narrows My accounts to exactly those", () => {
    const all = render("imran");
    const cut = render("imran", { IFILT: "appnever" });
    const n = Number(/Invited, never signed in (\d+)/.exec(all.t)![1]);
    expect(cut.html.match(/App: never signed in/g)).toHaveLength(n);
    expect(cut.html.match(/<tr class="k"/g)).toHaveLength(n);
  });
  it("the Head of AM sees the column on Accounts too; Finance's list is left as it was", () => {
    expect(render("divya").t).toContain("LandApp");
    expect(render("harsha").t).not.toMatch(/App: |LandApp/);
  });
  it("the record: KAM, Head of AM and Finance all see the card under Who they are", () => {
    for (const me of ["imran", "divya", "harsha"]) {
      const { t } = rec(me, "ARL-INV-0205");
      expect(t, me).toContain("App activity");
    }
  });
  it("IR (rohit): an App column on their Investors, the cut, and the card read-only on the record — no money word", () => {
    const l = render("rohit", {}, true);
    expect(l.t).toContain("InvestorARL IDFarmsStateLeadApp");
    expect(l.html.match(/App: [a-z ]+/g)?.length).toBe(5);
    expect(l.t).toMatch(/Invited, never signed in \d/);
    const cut = render("rohit", { IFILT: "appnever" }, true);
    /* the demo book has no sign-ins, so every invited account is in the cut */
    expect(cut.html.match(/<tr class="k"/g)).toHaveLength(5);
    const r = rec("rohit", "ARL-INV-0208", true);
    expect(r.t).toContain("App activity");
    expect(r.t).not.toMatch(/₹|\bPaid\b|\bDue\b|\bMoney\b|Receipt|\bKYC\b|\bPAN\b|Aadhaar|\bBank\b|Send welcome|Lock app access/);
  });
});
