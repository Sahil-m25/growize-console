"use client";

/* System — imx.js section 14b, vSys (lines 2300–2470). The super administrator's screen: is the
   link carrying everything, do the two books agree, who looked at what and who changed whose seat.
   It holds no investor detail of its own — every figure is counted off records that exist
   elsewhere, and every investor-bearing line reads "Investor details withheld". */

import {
  activityBase, allocated, day6, freeUnits, GLYPH, nOpen, nState, pageReadable, released, reserved,
  role, safeNote, secOf, sysChecks, teamOf, who,
} from "@/lib/im";
import type { ImState } from "@/lib/im";
import { ImPname, ImSecBar, type ImPageProps } from "../common";
import { TestLinkAudit } from "../money/pages";

const Stat = ({ v, t, bad }: { v: number; t: string; bad?: boolean }) =>
  <div className={`stat ${bad ? "bad" : ""}`}><b>{v}</b><span>{t}</span></div>;

export function ImSys({ s, me, dispatch }: ImPageProps) {
  if (!pageReadable(s, me, "sys")) return null;
  const D = s.data;
  const S = secOf(s.ui.SEC, "sys", [{ k: "link" }, { k: "agree" }, { k: "who" }, { k: "gaps" }]);
  const C = sysChecks(s);
  const { inOpen, noAcct, orphanIn } = C;
  const base = activityBase(s, me);
  const reveals = base.filter(e => e.kind === "pii");
  const seats = base.filter(e => /^Changed a seat/.test(e.what));
  const stuck = orphanIn.length + noAcct.length;
  return (
    <>
      <div className="ph"><h1>System</h1>
        <span className="sub">the two applications, and whether they are telling each other the truth</span>
        <div className="sp"></div><span className={`tag ${stuck ? "late" : "go"}`}>
          <span className="dot"></span>{stuck ? "needs looking at" : "nothing stuck"}</span></div>
      <div className="stats">
        <Stat v={D.INBOX.length} t="in from the lead side" />
        <Stat v={inOpen.length} t="of those still open" bad={inOpen.length > 2} />
        <Stat v={D.OUTBOX.length} t="sent back this session" />
        <Stat v={stuck} t="stuck" bad={!!stuck} />
      </div>
      <ImSecBar s={s} dispatch={dispatch} v="sys" list={[{ k: "link", t: "The link" }, { k: "agree", t: "Do the books agree" },
        { k: "who", t: "Who did what", n: reveals.length, warn: true }, { k: "gaps", t: "What is not built" }]} />
      <div className="secw">
        {S === "link" ? <Link s={s} /> : null}
        {S === "agree" ? <Agree s={s} /> : null}
        {S === "who" ? <WhoDid s={s} me={me} reveals={reveals} seats={seats} /> : null}
        {S === "who" ? <TestLinkAudit s={s} me={me} dispatch={dispatch} /> : null}
        {S === "gaps" ? <Gaps /> : null}
      </div>
    </>
  );
}

function Link({ s }: { s: ImState }) {
  const D = s.data, { oldest } = sysChecks(s);
  return (
    <>
      <div className="card"><div className="ch"><h3>What the lead side has told the Investors side</h3>
        <div className="sp"></div><span className="tag ir">Lead side</span></div><div className="cb">
        {D.INBOX.length ? D.INBOX.map(n => (
          <div className="led" style={{ alignItems: "flex-start" }} key={n.id}>
            <span className={`tag ${nOpen(s, n) ? "late" : nState(s, n) === "confirmed" ? "go" : ""}`}>{nState(s, n)}</span>
            <span style={{ minWidth: 0 }}><b>IR {n.kind || "link"} event</b>
              <div className="sm">Investor details withheld · {who(s, n.ir).n} ·{" "}
                <span className="mono">{n.at}</span>{D.INV.some(x => x.id === n.inv) ? null
                  : <> · <span className="tag late">no investor here with that ARL ID</span></>}</div></span></div>
        )) : <p className="sm" style={{ margin: 0 }}>Nothing has come over.</p>}
        {oldest ? <p className="sm" style={{ margin: "11px 0 0" }}><b>The oldest thing waiting is {day6(oldest.at)}.</b>
          {" An IR wrote it and is now waiting on somebody here — which is the only kind of delay in this design that the investor can feel, because their own contact has nothing to tell them."}</p> : null}
      </div></div>
      <div className="card fill" style={{ marginTop: "8px" }}><div className="ch"><h3>What the Investors side has told the lead side</h3>
        <div className="sp"></div><span className="tag br">Investors side</span></div><div className="cb">
        {D.OUTBOX.length ? D.OUTBOX.map((x, i) => (
          <div className="led" key={i}>
            <span style={{ minWidth: 0 }}><b>Portal link event</b>
              <div className="sm">Investor details withheld · <ImPname s={s} k={x.by} first /> ·{" "}
                <span className="mono">{x.at}</span></div></span></div>
        )) : <p className="sm" style={{ margin: 0 }}>{"Nothing has gone back in this session. The stream fills as receipts are confirmed and documents verified — every entry here is a fact this side established, on its way to a screen the IR is already looking at."}</p>}
        <p className="sm" style={{ margin: "11px 0 0" }}><b>One fact, one writer.</b>{" The two streams above are the whole of the join between the applications: what the IR said, and what Finance established. Neither side re-types the other's work, which is why there is no third place where the two could disagree — and why a missing entry is a broken link rather than a wrong number."}</p>
      </div></div>
    </>
  );
}

function Agree({ s }: { s: ImState }) {
  const D = s.data, C = sysChecks(s);
  const { noAcct, orphanIn, marks, paid, withApp, over } = C;
  const rows: [string, boolean, string, string][] = [
    ["No unit is sold twice", !over, released(s) + " released, " + (allocated(s) + reserved(s)) + " spoken for",
      "Two investors are told they own the same trees."],
    ["Every receipt has an account", noAcct.length === 0, paid + " paid, " + withApp + " with an account",
      "Somebody sent money and cannot see anything."],
    ["Every mark matches the ledger", marks.length === 0,
      marks.length ? marks.length + " account discrepancies" : "all " + withApp + " agree",
      "A record says settled while money is outstanding, or the reverse."],
    ["Every claim has an investor", orphanIn.length === 0,
      orphanIn.length ? orphanIn.length + " unresolved claim references" : "all " + D.INBOX.length + " resolve",
      "The two books have drifted and the ARL ID no longer joins them."],
    ["Every document has an owner", C.docsOwned, D.DOCS.length + " on file", "A signed agreement belongs to nobody."],
  ];
  return (
    <>
      <div className="stats" style={{ marginBottom: "8px" }}>
        <Stat v={released(s)} t="units released" />
        <Stat v={allocated(s) + reserved(s)} t="units spoken for" />
        <Stat v={freeUnits(s)} t="free to sell" bad={over} />
        <Stat v={marks.length} t="marks that disagree with the ledger" bad={!!marks.length} />
      </div>
      <div className="card fill"><div className="ch"><h3>Every check, and what it would cost</h3></div><div className="tw"><table>
        <thead><tr><th>Check</th><th>Now</th><th>What a failure means</th></tr></thead><tbody>
          {rows.map(([t, ok, now, cost]) => (
            <tr key={t}>
              <td><b>{t}</b></td>
              <td>{ok ? <span className="tag go"><span className="dot"></span>holds</span>
                : <span className="tag late"><span className="dot"></span>fails</span>}
                <div className="sm">{now}</div></td>
              <td className="sm">{cost}</td></tr>
          ))}
        </tbody></table></div>
        <div className="cb" style={{ paddingTop: "9px" }}><p className="sm" style={{ margin: 0 }}>{"Every one of these is computed, here, from the records the Investors side holds — none of it is a stored status anybody can set. A check that fails is therefore a fact about the data, not a flag somebody forgot to clear."}</p></div></div>
    </>
  );
}

type Entry = ReturnType<typeof activityBase>[number];
function WhoDid({ s, me, reveals, seats }: { s: ImState; me: string; reveals: Entry[]; seats: Entry[] }) {
  const base = activityBase(s, me);
  return (
    <>
      <div className="card"><div className="ch"><h3>Who looked at an identity, and why</h3>
        <div className="sp"></div><span className={`tag ${reveals.length > 3 ? "late" : ""}`}>{reveals.length}</span></div><div className="cb">
        {reveals.length ? reveals.map((e, i) => (
          <div className="led" style={{ alignItems: "flex-start" }} key={i}>
            <span className="tag late">{GLYPH.pii}</span>
            <span style={{ minWidth: 0 }}><b>{e.what}</b>
              <div className="sm"><ImPname s={s} k={e.who} /> · Investor details withheld ·{" "}
                <span className="mono">{e.at}</span></div>
              <p className="sm" style={{ margin: "4px 0 0" }}>{safeNote(s, me, e.note) || "no reason given"}</p></span></div>
        )) : <p className="sm" style={{ margin: 0 }}>{"Nobody has unmasked a PAN or a bank account in this session. That is the number this page exists to watch, so an empty list is the good answer."}</p>}
      </div></div>
      <div className="card" style={{ marginTop: "8px" }}><div className="ch"><h3>Who changed whose seat</h3></div><div className="cb">
        {seats.length ? seats.map((e, i) => (
          <div className="led" key={i}>
            <span style={{ minWidth: 0 }}><b>{e.note}</b>
              <div className="sm"><ImPname s={s} k={e.who} /> · <span className="mono">{e.at}</span></div></span></div>
        )) : <p className="sm" style={{ margin: 0 }}>No seat has changed in this session.</p>}
        <p className="sm" style={{ margin: "11px 0 0" }}><b>The hole administration cannot close.</b>
          {" An administrator can hand somebody else a seat that reads every identity in the book. Nothing in software prevents that — it is what administration "}<em>is</em>{" — so the answer is not a lock: it is that the act appears above with a name and a time, on a page you read. What is closed is the version with only one person in it, because nobody can promote themselves."}</p>
      </div></div>
      <div className="card fill" style={{ marginTop: "8px" }}><div className="ch"><h3>How busy each seat has been</h3>
        <div className="sp"></div><span className="sm">this session</span></div><div className="tw"><table>
        <thead><tr><th>Person</th><th>Team</th><th>Seat</th><th className="n">Actions</th>
          <th className="n">Identity reveals</th><th>Last thing they did</th></tr></thead>
        <tbody>{s.data.SIGNINS.map(k => {
          const mine = base.filter(e => e.who === k);
          const r = mine.filter(e => e.kind === "pii").length;
          return (
            <tr key={k}><td><ImPname s={s} k={k} b /></td>
              <td className="sm">{teamOf(s, k)}</td><td className="sm">{role(s, k).t}</td>
              <td className="n">{mine.length}</td>
              <td className="n">{r ? <span className="tag late">{r}</span> : <span className="sm">—</span>}</td>
              <td className="sm">{mine.length ? <>{mine[0].what} <span className="mono">{day6(mine[0].at)}</span></> : "nothing yet"}</td>
            </tr>
          );
        })}</tbody></table></div></div>
    </>
  );
}

const GAPS: [string, string][] = [
  ["The link itself is a demo.",
    "INBOX and OUTBOX are arrays in this file. In the real thing they are a queue between two "
    + "services, and every guarantee on the previous tab depends on it being one that retries "
    + "and cannot lose a message. This is the single largest piece of unbuilt work in either app."],
  ["Nothing here writes to Zoho.",
    "The console's rule is that data is entered once, in the console, and flows outward. The "
    + "same rule has to hold from this side for documents and receipts, and the connector does "
    + "not exist yet."],
  ["The app the investor sees is not in this prototype.",
    "The account, the welcome and the tentative mark are all real states on this side. What "
    + "the investor actually opens — statements, the farm, their documents — is a third "
    + "application and is not drawn anywhere."],
  ["Reveals are logged; they are not reviewed.",
    "A log nobody reads is a filing cabinet. The tab before this one is where a review would "
    + "start, but there is no cadence on it and no alert: three reveals in a morning by one "
    + "person should reach somebody the same morning."],
  ["A seat change takes effect instantly and silently.",
    "It is recorded, and that is all. There is no second approval and no notification to the "
    + "person whose access changed, which are both cheap and both worth having."],
];
function Gaps() {
  return (
    <div className="card fill"><div className="ch"><h3>What is not built</h3></div><div className="cb">
      {GAPS.map(([t, d]) => (
        <div className="led" style={{ alignItems: "flex-start" }} key={t}>
          <span className="tag due">open</span>
          <span style={{ minWidth: 0 }}><b>{t}</b>
            <p className="sm" style={{ margin: "4px 0 0" }}>{d}</p></span></div>
      ))}
      <p className="sm" style={{ margin: "11px 0 0" }}>{"This list is on the super administrator's screen rather than in a document because it is the honest half of a demo: everything else in both applications works, and these five are the reasons it is not yet a system."}</p>
    </div></div>
  );
}
