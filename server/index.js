import {createApp} from './app.js';
const {app}=createApp();
app.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>console.log('ED sunucusu hazır. Port: '+(process.env.PORT||3001)));
