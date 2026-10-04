// Builds zoho/sandbox/manifest.json from the merged prototype's demo book (M19-S03-T01).
// Run: node zoho/sandbox/make-manifest.mjs   — regenerate whenever console/prototype/growize-console-merged.html changes.
// Identity (PAN, Aadhaar, bank, UTR) is deliberately NOT copied (D13, D52); a synthetic UTR stands in.
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

// Field names are the sandbox's real api names (sandbox-schema-2026-10-05.json). Two reference keys are resolved by reset.mjs:
//   $persona: { <user field>: <persona> }   → a sandbox user id (ir_a, ir_b, kam, finance_ops, compliance, admin)
//   $refs:    { <lookup field>: [Module, Seed_Key] } → { id } of the already-upserted parent
// Prototype people → persona. The prototype has four IRs, the sandbox two IR logins: kavya+nikhil → IR A, rohit+ananya → IR B.
// Unassigned leads (no owner) stay with admin, the pool.
const PERSONA = { kavya: "ir_a", nikhil: "ir_a", rohit: "ir_b", ananya: "ir_b", imran: "kam", neha: "kam", fahad: "compliance", meena: "finance_ops", harsha: "finance_ops" };
const who = (k) => (k ? PERSONA[k] ?? (() => { throw new Error(`no persona for ${k}`); })() : "admin");
// Leads.Ticked[i] is the stamp of ladder rung i+1; rung 1 (captured) has no field of its own (Created_Time is system).
const STAGE_AT = [null, "First_Touch_At", "Qualified_At", "Engaged_At", "Said_Yes_At", "Reserved_At", "Fully_Paid_At", "Allocated_At", "Onboarded_At"];
// Touch channel labels: UNVERIFIED against the Touches.Channel picklist; the seed plan's picklist check reports any miss.
const CHANNEL = { msg: "WhatsApp", email: "Email", call: "Call" };
// Cases picklists: Zoho defaults, UNVERIFIED against the sandbox; picklist check reports any miss.
const PRIORITY = { high: "High", normal: "Medium" }, STATUS = { open: "New", waiting: "On Hold", closed: "Closed" };

const stage = (l) => Object.fromEntries(l.at_.map((s, i) => [STAGE_AT[i], s]).filter(([k]) => k));
const firstAlloc = (invId) => { const i = INV.find((x) => x.id === invId); return `${invId}/${Object.keys(i.blocks)[0]}`; };

const records = {
  LLP_Creation_Module: FARMS.map((f) => tag(f.k, { Name: f.n, Block_Code: f.k, Acreage_Acres: f.acres, Total_Units: f.units, Units_Released: f.released, Soil_Type: f.soil, Crop_Stage: f.crop, $persona: { Owner: "admin" } })),
  Leads: LEADS.map((l) => tag(l.id, { ...split(l.n), Company: "Seed", Mobile: l.ph, Email: l.em, City: l.city, Lead_Source: l.src, Units_Interested: l.units, ...stage({ at_: l.at }), $persona: { Owner: who(l.own) } })),
  Contacts: INV.map((i) => tag(i.id, { ARL_ID: i.id, ...split(i.n), Mobile: i.ph, Email: i.em, Mailing_City: i.city, Residency: i.nri ? "NRI" : "Resident", Said_Yes_At: `${i.since} 12:00`, ...(i.kam ? { KAM_Since: i.kamOn, KAM_Intro_At: i.intro } : {}), $persona: { Owner: who(i.ir), Originating_IR: who(i.ir), ...(i.kam ? { KAM: who(i.kam) } : {}) } })),
  Touches: LEADS.flatMap((l) => Object.entries(l.touch).flatMap(([ch, stamps]) => stamps.map((at, n) => tag(`${l.id}/${ch}/${n}`, { Name: `${l.id} ${ch} ${n + 1}`, Channel: CHANNEL[ch], Occurred_At: at, Is_Reply: false, $persona: { Owner: who(l.own) }, $refs: { Lead: ["Leads", l.id] } })))),
  LLP_UnitAllocation_Module: INV.flatMap((i) => Object.entries(i.blocks || {}).map(([blk, n]) => tag(`${i.id}/${blk}`, { Name: `${i.n} / ${blk}`, Allocation_Status: i.st === "allocated" ? "Issued" : "Reserved", Issued_Units: i.st === "allocated" ? n : 0, Reserved_Units: i.st === "allocated" ? 0 : n, $persona: { Owner: who(i.ir) }, $refs: { Customer: ["Contacts", i.id], LLP: ["LLP_Creation_Module", blk] } }))),
  // UTR is an identity-class value: replaced by a synthetic one. Recorded_By has no field (Receipts.Owner carries the recorder's persona).
  Receipts: TXN.map((t) => tag(t.id, { Name: t.id, Kind: t.kind, Amount: t.amt, Mode: t.mode, UTR: `SEED-${t.id}`, Received_On: t.on, Match_State: t.rec, $persona: { Owner: who(t.by) }, $refs: { Allotment: ["LLP_UnitAllocation_Module", firstAlloc(t.inv)] } })),
  Cases: TKT.map((k) => tag(k.id, { Subject: k.t, Ticket_Category: k.cat, Priority: PRIORITY[k.pri] ?? k.pri, Status: STATUS[k.state] ?? k.state, $persona: { Owner: who(k.own) }, $refs: { Related_To: ["Contacts", k.inv] } })),
};

// No Documents module in the sandbox (only the document-slot fields on Contacts/Allocations): kept here, not seeded.
const deferred = { Documents: { reason: "no Documents module in the sandbox", records: DOCS.map((d) => tag(d.id, { Contact_Key: d.inv, Title: d.t, Class: d.cls, State: d.state, Sent_On: d.sent, Signed_On: d.on, Signature: d.sig })) } };

// Dates in the prototype are "DD Mon[ HH:MM]" against a demo clock of 2 Sep 2026; reset shifts them to the run day.
const manifest = { demoDay: "2026-09-02", tagField: "Test_Seed", records, deferred };
writeFileSync(new URL("./manifest.json", import.meta.url), JSON.stringify(manifest, null, 1) + "\n");
console.log(Object.entries(records).map(([m, r]) => `${m}: ${r.length}`).join("\n"));
