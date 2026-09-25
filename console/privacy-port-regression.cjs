/* Run with node --test privacy-port-regression.cjs. Uses the installed TypeScript compiler to
   execute the real selectors, reducers and rendered UI without adding a test dependency. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, 'src', request.slice(2)) : request, parent, ...args);
};
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
}
const load = Module._load;
Module._load = function (request, ...args) {
  if (request === 'next/navigation') return { useRouter: () => ({ push() {}, replace() {} }), usePathname: () => '/activity' };
  return load.call(this, request, ...args);
};

const store = require('./src/lib/store.tsx');
const selectors = require('./src/lib/selectors/index.ts');
const { drawerDef } = require('./src/components/shell/drawers/registry.ts');
const { ActivityPage } = require('./src/features/activity/ActivityPage.tsx');
const { LeadPage } = require('./src/features/lead/LeadPage.tsx');
const { AddPage } = require('./src/features/add/AddPage.tsx');
const { PayPage } = require('./src/features/pay/PayPage.tsx');
const { DocsPage } = require('./src/features/docs/DocsPage.tsx');
const { XferPage } = require('./src/features/xfer/XferPage.tsx');
const { UpdatesPage } = require('./src/features/updates/UpdatesPage.tsx');
const { SystemPage } = require('./src/features/system/SystemPage.tsx');
const { Teams } = require('./src/features/people/Teams.tsx');
const { DaySide } = require('./src/features/today/DaySide.tsx');
const { Gap } = require('./src/features/today/Gap.tsx');
const { TodayPage } = require('./src/features/today/TodayPage.tsx');
const { Horizon } = require('./src/features/today/Horizon.tsx');
const { tSeen } = require('./src/features/people/helpers.ts');
const { accessDay, pinAccessDate } = require('./src/lib/format.ts');
const { TopBar } = require('./src/components/shell/TopBar.tsx');
const { scopedRow, landSafe } = require('./src/components/shell/nav.ts');
const { LeadsPage } = require('./src/features/leads/LeadsPage.tsx');
const { createConsoleWriter } = require('./src/lib/console-save.ts');

function person(n, seat, mgr = null, on = true) { return { n, i: n.slice(0, 2), seat, mgr, on, c: 1, ph: '', em: '' }; }
function lead(id, n, own, sec = null) {
  return { id, n, own, sec, ph: '0000000000', em: '', city: 'Test city', src: 'Referral', ev: null,
    done: 3, at: ['20 Aug 10:00', '21 Aug 10:00', '22 Aug 10:00'], touch: {}, units: 1,
    nx: { t: 'Test follow-up', by: '29 Aug', d: '2026-08-29' }, fc: null, consent: true, by: own };
}
function log(who, what, lead = null, kind = 'stage', note = '') {
  return { who, what, lead, kind, note, d: '2026-08-28', at: '28 Aug 10:00' };
}
function fixture(who = 'owner') {
  const PEOPLE = {
    owner: person('Test Owner', 'ir', 'manager'), peer: person('Test Peer', 'ir', 'manager'),
    manager: person('Test Manager', 'conv'), outsider: person('Test Outsider', 'ir', 'other-manager'),
    'other-manager': person('Other Manager', 'ops'), left: person('Test Leaver', 'ir', 'manager', false),
    marketing: person('Test Marketing', 'mkt'),
  };
  const LEADS = [lead('own', 'Own investor', 'owner'), lead('shared', 'Shared investor', 'peer', 'owner'),
    lead('hidden', 'Hidden investor', 'outsider')];
  return { ...store.initialState(), WHO: who, ROLE: PEOPLE[who].seat, PEOPLE, LEADS, VIEW: 'activity', LEAD: 'own',
    LOG: [log('owner', 'Own action', 'own'), log('peer', 'Peer shared action', 'shared'),
      log('outsider', 'Outsider shared action', 'own'), log('owner', 'Own hidden action', 'hidden'),
      log('manager', 'Manager action'), log('left', 'Leaver shared action', 'shared')],
    PAPER: {}, DOCS: [], PAY: {}, CLAIM: {}, REQ: {}, EXT: {}, XFER: [], CALLS: {}, SENT: {},
    ACCT: {}, NOTES: {}, COVER: {}, AVAIL: {peer:{why:'On leave',from:'2026-08-27',to:'2026-08-29',by:'manager',at:'27 Aug'}}, TEMP: [], CAPS: {}, TEMPON: null, DRW: null,
    SEC: {}, NSEEN: {}, SC: { today: 'mine', leads: 'mine', activity: 'mine' } };
}
function render(Component, state, props = {}) {
  const previous = store.useConsole;
  store.useConsole = () => ({ state, dispatch() {} });
  try { return renderToStaticMarkup(React.createElement(Component, props)); }
  finally { store.useConsole = previous; }
}
const month = new Date(2026, 7, 1);

function writerFixture() {
  let state = fixture(), online = false, clock = 0, session = 0, reductions = 0;
  const writer = createConsoleWriter({ clock: () => clock, setTimer: () => 0, clearTimer() {},
    isOnline: () => online, currentSession: () => ({ actor: state.WHO, session }),
    read: () => state, write: next => { if (next.WHO !== state.WHO) session++; state = next; },
    reduce: (s, a) => { reductions++; return store.reducer(s, a); }, leadWrites: store.LEAD_WRITES });
  return { writer, state: () => state, change: next => { state = next; }, online: () => { online = true; },
    advance: ms => { clock += ms; }, reductions: () => reductions };
}

test('own Activity excludes peers on shared records, and all tables and calendar counts agree', () => {
  const state = fixture();
  const data = selectors.activityMonth(state, null, month, '2026-08-28');
  assert.deepEqual(data.rows.map(e => e.what), ['Own action']);
  assert.deepEqual(data.monthRowsAll.map(e => e.what), ['Own action']);
  assert.equal(data.dayRows.length, 1);
  assert.equal(data.cells.find(c => c.key === '2026-08-28').n, 1);
  assert(!render(ActivityPage, state).includes('Peer shared action'));
});
test('forged person selections cannot change a personal Activity scope', () => {
  const state = fixture();
  assert.deepEqual(selectors.activityMonth(state, 'peer', month, null).rows.map(e => e.what), ['Own action']);
});
test('manager Activity defaults to the whole team and others is bounded by actual reporting chain', () => {
  const state = fixture('manager');
  assert.equal(selectors.activityWho(state, undefined), 'manager');
  assert.deepEqual(selectors.activityActors(state).sort(), ['left', 'manager', 'owner', 'peer']);
  const all = selectors.activityMonth(state, null, month, null).rows.map(e => e.what);
  assert(all.includes('Peer shared action'));
  assert(all.includes('Leaver shared action'));
  assert(!all.includes('Outsider shared action'));
  assert(!all.includes('Own hidden action'));
  /* ir-console-redesigned.html:3924 `ACTWHO=null` — an unset page filter means the whole
     reporting chain, not just the signed-in manager, so the page (not only the selector) must
     show a peer's action by default. */
  assert(render(ActivityPage, state).includes('Peer shared action'));
});
test('org-wide lead role does not create org-wide Activity actors', () => {
  const state = fixture('other-manager');
  assert.deepEqual(selectors.activityActors(state).sort(), ['other-manager', 'outsider']);
  assert(!selectors.activityMonth(state, null, month, null).rows.some(e => e.who === 'owner'));
});
test('revoking Activity view removes logs even when others remains', () => {
  const state = fixture('manager');
  state.CAPS.manager = { activity: ['others'] };
  assert.deepEqual(selectors.activityMonth(state, null, month, null).rows, []);
  assert.deepEqual(selectors.activityActors(state), []);
});
test('revoking lead view invalidates direct records, team scope and drawers', () => {
  const state = fixture('manager');
  state.CAPS.manager = { leads: ['edit', 'assign'] };
  assert.deepEqual(selectors.openable(state), []);
  assert.equal(selectors.canOpenDrawer(state, 'notes', 'own'), false);
  assert.equal(selectors.canEdit(state, state.LEADS[0]), false);
});
test('direct record URLs do not expose hidden or nonexistent investors', () => {
  const state = fixture();
  for (const id of ['hidden', 'missing']) {
    const html = render(LeadPage, state, { id });
    assert(html.includes('There is no lead here'));
    assert(!html.includes('Hidden investor'));
    assert(!html.includes('Own investor'));
  }
});
test('unreachable drawer seeds and forged lead mutations are refused', () => {
  const state = fixture('manager');
  assert.strictEqual(store.reducer(state, { type: 'openDrawer', k: 'notes', id: 'hidden', seed: { NDRAFT: 'Secret' } }), state);
  for (const action of [
    { type: 'seedNext', id: 'hidden' }, { type: 'setFc', id: 'hidden', c: 'pipeline' },
    { type: 'reassignTo', id: 'hidden', to: 'owner', why: 'Load rebalancing' },
    { type: 'addNote', id: 'hidden' }, { type: 'go', v: 'leads', id: 'hidden' },
  ]) assert.strictEqual(store.reducer(state, action), state);
});
test('identity switch clears authored drafts, selected people, section tabs and unread marks', () => {
  const state = fixture();
  state.ui = { ...state.ui, NDRAFT: 'Secret note', ADDN: 'Secret name', CREF: 'Secret reference',
    PSEL2: 'own', NXD: { t: 'Secret follow-up' }, ACTWHO: 'manager', ACTTAB: 'person', NOPEN: 'cover',
    NP: { n: 'Secret new member' }, ABWHY: 'Sick' };
  state.SEC = { today: 'hidden-tab' };
  state.NSEEN = { 'owner|leads': '2026-08-28' };
  const next = store.reducer(state, { type: 'setPerson', k: 'peer' });
  for (const key of ['NDRAFT', 'ADDN', 'CREF', 'PSEL2', 'NXD', 'ACTWHO', 'ACTTAB', 'NOPEN', 'NP']) assert.equal(next.ui[key], undefined);
  assert.equal(next.ui.ABWHY, null);
  assert.deepEqual(next.SEC, {});
  assert.deepEqual(next.NSEEN, {});
  assert.equal(next.DRW, null);
});
test('opening a different investor clears note, loss, claim and next-step drafts', () => {
  const state = fixture();
  state.CAPS.owner = { pay: ['view'] };
  state.ui = { ...state.ui, NDRAFT: 'Previous investor note', LOSTN: 'Previous loss reason', CREF: 'Previous claim reference',
    CNOTE: 'Previous claim note', NXD: { t: 'Previous investor follow-up' }, MVTO: 'Previous investor owner' };
  assert.equal(store.reducer(state, { type: 'openDrawer', k: 'notes', id: 'shared' }).ui.NDRAFT, '');
  assert.equal(store.reducer(state, { type: 'openDrawer', k: 'lost', id: 'shared' }).ui.LOSTN, '');
  assert.equal(store.reducer(state, { type: 'openDrawer', k: 'claim', id: 'shared' }).ui.CREF, '');
  assert.equal(store.reducer(state, { type: 'openDrawer', k: 'next', id: 'shared' }).ui.NXD.t, 'Test follow-up');
  assert.equal(store.reducer(state, { type: 'openDrawer', k: 'owner', id: 'shared' }).ui.MVTO, null);
});
test('another user or expired temporary grant cannot be activated', () => {
  const state = fixture();
  state.TEMP = [{ id: 'other', to: 'peer', state: 'live', until: '29 Aug', page: 'activity', caps: ['view', 'others'] },
    { id: 'expired', to: 'owner', state: 'live', until: '20 Aug', page: 'activity', caps: ['view', 'others'] }];
  assert.strictEqual(store.reducer(state, { type: 'useTemp', id: 'other' }), state);
  assert.strictEqual(store.reducer(state, { type: 'useTemp', id: 'expired' }), state);
});
test('canRosterFor matches the prototype: a roster-holder acts on any active member, not just their own branch', () => {
  // ir-console-redesigned.html:3690 — `consoleAccount(me()) && (k===me() || canRoster())`, with no
  // check that k sits inside the caller's management chain.
  const state = fixture('manager');
  assert.equal(selectors.canRosterFor(state, 'peer'), true);
  assert.equal(selectors.canRosterFor(state, 'outsider'), true);
  assert.notStrictEqual(store.reducer(state, { type: 'setAvail', k: 'outsider', why: 'Sick' }), state);
});
test('duplicate detection confirms existence without naming hidden investors or their owners', () => {
  const state = fixture('marketing');
  state.LEADS[2].ph = '0000000001';
  state.ui.ADDPH = '0000000001';
  const html = render(AddPage, state);
  assert(html.includes('This mobile number is already registered'));
  assert(!html.includes('Hidden investor'));
});
test('borrowed operational screens show only authorized investor rows and counts', () => {
  const state = fixture();
  state.CAPS.owner = { pay: ['view'], docs: ['view'] };
  const receipt = { state: 'part', got: 1, mode: 'Test', utr: 'Synthetic reference', hold: '29 Aug', at: '28 Aug 10:00' };
  state.PAY = { own: receipt, hidden: receipt };
  state.DOCS = [{ lead: 'own', t: 'Own document', cls: 'Test', state: 'sent', ref: 'Own reference' },
    { lead: 'hidden', t: 'Hidden document', cls: 'Test', state: 'sent', ref: 'Hidden reference' }];
  state.XFER = [{ lead: 'own', state: 'done', code: 'Own transfer', on: '28 Aug' },
    { lead: 'hidden', state: 'done', code: 'Hidden transfer', on: '28 Aug' }];
  for (const Component of [PayPage, DocsPage, XferPage]) {
    const html = render(Component, state);
    assert(!html.includes('Hidden investor'));
    assert(!html.includes('Hidden document'));
    assert(!html.includes('Hidden reference'));
    assert(!html.includes('Hidden transfer'));
  }
});
test('displayed log details mask money and legacy mobile values without altering audit data', () => {
  const state = fixture();
  const money = log('owner', 'Receipt confirmed', 'own', 'money', 'Synthetic confidential amount');
  const mobile = log('owner', 'Changed their own details', null, 'admin', 'Mobile: synthetic old -> synthetic new');
  state.LOG = [money, mobile];
  assert.equal(selectors.logNote(state, money), '');
  assert.equal(selectors.logNote(state, mobile), 'Mobile updated');
  assert.equal(money.note, 'Synthetic confidential amount');
  for (const Component of [ActivityPage, drawerDef('history').Body]) {
    const html = render(Component, state, { id: 'own', lead: state.LEADS[0] });
    assert(!html.includes('Synthetic confidential amount'));
    assert(!html.includes('synthetic old'));
    assert(!html.includes('synthetic new'));
  }
  state.LOG = [log('peer', 'Receipt confirmed', 'own', 'money', 'Synthetic confidential amount')];
  assert(!render(UpdatesPage, state).includes('Synthetic confidential amount'));
  assert.equal(selectors.logNote({ ...state, ROLE: 'bu' }, money), '');
  assert.equal(selectors.logNote({ ...state, CAPS: {owner:{pay:['view']}} }, money), '');
  const authorized = {...state,PEOPLE:{...state.PEOPLE,owner:{...state.PEOPLE.owner,seat:'bu',mgr:null}},ROLE:'bu',CAPS:{owner:{pay:['view']}}};
  assert.equal(selectors.logNote(authorized,money),money.note);
});

test('expired, malformed, future and inactive cover cannot disclose an unrelated investor', () => {
  for (const cover of [
    { by: 'owner', to: '27 Aug' }, { by: 'owner', to: '' }, { by: 'owner', to: '32 Aug' },
    { by: 'owner', to: '2026-02-30' }, { by: 'owner', from: '29 Aug', to: '30 Aug' },
    { by: 'owner', from: 'invalid', to: '29 Aug' }, { by: 'left', to: '29 Aug' },
  ]) {
    const state = fixture();
    state.LEADS[2].cov = cover;
    state.COVER.outsider = cover;
    assert.equal(selectors.coverLive(state, cover), false);
    assert.equal(selectors.covOf(state, state.LEADS[2]), null);
    assert.equal(selectors.acting(state, state.LEADS[2]), 'outsider');
    assert(!selectors.openable(state).some(l => l.id === 'hidden'));
    assert.equal(selectors.outOf(state, 'outsider'), null);
    assert.equal(selectors.coversOf(state, cover.by), null);
    assert(!render(ActivityPage, state).includes('Own hidden action'));
  }
});
test('live cover is authorized through its end day and ends the following morning', () => {
  const state = fixture();
  state.NOW = new Date(2026, 7, 28, 23, 59);
  const cover = { by: 'owner', from: '28 Aug', to: '28 Aug', why: 'Synthetic cover' };
  state.LEADS[2].cov = cover;
  assert.equal(selectors.coverLive(state, cover), true);
  assert.equal(selectors.acting(state, state.LEADS[2]), 'owner');
  assert(selectors.openable(state).some(l => l.id === 'hidden'));
  assert.equal(selectors.outOf(state, 'outsider'), cover);
  assert.equal(selectors.coversOf(state, 'owner'), state.PEOPLE.outsider.i);
  assert(selectors.activityMonth(state, undefined, month, null).rows.some(e => e.what === 'Own hidden action'));
  state.NOW = new Date(2026, 7, 29);
  assert.equal(selectors.coverLive(state, cover), false);
  assert(!selectors.openable(state).some(l => l.id === 'hidden'));
});
test('external, self-assigned and same-day future cover recipients cannot obtain access', () => {
  const state = fixture();
  state.NOW = new Date(2026, 7, 28, 10, 0);
  state.PEOPLE.peer = { ...state.PEOPLE.peer, ext: 'An external portal' };
  assert.equal(selectors.coverLive(state, { by: 'peer', to: '29 Aug' }, 'outsider'), false);
  assert.equal(selectors.coverLive(state, { by: 'owner', to: '29 Aug' }, 'owner'), false);
  assert.equal(selectors.coverLive(state, { by: 'owner', from: '28 Aug 2026 11:00', to: '29 Aug 2026' }, 'outsider'), false);
  assert.equal(selectors.coverLive(state, { by: 'owner', from: '28 Aug 2026 09:00', to: '29 Aug 2026' }, 'outsider'), true);
});
test('temporary grants require a live window and the lender to retain the lent capabilities', () => {
  const state = fixture();
  state.NOW = new Date(2026, 7, 28, 23, 59);
  state.TEMP = [{ id: 'valid', to: 'owner', by: 'manager', from: '27 Aug 10:00', until: '28 Aug',
    state: 'live', page: 'activity', caps: ['view', 'others'], why: 'Synthetic grant' }];
  const active = store.reducer(state, { type: 'useTemp', id: 'valid' });
  assert.equal(active.TEMPON, 'valid');
  assert.equal(selectors.may(active, 'activity', 'others'), true);
  assert.deepEqual(selectors.activityActors(active), ['owner']);
  for (const mutation of [
    s => { s.CAPS.manager = { activity: ['view'] }; },
    s => { s.PEOPLE.manager = { ...s.PEOPLE.manager, seat: 'mkt' }; },
    s => { s.PEOPLE.manager = { ...s.PEOPLE.manager, on: false }; },
    s => { s.PEOPLE.owner = { ...s.PEOPLE.owner, on: false }; },
    s => { s.TEMP[0] = { ...s.TEMP[0], from: '29 Aug', until: '30 Aug' }; },
    s => { s.TEMP[0] = { ...s.TEMP[0], until: '32 Aug' }; },
    s => { s.TEMP[0] = { ...s.TEMP[0], until: '27 Aug' }; },
  ]) {
    const changed = { ...active, PEOPLE: structuredClone(active.PEOPLE), TEMP: structuredClone(active.TEMP), CAPS: structuredClone(active.CAPS) };
    mutation(changed);
    assert.equal(selectors.tempOn(changed), null);
    assert.equal(selectors.may(changed, 'activity', 'others'), false);
    assert.strictEqual(store.reducer(changed, { type: 'useTemp', id: 'valid' }), changed);
  }
});
test('profile mobile updates do not copy personal values into the shared audit log', () => {
  const state = fixture();
  const next = store.reducer(state, { type: 'setMe', f: 'ph', v: 'Synthetic private value' });
  assert.equal(next.LOG[0].note, 'Mobile updated');
  assert(!next.LOG[0].note.includes('Synthetic private value'));
});
test('branch reporting excludes unrelated investor counts and respects view revocation', () => {
  const state = fixture('manager');
  state.LEADS.forEach(l => { l.fc = { c: 'pipeline', by: '29 Aug', ev: 'Synthetic forecast' }; });
  assert.deepEqual(selectors.numBook(state).map(l => l.id), ['own', 'shared']);
  assert.equal(selectors.fcRoll(state).pipeline.n, 2);
  state.CAPS.manager = { numbers: [] };
  assert.deepEqual(selectors.numBook(state), []);
  assert.equal(selectors.fcRoll(state).pipeline.n, 0);
});

test('read-only and borrowed System views cannot bypass actor privacy', () => {
  const reader = fixture();
  reader.PEOPLE.owner = { ...reader.PEOPLE.owner, seat: 'corp', mgr: null };
  reader.ROLE = 'corp';
  reader.SEC.system = 'log';
  assert(!selectors.systemRows(reader).some(e => e.who === 'peer'));
  assert(!render(SystemPage, reader).includes('Peer shared action'));
  const borrowed = fixture();
  borrowed.PEOPLE.owner.mgr = 'other-manager';
  borrowed.TEMP = [{ id: 'system', to: 'owner', by: 'other-manager', from: '27 Aug 2026', until: '29 Aug 2026',
    state: 'live', page: 'system', caps: ['view', 'edit'], why: 'Synthetic system grant' }];
  borrowed.TEMPON = 'system';
  borrowed.SEC.system = 'log';
  assert.equal(selectors.may(borrowed, 'system', 'edit'), true);
  assert.equal(selectors.own(borrowed, 'system', 'edit'), false);
  assert.deepEqual(selectors.systemActors(borrowed), ['owner']);
  assert(!render(SystemPage, borrowed).includes('Peer shared action'));
  assert(selectors.systemRows(fixture('other-manager')).some(e => e.what === 'Peer shared action'));
});
test('Team audit requires page access and scoped actors or explicit subjects', () => {
  const state = fixture('manager');
  state.LOG = [log('peer', 'Changed access', null, 'admin', 'Scoped peer audit'),
    log('outsider', 'Changed access', null, 'admin', 'Unrelated secret audit'),
    { ...log('outsider', 'Changed access', null, 'admin', 'Scoped subject audit'), about: ['peer'] }];
  assert.deepEqual(selectors.teamAuditRows(state).map(e => e.note), ['Scoped peer audit', 'Scoped subject audit']);
  const html = render(Teams, state, { scope: ['manager', 'owner', 'peer'], sel: null });
  assert(!html.includes('Unrelated secret audit'));
  state.CAPS.manager = { people: [] };
  assert.deepEqual(selectors.teamAuditRows(state), []);
});
test('Updates and feed cannot reveal shared records after record or page access is revoked', () => {
  const state = fixture();
  state.CAPS.owner = { pay: ['view'] };
  state.LOG = [log('peer', 'Receipt confirmed', 'own', 'money', 'Synthetic secret')];
  assert.equal(selectors.feedRows(state).length, 1);
  state.CAPS.owner = { leads: [] };
  assert.deepEqual(selectors.updates(state), []);
  assert.deepEqual(selectors.feedRows(state), []);
  state.CAPS.owner = { updates: [] };
  assert.deepEqual(selectors.updates(state), []);
  assert.deepEqual(selectors.feedRows(state), []);
});
test('grant ledger visibility uses lender, recipient and actual reporting chain', () => {
  const state = fixture('manager');
  state.TEMP = [{ id: 'managed', to: 'peer', by: 'other-manager' }, { id: 'other', to: 'outsider', by: 'other-manager' },
    { id: 'mine', to: 'outsider', by: 'manager' }];
  assert.deepEqual(tSeen(state).map(g => g.id), ['managed', 'mine']);
});
test('loaded and newly written access windows carry years and cannot resurrect a year later', () => {
  const loaded = store.initialState();
  assert(loaded.TEMP.every(g => /2026/.test(g.from) && /2026/.test(g.until)));
  assert(Object.values(loaded.COVER).every(c => /2026/.test(c.to)));
  loaded.NOW = new Date(2027, 7, 28);
  assert(loaded.TEMP.every(g => !selectors.tLive(g, loaded.NOW)));
  assert(Object.values(loaded.COVER).every(c => !selectors.coverLive(loaded, c)));
  const state = fixture('manager');
  state.ui.TGT = { to: 'peer', page: 'activity', caps: ['view', 'others'], dur: 'd1', why: 'Synthetic grant' };
  const next = store.reducer(state, { type: 'grantTemp' });
  assert(/2026/.test(next.TEMP[0].from));
  assert(/2026/.test(next.TEMP[0].until));
  const covered = fixture();
  const handover = store.reducer(covered, { type: 'handover', id: 'shared', perm: false, why: 'today' });
  assert(/2026/.test(handover.LEADS.find(l => l.id === 'shared').cov.from));
  assert(/2026/.test(handover.LEADS.find(l => l.id === 'shared').cov.to));
});
test('year-crossing access windows retain their original expiry year', () => {
  const start = pinAccessDate('31 Dec', new Date(2026, 11, 31));
  const end = pinAccessDate('02 Jan', accessDay(start, new Date(2026, 11, 31)));
  assert.equal(start, '31 Dec 2026');
  assert.equal(end, '02 Jan 2027');
  const state = fixture();
  state.NOW = new Date(2027, 0, 2, 23, 59);
  const cover = { by: 'owner', from: start, to: end };
  assert.equal(selectors.coverLive(state, cover), true);
  state.NOW = new Date(2028, 0, 2);
  assert.equal(selectors.coverLive(state, cover), false);
});
test('departed and external portal identities lose routes, records, Activity and drawers', () => {
  for (const identity of [{ on: false }, { ext: 'An external portal' }]) {
    const state = fixture();
    state.PEOPLE.owner = { ...state.PEOPLE.owner, ...identity };
    assert.equal(selectors.accountAllowed(state), false);
    assert.deepEqual(selectors.navFor(state), []);
    assert.deepEqual(selectors.openable(state), []);
    assert.deepEqual(selectors.activityRows(state), []);
    assert.equal(selectors.canOpenDrawer(state, 'help', null), false);
    assert.equal(selectors.own(state, 'leads', 'edit'), false);
  }
});

/* D38 checks authored sizing contracts and actual templates; these do not claim browser
   measurements. Keep the utility columns compact without dropping history or audit metadata. */
const css = fs.readFileSync(path.join(__dirname, 'src/app/console.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function cssDeclarations(selector) {
  const declarations = {};
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!rule[1].trim().split(',').map(s => s.trim()).includes(selector)) continue;
    for (const declaration of rule[2].split(';')) {
      const colon = declaration.indexOf(':');
      if (colon > 0) declarations[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
    }
  }
  return declarations;
}

test('nested action glyphs retain their utility footprint and label styling stays on direct children', () => {
  assert.deepEqual(cssDeclarations('.stat span'), {});
  assert.deepEqual(cssDeclarations('.agl span'), {});
  assert.equal(cssDeclarations('.stat>span').display, 'block');
  assert.equal(cssDeclarations('.agl>span').display, 'inline-flex');
  const glyph = cssDeclarations('.ag');
  assert.equal(glyph.width, '20px');
  assert.equal(glyph.height, '20px');
  assert.equal(glyph.flex, 'none');
  assert.equal(glyph.display, 'inline-grid');
  /* The redesign's Activity screen (vActivity) carries no glyph legend of its own — actLegend()
     renders inside System's activity log and the Help drawer instead (ir-console-redesigned.html
     10768, 12791), and with no separator between glyph and label (actg(k)+esc(KINDS[k])). */
  const legend = render(drawerDef('help').Body, fixture(), { id: 'system' });
  assert.match(legend, /<span><span class="ag [^"]+"[^>]*>[^<]+<\/span>WhatsApp<\/span>/);
});

test('Activity keeps one filtered record set in a compact toolbar that wraps at pane width, glyph inline with its row', () => {
  /* The redesign drops the old Log/By-person side-by-side `.activity-cols` layout for one surface
     at a time (Log, By person or By day), switched by `.rd-segments` chips — vActivity's own
     comment: "Two stacks have no reading order between them" (ir-console-redesigned.html ~11677).
     The toolbar itself still wraps at pane width, same intent as the old two-column check. */
  const controls = cssDeclarations('body.ux-redesign .rd-activity-compact .rd-activity-controls');
  assert.equal(controls.display, 'flex');
  assert.equal(controls['flex-wrap'], 'wrap');
  const when = cssDeclarations('body.ux-redesign .rd-activity-log .rd-log-when');
  assert.equal(when.width, '156px');
  const html = render(ActivityPage, { ...fixture(), ui: { ACTM: month } });
  assert.match(html, /class="rd-activity-controls"/);
  assert.match(html, /<td class="sm nw">/);
  assert.match(html, /<span class="ag /);
  assert(html.includes('Own action'));
});

test('short and empty Activity and Updates cards keep content height without removing dense-table sizing', () => {
  for (const state of [fixture(), { ...fixture(), LOG: [] }]) {
    const activityHtml = render(ActivityPage, state);
    /* The redesign always compounds `card` with the page's own layout classes (e.g.
       `class="card ux-activity-results"`), never a bare `class="card"` alone, and Activity never
       reaches for the dense-table `.fill` sizing at all. */
    assert(/\bclass="[^"]*\bcard\b[^"]*"/.test(activityHtml));
    assert(!/class="[^"]*\bcard\b[^"\n]*\bfill\b/.test(activityHtml));

    const updatesHtml = render(UpdatesPage, state);
    assert(/\bclass="[^"]*\bcard\b[^"]*"/.test(updatesHtml));
    /* Updates' own groups card is exactly like Activity's — short/empty stays content-sized.
       Update history (vFeed, ir-console-redesigned.html:8495) is a genuine dense table and keeps
       `.card.fill` on purpose, matching DaySide's team table below — but the redesign moved it
       behind a door (`doorRow`, 8487-8488) into `PANELS["updates.feed"]`, so it is no longer part
       of the page's own render; it is exercised directly, as the panel body, below. */
    assert(!/class="[^"]*\bcard\b[^"\n]*\bfill\b/.test(updatesHtml));
    assert(updatesHtml.includes('id="door-updates-feed"'));
    const feedHtml = render(drawerDef('p:updates.feed').Body, state);
    assert(feedHtml.includes('<div class="card fill"'));
  }
  /* The redesign's own `.card.fill{flex:none;min-height:0}` (ir-console-redesigned.html:473) — a
     port-only `min-height:160px` scroll-to-fit override once fought this and was deleted this
     round (console.css's own PORT-ONLY block comment). A dense table's height still comes from its
     rows, not an artificial floor. */
  assert.equal(cssDeclarations('.card.fill')['min-height'], '0');
  assert.match(render(DaySide, fixture('manager'), { team: true }), /class="card fill"/);
  assert.equal(cssDeclarations('.drwb').overflow, 'auto');
  assert.equal(cssDeclarations('.drwb')['min-height'], '0');
});

test('narrow history preserves action, note, actor and time; ordinary footer buttons use label width and wrap', () => {
  const state = fixture();
  const note = 'A long synthetic history note that remains readable in a narrow drawer';
  state.LOG = [log('owner', 'Recorded follow-up', 'own', 'stage', note)];
  const history = render(drawerDef('history').Body, state, { id: 'own', lead: state.LEADS[0] });
  /* Renamed this round to the redesign's own `rd-timeline-*` classes (ir-console-redesigned.html's
     drawer history block) — `.history-*` was a port-only name nothing in the prototype used, and
     console.css's own PORT-ONLY block comment records it as deleted once this rename shipped. */
  assert.match(history, /class="ur rd-timeline-row"><span class="ag /);
  assert.match(history, /class="rd-timeline-text"/);
  assert(history.includes('Recorded follow-up'));
  assert(history.includes(note));
  assert(history.includes('Test'));
  assert.match(history, /class="sm mono rd-timeline-time">10:00<\/span>/);
  assert.match(css, /\.ur\.rd-timeline-row\{[^}]*grid-template-columns:20px minmax\(0,1fr\) max-content;/);
  assert.equal(cssDeclarations('body.ux-redesign .rd-timeline-text')['overflow-wrap'], 'anywhere');
  /* The redesign moved this rule under the always-on `body.ux-redesign` scope rather than the bare
     selector (ir-console-redesigned.html's drawer body styling). */
  assert.equal(cssDeclarations('.ux-redesign .drwb')['container-type'], 'inline-size');
  const narrowHistory = css.match(/@container\(max-width:360px\)\{\s*body\.ux-redesign \.ur\.rd-timeline-row\{([^}]*)\}\s*body\.ux-redesign \.rd-timeline-time\{([^}]*)\}/);
  assert(narrowHistory, 'history must adapt to its drawer body width');
  assert.match(narrowHistory[1], /grid-template-columns:20px minmax\(0,1fr\)/);
  assert(!narrowHistory[1].includes(' auto') && !narrowHistory[1].includes('max-content'), 'narrow history must not reserve an empty timestamp track');
  assert.match(narrowHistory[2], /grid-column:2/);
  /* `.drwf .act{flex:1;text-align:center}` is the prototype's own pre-redesign base rule, copied
     verbatim (ir-console-redesigned.html's own stylesheet carries it too) — not a port artifact to
     purge. The redesign wins on cascade specificity via the scoped child-combinator override
     below, never by deleting the base declaration. */
  assert.deepEqual(cssDeclarations('.drwf .act'), { flex: '1', 'text-align': 'center' });
  /* ir-console-redesigned.html's drawer footer scopes the child-combinator override under the
     always-on `body.ux-redesign` selector, with a 44px (not 34px) touch-height floor. */
  const action = cssDeclarations('body.ux-redesign .drwf>.act');
  assert.equal(action.flex, '0 1 auto');
  assert.equal(action['max-width'], '100%');
  assert.equal(action['min-height'], '44px');
  assert.equal(cssDeclarations('.drwf')['flex-wrap'], 'wrap');
  /* ir-console-redesigned.html:12206's `detailsFoot`-style label — "Save note for <first name>" —
     lit only once something is typed (12213's own note on why an empty box must not be clickable);
     this fixture's lead is unnamed past its "Own" first token and the draft starts empty, so the
     button reads disabled with that same hint. */
  assert.match(render(drawerDef('notes').Foot, state, { id: 'own', lead: state.LEADS[0] }), /class="act"[^>]*>Save note for Own<\/button>/);
});

test('Latest activity fits phone width and wraps descriptions while the wide matrix keeps its scroll contract', () => {
  const state = fixture('manager');
  state.ui.ACTM = month;
  state.LOG = [log('manager', 'A long synthetic activity description', null, 'stage', 'UnbrokenSyntheticNote'.repeat(20))];
  const html = render(ActivityPage, state);
  const latest = html.match(/<table class="rd-activity-log">([\s\S]*?)<\/table>/);
  assert(latest, 'the redesigned rd-activity-log table must be present');
  assert.match(latest[1], /class="rd-log-description"/);
  assert(latest[1].includes('A long synthetic activity description'));
  assert(latest[1].includes('UnbrokenSyntheticNote'.repeat(20)));
  assert(latest[1].includes('28 Aug'));
  assert(latest[1].includes('10:00'));
  assert(latest[1].includes('Manager'));
  /* The redesign wraps a long description inside a fixed-layout column (rd-activity-compact
     .rd-activity-log, table-layout:fixed;min-width:620px) rather than collapsing the table to the
     pane's width — the `.tw` wrapper still gives it the wide matrix's own horizontal scroll on a
     narrow pane, exactly like every other `.tw table`. */
  const fixedTable = cssDeclarations('body.ux-redesign .rd-activity-compact .rd-activity-log');
  assert.equal(fixedTable['table-layout'], 'fixed');
  assert.equal(fixedTable['min-width'], '620px');
  assert.equal(cssDeclarations('body.ux-redesign .rd-activity-compact .rd-log-description>span:last-child')['overflow-wrap'], 'anywhere');
  assert.equal(cssDeclarations('.tw table')['min-width'], '540px');
});

const formatters = require('./src/lib/format.ts');
function withWorkClock(state, run) {
  const previous = formatters.nowT;
  formatters.nowT = () => new Date(state.NOW.getTime());
  try { return run(); }
  finally { formatters.nowT = previous; }
}
function workFixture() {
  const state = fixture();
  state.NOW = new Date(2026, 7, 28, 12);
  state.LEADS[0].at[0] = '24 Aug 10:00';
  state.LEADS[2].by = 'owner';
  state.LEADS[2].at[0] = '25 Aug 10:00';
  const closed = lead('closed', 'Closed synthetic investor', 'owner');
  closed.at[0] = '25 Aug 10:00';
  closed.lost = { by: 'owner', at: '27 Aug 10:00', why: 'Not interested', note: '' };
  state.LEADS.push(closed);
  for (const [id, at] of [['old', '23 Aug 10:00'], ['future', '29 Aug 10:00'], ['invalid', '31 Sep 10:00']]) {
    const extra = lead(id, id + ' synthetic investor', 'owner');
    extra.at[0] = at;
    state.LEADS.push(extra);
  }
  return state;
}

test('weekly IR work counts readable captures including lost and human recording attempts, bounded Monday through the current clock', () => {
  const state = workFixture();
  state.LOG = [log('owner', 'WhatsApp sent', 'own', 'msg'), log('owner', 'WhatsApp sent', 'own', 'msg', 'attempt 2'),
    log('owner', 'Call connected', 'own', 'call'), log('owner', 'Intro email sent', 'own', 'email'),
    log('owner', 'Visit recorded', 'own', 'visit'), log('peer', 'Peer call', 'shared', 'call'),
    log('owner', 'Hidden call', 'hidden', 'call'), log('owner', 'Marked done', 'own', 'stage'),
    { ...log('owner', 'Old call', 'own', 'call'), d: '2026-08-23', at: '23 Aug 10:00' },
    { ...log('owner', 'Future call', 'own', 'call'), d: '2026-08-29', at: '29 Aug 10:00' },
    { ...log('owner', 'Future same-day call', 'own', 'call'), at: '28 Aug 18:00' },
    { ...log('owner', 'Invalid stamp', 'own', 'call'), at: '31 Sep 10:00' }];
  for (const flag of ['auto', 'automated', 'system']) state.LOG.push({ ...log('owner', 'Automatic send', 'own', 'email'), [flag]: true });
  state.LOG.push({ ...log('owner', 'System-origin send', 'own', 'email'), origin: 'system' });
  withWorkClock(state, () => {
    assert.deepEqual(selectors.weeklyWorkSummary(state), { leadsAdded: 2, followups: 5, investorsContacted: 1 });
    assert.deepEqual(selectors.weeklyWorkSummary(state, true), selectors.weeklyWorkSummary(state), 'a forged IR team scope must stay personal');
    assert.equal(selectors.capturedBy(state, 'peer'), 0);
  });
});

test('weekly work honors Today, record and Activity permissions, and manager others stays in the permitted reporting chain', () => {
  const state = workFixture();
  state.LOG = [log('owner', 'Own call', 'own', 'call')];
  withWorkClock(state, () => {
    state.CAPS.owner = { activity: [] };
    assert.deepEqual(selectors.weeklyWorkSummary(state), { leadsAdded: 2, followups: 0, investorsContacted: 0 });
    state.CAPS.owner = { today: [] };
    assert.deepEqual(selectors.weeklyWorkSummary(state), { leadsAdded: 0, followups: 0, investorsContacted: 0 });
    state.CAPS.owner = { leads: [] };
    assert.deepEqual(selectors.weeklyWorkSummary(state), { leadsAdded: 0, followups: 0, investorsContacted: 0 });
  });
  const manager = workFixture();
  manager.WHO = 'manager'; manager.ROLE = 'conv';
  manager.LEADS[1].at[0] = '26 Aug 10:00';
  manager.LOG = [log('manager', 'Manager call', 'own', 'call'), log('owner', 'Owner call', 'own', 'call'),
    log('peer', 'Peer call', 'shared', 'call'), log('outsider', 'Outsider call on shared record', 'own', 'call')];
  withWorkClock(manager, () => {
    assert.equal(selectors.weeklyWorkSummary(manager).followups, 1);
    assert.equal(selectors.weeklyWorkSummary(manager, true).followups, 3);
    manager.CAPS.manager = { activity: ['view'] };
    assert.deepEqual(selectors.weeklyWorkSummary(manager, true), { leadsAdded: 0, followups: 1, investorsContacted: 1 });
  });
});

test('backdated contacts saved today count as follow-ups recorded today without changing original contact details', () => {
  const state = workFixture();
  state.LEADS[0].at[0] = '20 Aug 10:00';
  state.LOG = [];
  state.ui.TD = { k: 'call', d: '2026-08-23', tm: '09:00' };
  withWorkClock(state, () => {
    const next = store.reducer(state, { type: 'saveTouch', id: 'own' });
    assert.equal(next.LOG[0].at, '28 Aug 12:00');
    assert(next.LEADS[0].touch.call.includes('23 Aug 09:00'));
    assert.equal(selectors.weeklyWorkSummary(next).followups, 1);
  });
});

test('personal Today keeps weekly work collapsed below actionable follow-ups and never renders quota arithmetic, even with forged team props', () => {
  const state = workFixture();
  state.LOG = [log('owner', 'Own call', 'own', 'call')];
  withWorkClock(state, () => {
    const html = render(TodayPage, state);
    /* ir-console-redesigned.html:6839 (weekly()) — `class="ux-disclosure rd-weekly"`, not the
       pre-redesign "fld weekly-work". */
    const details = html.match(/<details class="ux-disclosure rd-weekly"([^>]*)>([\s\S]*?)<\/details>/);
    assert(details, 'IR weekly work belongs in its own disclosure');
    assert(!/\bopen\b/.test(details[1]), 'weekly work must start collapsed');
    assert(details[2].includes('<summary>Your week</summary>'));
    assert(details[2].includes('Your work this week'));
    assert(details[2].includes('Leads added'));
    assert(details[2].includes('Follow-ups recorded'));
    assert(details[2].includes('Since Monday. Follow-ups include recorded contact attempts.'));
    assert(details[2].includes('Closest to closing'));
    /* The actionable follow-up queue (or its empty state) is the page's main content and precedes
       the collapsed weekly summary — "Own investor" itself only ever appears inside the weekly
       disclosure's own "Closest to closing" list here, since none of this fixture's leads have a
       next step due today. */
    assert(html.indexOf('rd-work-toolbar') < html.indexOf('class="ux-disclosure rd-weekly"'));
    /* The redesign replaced the prototype's HORIZON week-view jump ("Plan the week") with a
       segmented Due now/All open tab pair (`rd-work-tabs`) — with nothing due now but four
       investors carrying a dated next step, the empty state points at the "All open" tab instead
       of switching the whole page into a calendar view. */
    assert(html.includes('up to date</h2>'));
    assert(html.includes('Your next appointments are ready in All open.'));
    assert(html.includes('View all open investors'));
    for (const forbidden of ['What you owe', 'Short by', 'Stage completions', 'captures stand behind', 'That is not a call list']) assert(!html.includes(forbidden));
    const module = require('./src/lib/selectors/leads.ts');
    const previous = module.quota;
    module.quota = () => { throw new Error('IR rendering must not calculate quota'); };
    try { assert(render(Gap, state, { team: true, onRefuse() {} }).includes('Your work this week')); }
    finally { module.quota = previous; }
    state.LEADS = []; state.LOG = [];
    const empty = render(TodayPage, state);
    assert(empty.includes('Your work this week'));
    assert(empty.includes('No work recorded this week yet. Your follow-ups are above.'));
  });
});

test('IR sidebar drops redundant summaries, retains readable reservation clocks and managers retain oversight', () => {
  const state = workFixture();
  assert.equal(render(DaySide, state, { team: false }), '');
  assert.equal(render(DaySide, state, { team: true }), '', 'forged team cannot restore an IR sidebar');
  state.LEADS[0].done = 6;
  state.PAY.own = { hold: '30 Aug' };
  const clocks = render(DaySide, state, { team: false });
  assert(clocks.includes('Reservation clocks'));
  assert(clocks.includes('Own investor'));
  for (const forbidden of ['First touch outstanding', 'Needs a next step', 'Your book']) assert(!clocks.includes(forbidden));
  state.CAPS.owner = { leads: [] };
  assert(!render(DaySide, state, { team: false }).includes('Own investor'));
  const manager = workFixture(); manager.WHO = 'manager'; manager.ROLE = 'conv';
  withWorkClock(manager, () => {
    const oversight = render(Gap, manager, { team: true, onRefuse() {} });
    assert(oversight.includes('Team weekly progress'));
    assert(oversight.includes('short of the week'));
    /* The redesign moved the per-person breakdown ("Short by") off the weekly card and behind its
       own door, `p:today.owed` (Gap.tsx's "Who is short this week") — the actual place a manager's
       oversight is scoped to their own reporting chain, not the whole org. */
    const owed = render(drawerDef('p:today.owed').Body, manager, {});
    assert(owed.includes('Short by'));
    assert(owed.includes('Test Owner'));
    assert(owed.includes('Test Peer'));
    assert(!owed.includes('Test Outsider'));
    assert(render(DaySide, manager, { team: true }).includes('First touch outstanding'));
  });
});

test('closing shortlists honor revoked record access and personal Today, Horizon and Updates reclaim the removed sidebar width', () => {
  const state = workFixture();
  state.CAPS.owner = { leads: [] };
  assert(!render(Gap, state, { team: false, onRefuse() {} }).includes('Own investor'));
  state.CAPS = {};
  /* This round dropped the two-column `colst personal-work` sidebar entirely, on all three pages —
     `vDayside` only ever renders inside TodayPage's own collapsed "Your week" disclosure now
     (TodayPage.tsx's own header comment), and `Horizon` "draws no side rail of its own" any more
     (Horizon.tsx's own header comment: "See ./TodayPage.tsx's `weekly` for that"). The width that
     column used to reserve is reclaimed by NOT rendering it, not by re-styling it — so the class
     combination is absent from all three pages' own markup. The CSS rule itself stays (checked
     below) for whichever of those files' own comments still cites it. */
  assert(!render(TodayPage, state).includes('colst personal-work'));
  state.ui.HORIZON = 'week';
  assert(!render(Horizon, state, { book: state.LEADS.filter(l => l.id === 'own'), team: true }).includes('colst personal-work'));
  /* Updates dropped the two-column `colst` shape for a single `<section class="ux-updates
     ux-section">` (ir-console-redesigned.html:8449) — `vUpdatesSide` was already dead code, so
     there is no side rail width to reclaim here any more. */
  const updatesHtml = render(UpdatesPage, state);
  assert(updatesHtml.includes('class="ux-updates ux-section"'));
  assert(!updatesHtml.includes('colst personal-work'));
  assert.equal(cssDeclarations('.colst.personal-work').display, 'flex');
  assert.equal(cssDeclarations('.colst.personal-work')['flex-direction'], 'column');
  assert.equal(cssDeclarations('.colst.personal-work').overflow, 'auto');
});

test('Profile is menu-only and business roles retain administration while lead operations are hard read-only', () => {
  for (const seat of ['exec', 'ops', 'bu', 'corp']) {
    const s = fixture(); s.PEOPLE.owner = { ...s.PEOPLE.owner, seat, mgr: null }; s.ROLE = seat;
    s.CAPS.owner = { leads: ['view', 'edit', 'assign'], today: ['view'], add: ['view'] };
    assert.equal(selectors.canOperateLeads(s), false);
    assert.deepEqual(selectors.myCaps(s, 'leads'), ['view']);
    assert.equal(selectors.canAssign(s), false);
    assert(!selectors.navFor(s).some(n => ['today', 'add', 'me'].includes(n.k)));
    assert.equal(selectors.canReach(s, 'me'), true);
    assert.equal(landSafe(s, 'me'), 'me');
    assert.equal(scopedRow(s, { k: 'leads', scoped: true }), false);
    for (const a of [{type:'logTouch',id:'own',k:'call'}, {type:'addNote',id:'own'}, {type:'assign',id:'own',to:'peer'}, {type:'claimPaid',id:'own'}, {type:'addLead'}])
      assert.equal(store.reducer(s, a), s);
    assert(!render(LeadsPage, s).includes('My leads'));
    const bar = render(TopBar, s, {view:'leads'});
    /* The redesigned top bar's account control is an icon button ("Your account"), not inline
       text — the actual profile/menu content is one click away in DRAWERS.account
       (src/components/shell/drawers/account.tsx), which is what "menu-only" refers to. */
    assert(bar.includes('Your account')); assert(!bar.includes('Test Marketing'));
    const accountHtml = render(drawerDef('account').Body, s, {id: null, lead: null});
    assert(accountHtml.includes('ux-account-menu'));
    assert(accountHtml.includes('Profile'));
  }
  const ops = fixture('other-manager');
  assert.equal(selectors.own(ops, 'system', 'edit'), true);
  assert.equal(selectors.own(ops, 'people', 'seats'), true);
  assert.equal(selectors.own(ops, 'goals', 'target'), true);
  const admin = { ...ops, PEOPLE: { ...ops.PEOPLE, owner: {...ops.PEOPLE.owner, mgr:'other-manager'} } };
  const moved = store.reducer(admin, {type:'setMgr',k:'owner',m:null});
  assert.notEqual(moved, admin); assert.equal(moved.PEOPLE.owner.mgr, null);
  const conv = fixture('manager'); assert.equal(selectors.canAssign(conv), true);
});

test('Finance and Marketing are historical identities and cannot become console accounts', () => {
  assert.equal(store.initialState().PEOPLE.gokul.on,false);
  for (const seat of ['fin','mkt']) {
    const s = fixture(); s.PEOPLE.portal = person('Historical portal actor', seat,'manager');
    assert.equal(store.reducer(s,{type:'setPerson',k:'portal'}),s);
    const forged = {...s,WHO:'portal',ROLE:seat};
    assert.equal(selectors.accountAllowed(forged),false); assert.deepEqual(selectors.navFor(forged),[]);
    assert.equal(store.reducer(forged,{type:'setMyStyle',c:4,sq:true}),forged);
    assert(!selectors.membersOf(s.PEOPLE,'manager').includes('portal'));
    assert(!selectors.teamOf(s.PEOPLE,'manager').includes('portal'));
    assert(!selectors.myTeam({...s,WHO:'other-manager',ROLE:'ops'}).includes('portal'));
    assert(!selectors.teamsList(s.PEOPLE).some(t=>t.mgr==='portal'||t.members.includes('portal')));
    assert(selectors.teamOfAll(s.PEOPLE,'manager').includes('portal'));
  }
  // ir-console-redesigned.html:3064 — canGrant(seat) only asks `SEAT[seat]` exists, `people.seats`
  // is held, and the seat's pages sit inside the granter's own reach. Marketing has no SEAT entry
  // at all, so it can never be granted; Finance's seat exists and its pages sit inside Digital
  // Infrastructure's reach, so an ops account with people.seats CAN appoint someone to it — Finance
  // simply never gets a console login (consoleAccount above still refuses seat 'fin').
  assert.equal(selectors.canGrant(fixture('other-manager'),'mkt'),false);
  assert.equal(selectors.canGrant(fixture('other-manager'),'fin'),true);
});

test('Business sensitive console pages need explicit view permission or a lender-held loan inside the manager ceiling', () => {
  for (const seat of ['exec','bu','corp']) {
    const s=fixture();s.PEOPLE.owner={...s.PEOPLE.owner,seat,mgr:null};s.ROLE=seat;
    assert.equal(selectors.may(s,'pay','view'),false);assert.equal(selectors.may(s,'docs','view'),false);
    s.CAPS.owner={pay:['view','record'],docs:['view','send']};
    assert.equal(selectors.may(s,'pay','view'),true);assert.equal(selectors.may(s,'docs','view'),true);
    assert.equal(selectors.may(s,'pay','record'),false);assert.equal(selectors.may(s,'docs','send'),false);
  }
  const s=fixture(); s.PEOPLE.owner={...s.PEOPLE.owner,seat:'conv',mgr:'other-manager'};s.ROLE='conv';
  s.TEMP=[{id:'sensitive',to:'owner',by:'other-manager',page:'pay',caps:['view'],from:'27 Aug 2026',until:'29 Aug 2026',state:'live'}];s.TEMPON='sensitive';
  assert.equal(selectors.may(s,'pay','view'),true);
  s.CAPS['other-manager']={pay:[]};assert.equal(selectors.tempOn(s),null);
  delete s.CAPS['other-manager'];s.PEOPLE.owner.mgr='marketing';assert.equal(selectors.tempOn(s),null);
  const blocked=fixture();blocked.TEMP=[{...s.TEMP[0],page:'system'}];blocked.TEMPON='sensitive';
  assert.equal(selectors.tempOn(blocked),null);
});

test('Channel partners operate only their assigned leads and attribution survives reassignment without granting access', () => {
  const s=fixture();s.PEOPLE.owner.seat='cp';s.ROLE='cp';
  s.LEADS.push(lead('unassigned','Unassigned investor',null));
  s.LEADS.find(l=>l.id==='hidden').channelPartnerId='owner';
  s.COVER.outsider={by:'owner',from:'27 Aug 2026',to:'29 Aug 2026'};
  s.CAPS.owner={leads:['view','edit','assign'],activity:['view','others'],people:['view','seats'],pay:['view']};
  assert.deepEqual(selectors.openable(s).map(l=>l.id),['own']);
  assert.deepEqual(selectors.myWork(s).map(l=>l.id),['own']);assert.deepEqual(selectors.unassigned(s),[]);
  assert.equal(selectors.seesTeam(s),false);assert.equal(selectors.canAssign(s),false);
  assert.equal(selectors.may(s,'activity','others'),false);assert.equal(selectors.may(s,'people','seats'),false);
  assert.equal(selectors.canEdit(s,s.LEADS[0]),true);assert.equal(selectors.canSee(s,s.LEADS[0]),true);
  assert.equal(selectors.stepOwner(s,3,s.LEADS[0]),true);
  assert.equal(store.reducer(s,{type:'assign',id:'unassigned',to:'owner'}),s);
  s.TEMP=[{id:'cp-loan',to:'owner',by:'other-manager',page:'pay',caps:['view'],from:'27 Aug 2026',until:'29 Aug 2026',state:'live'}];s.TEMPON='cp-loan';
  assert.equal(selectors.tempOn(s),null);
  s.ui={...s.ui,ADDN:'Partner capture',ADDPH:'+91 90000 12345',ADDCITY:'Test city',ADDOWN:'outsider',ADDSRC:'Referral',ADDCP:'peer',ADDCON:{call:true,msg:false,email:false},ADDHOW:'call',ADDU:'1'};
  const saved=store.reducer(s,{type:'addLead'}),l=saved.LEADS[0];assert.notEqual(saved,s);
  assert.equal(l.own,'owner');assert.equal(l.sec,null);assert.equal(l.src,'Channel partner');assert.equal(l.channelPartnerId,'owner');
  const manager=store.reducer(saved,{type:'setPerson',k:'manager'});
  const reassigned=store.reducer(manager,{type:'reassignTo',id:l.id,to:'peer',why:'Territory correction'});
  assert.equal(reassigned.LEADS.find(x=>x.id===l.id).own,'peer');
  assert.equal(reassigned.LEADS.find(x=>x.id===l.id).channelPartnerId,'owner');
  const partner=store.reducer(reassigned,{type:'setPerson',k:'owner'});
  assert(!selectors.openable(partner).some(x=>x.id===l.id));
  assert.equal(selectors.sourceLabel(manager,l),'Channel partner · Test Owner');
  assert(!render(Gap,partner,{team:true}).includes('Where the number comes from'));
  assert(!render(DaySide,partner,{team:true}).includes('Your book'));
  assert.equal(store.reducer(manager,{type:'reassignTo',id:'hidden',to:'peer',why:'Territory correction'}),manager);
  assert.equal(store.reducer(s,{type:'addNote',id:'shared'}),s);
});

test('Local writer queues offline business changes without applying or clearing the draft, then acknowledges one real reducer execution', () => {
  const f=writerFixture();const draftState={...f.state(),ui:{...f.state().ui,NDRAFT:'Private note'}};f.change(draftState);
  const action={type:'addNote',id:'own'};const queued=f.writer.apply(action);
  assert.equal(queued.status,'pending');assert.equal(f.state(),draftState);assert.equal(f.reductions(),0);
  assert.equal(f.writer.apply(action).accepted,false);assert.equal(f.writer.snapshot().length,1);
  assert(!JSON.stringify(f.writer.snapshot()).includes('Private note'));
  action.id='hidden';f.online();f.writer.reconnect();
  assert.equal(f.reductions(),1);assert.equal(f.state().NOTES.own[0].t,'Private note');assert.equal(f.state().NOTES.hidden,undefined);
  assert.equal(f.state().ui.NDRAFT,'');assert.deepEqual(f.writer.snapshot(),[]);
});

test('Local pending saves expire after five minutes and require a manual retry rather than reconnecting automatically', () => {
  const f=writerFixture();f.change({...f.state(),ui:{...f.state().ui,NDRAFT:'Retry note'}});
  const queued=f.writer.apply({type:'addNote',id:'own'});f.advance(300000);f.writer.expire();
  assert.equal(f.writer.snapshot()[0].status,'failed');assert.equal(f.state().ui.NDRAFT,'Retry note');
  f.online();f.writer.reconnect();assert.equal(f.reductions(),0);
  assert.equal(f.writer.retry(queued.key).status,'completed');assert.equal(f.reductions(),1);
});

test('Queued saves cannot replay after changed account, revoked access, changed investor or changed form context', () => {
  for(const alter of ['account','caps','target','draft','drawer']) {
    const f=writerFixture();f.change({...f.state(),ui:{...f.state().ui,NDRAFT:'Original note'},DRW:{k:'notes',id:'own'}});
    f.writer.apply({type:'addNote',id:'own'});
    if(alter==='account') f.writer.apply({type:'setPerson',k:'peer'});
    if(alter==='caps') f.change({...f.state(),CAPS:{owner:{leads:[]}}});
    if(alter==='target') f.change({...f.state(),LEADS:f.state().LEADS.map(l=>l.id==='own'?{...l,own:'peer'}:l)});
    if(alter==='draft') f.writer.apply({type:'setUi',patch:{NDRAFT:'New draft'}});
    if(alter==='drawer') f.writer.apply({type:'openDrawer',k:'notes',id:'shared'});
    f.online();f.writer.reconnect();assert.equal(f.state().NOTES.own,undefined);
    assert.equal(f.writer.snapshot().length,alter==='account'?0:1);
  }
});

test('Local save status is honest about browser connection and UI-only reducer effects never acknowledge a business write', () => {
  const s=fixture();const html=render(TopBar,s,{view:'activity'});
  assert(html.includes('Local demo'));assert(html.includes('Demo fixtures · no live source connected'));
  assert(!html.includes('Server synced'));assert(!html.includes('uptime'));
  let state=s;const writer=createConsoleWriter({clock:()=>0,setTimer:()=>0,clearTimer(){},isOnline:()=>true,
    currentSession:()=>({actor:'owner',session:0}),read:()=>state,write:next=>{state=next;},
    reduce:(st)=>({...st,ui:{...st.ui,NXASK:'own'}}),leadWrites:store.LEAD_WRITES});
  assert.equal(writer.apply({type:'tick',id:'own'}).status,'failed');
});

test('Payment and document permission applies to embedded histories, references, account doors and collections metrics', () => {
  const { PlanPage }=require('./src/features/goals/PlanPage.tsx');
  for(const seat of ['exec','bu','corp']) {
    const s=fixture();s.PEOPLE.owner={...s.PEOPLE.owner,seat,mgr:null};s.ROLE=seat;
    const monetary=log('owner','Receipt confirmed','own','money','Secret receipt details');
    const document=log('owner','Filed signed document','own','doc','https://example.invalid/private-contract.pdf');
    s.LOG=[monetary,document,log('owner','Stage completed','own','stage','Stage fact')];
    s.PAY.own={state:'part',got:987654321,mode:'Secret mode',utr:'Secret bank reference',hold:'29 Aug',at:'28 Aug 10:00'};
    s.ACCT.own={code:'Secret account code'};
    s.DOCS=[{lead:'own',t:'Secret executed document',cls:'Secret class',state:'signed',ref:'Secret file reference'}];
    s.CLAIM.own={kind:'advance',mode:'Secret claim mode',ref:'Secret claim reference',by:'owner',at:'28 Aug 10:00',state:'waiting',note:'Secret claim note'};
    s.PLAN={...s.PLAN,periods:s.PLAN.periods.map(p=>({...p,coll:123456789}))};
    assert.equal(selectors.seeMoney(s),false);assert.deepEqual(selectors.activityRows(s).map(e=>e.kind),['stage']);
    assert.equal(selectors.claimBlock(s,s.LEADS[0]),null);
    for(const kind of ['money','acct','claim','paper']) assert.equal(selectors.canOpenDrawer(s,kind,'own'),false);
    const doors=selectors.leadDoors(s,s.LEADS[0],4);assert(!doors.some(d=>['money','acct','claim','paper'].includes(d.k)));
    for(const Component of [ActivityPage,LeadPage,drawerDef('history').Body,PayPage,DocsPage]) {
      const html=render(Component,s,{id:'own',lead:s.LEADS[0]});
      for(const secret of ['Secret receipt details','private-contract.pdf','Secret bank reference','Secret account code','Secret executed document','Secret claim mode','Secret claim reference','Secret claim note']) assert(!html.includes(secret));
    }
    assert(!render(PlanPage,s).includes('value="12.35"'));
    assert.equal(monetary.note,'Secret receipt details');assert.equal(document.note,'https://example.invalid/private-contract.pdf');
    s.CAPS.owner={pay:['view','record'],docs:['view','send']};
    assert.equal(selectors.seeMoney(s),true);assert.deepEqual(selectors.activityRows(s).map(e=>e.kind),['money','doc','stage']);
    /* D42/Rule 7: "covered by default" now applies to every reader, not only IR/conv — a bank
       reference on /pay prints masked (last four only) until THIS session explicitly asks to see
       it, and asking is itself logged. Granting the capability alone must never spell out the raw
       value; the explicit `showRef` reveal is what does, and only for the record it names. */
    const payHtml=render(PayPage,s);
    assert(!payHtml.includes('Secret bank reference'));assert(payHtml.includes('••• ence'));
    assert(render(DocsPage,s).includes('Secret executed document'));
    assert.equal(selectors.may(s,'pay','record'),false);assert.equal(selectors.may(s,'docs','send'),false);assert.equal(selectors.isFin(seat),false);
    const revealed=store.reducer(s,{type:'showRef',k:'pay:own',id:'own',where:'Payments'});
    assert.equal(revealed.REFSEEN['pay:own'],'owner');
    assert(revealed.LOG[0].what.includes('Revealed a bank reference'));
    assert(render(PayPage,revealed).includes('Secret bank reference'));
    assert.equal(store.reducer(revealed,{type:'hideRef',k:'pay:own'}).REFSEEN['pay:own'],undefined);
  }
});

test('Pending own-profile saves retain their input and reject completion after a newer draft is typed', () => {
  const f=writerFixture(); f.writer.apply({type:'setUi',patch:{ME_DRAFT:{ph:'New private mobile'}}});
  const original=f.state().PEOPLE.owner.ph; f.writer.apply({type:'setMe',f:'ph',v:'New private mobile'});
  assert.equal(f.state().PEOPLE.owner.ph,original);assert.equal(f.state().ui.ME_DRAFT.ph,'New private mobile');
  f.writer.apply({type:'setUi',patch:{ME_DRAFT:{ph:'A newer unsaved mobile'}}});f.online();f.writer.reconnect();
  assert.equal(f.state().PEOPLE.owner.ph,original);assert.equal(f.writer.snapshot()[0].status,'failed');
});

test('IR Finance defaults are held-record reads, including assigned secondary and live cover, never unassigned or source-only records', () => {
  const s=fixture();
  s.LEADS.push(lead('unassigned','Unassigned confidential investor',null,'owner'));
  s.LEADS[2].channelPartnerId='owner';
  for(const page of ['pay','docs']) {
    assert.equal(selectors.may(s,page,'view'),true);
    assert.deepEqual(selectors.financeBook(s,page).map(l=>l.id),['own','shared']);
    assert.equal(selectors.canReadFinance(s,s.LEADS[2],page),false);
    assert.equal(selectors.canReadFinance(s,{...s.LEADS[2],own:'owner'},page),false);
    assert.equal(selectors.canReadFinance(s,s.LEADS[3],page),false);
    assert.deepEqual(selectors.financeBook({...s,ROLE:'ops',SC:{...s.SC,leads:'team'}},page).map(l=>l.id),['own','shared']);
  }
  assert.equal(selectors.canEdit(s,s.LEADS[1]),true); // Valid current leave activates the secondary's cover work.
  assert.equal(selectors.seeMoney(s),false);assert.equal(selectors.seeMoney(s,s.LEADS[0]),true);
  s.COVER.outsider={by:'owner',from:'27 Aug 2026',to:'29 Aug 2026'};
  assert.equal(selectors.canReadFinance(s,s.LEADS[2],'pay'),true);
  s.NOW=new Date(2026,7,30);assert.equal(selectors.canReadFinance(s,s.LEADS[2],'pay'),false);
  const cp={...s,PEOPLE:{...s.PEOPLE,owner:{...s.PEOPLE.owner,seat:'cp'}},ROLE:'cp',CAPS:{owner:{pay:['view'],docs:['view']}}};
  assert.deepEqual(selectors.financeBook(cp,'pay'),[]);assert.deepEqual(selectors.financeBook(cp,'docs'),[]);
});

test('Held lost and closed Finance history remains readable, and permission revocation or identity changes invalidate its pages and drawers', () => {
  const s=fixture();s.LEADS[0].lost={why:'Test loss'};s.LEADS[1].done=99;
  for(const page of ['pay','docs']) assert.deepEqual(selectors.financeBook(s,page).map(l=>l.id),['own','shared']);
  for(const kind of ['money','paper','acct']) assert.equal(selectors.canOpenDrawer(s,kind,'shared'),true);
  s.PAY.own={state:'full',got:2500000,mode:'NEFT',utr:'Hidden UTR',on:'28 Aug',hold:null};
  s.CAPS.owner={pay:[],docs:[]};
  for(const kind of ['money','paper','acct']) {
    assert.equal(selectors.canOpenDrawer(s,kind,'own'),false);
    assert(!render(drawerDef(kind).Body,s,{id:'own',lead:s.LEADS[0]}).includes('Hidden UTR'));
  }
  s.CAPS.owner={leads:[]};
  assert.deepEqual(selectors.financeBook(s,'pay'),[]);assert.deepEqual(selectors.financeBook(s,'docs'),[]);
  delete s.CAPS.owner;s.PEOPLE.owner.on=false;assert.deepEqual(selectors.financeBook(s,'pay'),[]);
});

function linkedMirrorFixture() {
  const s=fixture();s.LEADS=[lead('L6','Held linked investor','owner'),lead('L7','Secondary linked investor','peer','owner'),lead('L13','Hidden linked investor','outsider')];
  s.PAY={L6:{state:'full',got:1,mode:'Stale mode',utr:'Stale UTR',on:'Stale date',hold:null}};
  s.DOCS=[{lead:'L6',t:'Stale invented document',cls:'Agreement',state:'signed',on:'Invented completion',ref:'Stale signature'}];
  s.PAPER={L6:{nda:{sent:{by:'owner',at:'Invented ladder timestamp'},ok:{by:'owner',at:'Invented verification timestamp'}}}};
  s.LOG=[log('owner','Old sensitive event','L6','money','Superseded bank UTR never in latest PAY'),log('peer','Finance event','L7','doc','Old private signature reference')];
  return s;
}

test('Explicit Finance source links win over stale summaries and synthetic ladder stamps, with stable receipt and document IDs and original dates', () => {
  const s=linkedMirrorFixture(), source=require('./src/domain/finance-mirror-demo.json');
  const original=JSON.stringify(source), l=s.LEADS[0];
  const payments=selectors.financePaymentHistory(s,l), documents=selectors.financeDocuments(s,l), p=selectors.financePaySummary(s,l);
  assert.equal(payments[0].id,'T-0029');assert.equal(payments[0].on,'24 Aug 11:06');assert.equal(payments[0].recordedByName,'Meena Raghavan');
  assert.equal(payments[0].amount,250000);assert.equal(payments[0].reference,'••• 8551');
  /* finance-mirror-demo.json's L6.holdEnds matches the prototype's own FINANCEMIRROR0 ('23 Sep'),
     never payments.ts's unrelated legacy PAY0.L6.hold — L6 has an explicit Finance source link, so
     that legacy fallback is never read for it at all. */
  assert.equal(p.got,250000);assert.equal(p.hold,'23 Sep');assert.equal(selectors.financeAccountId(s,l),'ARL-INV-0208');
  assert.equal(documents.length,3);assert(documents.some(d=>d.id==='D-037'&&d.sentOn==='12 Aug 17:00'&&d.completedOn==='24 Aug 11:06'));
  assert(documents.every(d=>d.signatureReference==='Finance only'));
  assert.equal(JSON.stringify(source),original);assert.deepEqual(selectors.financeDocuments(s,s.LEADS[2]),[]);
  for(const [kind,needles] of [['money',['T-0029','24 Aug 11:06','Meena Raghavan']],['paper',['D-037','12 Aug 17:00','24 Aug 11:06']],['acct',['ARL-INV-0208']]]) {
    const html=render(drawerDef(kind).Body,s,{id:l.id,lead:l});
    for(const needle of needles) assert(html.includes(needle));
    for(const stale of ['Stale UTR','Stale invented document','Invented ladder timestamp','Invented verification timestamp','HDFC2608551','EMU-2608-77120']) assert(!html.includes(stale));
    assert(html.includes('Local demo records'));assert(!/<input|<textarea|<select|type="file"/.test(html));
  }
});

test('IR payment and document pages expose only held source records and masked identifiers, with no org inventory or source editor', () => {
  const s=linkedMirrorFixture();
  const pay=render(PayPage,s), docs=render(DocsPage,s);
  for(const html of [pay,docs]) {
    assert(html.includes('Held linked investor'));assert(html.includes('Secondary linked investor'));
    assert(!html.includes('Hidden linked investor'));assert(!html.includes('ARL-INV-0210'));
    assert(!html.includes('HDFC2608551'));assert(!html.includes('EMIR2608119'));
    /* The redesigned Documents register (prototype vDocs, ~9051) carries no signature-reference
       column at all — only Pay's masked bank reference is shown on its own page. */
    if (html === pay) assert(html.includes('••• 8551'));
    assert(!html.includes('Record a payment'));assert(!html.includes('Send a document'));assert(html.includes('live portal sync is not connected'));
  }
  assert(!pay.includes('Sellable inventory'));assert(!pay.includes('Allocated'));assert(docs.includes('D-041'));assert(docs.includes('26 Aug 16:20'));
  const hiddenHtml=render(drawerDef('paper').Body,s,{id:'L13',lead:s.LEADS[2]});assert(!hiddenHtml.includes('D-035'));
  const hiddenDoors=selectors.leadDoors(s,s.LEADS[2],4);assert(!hiddenDoors.some(d=>['money','paper','acct','claim'].includes(d.k)));
});

test('Finance read defaults do not restore any paper, receipt, document send or account source mutation, including queued replay', () => {
  const actions=[{type:'prDraft',link:'https://example.invalid/draft'},{type:'prRedraft',link:'https://example.invalid/draft'},
    {type:'prAgreed',link:'https://example.invalid/agreed'},{type:'prSend',rk:'nda'},{type:'prTold',rk:'nda',ch:'msg'},
    {type:'prChase',rk:'nda',ch:'msg',phase:'sign'},{type:'prSaid',rk:'nda'},{type:'prVerify',rk:'nda'},
    {type:'prBounce',rk:'nda',why:'Not found'},{type:'prGate',rk:'nda',beat:'sent'},
    {type:'record',kind:'full'},{type:'recordDoc',t:'Advance receipt'},{type:'sendDoc'},
    {type:'acctAuto'},{type:'acctLapsed'},{type:'xferAuto'}];
  for(const seat of ['ir','conv','ops']) {
    const s=fixture();s.PEOPLE.owner={...s.PEOPLE.owner,seat,mgr:null};s.ROLE=seat;s.LEADS[0].done=12;
    s.CAPS.owner={leads:['view','edit','assign'],pay:['view','record'],docs:['view','send']};
    assert.equal(selectors.prIR(s,s.LEADS[0]),false);assert.equal(selectors.prMine(s,s.LEADS[0],'IR'),false);
    for(const action of actions) assert.equal(store.reducer(s,{...action,id:'own'}),s,`${seat} ${action.type}`);
  }
  const f=writerFixture();f.writer.apply({type:'prDraft',id:'own',link:'https://example.invalid/queued'});
  f.online();f.writer.reconnect();assert.equal(f.writer.snapshot()[0].status,'failed');assert.deepEqual(f.state().PAPER,{});
  const touched=store.reducer(f.state(),{type:'logTouch',id:'own',k:'msg'});assert.notEqual(touched,f.state());
});

test('IR audit consumers omit superseded Finance notes and sensitive peer events, while a mirror claim block has no embedded report controls', () => {
  const s=fixture();s.LEADS.push(lead('unassigned','Confidential unassigned',null));
  s.LOG=[log('owner','Own Finance fact','own','money','Historical UTR not in current PAY'),log('owner','Shared Finance fact','shared','doc','Historical private file link'),
    log('owner','Hidden Finance fact','hidden','money','Hidden old UTR'),log('owner','Unassigned Finance fact','unassigned','doc','Hidden unassigned signature')];
  assert.deepEqual(selectors.activityRows(s).map(e=>e.what),['Own Finance fact','Shared Finance fact']);
  for(const e of s.LOG) assert.equal(selectors.logNote(s,e),'');
  assert.equal(s.LOG[0].note,'Historical UTR not in current PAY');
  const e=log('peer','Other actor Finance fact','own','money','Other actor detail');s.LOG.push(e);assert(!selectors.activityRows(s).includes(e));
  s.CLAIM.own={id:'PR-own-1',by:'owner',at:'28 Aug 10:00',kind:'advance',mode:'NEFT',ref:'Reported reference',
    amount:100000,said_on:'2026-08-27',heldBefore:0,note:'Reported fact',state:'notfound',why:'Not banked',did:'peer',on:'28 Aug 11:00',
    history:[{type:'reported',by:'owner',at:'28 Aug 10:00',note:'Payment report sent to Finance'}]};
  assert.equal(selectors.claimBlock(s,s.LEADS[0]).reopenable,true);assert.equal(selectors.claimBlock(s,s.LEADS[0],false).reopenable,false);
  /* D42: a payment report is a different fact than a confirmed receipt, so the money "mirror"
     drawer never embeds ClaimBlock or its reopen control any more — that lives only on the claim
     drawer, and even there the reference prints through refTxt/maskRef, never raw. */
  const html=render(drawerDef('money').Body,s,{id:'own',lead:s.LEADS[0]});
  assert(!html.includes('Reported reference'));assert(!html.includes('Ask Finance to look again'));
  assert(!html.includes('Historical UTR not in current PAY'));
  const claim=render(drawerDef('claim').Body,s,{id:'own',lead:s.LEADS[0]});
  assert(!claim.includes('Reported reference'));assert(claim.includes('••• ence'));
  assert(render(drawerDef('claim').Foot,s,{id:'own',lead:s.LEADS[0]}).includes('Ask Finance to look again'));
});

test('Legacy mirror fallback never invents receipts or signed-document sent dates, and maps actual confirmation metadata without exposing raw source notes', () => {
  const s=fixture(), l=s.LEADS[0];
  s.PAY.own={state:'part',got:250000,mode:'NEFT',utr:'LEGACY-12345678',on:'28 Aug',hold:'28 Sep'};
  assert.deepEqual(selectors.financePaymentHistory(s,l),[]);assert.equal(selectors.financePaySummary(s,l).got,250000);
  assert(render(drawerDef('money').Body,s,{id:l.id,lead:l}).includes('Individual receipt history has not been supplied by Finance'));
  s.PAY.own.receipts=[{id:'TX-real',amount:250000,paidOn:'27 Aug 12:00',kind:'advance',mode:'NEFT',ref:'LEGACY-12345678',confirmedBy:'peer',confirmedAt:'28 Aug 09:00'}];
  const receipt=selectors.financePaymentHistory(s,l)[0];
  assert.equal(receipt.id,'TX-real');assert.equal(receipt.on,'27 Aug 12:00');assert.equal(receipt.confirmedOn,'28 Aug 09:00');
  assert.equal(receipt.recordedByName,'Test Peer');assert.equal(receipt.reference,'••• 5678');assert.equal(selectors.financePaySummary(s,l).receipts,undefined);
  s.DOCS=[{lead:'own',t:'Legacy signed document',cls:'Commercial',state:'signed',on:'28 Aug 15:00',how:'Wet signature',ref:'PRIVATE-EXECUTED'}];
  assert.equal(selectors.financeDocuments(s,l)[0].sentOn,null);assert.equal(selectors.financeDocuments(s,l)[0].completedOn,'28 Aug 15:00');
  Object.assign(s.DOCS[0],{id:'D-real',sent:'25 Aug 10:00',completedOn:'28 Aug 16:00',verifiedBy:'peer',reason:'Private historical bank reference'});
  const doc=selectors.financeDocuments(s,l)[0];assert.equal(doc.id,'D-real');assert.equal(doc.sentOn,'25 Aug 10:00');
  assert.equal(doc.completedOn,'28 Aug 16:00');assert.equal(doc.verifiedByName,'Test Peer');assert.equal(doc.reason,null);
  const source=linkedMirrorFixture();assert.equal(selectors.financePaymentHistory(source,source.LEADS[1])[0].note,null);
  s.ACCT.own={code:'ARL-INV-9999'};s.CAPS.owner={pay:[],docs:['view']};
  assert.equal(selectors.canOpenDrawer(s,'acct','own'),true);
  const accountHtml=render(drawerDef('acct').Body,s,{id:l.id,lead:l});assert(accountHtml.includes('ARL-INV-9999'));
  assert(accountHtml.includes('Finance documents'));assert(!accountHtml.includes('Receipt and payment history'));
});

test('The newly reachable investor report form and its reported-facts view stay access-gated and never leak a masked reference or another investor\'s report', () => {
  const s=fixture(), l=s.LEADS[0], Body=drawerDef('claim').Body, Foot=drawerDef('claim').Foot;
  assert.equal(selectors.canOpenDrawer(s,'claim',l.id),true);
  /* The payment-report redesign made "Report an investor payment"/"Tell Finance" reachable this
     round (ClaimForm/ClaimFoot, src/features/lead/drawers/finance.tsx) — with no report yet on
     file, the IR now sees the report FORM itself, never a stale "nothing recorded" placeholder,
     and the form carries no server-side secret to leak (it is the person's own fresh draft). */
  const empty=render(Body,s,{id:l.id,lead:l});
  assert(empty.includes('Record exactly what the investor reported.'));
  assert(!empty.includes('Read only'));
  for(const state of ['waiting','confirmed','notfound']) {
    s.CLAIM.own={id:'PR-own-1',by:'owner',at:'28 Aug 10:00',kind:'advance',mode:'NEFT',ref:'Investor reported reference',
      amount:100000,said_on:'2026-08-27',heldBefore:0,note:'Investor reported detail',state,did:'peer',on:'28 Aug 11:00',why:'Not yet banked',
      history:[{type:'reported',by:'owner',at:'28 Aug 10:00',note:'Payment report sent to Finance'}]};
    const html=render(Body,s,{id:l.id,lead:l});
    /* D42: the reference always prints masked (refTxt/maskRef), never the raw value the investor
       gave over the phone — and once a report is filed it is read-only, so its own body carries no
       inline editor (only Finance's per-state action, "Ask Finance to look again", lives on the
       Foot below, gated separately). */
    assert(!html.includes('Investor reported reference'));assert(html.includes('••• ence'));
    assert(html.includes('Investor reported detail'));
    /* DRAWERS.claim's body is `claimBlock(l,false)` plus one paragraph, word for word
       (ir-console-redesigned.html:12417-12419) — no invented leading "Read only" note. */
    assert(!html.includes('Read only'));
    assert(html.includes('Finance records the bank receipt in the'));
    assert(!/<input|<textarea|<select/.test(html));
    assert(!html.includes('Confirm and record it'));assert(!html.includes('Ask Finance to look again'));
  }
  assert(render(Foot,s,{id:l.id,lead:l}).includes('Ask Finance to look again'));
  assert.equal(selectors.canOpenDrawer(s,'claim','hidden'),false);
  assert(!render(Body,s,{id:'hidden',lead:s.LEADS[2]}).includes('Investor reported reference'));
  s.CAPS.owner={pay:[]};assert.equal(selectors.canOpenDrawer(s,'claim',l.id),false);
  assert(!render(Body,s,{id:l.id,lead:l}).includes('Investor reported detail'));
});

const copies = require('./src/lib/investor-copy.ts');
const copySource = require('./src/domain/finance-mirror-demo.json');
function cloneCopyState(state) {const {GOALS,...data}=state;return {...structuredClone(data),GOALS};}
function copyFixture(who='sahil') {
  const s=cloneCopyState(store.initialState());s.WHO=who;s.ROLE=s.PEOPLE[who].seat;
  if(who==='rohit')s.AVAIL.kavya={why:'On leave',from:'2026-08-27',to:'2026-08-29',by:'jhalak',at:'27 Aug'};
  s.INVESTORCOPY={};return s;
}
const copyLead=s=>s.LEADS.find(l=>l.id==='L6');
function copyWriter() {
  let state=copyFixture(),online=false,session=0,reductions=0;
  const writer=createConsoleWriter({clock:()=>0,setTimer:()=>0,clearTimer(){},isOnline:()=>online,
    currentSession:()=>({actor:state.WHO,session}),read:()=>state,
    write:next=>{if(next.WHO!==state.WHO)session++;state=next;},
    reduce:(s,a)=>{reductions++;return store.reducer(s,a);},leadWrites:store.LEAD_WRITES});
  return {writer,state:()=>state,change:next=>{state=next;},online:()=>{online=true;},reductions:()=>reductions};
}

test('Trusted source copy eligibility identifies the three existing accounts and actual signed-document and receipt evidence, without requiring FEMA completion',()=>{
  const s=copyFixture(), expected={L6:['ARL-INV-0208','T-0029',['D-036','D-037']],L7:['ARL-INV-0209','T-0030',['D-039','D-040']],L13:['ARL-INV-0210','T-0031',['D-034','D-035b']]};
  for(const [id,[account,receipt,docs]] of Object.entries(expected)) {
    const e=copies.investorCopyEligibility(s,s.LEADS.find(l=>l.id===id));
    assert.equal(e.eligible,true,id);assert.equal(e.accountId,account);assert.deepEqual(e.receiptIds,[receipt]);assert.deepEqual(e.documentIds.sort(),docs);
    assert(e.confirmed>=e.requiredAdvance);
  }
  assert(copySource.accounts.find(a=>a.leadId==='L7').documents.some(d=>d.title==='FEMA declaration'&&d.state==='awaiting'));
  const initialized=store.initialState();assert.deepEqual(Object.keys(initialized.INVESTORCOPY).sort(),['L13','L6','L7']);
});

test('Local copy never qualifies from claims, aggregate money, fabricated paper, malformed units or an ambiguous source link',()=>{
  const s=copyFixture(),l=copyLead(s);s.CLAIM.L6={state:'confirmed'};s.PAY.L6={state:'full',got:999999999};s.PAPER.L6={nda:{ok:{}},supp:{ok:{}}};
  assert.equal(copies.investorCopyEligibility(s,l,[]).eligible,false);
  for(const units of [0,-1,1.5,NaN,Infinity,2,'1']) {const t=cloneCopyState(s);copyLead(t).units=units;assert.equal(copies.investorCopyEligibility(t,copyLead(t)).eligible,false,String(units));}
  for(const mutate of [a=>a[0].units=2,a=>a[0].units=1.5,a=>a[0].unitPrice=0,a=>a[0].unitPrice=Infinity,a=>a.push(structuredClone(a[0])),a=>a[1].accountId=a[0].accountId,a=>a[0].accountId='foreign']) {
    const a=structuredClone(copySource.accounts);mutate(a);assert.equal(copies.investorCopyEligibility(s,l,a).eligible,false);
  }
  const forged={...l,units:999,n:'Forged name'};assert.equal(copies.investorCopyEligibility(s,forged).eligible,true,'Canonical lead values win');
});

test('Copy evidence rejects incomplete, invalid, future or duplicated source agreements and unconfirmed Finance payments',()=>{
  const s=copyFixture(),l=copyLead(s), cases=[
    a=>a[0].documents=a[0].documents.filter(d=>d.title!=='Non-disclosure agreement'),
    a=>a[0].documents[1].state='awaiting',a=>a[0].documents[1].completedOn=null,
    a=>a[0].documents[1].completedOn='31 Feb 2026 12:00',a=>a[0].documents[1].completedOn='29 Aug 2026 00:01',
    a=>a[0].documents[1].sentOn='25 Aug 2026 12:00',a=>a[0].documents[1].sentBy='rohit',
    a=>a[0].documents[1].id='',a=>a[0].documents[0].id='',a=>a[0].documents[2].id=a[0].documents[1].id,
    a=>a[1].documents[0].id=a[0].documents[1].id,
    a=>a[0].payments[0].reconciliation='unmatched',a=>a[0].payments[0].reconciliation='reversed',
    a=>a[0].payments[0].kind='forfeit',a=>a[0].payments[0].kind='refund',a=>a[0].payments[0].id='',
    a=>a[0].payments[0].kind='unknown',a=>a[0].documents=null,a=>a[0].payments=null,
    a=>a[0].payments[0].reversed=true,
    a=>a[0].payments[0].recordedBy='rohit',a=>a[0].payments[0].on='invalid',a=>a[0].payments[0].on='29 Aug 2026 00:01',
    a=>a[0].payments[0].amount=-1,a=>a[0].payments[0].amount=Infinity,
    a=>a[0].payments.push(structuredClone(a[0].payments[0])),a=>a[1].payments[0].id=a[0].payments[0].id];
  cases.forEach((mutate,i)=>{const a=structuredClone(copySource.accounts);mutate(a);assert.equal(copies.investorCopyEligibility(s,l,a).eligible,false,`source case ${i}`);});
  const old=cloneCopyState(s);old.NOW=new Date(2026,7,23);assert.equal(copies.investorCopyEligibility(old,copyLead(old)).eligible,false,'Source confirmation must exist by the model time');
  const nullDoc=structuredClone(copySource.accounts);nullDoc[0].documents.push(null);assert.equal(copies.investorCopyEligibility(s,l,nullDoc).eligible,false,'Malformed local document histories refuse');
  const today=structuredClone(copySource.accounts);today[0].payments[0].on='28 Aug 2026 23:59';today[0].payments[0].reconciliation='confirmed';assert.equal(copies.investorCopyEligibility(s,l,today).eligible,true,'Source day is inclusive');
});

test('Copy threshold uses cents-rounded confirmed net receipts, subtracts refunds and excludes forfeits and reversed entries',()=>{
  const s=copyFixture(),l=copyLead(s);
  for(const [amount,ok] of [[249999.99,false],[250000,true],[249999.999,false]]) {
    const a=structuredClone(copySource.accounts);a[0].payments[0].amount=amount;assert.equal(copies.investorCopyEligibility(s,l,a).eligible,ok);
  }
  const a=structuredClone(copySource.accounts),p=a[0].payments[0];
  a[0].payments.push({...p,id:'T-9900',kind:'refund',amount:0.01});assert.equal(copies.investorCopyEligibility(s,l,a).eligible,false);
  a[0].payments.push({...p,id:'T-9901',kind:'balance',amount:0.01});assert.equal(copies.investorCopyEligibility(s,l,a).eligible,true);
  a[0].payments.push({...p,id:'T-9902',kind:'forfeit',amount:0},{...p,id:'T-9903',kind:'refund',amount:1000000,reconciliation:'reversed'});
  const e=copies.investorCopyEligibility(s,l,a);assert.equal(e.confirmed,250000);assert.deepEqual(e.receiptIds,['T-0029','T-9900','T-9901']);
});

test('Trusted automatic local projection and manual reconciliation preserve the original lead and all Finance/source maps and are idempotent',()=>{
  const s=copyFixture();copyLead(s).channelPartnerId='ananya';copyLead(s).done=12;
  const before=JSON.stringify({...s,INVESTORCOPY:undefined}), sourceBefore=JSON.stringify(copySource);
  const auto=copies.projectInvestorCopies(s);assert.equal(JSON.stringify({...auto,INVESTORCOPY:undefined}),before);
  assert.equal(auto.INVESTORCOPY.L6.mode,'automatic');assert.equal(auto.INVESTORCOPY.L6.copiedBy,'system');assert.equal(copies.projectInvestorCopies(auto),auto);
  const manual=store.reducer(s,{type:'copyInvestor',id:'L6'}),c=manual.INVESTORCOPY.L6;
  assert.equal(JSON.stringify({...manual,INVESTORCOPY:undefined}),before);assert.equal(c.accountId,'ARL-INV-0208');assert.equal(c.mode,'manual');assert.equal(c.copiedBy,'sahil');
  assert.deepEqual(c.snapshot,{id:'L6',n:copyLead(s).n,units:1,owner:'rohit',source:copyLead(s).src,channelPartnerId:'ananya'});
  assert.deepEqual(Object.keys(c).sort(),['accountId','copiedAt','copiedBy','leadId','mode','snapshot','sourceDocumentIds','sourceReceiptIds','status']);
  assert.equal(store.reducer(manual,{type:'copyInvestor',id:'L6'}),manual);assert.equal(JSON.stringify(copySource),sourceBefore);
  assert.equal(store.LEAD_WRITES.has('copyInvestor'),false,'Integration tracking is not a lead mutation');
  for(const mutate of [s=>copyLead(s).own=null,s=>copyLead(s).lost={by:'rohit',at:'27 Aug',why:'Paused',stage:6}]) {
    const t=copyFixture();mutate(t);assert.equal(copies.investorCopyEligibility(t,copyLead(t)).eligible,false);assert.equal(store.reducer(t,{type:'copyInvestor',id:'L6'}),t);
  }
});

test('Manual copy requires the active actual Ops integration administrator and unborrowed authority plus both readable Finance source pages',()=>{
  const s=copyFixture();assert.equal(copies.canRecordInvestorCopy(s,copyLead(s)),true);
  for(const who of ['rohit','jhalak','kavya','arvind','pradeep']) {
    const t=copyFixture(who);t.CAPS[who]={system:['view','edit'],xfer:['view'],pay:['view'],docs:['view'],leads:['view']};
    assert.equal(store.reducer(t,{type:'copyInvestor',id:'L6'}),t,who);
  }
  for(const mutate of [t=>t.PEOPLE.sahil.on=false,t=>t.PEOPLE.sahil.ext='outside console',
    t=>t.CAPS.sahil={system:[]},t=>t.CAPS.sahil={xfer:[]},t=>t.CAPS.sahil={leads:[]},t=>t.CAPS.sahil={pay:[]},t=>t.CAPS.sahil={docs:[]}]) {
    const t=copyFixture();mutate(t);
    assert.equal(store.reducer(t,{type:'copyInvestor',id:'L6'}),t);
  }
  const forged=copyFixture('rohit');forged.ROLE='ops';forged.CAPS.rohit={system:['edit'],xfer:['view']};assert.equal(store.reducer(forged,{type:'copyInvestor',id:'L6'}),forged);
  const t=copyFixture();t.CAPS.sahil={system:['view']};t.TEMP=[{id:'admin-loan',by:'jhalak',to:'sahil',page:'system',caps:['edit'],from:'27 Aug 2026',until:'29 Aug 2026'}];t.TEMPON='admin-loan';
  assert.equal(store.reducer(t,{type:'copyInvestor',id:'L6'}),t);assert.equal(store.reducer(s,{type:'copyInvestor',id:'foreign'}),s);
});

test('Read-only investor copy status and source proof obey IR held-record scope and cannot admit unassigned, peer, provenance-only or revoked records',()=>{
  const s=copyFixture('rohit');s.INVESTORCOPY=store.initialState().INVESTORCOPY;
  for(const id of ['L6','L13']) {const l=s.LEADS.find(x=>x.id===id);assert(copies.investorCopyOf(s,l));assert(selectors.canOpenDrawer(s,'investorcopy',id));assert(selectors.leadDoors(s,l,4).some(d=>d.k==='investorcopy'));}
  const peer=s.LEADS.find(l=>l.id==='L7');assert.equal(copies.investorCopyOf(s,peer),null);assert.equal(copies.investorCopyEligibility(s,peer).eligible,false);assert.equal(selectors.canOpenDrawer(s,'investorcopy','L7'),false);
  const l=copyLead(s);l.own=null;l.sec='rohit';l.channelPartnerId='rohit';assert.equal(copies.investorCopyOf(s,l),null);assert.equal(copies.investorCopyEligibility(s,l).accountId,null);
  l.own='kavya';l.sec=null;l.cov={by:'rohit',from:'27 Aug 2026',to:'28 Aug 2026'};assert(copies.investorCopyOf(s,l));
  l.cov.to='27 Aug 2026';assert.equal(copies.investorCopyOf(s,l),null);
  const t=copyFixture('rohit');t.INVESTORCOPY=store.initialState().INVESTORCOPY;t.CAPS.rohit={docs:[]};assert.equal(copies.investorCopyOf(t,copyLead(t)),null);assert.equal(copies.investorCopyEligibility(t,copyLead(t)).accountId,null);
  t.CAPS.rohit.pay=[];assert.equal(copies.investorCopyOf(t,copyLead(t)),null);
  t.TEMP=[{id:'copy-read',by:'sahil',to:'rohit',page:'xfer',caps:['view'],from:'27 Aug 2026',until:'29 Aug 2026'}];t.TEMPON='copy-read';
  assert.equal(selectors.canViewInvestorCopy(t,copyLead(t)),false,'Borrowed copy page does not revive revoked IR source history');
  const bad=copyFixture();bad.INVESTORCOPY.L6={...store.initialState().INVESTORCOPY.L6,accountId:'ARL-INV-0210'};assert.equal(copies.investorCopyOf(bad,copyLead(bad)),null);
  bad.INVESTORCOPY.L6={...store.initialState().INVESTORCOPY.L6,sourceReceiptIds:['T-0030','T-0029'],sourceDocumentIds:['D-039','D-036'],privateNote:'Private foreign data',snapshot:{id:'L6',n:'Foreign investor',units:4}};
  const safe=copies.investorCopyOf(bad,copyLead(bad));assert.deepEqual(safe.sourceReceiptIds,['T-0029']);assert.deepEqual(safe.sourceDocumentIds,['D-036']);assert.equal(safe.snapshot.n,copyLead(bad).n);assert.equal(safe.privateNote,undefined);
  bad.INVESTORCOPY.L6.sourceReceiptIds=null;bad.INVESTORCOPY.L6.sourceDocumentIds='D-039';assert.deepEqual(copies.investorCopyOf(bad,copyLead(bad)).sourceReceiptIds,[]);
  bad.INVESTORCOPY.L6.mode='external creation';assert.equal(copies.investorCopyOf(bad,copyLead(bad)),null);
});

test('Copy drawers and register show honest local status, read-only IR access, conditional admin recovery and no obsolete transfer/source writer claims',()=>{
  const Body=drawerDef('investorcopy').Body,s=copyFixture('rohit');s.INVESTORCOPY=store.initialState().INVESTORCOPY;
  const ir=render(Body,s,{id:'L6',lead:copyLead(s)});assert(ir.includes('Local demo copy recorded'));assert(ir.includes('ARL-INV-0208'));assert(!ir.includes('<button'));assert(!ir.includes('HDFC2608551'));
  const hidden=render(Body,s,{id:'L7',lead:s.LEADS.find(l=>l.id==='L7')});assert(!hidden.includes('ARL-INV-0209'));
  const admin=copyFixture(),preview=render(Body,admin,{id:'L6',lead:copyLead(admin)});
  /* ir-console-redesigned.html:9184's own closing sentence — "Copying does not close or allocate
     the investment." — replaced this round's port-only "Original lead retained." wording. */
  assert(preview.includes('Already present in portal · demo source'));assert(preview.includes('Copy to investor demo'));assert(preview.includes('Copying does not close or allocate the investment'));
  const page=render(XferPage,admin);assert(page.includes('Investor copies'));assert(page.includes('Copy to investor demo'));assert(page.includes('Investor copy status'));
  for(const phrase of ['Nobody performs this','mints the ARL','sends the welcome','Transferred','Not delivered'])assert(!page.includes(phrase));
  assert(!page.includes('Farida Contractor'));
  /* The redesign's vXfer (prototype ~9219) renders two tables: the 4-column copy-status table and,
     inside a collapsed <details>, the 3-column legacy register — 7 <th> cells in all. */
  assert.equal((page.match(/<th>/g)||[]).length,7);assert(!page.includes('class="stat"'));
  admin.INVESTORCOPY=store.initialState().INVESTORCOPY;admin.CAPS.sahil={pay:[],docs:[]};
  const statusOnly=render(XferPage,admin),safe=copies.investorCopyOf(admin,copyLead(admin));assert(statusOnly.includes('ARL-INV-0208'));assert(!statusOnly.includes('Copy to investor demo'));
  assert.deepEqual(safe.sourceReceiptIds,[]);assert.deepEqual(safe.sourceDocumentIds,[]);
  admin.CAPS.sahil.docs=['view'];assert.deepEqual(copies.investorCopyOf(admin,copyLead(admin)).sourceReceiptIds,[]);assert(copies.investorCopyOf(admin,copyLead(admin)).sourceDocumentIds.length>0);
  for(const who of ['sahil','pradeep']) {
    const restricted=copyFixture(who);restricted.INVESTORCOPY=store.initialState().INVESTORCOPY;
    for(const caps of [{xfer:[],pay:['view'],docs:[]},{xfer:[],pay:[],docs:['view']}]) {
      restricted.CAPS[who]=caps;assert.equal(selectors.canViewInvestorCopy(restricted,copyLead(restricted)),false,`${who} one source page`);
      assert.equal(copies.investorCopyOf(restricted,copyLead(restricted)),null);
    }
    restricted.CAPS[who]={xfer:['view'],pay:[],docs:[]};const status=copies.investorCopyOf(restricted,copyLead(restricted));
    assert(status,`${who} explicit copy view`);assert.deepEqual(status.sourceReceiptIds,[]);assert.deepEqual(status.sourceDocumentIds,[]);
  }
  assert.equal(copies.investorCopyReplayTarget(s,copyLead(s)),null,'IR cannot read the internal raw replay source');
});

test('Queued local copy retains source and lead data offline, drains once on reconnect and never creates duplicate tracking or a false failed duplicate',()=>{
  const f=copyWriter(),before=JSON.stringify({...f.state(),INVESTORCOPY:undefined});
  assert.equal(f.writer.apply({type:'copyInvestor',id:'L6'}).status,'pending');assert.deepEqual(f.state().INVESTORCOPY,{});assert.equal(f.reductions(),0);
  assert.equal(f.writer.snapshot()[0].label,'Investor copy (demo)');f.online();f.writer.reconnect();assert.equal(f.reductions(),1);
  assert.equal(f.state().INVESTORCOPY.L6.accountId,'ARL-INV-0208');assert.deepEqual(f.writer.snapshot(),[]);assert.equal(JSON.stringify({...f.state(),INVESTORCOPY:undefined}),before);
  assert.equal(f.writer.apply({type:'copyInvestor',id:'L6'}).status,'rejected');assert.equal(f.reductions(),1);assert.deepEqual(f.writer.snapshot(),[]);
});

test('Pending investor copy refuses changed source eligibility, permissions, existing projection or actor session at real reducer replay',()=>{
  for(const mutate of [s=>copyLead(s).units=2,s=>copyLead(s).units=1.5,s=>s.CAPS.sahil={system:[]},s=>s.CAPS.sahil={pay:[]},s=>s.CAPS.sahil={docs:[]},s=>s.PEOPLE.sahil.on=false,
    s=>s.INVESTORCOPY.L6=store.initialState().INVESTORCOPY.L6]) {
    const f=copyWriter();f.writer.apply({type:'copyInvestor',id:'L6'});const s=cloneCopyState(f.state());mutate(s);f.change(s);const before=JSON.stringify(s);f.online();f.writer.reconnect();
    assert.equal(JSON.stringify(f.state()),before);assert.equal(f.writer.snapshot()[0].status,'failed');
  }
  const f=copyWriter();f.writer.apply({type:'copyInvestor',id:'L6'});f.writer.apply({type:'setPerson',k:'rohit'});assert.deepEqual(f.writer.snapshot(),[]);
  f.writer.apply({type:'setPerson',k:'sahil'});f.online();f.writer.reconnect();assert.deepEqual(f.state().INVESTORCOPY,{});
  const changedSource=copyWriter(),receipt=copySource.accounts[0].payments[0],original=receipt.reconciliation;
  changedSource.writer.apply({type:'copyInvestor',id:'L6'});
  try {
    receipt.reconciliation='unmatched';const before=JSON.stringify(changedSource.state());changedSource.online();changedSource.writer.reconnect();
    assert.equal(changedSource.reductions(),0,'The writer refuses changed source before invoking the reducer');assert.equal(store.reducer(changedSource.state(),{type:'copyInvestor',id:'L6'}),changedSource.state(),'Reducer also refuses unconfirmed source');assert.equal(JSON.stringify(changedSource.state()),before);assert.equal(changedSource.writer.snapshot()[0].status,'failed');
  } finally {receipt.reconciliation=original;}
  changedSource.writer.retry(changedSource.writer.snapshot()[0].key);assert.equal(changedSource.state().INVESTORCOPY.L6.accountId,'ARL-INV-0208');assert.deepEqual(changedSource.writer.snapshot(),[]);
});

test('Queued copy rejects still-eligible source amount, receipt ID, reference or global evidence conflicts and accepts only a freshly reviewed submission',()=>{
  for(const mutate of [a=>a[0].payments[0].amount+=1,a=>a[0].payments[0].id='T-9999',a=>a[0].payments[0].reference='Changed bank reference',
    a=>a[1].payments[0].id=a[0].payments[0].id]) {
    const f=copyWriter();f.writer.apply({type:'copyInvestor',id:'L6'});const original=structuredClone(copySource.accounts),before=JSON.stringify(f.state());
    try {
      mutate(copySource.accounts);f.online();f.writer.reconnect();assert.equal(f.reductions(),0);assert.equal(JSON.stringify(f.state()),before);assert.equal(f.writer.snapshot()[0].status,'failed');
      if(copies.investorCopyEligibility(f.state(),copyLead(f.state())).eligible) {
        assert.equal(f.writer.apply({type:'copyInvestor',id:'L6'}).status,'completed');assert.equal(f.reductions(),1);assert.equal(f.state().INVESTORCOPY.L6.accountId,'ARL-INV-0208');assert.deepEqual(f.writer.snapshot(),[]);
      }
    } finally {copySource.accounts.splice(0,copySource.accounts.length,...original);}
  }
});

test('Dormant secondary metadata grants no investor read, queue, activity, search, report or standalone drawer/helper access',()=>{
  const s=fixture();s.AVAIL={};const l=s.LEADS[1];s.LOG.push(log('owner','Private secondary action','shared','stage','Private shared note'));
  s.NOTES.shared=[{by:'peer',at:'27 Aug',t:'Private investor note'}];
  assert.equal(selectors.secondaryMayWork(s,l),false);assert.equal(selectors.inBook(s,l),false);assert.equal(selectors.named(s,l),false);assert.equal(selectors.canEdit(s,l),false);
  for(const read of ['myBook','myWork','openable','visible','numBook'])assert(!selectors[read](s).some(x=>x.id===l.id),read);
  assert(!selectors.activityRows(s).some(e=>e.lead===l.id));assert(!selectors.feedRows(s).some(e=>e.lead===l.id));assert(!selectors.updates(s).some(g=>g.rows.some(r=>r.lead===l.id)));
  assert.equal(selectors.hay(s,l),'');assert.equal(selectors.matches(s,l,''),false);assert.deepEqual(selectors.leadDoors(s,l,4),[]);assert.equal(selectors.nextUp(s,l).act,null);
  assert.equal(selectors.logReadable(s,s.LOG.at(-1)),false);assert.equal(selectors.logNote(s,s.LOG.at(-1)),'');
  for(const kind of ['history','notes','next','owner','money','paper','acct','claim','investorcopy']) {
    assert.equal(selectors.canOpenDrawer(s,kind,l.id),false);const def=drawerDef(kind);
    const html=render(def.Body,s,{id:l.id,lead:l});assert(!html.includes('Private secondary'));assert(!html.includes('Private investor'));assert(!html.includes('Test follow-up'));assert(!html.includes('<input'));assert(!html.includes('<button'));
    assert.equal(def.title(s,{id:l.id,lead:l}),'Unavailable');
  }
  for(const action of [{type:'seedNext',id:l.id},{type:'seedTouch',id:l.id},{type:'askReschedule',id:l.id},{type:'handover',id:l.id,perm:false,why:'today'}])assert.equal(store.reducer(s,action),s);
  const forged={...s.LEADS[2],own:'peer',sec:'owner'};assert.equal(selectors.inBook(s,forged),false);assert.equal(selectors.secondaryMayWork(s,forged),false);
});

test('Secondary read/work activates only for a known enabled primary with genuine bounded current leave and an enabled available IR secondary',()=>{
  const s=fixture(),l=s.LEADS[1];assert(selectors.secondaryMayWork(s,l));assert(selectors.inBook(s,l));assert(selectors.canEdit(s,l));
  const mutations=[t=>t.AVAIL={},t=>t.AVAIL.peer.from='2026-08-29',t=>t.AVAIL.peer.to='2026-08-28',t=>t.AVAIL.peer.from='2026-02-31',
    t=>t.AVAIL.peer.to='invalid',t=>delete t.AVAIL.peer.from,t=>t.AVAIL.peer.perm=true,t=>t.PEOPLE.peer.on=false,t=>delete t.PEOPLE.peer,
    t=>t.PEOPLE.peer.ext='External portal',t=>t.PEOPLE.peer.seat='ops',t=>t.LEADS[1].own=null,t=>t.LEADS[1].own='unknown',t=>t.PEOPLE.owner.on=false,
    t=>t.PEOPLE.owner.ext='External portal',t=>t.PEOPLE.owner.seat='cp',t=>t.PEOPLE.owner.seat='conv',
    t=>t.AVAIL.owner={why:'On leave',from:'2026-08-27',to:'2026-08-29'}];
  for(const [i,mutate] of mutations.entries()) {
    const t=cloneCopyState(s);mutate(t);assert.equal(selectors.secondaryMayWork(t,t.LEADS[1]),false,`invalid absence/party ${i}`);
    assert.equal(selectors.inBook(t,t.LEADS[1]),false,`invalid secondary read ${i}`);assert.equal(selectors.canReadFinance(t,t.LEADS[1],'pay'),false);
  }
  const returned={...s,NOW:new Date(2026,7,29)};assert.equal(selectors.inBook(returned,l),false,'Return day closes cover');
});

test('Explicit cover grants only the current named recipient and invalid, future or expired cover cannot resurrect from continuing primary leave',()=>{
  for(const cover of [{by:'owner',from:'29 Aug 2026',to:'30 Aug 2026'},{by:'owner',to:'27 Aug 2026'},{by:'owner',to:'invalid'},
    {by:'outsider',from:'27 Aug 2026',to:'29 Aug 2026'}]) {
    const s=fixture();s.LEADS[1].cov=cover;assert.equal(selectors.inBook(s,s.LEADS[1]),false);
    s.LEADS[1].cov=null;s.COVER.peer=cover;assert.equal(selectors.inBook(s,s.LEADS[1]),false);
  }
  const s=fixture();s.AVAIL={};s.LEADS[1].cov={by:'owner',from:'27 Aug 2026',to:'29 Aug 2026'};
  assert(selectors.inBook(s,s.LEADS[1]),'Owner/manager authorized explicit cover need not invent leave');
  assert(selectors.secondaryMayWork(s,s.LEADS[1]));s.PEOPLE.peer.on=false;assert.equal(selectors.inBook(s,s.LEADS[1]),false,'Disabled owner cannot authorize cover');
  const primary=fixture('peer');primary.AVAIL={};const assigned=store.reducer(primary,{type:'handover',id:'shared',perm:false,why:'today'});
  assert.notEqual(assigned,primary);const secondary={...assigned,WHO:'owner',ROLE:'ir'};assert(selectors.inBook(secondary,secondary.LEADS[1]));
  const transferred=store.reducer(fixture('manager'),{type:'reassignTo',id:'shared',to:'owner',why:require('./src/domain/index.ts').REASONS[0]});
  const newOwner={...transferred,WHO:'owner',ROLE:'ir',AVAIL:{}};assert(selectors.inBook(newOwner,newOwner.LEADS[1]));
  const oldOwner={...newOwner,WHO:'peer'};assert.equal(selectors.inBook(oldOwner,oldOwner.LEADS[1]),false,'Former primary becomes dormant secondary');
  const precedence=fixture();precedence.COVER.peer={by:'owner',from:'27 Aug 2026',to:'29 Aug 2026'};precedence.LEADS[1].cov={by:'owner',from:'29 Aug 2026',to:'30 Aug 2026'};
  assert.equal(selectors.covOf(precedence,precedence.LEADS[1]),null);assert.equal(selectors.inBook(precedence,precedence.LEADS[1]),false,'Future per-record cover cannot resurrect old global cover');
  const viewer=fixture();viewer.PEOPLE.peer.seat='ops';viewer.LEADS[1].cov={by:'owner',to:'29 Aug 2026'};assert.equal(selectors.covOf(viewer,viewer.LEADS[1]),null,'Read-only primary cannot authorize lead cover');
  assert.equal(selectors.coverLive(viewer,{by:'other-manager',to:'29 Aug 2026'},'outsider'),false,'Read-only recipient cannot operate as cover');
});

test('IR Finance and copy mirrors remove dormant-secondary source records and restore only live current cover, preserving primary record access',()=>{
  const s=copyFixture('rohit');s.AVAIL={};s.INVESTORCOPY=store.initialState().INVESTORCOPY;
  const secondary=s.LEADS.find(l=>l.id==='L13');assert.equal(copies.investorCopyOf(s,secondary),null);assert.equal(selectors.financeAccountId(s,secondary),null);
  for(const page of ['pay','docs'])assert(!selectors.financeBook(s,page).some(l=>l.id==='L13'));
  assert.deepEqual(selectors.financePaymentHistory(s,secondary),[]);assert.deepEqual(selectors.financeDocuments(s,secondary),[]);
  for(const Component of [PayPage,DocsPage]){const html=render(Component,s);assert(!html.includes('R. Sundaram'));assert(!html.includes('ARL-INV-0210'));assert(html.includes('Prakash Bhat'));}
  s.AVAIL.kavya={why:'On leave',from:'2026-08-27',to:'2026-08-29'};assert(copies.investorCopyOf(s,secondary));
  assert(selectors.financeDocuments(s,secondary).some(d=>d.id==='D-035b'));s.NOW=new Date(2026,7,29);assert.equal(copies.investorCopyOf(s,secondary),null);
});

test('IR manager default Finance views cover assigned actual team only, never unassigned, dormant outside-primary or forged org scope, and are read-only',()=>{
  const s=fixture('manager');s.AVAIL={};s.LEADS.push(lead('unassigned','Private unassigned investor',null),lead('outside-secondary','Outside primary investor','outsider','owner'),lead('manager-own','Manager own investor','manager'));
  for(const l of s.LEADS)s.PAY[l.id]={state:'part',got:250000,mode:'NEFT',utr:'PRIVATE-REFERENCE-1234',on:'27 Aug',hold:null};
  s.DOCS=s.LEADS.map(l=>({lead:l.id,t:'Document '+l.n,cls:'Commercial',state:'signed',ref:'PRIVATE-SIGNATURE',on:'27 Aug'}));
  assert(selectors.canReach(s,'pay'));assert(selectors.canReach(s,'docs'));assert.equal(selectors.seeMoney(s),false);
  for(const page of ['pay','docs'])assert.deepEqual(selectors.financeBook(s,page).map(l=>l.id),['manager-own','own','shared']);
  assert(!selectors.teamBook(s).some(l=>l.id==='outside-secondary'));s.ROLE='ops';assert(!selectors.openable(s).some(l=>l.id==='outside-secondary'));
  const pay=render(PayPage,s),docs=render(DocsPage,s);
  for(const html of [pay,docs]){assert(!html.includes('Private unassigned investor'));assert(!html.includes('Outside primary investor'));assert(!html.includes('Hidden investor'));assert(!html.includes('PRIVATE-REFERENCE-1234'));assert(!html.includes('PRIVATE-SIGNATURE'));assert(!html.includes('<input'));}
  assert(!pay.includes('Sellable inventory'));assert.equal(selectors.financeBankReference(s,'PRIVATE-REFERENCE-1234'),'••• 1234');
  assert.equal(selectors.may(s,'pay','record'),false);assert.equal(selectors.may(s,'docs','send'),false);
  for(const action of [{type:'record',id:'own',kind:'advance'},{type:'recordDoc',id:'own',t:'Advance receipt'},{type:'prDraft',id:'own',link:'https://example.invalid/draft'},{type:'acctAuto',id:'own'},{type:'xferAuto',id:'own'}])assert.equal(store.reducer(s,action),s);
  s.CAPS.manager={pay:[],docs:[]};assert.equal(selectors.canReach(s,'pay'),false);assert.equal(selectors.canReach(s,'docs'),false);assert.deepEqual(selectors.financeBook(s,'pay'),[]);
  const outsideCover=fixture('manager');outsideCover.CAPS.manager={pay:['view'],docs:['view']};outsideCover.LEADS[2].cov={by:'manager',from:'27 Aug 2026',to:'29 Aug 2026'};
  assert(selectors.openable(outsideCover).some(l=>l.id==='hidden'));assert.equal(selectors.canReadFinance(outsideCover,outsideCover.LEADS[2],'pay'),false,'Cover cannot expand manager Finance team');
  const leaver=fixture('manager');leaver.PEOPLE.peer.on=false;
  assert(selectors.openable(leaver).some(l=>l.id==='shared'));assert(selectors.canReadFinance(leaver,leaver.LEADS[1],'pay'),'Authorized manager retains disabled descendant history');
  const oversight=copyFixture();oversight.PEOPLE.rohit.on=false;assert(selectors.openable(oversight).some(l=>l.id==='L6'),'Elevated oversight retains known inactive primary records');
  const ceiling=fixture('manager');ceiling.PEOPLE.manager.mgr='marketing';
  assert(selectors.may(ceiling,'pay','view'));assert(selectors.may(ceiling,'docs','view'),'Manager source-history default survives structural ceiling');
  assert.deepEqual(selectors.financeBook(ceiling,'pay'),[],'Record gate still refuses a revoked Leads ceiling');ceiling.CAPS.manager={pay:[]};assert.equal(selectors.may(ceiling,'pay','view'),false);
});

test('Queued secondary writes are rejected without mutation when primary returns, cover expires, secondary becomes unavailable or ownership changes',()=>{
  for(const mutate of [s=>s.AVAIL={},s=>s.LEADS[1].cov={by:'owner',to:'27 Aug 2026'},s=>s.AVAIL.owner={why:'On leave',from:'2026-08-27',to:'2026-08-29'},
    s=>s.PEOPLE.peer.on=false,s=>s.LEADS[1].own='owner']) {
    const f=writerFixture();f.writer.apply({type:'logTouch',id:'shared',k:'msg'});assert.equal(f.writer.snapshot()[0].status,'pending');
    const changed=cloneCopyState(f.state());mutate(changed);f.change(changed);const before=JSON.stringify(changed);f.online();f.writer.reconnect();
    assert.equal(JSON.stringify(f.state()),before);assert.equal(f.reductions(),0);assert.equal(f.writer.snapshot()[0].status,'failed');
  }
  const f=writerFixture();f.writer.apply({type:'logTouch',id:'shared',k:'msg'});f.online();f.writer.reconnect();assert.equal(f.reductions(),1);assert.deepEqual(f.writer.snapshot(),[]);
});

/* ── D37–D44 gate coverage added this round — see the hand-back note for why each one is here. */

test('Money and claim drawers mask a bank/claim reference for IR/conv, and the money mirror never embeds a report control', () => {
  const s=fixture();s.PAY.own={state:'part',got:250000,mode:'NEFT',utr:'HDFC2608551',hold:'2 Sep',at:'24 Aug 11:00',
    receipts:[{id:'T-1',amount:250000,paidOn:'24 Aug',kind:'advance',mode:'NEFT',ref:'HDFC2608551',confirmedBy:'peer',confirmedAt:'24 Aug 12:00'}]};
  s.CLAIM.own={id:'PR-own-1',by:'owner',at:'27 Aug 10:00',kind:'advance',mode:'NEFT',ref:'HDFC2708994',amount:250000,said_on:'2026-08-24',
    heldBefore:0,note:'',state:'waiting',history:[{type:'reported',by:'owner',at:'27 Aug 10:00',note:'Payment report sent to Finance'}]};
  const money=render(drawerDef('money').Body,s,{id:'own',lead:s.LEADS[0]});
  assert(!money.includes('HDFC2608551'));assert(!money.includes('HDFC2708994'));
  const claim=render(drawerDef('claim').Body,s,{id:'own',lead:s.LEADS[0]});
  assert(!claim.includes('HDFC2708994'));assert(claim.includes('••• 8994'));
});

test('updates() gates the owner, move and team rows by openable(), same as every other reading of a lead', () => {
  const s=fixture('manager');
  s.LEADS[0].own=null;s.LEADS[0].by='peer';
  const before=selectors.updates(s), ownerBefore=before.find(g=>g.k==='owner');
  assert(ownerBefore&&ownerBefore.rows.some(r=>r.lead==='own'),'an unassigned lead this manager may open shows up as an owner update');
  s.CAPS.manager={leads:[]};
  assert.deepEqual(selectors.openable(s),[],'revoking leads view empties openable()');
  const revoked=selectors.updates(s);
  assert(!revoked.some(g=>g.rows.some(r=>r.lead==='own')),'revoking leads view must drop every lead-keyed update row, including the owner group');
  assert.deepEqual(revoked,[],'with no lead openable at all, updates() has nothing left to say');
});

test('systemActors never widens past activityActors for a system-view-only, non-editing seat', () => {
  const s=fixture();s.PEOPLE.owner={...s.PEOPLE.owner,seat:'corp',mgr:null};s.ROLE='corp';
  assert.deepEqual(selectors.systemActors(s),selectors.activityActors(s));
  assert.deepEqual(selectors.systemActors(s),['owner']);
  assert(!selectors.systemActors(s).includes('peer'));
  assert.equal(selectors.own(s,'system','edit'),false);
});

test('confirmClaim only matches an existing confirmed receipt and never records money a second time', () => {
  const s=fixture();s.PEOPLE.finance=person('Test Finance','fin');s.WHO='finance';s.ROLE='fin';
  s.CLAIM.own={id:'PR-own-1',by:'owner',at:'27 Aug 10:00',kind:'advance',mode:'NEFT',ref:'HDFC12345678',amount:250000,said_on:'2026-08-24',
    heldBefore:0,note:'',state:'waiting',history:[{type:'reported',by:'owner',at:'27 Aug 10:00',note:'Payment report sent to Finance'}]};
  s.PAY.own={state:'part',got:250000,mode:'NEFT',utr:'HDFC12345678',on:'24 Aug 11:00',hold:'2 Sep',
    receipts:[{id:'T-1',amount:250000,paidOn:'2026-08-24',kind:'advance',mode:'NEFT',ref:'HDFC12345678',confirmedBy:'finance',confirmedAt:'24 Aug 12:00'}]};
  assert.equal(selectors.claimReceiptMatch(s,'own').ok,true);
  /* D24: Finance carries no seat in this console at all — it confirms receipts in the separate
     Investor Management portal, never here (`isFin` is a hard `false`, whatever the role or
     capability) — so dispatching confirmClaim through this store, from any actor, is a no-op. */
  assert.equal(selectors.isFin(s.ROLE),false);
  assert.equal(store.reducer(s,{type:'confirmClaim',id:'own'}),s,'confirmClaim must be unreachable through this console — Finance answers in the Investor Management portal');
  assert.equal(s.PAY.own.got,250000,'the receipt itself is untouched');
  assert.equal(s.CLAIM.own.state,'waiting');
  /* And root-cause, not merely gate-deep: if that permission gate is ever loosened, the reducer's
     own body must still only ATTACH the match `claimReceiptMatch` already found — never call the
     receipt-writer `doRecord` a second time for the same money. */
  const reducerSrc=fs.readFileSync(path.join(__dirname,'src/features/pay/reducer.ts'),'utf8');
  const start=reducerSrc.indexOf('case "confirmClaim":'), end=reducerSrc.indexOf('case "rejectClaim":',start);
  assert(start>=0&&end>start,'confirmClaim case must exist in pay/reducer.ts');
  const body=reducerSrc.slice(start,end);
  assert(!body.includes('doRecord'),'confirmClaim must never call doRecord — matching creates no receipt');
  assert(body.includes('claimReceiptMatch'),'confirmClaim must decide off claimReceiptMatch, the one place a match is computed');
});

/* ── filter-spec.md, Sep 18 2026 — Primitives A/B, Change 1/2/3 (selector half) and Change 4
   part 1. Pure-function level only; the Leads page itself is exercised by the existing
   render-based tests above. ────────────────────────────────────────────────────────────── */

test('stageAtLeast is the one test the "from" stage filter and the funnel both read', () => {
  assert.equal(selectors.stageAtLeast({ done: 3 }, 3), true);
  assert.equal(selectors.stageAtLeast({ done: 3 }, 4), false);
  assert.equal(selectors.stageAtLeast({ done: 5 }, 3), true);
  assert.equal(selectors.stageAtLeast(null, 3), false);
});

test('quietDays counts from the last touch or attempt, falls back to capture, and reads the store clock, not the wall clock', () => {
  const s = fixture();
  const ctx = { ...s, INTERACTIONS: {} };

  const untouched = { ...lead('quiet1', 'Untouched', 'owner'), at: ['20 Aug 10:00'], touch: {} };
  assert.equal(selectors.lastTouchAt(ctx, untouched)?.getDate(), 20, 'falls back to the capture date');
  assert.equal(selectors.quietDays(ctx, untouched), 8, 'against the fixture NOW of 28 Aug 2026, not today\'s real date');

  const touched = { ...lead('quiet2', 'Touched', 'owner'), at: ['01 Jul 10:00'], touch: { msg: ['18 Aug 09:00'] } };
  assert.equal(selectors.quietDays(ctx, touched), 10, 'the last touch wins over an older capture date');

  const attempted = { ...lead('quiet3', 'Attempted', 'owner'), at: ['01 Jul 10:00'], touch: {} };
  const withAttempt = { ...ctx, INTERACTIONS: { quiet3: [{ channel: 'call', outcome: 'No answer', at: '25 Aug 09:00' }] } };
  assert.equal(selectors.quietDays(withAttempt, attempted), 3, 'a "No answer" attempt counts even with no channel stamp');

  const never = { ...lead('quiet4', 'Never seen', 'owner'), at: [], touch: {} };
  assert.equal(selectors.lastTouchAt(ctx, never), null, 'no touch, no attempt and no capture date answers nothing');
  assert.equal(selectors.quietDays(ctx, never), null);
});

test('dormant reads off quietDays alone, never a stored field, and EXC.dormant is the same test', () => {
  const { ST } = require('./src/domain/index.ts');
  const s = fixture();
  const ctx = { ...s, INTERACTIONS: {} };
  const stale = { ...lead('dorm1', 'Gone quiet', 'owner'), done: 3, at: ['01 May 10:00'], touch: {}, lost: null };

  assert.equal(selectors.quietDays(ctx, stale) >= selectors.DORMANTAT, true, 'fixture clears the dormant threshold');
  assert.equal(selectors.dormant(ctx, stale), true);
  assert.equal(selectors.EXC.dormant[0], 'Dormant — no decision');
  assert.equal(selectors.EXC.dormant[1](ctx, stale), true, 'the EXC entry must read the same dormant()');

  assert.equal(selectors.dormant(ctx, { ...stale, id: 'dorm2', done: ST.CONVERTED }), false, 'money in play is not "no decision" any more');
  assert.equal(selectors.dormant(ctx, { ...stale, id: 'dorm3', lost: { why: 'Price too high', note: '', at: '01 Feb 10:00', by: 'owner', stage: 2 } }), false, 'closed is closed, not dormant');
  assert.equal(selectors.dormant(ctx, { ...stale, id: 'dorm4', own: null }), false, 'no owner, no decision to be dormant about');
  assert.equal(selectors.dormant(ctx, { ...stale, id: 'dorm5', at: ['26 Aug 10:00'] }), false, 'touched two days ago is not dormant');
});

test('QUIET carries the spec\'s own four cuts, in order', () => {
  assert.deepEqual(selectors.QUIET, [[14, '14 days +'], [30, '30 days +'], [90, '3 months +'], [180, '6 months +']]);
});

test('LSTAGEMODE composes with the other Leads cuts and is never counted as a filter of its own', () => {
  const s = fixture();
  const l3 = { ...s.LEADS[0], id: 'stage3', done: 3, own: 'owner', lost: null };
  const l5 = { ...s.LEADS[0], id: 'stage5', done: 5, own: 'owner', lost: null };
  const ctx = { ...s, LEADS: [l3, l5], INTERACTIONS: {} };
  const base = { LQ: '', LFILT: null, LSRC: null, LOWN: null };

  assert.equal(selectors.passesNoLost(ctx, l3, { ...base, LSTAGE: 3, LSTAGEMODE: 'at' }), true);
  assert.equal(selectors.passesNoLost(ctx, l5, { ...base, LSTAGE: 3, LSTAGEMODE: 'at' }), false, '"at" means exactly this rung');
  assert.equal(selectors.passesNoLost(ctx, l5, { ...base, LSTAGE: 3, LSTAGEMODE: 'from' }), true, '"from" means this rung or past it');
  assert.equal(selectors.passesNoLost(ctx, l3, { ...base, LSTAGE: 3, LSTAGEMODE: 'from' }), true);

  assert.equal(selectors.leadFilterOn({ ...base, LSTAGE: null, LSTAGEMODE: 'from' }), false, 'the mode alone is not a filter');
  assert.equal(selectors.leadFilterOn({ ...base, LSTAGE: null, LQUIET: 30 }), true, 'LQUIET does count');
});

test('LQUIET filters by quietDays and widens lostShown exactly like the lost cut and LSTAGE already do', () => {
  const s = fixture();
  const quiet = { ...s.LEADS[0], id: 'q1', done: 3, own: 'owner', lost: null, at: ['01 May 10:00'], touch: {} };
  const fresh = { ...s.LEADS[0], id: 'q2', done: 3, own: 'owner', lost: null, at: ['26 Aug 10:00'], touch: {} };
  const ctx = { ...s, LEADS: [quiet, fresh], INTERACTIONS: {} };
  const base = { LQ: '', LFILT: null, LSRC: null, LSTAGE: null, LOWN: null };

  assert.equal(selectors.passesNoLost(ctx, quiet, { ...base, LQUIET: 90 }), true);
  assert.equal(selectors.passesNoLost(ctx, fresh, { ...base, LQUIET: 90 }), false);
  assert.equal(selectors.passesNoLost(ctx, quiet, { ...base, LQUIET: null }), true, 'no cut lets everything through');

  const lostQuiet = { ...quiet, id: 'q3', lost: { why: 'Price too high', note: '', at: '01 Feb 10:00', by: 'owner', stage: 2 } };
  const lostCtx = { ...ctx, LEADS: [lostQuiet] };
  assert.equal(selectors.passes(lostCtx, lostQuiet, { ...base, LQUIET: 90 }), true, 'LQUIET widens lostShown, same as LSTAGE and the lost cut itself');
  assert.equal(selectors.passes(lostCtx, lostQuiet, { ...base, LQUIET: null }), false, 'without any cut a lost lead stays hidden by default');
});

test('clearLeadFilters and toLeads both reset LSTAGEMODE to "at" and LQUIET to null, same as every other lead cut', () => {
  const s = fixture();
  const withCuts = { ...s, ui: { ...s.ui, LSTAGE: 3, LSTAGEMODE: 'from', LQUIET: 30, LFILT: 'cold' } };

  const cleared = store.reducer(withCuts, { type: 'clearLeadFilters' });
  assert.equal(cleared.ui.LSTAGEMODE, 'at');
  assert.equal(cleared.ui.LQUIET, null);

  const jumped = store.reducer(withCuts, { type: 'toLeads', set: 'stage:5' });
  assert.equal(jumped.ui.LSTAGEMODE, 'at');
  assert.equal(jumped.ui.LQUIET, null);
  assert.equal(jumped.ui.LSTAGE, 5);
});

test('reopenHandoff names who can re-open when this seat cannot, and stays silent once a button would actually show', () => {
  const s = fixture();
  const closed = { ...s.LEADS[0], id: 'closed1', own: 'peer', done: 3,
    lost: { why: 'Price too high', note: '', at: '01 Feb 10:00', by: 'peer', stage: 2 } };
  const ctx = { ...s, LEADS: [closed] };
  assert.equal(selectors.canReopen(ctx, closed), false);
  assert.equal(selectors.reopenHandoff(ctx, closed), 'Only ' + selectors.P(s.PEOPLE, 'peer').n + ', or Conversion or Ops, can re-open this.');

  const reopenable = { ...closed, id: 'closed2', own: 'owner' };
  const ctx2 = { ...s, LEADS: [reopenable] };
  assert.equal(selectors.canReopen(ctx2, reopenable), true);
  assert.equal(selectors.reopenHandoff(ctx2, reopenable), null, 'a seat that can re-open gets no hand-off text at all');

  const orphan = { ...closed, id: 'closed3', own: null };
  const ctx3 = { ...s, LEADS: [orphan] };
  assert.equal(selectors.reopenHandoff(ctx3, orphan), 'Only Conversion or Ops can re-open this — it has no owner.');

  assert.equal(selectors.reopenHandoff(ctx, { ...closed, lost: null }), null, 'an open lead has nothing to hand off');
});

/* ── filter-spec.md, Sep 18 2026 — Change 5/6's Numbers/Plan half and Primitive B's Numbers
   caller. Pure-function level only; the click-wiring itself is presentation on top of these. */

test('hasLeads is exactly canReach(leads) and seesTeam — the one gate every Numbers/Plan clickthrough shares', () => {
  const ir = fixture('owner');
  assert.equal(selectors.hasLeads(ir), false, 'an IR seat has no teamscope, so a count never becomes a button to a name outside its own book');
  const conv = fixture('manager');
  assert.equal(selectors.hasLeads(conv), true);
  const revoked = { ...conv, CAPS: { manager: { leads: [] } } };
  assert.equal(selectors.hasLeads(revoked), false, 'revoking Leads view removes the gate even with teamscope held');
});

test('kpis() names the Leads filter behind five lines and leaves every metric with no matching population plain', () => {
  const { ST } = require('./src/domain/index.ts');
  const M = selectors.kpis(fixture('manager'));
  const byK = Object.fromEntries(M.map(m => [m.k, m]));
  assert.deepEqual(byK.l2q.jump, { LSTAGE: ST.QUALIFIED, LSTAGEMODE: 'from' });
  assert.deepEqual(byK.q2r.jump, { LSTAGE: ST.RESERVED, LSTAGEMODE: 'from' });
  assert.deepEqual(byK.r2p.jump, { LSTAGE: ST.PAID, LSTAGEMODE: 'from' });
  assert.deepEqual(byK.unass.jump, { LQ: 'unassigned' });
  assert.deepEqual(byK.lost.jump, { LFILT: 'lost' });
  for (const k of ['first', 'day3', 'median', 'perev', 'nonev', 'touch', 'cb']) {
    assert.equal(byK[k].jump, undefined, k + ' has no field on the book yet, so its value stays plain text');
  }
});

test('numAgeBands buckets the active book by quietDays, not the capture date (Primitive B\'s Numbers caller)', () => {
  const { numAgeBands } = require('./src/features/numbers/panels.ts');
  const oldCaptureRecentTouch = { ...lead('age1', 'Long captured, touched Tuesday', 'owner'),
    done: 3, at: ['01 May 10:00'], touch: { msg: ['26 Aug 09:00'] } };
  const ctx = { ...fixture('manager'), LEADS: [oldCaptureRecentTouch], INTERACTIONS: {} };
  const rows = numAgeBands(ctx);
  const total = row => row[row.length - 1];
  assert.equal(total(rows.find(r => r[0] === '0–7 d')), 1,
    'touched two days ago reads young by quietDays even though it was captured in May');
  assert.equal(total(rows.find(r => r[0] === '31 d +')), 0,
    'the old capture-date bucketing would have wrongly landed this in 31 d +');
});

test('lostRows keeps a reason whose only lost lead has since been re-opened (Change 4 part 2)', () => {
  const { NumbersLive } = require('./src/features/numbers/NumbersLive.tsx');
  const state = fixture('manager');
  const own = state.LEADS.find(l => l.id === 'own');
  own.lostWas = [{ why: 'Lock-in too long', note: '', at: '20 Aug 10:00', by: 'owner', stage: 2,
    reopened: '21 Aug 10:00', reby: 'manager' }];
  state.SEC = { 'numbers:book': 'lost' };
  const html = render(NumbersLive, state);
  assert(!html.includes('Nothing has been closed as lost yet.'),
    'a reason with no live lost lead but a re-opened close must not read as an empty book');
  assert(html.includes('Lock-in too long'), 'the reason row itself must still render');
  assert(html.includes('closed for this reason, later re-opened'),
    'the lighter re-opened segment must be present, not just the row');
});

test('useJumpToLeads clears LLOST like clearLeadFilters/toLeads, off one shared constant (Change 6 / bits.tsx)', () => {
  const { useJumpToLeads } = require('./src/features/numbers/bits.tsx');
  const { CLEARED_LEAD_FILTERS } = require('./src/lib/selectors/leads.ts');
  assert.equal(CLEARED_LEAD_FILTERS.LLOST, false,
    'the shared reset must clear "Include closed leads" or every jump leaves it on');
  const state = fixture('manager');
  state.ui = { ...state.ui, LLOST: true };
  const dispatched = [];
  const previous = store.useConsole;
  store.useConsole = () => ({ state, dispatch: a => dispatched.push(a) });
  function Probe() { useJumpToLeads()({ LFILT: 'dormant' }); return null; }
  try { renderToStaticMarkup(React.createElement(Probe)); } finally { store.useConsole = previous; }
  const setUi = dispatched.find(a => a.type === 'setUi');
  assert(setUi, 'a conv manager must pass the hasLeads gate for the jump to dispatch at all');
  assert.equal(setUi.patch.LLOST, false, 'the stale toggle must be cleared, not merged forward');
  assert.equal(setUi.patch.LFILT, 'dormant', 'the caller\'s own cut must still win over the cleared defaults');
});
