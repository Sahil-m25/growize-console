/* M12-S10 — THE ISOLATION SUITE, local half. Run from console/: node --test src/server/http/contract/isolation.test.cjs
 *
 * "No user sees another user's leads, investors, documents, sign requests, emails or tickets."
 * A table-driven seat × record-owner matrix. Every row calls the REAL reader or guard (server/documents/reader, emails/record-emails,
 * cases/reach, leads/seat-search, investors/search, zoho-sign/embed, data/scope + lib/zoho/cache) through harness.cjs's loader and its
 * `rig()` (a client on a fetch that replays recorded Zoho answers — nothing reaches Zoho). Judgement of ids and masked identity is
 * scripts/leak-matrix.lib.cjs (collectIds, maskedFindings), the same one the route suites use.
 *
 * What a replay can and cannot prove: the double never filters on its own, so where Zoho's sharing is the wall (Originating_IR, KAM = me,
 * Owner = me) the double applies the same predicate the query names — the matrix proves the console's two walls (the seat table and
 * the WHERE it sends, plus admitContact after it); that Zoho's own sharing agrees is the sandbox half (M12-S10-NOTE, `needs sandbox`).
 *
 * Case ids in test names: IS-<story-AC> (isolation), plus TC-IM07-0xx / TC-E09-0xx where a case owns the row.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHmac, randomUUID } = require('node:crypto');
const H = require('./harness.cjs');
const L = require('../../../../scripts/leak-matrix.lib.cjs');

const P = '9007199254';
const id = (n) => `${P}${n}`;
/* people (the recorded fixtures' own ids) */
const HARSHA = id('740993002'), LATHA = id('740993903'), SAHIL = id('740993900'), IMRAN = id('740994001'), KAM2 = id('740994002'), ROHIT = id('740995001'), IR_B = id('740995002');
/* investors: PRAKASH and KIRAN came from Rohit's leads, RADHIKA is Imran's, JOSEPH came from IR B's lead */
const PRAKASH = id('740997301'), KIRAN = id('740997320'), RADHIKA = id('740994101'), JOSEPH = id('740997209');
const EKA = id('740998101'), OTHER_LLP = id('740998102'), HIDDEN_LLP = id('740998199');

/* every console seat token the policy knows (CONSOLE_SEAT's values plus the Investors-side tokens scopesFor holds) */
const ALL_SEATS = ['fin', 'head', 'comp', 'di', 'ops', 'kam', 'amlead', 'ir', 'cp', 'conv', 'exec', 'audit', 'bu'];

const { docAccessFor, holdsLlp, heldLlps } = H.load('server/documents/scope.ts');
const { scopesFor, scopedKeyString, cacheScopeOf } = H.load('server/data/scope.ts');
const { createDocumentsReader } = H.load('server/documents/reader.ts');
const { createRecordEmails } = H.load('server/emails/record-emails.ts');
const { readableCases } = H.load('server/cases/reach.ts');
const { searchPlanOf, seatSearchRequestOf, createSeatSearch } = H.load('server/leads/seat-search.ts');
const { createInvestorSearch } = H.load('server/investors/search.ts');
const { cacheKey } = H.load('lib/zoho/cache.ts');

const refusalsBy = (r, action) => r.refusals().filter((x) => x.action === action);
const attCalls = (r, mod) => r.calls.filter((c) => c.method === 'GET' && new RegExp(`/${mod}/\\d+/Attachments`).test(c.url));
/** every Zoho-shaped id anywhere in a value (leak-matrix collectIds) */
const idsIn = (v) => L.collectIds(JSON.parse(JSON.stringify(v))).map((x) => x.id);

/* ================================================== 1. seat × scope (S01-T04, S10-T01) ============================================ */

/* The scope table of M12-S01-T01 / docs/reports/m12-document-scope-table.md, one row per seat: [personal, allotment, project]. */
const SCOPE_TABLE = {
  fin: [true, 'files', true], head: [true, 'files', true], comp: [true, 'files', true], di: [true, 'files', true], ops: [true, 'files', true],
  kam: [true, 'files', true], amlead: [true, 'files', true],
  audit: [false, 'files', true], exec: [false, 'files', true], bu: [false, 'files', true],
  ir: [false, 'status', true],
  cp: [false, 'none', true], conv: [false, 'none', true],
};

test('IS-S01-T04: every seat × scope — personal, allotment, project — is the table, and a new seat must be added to it', () => {
  for (const s of H.SEATS) assert.ok(ALL_SEATS.includes(s), `seat ${s} has no row in this suite: decide what it may see`);
  assert.deepEqual(Object.keys(SCOPE_TABLE).sort(), [...ALL_SEATS].sort());
  for (const seat of ALL_SEATS) {
    const a = docAccessFor(seat, HARSHA);
    assert.deepEqual([a.personal, a.allotment, a.project], SCOPE_TABLE[seat], seat);
    // the table agrees with the one seat table the books come from: nobody lists papers of an Investors book they do not hold
    const inv = scopesFor(seat, HARSHA).investors.kind;
    if (inv === 'none') assert.equal(a.allotment, 'none', `${seat} has no Investors book`);
    if (inv === 'own-lead') assert.equal(a.personal, false, `${seat}: an IR never reads personal papers (M12-S01 AC6)`);
  }
  assert.deepEqual([docAccessFor('fin', 'bad id').personal, docAccessFor('fin', 'bad id').project], [false, false], 'a malformed id gets nothing');
});

/* ================================================== 2. documents: personal / allotment / project (S10-T05, S10-T01) =============== */

const recorded = (n) => H.recorded('documents', n);
const CONTACT = { [PRAKASH]: 'coql.contact-prakash', [KIRAN]: 'coql.contact-kiran', [RADHIKA]: 'coql.contact-radhika' };
const ALLOTS = { [PRAKASH]: 'coql.allotments-prakash', [KIRAN]: 'coql.allotments-kiran', [RADHIKA]: 'coql.allotments-radhika' };
/* Zoho's own filter, replayed from the predicate the query names: a one-Contact read returns the Contact only for the person it names */
const OWNER = { [PRAKASH]: { ir: ROHIT, kam: null }, [KIRAN]: { ir: ROHIT, kam: null }, [RADHIKA]: { ir: null, kam: IMRAN } };
const NONE = { status: 204, headers: {}, body: {} };
function docRoute(c) {
  const q = c.q, u = c.url;
  if (!q) {
    const slot = u.match(/\/(Contacts|LLP_UnitAllocation_Module|LLP_Creation_Module)\/(\d+)\?fields=/);
    if (slot) return slot[1] === 'Contacts' && slot[2] === PRAKASH ? recorded('slots.contact') : { status: 200, headers: {}, body: { data: [{ id: slot[2] }] } };
    const att = u.match(/\/(Contacts|LLP_UnitAllocation_Module|LLP_Creation_Module)\/(\d+)\/Attachments/);
    if (!att) return null;
    if (att[1] === 'Contacts') return recorded('attachments.contact');
    if (att[1] === 'LLP_UnitAllocation_Module') return recorded('attachments.allotment');
    return att[2] === HIDDEN_LLP ? recorded('attachments.forbidden') : att[2] === OTHER_LLP ? recorded('attachments.none') : recorded('attachments.llp');
  }
  if (/from Contacts/.test(q)) {
    const one = q.match(/id = '(\d+)'/);
    if (one) {
      const o = OWNER[one[1]], ir = q.match(/Originating_IR = '(\d+)'/), kam = q.match(/KAM = '(\d+)'/);
      if (!o || (ir && o.ir !== ir[1]) || (kam && o.kam !== kam[1])) return NONE;
      return recorded(CONTACT[one[1]]);
    }
    if (/Originating_IR = /.test(q)) return q.includes(ROHIT) ? recorded('coql.own-lead-book') : NONE;
    if (/KAM = /.test(q)) return q.includes(IMRAN) ? recorded('coql.own-book') : NONE;
  }
  if (/from LLP_UnitAllocation_Module/.test(q)) {
    if (/LLP = /.test(q)) return recorded('coql.holders-eka');
    const k = Object.keys(ALLOTS).find((x) => q.includes(x));
    return k ? recorded(ALLOTS[k]) : NONE;
  }
  return null;
}
const docs = () => { const r = H.rig(docRoute); return { r, reader: createDocumentsReader({ crm: r.crm, events: r.events }) }; };

/* one row = [case id, seat, person, investor Contact, outcome]. outcome: refused:<reason> or {personal,allotment,farms} as the seat gets them */
const INVESTOR_ROWS = [
  ['fin on any investor', 'fin', HARSHA, PRAKASH, { personal: true, files: true, farms: true }],
  ['fin on an IR-originated and a KAM investor alike', 'fin', HARSHA, RADHIKA, { personal: true, files: true, farms: true }],
  ['Sahil (di)', 'di', SAHIL, KIRAN, { personal: true, files: true, farms: true }],
  ['the Auditor reads the org but no personal papers', 'audit', LATHA, PRAKASH, { personal: false, files: true, farms: true }],
  ['an IR on their own lead\'s investor: status only', 'ir', ROHIT, PRAKASH, { personal: false, files: false, farms: true }],
  ['an IR on their other own lead\'s investor', 'ir', ROHIT, KIRAN, { personal: false, files: false, farms: true }],
  ['an IR on a KAM\'s investor (not from their lead)', 'ir', ROHIT, RADHIKA, 'refused:not-visible'],
  ['IR B on Rohit\'s investor', 'ir', IR_B, PRAKASH, 'refused:not-visible'],
  ['IR B on Rohit\'s other investor', 'ir', IR_B, KIRAN, 'refused:not-visible'],
  ['IR B on a KAM\'s investor', 'ir', IR_B, RADHIKA, 'refused:not-visible'],
  ['the KAM on their own book', 'kam', IMRAN, RADHIKA, { personal: true, files: true, farms: true }],
  ['the KAM on an IR\'s investor', 'kam', IMRAN, PRAKASH, 'refused:not-visible'],
  ['another KAM on Imran\'s investor', 'kam', KAM2, RADHIKA, 'refused:not-visible'],
  ['another KAM on an IR\'s investor', 'kam', KAM2, PRAKASH, 'refused:not-visible'],
  ['a channel partner has no Investors book', 'cp', ROHIT, PRAKASH, 'refused:seat-denied'],
  ['an IR Manager has no Investors book', 'conv', ROHIT, PRAKASH, 'refused:seat-denied'],
  ['an unknown seat', 'stranger', HARSHA, PRAKASH, 'refused:seat-denied'],
];
for (const [name, seat, who, contact, want] of INVESTOR_ROWS) {
  test(`IS-S10-T05 personal + allotment scope — ${name} (${seat} → ${contact.slice(-6)})`, async () => {
    const { r, reader } = docs();
    const res = await reader.forInvestor(await r.cred(who), seat, contact);
    if (typeof want === 'string') {
      const reason = want.split(':')[1];
      assert.equal(res.ok, false, JSON.stringify(res));
      assert.equal(res.reason, reason);
      assert.equal(attCalls(r, 'Contacts').length + attCalls(r, 'LLP_UnitAllocation_Module').length + attCalls(r, 'LLP_Creation_Module').length, 0, 'nothing is listed for a refused record');
      const line = refusalsBy(r, 'documents-investor');
      assert.equal(line.length, 1, 'refused and logged, once');
      if (reason !== 'seat-denied' || contact) assert.deepEqual([...line[0].recordIds], [contact], 'by id');
      assert.ok(!/\.pdf|Supplementary|Aadhaar/i.test(r.logText()), 'the log holds ids and codes, never a file name');
      return;
    }
    assert.equal(res.ok, true, JSON.stringify(res));
    const d = res.documents;
    assert.equal(d.personal !== null, want.personal, 'personal papers');
    assert.equal(d.allotments.every((a) => a.files !== null) && d.allotments.length > 0, want.files, 'allotment files (vs the count only)');
    assert.equal(d.farms !== null, want.farms, 'project papers');
    assert.equal(attCalls(r, 'Contacts').length, want.personal ? 1 : 0, 'the Contact\'s attachments are asked for only when the seat may list them');
    // no other investor's id anywhere in the answer
    const others = [PRAKASH, KIRAN, RADHIKA, JOSEPH].filter((x) => x !== contact);
    const seen = idsIn(d);
    assert.ok(!others.some((x) => seen.includes(x)), 'another investor\'s id is in the answer');
    assert.deepEqual(L.maskedFindings(JSON.parse(JSON.stringify(d)), JSON.stringify(d)), [], 'no unmasked PAN / Aadhaar / bank / UTR in a document list (Sahil included)');
  });
}

test('IS-S10-T05 investor A × investor B: project papers only of an LLP they hold (D70), cancelled holds nothing', () => {
  const rows = [
    { Customer: PRAKASH, LLP_Lookup: EKA, Allocation_Status: 'Reserved' },
    { Customer: KIRAN, LLP_Lookup: OTHER_LLP, Allocation_Status: 'Issued' },
    { Customer: RADHIKA, LLP_Lookup: OTHER_LLP, Allocation_Status: 'Cancelled' },
  ];
  const A = PRAKASH, B = KIRAN, C = RADHIKA;
  assert.deepEqual([holdsLlp(rows, A, EKA), holdsLlp(rows, A, OTHER_LLP)], [true, false], 'A holds EKA only');
  assert.deepEqual([holdsLlp(rows, B, EKA), holdsLlp(rows, B, OTHER_LLP)], [false, true], 'B holds the other LLP only');
  assert.deepEqual([holdsLlp(rows, C, EKA), holdsLlp(rows, C, OTHER_LLP)], [false, false], 'a cancelled allotment holds nothing');
  assert.deepEqual([...heldLlps(rows, A)], [EKA]);
  assert.deepEqual([...heldLlps(rows, B)], [OTHER_LLP]);
  assert.deepEqual([...heldLlps(rows, C)], []);
});

const FARM_ROWS = [
  ['fin sees every holder\'s allotment files', 'fin', HARSHA, EKA, { project: 1, holders: [PRAKASH, KIRAN, RADHIKA, id('740997399')], files: true }],
  ['the KAM sees only their own book\'s allotment papers', 'kam', IMRAN, EKA, { project: 1, holders: [RADHIKA], files: true }],
  ['another KAM sees no allotment papers on the same LLP', 'kam', KAM2, EKA, { project: 1, holders: [], files: true }],
  ['IR A: counts for their own leads\' investors, never files', 'ir', ROHIT, EKA, { project: 1, holders: [PRAKASH, KIRAN], files: false }],
  ['IR B: no holder of theirs on this LLP, so no allotment line', 'ir', IR_B, EKA, { project: 1, holders: [], files: false }],
  ['a channel partner: project papers only', 'cp', ROHIT, EKA, { project: 1, holders: [], files: false }],
  ['an LLP with no papers', 'head', HARSHA, OTHER_LLP, { project: 0, holders: null, files: true }],
  ['an LLP Zoho will not open for this person', 'head', HARSHA, HIDDEN_LLP, 'refused:not-visible'],
  ['an unknown seat', 'stranger', HARSHA, EKA, 'refused:seat-denied'],
];
for (const [name, seat, who, llp, want] of FARM_ROWS) {
  test(`IS-S10-T05 allotment + project scope on an LLP — ${name}`, async () => {
    const { r, reader } = docs();
    const res = await reader.forFarm(await r.cred(who), seat, llp);
    if (typeof want === 'string') { assert.deepEqual([res.ok, res.reason], [false, want.split(':')[1]]); assert.equal(refusalsBy(r, 'documents-farm').length, 1); return; }
    assert.equal(res.ok, true, JSON.stringify(res));
    const d = res.documents;
    assert.equal(d.project.length, want.project);
    if (want.holders) {
      assert.deepEqual(d.allotments.map((a) => a.contactId), want.holders);
      assert.ok(d.allotments.every((a) => (a.files !== null) === want.files));
    }
    assert.equal(attCalls(r, 'Contacts').length, 0, 'the LLP view never lists a Contact\'s personal papers');
  });
}

/* ================================================== 3. emails (S09-T03, S10-T06) ================================================= */

const LEAD_R = id('740996421'), LEAD_O = id('740996499'), ALLOT = id('740999401');
const EM = (n) => H.recorded('emails', n);
const EMPTY = { status: 204, headers: {}, body: null };
/* Origin of each investor Contact: Joseph came from IR B's lead, Kiran from Rohit's */
const EM_ORIGIN = { [JOSEPH]: IR_B, [KIRAN]: ROHIT };
const EM_CONTACT = { [JOSEPH]: 'coql.contact-joseph', [KIRAN]: 'coql.contact-kiran' };
function emRoute(c) {
  if (c.q) {
    if (/from LLP_UnitAllocation_Module/.test(c.q)) return c.q.includes(ALLOT) ? EM('coql.allotment-kiran') : EMPTY;
    if (/from Contacts/.test(c.q)) {
      const cid = (c.q.match(/id = '(\d+)'/) || [])[1], ir = (c.q.match(/Originating_IR = '(\d+)'/) || [])[1], kam = (c.q.match(/KAM = '(\d+)'/) || [])[1];
      if (!EM_CONTACT[cid] || (ir && EM_ORIGIN[cid] !== ir) || kam) return EMPTY; /* no investor of these fixtures is in a KAM's book */
      return EM(EM_CONTACT[cid]);
    }
    return null;
  }
  if (/\/Emails\/[^/?]+/.test(c.url)) return EM('open.contact');
  if (/\/Emails/.test(c.url)) return EM('list.contact');
  if (c.url.includes(`/Leads/${LEAD_R}?`)) return EM('lead.rohit');
  if (c.url.includes(`/Leads/${LEAD_O}?`)) return EM('lead.other');
  return null;
}
const MSG = 'c6085fae06cbd7b75001fe70000000000000000000000000000000000001';
const EMAIL_ROWS = [
  /* [name, seat, person, kind, record, ok | reason] */
  ['IR A on their own lead', 'ir', ROHIT, 'lead', LEAD_R, true],
  ['IR A on IR B\'s lead', 'ir', ROHIT, 'lead', LEAD_O, 'not-in-book'],
  ['IR B on IR A\'s lead', 'ir', IR_B, 'lead', LEAD_R, 'not-in-book'],
  ['IR A on an investor from their own lead', 'ir', ROHIT, 'investor', KIRAN, true],
  ['IR A on an investor from IR B\'s lead', 'ir', ROHIT, 'investor', JOSEPH, 'not-visible'],
  ['IR B on IR A\'s investor', 'ir', IR_B, 'investor', KIRAN, 'not-visible'],
  ['IR A on the allotment of their own lead\'s investor', 'ir', ROHIT, 'allotment', ALLOT, true],
  ['IR B on that allotment', 'ir', IR_B, 'allotment', ALLOT, 'not-visible'],
  ['Finance on an investor', 'fin', HARSHA, 'investor', JOSEPH, true],
  ['Finance on a lead: no lead emails on the Investors side', 'fin', HARSHA, 'lead', LEAD_R, 'seat-denied'],
  ['the KAM on an investor outside their book', 'kam', IMRAN, 'investor', JOSEPH, 'not-visible'],
  ['Digital Infrastructure on any lead', 'di', SAHIL, 'lead', LEAD_O, true],
  ['a channel partner on an investor', 'cp', ROHIT, 'investor', KIRAN, 'seat-denied'],
];
for (const [name, seat, who, kind, rec, want] of EMAIL_ROWS) {
  test(`IS-S09-T03 emails — ${name}`, async () => {
    const r = H.rig(emRoute);
    const emails = createRecordEmails({ crm: r.crm, events: r.events, log: r.log, clock: () => H.NOW });
    const res = await emails.list(await r.cred(who), seat, kind, rec);
    const asked = r.calls.filter((c) => /\/Emails/.test(c.url));
    if (want === true) {
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(asked.length, 1, 'one Emails call, on the viewer\'s own token');
      assert.match(String(asked[0].headers.Authorization || asked[0].headers.authorization || ''), new RegExp(`synthetic-${who}`));
      assert.ok(res.value.emails.length > 0);
    } else {
      assert.equal(res.ok, false);
      assert.equal(res.reason, want);
      assert.equal(asked.length, 0, 'no Emails call for a record the person cannot open');
      assert.ok(!/subject|@/i.test(JSON.stringify(res)), 'a refusal carries no email');
    }
    assert.ok(!/@example|body/i.test(r.logText()), 'no email address or body in Plane B');
  });
}

test('IS-S09-T03/S10-T06 emails: Zoho forbidding the record shows an in-page refusal and no list; a hidden email is not shown', async () => {
  const r = H.rig((c) => (/\/Emails/.test(c.url) ? EM('forbidden') : emRoute(c)));
  const emails = createRecordEmails({ crm: r.crm, events: r.events, log: r.log, clock: () => H.NOW });
  const res = await emails.list(await r.cred(HARSHA), 'fin', 'investor', JOSEPH);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not-visible');
  const hidden = H.rig((c) => (/\/Emails/.test(c.url) ? EMPTY : emRoute(c)));
  const e2 = createRecordEmails({ crm: hidden.crm, events: hidden.events, log: hidden.log, clock: () => H.NOW });
  assert.deepEqual((await e2.list(await hidden.cred(HARSHA), 'fin', 'investor', JOSEPH)).value.emails, [], 'what Zoho hides from this profile is not shown');
});

/* ================================================== 4. tickets (S10-T06, D72/D73) ================================================ */

const CASE1 = id('740998401'), CASE5 = id('740998405');
const CASE_ROWS = [
  /* [name, seat, person, ids asked, ids returned | refused reason] — Cases 8401..8403 are owned by Imran, 8405 by the other KAM */
  ['the KAM owning 8401', 'kam', IMRAN, [CASE1, CASE5], [CASE1]],
  ['the other KAM owning 8405', 'kam', KAM2, [CASE1, CASE5], [CASE5]],
  ['a KAM owning neither', 'kam', id('740994099'), [CASE1, CASE5], []],
  ['Finance reads the register org-wide', 'fin', HARSHA, [CASE1, CASE5], [CASE1, CASE5]],
  ['the Head of AM reads by subtree; with none wired nothing is dropped by the Owner predicate', 'amlead', id('740994900'), [CASE1], null],
  ['an IR has no tickets book', 'ir', ROHIT, [CASE1], 'no-book'],
  ['a channel partner has no tickets book', 'cp', ROHIT, [CASE1], 'no-book'],
  ['a malformed id is refused before Zoho', 'fin', HARSHA, ['12'], 'invalid-request'],
];
for (const [name, seat, who, ids, want] of CASE_ROWS) {
  test(`IS-S10-T06 tickets — ${name}`, async () => {
    const r = H.rig((c) => (c.q && /from Cases/.test(c.q) ? ['cases', 'coql.cases.kam-foreign'] : null));
    const res = await readableCases({ crm: r.crm }, { credential: await r.cred(who), seat }, ids);
    if (typeof want === 'string') {
      assert.deepEqual([res.ok, res.reason], [false, want]);
      if (want === 'no-book' || want === 'invalid-request') assert.equal(r.calls.length, 0, 'refused before anything is read');
    } else {
      assert.equal(res.ok, true, JSON.stringify(res));
      if (want) assert.deepEqual([...res.ids].sort(), [...want].sort());
      assert.ok(r.calls.every((c) => String(c.headers.Authorization || c.headers.authorization).includes(who)), 'on the person\'s own token');
    }
  });
}

/* ================================================== 5. search (S10-T05, D69 → D110) ============================================== */

const SEARCH_TABLE = { ir: [true, false], cp: [true, false], conv: [true, false], exec: [true, false], fin: [false, true], head: [false, true], comp: [false, true], amlead: [false, true], kam: [false, true], di: [true, true], ops: [true, true], bu: [true, true], audit: [false, false] };
test('IS-S10-T05 search: which half each seat asks — an IR\'s top-bar search is leads only and never an investor (D110 over D69)', () => {
  for (const seat of ALL_SEATS) {
    const p = searchPlanOf(seat);
    assert.deepEqual([p.leads, p.investors], SEARCH_TABLE[seat], seat);
  }
  const q = (s) => new URLSearchParams(s);
  for (const seat of ['ir', 'cp', 'conv']) {
    assert.equal(seatSearchRequestOf(q('q=Synthetic&module=Contacts'), searchPlanOf(seat)).ok, false, `${seat} naming Contacts is refused before anything is read`);
    const withOwner = seatSearchRequestOf(q('q=Synthetic&owner=' + IR_B), searchPlanOf(seat));
    assert.deepEqual([withOwner.ok, withOwner.term, withOwner.only], [true, 'Synthetic', null], `${seat}: an owner filter is ignored, the book stays the caller's`);
  }
});

const byQuery = (q) => (/ARL_ID = /.test(q) ? ['investor-search', 'coql.code'] : /Mobile like/.test(q) ? ['investor-search', 'coql.phone'] : ['investor-search', 'coql.mysuru']);
const invSearch = async (who, seat, term = 'Mysuru') => {
  const r = H.rig((c) => (c.q ? byQuery(c.q) : null));
  const s = createInvestorSearch({ crm: r.crm, events: r.events, log: r.log, cache: r.cache });
  return { r, res: await s.find({ credential: await r.cred(who), seat }, { term, farmId: null }) };
};
test('IS-S10-T05 investors search: IR A finds investors from their own leads only (Originating_IR in the WHERE, a slipped row dropped and logged)', async () => {
  const { r, res } = await invSearch(ROHIT, 'ir');
  assert.match(r.calls[0].q, new RegExp(`Originating_IR = '${ROHIT}' and Origin_Lead is not null`));
  assert.deepEqual(res.value.hits.map((h) => h.code), ['ARL-INV-0208']);
  assert.ok(r.refusals().some((x) => x.reason === 'outside-book' && x.recordIds.includes(id('740997216'))), 'the investor from another IR\'s lead came back and was dropped');
  assert.ok(!idsIn(res.value).includes(id('740997216')), 'and is not in the answer, so its record URL is never offered');
});
test('IS-S10-T05 investors search: IR B asks the same question and the WHERE names IR B, not IR A', async () => {
  const { r } = await invSearch(IR_B, 'ir');
  assert.match(r.calls[0].q, new RegExp(`Originating_IR = '${IR_B}'`));
  assert.ok(!r.calls[0].q.includes(ROHIT));
});
test('IS-S10-T05 investors search: a KAM asks KAM = me; Finance org-wide; a seat with no book is refused with no read', async () => {
  const kam = await invSearch(IMRAN, 'kam');
  assert.match(kam.r.calls[0].q, new RegExp(`\\(KAM = '${IMRAN}'\\)`));
  const fin = await invSearch(HARSHA, 'fin');
  assert.ok(!/where .*(KAM = |Originating_IR = )/.test(fin.r.calls[0].q), 'Finance reads the org: no person in the WHERE');
  for (const seat of ['cp', 'conv']) {
    const none = await invSearch(ROHIT, seat);
    assert.equal(none.res.ok, false);
    assert.equal(none.r.calls.length, 0, `${seat}: nothing read`);
  }
});
test('IS-S10-T05 top-bar search: an IR never reaches the investor half, even when a Contacts hit exists', async () => {
  let investorAsked = 0;
  const s = createSeatSearch({
    leads: { async find() { return { ok: true, value: { book: 'yours', hits: [{ id: LEAD_R, name: 'L', phoneLast4: '0001', stage: 'x', ownerId: ROHIT }], more: 0 } }; } },
    investors: async () => { investorAsked++; return { async find() { return { ok: true, value: { book: 'org', hits: [{ id: PRAKASH, name: 'I', code: 'c', city: 'x', phoneLast4: '0002' }], more: 0, farmId: null } }; } }; },
  });
  const res = await s.find({ credential: { userId: ROHIT }, sessionId: 'session_fixture_seat_0001', seat: 'ir' }, { term: 'Synthetic', only: null });
  assert.equal(investorAsked, 0);
  assert.deepEqual(res.value.hits.map((h) => h.kind), ['lead']);
});

/* ================================================== 6. Zoho Sign: embed + status (S10-T06, S08-T03) ============================== */

const consoleRoot = H.consoleRoot;
const contractsDir = path.resolve(consoleRoot, '..', 'contracts');
const { loadSchemas } = H.load('server/contracts/stub.ts');
const { createEmbedEndpoint } = H.load('server/zoho-sign/embed.ts');
const { createSignApi, EMBED_URL_TTL_MS } = H.load('server/zoho-sign/api.ts');
const { createZohoServiceClient, serviceCredential } = H.load('lib/zoho/client.ts');
const { createMemorySink, createOpsLog } = H.load('lib/zoho/log.ts');
const KEY = 'synthetic-contract-key-0123456789abcdef0123456789';
const HOST = 'https://app.growize.example';
const REQ = '90071992547409981', REQ2 = '90071992547409982';
const KIRAN_C = id('740997101'); /* the Sign fixtures' Kiran; JOSEPH is the NRI whose FEMA request is REQ2 */
const SG = (n) => H.recorded('sign', n);
const hmac = (body, key) => createHmac('sha256', key).update(body).digest('hex');
function embedRig({ contact = {}, signGet, embedToken } = {}) {
  const calls = []; const sink = createMemorySink(); const log = createOpsLog(sink);
  const route = (host) => async (url, init) => {
    const u = decodeURIComponent(String(url)); const c = { host, method: init.method, url: u, body: init.body }; calls.push(c);
    let r = null;
    if (host === 'crm' && /\/Contacts\//.test(u)) r = contact[u.match(/\/Contacts\/(\d+)/)[1]];
    else if (host === 'crm' && /coql/.test(u)) r = SG('crm.coql.none');
    else if (host === 'sign' && init.method === 'GET') r = signGet || SG('sign.get.joseph-inprogress');
    else if (host === 'sign' && /embedtoken/.test(u)) r = embedToken || SG('sign.embedtoken');
    if (!r) throw new Error('unrouted ' + host + ' ' + u);
    return H.toResponse(r);
  };
  const crm = createZohoServiceClient({ recordIdPrefix: P, gate: H.immediateGate(), log, maxAttempts: 1, clock: () => H.NOW, fetch: route('crm') });
  const sign = createSignApi({ origin: 'https://sign.zoho.in', gate: H.immediateGate(), log, maxAttempts: 1, clock: () => H.NOW, fetch: route('sign'), sleep: async () => {} });
  const svc = serviceCredential('provider-callback', { access_token: 'synthetic-service-token', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 }, H.NOW);
  const seen = new Set();
  const ep = createEmbedEndpoint({ schemas: loadSchemas(contractsDir), keys: [KEY], seen: { has: async (k) => seen.has(k), add: async (k) => { seen.add(k); } },
    allowedHosts: [HOST], crm, sign, credential: async () => svc, log, clock: () => H.NOW });
  const send = (e) => { const body = JSON.stringify(e); return ep.handle(body, hmac(body, KEY)); };
  return { calls, sink, send, embedCalls: () => calls.filter((c) => /embedtoken/.test(c.url)), text: () => JSON.stringify(sink.records()) };
}
const embedEvent = (who, over = {}) => ({
  event_id: randomUUID(), type: 'sign.embed', schema_version: 1, occurred_at: '2026-09-28T11:30:00+05:30',
  actor: { kind: 'investor', investor_contact_id: who }, ids: { investor_contact_id: who },
  payload: { request_id: REQ2, host: HOST, app_user_id: 'b7c1e0e2-0000-4000-8000-000000000001' }, ...over,
});
const CONTACTS = { [JOSEPH]: SG('crm.contact.joseph-nri'), [KIRAN_C]: SG('crm.contact.kiran') };

test('IS-S10-T06 / S08-T03 embedded signing: investor A gets the URL for A\'s request, with a 2-minute life', async () => {
  const e = embedRig({ contact: CONTACTS });
  const res = await e.send(embedEvent(JOSEPH));
  assert.equal(res.status, 200, JSON.stringify(res));
  assert.equal(res.expiresAt - H.NOW, 120_000);
  assert.equal(EMBED_URL_TTL_MS, 120_000);
  assert.equal(e.embedCalls().length, 1);
  assert.ok(!e.text().includes('zohoapis') && !e.text().includes(res.signUrl), 'the URL is never logged');
});
test('IS-S10-T06 / S08-T03 embedded signing: investor B (a real Contact) asking for A\'s request is refused and logged; no URL is minted', async () => {
  const e = embedRig({ contact: CONTACTS });
  const res = await e.send(embedEvent(KIRAN_C));
  assert.equal(res.status, 403);
  assert.equal(res.reason, 'not-your-request');
  assert.equal(e.embedCalls().length, 0);
  assert.ok(e.sink.records().some((x) => x.kind === 'refusal' && x.action === 'sign-embed' && x.recordIds.includes(KIRAN_C)), 'refused and logged in Plane B by id');
});
test('IS-S10-T06 / S08-T03 embedded signing: B speaking as A (actor ≠ ids) and an app session naming an unknown Contact are refused before any read', async () => {
  const e = embedRig({ contact: CONTACTS });
  assert.equal((await e.send(embedEvent(JOSEPH, { actor: { kind: 'investor', investor_contact_id: KIRAN_C } }))).reason, 'wrong-identity');
  const ghost = embedRig({ contact: {} });
  assert.notEqual((await ghost.send(embedEvent(id('740997999')))).status, 200, 'an unknown Contact (the double has no record) never gets a URL');
  assert.equal(ghost.embedCalls().length, 0);
  assert.equal(e.calls.length, 0, 'wrong identity: Zoho was not asked at all');
});
test('IS-S10-T06 / S08-T03 embedded signing: the request\'s own recipient email must match — someone else\'s mailbox is refused', async () => {
  const other = SG('sign.get.joseph-inprogress'); other.body.requests.actions[0].recipient_email = 'someone.else@example.invalid';
  const e = embedRig({ contact: CONTACTS, signGet: other });
  assert.equal((await e.send(embedEvent(JOSEPH))).reason, 'not-recipient');
  assert.equal(e.embedCalls().length, 0);
});
test('IS-S10-T06 / S08-T03 embedded signing: a replayed event never mints a second URL; a request sent for the email path answers 409 and the email still works', async () => {
  const e = embedRig({ contact: CONTACTS });
  const ev = embedEvent(JOSEPH);
  assert.equal((await e.send(ev)).status, 200);
  assert.deepEqual(await e.send(ev), { status: 409, reason: 'replayed' });
  assert.equal(e.embedCalls().length, 1);
  // email path (TC-IM07 S08 AC1): requests are created without is_embedded, so Zoho Sign's own email carries the link; an app press on
  // such a request answers 409 'not-out' (sign from the email) instead of failing
  const src = require('node:fs').readFileSync(path.join(H.srcRoot, 'server', 'zoho-sign', 'send.ts'), 'utf8');
  assert.ok(!/is_embedded\s*:\s*true/.test(src));
  const refused = embedRig({ contact: CONTACTS, embedToken: SG('sign.embedtoken.not-embedded') });
  assert.deepEqual(await refused.send(embedEvent(JOSEPH)), { status: 409, reason: 'not-out' });
});

/* ================================================== 7. cache cross-scope probe (S10-T07) ========================================= */

test('TC-E15-010 (local half) IS-S10-T07 cache keys carry the scope: a person-bound book keys by the person, never by role', () => {
  const A = id('740995001'), B = id('740995002');
  const BOOKS = ['leads', 'investors', 'money', 'cases', 'holdings', 'farms'];
  for (const seat of ALL_SEATS) for (const book of BOOKS) {
    const sa = scopesFor(seat, A)[book], sb = scopesFor(seat, B)[book];
    if (sa.kind === 'none') { assert.throws(() => cacheScopeOf(sa), /has no cache key/, `${seat}.${book}`); continue; }
    const ka = scopedKeyString(sa, 'probe'), kb = scopedKeyString(sb, 'probe');
    if (sa.kind === 'user' || sa.kind === 'own-lead' || sa.kind === 'own-book') {
      assert.notEqual(ka, kb, `${seat}.${book}: two people must never share a key`);
      assert.ok(ka.includes(A) && !ka.includes(B) && kb.includes(B) && !kb.includes(A), `${seat}.${book}: the key names its person`);
    } else if (sa.kind === 'subtree') {
      assert.ok(ka.startsWith(`subtree:${A}|`) && kb.startsWith(`subtree:${B}|`), `${seat}.${book}`);
    } else {
      assert.ok(!ka.includes(A) && ka === kb && /^role:(org|all)\|/.test(ka), `${seat}.${book}: org/all keys name a role, shared only by people who read the same`);
    }
    assert.ok(ka.includes(`${sa.kind}.`) , `${seat}.${book}: the scope kind is in the key name`);
  }
  assert.throws(() => cacheKey({ kind: 'user' }, 'probe'), /scope|Cache/, 'an unscoped key cannot be minted');
});

test('TC-E15-010 (local half) IS-S10-T07 two users read the same page at once: each gets their own answer, from their own key, and no id crosses', async () => {
  const A = ROHIT, B = IR_B;
  const r = H.rig(() => null);
  const key = (uid) => cacheKey({ kind: 'user', userId: uid }, 'investors.count');
  const loads = { [A]: 0, [B]: 0 };
  const read = (uid, n) => r.cache.read(key(uid), async () => { loads[uid]++; await new Promise((res) => setTimeout(res, 5)); return n; });
  const settle = async (x) => (x.state === 'miss' ? (await x.settled).value : x.value);
  const results = await Promise.all([read(A, 2), read(B, 7), read(A, 99), read(B, 99)].map(async (p) => settle(await p)));
  assert.equal(results[0], 2); assert.equal(results[1], 7);
  assert.equal(results[2], 2, 'a second reader of A\'s key joins A\'s load, it never sees B\'s');
  assert.equal(results[3], 7);
  assert.deepEqual(loads, { [A]: 1, [B]: 1 }, 'one load per scope');
  const again = await r.cache.read(key(B), async () => 1234);
  assert.equal((again.state === 'miss' ? (await again.settled).value : again.value), 7, 'B still reads B\'s number');
});

test('TC-E15-010 (local half) IS-S10-T07 the same page as two staff, read in parallel through the real readers: no id of one scope appears in the other\'s answer', async () => {
  const { r, reader } = docs();
  const [a, b, c] = await Promise.all([
    reader.forInvestor(await r.cred(ROHIT), 'ir', PRAKASH),
    reader.forInvestor(await r.cred(IR_B), 'ir', PRAKASH),
    reader.forFarm(await r.cred(IMRAN), 'kam', EKA),
  ]);
  assert.equal(a.ok, true); assert.equal(b.ok, false);
  assert.deepEqual(idsIn(b), [], 'IR B\'s refusal names no record');
  const verdict = L.judge({ role: 'kam', scope: { ids: [RADHIKA, EKA, ...idsIn(c)] }, route: 'documents/farm', method: 'GET', probe: 'in-scope', status: 200, headers: { 'cache-control': 'no-store' }, body: JSON.parse(JSON.stringify(c.documents)), text: JSON.stringify(c.documents), ignoreKeys: [] });
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
  assert.ok(!idsIn(c).includes(PRAKASH) && !idsIn(c).includes(KIRAN), 'the KAM\'s LLP page holds none of the IR\'s investors');
  assert.ok(!idsIn(a).includes(RADHIKA), 'the IR\'s page holds none of the KAM\'s');
});
