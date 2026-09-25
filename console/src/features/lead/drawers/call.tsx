"use client";

/* ── DRAWERS.call and DRAWERS.details. 03-app.js 6458–6497 ──────────────────────────────────
   How the last call went, recorded by hand like every touch: an outcome and the objections heard,
   so "why we lose" is built from records rather than remembered at the review. An objection is not
   a lost reason — a lead can raise price and still convert.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { CALLOUT, KINDS, OBJS, SRCNEEDS, ST, TOUCHCHANNELS, UNIT } from "@/domain";
import type { Channel, Lead } from "@/domain";
import { hhmm, iso, money, nowT } from "@/lib/format";
import { canPlan, canSee, canWork, conFor, everyone, P, sourceLabel, whyLocked } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { ConsoleState } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { CONHOW } from "@/features/add/state";
import { emailOK, phoneKey, phoneOK } from "@/features/add/csv";

/* DTAB — ir-console-redesigned.html:9518-9607's `openDetails(id,tab)`/`DETAILTAB`. The prototype's
   own two tabs ("Profile"/"Contact permission") and its `openDetails(id,'consent')` entry point are
   what "Record permission" needs: a seed of `{DTAB:"permission"}` on `openDrawer` lands here
   already on the right tab. Declared here rather than in `store.tsx` (not owned by this agent), the
   same way `@/features/pay/reducer` widens `UiState` for its own half-typed forms. */
/* DETAILP/DETAILC — the two tabs' drafts. Rides `ui` (patched with the existing generic `setUi`,
   the same idiom `FollowupDraft`/`ui.FU` already uses) rather than component-local `useState`:
   `registerDrawer`'s registry (`@/components/shell/drawers/registry`, not owned by this agent)
   calls Body and Foot as two separate sibling components, not one rendering the other, so a
   `useState` in one is invisible to the other — the Save button in Foot would never see a field
   just typed into Body. One shared home in `ui` is what keeps them in lock-step. */
declare module "@/lib/store" {
  interface UiState {
    DTAB?: "profile" | "permission";
    DETAILP?: ProfileDraft;
    DETAILC?: PermissionDraft;
  }
}

/* The four channel checkboxes' own labels — ir-console-redesigned.html:11985's
   `[["msg","WhatsApp"],["call","Call"],["email","Email"],["visit","Visit"]]`. `KINDS` (@/domain)
   carries the activity-log's plural forms ("Calls"/"Emails") instead, which is why the read-only
   "Current permission" summary below keeps using that and this form does not. */
const CON_LABEL: Record<Channel, string> = { msg: "WhatsApp", call: "Call", email: "Email", visit: "Visit" };

type ProfileDraft = {
  id: string; n: string; ph: string; em: string; city: string; units: string;
  introducedBy: string; contactPreference: string;
};
type PermissionDraft = { id: string; con: Record<Channel, boolean>; how: string; date: string; time: string };

function buildProfileDraft(l: Lead): ProfileDraft {
  return {
    id: l.id, n: l.n, ph: l.ph || "", em: l.em || "", city: l.city || "", units: l.units ? String(l.units) : "",
    introducedBy: l.introducedBy || "", contactPreference: l.contactPreference || "",
  };
}
function buildPermissionDraft(state: ConsoleState, l: Lead): PermissionDraft {
  const now = nowT(state.NOW);
  return {
    id: l.id,
    con: { msg: conFor(l, "msg"), call: conFor(l, "call"), email: conFor(l, "email"), visit: conFor(l, "visit") },
    how: l.conHow || "",
    date: iso(now),
    time: hhmm(now),
  };
}
/* A draft for a different lead than the one open now (the drawer opened on somebody else since it
   was last built) is exactly the moment to drop it, the same as the prototype's own per-lead
   `DETAILD[detailKey(id)]` cache never lending one investor's edit to another's record. */
const readProfileDraft = (state: ConsoleState, l: Lead): ProfileDraft =>
  state.ui.DETAILP && state.ui.DETAILP.id === l.id ? state.ui.DETAILP : buildProfileDraft(l);
const readPermissionDraft = (state: ConsoleState, l: Lead): PermissionDraft =>
  state.ui.DETAILC && state.ui.DETAILC.id === l.id ? state.ui.DETAILC : buildPermissionDraft(state, l);

/* detailsWhy(l,tab) — ir-console-redesigned.html:11957-11970. Every reason the tab cannot be
   saved, checked in the order somebody would fix them; the Save button reads whichever one this
   returns as its own disabled hint (`detailsFoot`, 11991-11994). */
function profileWhy(state: ConsoleState, l: Lead, d: ProfileDraft): string {
  if (!canWork(state, l)) return whyLocked(state, l);
  if (d.n.trim().length < 2) return "Enter a full name.";
  if (!phoneOK(d.ph)) return "Enter a ten-digit Indian mobile number, or an international number with + and country code.";
  if (state.LEADS.some((x) => x.id !== l.id && phoneKey(x.ph) === phoneKey(d.ph))) return "This mobile number is already on another investor.";
  if (!emailOK(d.em)) return "Enter a valid email, or leave it empty.";
  if (d.units !== "" && (!Number.isInteger(Number(d.units)) || Number(d.units) < 1)) return "Enter whole units, or leave investment intent unknown.";
  return "";
}
function permissionWhy(state: ConsoleState, l: Lead, d: PermissionDraft): string {
  if (!canWork(state, l)) return whyLocked(state, l);
  if (!Object.values(d.con).some(Boolean)) return "";
  if (!CONHOW[d.how]) return "Choose how the investor gave permission.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)) return "Enter the date and time permission was given.";
  const at = new Date(d.date + "T" + d.time + ":00");
  if (isNaN(at.getTime()) || iso(at) !== d.date || at > nowT(state.NOW)) return "Permission must have been given at a valid past or current time.";
  if (d.con.email && !l.em) return "Add the investor's email in Profile before enabling email.";
  return "";
}

function CallBody({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const c = state.CALLS[l.id] || { obj: [] };
  const can = canWork(state, l);
  return (
    <>
      {c.at ? (
        <p className="sm" style={{ margin: "0 0 12px" }}>
          Recorded by {P(state.PEOPLE, c.who).n.split(" ")[0]} ·{" "}
          <span className="mono">{c.at}</span>
        </p>
      ) : null}
      <p className="lbl">What happened</p>
      <div className="chips" style={{ marginBottom: "14px" }}>
        {CALLOUT.map((o) => (
          <button
            type="button"
            key={o}
            className={`chip ${c.o === o ? "on" : ""}`}
            aria-pressed={c.o === o}
            disabled={!can}
            onClick={can ? () => dispatch({ type: "setCall", id: l.id, o }) : undefined}
          >
            {o}
          </button>
        ))}
      </div>
      <p className="lbl">Objections heard</p>
      <div className="chips" style={{ marginBottom: "12px" }}>
        {OBJS.map((o) => (
          <button
            type="button"
            key={o}
            className={`chip ${c.obj.includes(o) ? "on" : ""}`}
            aria-pressed={c.obj.includes(o)}
            disabled={!can}
            onClick={can ? () => dispatch({ type: "toggleObj", id: l.id, o }) : undefined}
          >
            {o}
          </button>
        ))}
      </div>
      <p className="sm" style={{ margin: 0 }}>
        This records the call outcome and objections. Closing an investor requires a separate lost
        reason.
      </p>
      {c.o === "Call back" && canPlan(state, l) ? (
        <div className="drwsec">
          <p className="lbl">They asked to be called back</p>
          <p className="sm" style={{ margin: "0 0 9px" }}>
            Put it on a date and an hour now, while you still remember what they said. It lands on
            your day when it comes round.
          </p>
          <button
            type="button"
            className="act"
            onClick={() => {
              dispatch({ type: "seedNext", id: l.id });
              dispatch({ type: "setNXD", k: "t", v: "Call back" });
              dispatch({ type: "openDrawer", k: "next", id: l.id });
            }}
          >
            Schedule the call back
          </button>
        </div>
      ) : null}
    </>
  );
}

/* DetailsBody — ir-console-redesigned.html:11973-11990 (detailsBody). A FORM on both tabs, not a
   read-only view: Profile corrects the record itself, Contact permission records what the
   investor agreed to. The draft is local component state (see the `saveProfileDetails`/
   `saveContactPermission` comment in `src/lib/store.tsx`) rather than `ui`, reset whenever the
   drawer opens on a different lead (the "adjust state during render when a prop changes" pattern —
   no effect needed, since a new `l.id` this render is exactly the moment to drop last lead's typed
   corrections). */
function DetailsBody({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const ev = l.ev ? state.EVENTS.find((x) => x.id === l.ev) : null;
  const tab = state.ui.DTAB ?? "profile";
  const setTab = (k: "profile" | "permission") => dispatch({ type: "setUi", patch: { DTAB: k } });
  const given = TOUCHCHANNELS.filter((k) => conFor(l, k)).map((k) => KINDS[k]).join(", ");
  const can = canWork(state, l);
  const see = canSee(state, l);

  const profile = readProfileDraft(state, l);
  const permission = readPermissionDraft(state, l);
  const setProfile = (patch: Partial<ProfileDraft>) => dispatch({ type: "setUi", patch: { DETAILP: { ...profile, ...patch } } });
  const setPermission = (patch: Partial<PermissionDraft>) => dispatch({ type: "setUi", patch: { DETAILC: { ...permission, ...patch } } });

  return (
    <>
      <div className="chips" role="tablist" aria-label="Investor details">
        <button
          type="button" className={`chip ${tab === "profile" ? "on" : ""}`} role="tab"
          aria-selected={tab === "profile"} id="detail-tab-profile" aria-controls="detail-panel"
          onClick={() => setTab("profile")}
        >
          Profile
        </button>
        <button
          type="button" className={`chip ${tab === "permission" ? "on" : ""}`} role="tab"
          aria-selected={tab === "permission"} id="detail-tab-permission" aria-controls="detail-panel"
          onClick={() => setTab("permission")}
        >
          Contact permission
        </button>
      </div>
      <div id="detail-panel" role="tabpanel" aria-labelledby={`detail-tab-${tab}`} style={{ marginTop: "14px" }}>
        {tab === "profile" ? (
          <>
            <dl className="kv" style={{ margin: "0 0 12px" }}>
              <dt>Owner</dt>
              <dd>
                {l.own ? P(state.PEOPLE, l.own).n : "Unassigned"}
                {l.sec ? " · secondary " + P(state.PEOPLE, l.sec).n : ""}
              </dd>
              <dt>Source</dt>
              <dd>
                {sourceLabel(state, l) || "Not recorded"}
                {ev ? ` · ${ev.n}` : ""}
                {l.src === "Channel partner" && !l.channelPartnerId ? " · Partner not recorded" : ""}
              </dd>
              <dt>Captured</dt>
              <dd className="mono">{l.at[0] || "—"}</dd>
            </dl>
            {see ? (
              <div className="frow">
                <label className="fi">
                  <span>Full name</span>
                  <input id="detail-n" className="inp" value={profile.n} disabled={!can} onChange={(e) => setProfile({ ...profile, n: e.target.value })} />
                </label>
                <label className="fi">
                  <span>Mobile</span>
                  <input id="detail-ph" className="inp" type="tel" value={profile.ph} disabled={!can} onChange={(e) => setProfile({ ...profile, ph: e.target.value })} />
                </label>
                <label className="fi">
                  <span>Email · optional</span>
                  <input id="detail-em" className="inp" type="email" value={profile.em} disabled={!can} onChange={(e) => setProfile({ ...profile, em: e.target.value })} />
                </label>
                <label className="fi">
                  <span>City · optional</span>
                  <input id="detail-city" className="inp" placeholder="Not known yet" value={profile.city} disabled={!can} onChange={(e) => setProfile({ ...profile, city: e.target.value })} />
                </label>
              </div>
            ) : (
              <dl className="kv">
                <dt>Mobile</dt><dd>••••••</dd>
                <dt>Email</dt><dd>••••••</dd>
                <dt>City</dt><dd>{l.city || "Not known yet"}</dd>
              </dl>
            )}
            {l.done < ST.RESERVED ? (
              <label className="fi" style={{ marginTop: "12px" }}>
                <span>Investment intent · units, optional</span>
                <input
                  id="detail-units" className="inp" type="number" min={1} step={1} placeholder="Not known yet"
                  value={profile.units} disabled={!can}
                  onChange={(e) => setProfile({ ...profile, units: e.target.value })}
                />
              </label>
            ) : (
              <dl className="kv">
                <dt>Reserved units</dt>
                <dd>{l.units} · {money(l.units * UNIT)}. Corrections belong to the Finance process.</dd>
              </dl>
            )}
            {l.src !== "Channel partner" && SRCNEEDS[l.src] === "person" ? (
              <label className="fi" style={{ marginTop: "12px" }}>
                <span>Who introduced them · optional</span>
                <select
                  id="detail-introducedBy" className="selw" value={profile.introducedBy} disabled={!can}
                  onChange={(e) => setProfile({ ...profile, introducedBy: e.target.value })}
                >
                  <option value="">Not recorded</option>
                  {everyone(state).map((k) => <option value={k} key={k}>{P(state.PEOPLE, k).n}</option>)}
                  <option value="ext">Somebody outside ARL</option>
                </select>
              </label>
            ) : null}
            <label className="fi" style={{ marginTop: "12px" }}>
              <span>Preferred contact time or instructions · optional</span>
              <textarea
                id="detail-contactPreference" className="nta" rows={2} disabled={!can}
                placeholder="e.g. Calls after 6pm; WhatsApp during the day"
                value={profile.contactPreference}
                onChange={(e) => setProfile({ ...profile, contactPreference: e.target.value })}
              />
            </label>
            <p className="sm" style={{ margin: "9px 0 0" }}>
              Corrections keep their previous value, your name and the time. Unknown investment
              intent adds no forecast value.
            </p>
            {l.profileHistory && l.profileHistory.length ? (
              <details className="ux-disclosure" data-ux-key={`profile-history-${l.id}`}>
                <summary>Recent corrections</summary>
                <div className="cb">
                  {l.profileHistory.slice(0, 5).map((h, i) => (
                    <p className="sm" key={i}>
                      {P(state.PEOPLE, h.who).n} · {h.at} ·{" "}
                      {h.changes.map((x) => `${x.field}: ${x.from || "not known"} → ${x.to || "not known"}`).join("; ")}
                    </p>
                  ))}
                </div>
              </details>
            ) : null}
          </>
        ) : (
          <>
            <p className="sm" style={{ margin: "0 0 12px" }}>
              Record what the investor agreed to. Each unticked channel remains blocked. Clearing
              every channel records withdrawal.
            </p>
            <div className="chips">
              {(Object.keys(CON_LABEL) as Channel[]).map((k) => (
                <label className={`chip ${permission.con[k] ? "on" : ""}`} key={k}>
                  <input
                    id={`detail-con-${k}`} type="checkbox" checked={permission.con[k]} disabled={!can}
                    onChange={(e) => setPermission({ ...permission, con: { ...permission.con, [k]: e.target.checked } })}
                  />{" "}
                  {CON_LABEL[k]}
                </label>
              ))}
            </div>
            <label className="fi" style={{ marginTop: "12px" }}>
              <span>How permission was given</span>
              <select
                id="detail-how" className="selw" value={permission.how} disabled={!can}
                onChange={(e) => setPermission({ ...permission, how: e.target.value })}
              >
                <option value="">Choose how…</option>
                {Object.keys(CONHOW).map((k) => <option value={k} key={k}>{CONHOW[k]}</option>)}
              </select>
            </label>
            <div className="frow" style={{ marginTop: "12px" }}>
              <label className="fi">
                <span>Date given</span>
                <input id="detail-date" className="di2" type="date" value={permission.date} disabled={!can} onChange={(e) => setPermission({ ...permission, date: e.target.value })} />
              </label>
              <label className="fi">
                <span>Time given</span>
                <input id="detail-time" className="di2" type="time" value={permission.time} disabled={!can} onChange={(e) => setPermission({ ...permission, time: e.target.value })} />
              </label>
            </div>
            <p className="sm" style={{ margin: "10px 0 0" }}>Recorded by {P(state.PEOPLE, state.WHO).n} when saved.</p>
            <dl className="kv">
              <dt>Current permission</dt>
              <dd>{given || "None · outbound blocked"}</dd>
              <dt>Given</dt>
              <dd>
                {l.conAt || "Not recorded"}
                {l.conHow && CONHOW[l.conHow] ? " · " + CONHOW[l.conHow] : ""}
              </dd>
              <dt>Recorded by</dt>
              <dd>{l.conBy ? P(state.PEOPLE, l.conBy).n : "Not recorded"}</dd>
            </dl>
            {l.permissionHistory && l.permissionHistory.length ? (
              <details className="ux-disclosure" data-ux-key={`permission-history-${l.id}`}>
                <summary>Permission history</summary>
                <div className="cb">
                  {l.permissionHistory.slice(0, 5).map((h, i) => (
                    <p className="sm" key={i}>
                      {h.recordedAt} · {P(state.PEOPLE, h.who).n} ·{" "}
                      {(Object.keys(h.channels) as Channel[]).filter((k) => h.channels[k]).map((k) => KINDS[k]).join(", ") || "All channels removed"}
                      {h.givenAt ? ` · given ${h.givenAt}` : ""}
                    </p>
                  ))}
                </div>
              </details>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function DetailsFoot({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const tab = state.ui.DTAB ?? "profile";
  const profile = readProfileDraft(state, l);
  const permission = readPermissionDraft(state, l);
  const why = tab === "permission" ? permissionWhy(state, l, permission) : profileWhy(state, l, profile);
  const label = tab === "permission" ? "Save contact permission" : "Save details";
  const save = () => {
    if (why) return;
    if (tab === "permission") {
      const { con, how, date, time } = permission;
      dispatch({ type: "saveContactPermission", id: l.id, con, how, date, time });
    }
    else dispatch({ type: "saveProfileDetails", id: l.id, patch: profile });
  };
  return (
    <>
      <button type="button" className="act" disabled={!!why} title={why || undefined} onClick={why ? undefined : save}>
        {label}
      </button>
      {why ? <span className="sm">{why}</span> : null}
    </>
  );
}

registerDrawer("call", {
  lead: true,
  w: 440,
  title: () => "How the last call went",
  sub: (_s, a) => a.lead!.n,
  Body: CallBody,
});

registerDrawer("details", {
  lead: true,
  w: 540,
  title: () => "Investor details",
  sub: (_s, a) => a.lead!.n,
  Body: DetailsBody,
  Foot: DetailsFoot,
});
