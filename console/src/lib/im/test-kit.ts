/* Test scaffolding only: a tiny invented book (not the demo set) the rule tests run against.
   Clock: 2 Sep 2026 at 14:20, so stamps read "02 Sep 14:20" and day math uses 2 Sep's midnight. */
import { UNIT } from "./constants";
import { emptyImData, initialImUi, seedApp } from "./reducer";
import type { ImAction, ImData, ImInvestor, ImState } from "./types";
import { imReducer } from "./reducer";

export const NOW = "2026-09-02T14:20";

const inv = (o: Partial<ImInvestor> & { id: string }): ImInvestor => ({
  n: "Investor " + o.id, ph: "+91 90000 00000", em: o.id + "@example.test", city: "Testpur", addr: "1 Test Road",
  nri: false, pan: "ABCDE1234F", aadh: "1111", aref: "UIDAI-0000-111111", kyc: "passed", kycOn: "01 Aug",
  bank: { acct: "123456789012", ifsc: "TEST0000001", name: "INVESTOR", drop: "matched" },
  units: 1, blocks: { X: 1 }, st: "allocated", ir: "irv", src: "Events", since: "01 Aug", nominee: "—",
  ...o,
});
const signed = (id: string, inv: string, t: string) => ({
  id, inv, t, cls: "Commercial", state: "signed" as const, sent: "01 Aug 09:00", by: "ops1",
  sig: "Aadhaar OTP", ref: "EMU-" + id, on: "01 Aug 10:00",
});

export function kitData(): ImData {
  const d = emptyImData(NOW);
  d.P = {
    fin: { n: "Fin Head", i: "FH", r: "head", c: 1, em: "fin@example.test" },
    ops1: { n: "Ops One", i: "O1", r: "ops", c: 2, em: "ops1@example.test" },
    ops2: { n: "Ops Two", i: "O2", r: "ops", c: 3, em: "ops2@example.test" },
    comp: { n: "Comp Kyc", i: "CK", r: "comp", c: 4, em: "comp@example.test" },
    aud: { n: "Aud Itor", i: "AI", r: "audit", c: 5, em: "aud@example.test" },
    aml: { n: "Am Lead", i: "AL", r: "amlead", c: 6, em: "aml@example.test" },
    kam1: { n: "Kam One", i: "K1", r: "kam", c: 7, em: "kam1@example.test" },
    kam2: { n: "Kam Two", i: "K2", r: "kam", c: 8, em: "kam2@example.test" },
    su: { n: "Super User", i: "SU", r: "di", c: 1, em: "su@example.test" },
    adm: { n: "Ad Min", i: "AD", r: "admin", c: 2, em: "adm@example.test" },
  };
  d.SIGNINS = ["fin", "ops1", "ops2", "comp", "aud", "aml", "kam1", "kam2", "su", "adm"];
  d.IRN = { irv: { n: "Ir Person", i: "IP", x: true } };
  d.FARMS = [
    { k: "X", n: "Block X", acres: 1, units: 10, released: 10, soil: "Loam", crop: "Year 2 — growth", by: "fin", at: "01 Aug 09:00" },
    { k: "Y", n: "Block Y", acres: 1, units: 5, released: 0, soil: "Loam", crop: "Survey pending", by: null, at: null },
  ];
  d.INV = [
    /* allotted, Tier A, KAM named and introduced, paid in full on 01 Aug */
    inv({ id: "A1", units: 4, blocks: { X: 4 }, kam: "kam1", kamOn: "01 Aug", intro: "01 Aug 11:00" }),
    /* allotted, Tier B, no manager */
    inv({ id: "B1", units: 2, blocks: { X: 2 }, kam: null }),
    /* reserved on a 10% advance, hold ends in 3 days */
    inv({ id: "R1", st: "reserved", hold: "05 Sep", blocks: { X: 1 }, units: 1 }),
    /* reserved, the hold ran out 3 days ago */
    inv({ id: "R2", st: "reserved", hold: "30 Aug", blocks: { X: 2 }, units: 2 }),
    /* NRI, nothing paid, supplementary not signed, FEMA outstanding */
    inv({ id: "N1", st: "reserved", nri: true, aadh: null, aref: null, kyc: "pending", kycOn: null, fema: "outstanding", units: 1, blocks: { X: 1 } }),
  ];
  d.TXN = [
    { id: "T-0001", inv: "A1", kind: "full", amt: 4 * UNIT, mode: "RTGS", utr: "HDFC0000001", on: "01 Aug 10:00", by: "fin", rec: "matched" },
    { id: "T-0002", inv: "B1", kind: "full", amt: 2 * UNIT, mode: "RTGS", utr: "HDFC0000002", on: "29 Aug 10:00", by: "fin", rec: "matched" },
    { id: "T-0003", inv: "R1", kind: "advance", amt: 250000, mode: "NEFT", utr: "HDFC0000003", on: "06 Aug 10:00", by: "ops1", rec: "matched" },
    { id: "T-0004", inv: "R2", kind: "advance", amt: 500000, mode: "NEFT", utr: "HDFC0000004", on: "31 Jul 10:00", by: "ops1", rec: "matched" },
  ];
  d.TSEQ = 4;
  d.DOCS = ["A1", "B1", "R1", "R2"].flatMap((i, n) => [
    { ...signed("D-" + (2 * n + 1), i, "Non-disclosure agreement"), cls: "Confidentiality" },
    signed("D-" + (2 * n + 2), i, "Supplementary agreement"),
  ]);
  d.DSEQ = 8;
  d.CONTACT = [{ inv: "A1", at: "20 Aug 10:00", by: "kam1", ch: "call", mood: "good", note: "Fine." }];
  d.INBOX = [
    { id: "N-1", inv: "R1", kind: "claim", at: "01 Sep 10:00", ir: "irv", state: "open",
      t: "The investor says he has paid", d: "In full, RTGS HDFC2709999." },
  ];
  d.TKT = [
    { id: "TK-0001", inv: "A1", t: "Change the bank account", cat: "Bank", opened: "01 Sep 10:00", by: "investor",
      own: "kam1", pri: "high", state: "open", d: "", sla: "2 working days" },
  ];
  d.KSEQ = 1;
  return seedApp(d);
}
export const kit = (): ImState => ({ data: kitData(), ui: initialImUi() });
/** run several actions as one person */
export const act = (s: ImState, WHO: string, ...as: ImAction[]): ImState => as.reduce((x, a) => imReducer(x, WHO, a), s);
export const invOf = (s: ImState, id: string): ImInvestor => s.data.INV.find(x => x.id === id)!;
