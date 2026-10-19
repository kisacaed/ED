import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from './app.js';
import {followupTasks,weekStart,copyWeek,validDate,addDays} from '../src/planning.js';

test('follow-up distinguishes missing work from submitted work and approval; weeks cross year boundaries',()=>{
 const tasks=[{id:'late',date:'2026-10-18',status:'todo',title:'A'},{id:'rev',date:'2026-10-18',status:'revision',title:'B'},{id:'review',date:'2026-10-18',status:'submitted',title:'C'},{id:'done',date:'2026-10-18',status:'approved',title:'D'},{id:'today',date:'2026-10-19',status:'todo',title:'E'},{id:'future',date:'2026-10-20',status:'todo',title:'F'}];
 assert.deepEqual(followupTasks(tasks,'overdue','2026-10-19').map(t=>t.id),['late','rev']);assert.deepEqual(followupTasks(tasks,'submitted','2026-10-19').map(t=>t.id),['review']);assert.deepEqual(followupTasks(tasks,'today','2026-10-19').map(t=>t.id),['today']);assert.deepEqual(followupTasks(tasks,'revision','2026-10-19').map(t=>t.id),['rev']);
 assert.equal(weekStart('2027-01-03'),'2026-12-28');assert.equal(addDays('2026-12-28',7),'2027-01-04');assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2028-02-29'),true);
 const previous=[{student:'a',date:'2026-12-31',title:'Test',detail:'Çöz',subject:'Matematik',questions:30,status:'approved',photos:['private']},{student:'b',date:'2026-12-31',title:'Other'}];
 const copied=copyWeek(previous,'a','2027-01-04');assert.deepEqual(copied,[{date:'2027-01-07',subject:'Matematik',title:'Test',detail:'Çöz',questions:30}]);assert.equal(previous[0].date,'2026-12-31');
});

test('weekly batch is authorized, atomic, idempotent, audited and visible to students/parents',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ed-week-')),runtime=createApp({dataDir:dir}),{db}=runtime,server=runtime.app.listen(0);await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
 const password='weekly-test-password';const add=(name,role,extra={})=>runtime.addUser({name,email:name+'@test.local',password,role,...extra});const admin=add('admin','super_admin'),coord=add('coord','coordinator'),coach=add('coach','coach',{coordinator:coord}),other=add('other','coach'),a=add('a','student',{coach,exam:'YKS',class:'12'}),b=add('b','student',{coach,exam:'LGS',class:'8'}),foreign=add('foreign','student',{coach:other}),parent=add('parent','parent',{coach});db.prepare('INSERT INTO parent_students VALUES(?,?)').run(parent,a);
 const call=(path,body,cookie)=>fetch(url+'/api'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});const login=async name=>{const r=await call('/login',{email:name+'@test.local',password});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]};
 const entry={date:'2026-10-19',subject:'Matematik',title:'Üslü sayılar',detail:'Test 1',questions:20};const payload={requestId:randomUUID(),week:'2026-10-19',studentIds:[a,b],entries:[entry,{...entry,date:'2026-10-25',title:'Hafta sonu tekrarı'}]};const count=()=>db.prepare('SELECT count(*) n FROM tasks').get().n;
 try{
  const cc=await login('coach'),ac=await login('admin'),sc=await login('a'),pc=await login('parent'),oc=await login('other'),co=await login('coord');
  assert.equal((await call('/tasks/batch',payload)).status,401);for(const cookie of [ac,sc,pc,co,oc])assert.equal((await call('/tasks/batch',payload,cookie)).status,403);
  assert.equal((await call('/tasks/batch',{...payload,studentIds:[a,foreign]},cc)).status,403);
  assert.equal((await call('/tasks/batch',{...payload,studentIds:[a,a]},cc)).status,403);
  assert.equal((await call('/tasks/batch',{...payload,entries:[entry,{...entry,date:'2026-10-26'}]},cc)).status,400);
  assert.equal((await call('/tasks/batch',{...payload,entries:[entry,{...entry,questions:0}]},cc)).status,400);
  assert.equal((await call('/tasks/batch',{...payload,week:'2026-10-20'},cc)).status,400);assert.equal(count(),0);
  // A mid-transaction database failure must roll back every task and audit row.
  db.exec("CREATE TRIGGER reject_test_task BEFORE INSERT ON tasks WHEN NEW.title='Hafta sonu tekrarı' BEGIN SELECT RAISE(ABORT,'test rollback'); END");assert.equal((await call('/tasks/batch',payload,cc)).status,500);assert.equal(count(),0);assert.equal(db.prepare('SELECT count(*) n FROM events').get().n,0);db.exec('DROP TRIGGER reject_test_task');
  let response=await call('/tasks/batch',payload,cc);assert.equal(response.status,201);const saved=await response.json();assert.equal(saved.count,4);assert.equal(count(),4);assert.equal(db.prepare("SELECT count(*) n FROM events WHERE action='create'").get().n,4);
  response=await call('/tasks/batch',payload,cc);assert.equal(response.status,200);assert.deepEqual(await response.json(),saved);assert.equal(count(),4);
  assert.equal((await call('/tasks/batch',{...payload,entries:[entry]},cc)).status,409);assert.equal(count(),4);
  assert.equal((await (await call('/state',null,sc)).json()).tasks.length,2);assert.equal((await (await call('/state',null,pc)).json()).tasks.length,2);assert.equal((await (await call('/state',null,oc)).json()).tasks.length,0);
  let r=await call('/impersonation/start',{userId:coach},ac);assert.equal(r.status,200);const imp=r.headers.get('set-cookie').split(';')[0];r=await call('/tasks/batch',{...payload,requestId:randomUUID(),studentIds:[a],entries:[entry]},imp);assert.equal(r.status,201);const id=(await r.json()).ids[0];assert.equal(db.prepare('SELECT original_actor FROM events WHERE task=?').get(id).original_actor,admin);
  assert.equal(db.prepare('SELECT status FROM tasks WHERE id=?').get(id).status,'todo');
 }finally{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true})}
});
