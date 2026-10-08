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
/* D134: every seeded farm and allotment carries a price (Rs 25 lakh a unit: the seed's receipts are whole multiples of it),
   farms a status the shelf and Add investor read, and a Reserved allotment its 30-day hold from the first advance. */
const UNIT_PRICE = 2500000;
const LLP_STATUS = { A: "Open for Issuance", B: "Open for Reservation" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const holdUntil = (invId) => {
  const t = TXN.find((x) => x.inv === invId && /advance/i.test(x.kind));
  const m = t && /^(\d{2}) (\w{3})/.exec(t.on);
  if (!m) return null;
  const d = new Date(Date.UTC(2026, MON.indexOf(m[2]), +m[1] + 30));
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MON[d.getUTCMonth()]}`;
};

/* Every investor came from a lead (lead and investor are one person in one Zoho org), so every Contact gets an Origin_Lead.
   A lead of the same First_Name+Last_Name is reused; an investor without one gets a new seeded lead, LX-<ARL id>, that carries
   the same stage stamps up to Said_Yes_At. Leads are listed before Contacts, so the $refs resolve. */
const fullKey = (n) => { const s = split(n); return `${s.First_Name}|${s.Last_Name}`; };
const leadByName = new Map(LEADS.map((l) => [fullKey(l.n), l.id]));
const originLead = (i) => leadByName.get(fullKey(i.n)) ?? `LX-${i.id}`;
// "DD Mon HH:MM" for `days` before a "DD Mon" date.
const daysBefore = (dm, days, hm) => {
  const m = /^(\d{2}) (\w{3})/.exec(dm);
  const d = new Date(Date.UTC(2026, MON.indexOf(m[2]), +m[1] - days));
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MON[d.getUTCMonth()]} ${hm}`;
};
const NEW_LEADS = INV.filter((i) => !leadByName.has(fullKey(i.n))).map((i) => tag(originLead(i), {
  ...split(i.n), Company: "Seed", Mobile: i.ph, Email: i.em, City: i.city, Lead_Source: "Founder network",
  First_Touch_At: daysBefore(i.since, 6, "10:00"), Qualified_At: daysBefore(i.since, 4, "11:00"), Engaged_At: daysBefore(i.since, 2, "15:00"),
  Said_Yes_At: `${i.since} 12:00`, $persona: { Owner: who(i.ir) },
}));

const records = {
  LLP_Creation_Module: FARMS.map((f) => tag(f.k, { Name: f.n, Block_Code: f.k, Acreage_Acres: f.acres, Total_Units: f.units, Units_Released: f.released, Soil_Type: f.soil, Crop_Stage: f.crop, Pet_Unit_Price: UNIT_PRICE, LLP_Status: LLP_STATUS[f.k] ?? "Darft", $persona: { Owner: "admin" } })),
  Leads: [...LEADS.map((l) => tag(l.id, { ...split(l.n), Company: "Seed", Mobile: l.ph, Email: l.em, City: l.city, Lead_Source: l.src, Units_Interested: l.units, ...stage({ at_: l.at }), $persona: { Owner: who(l.own) } })), ...NEW_LEADS],
  Contacts: INV.map((i) => tag(i.id, { ARL_ID: i.id, ...split(i.n), Mobile: i.ph, Email: i.em, Mailing_City: i.city, Residency: i.nri ? "NRI" : "Resident", Said_Yes_At: `${i.since} 12:00`, ...(i.kam ? { KAM_Since: i.kamOn, KAM_Intro_At: i.intro } : {}), $persona: { Owner: who(i.ir), Originating_IR: who(i.ir), ...(i.kam ? { KAM: who(i.kam) } : {}) }, $refs: { Origin_Lead: ["Leads", originLead(i)] } })),
  Touches: LEADS.flatMap((l) => Object.entries(l.touch).flatMap(([ch, stamps]) => stamps.map((at, n) => tag(`${l.id}/${ch}/${n}`, { Name: `${l.id} ${ch} ${n + 1}`, Channel: CHANNEL[ch], Occurred_At: at, Is_Reply: false, $persona: { Owner: who(l.own) }, $refs: { Lead: ["Leads", l.id] } })))),
  LLP_UnitAllocation_Module: INV.flatMap((i) => Object.entries(i.blocks || {}).map(([blk, n]) => tag(`${i.id}/${blk}`, { Name: `${i.n} / ${blk}`, Allocation_Status: i.st === "allocated" ? "Issued" : "Reserved", Issued_Units: i.st === "allocated" ? n : 0, Reserved_Units: i.st === "allocated" ? 0 : n, Unit_Price: UNIT_PRICE, ...(i.st === "allocated" ? {} : { Hold_Until: holdUntil(i.id) }), $persona: { Owner: who(i.ir) }, $refs: { Customer: ["Contacts", i.id], LLP: ["LLP_Creation_Module", blk] } }))),
  // UTR is an identity-class value: replaced by a synthetic one. Recorded_By has no field (Receipts.Owner carries the recorder's persona).
  Receipts: TXN.map((t) => tag(t.id, { Name: t.id, Kind: t.kind, Amount: t.amt, Mode: t.mode, UTR: `SEED-${t.id}`, Received_On: t.on, Match_State: t.rec, $persona: { Owner: who(t.by) }, $refs: { Allotment: ["LLP_UnitAllocation_Module", firstAlloc(t.inv)] } })),
  Cases: TKT.map((k) => tag(k.id, { Subject: k.t, Ticket_Category: k.cat, Priority: PRIORITY[k.pri] ?? k.pri, Status: STATUS[k.state] ?? k.state, $persona: { Owner: who(k.own) }, $refs: { Related_To: ["Contacts", k.inv] } })),
};

// No Documents module in the sandbox (only the document-slot fields on Contacts/Allocations): kept here, not seeded.
const deferred = { Documents: { reason: "no Documents module in the sandbox", records: DOCS.map((d) => tag(d.id, { Contact_Key: d.inv, Title: d.t, Class: d.cls, State: d.state, Sent_On: d.sent, Signed_On: d.on, Signature: d.sig })) } };

// MAIL SINK (D131): the prototype's demo book carries real-looking addresses/mobiles. The sandbox must never be able to mail or SMS a real person,
// so every email-type field, and any address inside free text, becomes a plus-address of ONE test inbox, unique per record.
// Phones become an obviously fake reserved range. Deterministic: same prototype -> same manifest.
const SINK_DOMAIN = "agresearchlabs.com";
const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const slug = (k) => String(k).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const sinkFor = (seedKey) => `tech+gzseed-${slug(seedKey)}`.slice(0, 100 - SINK_DOMAIN.length - 1) + `@${SINK_DOMAIN}`;
let phoneN = 0;
const fakePhone = () => `+91 90000 0${String(phoneN++).padStart(4, "0")}`;
const sanitize = (rec) => {
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    if (typeof v !== "string") return v;
    if (/(^|_)(mobile|phone)$/i.test(key ?? "") && v.trim()) return fakePhone();
    if (/email/i.test(key ?? "") && v.trim()) return sinkFor(rec.Seed_Key);
    return v.replace(EMAIL_RE, () => sinkFor(rec.Seed_Key));
  };
  return walk(rec, null);
};
for (const m of Object.keys(records)) records[m] = records[m].map(sanitize);
for (const d of Object.values(deferred)) d.records = d.records.map(sanitize);

// Dates in the prototype are "DD Mon[ HH:MM]" against a demo clock of 2 Sep 2026; reset shifts them to the run day.
const manifest = { demoDay: "2026-09-02", tagField: "Test_Seed", records, deferred };
writeFileSync(new URL("./manifest.json", import.meta.url), JSON.stringify(manifest, null, 1) + "\n");
console.log(Object.entries(records).map(([m, r]) => `${m}: ${r.length}`).join("\n"));
