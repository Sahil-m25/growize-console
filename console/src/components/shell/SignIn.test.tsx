/* M01-S02-W1 — the sign-in screen shows GET /api/session's refusal and follows the route's OAuth redirect. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initialState } from "@/lib/state";

const ctx = { state: initialState(), sessionNote: null as null | { refusal?: { code: string; message: string }; signedOut?: "expired" | "revoked" } };
vi.mock("@/lib/store", () => ({
  useConsole: () => ctx,
  useSession: () => ({ signIn: () => {}, signOut: () => {} }),
}));
vi.mock("./Shell", () => ({ Shell: () => null }));

const { SignIn } = await import("./SignIn");

afterEach(() => { ctx.sessionNote = null; });

describe("SignIn", () => {
  it("shows the route's refusal message once, above the door", () => {
    ctx.sessionNote = { refusal: { code: "no-seat", message: "No console access: your Zoho account does not hold a console seat. Digital Infrastructure can give you one." } };
    const html = renderToStaticMarkup(<SignIn />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("No console access: your Zoho account does not hold a console seat.");
  });
  it("shows no refusal when the route gave none", () => {
    expect(renderToStaticMarkup(<SignIn />)).not.toContain('role="alert"');
  });
});
