/* W4-4 — the Investor file's "Record of changes" in plain words. GET /api/activity/history answers which Zoho fields changed
   (api names, never values); this turns a set of them into what the person did. Pure and client-safe: it reads the ladder
   (domain), never src/server. The rung fields are the Lead stamps server/leads/journey RUNGS sets, one per ladder rung. */
import { LADDER } from "@/domain";

/** Lead stamp -> journey rung title (looked up in the ladder, so a renamed rung renames here). */
const RUNG_TITLE: Readonly<Record<string, string>> = Object.freeze({
  First_Touch_At: "First touch made", Qualified_At: "Qualified", Engaged_At: "Engagement done", Said_Yes_At: "Investor said yes",
  Reserved_At: "Reserved — 10% in", Fully_Paid_At: "Fully paid", Allocated_At: "Allocated", Onboarded_At: "Onboarded",
});
const rungTitle = (f: string): string | null => {
  const t = RUNG_TITLE[f];
  return t ? (LADDER.find((r) => r.t === t)?.t ?? t) : null;
};

/** Plain labels for other fields a lead's timeline can carry; anything unlisted is humanised from its api name. */
const LABEL: Readonly<Record<string, string>> = Object.freeze({
  Next_Step: "next step", Next_Step_At: "next step date", Next_Step_Channel: "next step channel", Last_Reply_At: "last reply",
  Lost_At: "closed-as-lost date", Lost_Reason: "reason for closing", Lead_Status: "status", Owner: "owner", Secondary_Owner: "second owner",
  Units_Interested: "units", Full_Name: "name", First_Name: "first name", Last_Name: "last name", Email: "email", Mobile: "mobile", Phone: "phone",
  Lead_Source: "source", Engagement_Skipped: "engagement skipped", Forecast: "forecast",
  Forecast_Paid_By: "forecast pay date", Hold_Until: "hold date", Cover_By: "cover", Cover_Until: "cover until",
});
const humanise = (f: string): string => LABEL[f] ?? f.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

const NEXT = new Set(["Next_Step", "Next_Step_At", "Next_Step_Channel"]);
const CONSENT = new Set(["Consent_WhatsApp", "Consent_Email", "Consent_Call", "Consent_How", "Consent_At", "Consent_By"]);
const LOST = new Set(["Lost_At", "Lost_Reason"]);
const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);

/** One entry of the record of changes as a sentence. `oldest`: the entry is the last (oldest) the list holds, so a bare "added"
 *  there is the record being created; any other bare "added" is something filed against it (a note, a touch or a task). */
export function describeChange(e: { action: string; fields: readonly string[] }, oldest = false): string {
  const action = (e.action || "").toLowerCase();
  const f = e.fields;
  if (!f.length) {
    if (action === "added") return oldest ? "Lead record created" : "Added a note, touch or task";
    if (action === "deleted" || action === "removed") return "Removed an item from the record";
    return action ? action.charAt(0).toUpperCase() + action.slice(1) : "Changed";
  }
  const rungs = f.map(rungTitle).filter((x): x is string => !!x);
  const rest = f.filter((x) => !rungTitle(x));
  const parts: string[] = [];
  if (rungs.length) parts.push("Moved to " + join(rungs));
  if (rest.includes("Rung_Undone_At")) parts.push("Undid a journey step");
  const r2 = rest.filter((x) => x !== "Rung_Undone_At");
  const next = r2.filter((x) => NEXT.has(x)), consent = r2.filter((x) => CONSENT.has(x)), lost = r2.filter((x) => LOST.has(x));
  const others = r2.filter((x) => !NEXT.has(x) && !CONSENT.has(x) && !LOST.has(x) && x !== "Last_Reply_At");
  if (r2.includes("Last_Reply_At")) parts.push(next.length ? "Logged a reply and planned the next step" : "Logged a reply");
  else if (next.length) parts.push("Planned the next step");
  if (consent.length) parts.push("Recorded consent");
  if (lost.length) parts.push("Closed as lost");
  if (others.length) parts.push("Updated " + join(others.map(humanise)));
  return parts.join("; ") || "Changed";
}
