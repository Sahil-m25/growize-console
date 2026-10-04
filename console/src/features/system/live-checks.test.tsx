/* M15-S05-NOTE-2 (R5) — the System page's Live checks card, in each state the page can be in:
   ok / down / attention, not read yet (loading), 403 hidden, demo-mode empty view, and any other refusal. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoBook } from "@fixtures/book";
import { initialState, reducer } from "@/lib/state";
import type { PersonKey } from "@/domain";
import type { Read } from "@/lib/data/api";
import type { SystemLive } from "@/lib/data/endpoints/system";

const read = vi.hoisted(() => ({ r: { state: "loading" } as unknown }));
vi.mock("@/lib/data/api", async (orig) => ({ ...(await orig() as object), useApiRead: () => read.r }));
const state = reducer(initialState(demoBook()), { type: "signIn", k: "sahil" as PersonKey });
vi.mock("@/lib/store", async (orig) => ({ ...(await orig() as object), useConsole: () => ({ state, dispatch: () => {} }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/components/shell/Shell", () => ({ Shell: () => null }));
import "@/components/shell/drawers";
import { SystemPage } from "./SystemPage";

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const view = (all: SystemLive["all"]): SystemLive => ({
  working: all.filter((c) => c.state === "working").length, attention: all.filter((c) => c.state === "attention").length,
  down: all.filter((c) => c.state === "down").length, cards: [], all, asOf: 1,
});
const page = (r: Read<SystemLive> | unknown) => { read.r = r; const h = renderToStaticMarkup(<SystemPage />); return { h, t: text(h) }; };
const credits = { key: "credits", t: "Zoho API credits left", state: "working", figure: "42000", owner: "Digital Infrastructure", fix: "ops/runbooks/api-budget.md" } as const;
const r429 = { key: "429s", t: "Rate-limited calls (429) in 24 h", state: "down", figure: "31", owner: "Digital Infrastructure", fix: "Lower the gate's concurrency" } as const;
const push = { key: "push", t: "Investor app delivery", state: "attention", figure: "nothing delivered yet · 0 failures", owner: "Digital Infrastructure", fix: "ops/runbooks/outbox-stuck.md" } as const;

describe("System page — Live checks card", () => {
  it("ok: counts in the header, a working row shows its owner (not the fix) and its figure", () => {
    const { h, t } = page({ state: "ok", data: view([credits]) });
    expect(h).toContain('id="live-checks"');
    expect(t).toContain("Live checks");
    expect(t).toContain("1 working · 0 need attention · 0 not working");
    expect(t).toContain("Zoho API credits left");
    expect(t).toContain("42000");
    expect(t).not.toContain("ops/runbooks/api-budget.md");
    expect(h).toContain('class="tag go"'); expect(t).toContain("working");
    expect(t).toContain("Service-token expiry, cache load errors, the Zoho licence date and the last Zoho Sign event are not read here yet.");
  });
  it("down: a not-working row says not working, in the late tag, and shows the fix instead of the owner", () => {
    const { h, t } = page({ state: "ok", data: view([credits, r429]) });
    expect(t).toContain("1 working · 0 need attention · 1 not working");
    expect(h).toContain('class="tag late"'); expect(t).toContain("not working");
    expect(t).toContain("Lower the gate's concurrency");
  });
  it("needs attention: the due tag and the fix", () => {
    const { h, t } = page({ state: "ok", data: view([push]) });
    expect(t).toContain("0 working · 1 need attention · 0 not working");
    expect(h).toContain('class="tag due"'); expect(t).toContain("attention");
    expect(t).toContain("nothing delivered yet · 0 failures"); expect(t).toContain("ops/runbooks/outbox-stuck.md");
  });
  it("not read yet (loading, or idle): no card and no placeholder", () => {
    for (const s of [{ state: "loading" }, { state: "idle" }]) {
      const { h, t } = page(s);
      expect(h).not.toContain("live-checks"); expect(t).not.toContain("Live checks"); expect(t).not.toContain("Loading");
      expect(t).toContain("System");
    }
  });
  it("403 not-a-system-reader: the card is hidden and no error shows", () => {
    const { h, t } = page({ state: "error", err: { ok: false, status: 403, code: "not-a-system-reader", error: "The system checks are Digital Infrastructure's." } });
    expect(h).not.toContain("live-checks"); expect(t).not.toContain("Digital Infrastructure's."); expect(h).not.toContain('role="alert"');
  });
  it("demo mode (empty view): no card, the page's own demo checks stand alone", () => {
    const { h, t } = page({ state: "ok", data: view([]) });
    expect(h).not.toContain("live-checks");
    expect(t).toContain("working"); expect(t).toContain("need attention"); expect(t).toContain("not working");
  });
  it("any other refusal: shown as an alert, never hidden", () => {
    const { h, t } = page({ state: "error", err: { ok: false, status: 500, code: "500", error: "Refused (500)." } });
    expect(h).toContain('role="alert"'); expect(t).toContain("Refused (500).");
  });
});
