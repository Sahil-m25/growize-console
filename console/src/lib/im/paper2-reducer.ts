/* ── im/paper2-reducer.ts — the writes for uploads, reminders and recalls (M12-S02, M12-S05) ──
   Called from imReducer's run() with the already-cloned state and run()'s own helpers, so a refusal
   is the same in-page NOTE, a question the same NOTE {kind:"ask"} replayed by confirmYes, and the
   log line the same scrubbed entry. Phase 1: nothing is sent to Zoho; the book records what the
   list shows (a file's name, size and slot — never the file).
   ────────────────────────────────────────────────────────────────────────────────────────── */
import { I, who } from "./selectors";
import { fileSize, recallGate, remindGate, slotOf, slotTaken, uploadGate, uploadWhere } from "./paper2";
import type { ImKind, ImState, Paper2Action } from "./types";

export const PAPER2 = ["uploadDoc", "remindSign", "recallSign"] as const;
export const isPaper2 = (a: { type: string }): a is Paper2Action => (PAPER2 as readonly string[]).includes(a.type);

export type RunKit = {
  T: () => string;
  log: (what: string, inv: string | null, note: string, kind: ImKind) => void;
  alert: (msg: string) => void;
  confirm: (msg: string) => boolean;
};

export function paper2Run(W: ImState, WHO: string, a: Paper2Action, k: RunKit): ImState {
  const d = W.data;
  const refuse = (g: { ok: boolean; msg?: string | null }) => { if (!g.ok && g.msg) k.alert(g.msg); return !g.ok; };
  switch (a.type) {
    case "uploadDoc": {
      const t = { Scope: a.Scope, Doc_Type: a.Doc_Type, Investor: a.Scope === "Project" ? null : a.Investor,
        LLP: a.Scope === "Personal" ? null : a.LLP };
      if (refuse(uploadGate(W, WHO, { ...t, File_Name: a.File_Name, File_Size: a.File_Size, File_Type: a.File_Type }))) break;
      const list = d.UPLOADS || (d.UPLOADS = []);
      /* the second half of a double press: the same file to the same place attaches nothing */
      if (list.some(u => u.key === a.key)) break;
      const was = slotTaken(W, t);
      if (was && !k.confirm(a.Doc_Type + " already holds " + was.File_Name + ", uploaded by " + who(W, was.by).n
        + " on " + was.at + ".\n\nA typed slot holds one file. Replace it with " + a.File_Name + "?")) break;
      if (was) list.splice(list.indexOf(was), 1);
      const n = list.reduce((m, u) => Math.max(m, +u.id.replace(/\D/g, "") || 0), 0) + 1;
      list.unshift({ id: "UP-" + String(n).padStart(3, "0"), ...t, File_Name: a.File_Name, File_Size: a.File_Size,
        File_Type: a.File_Type, by: WHO, at: k.T(), key: a.key });
      k.log(was ? "Replaced an uploaded document" : "Uploaded a document", t.Investor,
        a.Doc_Type + " · " + a.File_Name + " · " + fileSize(a.File_Size) + " · " + uploadWhere(W, t)
        + (slotOf(a.Scope, a.Doc_Type)?.field ? "" : " · attachment"), "doc");
      break;
    }
    case "remindSign": {
      if (refuse(remindGate(W, WHO, a.did))) break;
      const dc = d.DOCS.find(x => x.id === a.did)!;
      const SIGN = d.SIGN || (d.SIGN = {});
      const r = SIGN[dc.id] || (SIGN[dc.id] = { Sign_Request_Id: "", st: "sent" });
      (r.reminded || (r.reminded = [])).unshift({ at: k.T(), by: WHO });
      k.log("Sent a signature reminder", dc.inv, dc.t + " · " + (dc.sig || ""), "doc");
      break;
    }
    case "recallSign": {
      if (refuse(recallGate(W, WHO, a.did, a.why))) break;
      const dc = d.DOCS.find(x => x.id === a.did)!;
      if (!I(W, WHO, dc.inv)) break;
      const why = a.why.trim();
      const SIGN = d.SIGN || (d.SIGN = {});
      const r = SIGN[dc.id] || (SIGN[dc.id] = { Sign_Request_Id: "", st: "sent" });
      r.st = "recalled"; r.why = why; r.recalled = { at: k.T(), by: WHO };
      /* a recalled request is dead: the round reads blocked until a fresh one is sent */
      dc.state = "blocked"; dc.why = "Recalled — " + why; dc.on = k.T(); dc.vby = WHO;
      d.OUTBOX.unshift({ at: k.T(), inv: dc.inv, t: dc.t + " — recalled, a fresh copy will follow", by: WHO });
      k.log("Recalled a signature request", dc.inv, dc.t + " · " + why, "doc");
      break;
    }
  }
  return W;
}
