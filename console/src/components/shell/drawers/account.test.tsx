/* TC-IM01-020 / TC-IM01-016 — an Investors-only seat (Finance, Head of Finance, KAM, Head of AM, Compliance) holds no lead-side
   account, yet holds "Your account": it opens, shows the person and appearance, and Sign out is its door out. Every lead-side
   action stays refused for it. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoBook } from "@fixtures/book";
import type { PersonKey } from "@/domain";
import { accountAllowed, canOpenDrawer } from "@/lib/selectors";
import { initialState, reducer, type ConsoleState } from "@/lib/state";

const seat = vi.hoisted(() => ({ k: "meena" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock("@/lib/store", async (orig) => ({
  ...(await orig() as object),
  useConsole: () => ({ state: as(seat.k), dispatch: () => {} }),
  useSession: () => ({ signOut: () => {} }),
}));
const as = (k: string): ConsoleState => reducer(reducer(initialState(), { type: "hydrate", ds: demoBook(), version: 1, fixtures: true }), { type: "signIn", k: k as PersonKey });
import { drawerDef, type DrawerProps } from "./registry";
import "./account";

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const INVESTORS_ONLY = ["meena", "harsha", "imran", "divya", "fahad"];

describe("Your account for an Investors-only seat", () => {
  it("those seats hold no lead-side account, but the account door opens for them", () => {
    for (const k of INVESTORS_ONLY) {
      const s = as(k);
      expect(s.authed).toBe(true);
      expect(accountAllowed(s), k).toBe(false);
      expect(canOpenDrawer(s, "account", null), k).toBe(true);
      expect(reducer(s, { type: "openDrawer", k: "account" }).DRW, k).toEqual({ k: "account", id: null });
    }
  });
  it("the door toggles shut, and closeDrawer closes it", () => {
    const open = reducer(as("meena"), { type: "openDrawer", k: "account" });
    expect(reducer(open, { type: "openDrawer", k: "account" }).DRW).toBeNull();
    expect(reducer(open, { type: "closeDrawer" }).DRW).toBeNull();
  });
  it("nothing else of the lead side opens or runs for them", () => {
    for (const k of INVESTORS_ONLY) {
      const s = as(k);
      for (const d of ["updates", "presence", "p:add.quick"] as const) expect(reducer(s, { type: "openDrawer", k: d }).DRW, `${k} ${d}`).toBeNull();
      expect(reducer(s, { type: "go", v: "leads" }), k).toEqual(s);
    }
  });
  it("Help opens for them (B-24), and the rail width and the Help search are theirs to set (B-17)", () => {
    for (const k of INVESTORS_ONLY) {
      const s = as(k);
      expect(canOpenDrawer(s, "help", null), k).toBe(true);
      expect(reducer(s, { type: "openDrawer", k: "help", id: "inv" }).DRW, k).toEqual({ k: "help", id: "inv" });
      expect(reducer(s, { type: "setUi", patch: { RAILMIN: true } }).ui.RAILMIN, k).toBe(true);
      expect(reducer(s, { type: "setUi", patch: { HQ: "pay" } }).ui.HQ, k).toBe("pay");
      /* any other key (a lead-side draft) stays refused */
      expect(reducer(s, { type: "setUi", patch: { RAILMIN: true, NDRAFT: "x" } }), k).toEqual(s);
    }
  });
  it("a lead-side seat is unchanged: the account opens as before", () => {
    expect(reducer(as("rohit"), { type: "openDrawer", k: "account" }).DRW).toEqual({ k: "account", id: null });
  });
  it("the drawer for them: the person, appearance and Sign out and Help — no lead-side availability, Profile or Team availability", () => {
    seat.k = "meena";
    const def = drawerDef("account")!;
    const props = { id: null } as unknown as DrawerProps;
    const Foot = def.Foot!;
    const body = text(renderToStaticMarkup(<def.Body {...props} />));
    expect(body).toContain("Meena Raghavan");
    expect(body).toContain("Appearance");
    for (const gone of ["Your availability", "Profile", "Team availability"]) expect(body).not.toContain(gone);
    expect(body).toContain("Help with this page");
    expect(text(renderToStaticMarkup(<Foot {...props} />))).toContain("Sign out");
  });
  it("the drawer for a lead-side seat still offers all of it", () => {
    seat.k = "rohit";
    const def = drawerDef("account")!;
    const body = text(renderToStaticMarkup(<def.Body {...({ id: null } as unknown as DrawerProps)} />));
    for (const here of ["Your availability", "Profile", "Team availability", "Help with this page", "Appearance"]) expect(body).toContain(here);
  });
});
