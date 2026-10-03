/* M08-S08-W2 — the app account's mark on the card route (GET /api/investors/[id]/unlock): the fixture half carries what the route carries
   (D93: the account opens On hold with a Tentative mark at the first matched receipt), in the route's own datetime shape. */
import { describe, expect, it } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImState } from "@/lib/im";
import type { ApiResult } from "../api";
import { appCard } from "./app";

const data = <T,>(r: ApiResult<T>): T => { if (!r.ok) throw new Error(r.error); return r.data; };
const demo = (): ImState => ({ data: imDemoData(), ui: initialImUi() });

describe("the app account's mark on the card", () => {
  it("an investor with no app account yet has no mark: the page says the account opens when the first receipt is matched", () => {
    const s = demo(), id = s.data.INV[0]!.id;
    delete s.data.APP[id];
    const c = data(appCard.fixture({ s, me: "harsha" }, id)).card;
    expect([c.mark, c.markAt, c.openedAt]).toEqual([null, null, null]);
  });
  it("a tentative account carries the mark, when it was set and when it opened, as Zoho datetimes in IST", () => {
    const s = demo(), id = s.data.INV[0]!.id;
    s.data.APP[id] = { at: "02 Sep 14:20", welcome: { at: "", ch: "email" }, mark: "tentative", markAt: "02 Sep 14:20", markBy: null, hist: [] };
    const c = data(appCard.fixture({ s, me: "harsha" }, id)).card;
    expect([c.mark, c.markAt, c.openedAt]).toEqual(["Tentative", "2026-09-02T14:20:00+05:30", "2026-09-02T14:20:00+05:30"]);
  });
  it("a permanent account reads Permanent, set later than it opened", () => {
    const s = demo(), id = s.data.INV[0]!.id;
    s.data.APP[id] = { at: "02 Sep 14:20", welcome: { at: "", ch: "email" }, mark: "permanent", markAt: "09 Sep 10:00", markBy: "harsha", hist: [] };
    const c = data(appCard.fixture({ s, me: "harsha" }, id)).card;
    expect([c.mark, c.markAt, c.openedAt]).toEqual(["Permanent", "2026-09-09T10:00:00+05:30", "2026-09-02T14:20:00+05:30"]);
  });
});
