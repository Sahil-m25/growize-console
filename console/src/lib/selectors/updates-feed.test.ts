import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer } from "@/lib/state";
import type { ConsoleState } from "@/lib/store";
import type { PersonKey } from "@/domain";
import { feedRows, feedScope, feedTeam, myBook, teamBook, updates } from "@/lib/selectors";

const as = (k: string, s?: ConsoleState) =>
  reducer(s ?? initialState(demoBook()), { type: "signIn", k: k as PersonKey });

describe("Updates feed scope — D59 g3 (ir-merged.js:6186, 6252)", () => {
  it("an IR reads 'your leads' and the feed is their own book, never their own actions", () => {
    const s = as("rohit");
    expect(feedTeam(s)).toBe(false);
    expect(feedScope(s)).toBe("your leads");
    const mine = new Set(myBook(s).map((l) => l.id));
    const rows = feedRows(s);
    expect(rows.every((e) => !!e.lead && mine.has(e.lead) && e.who !== s.WHO)).toBe(true);
  });

  it("a manager on team scope reads the team's book, and the wording says so", () => {
    let s = as("tasneem");
    s = reducer(s, { type: "setScope", view: "today", to: "team" });
    expect(feedTeam(s)).toBe(true);
    expect(feedScope(s)).toBe("your team's leads");
    const team = new Set(teamBook(s).map((l) => l.id));
    expect(feedRows(s).every((e) => !!e.lead && team.has(e.lead))).toBe(true);
  });

  it("the page groups never name the reader as who did it", () => {
    const s = as("rohit");
    const rows = updates(s).filter((g) => ["moved", "cover", "admin"].includes(g.k)).flatMap((g) => g.rows);
    expect(rows.every((r) => r.who !== s.WHO)).toBe(true);
  });
});
