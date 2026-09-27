import type { Action, ConsoleState } from "./store";
import { accountAllowed, canOperateLeads, openable } from "./selectors";
import { createSaveQueue, type SaveQueueOptions, type SaveResult, type SaveQueue } from "./save-queue";
import { investorCopyOf, investorCopyReplayTarget } from "./investor-copy";

/** 03-app.js:4614. What a write refused by `armFail` says. */
const WHYFAIL = "The local demo did not confirm this change.";

/** ir-console-redesigned.html:13498-13536 (`protectLocalSave`). These writes call the real
 *  function directly once the browser is online, never through `commit()` — only `commit()`'s own
 *  try block reads `FAILNEXT` (ir-console-redesigned.html:4731). So the System test toggle fails
 *  the next write that would have gone through `commit()` (every ladder/queue write below), and
 *  never one of these — armed or not, `setMe` and the rest here still land. */
const PROTECTED_LOCAL_SAVE = new Set([
  "setMe", "setMyStyle", "setAvail", "setOutWhy", "setOutTo", "setOutFrom", "endCoverFor",
  "reassignTo", "askMove", "askExt", "decideMove", "handover", "endCover", "moveNextTo",
  "grantTemp", "revokeTemp", "addPerson", "setMgr", "toggleCap", "resetCaps",
  "setNum", "setGrain", "addPeriod", "setRecov", "clearRecov", "clearNext", "keepNext",
  "setFc", "setFcEv", "prDraft", "prRedraft", "prAgreed", "prTold", "prChase", "prSaid",
]);

/** UI drafts and navigation remain local. Only durable business mutations wait for connection. */
export const BUSINESS_WRITES = new Set([
  "logTouch", "tick", "untick", "skipStage", "undoStage", "assign", "dropAssign", "setSecondary", "reassignTo",
  "askMove", "decideMove", "handover", "endCover", "endCoverFor", "saveNext", "clearNext", "keepNext",
  "pullIn", "moveNextTo", "saveTouch", "dropTouch", "saveFollowup", "setFc", "setFcBy", "setFcEv", "setFcDate", "closeLost",
  "reopenLost", "addNote", "setCall", "toggleObj", "mat", "pack", "prDraft", "prRedraft", "prAgreed",
  "prSend", "prTold", "prChase", "prSaid", "prVerify", "prBounce", "prGate", "addLead", "loadSheet",
  "addEvent", "saveEvent", "dropEvent", "markRead", "showRef", "addPerson", "removePerson", "setMgr", "setSeat", "toggleCap", "resetCaps",
  "setMe", "setMyStyle", "setAvail", "setOutWhy", "setOutFrom", "setOutTo", "grantTemp", "revokeTemp",
  "bump", "setNum", "setTarget", "setActual", "setPeriodDate", "setGrain", "addPeriod", "dropPeriod",
  "setBaseline", "setRecov", "clearRecov", "record", "claimPaid", "confirmClaim", "rejectClaim",
  "reopenClaim", "startPaymentReport", "askExt", "decideExt", "lapse", "sendDoc", "recordDoc", "setReleased", "acctAuto",
  "acctLapsed", "xferAuto", "copyInvestor", "flagDupe", "csvImport", "log",
  "lpFinish", "lpLose", "lpRestore", "lpPaper", "emSend", "undoRung", "recordRung", "tickCommit",
]);

const DRAFTS: Record<string, readonly string[]> = {
  addLead: ["ADDN", "ADDPH", "ADDEM", "ADDCITY", "ADDOWN", "ADDNOTE", "ADDCON", "ADDU", "ADDC", "ADDSRC", "ADDEV", "ADDBY", "ADDCP", "ADDHOW"],
  csvImport: ["CSV", "CSVEV"],
  addPerson: ["NEWP"], grantTemp: ["TGT"], saveNext: ["NXD", "NXID"], saveTouch: ["TD", "TID"],
  addNote: ["NDRAFT"], handover: ["ASTO", "MVTO", "ASKW", "ASKD"], claimPaid: ["CKIND", "CMODE", "CREF", "CNOTE"],
  addEvent: ["EVN", "EVD", "EVLOC", "EVCOST", "EVOWN"], sendDoc: ["DSEL", "DTPL", "DSIG"],
  loadSheet: ["AR", "ARWHO"],
  setSeat: ["PSEL"],
  saveEvent: ["EVD"], saveFollowup: ["FU"],
};
const json = (value: unknown) => JSON.stringify(value);
const clone = <T,>(value: T): T => structuredClone(value);
// Public queue identifiers must not contain the captured form text or personal values.
const saveKey = (value: string) => {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i++) hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(i))) * 0x100000001b3n);
  return "local-" + hash.toString(16);
};
const draft = (state: ConsoleState, action: Action) => action.type === "setMe"
  ? (state.ui.ME_DRAFT as Record<string, string> | undefined)?.[action.f]
  :
  ({ fields: Object.fromEntries((DRAFTS[action.type] || []).map(k => [k, state.ui[k]])),
    ...(["saveNext", "saveTouch", "addNote", "handover", "claimPaid"].includes(action.type) ? { drawer: state.DRW } : {}) });
function target(state: ConsoleState, action: Action) {
  const data = action as Action & { id?: string; k?: string; pk?: number; who?: string };
  const id = data.id;
  if (id && state.LEADS.some(l => l.id === id)) return {
    lead: state.LEADS.find(l => l.id === id), notes: state.NOTES[id], paper: state.PAPER[id],
    availability: Object.fromEntries([state.WHO, state.LEADS.find(l => l.id === id)?.own, state.LEADS.find(l => l.id === id)?.sec]
      .filter((k): k is string => !!k).map(k => [k, state.AVAIL[k]])),
    ownerCover: state.COVER[state.LEADS.find(l => l.id === id)?.own || ""],
    claim: state.CLAIM[id], pay: state.PAY[id], req: state.REQ[id], ext: state.EXT[id],
    calls: state.CALLS[id], sent: state.SENT[id], pack: state.PACK[id], acct: state.ACCT[id],
    docs: state.DOCS.filter(d => d.lead === id),
    investorCopy: state.INVESTORCOPY[id],
    ...(action.type === "copyInvestor" ? {financeSource:investorCopyReplayTarget(state,state.LEADS.find(l=>l.id === id)!)} : {}),
  };
  const personKey = action.type === "setMe" || action.type === "setMyStyle" ? state.WHO
    : action.type === "setSeat" ? String(data.who || state.ui.PSEL || "") : data.k;
  if (action.type === "setMe") return (state.PEOPLE[state.WHO] as unknown as Record<string, unknown>)[action.f];
  if (personKey && state.PEOPLE[personKey]) return { person: state.PEOPLE[personKey], caps: state.CAPS[personKey], avail: state.AVAIL[personKey] };
  if (["bump", "setNum", "setTarget", "setActual", "setPeriodDate", "setGrain", "addPeriod", "dropPeriod", "setBaseline"].includes(action.type)) return state.PLAN;
  if (action.type === "revokeTemp") return state.TEMP.find(g => g.id === id);
  if (action.type === "loadSheet") return { sheet: state.SHEET[action.ev], event: state.EVENTS.find(e => e.id === action.ev),
    roster: state.EVENTS.find(e => e.id === action.ev)?.staff.map(k => [k, state.PEOPLE[k]]) };
  return null;
}
function recipients(state: ConsoleState, action: Action) {
  const data = action as Action & { to?: string | null; m?: string | null; id?: string; who?: string };
  const keys: Array<string | null | undefined> = [data.to, data.m, data.who];
  if (action.type === "handover") keys.push(String(state.ui.ASTO || ""));
  if (action.type === "addLead") keys.push(String(state.ui.ADDOWN || ""), String(state.ui.ADDCP || ""));
  if (action.type === "loadSheet") keys.push(String(state.ui.ARWHO || ""));
  if (action.type === "decideMove" && data.id) keys.push(state.REQ[data.id]?.to);
  if (action.type === "grantTemp") keys.push((state.ui.TGT as { to?: string } | undefined)?.to);
  return Object.fromEntries(keys.filter((k): k is string => !!k).map(k => [k, state.PEOPLE[k]]));
}

/** Executes the real reducer once. Captured identity, target and draft are checked at replay. */
export function createConsoleWriter(options: SaveQueueOptions & {
  read: () => ConsoleState;
  write: (state: ConsoleState) => void;
  reduce: (state: ConsoleState, action: Action) => ConsoleState;
  leadWrites: ReadonlySet<string>;
}) {
  const scopes = new Map<string, { scope: string; order: number }>();
  let order = 0;
  let queue: SaveQueue;
  queue = createSaveQueue({ ...options, onChange: change => {
    if (change.kind === "completed" && change.entry) {
      const completed = scopes.get(change.entry.key);
      scopes.delete(change.entry.key);
      if (completed) for (const entry of change.entries) {
        const previous = scopes.get(entry.key);
        if (["pending", "failed"].includes(entry.status) && previous?.scope === completed.scope && previous.order < completed.order) {
          scopes.delete(entry.key);
          queue.discard(entry.key);
        }
      }
    }
    if (change.kind === "reset") {
      const live = new Set(change.entries.map(entry => entry.key));
      for (const key of scopes.keys()) if (!live.has(key)) scopes.delete(key);
    }
    options.onChange?.({ ...change, entries: queue.snapshot() });
  } });
  const apply = (action: Action): SaveResult | undefined => {
    const state = options.read();
    if (!BUSINESS_WRITES.has(action.type)) {
      const next = options.reduce(state, action);
      if (next !== state) options.write(next);
      if (next.WHO !== state.WHO || (["setPerson", "setRole"].includes(action.type) && next !== state)) queue.reset();
      return undefined;
    }
    const session = options.currentSession();
    if (!session) return undefined;
    const captured = clone(action), oldTarget = json({ record: target(state, captured), recipients: recipients(state, captured) }), oldDraft = json(draft(state, captured));
    const id = "id" in captured ? String(captured.id) : undefined;
    const key = saveKey(json([session.actor, session.session, captured, oldDraft, oldTarget]));
    if (captured.type === "copyInvestor") {
      const lead = state.LEADS.find(l=>l.id === captured.id);
      if (lead && investorCopyOf(state,lead)) return {accepted:false,key,status:"rejected"};
    }
    const fields = captured as Action & { k?: string; f?: string; pk?: number };
    if (!scopes.has(key)) scopes.set(key, { order: ++order,
      scope: json([session.actor, session.session, captured.type, id || fields.pk || fields.k || "", fields.f || (captured.type === "logTouch" ? fields.k : "")]),
    });
    const validate = () => {
      const current = options.read();
      return accountAllowed(current) && current.WHO === session.actor
        && (!options.leadWrites.has(captured.type) || canOperateLeads(current))
        /* flagDupe names a record the flagger cannot open, by definition (ir-merged.js:5608) */
        && (captured.type === "flagDupe" || !id || !state.LEADS.some(l => l.id === id) || openable(current).some(l => l.id === id))
        && json({ record: target(current, captured), recipients: recipients(current, captured) }) === oldTarget && json(draft(current, captured)) === oldDraft;
    };
    return queue.enqueue({ ...session, key, id, label: captured.type === "copyInvestor" ? "Investor copy (demo)" : "Local change", validate, execute: () => {
      const current = options.read();
      /* armFail(true) — 03-app.js:4613,4731,10641: the System test toolbar's one-shot switch. It
         fails exactly the next business write and clears itself, whether or not that write would
         otherwise have landed — same as the prototype's `commit()` throwing before its own body runs. */
      if (current.FAILNEXT && !PROTECTED_LOCAL_SAVE.has(captured.type)) {
        options.write({ ...current, FAILNEXT: false });
        throw new Error(WHYFAIL);
      }
      const next = options.reduce(current, captured);
      if (next === current) return false;
      options.write(next);
      return ["LEADS", "PEOPLE", "PLAN", "AVAIL", "CAPS", "TEMP", "LOG", "NOTES", "PAY", "PAPER", "DOCS", "SENT", "CLAIM", "REQ", "EXT", "CALLS", "PACK", "ACCT", "INV", "RECOV", "EVENTS", "SHEET", "NSEEN", "REFSEEN", "INTERACTIONS", "XFER", "INVESTORCOPY"]
        .some(k => json((next as unknown as Record<string, unknown>)[k]) !== json((current as unknown as Record<string, unknown>)[k]));
    } });
  };
  return { ...queue, apply };
}
