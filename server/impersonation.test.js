import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {createApp} from './app.js';
test('super admin can use actual user permissions with rotated sessions and attributable writes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ed-impersonation-'));let runtime=createApp({dataDir:dir});let server=runtime.app.listen(0);await new Promise(r=>server.once('listening',r));let url='http://127.0.0.1:'+server.address().port;
 const password='test-impersonation-password';const add=(name,role,extra={})=>runtime.addUser({name,email:name+'@test.local',password,role,...extra});
 const admin=add('admin','super_admin'),otherAdmin=add('other-admin','super_admin'),coord=add('coord','coordinator'),coach=add('coach','coach',{coordinator:coord}),other=add('other','coach'),student=add('student','student',{coach,exam:'LGS',class:'8'}),peer=add('peer','student',{coach:other,exam:'YKS',class:'12'}),parent=add('parent','parent',{coach});runtime.db.prepare('INSERT INTO parent_students VALUES(?,?)').run(parent,student);
 const call=(path,method='GET',body,cookie,headers={})=>fetch(url+'/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
 const cookie=r=>r.headers.get('set-cookie')?.split(';')[0];
 const login=async name=>{const r=await call('/login','POST',{email:name+'@test.local',password});assert.equal(r.status,200);return cookie(r)};
 const state=async c=>(await call('/state','GET',null,c)).json();
 try{
  let ac=await login('admin');const sc=await login('student');
  assert.equal((await call('/impersonation/start','POST',{userId:student})).status,401);
  for(const name of ['coord','coach','student','parent'])assert.equal((await call('/impersonation/start','POST',{userId:admin},await login(name))).status,403);
  assert.equal((await call('/impersonation/start','POST',{userId:admin},ac)).status,400);assert.equal((await call('/impersonation/start','POST',{userId:'missing'},ac)).status,404);
  assert.equal((await call('/impersonation/start','POST',{userId:student},ac,{Origin:'https://attacker.invalid'})).status,403);
  const oldAdmin=ac;let r=await call('/impersonation/start','POST',{userId:coach},ac);assert.equal(r.status,200);ac=cookie(r);assert.notEqual(ac,oldAdmin);assert.match(r.headers.get('set-cookie'),/HttpOnly/i);assert.match(r.headers.get('set-cookie'),/SameSite=Strict/i);
  assert.equal((await call('/state','GET',null,oldAdmin)).status,401);
  let s=await state(ac);assert.equal(s.user.id,coach);assert.equal(s.impersonation.id,admin);assert.deepEqual(s.students.map(u=>u.id),[student]);
  assert.equal((await call('/management','GET',null,ac)).status,403);assert.equal((await call('/impersonation/start','POST',{userId:student},ac)).status,403);
  const assignment={student,subject:'Matematik',title:'Admin test ödevi',detail:'Çöz',questions:20,date:'2026-10-19'};
  assert.equal((await call('/tasks','POST',assignment,ac,{'X-ED-User':admin})).status,409);
  assert.equal((await call('/tasks','POST',{...assignment,student:peer},ac)).status,403);
  const taskResponse=await call('/tasks','POST',assignment,ac,{'X-ED-User':coach});assert.equal(taskResponse.status,201);const {id}=await taskResponse.json();
  assert.equal(runtime.db.prepare("SELECT original_actor FROM events WHERE task=? AND action='create'").get(id).original_actor,admin);
  const oldCoach=ac;r=await call('/impersonation/stop','POST',{},ac);assert.equal(r.status,200);ac=cookie(r);assert.equal((await call('/state','GET',null,oldCoach)).status,401);assert.equal((await state(ac)).user.id,admin);assert.equal((await state(ac)).impersonation,null);
  r=await call('/impersonation/start','POST',{userId:student},ac);ac=cookie(r);
  assert.equal((await state(ac)).user.id,student);assert.equal((await call('/tasks','POST',assignment,ac)).status,403);
  const img=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer();assert.equal((await call('/tasks/'+id,'PATCH',{version:0,status:'submitted',note:'Test',photos:['data:image/png;base64,'+img.toString('base64')]},ac)).status,200);
  let event=runtime.db.prepare("SELECT * FROM events WHERE task=? AND action='submitted'").get(id);assert.equal(event.actor,student);assert.equal(event.original_actor,admin);
  // The student's own session is unaffected by the admin switching identities.
  assert.equal((await state(sc)).user.id,student);assert.equal((await state(sc)).impersonation,null);
  await new Promise(r=>server.close(r));runtime.db.close();runtime=createApp({dataDir:dir});server=runtime.app.listen(0);await new Promise(r=>server.once('listening',r));url='http://127.0.0.1:'+server.address().port;
  assert.equal((await state(ac)).impersonation.id,admin);r=await call('/impersonation/stop','POST',{},ac);ac=cookie(r);
  r=await call('/impersonation/start','POST',{userId:coach},ac);ac=cookie(r);assert.equal((await call('/tasks/'+id,'PATCH',{version:1,status:'approved',feedback:'Test onayı'},ac)).status,200);
  event=runtime.db.prepare("SELECT * FROM events WHERE task=? AND action='approved'").get(id);assert.equal(event.actor,coach);assert.equal(event.original_actor,admin);
  r=await call('/impersonation/stop','POST',{},ac);ac=cookie(r);r=await call('/impersonation/start','POST',{userId:parent},ac);ac=cookie(r);s=await state(ac);assert.equal(s.user.id,parent);assert.equal(s.tasks[0].status,'approved');assert.equal((await call('/tasks/'+id,'PATCH',{version:2,status:'revision',feedback:'test'},ac)).status,403);
  r=await call('/impersonation/stop','POST',{},ac);ac=cookie(r);r=await call('/impersonation/start','POST',{userId:coord},ac);ac=cookie(r);assert.equal((await call('/management','GET',null,ac)).status,200);
  const created=await call('/management/users','POST',{name:'New Coach',email:'new@test.local',password,role:'coach'},ac);assert.equal(created.status,201);const newId=(await created.json()).id;event=runtime.db.prepare('SELECT * FROM management_events WHERE target=?').get(newId);assert.equal(event.actor,coord);assert.equal(event.original_actor,admin);
  r=await call('/impersonation/stop','POST',{},ac);ac=cookie(r);r=await call('/impersonation/start','POST',{userId:otherAdmin},ac);ac=cookie(r);assert.equal((await call('/impersonation/start','POST',{userId:student},ac)).status,403);
  r=await call('/impersonation/stop','POST',{},ac);ac=cookie(r);r=await call('/impersonation/start','POST',{userId:parent},ac);ac=cookie(r);assert.equal((await call('/logout','POST',{},ac)).status,200);assert.equal((await call('/state','GET',null,ac)).status,401);
  assert.equal(runtime.db.prepare("SELECT original_actor FROM management_events WHERE action='impersonation:logout'").get().original_actor,admin);
  ac=await login('admin');r=await call('/impersonation/start','POST',{userId:student},ac);ac=cookie(r);runtime.db.prepare("UPDATE users SET role='coach' WHERE id=?").run(admin);assert.equal((await call('/state','GET',null,ac)).status,401);
 }finally{await new Promise(r=>server.close(r));runtime.db.close();rmSync(dir,{recursive:true,force:true})}
});

test('impersonation cannot be granted through request data, ordinary sessions or role promotion',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ed-imp-lock-'));const {app,db,addUser}=createApp({dataDir:dir});const server=app.listen(0);await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
 const password='test-permission-password';const add=(name,role)=>addUser({name,email:name+'@test.local',password,role});
 const admin=add('admin','super_admin'),target=add('target','student');
 const call=(path,body,cookie,headers={})=>fetch(url+'/api'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
 const login=async name=>{const r=await call('/login',{email:name+'@test.local',password,role:'super_admin',canImpersonate:true,can_impersonate:1});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]};
 try{
  for(const role of ['coordinator','coach','student','parent']){
   const id=add(role,role),c=await login(role);let r=await call('/state',null,c);assert.equal((await r.json()).canImpersonate,false);
   const count=db.prepare('SELECT count(*) n FROM sessions').get().n;
   r=await call('/impersonation/start',{userId:target,role:'super_admin',actor:admin,originalUser:{id:admin,role:'super_admin'},impersonator:admin,can_impersonate:1},c,{'X-Role':'super_admin','X-User-Id':admin});assert.equal(r.status,403);assert.equal(r.headers.get('set-cookie'),null);assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,count);
   assert.equal((await call('/impersonation/stop',{originalUser:admin,impersonator:admin},c)).status,400);
   // An existing low-privilege session does not gain this feature even after promotion.
   db.prepare("UPDATE users SET role='super_admin' WHERE id=?").run(id);assert.equal((await call('/impersonation/start',{userId:target},c)).status,403);
   db.prepare('UPDATE users SET role=? WHERE id=?').run(role,id);
  }
  assert.equal(db.prepare("SELECT count(*) n FROM management_events WHERE action='impersonation:start'").get().n,0);
  const c=await login('admin');assert.equal((await (await call('/state',null,c)).json()).canImpersonate,true);
  // Legacy sessions have no permission until the super admin signs in again.
  db.prepare('UPDATE sessions SET can_impersonate=0 WHERE user=?').run(admin);assert.equal((await call('/impersonation/start',{userId:target},c)).status,403);
  const fresh=await login('admin');assert.equal((await call('/impersonation/start',{userId:target},fresh)).status,200);
 }finally{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true})}
});
