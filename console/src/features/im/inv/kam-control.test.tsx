/* R5 — "Manager: <name> · Change · Remove" as the Care card draws them. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { I, initialImUi, type ImState } from "@/lib/im";
import { KamControl } from "./KamControl";

const st = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const ctl = (me: string, id: string) => {
  const s = st();
  return renderToStaticMarkup(<KamControl s={s} me={me} dispatch={() => {}} x={I(s, me, id)!} />);
};

describe("KamControl", () => {
  it("Head of AM, named account: Change and Remove; no share status, no Retry", () => {
    const h = ctl("divya", "ARL-INV-0205"), t = text(h);
    expect(t).toContain("Change Remove");
    expect(t).not.toMatch(/Shared with KAM|Sharing|Share failed|Retry|Access follows/);
    expect(t).not.toContain("Return it to the pool");   /* the confirm waits for Remove */
    expect(h).toContain('aria-expanded="false"');
  });
  it("Head of AM, account in the pool: only Name a manager", () => {
    const t = text(ctl("divya", "ARL-INV-0211"));
    expect(t).toContain("Name a manager");
    expect(t).not.toMatch(/Change|Remove/);
  });
  it("a KAM has no right to name or move a manager: nothing is offered", () => {
    expect(ctl("imran", "ARL-INV-0205")).toBe("");
  });
});
