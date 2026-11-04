import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.js';
let app,base,dir,owner,moderator,player,failMail=false;
const mail=[];
function client(){let cookie='';return async(method,url,body)=>{
  const res=await fetch(base+url,{method,headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const session=res.headers.getSetCookie().find(x=>x.startsWith('sid='));if(session)cookie=session.split(';')[0];
  return {status:res.status,data:await res.json()};
};}
before(async()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'igrodrom-system-'));
  app=createApp({dataDir:dir,publicDir:dir,adminEmails:['owner@test.ru'],mailer:{enabled:true,sender:'support@test.ru',send:async m=>{if(failMail)throw new Error('mock SMTP unavailable');mail.push(m);}}});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.address().port}`;
  owner=client();moderator=client();player=client();
  for(const [c,email]of[[owner,'owner@test.ru'],[moderator,'mod@test.ru'],[player,'player@test.ru']])assert.equal((await c('POST','/api/register',{email,name:'Проверка',password:'test-secret-2026'})).status,201);
  assert.equal((await owner('POST','/api/admin/team',{email:'mod@test.ru'})).status,201);
});
after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});});
test('состояние сайта: только владелец, без паролей и конфигурационных секретов',async()=>{
  assert.equal((await client()('GET','/api/admin/system')).status,401);
  assert.equal((await moderator('GET','/api/admin/system')).status,403);
  assert.equal((await player('GET','/api/admin/system')).status,403);
  const r=await owner('GET','/api/admin/system');assert.equal(r.status,200);
  assert.equal(r.data.database.connected,true);assert.equal(r.data.mail.sender,'support@test.ru');
  assert.equal(r.data.mail.configured,true);assert.equal(r.data.mail.pending,0);
  assert.doesNotMatch(JSON.stringify(r.data),/pass_hash|SMTP_URL|secretKey|token_hash/);
});
test('проверочное письмо: только владельцу, результат и запись в журнале',async()=>{
  const n=mail.length;
  assert.equal((await moderator('POST','/api/admin/system/mail-test',{to:'other@test.ru'})).status,403);
  assert.equal(mail.length,n);
  const r=await owner('POST','/api/admin/system/mail-test',{to:'other@test.ru'});
  assert.equal(r.status,200);assert.equal(r.data.recipient,'owner@test.ru');
  assert.equal(mail.at(-1).to,'owner@test.ru');assert.match(mail.at(-1).subject,/проверка/);
  const s=(await owner('GET','/api/admin/system')).data;
  assert.equal(s.mail.accepted,n+1);assert.ok(s.mail.lastAcceptedAt);assert.equal(s.mail.pending,0);
  assert.ok((await owner('GET','/api/admin/log')).data.entries.some(e=>e.action==='mail.test'));
});
test('ошибка отправки видна владельцу, повторные проверки ограничены',async()=>{
  failMail=true;
  const r=await owner('POST','/api/admin/system/mail-test');assert.equal(r.status,503);
  const s=(await owner('GET','/api/admin/system')).data;
  assert.equal(s.mail.failed,1);assert.ok(s.mail.lastFailedAt);assert.equal(s.mail.pending,0);
  assert.equal((await owner('POST','/api/admin/system/mail-test')).status,429);
  failMail=false;
});
