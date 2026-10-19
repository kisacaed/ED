import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {scryptSync,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from './app.js';
test('legacy database migration retains accounts, tasks, photos and active sessions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ed-legacy-')),legacy=new DatabaseSync(join(dir,'ed.sqlite'));
 legacy.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,coach TEXT REFERENCES users(id),exam TEXT,class TEXT);
 CREATE TABLE tasks(id TEXT PRIMARY KEY,student TEXT REFERENCES users(id),subject TEXT,title TEXT,detail TEXT,questions INTEGER,date TEXT,status TEXT,note TEXT DEFAULT '',feedback TEXT DEFAULT '',version INTEGER DEFAULT 0);
 CREATE TABLE photos(id TEXT PRIMARY KEY,task TEXT REFERENCES tasks(id),content BLOB NOT NULL);
 CREATE TABLE sessions(token TEXT PRIMARY KEY,user TEXT REFERENCES users(id),expires INTEGER);`);
 const hash='salt:'+scryptSync('legacy-test-password','salt',64).toString('hex');
 legacy.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('c','Legacy Coach','coach@test.local',hash,'coach',null,null,null);
 legacy.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('s','Student','student@test.local',hash,'student','c','YKS','12');
 legacy.exec("INSERT INTO tasks VALUES('t','s','Matematik','Eski ödev','Çöz',20,'2026-10-19','approved','Öğrenci notu','Onaylandı',3)");legacy.prepare('INSERT INTO photos VALUES(?,?,?)').run('p','t',Buffer.from('legacy-photo'));
 legacy.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('legacy-session').digest('hex'),'c',Date.now()+3600000);legacy.close();
 const {app,db}=createApp({dataDir:dir}),server=app.listen(0);await new Promise(r=>server.once('listening',r));
 try{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/state',{headers:{cookie:'ed_session=legacy-session'}});assert.equal(r.status,200);const state=await r.json();assert.equal(state.user.coordinator,null);assert.equal(state.user.version,0);assert.equal(state.students[0].coach,'c');assert.equal(state.tasks[0].status,'approved');assert.equal(state.tasks[0].version,3);assert.deepEqual(state.tasks[0].photos,['/api/photos/p']);assert.equal(Buffer.from(db.prepare('SELECT content FROM photos').get().content).toString(),'legacy-photo');assert.equal(db.prepare('SELECT password FROM users WHERE id=?').get('c').password,hash)}finally{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true})}
});
