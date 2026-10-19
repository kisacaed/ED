import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createApp} from './app.js';
test('authenticated assignment lifecycle and isolation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ed-test-'));let runtime=createApp({dataDir:dir});let server=runtime.app.listen(0);await new Promise(r=>server.once('listening',r));let url='http://127.0.0.1:'+server.address().port;
 const password='test-only-password-123';const coach=runtime.addUser({name:'Coach',email:'coach@test.local',password});runtime.addUser({name:'Other coach',email:'other@test.local',password});
 const call=async(path,method='GET',body,cookie)=>{const r=await fetch(url+'/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return r};
 const login=async(email)=>{const r=await call('/login','POST',{email,password});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]};
 try{
 assert.equal((await call('/state')).status,401);assert.equal((await call('/login','POST',{email:'coach@test.local',password:'incorrect'})).status,401);
 const cc=await login('coach@test.local'),oc=await login('other@test.local');
 for(const [name,email] of [['Student','student@test.local'],['Peer','peer@test.local']])assert.equal((await call('/students','POST',{name,email,password,exam:'YKS',class:'12. sınıf'},cc)).status,201);
 const sc=await login('student@test.local'),pc=await login('peer@test.local');
 let state=await (await call('/state','GET',null,cc)).json(),student=state.students.find(s=>s.email==='student@test.local');
 assert.equal((await call('/students','POST',{name:'Bad'},sc)).status,403);
 const assignment={student:student.id,subject:'Matematik',title:'Türev',detail:'20 soru çöz',questions:20,date:'2026-10-19'};
 assert.equal((await call('/tasks','POST',assignment,oc)).status,403);
 const response=await call('/tasks','POST',assignment,cc);assert.equal(response.status,201);const {id}=await response.json();
 const image=await sharp({create:{width:20,height:20,channels:3,background:'white'}}).jpeg().toBuffer(),photos=['data:image/jpeg;base64,'+image.toString('base64')];
 const submit={version:0,status:'submitted',note:'Tamamlandı',photos};
 assert.equal((await call('/tasks/'+id,'PATCH',submit,pc)).status,404);
 assert.equal((await call('/tasks/'+id,'PATCH',{...submit,photos:[]},sc)).status,400);
 assert.equal((await call('/tasks/'+id,'PATCH',submit,sc)).status,200);
 assert.equal((await call('/tasks/'+id,'PATCH',submit,sc)).status,409);
 state=await (await call('/state','GET',null,cc)).json();const photo=state.tasks[0].photos[0];
 assert.equal((await fetch(url+photo)).status,401);assert.equal((await fetch(url+photo,{headers:{cookie:pc}})).status,404);assert.equal((await fetch(url+photo,{headers:{cookie:cc}})).status,200);
 assert.equal((await call('/tasks/'+id,'PATCH',{version:1,status:'approved',feedback:''},sc)).status,409);
 assert.equal((await call('/tasks/'+id,'PATCH',{version:1,status:'revision',feedback:''},cc)).status,400);
 assert.equal((await call('/tasks/'+id,'PATCH',{version:1,status:'revision',feedback:'İşlemleri ekle'},cc)).status,200);
 assert.equal((await call('/tasks/'+id,'PATCH',{...submit,version:2},sc)).status,200);
 assert.equal((await call('/tasks/'+id,'PATCH',{version:3,status:'approved',feedback:'Tebrikler'},cc)).status,200);
 assert.equal((await call('/tasks/'+id,'PATCH',{...submit,version:4},sc)).status,409);
 assert.equal((await (await call('/state','GET',null,oc)).json()).tasks.length,0);
 assert.equal(runtime.db.prepare('SELECT count(*) AS n FROM events').get().n,5);
 await new Promise(r=>server.close(r));runtime.db.close();runtime=createApp({dataDir:dir});server=runtime.app.listen(0);await new Promise(r=>server.once('listening',r));url='http://127.0.0.1:'+server.address().port;
 state=await (await call('/state','GET',null,sc)).json();assert.equal(state.tasks[0].status,'approved');assert.equal(state.tasks[0].photos.length,1);
 assert.equal((await call('/logout','POST',{},sc)).status,200);assert.equal((await call('/state','GET',null,sc)).status,401);
 }finally{await new Promise(r=>server.close(r));runtime.db.close();rmSync(dir,{recursive:true,force:true})}
});

test('parent access is linked, read-only, revocable and persistent',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ed-parent-'));let runtime=createApp({dataDir:dir});let server=runtime.app.listen(0);await new Promise(r=>server.once('listening',r));let url='http://127.0.0.1:'+server.address().port;
 const password='parent-test-password-123';
 const c=runtime.addUser({name:'Coach',email:'coach@test.local',password});const other=runtime.addUser({name:'Other',email:'other@test.local',password});
 const ids=['one','two','peer'].map((name,i)=>runtime.addUser({name,email:name+'@test.local',password,role:'student',coach:i===2?other:c,exam:'YKS',class:'12'}));
 const call=(path,method='GET',body,cookie)=>fetch(url+'/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
 const login=async email=>{const r=await call('/login','POST',{email,password});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]};
 try{
  const cc=await login('coach@test.local'),oc=await login('other@test.local'),sc=await login('one@test.local');
  const parent={name:'Parent',email:'parent@test.local',password,students:[ids[0]]};
  assert.equal((await call('/parents','POST',parent,sc)).status,403);
  assert.equal((await call('/parents','POST',{...parent,students:[ids[0],ids[2]]},cc)).status,400);
  assert.equal(runtime.db.prepare("SELECT count(*) n FROM users WHERE role='parent'").get().n,0);
  const created=await call('/parents','POST',parent,cc);assert.equal(created.status,201);const {id}=await created.json(),pc=await login('parent@test.local');
  for(const student of ids)assert.equal((await call('/tasks','POST',{student,subject:'Matematik',title:'Test',detail:'Çöz',questions:20,date:'2026-10-19'},student===ids[2]?oc:cc)).status,201);
  let state=await (await call('/state','GET',null,pc)).json();assert.equal(state.user.role,'parent');assert.deepEqual(state.students.map(s=>s.id),[ids[0]]);assert.equal(state.tasks.length,1);assert.equal(state.parents.length,0);
  const task=state.tasks[0],photo=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer();
  assert.equal((await call('/tasks/'+task.id,'PATCH',{version:0,status:'submitted',note:'Bitti',photos:['data:image/png;base64,'+photo.toString('base64')]},sc)).status,200);
  state=await (await call('/state','GET',null,pc)).json();assert.equal(state.tasks[0].status,'submitted');const photoPath=state.tasks[0].photos[0];assert.equal((await fetch(url+photoPath,{headers:{cookie:pc}})).status,200);
  for(const status of ['approved','revision','submitted'])assert.equal((await call('/tasks/'+task.id,'PATCH',{version:1,status,feedback:'test',note:'test',photos:[]},pc)).status,403);
  assert.equal((await call('/tasks','POST',{student:ids[0]},pc)).status,403);assert.equal((await call('/students','POST',{},pc)).status,403);assert.equal((await call('/parents','POST',parent,pc)).status,403);
  assert.equal((await call('/parents/'+id+'/students','PUT',{students:[ids[1]]},oc)).status,404);
  assert.equal((await call('/parents/'+id+'/students','PUT',{students:[ids[1]]},pc)).status,403);
  assert.equal((await call('/parents/'+id+'/students','PUT',{students:[ids[2]]},cc)).status,400);
  assert.equal((await call('/parents/'+id+'/students','PUT',{students:[ids[0],ids[1]]},cc)).status,200);
  state=await (await call('/state','GET',null,pc)).json();assert.equal(state.students.length,2);assert.equal(state.tasks.length,2);
  const foreign=runtime.db.prepare('SELECT id FROM photos WHERE task=?').get(task.id);assert.ok(foreign);
  assert.equal((await call('/parents/'+id+'/students','PUT',{students:[ids[1]]},cc)).status,200);
  assert.equal((await fetch(url+photoPath,{headers:{cookie:pc}})).status,404);
  await new Promise(r=>server.close(r));runtime.db.close();runtime=createApp({dataDir:dir});server=runtime.app.listen(0);await new Promise(r=>server.once('listening',r));url='http://127.0.0.1:'+server.address().port;
  state=await (await call('/state','GET',null,pc)).json();assert.deepEqual(state.students.map(s=>s.id),[ids[1]]);
  assert.equal((await call('/parents/'+id+'/students','PUT',{students:[]},cc)).status,200);
  state=await (await call('/state','GET',null,pc)).json();assert.equal(state.students.length,0);assert.equal(state.tasks.length,0);
 }finally{await new Promise(r=>server.close(r));runtime.db.close();rmSync(dir,{recursive:true,force:true})}
});
