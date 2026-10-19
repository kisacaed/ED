import {createInterface} from 'node:readline/promises';
import {createApp} from './app.js';
const role=process.argv.includes('--super-admin')?'super_admin':'coach';
const label=role==='super_admin'?'Süper admin':'Koç';
const rl=createInterface({input:process.stdin,output:process.stdout});
const name=await rl.question(label+' adı: '),email=await rl.question('E-posta: ');
rl.close();
// Read the password without echoing it on an interactive terminal.
process.stdout.write('Parola (en az 12 karakter): ');
let password='';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data',chunk=>{for(const c of chunk.toString()){if(c==='\u0003')process.exit(1);if(c==='\r'||c==='\n'){if(process.stdin.isTTY)process.stdin.setRawMode(false);const {db,addUser}=createApp();try{addUser({name,email,password,role});console.log('\n'+label+' hesabı oluşturuldu.')}catch(e){console.error('\n'+e.message);process.exitCode=1}db.close();process.stdin.pause();return;}if(c==='\u007f')password=password.slice(0,-1);else password+=c;}});
