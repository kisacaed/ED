import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {approvedPages} from '../src/book-progress.js';
import {validDate,weekStart,addDays} from '../src/planning.js';
export function createApp({dataDir=resolve('data'),secure=process.env.NODE_ENV==='production'}={}) {
 mkdirSync(dataDir,{recursive:true,mode:0o700});
 const db=new DatabaseSync(resolve(dataDir,'ed.sqlite'));
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,coach TEXT REFERENCES users(id),exam TEXT,class TEXT);
 CREATE TABLE IF NOT EXISTS parent_students(parent TEXT REFERENCES users(id),student TEXT REFERENCES users(id),PRIMARY KEY(parent,student));
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user TEXT REFERENCES users(id),expires INTEGER);
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,student TEXT REFERENCES users(id),subject TEXT,title TEXT,detail TEXT,questions INTEGER,date TEXT,status TEXT,note TEXT DEFAULT '',feedback TEXT DEFAULT '',version INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,task TEXT REFERENCES tasks(id),content BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,task TEXT REFERENCES tasks(id),actor TEXT REFERENCES users(id),action TEXT,at TEXT DEFAULT CURRENT_TIMESTAMP);`);
 // Additive migration preserves existing users, sessions, submissions and photos.
 const userColumns=db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
 if(!userColumns.includes('coordinator'))db.exec('ALTER TABLE users ADD COLUMN coordinator TEXT REFERENCES users(id)');
 if(!userColumns.includes('version'))db.exec('ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 0');
 db.exec('CREATE TABLE IF NOT EXISTS management_events(id INTEGER PRIMARY KEY,actor TEXT REFERENCES users(id),target TEXT REFERENCES users(id),action TEXT,at TEXT DEFAULT CURRENT_TIMESTAMP)');
 const sessionColumns=db.prepare('PRAGMA table_info(sessions)').all().map(c=>c.name);
 if(!sessionColumns.includes('impersonator'))db.exec('ALTER TABLE sessions ADD COLUMN impersonator TEXT REFERENCES users(id)');
 if(!sessionColumns.includes('can_impersonate'))db.exec('ALTER TABLE sessions ADD COLUMN can_impersonate INTEGER NOT NULL DEFAULT 0');
 for(const table of ['events','management_events']){
  if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name==='original_actor'))db.exec('ALTER TABLE '+table+' ADD COLUMN original_actor TEXT REFERENCES users(id)');
 }
 db.exec('CREATE TABLE IF NOT EXISTS task_batches(actor TEXT REFERENCES users(id),request_id TEXT,payload_hash TEXT,result TEXT,PRIMARY KEY(actor,request_id))');
 db.exec(`CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY,student TEXT NOT NULL REFERENCES users(id),publisher TEXT NOT NULL,title TEXT NOT NULL,subject TEXT NOT NULL,pages INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',version INTEGER NOT NULL DEFAULT 0,completed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
 const taskColumns=db.prepare('PRAGMA table_info(tasks)').all().map(c=>c.name);
 if(!taskColumns.includes('book_id'))db.exec('ALTER TABLE tasks ADD COLUMN book_id TEXT REFERENCES books(id)');
 if(!taskColumns.includes('page_start'))db.exec('ALTER TABLE tasks ADD COLUMN page_start INTEGER');
 if(!taskColumns.includes('page_end'))db.exec('ALTER TABLE tasks ADD COLUMN page_end INTEGER');
 const hash=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex')};
 const check=(p,h)=>{const [s,v]=h.split(':');return timingSafeEqual(scryptSync(p,s,64),Buffer.from(v,'hex'))};
 const text=(v,max=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
 const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,coach:u.coach,coordinator:u.coordinator,version:u.version,exam:u.exam,class:u.class,initials:u.name.split(' ').map(s=>s[0]).slice(0,2).join('')});
 function addUser(v){if(!text(v.name,100)||!text(v.email,254)||!/^\S+@\S+\.\S+$/.test(v.email)||!text(v.password,128)||v.password.length<12)throw Error('Ad, geçerli e-posta ve en az 12 karakterli parola gereklidir.');if(!['super_admin','coordinator','coach','student','parent'].includes(v.role||'coach'))throw Error('Geçersiz rol.');const id=randomUUID();db.prepare('INSERT INTO users(id,name,email,password,role,coach,exam,class,coordinator) VALUES(?,?,?,?,?,?,?,?,?)').run(id,v.name.trim(),v.email.trim().toLowerCase(),hash(v.password),v.role||'coach',v.coach||null,v.exam||null,v.class||null,v.coordinator||null);return id;}
 const app=express();app.disable('x-powered-by');
 app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'});if(req.path.startsWith('/api'))res.set('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)){const origin=req.get('origin');if(origin&&origin!==(process.env.PUBLIC_ORIGIN||`${req.protocol}://${req.get('host')}`))return res.status(403).json({error:'Geçersiz istek kaynağı.'});if(!req.is('application/json'))return res.status(415).json({error:'JSON gerekli.'});}next()});
 app.use(express.json({limit:'16mb'}));
 const attempts=new Map();
 app.post('/api/login',(req,res)=>{const key=req.socket.remoteAddress,now=Date.now(),a=attempts.get(key);if(a&&now-a.at<600000&&a.count>=15)return res.status(429).json({error:'Çok fazla deneme. 10 dakika sonra tekrar deneyin.'});if(!a||now-a.at>=600000)attempts.set(key,{count:0,at:now});attempts.get(key).count++;const {email,password}=req.body;if(!text(email,254)||!text(password,128))return res.status(400).json({error:'E-posta ve parola gerekli.'});const user=db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase());if(!user||!check(password,user.password))return res.status(401).json({error:'E-posta veya parola hatalı.'});attempts.delete(key);const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(now);db.prepare('INSERT INTO sessions(token,user,expires,can_impersonate) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),user.id,now+86400000,user.role==='super_admin'?1:0);res.cookie('ed_session',token,{httpOnly:true,secure,sameSite:'strict',path:'/',maxAge:86400000});res.json(publicUser(user));});
 app.use('/api',(req,res,next)=>{
  const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('ed_session='))?.slice(11);
  if(!token)return res.status(401).json({error:'Oturum açmanız gerekiyor.'});
  req.token=createHash('sha256').update(token).digest('hex');
  const session=db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(req.token,Date.now());
  req.user=session&&db.prepare('SELECT * FROM users WHERE id=?').get(session.user);
  if(!req.user)return res.status(401).json({error:'Oturumunuz sona erdi.'});
  req.session=session;
  req.originalUser=session.impersonator?db.prepare("SELECT * FROM users WHERE id=? AND role='super_admin'").get(session.impersonator):null;
  if(session.impersonator&&!req.originalUser){db.prepare('DELETE FROM sessions WHERE token=?').run(req.token);return res.status(401).json({error:'Süper admin oturumu artık geçerli değil.'})}
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('X-ED-User')&&req.get('X-ED-User')!==req.user.id)return res.status(409).json({error:'Aktif hesap başka bir sekmede değişti. Sayfayı yenileyin.'});
  next();
 });
 const canImpersonate=req=>req.user.role==='super_admin'&&!req.originalUser&&!req.session.impersonator&&req.session.can_impersonate===1;
 const rotateSession=(req,res,user,impersonator)=>{
  const token=randomBytes(32).toString('hex'),expires=req.session.expires;
  db.prepare('DELETE FROM sessions WHERE token=?').run(req.token);
  db.prepare('INSERT INTO sessions(token,user,expires,impersonator,can_impersonate) VALUES(?,?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),user,expires,impersonator,impersonator?0:1);
  res.cookie('ed_session',token,{httpOnly:true,secure,sameSite:'strict',path:'/',maxAge:Math.max(0,expires-Date.now())});
 };
 app.post('/api/impersonation/start',(req,res)=>{
  if(!canImpersonate(req))return res.status(403).json({error:'Bu işlem yalnızca kendi hesabındaki süper admine açıktır.'});
  if(typeof req.body.userId!=='string')return res.status(400).json({error:'Kullanıcı seçin.'});
  const target=db.prepare('SELECT * FROM users WHERE id=?').get(req.body.userId);
  if(!target)return res.status(404).json({error:'Kullanıcı bulunamadı.'});
  if(target.id===req.user.id)return res.status(400).json({error:'Zaten kendi hesabınızdasınız.'});
  db.exec('BEGIN IMMEDIATE');try{managementEvent(req.user.id,target.id,'impersonation:start',req.user.id);rotateSession(req,res,target.id,req.user.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  res.json({ok:true});
 });
 app.post('/api/impersonation/stop',(req,res)=>{
  if(!req.originalUser)return res.status(400).json({error:'Aktif kullanıcı görünümü yok.'});
  db.exec('BEGIN IMMEDIATE');try{managementEvent(req.user.id,req.user.id,'impersonation:stop',req.originalUser.id);rotateSession(req,res,req.originalUser.id,null);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  res.json({ok:true});
 });
 app.post('/api/logout',(req,res)=>{
  if(req.originalUser)managementEvent(req.user.id,req.user.id,'impersonation:logout',req.originalUser.id);
  db.prepare('DELETE FROM sessions WHERE token=?').run(req.token);res.clearCookie('ed_session',{path:'/',httpOnly:true,secure,sameSite:'strict'});res.json({ok:true});
 });
 const isManager=u=>['super_admin','coordinator'].includes(u.role);
 const canManageCoach=(u,id)=>typeof id==='string'&&!!db.prepare("SELECT id FROM users WHERE id=? AND role='coach'").get(id)&&(u.role==='super_admin'||(u.role==='coordinator'&&!!db.prepare('SELECT id FROM users WHERE id=? AND coordinator=?').get(id,u.id)));
 const canAccess=(u,student)=>{
  if(u.role==='student')return u.id===student;
  if(u.role==='parent')return !!db.prepare('SELECT 1 FROM parent_students WHERE parent=? AND student=?').get(u.id,student);
  const s=db.prepare("SELECT * FROM users WHERE id=? AND role='student'").get(student);
  if(!s)return false;
  if(u.role==='super_admin')return true;
  if(u.role==='coordinator')return canManageCoach(u,s.coach);
  return u.role==='coach'&&s.coach===u.id;
 };
 const canManageParent=(u,p)=>{
  if(u.role==='super_admin')return true;
  if(!['coach','coordinator'].includes(u.role))return false;
  const links=db.prepare('SELECT student FROM parent_students WHERE parent=?').all(p.id);
  if(links.length)return links.every(r=>canAccess(u,r.student));
  return (u.role==='coach'&&p.coach===u.id)||(u.role==='coordinator'&&canManageCoach(u,p.coach));
 };
 const managedUsers=u=>u.role==='super_admin'?db.prepare('SELECT * FROM users ORDER BY rowid').all():db.prepare("SELECT * FROM users WHERE (role='coach' AND coordinator=?) OR (role='student' AND coach IN (SELECT id FROM users WHERE coordinator=? AND role='coach')) ORDER BY rowid").all(u.id,u.id);
 const managementEvent=(actor,target,action,originalActor=null)=>db.prepare('INSERT INTO management_events(actor,target,action,original_actor) VALUES(?,?,?,?)').run(actor,target,action,originalActor);
 app.get('/api/management',(req,res)=>{
  if(!isManager(req.user))return res.sendStatus(403);
  res.json({users:managedUsers(req.user).map(publicUser)});
 });
 app.post('/api/management/users',(req,res)=>{
  const u=req.user,v=req.body;
  if(!isManager(u))return res.sendStatus(403);
  if(!['coordinator','coach'].includes(v.role)||(u.role==='coordinator'&&v.role!=='coach'))return res.status(403).json({error:'Bu rolü oluşturma yetkiniz yok.'});
  const coordinator=v.role==='coach'?(u.role==='coordinator'?u.id:(v.coordinator||null)):null;
  if(coordinator&&!db.prepare("SELECT id FROM users WHERE id=? AND role='coordinator'").get(coordinator))return res.status(400).json({error:'Geçerli bir koordinatör seçin.'});
  db.exec('BEGIN IMMEDIATE');try{const id=addUser({name:v.name,email:v.email,password:v.password,role:v.role,coordinator});managementEvent(u.id,id,'create:'+v.role,req.originalUser?.id||null);db.exec('COMMIT');res.status(201).json({id})}catch(e){db.exec('ROLLBACK');res.status(400).json({error:e.message.includes('UNIQUE')?'Bu e-posta zaten kayıtlı.':e.message})}
 });
 app.put('/api/management/users/:id/assignment',(req,res)=>{
  const u=req.user,v=req.body;
  if(!isManager(u))return res.sendStatus(403);
  const target=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if(!target||!['coach','student'].includes(target.role)||(u.role==='coordinator'&&(target.role!=='student'||!canAccess(u,target.id))))return res.sendStatus(404);
  if(!Number.isInteger(v.version)||v.version!==target.version)return res.status(409).json({error:'Atama değişti. Listeyi yenileyin.'});
  const supervisor=v.supervisor;
  if(target.role==='coach'){
   if(supervisor!==null&&(typeof supervisor!=='string'||!db.prepare("SELECT id FROM users WHERE id=? AND role='coordinator'").get(supervisor)))return res.status(400).json({error:'Geçerli bir koordinatör seçin.'});
  }else if(typeof supervisor!=='string'||!canManageCoach(u,supervisor))return res.status(400).json({error:'Yetkiniz olan bir koç seçin.'});
  db.exec('BEGIN IMMEDIATE');try{db.prepare(target.role==='coach'?'UPDATE users SET coordinator=?,version=version+1 WHERE id=?':'UPDATE users SET coach=?,version=version+1 WHERE id=?').run(supervisor,target.id);managementEvent(u.id,target.id,'assign:'+String(supervisor),req.originalUser?.id||null);db.exec('COMMIT');res.json({ok:true})}catch(e){db.exec('ROLLBACK');throw e}
 });
 const taskData=t=>({...t,book:t.book_id?db.prepare('SELECT id,title,publisher,pages,subject FROM books WHERE id=?').get(t.book_id):null,photos:db.prepare('SELECT id FROM photos WHERE task=?').all(t.id).map(p=>'/api/photos/'+p.id)});
 app.get('/api/state',(req,res)=>{
  const u=req.user;
  const students=isManager(u)?db.prepare("SELECT * FROM users WHERE role='student'").all().filter(s=>canAccess(u,s.id)):u.role==='coach'?db.prepare("SELECT * FROM users WHERE coach=? AND role='student'").all(u.id):u.role==='parent'?db.prepare('SELECT u.* FROM users u JOIN parent_students p ON p.student=u.id WHERE p.parent=?').all(u.id):u.role==='student'?[u]:[];
  const tasks=students.flatMap(s=>db.prepare('SELECT * FROM tasks WHERE student=? ORDER BY rowid').all(s.id));
  const parents=['super_admin','coordinator','coach'].includes(u.role)?db.prepare("SELECT * FROM users WHERE role='parent'").all().filter(p=>canManageParent(u,p)).map(p=>({...publicUser(p),students:db.prepare('SELECT student FROM parent_students WHERE parent=?').all(p.id).map(r=>r.student)})):[];
  const books=students.flatMap(s=>db.prepare('SELECT * FROM books WHERE student=? ORDER BY rowid').all(s.id)).map(b=>({...b,approved_pages:approvedPages(tasks,b.id),pending_tasks:tasks.filter(t=>t.book_id===b.id&&t.status!=='approved').length}));
  res.json({user:publicUser(u),students:students.map(publicUser),tasks:tasks.map(taskData),books,parents,canImpersonate:canImpersonate(req),impersonation:req.originalUser?publicUser(req.originalUser):null});
 });
 app.post('/api/books',(req,res)=>{
  const u=req.user,v=req.body;if(u.role!=='coach')return res.sendStatus(403);
  if(typeof v.student!=='string'||!canAccess(u,v.student))return res.sendStatus(404);
  if(!text(v.publisher,120)||!text(v.title,160)||!text(v.subject,80)||!Number.isInteger(v.pages)||v.pages<1||v.pages>10000)return res.status(400).json({error:'Yayınevi, kitap adı, ders ve 1–10000 arasında sayfa sayısı gerekli.'});
  const id=randomUUID();db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO books(id,student,publisher,title,subject,pages) VALUES(?,?,?,?,?,?)').run(id,v.student,v.publisher.trim(),v.title.trim(),v.subject.trim(),v.pages);managementEvent(u.id,v.student,'book:create:'+id,req.originalUser?.id||null);db.exec('COMMIT');res.status(201).json({id})}catch(e){db.exec('ROLLBACK');throw e}
 });
 app.patch('/api/books/:id',(req,res)=>{
  if(req.user.role!=='coach')return res.sendStatus(403);
  const b=db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id),v=req.body;
  if(!b||!canAccess(req.user,b.student))return res.sendStatus(404);
  if(v.version!==b.version)return res.status(409).json({error:'Kaynak güncellendi. Listeyi yenileyin.'});
  if(!['active','completed'].includes(v.status))return res.status(400).json({error:'Geçerli kaynak durumu seçin.'});
  if(v.status==='completed'&&db.prepare("SELECT id FROM tasks WHERE book_id=? AND status!='approved' LIMIT 1").get(b.id))return res.status(409).json({error:'Bu kitaba bağlı onaylanmamış ödevler var. Önce teslimleri ve düzeltmeleri tamamlayın.'});
  db.exec('BEGIN IMMEDIATE');try{db.prepare("UPDATE books SET status=?,version=version+1,completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?").run(v.status,v.status,b.id);managementEvent(req.user.id,b.student,'book:'+v.status+':'+b.id,req.originalUser?.id||null);db.exec('COMMIT');res.json({ok:true})}catch(e){db.exec('ROLLBACK');throw e}
 });
 function taskSource(student,t){
  if(!t.bookId){
   if(t.pageStart!=null||t.pageEnd!=null)throw Error('Sayfa aralığı için kaynak kitap seçin.');
   if(db.prepare("SELECT id FROM books WHERE student=? AND subject=? AND status='active' LIMIT 1").get(student,t.subject.trim()))throw Error('Bu ders için öğrencinin aktif kitabından ödev verin.');
   return {bookId:null,pageStart:null,pageEnd:null};
  }
  const book=typeof t.bookId==='string'&&db.prepare('SELECT * FROM books WHERE id=? AND student=?').get(t.bookId,student);
  if(!book||book.status!=='active'||book.subject!==t.subject.trim())throw Error('Öğrenciye ve derse ait aktif bir kaynak seçin.');
  if(!Number.isInteger(t.pageStart)||!Number.isInteger(t.pageEnd)||t.pageStart<1||t.pageEnd<t.pageStart||t.pageEnd>book.pages)throw Error('Sayfa aralığı kitabın 1–'+book.pages+' sayfaları içinde olmalı.');
  return {bookId:book.id,pageStart:t.pageStart,pageEnd:t.pageEnd};
 }
 const validLinks=(u,ids)=>Array.isArray(ids)&&ids.length>0&&ids.length<=100&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&canAccess(u,id));
 app.post('/api/parents',(req,res)=>{
  if(req.user.role!=='coach'&&!isManager(req.user))return res.sendStatus(403);
  if(!validLinks(req.user,req.body.students))return res.status(400).json({error:'Kendi öğrencilerinizden en az birini seçin.'});
  db.exec('BEGIN IMMEDIATE');
  try{const owner=db.prepare('SELECT coach FROM users WHERE id=?').get(req.body.students[0]).coach;const id=addUser({name:req.body.name,email:req.body.email,password:req.body.password,role:'parent',coach:owner});for(const student of req.body.students)db.prepare('INSERT INTO parent_students VALUES(?,?)').run(id,student);managementEvent(req.user.id,id,'create:parent',req.originalUser?.id||null);db.exec('COMMIT');res.status(201).json({id})}
  catch(e){db.exec('ROLLBACK');res.status(400).json({error:e.message.includes('UNIQUE')?'Bu e-posta zaten kayıtlı.':e.message})}
 });
 app.put('/api/parents/:id/students',(req,res)=>{
  if(req.user.role!=='coach'&&!isManager(req.user))return res.sendStatus(403);
  const parent=db.prepare("SELECT * FROM users WHERE id=? AND role='parent'").get(req.params.id);if(!parent||!canManageParent(req.user,parent))return res.sendStatus(404);
  const ids=req.body.students;
  if(!Array.isArray(ids)||(ids.length&&!validLinks(req.user,ids)))return res.status(400).json({error:'Yalnızca kendi öğrencilerinizi bağlayabilirsiniz.'});
  db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM parent_students WHERE parent=?').run(req.params.id);for(const student of ids)db.prepare('INSERT INTO parent_students VALUES(?,?)').run(req.params.id,student);managementEvent(req.user.id,req.params.id,'parent:links:'+ids.join(','),req.originalUser?.id||null);db.exec('COMMIT');res.json({ok:true})}catch(e){db.exec('ROLLBACK');throw e}
 });
 app.post('/api/students',(req,res)=>{
  const u=req.user,v=req.body;if(u.role!=='coach'&&!isManager(u))return res.sendStatus(403);
  const coach=u.role==='coach'?u.id:v.coach;
  if(u.role!=='coach'&&!canManageCoach(u,coach))return res.status(400).json({error:'Yetkiniz olan bir koç seçin.'});
  if(!['LGS','YKS'].includes(v.exam)||!text(v.class,50))return res.status(400).json({error:'Sınav ve sınıf seçin.'});
  db.exec('BEGIN IMMEDIATE');try{const id=addUser({name:v.name,email:v.email,password:v.password,exam:v.exam,class:v.class,role:'student',coach});managementEvent(u.id,id,'create:student',req.originalUser?.id||null);db.exec('COMMIT');res.status(201).json({id})}catch(e){db.exec('ROLLBACK');res.status(400).json({error:e.message.includes('UNIQUE')?'Bu e-posta zaten kayıtlı.':e.message})}
 });
 app.post('/api/tasks/batch',(req,res)=>{
  if(req.user.role!=='coach')return res.sendStatus(403);
  const {requestId,studentIds,entries,week}=req.body;
  if(typeof requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(requestId)||!validDate(week)||weekStart(week)!==week)return res.status(400).json({error:'Geçerli hafta ve işlem kimliği gerekli.'});
  if(!Array.isArray(studentIds)||!studentIds.length||studentIds.length>100||new Set(studentIds).size!==studentIds.length||!studentIds.every(id=>typeof id==='string'&&canAccess(req.user,id)))return res.status(403).json({error:'Yalnızca kendi öğrencilerinize ödev atayabilirsiniz.'});
  if(!Array.isArray(entries)||!entries.length||entries.length>50||entries.length*studentIds.length>500)return res.status(400).json({error:'1–50 plan satırı ve toplam en fazla 500 ödev seçin.'});
  if(!entries.every(t=>t&&text(t.title,120)&&text(t.detail)&&text(t.subject,80)&&Number.isInteger(t.questions)&&t.questions>=1&&t.questions<=1000&&validDate(t.date)&&t.date>=week&&t.date<=addDays(week,6)))return res.status(400).json({error:'Her satırda ders, başlık, yönerge, 1–1000 soru ve seçilen haftada bir tarih gerekli.'});
  const normalized=entries.map(t=>({subject:t.subject.trim(),title:t.title.trim(),detail:t.detail.trim(),questions:t.questions,date:t.date,sources:t.sources||{}}));
  const fingerprint=createHash('sha256').update(JSON.stringify({week,students:[...studentIds].sort(),entries:normalized.map(({sources,...rest})=>Object.keys(sources).length?{...rest,sources}:rest),originalActor:req.originalUser?.id||null})).digest('hex');
  const previous=db.prepare('SELECT * FROM task_batches WHERE actor=? AND request_id=?').get(req.user.id,requestId);
  if(previous){if(previous.payload_hash!==fingerprint)return res.status(409).json({error:'Bu işlem daha önce farklı bir planla kaydedildi. Planı yeniden açın.'});return res.json(JSON.parse(previous.result));}
  const sources=[];try{for(const student of studentIds)for(const t of normalized){const source=t.sources[student];sources.push(taskSource(student,{subject:t.subject,bookId:source?.bookId,pageStart:source?.pageStart,pageEnd:source?.pageEnd}))}}catch(e){return res.status(400).json({error:e.message})}
  const ids=[];db.exec('BEGIN IMMEDIATE');try{
   const insert=db.prepare("INSERT INTO tasks(id,student,subject,title,detail,questions,date,status,book_id,page_start,page_end) VALUES(?,?,?,?,?,?,?,'todo',?,?,?)"),event=db.prepare('INSERT INTO events(task,actor,action,original_actor) VALUES(?,?,?,?)');
   let sourceIndex=0;for(const student of studentIds)for(const t of normalized){const id=randomUUID(),source=sources[sourceIndex++];insert.run(id,student,t.subject,t.title,t.detail,t.questions,t.date,source.bookId,source.pageStart,source.pageEnd);event.run(id,req.user.id,'create',req.originalUser?.id||null);ids.push(id);}
   const result={count:ids.length,ids};db.prepare('INSERT INTO task_batches VALUES(?,?,?,?)').run(req.user.id,requestId,fingerprint,JSON.stringify(result));db.exec('COMMIT');res.status(201).json(result);
  }catch(e){db.exec('ROLLBACK');throw e}
 });
 app.post('/api/tasks',(req,res)=>{const t=req.body;if(req.user.role!=='coach'||!canAccess(req.user,t.student))return res.sendStatus(403);if(!text(t.title,120)||!text(t.detail)||!text(t.subject,80)||!Number.isInteger(t.questions)||t.questions<1||t.questions>1000||!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||!Number.isFinite(Date.parse(t.date+'T00:00:00Z'))||new Date(t.date+'T00:00:00Z').toISOString().slice(0,10)!==t.date)return res.status(400).json({error:'Ödev alanlarını kontrol edin.'});let source;try{source=taskSource(t.student,t)}catch(e){return res.status(400).json({error:e.message})}const id=randomUUID();db.exec('BEGIN IMMEDIATE');try{db.prepare("INSERT INTO tasks(id,student,subject,title,detail,questions,date,status,book_id,page_start,page_end) VALUES(?,?,?,?,?,?,?,'todo',?,?,?)").run(id,t.student,t.subject,t.title.trim(),t.detail.trim(),t.questions,t.date,source.bookId,source.pageStart,source.pageEnd);db.prepare('INSERT INTO events(task,actor,action,original_actor) VALUES(?,?,?,?)').run(id,req.user.id,'create',req.originalUser?.id||null);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}res.status(201).json({id})});
 app.get('/api/photos/:id',(req,res)=>{const p=db.prepare('SELECT p.content,t.student FROM photos p JOIN tasks t ON t.id=p.task WHERE p.id=?').get(req.params.id);if(!p||!canAccess(req.user,p.student))return res.sendStatus(404);res.type('jpeg').send(Buffer.from(p.content))});
 app.patch('/api/tasks/:id',async(req,res,next)=>{try{const t=db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id),u=req.user,v=req.body;if(!['student','coach'].includes(u.role))return res.sendStatus(403);if(!t||!canAccess(u,t.student))return res.sendStatus(404);if(v.version!==t.version)return res.status(409).json({error:'Ödev güncellendi. Sayfayı yenileyip tekrar deneyin.'});let photos=[];if(u.role==='student'){if(!['todo','revision'].includes(t.status)||v.status!=='submitted')return res.status(409).json({error:'Bu ödev şu anda teslim edilemez.'});if(typeof v.note!=='string'||v.note.length>2000||!Array.isArray(v.photos)||v.photos.length<1||v.photos.length>4)return res.status(400).json({error:'Not ve 1–4 fotoğraf gerekli.'});for(const p of v.photos){if(typeof p!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p))return res.status(400).json({error:'Geçersiz fotoğraf.'});try{photos.push(await sharp(Buffer.from(p.split(',')[1],'base64'),{limitInputPixels:25000000}).rotate().resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer())}catch{return res.status(400).json({error:'Fotoğraf okunamadı.'})}}}else if(t.status!=='submitted'||!['approved','revision'].includes(v.status)||typeof v.feedback!=='string'||v.feedback.length>2000||(v.status==='revision'&&!v.feedback.trim()))return res.status(400).json({error:'Geçerli durum ve düzeltme için açıklama gerekli.'});
 db.exec('BEGIN IMMEDIATE');try{const result=u.role==='student'?db.prepare("UPDATE tasks SET status='submitted',note=?,feedback='',version=version+1 WHERE id=? AND version=?").run(v.note,t.id,v.version):db.prepare('UPDATE tasks SET status=?,feedback=?,version=version+1 WHERE id=? AND version=?').run(v.status,v.feedback.trim(),t.id,v.version);if(!result.changes){db.exec('ROLLBACK');return res.status(409).json({error:'Ödev başka bir oturumda değişti.'})}if(u.role==='student'){db.prepare('DELETE FROM photos WHERE task=?').run(t.id);for(const photo of photos)db.prepare('INSERT INTO photos VALUES(?,?,?)').run(randomUUID(),t.id,photo)}db.prepare('INSERT INTO events(task,actor,action,original_actor) VALUES(?,?,?,?)').run(t.id,u.id,v.status,req.originalUser?.id||null);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}res.json({ok:true});}catch(e){next(e)}});
 app.use(express.static(resolve('dist')));app.use((err,req,res,next)=>{console.error(err.message);res.status(err.status||500).json({error:err.status===413?'Fotoğraflar çok büyük.':'İşlem tamamlanamadı.'})});
 return {app,db,addUser};
}
