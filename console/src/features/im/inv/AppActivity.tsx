"use client";

/* GC-1525 — App activity. The investor app writes sign-ins back to the same Zoho org (D52); the people who look after the
   investor read them here: the card on the record (KAM, Head of AM, Finance, and the IR read-only for their own leads) and the
   "App:" badge on the lists (My accounts, the IR's Investors). Read only. Times are Asia/Kolkata through lib/im/dates. */

import { useApiRead } from "@/lib/data/api";
import { appActivity } from "@/lib/data/endpoints/app-activity";
import { nowFull } from "@/lib/im";
import { APP_ACCOUNT_FIELDS, activityBadge, activityHealth, stampIst, type AppActivity, type AppActivityAnswer } from "@/lib/im/app-activity";
import type { ImPageProps } from "../common";

type Book = Pick<ImPageProps, "s" | "me">;

/** The activity of the investors on screen: a map by Contact id, or null until it has been read (or when it could not be). */
export function useAppActivity(p: Book, ids: readonly string[] | null): { map: Map<string, AppActivity> | null; unavailable: boolean } {
  const r = useApiRead(appActivity, { s: p.s, me: p.me }, ids);
  if (r.state !== "ok") return { map: null, unavailable: false };
  return { map: new Map((r.data as AppActivityAnswer).rows.map(a => [a.contactId, a])), unavailable: r.data.activityUnavailable };
}

/** the list column: "App: never signed in" / "App: last seen 08 Oct" */
export function AppBadge({ a, loaded, unavailable }: { a: AppActivity | undefined; loaded: boolean; unavailable: boolean }) {
  if (!loaded) return <span className="sm">…</span>;
  const b = activityBadge(a, unavailable);
  return <span className={`tag ${b.tone}`.trim()}>{b.text}</span>;
}

const statusOf = (a: AppActivity): string => (!a.access ? "No account" : a.access === "Hold" ? "On hold" : "Invited");

export function AppActivityCard({ s, me, id }: Book & { id: string }) {
  const r = useApiRead(appActivity, { s, me }, [id]);
  if (r.state === "idle" || r.state === "loading") return <div className="card" style={{ marginTop: 8 }}><div className="cb"><p className="sm" style={{ margin: 0 }}>Reading app activity…</p></div></div>;
  if (r.state === "error") return r.err.status === 403 ? null : <div className="card" style={{ marginTop: 8 }}><div className="cb"><p className="sm" role="alert" style={{ margin: 0 }}>App activity: {r.err.error}</p></div></div>;
  const a = r.data.rows.find(x => x.contactId === id);
  return a ? <AppActivityView a={a} now={nowFull(s.data.NOW)} off={r.data.activityUnavailable} hidden={r.data.hiddenFields} /> : null;
}

/** The card itself, from the facts (exported so a render test can feed it any combination). */
export function AppActivityView({ a, now, off, hidden = [] }: { a: AppActivity; now: number; off: boolean; hidden?: readonly string[] }) {
  const accountHidden = (APP_ACCOUNT_FIELDS as readonly string[]).some(f => hidden.includes(f));
  const seatHidden = hidden.length > 0;
  if (accountHidden) return (
    <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>App activity</h3></div><div className="cb">
      <p className="sm" style={{ margin: 0 }}>App account details are not visible for your seat.</p></div></div>);
  const h = activityHealth(a, now, off);
  const failed = (a.failedCount ?? 0) > 0;
  return (
    <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>App activity</h3><div className="sp" />
      <span className={`tag ${h.tone}`.trim()}><span className="dot" />{statusOf(a).toLowerCase()}</span></div><div className="cb">
      <p style={{ margin: 0 }}><b>{h.text}</b></p>
      <dl className="kv" style={{ marginTop: 10 }}>
        <dt>Account</dt><dd>{statusOf(a)}</dd>
        <dt>Welcome</dt><dd>{a.access !== "Invite" ? <span className="sm">not sent</span>
          : a.welcomeAt ? <><span className="tag go"><span className="dot" />delivered</span>{" "}<span className="mono">{stampIst(a.welcomeAt)}</span>{" "}
            <span className="sm">by {(a.welcomeChannel || "Email").toLowerCase()}</span></>
            : <span className="sm">invited — the app has not confirmed the welcome yet</span>}</dd>
        {off ? null : <>
          <dt>First sign-in</dt><dd>{a.firstSignInAt ? <span className="mono">{stampIst(a.firstSignInAt)}</span> : <span className="sm">never</span>}</dd>
          <dt>Last sign-in</dt><dd>{a.lastSignInAt ? <span className="mono">{stampIst(a.lastSignInAt)}</span> : <span className="sm">never</span>}</dd>
          <dt>Sign-ins</dt><dd>{a.signInCount ?? 0}</dd>
          <dt>Last failed</dt><dd>{a.lastFailedAt ? <><span className="mono">{stampIst(a.lastFailedAt)}</span>{" "}
            <span className={`tag ${failed ? "late" : ""}`.trim()}>{(a.failedCount ?? 0) + " since last success"}</span></> : <span className="sm">none</span>}</dd>
        </>}
      </dl>
      {seatHidden ? <p className="sm" style={{ margin: "10px 0 0" }}>Sign-in activity is not visible for your seat.</p>
        : off ? <p className="sm" style={{ margin: "10px 0 0" }}>Sign-in activity is not recorded yet: the investor app has not started writing it back to Zoho. The account facts above are live.</p>
        : <p className="sm" style={{ margin: "10px 0 0" }}>Written by the investor app when someone signs in. Use it to see whether they got the welcome and whether they are stuck.</p>}
    </div></div>
  );
}
