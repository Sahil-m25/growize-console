// Builds zoho/sandbox/manifest.json from the merged prototype's demo book (M19-S03-T01).
// Run: node zoho/sandbox/make-manifest.mjs   — regenerate whenever console/prototype/growize-console-merged.html changes.
// Identity (PAN, Aadhaar, bank) is deliberately NOT copied: those fields are hidden by field-level security (D13, D52).
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync(new URL("../../console/prototype/growize-console-merged.html", import.meta.url), "utf8");
const grab = (name) => {
  const at = html.indexOf(`\nconst ${name} = [`);
  const end = html.indexOf("\n];", at);
  if (at < 0 || end < 0) throw new Error(`array ${name} not found in the prototype`);
  return new Function(`return ${html.slice(at + 1 + `const ${name} = `.length, end + 2)}`)();
};

const [LEADS, FARMS, INV, TXN, DOCS, TKT] = ["LEADS", "FARMS", "INV", "TXN", "DOCS", "TKT"].map(grab);
const tag = (Seed_Key, r) => ({ Seed_Key, Test_Seed: true, ...r });
const split = (n) => { const p = n.split(" "); return { First_Name: p.slice(0, -1).join(" "), Last_Name: p.at(-1) }; };

const records = {
  Leads: LEADS.map((l) => tag(l.id, { ...split(l.n), Mobile: l.ph, Email: l.em, City: l.city, Lead_Source: l.src, Owner_Key: l.own, Rung: l.done, Units: l.units, Touches: l.touch, Ticked: l.at })),
  Contacts: INV.map((i) => tag(i.id, { ARL_ID: i.id, ...split(i.n), Mobile: i.ph, Email: i.em, Mailing_City: i.city, Residency: i.nri ? "NRI" : "Resident", Units: i.units, Owner_Key: i.ir, Since: i.since })),
  LLP_Creation_Module: FARMS.map((f) => tag(f.k, { Name: f.n, Block_Code: f.k, Acreage_Acres: f.acres, Total_Units: f.units, Units_Released: f.released, Soil_Type: f.soil, Crop_Stage: f.crop })),
  LLP_UnitAllocation_Module: INV.flatMap((i) => Object.entries(i.blocks || {}).map(([blk, n]) => tag(`${i.id}/${blk}`, { Customer_Key: i.id, LLP_Key: blk, Allocation_Status: i.st === "allocated" ? "Issued" : "Reserved", Issued_Units: i.st === "allocated" ? n : 0, Reserved_Units: i.st === "allocated" ? 0 : n }))),
  Receipts: TXN.map((t) => tag(t.id, { Contact_Key: t.inv, Kind: t.kind, Amount: t.amt, Mode: t.mode, Reference: t.utr, Received_On: t.on, Recorded_By: t.by, Reconciliation: t.rec })),
  Documents: DOCS.map((d) => tag(d.id, { Contact_Key: d.inv, Title: d.t, Class: d.cls, State: d.state, Sent_On: d.sent, Signed_On: d.on, Signature: d.sig })),
  Cases: TKT.map((k) => tag(k.id, { Contact_Key: k.inv, Subject: k.t, Category: k.cat, Priority: k.pri, Status: k.state, Created_Time: k.opened, Owner_Key: k.own })),
};

// Dates in the prototype are "DD Mon[ HH:MM]" against a demo clock of 2 Sep 2026; reset shifts them to the run day.
const manifest = { demoDay: "2026-09-02", tagField: "Test_Seed", records };
writeFileSync(new URL("./manifest.json", import.meta.url), JSON.stringify(manifest, null, 1) + "\n");
console.log(Object.entries(records).map(([m, r]) => `${m}: ${r.length}`).join("\n"));
