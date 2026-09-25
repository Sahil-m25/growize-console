/**
 * THE DEMO BOOK, MADE CONSISTENT WITH THE ROUNDS RATHER THAN TYPED A SECOND TIME.
 * Ports `ref/03-app.js` lines 2002-2056 — the `seedPaper()` IIFE.
 *
 * The prototype does not hand-write the paper state onto each lead. It derives it, because the
 * ladder already says what must be true: anything qualified has its NDA behind it, since the NDA
 * gates the material and the material is already ticked on those records; anything reserved has its
 * supplementary signed, since money cannot be recorded before that. Every stamp comes off the
 * lead's own `at[]` ladder, so nothing here invents a date, and the two reserved leads already hold
 * the account their advance opened.
 *
 * Deriving it is not a shortcut — it is the point. A fixture that typed the paper separately could
 * disagree with the rung, and a demo whose paper and ladder disagree teaches the wrong model of the
 * system to the person being shown it.
 *
 * This module is a pure factory: it reads the fixture constants and returns fresh objects. It
 * mutates nothing at import time (the prototype's IIFE mutated three module globals and one array
 * of documents), so the store seeds itself from `seedBook()` and every call is independent.
 */

import { ST } from "./ladder";
import { LEADS } from "./leads";
import { DOCS } from "./documents";
import { ACCT, ARLSEQ, CLAIM, PAY, XFER } from "./payments";
import type {
  Account,
  DocRec,
  LeadId,
  PaperRound,
  PaperRow,
  PersonKey,
  Stamp,
  XferRow,
} from "./types";

/** Finance is a name on every receipt and every signature, and never a login. See `people.ts`. */
const FIN: PersonKey = "harsha";

export interface SeededBook {
  PAPER: Record<LeadId, PaperRow>;
  ACCT: Record<LeadId, Account>;
  XFER: XferRow[];
  DOCS: DocRec[];
  ARLSEQ: number;
}

/**
 * Build the paper, accounts, transfers and document references the fixture implies.
 *
 * The prototype's `TOUCHSEED` counter is local to one pass here rather than a module global, so
 * calling this twice gives the same book both times — the prototype's version did not, which is
 * only invisible because it ran exactly once.
 */
export function seedBook(): SeededBook {
  const PAPER: Record<LeadId, PaperRow> = {};
  let touchSeed = 0;

  for (const l of LEADS) {
    const A = l.at ?? [];
    const own: PersonKey = l.own ?? "kavya";
    const P: PaperRow = {};
    /* every stamp comes off the lead's own ladder — nothing here invents a date */
    const at = (i: number): Stamp => A[i] ?? A[A.length - 1] ?? A[0] ?? "";

    if (l.done >= ST.QUALIFIED) {
      P.nda = {
        sent: { by: FIN, at: at(1), via: "Zoho Sign" },
        told: { by: own, at: at(1), ch: "email" },
        chase: [],
        said: { by: own, at: at(2) },
        ok: { by: FIN, at: at(2) },
      };
    } else if (l.done === ST.TOUCH) {
      /* the three hands of the relay, one each, so nobody has to imagine what the others look
         like: not sent yet (Finance's move), sent and being chased (the IR's), and claimed as
         signed and waiting to be verified (Finance's again) */
      const turn = touchSeed++ % 3;
      if (turn === 1) {
        P.nda = {
          sent: { by: FIN, at: at(1), via: "Zoho Sign" },
          told: { by: own, at: at(1), ch: "msg" },
          chase: [{ by: own, at: at(1), ch: "email", phase: "sign" }],
        };
      } else if (turn === 2) {
        P.nda = {
          sent: { by: FIN, at: at(1), via: "Zoho Sign" },
          told: { by: own, at: at(1), ch: "email" },
          chase: [
            { by: own, at: at(1), ch: "call", phase: "sign" },
            { by: own, at: at(1), ch: "msg", phase: "sign" },
          ],
          said: { by: own, at: at(1) },
        };
      }
    }

    /* a claim of payment cannot exist before the agreement it pays against, so the one seeded
       claim carries a finished round behind it */
    if (l.done >= ST.RESERVED || CLAIM[l.id]) {
      P.supp = {
        draft: { by: own, at: at(4), link: "Zoho Writer · SUPP-" + l.id + "-v1", v: 2 },
        agreed: { by: own, at: at(4), link: "Zoho WorkDrive · SUPP-" + l.id + "-final" },
        sent: { by: FIN, at: at(5), via: "Zoho Sign" },
        told: { by: own, at: at(5), ch: "call" },
        chase: [{ by: own, at: at(5), ch: "msg", phase: "sign" }],
        said: { by: own, at: at(5) },
        ok: { by: FIN, at: at(5) },
      } satisfies PaperRound;
    } else if (l.done === ST.CONVERTED) {
      P.supp = {
        draft: { by: own, at: at(4), link: "Zoho Writer · SUPP-" + l.id + "-v2", v: 2 },
        chase: [
          { by: own, at: at(4), ch: "email", phase: "draft" },
          { by: own, at: at(4), ch: "call", phase: "draft" },
        ],
      };
    }

    if (Object.keys(P).length) PAPER[l.id] = P;
  }

  /* Every confirmed receipt has its account and its welcome, because on this model it cannot not
     have them — they are the same event. The stamp is the receipt's own, not a later one. */
  const acct: Record<LeadId, Account> = { ...ACCT };
  const xfer: XferRow[] = XFER.map((x) => ({ ...x }));
  const docs: DocRec[] = DOCS.map((d) => ({ ...d }));
  let seq = ARLSEQ;

  for (const l of LEADS.filter((x) => PAY[x.id])) {
    const A = l.at ?? [];
    const at: Stamp = A[5] ?? A[A.length - 1] ?? "";
    acct[l.id] = {
      code: "ARL-INV-" + String(++seq).padStart(4, "0"),
      at,
      state: "open",
      invite: { at, ch: "email", auto: true },
    };
    for (const d of docs) if (d.lead === l.id) d.ref = d.ref || acct[l.id]!.code;
    if (!xfer.some((x) => x.lead === l.id)) {
      const pay = PAY[l.id];
      xfer.push({
        lead: l.id,
        state: "done",
        auto: true,
        on: at,
        asked: at,
        code: acct[l.id]!.code,
        units: l.units,
        got: pay?.got,
        mode: pay?.mode,
        utr: pay?.utr,
      });
    }
  }

  return { PAPER, ACCT: acct, XFER: xfer, DOCS: docs, ARLSEQ: seq };
}
