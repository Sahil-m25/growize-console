const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('./node_modules/typescript');
const filename = path.join(__dirname, 'src/lib/save-queue.ts');
const program = ts.createProgram([filename], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true, noEmit: true, skipLibCheck: true });
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: f => f, getCurrentDirectory: () => __dirname, getNewLine: () => '\n' }));
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const moduleValue = { exports: {} };
vm.runInNewContext(compiled, { exports: moduleValue.exports, module: moduleValue, Promise, Map, Error }, { filename });
const { createSaveQueue, SAVE_WAIT_MS } = moduleValue.exports;
let checks = 0;
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
const ok = (actual, message) => { assert(actual, message); checks++; };
function harness() {
  let time = 0, online = false, session = { actor: 'ir-a', session: 1 }, sequence = 0;
  const timers = new Map(), changes = [];
  const h = { online: v => { online = v; }, session: v => { session = v; }, now: () => time, timers, changes, changed: null };
  h.queue = createSaveQueue({ clock: () => time, setTimer: (fn, delay) => { const id = sequence++; timers.set(id, { fn, at: time + delay }); return id; }, clearTimer: id => timers.delete(id), isOnline: () => online, currentSession: () => session, onChange: c => { changes.push(c); h.changed?.(c); } });
  h.advance = (ms, fire = true) => { time += ms; if (!fire) return; let count = 0; for (;;) { const due = [...timers.entries()].find(([, t]) => t.at <= time); if (!due) break; assert(++count < 100, 'Timer must not busy-loop'); timers.delete(due[0]); due[1].fn(); } };
  h.task = (key, execute, validate = () => true) => ({ key, id: key + '-id', label: 'Save ' + key, ...session, validate, execute });
  return h;
}
async function main() {
  eq(SAVE_WAIT_MS, 300000, 'Waiting uses exactly five elapsed minutes');
  {
    const h = harness(); let executed = 0;
    const task = h.task('note', () => { executed++; return true; });
    eq(h.queue.enqueue(task).status, 'pending', 'Offline enqueue waits instead of claiming success');
    eq(executed, 0, 'Offline enqueue does not execute the write');
    eq(h.queue.snapshot()[0].deadline, 300000, 'Deadline starts at enqueue');
    eq(h.queue.enqueue(h.task('note', () => { executed += 100; return true; })).accepted, false, 'A duplicate key does not replace the captured task');
    eq(h.queue.snapshot().length, 1, 'Duplicate submission occupies one queue slot');
    eq(h.changes.filter(c => c.kind === 'queued').length, 1, 'Duplicate submission does not emit another queued event');
    h.advance(299999); h.online(true); h.queue.reconnect(); h.queue.reconnect();
    eq(executed, 1, 'Reconnection before the deadline executes the original task once');
    eq(h.queue.snapshot().length, 0, 'Confirmed completion removes the task');
    eq(h.changes.filter(c => c.kind === 'completed').length, 1, 'Completion is emitted once');
    eq(h.changes.at(-1).entry.status, 'completed', 'Completion callback reports confirmed status');
    eq(h.timers.size, 0, 'Successful completion cancels its expiry timer, including handle zero');
    eq(h.queue.retry('note').accepted, false, 'A completed task cannot be manually replayed');
  }
  {
    const h = harness(); let executed = 0;
    h.queue.enqueue(h.task('expired', () => { executed++; return true; }));
    h.advance(299999); eq(h.queue.snapshot()[0].status, 'pending', 'Still pending one millisecond before expiry');
    h.advance(1); eq(h.queue.snapshot()[0].status, 'failed', 'Expiry fails at the exact five-minute boundary');
    h.online(true); h.queue.reconnect(); eq(executed, 0, 'Expired work never resumes automatically');
    h.online(false); h.advance(5000);
    eq(h.queue.retry('expired').status, 'pending', 'Manual retry preserves the task and opens a fresh offline window');
    const deadline = h.queue.snapshot()[0].deadline;
    eq(deadline, 605000, 'Manual retry starts a new five-minute deadline');
    eq(h.queue.retry('expired').accepted, false, 'Repeated retry while pending cannot extend the window');
    eq(h.queue.snapshot()[0].deadline, deadline, 'Repeated retry does not move its deadline');
    h.advance(299999); h.online(true); h.queue.reconnect(); eq(executed, 1, 'A valid manually retried task executes once');
  }
  {
    const h = harness(); let executed = 0;
    h.queue.enqueue(h.task('late', () => { executed++; return true; }));
    h.advance(300000, false); h.online(true); h.queue.reconnect();
    eq(executed, 0, 'Reconnect cannot beat an overdue timer at the exact boundary');
    eq(h.queue.snapshot()[0].status, 'failed', 'Delayed timers still use wall-clock expiry');
    eq(h.queue.retry('late').status, 'completed', 'Explicit retry after boundary is separately acknowledged');
    eq(executed, 1, 'Boundary retry executes only the fresh attempt');
  }
  {
    const h = harness(); let permitted = true, executed = 0;
    h.queue.enqueue(h.task('revoked', () => { executed++; return true; }, () => permitted));
    permitted = false; h.online(true); h.queue.reconnect();
    eq(executed, 0, 'Revoked authorization blocks reconnection replay');
    eq(h.queue.snapshot()[0].status, 'failed', 'Revoked work is retained as failed');
    eq(h.queue.retry('revoked').accepted, false, 'Manual retry must revalidate current authorization');
    permitted = true; eq(h.queue.retry('revoked').status, 'completed', 'Restored authorization permits explicit retry');
    eq(executed, 1, 'Only the authorized attempt executes');
  }
  {
    const h = harness(); let executed = 0;
    h.queue.enqueue(h.task('private-a', () => { executed++; return true; }));
    h.session({ actor: 'ir-b', session: 2 });
    eq(h.queue.snapshot().length, 0, 'A new account cannot see queued labels from the old account');
    eq(h.timers.size, 0, 'An account switch cancels old timers');
    h.online(true); h.queue.reconnect(); eq(executed, 0, 'An old actor task never writes as the new account');
    h.session({ actor: 'ir-a', session: 3 }); eq(h.queue.retry('private-a').accepted, false, 'Switching back to the old actor cannot resurrect the old session');
    eq(h.queue.enqueue({ ...h.task('wrong-session', () => true), session: 1 }).status, 'rejected', 'A stale session is rejected at enqueue');
  }
  {
    const h = harness(); let resolve, executed = 0;
    h.online(true);
    eq(h.queue.enqueue(h.task('async', () => { executed++; return new Promise(r => { resolve = r; }); })).status, 'saving', 'An unresolved execute Promise is saving, not completed');
    h.queue.reconnect(); eq(executed, 1, 'Reconnect does not execute an in-flight task twice');
    h.queue.reset(); const events = h.changes.length;
    resolve(true); await Promise.resolve(); await Promise.resolve();
    eq(h.changes.length, events, 'A late async completion after reset emits no old-session callback');
    eq(h.queue.snapshot().length, 0, 'A late completion cannot recreate canceled task state');
    eq(h.timers.size, 0, 'Reset removes every pending timer');
  }
  {
    const h = harness(); let count = 0;
    h.online(true);
    eq(h.queue.enqueue(h.task('false', () => ++count > 1)).status, 'failed', 'Execute false does not fabricate success');
    h.queue.reconnect(); eq(count, 1, 'Failed execution does not auto-retry');
    eq(h.queue.retry('false').status, 'completed', 'Manual retry can complete after a confirmed true response');
    eq(count, 2, 'A failed task is executed only once per explicit attempt');
    h.queue.enqueue(h.task('throw', () => { throw new Error('Rejected write'); }));
    eq(h.queue.snapshot()[0].error, 'Rejected write', 'Thrown failures retain their retry reason');
    h.queue.enqueue(h.task('truthy', () => 'yes'));
    eq(h.queue.snapshot().find(e => e.key === 'truthy').status, 'failed', 'Truthy values other than literal true are not acknowledgements');
    h.queue.enqueue(h.task('promise-false', () => Promise.resolve(false))); await Promise.resolve(); await Promise.resolve();
    eq(h.queue.snapshot().find(e => e.key === 'promise-false').status, 'failed', 'Promise false remains failed and retryable');
    h.queue.enqueue(h.task('promise-true', () => Promise.resolve(true))); await Promise.resolve(); await Promise.resolve();
    ok(!h.queue.snapshot().some(e => e.key === 'promise-true'), 'Promise true confirms and removes the successful task');
  }
  {
    const h = harness(); let executed = 0;
    const task = h.task('frozen', () => { executed++; return true; }); h.queue.enqueue(task);
    task.key = 'changed'; task.actor = 'ir-b'; task.execute = () => { executed += 100; return true; };
    const snapshot = h.queue.snapshot(); snapshot[0].actor = 'ir-b'; snapshot[0].deadline = -1;
    eq(h.queue.snapshot()[0].actor, 'ir-a', 'Public snapshots cannot change queue identity');
    eq(h.queue.snapshot()[0].deadline, 300000, 'Public snapshots cannot change expiry');
    const early = [...h.timers.values()][0]; h.timers.clear(); early.fn();
    eq(h.queue.snapshot()[0].status, 'pending', 'An early timer does not expire unelapsed waiting time');
    eq(h.timers.size, 1, 'An early timer rearms until the true deadline');
    h.online(true); h.queue.reconnect(); eq(executed, 1, 'Caller mutation cannot replace captured actor, key or execute closure');
  }
  {
    const h = harness(); let executed = 0;
    h.online(true); h.changed = c => { if (c.kind === 'queued') h.queue.reset(); };
    eq(h.queue.enqueue(h.task('reset-during-change', () => { executed++; return true; })).status, 'rejected', 'Reset during callback is never misreported as completion');
    eq(executed, 0, 'Reset during callback cancels execution');
    h.changed = c => { if (c.kind === 'saving') h.session({ actor: 'ir-b', session: 2 }); };
    h.queue.enqueue(h.task('switch-during-change', () => { executed++; return true; }));
    eq(executed, 0, 'Identity is rechecked after rendering before execution');
    eq(h.queue.snapshot().length, 0, 'Callback identity switch does not expose old task state');
  }
  {
    const h = harness(); let executed = 0;
    h.online(true); h.changed = c => { if (c.kind === 'saving') h.online(false); };
    eq(h.queue.enqueue(h.task('lost-network', () => { executed++; return true; })).status, 'pending', 'Losing network before execute returns the task to waiting');
    eq(executed, 0, 'Network is checked again immediately before execute');
    eq(h.queue.snapshot()[0].deadline, 300000, 'A last-moment network loss does not extend the waiting deadline');
    h.changed = null; h.online(true); h.queue.reconnect(); eq(executed, 1, 'A later reconnect acknowledges the waiting task once');
  }
  {
    const h = harness(); let executed = 0;
    h.online(true); h.changed = c => { if (c.kind === 'saving') h.advance(300000, false); };
    eq(h.queue.enqueue(h.task('deadline-during-change', () => { executed++; return true; })).status, 'failed', 'A deadline reached during a callback cannot slip into execution');
    eq(executed, 0, 'Elapsed time is rechecked immediately before execute');
  }
  {
    const h = harness(); let resolve;
    h.online(true); h.queue.enqueue(h.task('async-old-actor', () => new Promise(r => { resolve = r; })));
    h.session({ actor: 'ir-b', session: 2 }); resolve(true); await Promise.resolve(); await Promise.resolve();
    eq(h.queue.snapshot().length, 0, 'Async settlement discards an old actor even if the consumer forgot to reset');
    eq(h.changes.filter(c => c.kind === 'completed').length, 0, 'An old actor acknowledgement is not shown to the new actor');
  }
  {
    const h=harness();let resolve;
    h.online(true);h.queue.enqueue(h.task('discard-inflight',()=>new Promise(r=>{resolve=r;})));
    h.online(false);h.queue.enqueue(h.task('keep-unrelated',()=>true));
    eq(h.timers.size,1,'Unrelated pending task has its own timer');
    h.queue.discard('discard-inflight');
    eq(h.queue.snapshot().length,1,'Discard removes only the requested in-flight entry');
    eq(h.queue.snapshot()[0].key,'keep-unrelated','Discard preserves another task identity');
    eq(h.queue.snapshot()[0].status,'pending','Discard preserves another task status');
    eq(h.timers.size,1,'Discard keeps another task timer');
    const events=h.changes.length;resolve(true);await Promise.resolve();await Promise.resolve();
    eq(h.changes.length,events,'Discarded in-flight acknowledgement emits no callback');
    eq(h.queue.snapshot().length,1,'Late discarded settlement cannot recreate its entry or erase another task');
    h.queue.discard('keep-unrelated');eq(h.timers.size,0,'Discard cancels the specified pending timer');
    eq(h.queue.snapshot().length,0,'Discard can remove a pending entry independently');
  }
  console.log(`save queue: ${checks} regression checks passed`);
}
main().then(runWriterIntegrations).catch(error => { console.error(error); process.exitCode = 1; });

async function runWriterIntegrations() {
  const Module = require('node:module');
  const resolver = Module._resolveFilename;
  Module._resolveFilename = function(request, parent, ...rest) {
    return resolver.call(this, request.startsWith('@/') ? path.join(__dirname,'src',request.slice(2)) : request, parent, ...rest);
  };
  for(const extension of ['.ts','.tsx']) require.extensions[extension] = (loaded, file) => loaded._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:file,
  }).outputText,file);
  const loader = Module._load;
  Module._load = function(request,...rest) { return request==='next/navigation' ? {useRouter:()=>({push(){},replace(){}})} : loader.call(this,request,...rest); };
  const store = require('./src/lib/store.tsx');
  const selectors = require('./src/lib/selectors/index.ts');
  const { createConsoleWriter } = require('./src/lib/console-save.ts');
  const { TopBar } = require('./src/components/shell/TopBar.tsx');
  const React = require('react'), {renderToStaticMarkup} = require('react-dom/server');
  let integrations = 0;
  const same = (actual, expected, message) => {assert.equal(actual,expected,message);integrations++;};
  const verify = (condition,message) => {assert(condition,message);integrations++;};
  const person = (n,seat,mgr=null)=>({n,i:n.slice(0,2),seat,mgr,on:true,c:1,em:'test@example.invalid',ph:''});
  const lead = (id,own,sec=null)=>({id,n:'Investor '+id,own,sec,ph:'9000012345',em:'',city:'Test',src:'Referral',ev:null,done:3,
    at:['20 Aug 10:00','21 Aug 10:00','22 Aug 10:00'],touch:{call:[],msg:[],email:[]},consent:true,con:{call:true,msg:true,email:true},
    units:1,nx:{t:'Follow up',by:'29 Aug',d:'2026-08-29'},fc:null,by:own});
  function portHarness(actor='a') {
    const PEOPLE={a:person('Operator A','ir','manager'),b:person('Operator B','ir','manager'),manager:person('IR Manager','conv'),readonly:person('Read-only manager','ops')};
    let state={...store.initialState(),FIXTURES:true,WHO:actor,ROLE:PEOPLE[actor].seat,PEOPLE,LEADS:[lead('one','a'),lead('two','a'),lead('shared','b','a'),lead('unassigned',null)],
      NOW:new Date(2026,7,28,12),TODAY:new Date(2026,7,28),LOG:[],NOTES:{},PAPER:{},PAY:{},DOCS:[],CLAIM:{},REQ:{},EXT:{},CALLS:{},SENT:{},PACK:{},ACCT:{},
      AVAIL:{},COVER:{},TEMP:[],CAPS:{},TEMPON:null,DRW:null,ui:{},SC:{today:'mine',leads:'mine',activity:'mine'},SEC:{}};
    let online=false,time=0,session=0,calls=0,acknowledgements=0;
    const writer=createConsoleWriter({clock:()=>time,setTimer:()=>0,clearTimer(){},isOnline:()=>online,
      currentSession:()=>({actor:state.WHO,session}),read:()=>state,write:next=>{if(next.WHO!==state.WHO)session++;state=next;},
      reduce:(s,a)=>{calls++;return store.reducer(s,a);},leadWrites:store.LEAD_WRITES,onChange:c=>{if(c.kind==='completed')acknowledgements++;}});
    return {writer,state:()=>state,alter:fn=>{state=fn(state);},online:()=>{online=true;},clock:ms=>{time+=ms;},calls:()=>calls,acks:()=>acknowledgements};
  }
  {
    const h=portHarness();h.writer.apply({type:'logTouch',id:'one',k:'call'});h.writer.apply({type:'logTouch',id:'two',k:'msg'});
    same(h.calls(),0,'Offline multi-record submission does not evaluate the business reducer');same(h.writer.snapshot().length,2,'Separate investors have separate waiting changes');
    h.online();h.writer.reconnect();h.writer.reconnect();
    same(h.state().LEADS.find(l=>l.id==='one').touch.call.length,1,'First queued investor drains once');
    same(h.state().LEADS.find(l=>l.id==='two').touch.msg.length,1,'Second queued investor drains once despite first changing the global audit');
    same(h.calls(),2,'Multi-record drain evaluates the reducer once per action');same(h.acks(),2,'Each accepted local action receives exactly one acknowledgement');same(h.writer.snapshot().length,0,'Multi-record completion empties the queue');
  }
  {
    const h=portHarness();h.online();h.alter(s=>({...s,LEADS:s.LEADS.map(l=>l.id==='one'?{...l,con:{...l.con,call:false}}:l)}));
    const before=h.state();same(h.writer.apply({type:'logTouch',id:'one',k:'call'}).status,'failed','A real online consent refusal is failed');same(h.state(),before,'Online reducer refusal changes neither record nor audit');
    same(h.acks(),0,'A failed real reducer write has no local acknowledgement');h.writer.reconnect();same(h.calls(),1,'An online failure never retries on reconnect');
  }
  {
    const h=portHarness();h.writer.apply({type:'logTouch',id:'one',k:'call'});h.writer.apply({type:'setPerson',k:'b'});h.writer.apply({type:'setPerson',k:'a'});
    same(h.writer.snapshot().length,0,'A full account cycle discards the first session queue');h.online();h.writer.reconnect();same(h.state().LOG.length,0,'Returning to the same account cannot replay a previous session');
  }
  {
    /* ir-console-redesigned.html:13498 (`protectLocalSave`) calls the real function directly once
       the browser is online, never through `commit()` — only `commit()`'s own try block reads
       `FAILNEXT` (line 4731). So the System test toggle fails the next write that goes through
       `commit()`, and never a `setMe` (or the rest of that wrapped list) landing while online. */
    const h=portHarness();h.online();h.alter(s=>({...s,FAILNEXT:true}));
    same(h.writer.apply({type:'setMe',f:'ph',v:'+91 90000 00000'}).status,'completed','setMe bypasses FAILNEXT, matching protectLocalSave calling the write directly online');
    same(h.state().PEOPLE.a.ph,'+91 90000 00000','The exempt write actually lands');
    same(h.state().FAILNEXT,true,'FAILNEXT stays armed after an exempt write');
    same(h.writer.apply({type:'logTouch',id:'one',k:'call'}).status,'failed','FAILNEXT still fails the next commit()-routed write');
    same(h.state().FAILNEXT,false,'A failed commit()-routed write consumes FAILNEXT');
  }
  for(const change of ['edit-cap','assignment-cap','consent','owner-availability','secondary-availability','standing-cover','draft','target-active','target-seat','target-manager','capture-target-active','sheet-target-active','actor-role','actor-active']) {
    const manager=['assignment-cap','target-active','target-seat','target-manager','capture-target-active'].includes(change);
    const h=portHarness(manager?'manager':'a');
    let action={type:'logTouch',id:'one',k:'call'};
    if(change==='secondary-availability') { h.alter(s=>({...s,AVAIL:{b:{why:'On leave',from:'2026-08-25',to:'2026-08-30',by:'manager',at:'25 Aug 09:00'}}}));action.id='shared'; }
    if(change==='standing-cover') h.alter(s=>({...s,COVER:{a:{by:'b',from:'27 Aug 2026',to:'29 Aug 2026'}}}));
    if(change==='draft') {h.writer.apply({type:'setUi',patch:{NXD:{t:'Original planned call',d:'2026-08-29',tm:''}}});action={type:'saveNext',id:'one'};}
    if(['assignment-cap','target-active','target-seat','target-manager'].includes(change)) action={type:'assign',id:'unassigned',to:'b'};
    if(change==='capture-target-active') {
      h.writer.apply({type:'setUi',patch:{ADDN:'New captured investor',ADDPH:'9000098765',ADDOWN:'b',ADDSRC:'Referral',ADDCON:{call:true,msg:false,email:false},ADDHOW:'call',ADDU:'1'}});action={type:'addLead'};
    }
    if(change==='sheet-target-active') {
      h.alter(s=>({...s,EVENTS:[{id:'E-test',n:'Test event',type:'Society',ch:'MyGate',date:'28 Aug',city:'Test',cost:0,staff:['b'],state:'done',off:0}],SHEET:{'E-test':{state:'ready',ok:1,by:'manager'}},ui:{...s.ui,AR:'one',ARWHO:'b'}}));action={type:'loadSheet',ev:'E-test'};
    }
    const enqueued=h.writer.apply(action);same(enqueued.status,'pending',`${change}: valid original submission queues`);
    if(change==='edit-cap') h.alter(s=>({...s,CAPS:{a:{leads:['view']}}}));
    if(change==='assignment-cap') h.alter(s=>({...s,CAPS:{manager:{leads:['view','edit']}}}));
    if(change==='consent') h.alter(s=>({...s,LEADS:s.LEADS.map(l=>l.id==='one'?{...l,con:{...l.con,call:false}}:l)}));
    if(change==='owner-availability') h.alter(s=>({...s,AVAIL:{a:{why:'On leave',from:'2026-08-25',to:'2026-08-30',by:'manager',at:'25 Aug 09:00'}}}));
    if(change==='secondary-availability') h.alter(s=>({...s,AVAIL:{}}));
    if(change==='standing-cover') h.alter(s=>({...s,COVER:{}}));
    if(change==='draft') h.writer.apply({type:'setUi',patch:{NXD:{t:'A newer unsaved call',d:'2026-08-30',tm:''}}});
    if(['target-active','capture-target-active','sheet-target-active'].includes(change)) h.alter(s=>({...s,PEOPLE:{...s.PEOPLE,b:{...s.PEOPLE.b,on:false}}}));
    if(change==='target-seat') h.alter(s=>({...s,PEOPLE:{...s.PEOPLE,b:{...s.PEOPLE.b,seat:'ops'}}}));
    if(change==='target-manager') h.alter(s=>({...s,PEOPLE:{...s.PEOPLE,b:{...s.PEOPLE.b,mgr:'readonly'}}}));
    if(change==='actor-role') h.alter(s=>({...s,PEOPLE:{...s.PEOPLE,a:{...s.PEOPLE.a,seat:'ops'}}}));
    if(change==='actor-active') h.alter(s=>({...s,PEOPLE:{...s.PEOPLE,a:{...s.PEOPLE.a,on:false}}}));
    const before=JSON.stringify({leads:h.state().LEADS,notes:h.state().NOTES,log:h.state().LOG,sheet:h.state().SHEET});
    h.online();h.writer.reconnect();
    same(JSON.stringify({leads:h.state().LEADS,notes:h.state().NOTES,log:h.state().LOG,sheet:h.state().SHEET}),before,`${change}: changed authority/context cannot mutate records or audit`);
    same(h.writer.snapshot()[0].status,'failed',`${change}: queued action remains a visible failure`);same(h.acks(),0,`${change}: no successful acknowledgement`);
  }
  {
    const h=portHarness();h.writer.apply({type:'setUi',patch:{ADDN:'Captured once',ADDPH:'9000098765',ADDSRC:'Referral',ADDCON:{call:true,msg:false,email:false},ADDHOW:'call',ADDU:'1'}});
    const first=h.writer.apply({type:'addLead'});same(first.status,'pending','Valid capture waits offline');same(h.writer.apply({type:'addLead'}).accepted,false,'Same capture is not duplicated');
    h.online();h.writer.reconnect();same(h.state().LEADS.filter(l=>l.id==='N1').length,1,'Captured lead ID is minted once');
    same(h.state().LOG.filter(e=>e.what==='Added lead').length,1,'Same action creates one capture audit');same(h.state().ui.ADDN,'','Draft clears only after local acceptance');
    same(h.writer.retry(first.key).accepted,false,'Completed capture ID cannot be minted again by retry');
  }
  {
    /* The redesign replaced the old <details><summary class="tag"> disclosure with the
       prototype's own always-visible `#save-status` live region (saveStatusHTML(), 03-app.js
       :4668-4680) — a `save-dot` toned "failed"/"waiting"/"online" (never "connected"/"offline",
       which were never the prototype's own class names), and a summary line whose optional
       clauses are joined by " · ", "Last local update HH:MM" among them. */
    const s=portHarness().state();const original=store.useConsole;
    for(const online of [true,false]) {
      store.useConsole=()=>({state:s,dispatch(){},saves:[],browserOnline:online,lastLocalUpdate:1000,retrySave(){}});
      const html=renderToStaticMarkup(React.createElement(TopBar,{view:'leads'}));
      const summary=html.match(/<div id="save-status"[^>]*>([\s\S]*?)<\/div>/)[1];
      verify(summary.includes(`save-dot ${online?'online':'waiting'}`),'Browser connection dot reflects the online/offline tone even when nothing is queued');
      verify(html.includes(`Browser ${online?'online':'offline'} · Local demo`),'Browser online/offline state is stated plainly');
      verify(summary.includes('Last local update'),'Last local acknowledgement time is visible without opening status');
      verify(!summary.includes('Server')&&!summary.includes('live'),'Compact status does not claim a server refresh');
    }
    store.useConsole=original;
  }
  for (const oldStatus of ['pending', 'failed']) {
    const h = portHarness();
    h.writer.apply({type:'setUi',patch:{NDRAFT:'Original failed note'}});
    const old = h.writer.apply({type:'addNote',id:'one'});
    if(oldStatus==='failed') { h.clock(300000); h.writer.expire(); }
    same(h.writer.snapshot()[0].status,oldStatus,'Original note has the intended prior status');
    const unrelated = h.writer.apply({type:'logTouch',id:'two',k:'call'});
    h.writer.apply({type:'setUi',patch:{NDRAFT:'A reviewed fresh note'}});h.online();
    same(h.writer.apply({type:'addNote',id:'one'}).status,'completed','Fresh reviewed note is locally accepted');
    same(h.state().NOTES.one.length,1,'Only the fresh note is written');
    same(h.state().NOTES.one[0].t,'A reviewed fresh note','Accepted note keeps the reviewed text');
    verify(!h.writer.snapshot().some(entry=>entry.key===old.key),'Fresh confirmation retires prior same-record note status');
    same(h.writer.snapshot().length,1,'Retirement preserves an unrelated investor queue slot');
    same(h.writer.snapshot()[0].key,unrelated.key,'Unrelated investor action retains its original key');
    same(h.writer.snapshot()[0].status,'pending','Unrelated investor action is still pending');
  }
  {
    const h=portHarness();h.writer.apply({type:'setUi',patch:{ADDN:'Unreviewed capture',ADDPH:'9000098765',ADDSRC:'Referral',ADDCON:{call:true,msg:false,email:false},ADDHOW:'call',ADDU:'1'}});
    const old=h.writer.apply({type:'addLead'});h.clock(300000);h.writer.expire();
    const unrelated=h.writer.apply({type:'logTouch',id:'two',k:'call'});
    h.writer.apply({type:'setUi',patch:{ADDN:'Reviewed capture'}});h.online();
    same(h.writer.apply({type:'addLead'}).status,'completed','Fresh capture confirms the reviewed investor');
    same(h.state().LEADS.filter(l=>l.id==='N1').length,1,'Fresh capture still mints one ID');
    same(h.state().LEADS.find(l=>l.id==='N1').n,'Reviewed capture','Old capture text cannot be replayed');
    verify(!h.writer.snapshot().some(entry=>entry.key===old.key),'Fresh capture removes its prior failed indicator');
    same(h.writer.snapshot().length,1,'Fresh capture leaves unrelated waiting work intact');same(h.writer.snapshot()[0].key,unrelated.key,'Unrelated key is preserved across fresh capture');
  }
  {
    const h=portHarness();h.writer.apply({type:'setUi',patch:{NDRAFT:'Prior note'}});
    const old=h.writer.apply({type:'addNote',id:'one'});h.clock(300000);h.writer.expire();
    h.writer.apply({type:'setUi',patch:{NDRAFT:''}});h.online();
    same(h.writer.apply({type:'addNote',id:'one'}).status,'failed','Fresh invalid submission is not confirmation');
    same(h.writer.snapshot().length,2,'Fresh failure preserves prior failed work');
    verify(h.writer.snapshot().some(entry=>entry.key===old.key),'Prior failed key is not retired after a new failure');
    same(h.state().NOTES.one,undefined,'Neither failed attempt writes a note');
  }
  {
    const h=portHarness(), qualified=require('./src/domain/index.ts').ST.QUALIFIED;
    h.alter(s=>({...s,LEADS:s.LEADS.map(l=>l.id==='one'?{...l,done:qualified}:l)}));
    const earlier=h.writer.apply({type:'setFc',id:'one',c:'pipeline'}),later=h.writer.apply({type:'setFc',id:'one',c:'probable'});
    h.writer.apply({type:'setFc',id:'one',c:'pipeline'}); // Duplicate submission cannot change its original order.
    h.online();h.writer.reconnect();
    verify(!h.writer.snapshot().some(e=>e.key===earlier.key),'Earlier confirmed forecast completes');
    same(h.writer.snapshot().length,1,'Earlier confirmation cannot discard a later conflicting intention');
    same(h.writer.snapshot()[0].key,later.key,'Later conflicting intention remains visible for review');
    same(h.writer.snapshot()[0].status,'failed','Later conflicting forecast fails its changed-record check');
  }
  console.log(`console writer: ${integrations} real-reducer integration checks passed`);
}
