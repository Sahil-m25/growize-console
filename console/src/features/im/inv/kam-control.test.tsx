/* R5 — "Manager: <name> · Change · Remove" and the share line, as the Care card draws them. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { I, initialImUi, type ImState } from "@/lib/im";
import { ok } from "@/lib/data/api";
import { kamShare } from "@/lib/data/endpoints/investors";
import { KamControl, KamShareLine } from "./KamControl";

const st = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const ctl = (me: string, id: string) => {
  const s = st();
  return renderToStaticMarkup(<KamControl s={s} me={me} dispatch={() => {}} x={I(s, me, id)!} />);
};
afterEach(() => vi.restoreAllMocks());

describe("KamControl", () => {
  it("Head of AM, named account: Change and Remove, and the account is shared", () => {
    const h = ctl("divya", "ARL-INV-0205"), t = text(h);
    expect(t).toContain("Change Remove");
    expect(t).toContain("Shared with KAM ✓");
    expect(t).not.toContain("Return it to the pool");   /* the confirm waits for Remove */
    expect(h).toContain('aria-expanded="false"');
  });
  it("Head of AM, account in the pool: only Name a manager, no share line", () => {
    const t = text(ctl("divya", "ARL-INV-0211"));
    expect(t).toContain("Name a manager");
    expect(t).not.toMatch(/Change|Remove|Shared with KAM/);
  });
  it("a KAM has no right to name or move a manager: nothing is offered", () => {
    expect(ctl("imran", "ARL-INV-0205")).toBe("");
  });
});

describe("KamShareLine", () => {
  const line = (state: "shared" | "pending" | "failed" | "none") => {
    vi.spyOn(kamShare, "fixture").mockReturnValue(ok({ state, lastTriedAt: null }));
    const s = st();
    return text(renderToStaticMarkup(<KamShareLine s={s} me="divya" dispatch={() => {}} id="ARL-INV-0205" />));
  };
  it("says shared, sharing, or failed with a Retry; none says nothing", () => {
    expect(line("shared")).toContain("Shared with KAM ✓");
    expect(line("pending")).toContain("Sharing…");
    expect(line("failed")).toContain("Share failed — Retry");
    expect(line("none").trim()).toBe("");
  });
});
