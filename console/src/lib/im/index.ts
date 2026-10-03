/* ── @/lib/im — the Investors side's business core (phase 1) ───────────────────────────────
   A pure port of the prototype's IMX module, sections 1–8 (imx.js lines 1–1366) plus the reads
   sections 9–15 compute. No React, no DOM, no wall clock. Page code uses these names:

   STATE        ImState = {data: ImData, ui: ImUi} · ImAction · ImCtx (what selectors read)
                initialImUi() · emptyImData(nowIso) · seedApp(data) · imAlign(data, people)
   WRITES       imReducer(s, WHO, action) — actions named after the prototype mutators:
                reveal hideAll revCancel logField saveDetails setMark recordPay confirmClaim
                rejectClaim matchReceipt sendDocNow verifyDoc blockDoc passKyc failKyc releaseBlock
                holdBlock handToFinance moveTicket newTicket publish assignKam logContact setSeat
                lapseHold · go setSec openDrawer closeDrawer setPerson setSel setDraft setFilter ·
                confirmYes noteClose. A refusal lands in ui.NOTE {kind:"refuse"}; a question in
                ui.NOTE {kind:"ask"} with the write parked in ui.PENDING until confirmYes.
   CONSOLE API  imHas(data,k) imReach(s,k) imCount(s,v,k) imTitle(data,k) imReadOnly(s,k)
                imHot(v) imInvestors(data) imLastLog(data)   (IMX.has/reach/count/title/readOnly/hot/…)
   SELECTORS    (s, WHO, …) — who role may teamOf isAM isSys notFin isSuper KAMS has
                readBook myBook I cOf cOf_all lastC dueOn overdue quiet bookOf mayCare mayDetails
                kamGone poolBook tierOf cadence cared needsKam held allocated reserved released
                freeUnits blockUse txOf gotBy dueBy banked docOf ansOf nState nOpen inFor claimsOpen
                tkOf ticketBook tkOpen fieldOf logFor roundOf roundsFor finQueue careQueue mineQueue
                appOf appMark markAge markLocked markLeft mayTkt watchedTkt finSeats needsFin maySeat
                navFor pageReadable count secOf holdDays readOnlySeat drawerReadable shown
                maskPan maskAcct safeNote auditText withholdKnown activityActors activityBase
                activityRows · page reads: kamLoad outstandingReserved forfeitExposure publishCount
                invExceptions invRows TXNF tktFilters farmShelf ageing stuckDocs sysChecks journey
   RULES        mayReveal piiView recordPayGate oversellGate setMarkGate matchGate holdExpired lapseGate oversold
                blockOver holdBlockGate sendDocGate allotGate logContactGate (Gate = {ok}|{ok:false,msg})
   DATES/MONEY  when gap aged ago stamp day6 plusDays mid nowDay nowFull fmtDay fmtStamp inr money
   CONSTANTS    TEAM ROLE CAN PRIMARY DAY MON UNIT FORFEIT PROGRAMME_UNITS SECRETS REVWHY
                TIERS MOODS CHANS TPL SIGS ROUNDS FSTATE DETF KINDS GLYPH APPLOCK CMODE CREF NAV HOT
                BLANK_DRAFTS PMODES TKCATS TKPRI UPCATS UPTO
   ────────────────────────────────────────────────────────────────────────────────────────── */
import { HOT } from "./constants";
import { count, has, navFor, readOnlySeat, role } from "./selectors";
import type { ImCtx, ImData, ImLogEntry, ImView } from "./types";

export * from "./types";
export * from "./constants";
export * from "./dates";
export * from "./selectors";
export * from "./rules";
export * from "./money";
export * from "./paper2";   /* uploads, Zoho Sign status, record emails, the IR wall (M12-S02/S05/S09, M09-S08) */
export * from "./search";   /* investor search (M09-S07) */
export { imReducer, initialImUi, emptyImData, seedApp, imAlign } from "./reducer";

/** IMX.has — k signs in here and may open the Investors pages */
export const imHas = (data: ImData, k: string): boolean => has(data, k);
/** IMX.reach — the Investors pages k's seat reaches, in rail order */
export const imReach = (s: ImCtx, k: string): ImView[] => (has(s.data, k) ? navFor(s, k).map(n => n.k) : []);
/** IMX.count — the badge on page v for person k */
export const imCount = (s: ImCtx, v: string, k: string): number => (has(s.data, k) ? count(s, k, v) : 0);
/** IMX.title — k's seat title, or "" */
export const imTitle = (data: ImData, k: string): string => (has(data, k) ? role({ data }, k).t : "");
/** IMX.readOnly — k's seat holds no write beyond reading and revealing */
export const imReadOnly = (s: ImCtx, k: string): boolean => has(s.data, k) && readOnlySeat(s, k);
/** IMX.hot — a badge on this page is a call to act */
export const imHot = (v: string): boolean => (HOT as string[]).includes(v);
/** IMX.investors — the join key to the lead side */
export const imInvestors = (data: ImData): { id: string; n: string; lead: string | null }[] =>
  data.INV.map(x => ({ id: x.id, n: x.n, lead: x.lead || null }));
/** IMX.lastLog */
export const imLastLog = (data: ImData): Pick<ImLogEntry, "who" | "what"> | null =>
  data.LOG[0] ? { who: data.LOG[0].who, what: data.LOG[0].what } : null;
