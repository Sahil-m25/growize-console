/**
 * The help drawer's copy. Ports `ref/03-app.js` lines 4844-5016.
 *
 * Two lists, and the second is the one that earns its place: almost every question people ask a
 * console like this one is really "why won't it let me", and the honest answer is always a rule
 * somebody wrote down on purpose.
 *
 * NOTE: a few of these strings carry inline `<b>` and `<i>` markup, because the prototype dropped
 * them straight into `innerHTML`. They are kept verbatim so nothing is lost; whoever renders the
 * drawer has to turn them into JSX rather than reach for `dangerouslySetInnerHTML`.
 */

import type { FaqItem, HelpTopic, ImNavKey, ViewKey } from "./types";

export const HELP: Record<Exclude<ViewKey, ImNavKey>, HelpTopic> & Partial<Record<ImNavKey, HelpTopic>> = {
  today:{t:"My day", p:`Everything that needs you today, in the order it needs you — overdue first,
    then due, then the rest. It is not a list of your leads; it is a list of the ones with a clock on
    them. Empty is the correct end state.`,
    b:["Personal is your own book; Team is your people's, and a manager's day is not a superset of it",
       "The week and month views read the same book forward — dated steps, reservation clocks and forecast dates",
       "An active lead with no next step shows here until it has one"]},
  leads:{t:"Leads", p:`Your whole book, searchable by anything you would remember a lead by — a name,
    part of a number, a city, an event. The rail beside the list is the filter set: every count on it
    is the same list cut one way, and tapping one applies that cut.`,
    b:["Press / or ⌘K from anywhere to search","A masked number is not searchable by the seat it is masked from",
       "Every filter composes; clearing one keeps the rest"]},
  lead:{t:"One lead", p:`One column, and a row of doors. The page shows what is true now — where it is,
    what happens next, and what it is forecast to do. Everything else — history, notes, touches, money,
    owners — opens in this drawer, so nothing you were reading moves.`,
    b:["The lifecycle is the ladder: nothing is skipped",
       "Touches are logged one at a time, as they happen",
       "A rung can be undone for eight hours, and only one back"]},
  add:{t:"Add lead", p:`Five questions, one open at a time, each showing its answer once given. A lead
    with no source cannot be counted in the funnel and a lead with no consent cannot be contacted, so
    the form will not save without either.`,
    b:["The mobile number is the identity a duplicate is checked against",
       "If you are an IR, what you add is yours",
       "Adding sends nothing — the first message is a rung on the ladder"]},
  updates:{t:"Updates", p:`What changed since you last looked, grouped by what kind of thing it was.
    Nothing is named until you open a group, so a busy week reads as six lines rather than sixty.`,
    b:["Derived from the log and from lead state — never a second store"]},
  activity:{t:"Activity", p:`What each person did, day by day. This is effort, not results: whose books
    need attention is read on Numbers, and the two are deliberately not the same screen.`,
    b:["A glyph per kind of action; a colour per person",
       "The ordinal is the attempt on that lead that week"]},
  people:{t:"People", p:`The org as it is. A team is a manager and the people appointed under them, and
    the manager is the ceiling on what those people can reach — so moving somebody changes their access
    on its own, with nobody editing a grid.`,
    b:["The manager bounds which pages you reach; the seat decides what you may do there",
       "You can only grant something you hold yourself",
       "An absence is a window with two dates: it can be booked ahead, and it clears itself"]},
  goals:{t:"Plan", p:`The target, the periods it is split into, and the rates the funnel is planned at.
    Every derived figure in the product reads from here, so moving a rate moves the whole console in
    front of you.`,
    b:["Target, planning baseline and verified actual are three different things",
       "Only Finance enters a verified actual"]},
  events:{t:"Events", p:`What each field event actually produced, against what the plan needs one to
    produce. The need is derived from the Plan and never typed here.`,
    b:["A sheet of intake rows loads in one pass, duplicates refused"]},
  event:{t:"One event", p:`What this event produced, who staffed it, and what it cost per qualified
    lead. Cost per qualified lead is the only number that compares two events honestly.`},
  pay:{t:"Payments", p:`Receipts as Finance recorded them: mode, reference, date. A 10% advance starts a
    30-day balance clock, and a lapse forfeits ₹50,000 a unit and returns the units to the shelf.`,
    b:["Only Finance records a receipt","Only the BU Owner may extend a hold"]},
  docs:{t:"Documents", p:`Every agreement and declaration sent, and what state it is in. A document is
    not evidence of anything until it is signed.`},
  xfer:{t:"Investor transfers", p:`A paid lead becoming an investor record. Nobody performs it and
    nobody approves it: Finance confirming the first receipt mints the ARL ID, files every document
    under it, opens the app account and sends the welcome. This page is the register of that, plus
    a check that no confirmed receipt is missing its record.`,
    b:["The ARL ID minted here is the join between the two orgs",
       "A receipt with no record is a broken link, not somebody's forgotten queue"]},
  numbers:{t:"Numbers", p:`Three questions, three tabs. <b>From the book</b> is computed from the records
    this console holds, right now. <b>The plan</b> is what was committed to. <b>Where it is breaking</b>
    is the gap, with one owner and one recovery action on every amber and red line.`,
    b:["A figure marked demo is not real and must not be reported as real",
       "Section chips show one topic at a time, so nothing has to be read across two columns"]},
  system:{t:"System", p:`What the machine is doing — the parts that work as well as the parts that do
    not, each with three weeks of history behind it. A check with a clean run behind it is the reason
    a figure can be trusted at all.`,
    b:["Each strip is drawn from that check's own dates — nothing here is polled or sampled yet",
       "Every finding carries what would fix it, and who owns it"]},
  me:{t:"Profile", p:`Your details, your badge, and where you are. Also who else is at their desk — that
    is here rather than behind a permission because it is the question everybody asks.`,
    b:["Your colour and shape are you, everywhere you appear",
       "Marking yourself out hands your open leads to your secondary",
       "Leave can be booked ahead — it does nothing until the day it starts"]}
};
export const FAQ: readonly FaqItem[] = [
 {q:"Why can I not change this lead any more?",
  a:`Because it is not with you. Custody moves with the ladder: an IR holds a lead up to the moment the
     10% lands, and from there it is Finance's until it is allocated. The lead page says who holds it
     and why, on every control it greys out.`},
 {q:"I have just made a mistake. Can I undo it?",
  a:`For eight hours, and only one rung back, and only if you are the seat that ticked it. Past that a
     correction is a <b>new</b> record rather than an edit, because an audit trail that can be rewritten
     is not an audit trail. Past the 10% reservation the lead owner cannot undo anything at all —
     only Finance can.`},
 {q:"Why will it not let me record a WhatsApp?",
  a:`No consent recorded on that lead, or none on that channel. Outbound is blocked on any lead with
     none, on every channel it was not given for, and the refusal names which. Consent is captured
     where the person actually gave it — at the event, or on the add form — and never re-asked here.`},
 {q:"Somebody else's lead is in my list. Why?",
  a:`You are the named secondary and they are marked out, or a cover window is open. You can work it
     while that lasts; you never become the owner. When they come back it goes quiet again on its own.`},
 {q:"How do I get a lead moved to somebody else?",
  a:`Ask. If you are the owner of record you can raise a request with a name and a reason, and your
     manager or anyone above decides — you cannot move it yourself, which is what "one lead, one owner"
     means. A secondary cannot raise it at all.`},
 {q:"Why did my access change when I moved teams?",
  a:`Because a manager is the ceiling. You cannot reach a page the person you are appointed under
     cannot reach, so moving between teams changes your reach with nobody editing a grid. What you may
     <i>do</i> on the pages you reach still comes from your seat.`},
 {q:"What do the colours beside names mean?",
  a:`One colour and shape per person, used everywhere they appear, so a column of owners can be scanned
     without reading a word. They mean nothing else — green, amber and red are reserved for whether a
     lead is in trouble, and are never spent on a person.`},
 {q:"What do green, amber and red mean on a lead?",
  a:`Green is on track. Amber is slipping — a missed date, a cover in place, a hold inside three days.
     Red is breached: no owner, an owner who is out with nobody covering, three days late, or a lapsed
     reservation.`},
 {q:"Why can I not sign in as Finance?",
  a:`Because there is nothing for them to do here. Finance works in the Investor Management portal —
     that is where a document is uploaded, sent and verified, and where a receipt is banked, because
     that is where the file and the signing account are. Everything they do lands on your lead within
     the minute, marked as having come from there. Giving them a second login here would mean giving
     them a second place to type the same thing, and within a month the two would disagree. You will
     still see their names all over your leads: they are the author of half of every round.`},
 {q:"Finance sent the agreement. Do I record that here?",
  a:`No — it is already here. Finance sends and verifies in the Investor Management portal, because
     that is where the file and the signing account are, and it lands on the lead within the minute
     marked as having come from there. Your half of the round is the part only you can do: telling
     the investor it is waiting for them, chasing until they sign, and recording what they told you.
     If you also had to type “Finance sent it”, that would be two entries for one fact, and within a
     month the two would disagree.`},
 {q:"Where do the two rounds of paperwork actually live?",
  a:`One place each, and never two. The NDA goes first and gates the material — nothing is sent to
     somebody who has not signed one. The supplementary agreement comes after the investor says yes:
     you draft it, you chase agreement on it, you record the link to the final draft, and Finance
     sends that version for signature. The document itself is in Zoho under the investor. What is
     here is the state of the round and who owes the next move.`},
 {q:"An investor paid the 10%. What happens to their record?",
  a:`Open their Growize account from the lead. That mints their ARL ID and moves everything about
     them — documents, receipts, the agreement — into Growize. Nothing is copied: from that moment
     the lead is only the work that is left, which is the balance. You can send them the login the
     same day if they want it; the app shows the truth as it stands, which is units reserved and a
     balance still due. Full payment changes what the units are called, not where anything lives.`},
 {q:"Do I have to enter this in the CRM as well?",
  a:`No. A lead is entered once, here, and worked here — the capture, every touch, the stage, the
     forecast, the reason it was lost. The CRM sits downstream and receives a copy on its own; nobody
     types a name into two systems. If the export is down, System says so on the front page and the
     copy catches up when it is fixed. What you must never do is “help” by entering it in both:
     that is how two records of the same investor start disagreeing, and neither of them can be
     trusted afterwards.`},
 {q:"We texted three times and called twice. How do I record that?",
  a:`One at a time, as they happen, from Touchpoints on the lead. Each entry keeps its own stamp, so
     "third attempt, no reply" is a fact rather than a memory. The first entry in a channel is what the
     service level is measured against.`},
 {q:"What is the difference between Commit, Probable and Pipeline?",
  a:`Commit and Probable need investor-specific evidence and an expected date, and only they count
     toward the period. Pipeline is coverage — it is never a date and never an achievement.`},
 {q:"A figure says “not built”. What does that mean?",
  a:`The field it would be computed from does not exist yet, so the number beside it is illustrative.
     Every one of them names the console field that would make it real, and every finding on System
     carries what would fix it — which is why both read as a build list rather than a complaint.`},
 {q:"Somebody is on leave. Who works their leads?",
  a:`Their named secondary, for as long as the absence lasts. The owner never changes, and the lead
     turns amber to say somebody else is on it. Any open lead of theirs with <b>no</b> secondary turns
     red at the top of the team day, because that is a lead nobody is working.`},
 {q:"Two people gave me the same lead. What happens?",
  a:`The second one is refused. A lead is identified by the last ten digits of the mobile number, so
     the add form finds the existing record before it saves and offers to open it instead. The event
     sheet does the same thing in bulk — its duplicates are skipped and counted, never merged.`},
 {q:"Where does the 208-unit target come from?",
  a:`The Plan. Every derived figure in the console reads from there — the funnel requirement, what an
     event has to produce, the monthly collection target. Change a rate on Plan and they all move.`},
 {q:"Why does the console not send the WhatsApp itself?",
  a:`Because it cannot, and pretending otherwise would put "sent" in the record when nothing was sent.
     The IR sends it from their phone; the control records that it happened, which is why every one of
     them is worded in the past tense.`},
 {q:"What happens if a reservation hold lapses?",
  a:`₹50,000 a unit is forfeit and the units go back on the shelf. Only the BU Owner may approve an
     extension, and only before the hold ends.`},
 {q:"Something on this console is wrong. Who do I tell?",
  a:`Digital Infrastructure owns the machine — every check on System names its owner. Anything about a
     seat, a team or who can do what goes to your manager first.`}
];
