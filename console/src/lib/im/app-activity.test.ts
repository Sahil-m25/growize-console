/* GC-1525 — the plain-language lines of App activity (IST, rule 9). Run: npx vitest run src/lib/im/app-activity.test.ts */
import { describe, expect, it } from "vitest";
import { nowFull } from "./dates";
import { activityBadge, activityHealth, failedSinceSuccess, neverSignedIn, nudgeIds, type AppActivity } from "./app-activity";

const NOW = nowFull("2026-10-09T10:00");
const A = (p: Partial<AppActivity> = {}): AppActivity => ({
  contactId: "9007199254740100001", access: "Invite", welcomeAt: null, welcomeChannel: null,
  firstSignInAt: null, lastSignInAt: null, signInCount: null, lastFailedAt: null, failedCount: null, ...p,
});

describe("activityHealth", () => {
  it("no account / on hold / locked", () => {
    expect(activityHealth(A({ access: null }), NOW).text).toBe("No app account yet");
    expect(activityHealth(A({ access: "Hold" }), NOW).text).toBe("On hold — no invite sent");
    expect(activityHealth(A({ access: "Hold", lastSignInAt: "2026-10-01T09:00:00+05:30", signInCount: 2 }), NOW).text).toBe("Locked — sign-in blocked, last signed in 01 Oct");
  });
  it("invited, never signed in: how long ago, in IST days", () => {
    expect(activityHealth(A({ welcomeAt: "2026-10-06T09:30:00+05:30" }), NOW).text).toBe("Invited 3 days ago — never signed in");
    expect(activityHealth(A({ welcomeAt: "2026-10-08T23:00:00+05:30" }), NOW).text).toBe("Invited yesterday — never signed in");
    expect(activityHealth(A({ welcomeAt: "2026-10-09T08:00:00+05:30" }), NOW).text).toBe("Invited today — never signed in");
    expect(activityHealth(A(), NOW).text).toBe("Invited — welcome not delivered yet");
    expect(activityHealth(A({ welcomeAt: "2026-10-06T09:30:00+05:30" }), NOW).tone).toBe("late");
  });
  it("a UTC instant reads as the IST day (rule 9)", () => {
    /* 18:40 UTC on 7 Oct is 00:10 IST on 8 Oct: one day before 9 Oct, not two */
    expect(activityHealth(A({ welcomeAt: "2026-10-07T18:40:00Z" }), NOW).text).toBe("Invited yesterday — never signed in");
  });
  it("signed in: count and last day", () => {
    const h = activityHealth(A({ firstSignInAt: "2026-10-07T10:00:00+05:30", lastSignInAt: "2026-10-08T11:00:00+05:30", signInCount: 2 }), NOW);
    expect(h).toEqual({ tone: "go", text: "Signed in 2 times, last 08 Oct" });
    expect(activityHealth(A({ lastSignInAt: "2026-10-08T11:00:00+05:30", signInCount: 1 }), NOW).text).toBe("Signed in 1 time, last 08 Oct");
  });
  it("failed sign-ins since the last success, and never a stale count", () => {
    const stuck = A({ welcomeAt: "2026-10-08T09:00:00+05:30", lastFailedAt: "2026-10-08T12:00:00+05:30", failedCount: 2 });
    expect(activityHealth(stuck, NOW).text).toBe("Invited yesterday — never signed in · 2 failed sign-ins since last success");
    const after = A({ lastSignInAt: "2026-10-08T11:00:00+05:30", signInCount: 3, lastFailedAt: "2026-10-08T12:00:00+05:30", failedCount: 1 });
    expect(activityHealth(after, NOW).text).toBe("Signed in 3 times, last 08 Oct · 1 failed sign-in since last success");
    const old = A({ lastSignInAt: "2026-10-08T11:00:00+05:30", signInCount: 3, lastFailedAt: "2026-10-07T12:00:00+05:30", failedCount: 4 });
    expect(failedSinceSuccess(old)).toBe(0);
    expect(activityHealth(old, NOW).text).toBe("Signed in 3 times, last 08 Oct");
  });
  it("sign-in fields missing in Zoho: the account line still reads, nothing is claimed about sign-ins", () => {
    expect(activityHealth(A({ welcomeAt: "2026-10-06T09:30:00+05:30" }), NOW, true).text).toBe("Invited — sign-in activity is not recorded yet");
  });
});

describe("activityBadge and the filter", () => {
  it("never signed in / last seen / on hold / no account / unknown", () => {
    expect(activityBadge(A())).toMatchObject({ text: "App: never signed in", nudge: true });
    expect(activityBadge(A({ lastSignInAt: "2026-10-08T11:00:00+05:30", signInCount: 2 }))).toMatchObject({ text: "App: last seen 08 Oct", nudge: false, tone: "go" });
    expect(activityBadge(A({ access: "Hold" })).text).toBe("App: on hold");
    expect(activityBadge(A({ access: null })).text).toBe("App: no account");
    expect(activityBadge(undefined).text).toBe("App: —");
    expect(activityBadge(A(), true)).toMatchObject({ text: "App: —", nudge: false });
  });
  it("neverSignedIn: only an invited account with no sign-in at all", () => {
    expect(neverSignedIn(A())).toBe(true);
    expect(neverSignedIn(A({ access: "Hold" }))).toBe(false);
    expect(neverSignedIn(A({ signInCount: 1 }))).toBe(false);
    expect(neverSignedIn(A({ firstSignInAt: "2026-10-07T10:00:00+05:30" }))).toBe(false);
  });
  it("nudgeIds holds the invited-never-signed-in ids, and nobody while the fields are missing", () => {
    const rows = [A({ contactId: "1" }), A({ contactId: "2", signInCount: 3, lastSignInAt: "2026-10-08T11:00:00+05:30" }), A({ contactId: "3", access: "Hold" })];
    expect([...nudgeIds(rows, false)]).toEqual(["1"]);
    expect(nudgeIds(rows, true).size).toBe(0);
  });
});
