import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from './app.js';
import {approvedPages} from '../src/book-progress.js';
import {copyWeek} from '../src/planning.js';
test('page progress counts approved pages once and source copies retain ranges only',()=>{
 assert.equal(approvedPages([{book_id:'b',status:'approved',page_start:1,page_end:10},{book_id:'b',status:'approved',page_start:5,page_end:15},{book_id:'b',status:'approved',page_start:20,page_end:22},{book_id:'b',status:'submitted',page_start:16,page_end:19},{book_id:'other',status:'approved',page_start:1,page_end:100}],'b'),18);
 const copied=copyWeek([{student:'s',date:'2026-10-12',subject:'Matematik',title:'Test',detail:'Çöz',questions:20,book_id:'b',page_start:5,page_end:10,status:'approved',photos:['private']}],'s','2026-10-19');assert.deepEqual(copied[0].sources,{s:{bookId:'b',pageStart:5,pageEnd:10}});assert.equal(copied[0].photos,undefined);assert.equal(copied[0].status,undefined);
});
test('student books enforce source ownership, completion, scope, bulk integrity and persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ed-books-'));let runtime=createApp({dataDir:dir}),server=runtime.app.listen(0);await new Promise(r=>server.once('listening',r));let url='http://127.0.0.1:'+server.address().port;
 const password='books-test-password';const add=(name,role,extra={})=>runtime.addUser({name,email:name+'@test.local',password,role,...extra});const admin=add('admin','super_admin'),coord=add('coord','coordinator'),coach=add('coach','coach',{coordinator:coord}),other=add('other','coach'),a=add('a','student',{coach,exam:'YKS',class:'12'}),b=add('b','student',{coach,exam:'LGS',class:'8'}),foreign=add('foreign','student',{coach:other}),parent=add('parent','parent',{coach});runtime.db.prepare('INSERT INTO parent_students VALUES(?,?)').run(parent,a);
 const call=(path,method='GET',body,cookie)=>fetch(url+'/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});const login=async name=>{const r=await call('/login','POST',{email:name+'@test.local',password});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]};const state=async c=>(await call('/state','GET',null,c)).json();
 try{
  const cc=await login('coach'),oc=await login('other'),ac=await login('admin'),co=await login('coord'),sc=await login('a'),bc=await login('b'),pc=await login('parent');
  const book={student:a,publisher:'Test Yayınları',title:'Matematik Soru Bankası',subject:'Matematik',pages:20};
  for(const c of [ac,co,sc,pc])assert.equal((await call('/books','POST',book,c)).status,403);assert.equal((await call('/books','POST',{...book,student:foreign},cc)).status,404);assert.equal((await call('/books','POST',{...book,pages:0},cc)).status,400);
  let r=await call('/books','POST',book,cc);assert.equal(r.status,201);const bookA=(await r.json()).id;r=await call('/books','POST',{...book,student:b,publisher:'Farklı Yayın',pages:50},cc);const bookB=(await r.json()).id;
  assert.equal((await state(pc)).books.length,1);assert.equal((await state(oc)).books.length,0);assert.equal((await state(co)).books.length,2);assert.equal((await state(ac)).books.length,2);
  const base={student:a,subject:'Matematik',title:'Üslü sayılar',detail:'Çöz',questions:20,date:'2026-10-19'};
  assert.equal((await call('/tasks','POST',base,cc)).status,400);assert.equal((await call('/tasks','POST',{...base,bookId:bookB,pageStart:1,pageEnd:5},cc)).status,400);assert.equal((await call('/tasks','POST',{...base,bookId:bookA,pageStart:1,pageEnd:21},cc)).status,400);assert.equal((await call('/tasks','POST',{...base,subject:'Türkçe',bookId:bookA,pageStart:1,pageEnd:5},cc)).status,400);
  const ids=[];for(const [pageStart,pageEnd] of [[1,10],[5,15]]){r=await call('/tasks','POST',{...base,bookId:bookA,pageStart,pageEnd},cc);assert.equal(r.status,201);ids.push((await r.json()).id)}
  const batch={week:'2026-10-19',requestId:randomUUID(),studentIds:[a,b],entries:[{...base,sources:{[a]:{bookId:bookA,pageStart:16,pageEnd:20},[b]:{bookId:bookB,pageStart:1,pageEnd:5}}}]};
  r=await call('/tasks/batch','POST',{...batch,entries:[{...base,sources:{[a]:{subject:'Türkçe'},[b]:{bookId:bookB,pageStart:1,pageEnd:5}}}]},cc);assert.equal(r.status,400);assert.equal(runtime.db.prepare('SELECT count(*) n FROM tasks').get().n,2);
  r=await call('/tasks/batch','POST',batch,cc);assert.equal(r.status,201);const batchResult=await r.json();ids.push(batchResult.ids[0]);
  assert.equal((await call('/books/'+bookA,'PATCH',{status:'completed',version:0},cc)).status,409);for(const c of [ac,co,sc,pc])assert.equal((await call('/books/'+bookA,'PATCH',{status:'completed',version:0},c)).status,403);assert.equal((await call('/books/'+bookA,'PATCH',{status:'completed',version:0},oc)).status,404);
  const image=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();for(const id of ids){assert.equal((await call('/tasks/'+id,'PATCH',{status:'submitted',version:0,note:'Bitti',photos:['data:image/jpeg;base64,'+image.toString('base64')]},sc)).status,200);assert.equal((await call('/tasks/'+id,'PATCH',{status:'approved',version:1,feedback:'Onay'},cc)).status,200)}
  let s=await state(sc);assert.equal(s.books[0].approved_pages,20);assert.equal(s.books[0].status,'active');assert.equal(s.tasks[0].book.title,book.title);assert.equal(s.tasks[0].page_start,1);
  assert.equal((await call('/books/'+bookA,'PATCH',{status:'completed',version:0},cc)).status,200);s=await state(pc);assert.equal(s.books[0].status,'completed');assert.ok(s.books[0].completed_at);assert.equal(s.tasks[0].book.id,bookA);
  assert.equal((await call('/tasks','POST',{...base,bookId:bookA,pageStart:1,pageEnd:5},cc)).status,400);
  // Network retry after book completion returns the original result, never new work.
  r=await call('/tasks/batch','POST',batch,cc);assert.equal(r.status,200);assert.deepEqual(await r.json(),batchResult);
  assert.equal((await call('/tasks/batch','POST',{...batch,requestId:randomUUID()},cc)).status,400);
  assert.equal((await call('/books/'+bookA,'PATCH',{status:'active',version:0},cc)).status,409);assert.equal((await call('/books/'+bookA,'PATCH',{status:'active',version:1},cc)).status,200);
  r=await call('/impersonation/start','POST',{userId:coach},ac);const imp=r.headers.get('set-cookie').split(';')[0];r=await call('/books','POST',{...book,title:'Diğer kaynak',subject:'Türkçe'},imp);assert.equal(r.status,201);const extraBook=(await r.json()).id;assert.equal(runtime.db.prepare('SELECT original_actor FROM management_events WHERE action=?').get('book:create:'+extraBook).original_actor,admin);
  await new Promise(r=>server.close(r));runtime.db.close();runtime=createApp({dataDir:dir});server=runtime.app.listen(0);await new Promise(r=>server.once('listening',r));url='http://127.0.0.1:'+server.address().port;s=await state(sc);assert.equal(s.books.length,2);assert.equal(s.books.find(b=>b.id===bookA).approved_pages,20);assert.equal((await state(bc)).books[0].id,bookB);
 }finally{await new Promise(r=>server.close(r));runtime.db.close();rmSync(dir,{recursive:true,force:true})}
});
