/* M15-S03-W2 / M12-S03-W2 — the two lead-side pages read their route through the adapter and paint on the first render. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoBook } from "@fixtures/book";
import { initialState, reducer } from "@/lib/state";
import type { PersonKey } from "@/domain";

const seat = vi.hoisted(() => ({ k: "rohit" }));
vi.mock("@/lib/store", async (orig) => ({ ...(await orig() as object), useConsole: () => ({ state: stateFor(seat.k), dispatch: () => {} }) }));
vi.mock("@/features/leads/nav", () => ({ useGoLead: () => () => {} }));
const cache = new Map<string, ReturnType<typeof reducer>>();
function stateFor(k: string) {
  if (!cache.has(k)) cache.set(k, reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey }));
  return cache.get(k)!;
}
import { ActivityPage } from "./index";
import { archiveNote } from "./ActivityPage";
import { DocsPage } from "@/features/docs/DocsPage";

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("Activity (lead side)", () => {
  it("an IR: their own actions, Log and By day, no Person column", () => {
    seat.k = "rohit";
    const h = renderToStaticMarkup(<ActivityPage />), t = text(h);
    expect(t).toContain("Your actions, latest first.");
    expect(t).toContain("Log"); expect(t).toContain("By day"); expect(t).not.toContain("By person");
    expect(t).not.toContain("Person");
    expect(t).not.toContain("Loading…");
  });
  it("an IR Manager: the team, By person offered, Person column present", () => {
    seat.k = "tasneem";
    const t = text(renderToStaticMarkup(<ActivityPage />));
    expect(t).toContain("You and your team, latest first.");
    expect(t).toContain("By person");
    expect(t).toMatch(/When Action Person Investor/);
  });
});

describe("Activity archive note (B-27)", () => {
  it("says the log is not set up when the archive is not configured, and next-day otherwise; the fixture book shows neither", () => {
    expect(archiveNote("not-configured")).toMatch(/not set up on this environment/);
    expect(archiveNote("stratus")).toMatch(/the day after/);
    seat.k = "rohit";
    expect(renderToStaticMarkup(<ActivityPage />)).not.toContain("activity-archive-note");
  });
});

describe("Documents (lead side)", () => {
  it("is read only, lists the register from the route's rows", () => {
    seat.k = "tasneem";
    const t = text(renderToStaticMarkup(<DocsPage />));
    expect(t).toContain("Read only · sent by Finance from the");
    expect(t).toContain("Document register");
    expect(t).toContain("Non-disclosure agreement");
    expect(t).not.toContain("Reading…");
  });
});
