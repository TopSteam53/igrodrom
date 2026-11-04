// Запускается владельцем в /opt/igrodrom: node scripts/setup-mail.mjs
// Пароль вводится скрыто, не попадает в аргументы процесса или вывод.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import {Writable} from 'node:stream';
import {mailerFromEnv} from '../server/mail.js';

if (!process.stdin.isTTY) { console.error('Запустите настройку в интерактивном терминале.'); process.exit(1); }
let hidden=false;
const output=new Writable({write(chunk,encoding,done){if(!hidden)process.stdout.write(chunk,encoding);done();}});
const rl=readline.createInterface({input:process.stdin,output,terminal:true});
try {
  console.log('Почта Gamely. Настройки сохранятся только после успешной тестовой отправки.');
  const email=(await rl.question('Адрес нового ящика: ')).trim();
  const host=(await rl.question('SMTP-сервер [smtp.yandex.ru]: ')).trim()||'smtp.yandex.ru';
  const port=(await rl.question('Порт [465]: ')).trim()||'465';
  if(!/^[^\s<>@]+@[^\s<>@]+$/.test(email)||!/^[a-z0-9.-]+$/i.test(host)||!['465','587'].includes(port))throw new Error('Проверьте адрес, сервер и порт 465 или 587.');
  process.stdout.write('Пароль приложения (ввод скрыт): '); hidden=true;
  const password=await rl.question(''); hidden=false; process.stdout.write('\n');
  if(!password.trim())throw new Error('Нужен пароль приложения из настроек нового ящика.');
  const url=`${port==='465'?'smtps':'smtp'}://${encodeURIComponent(email)}:${encodeURIComponent(password)}@${host}:${port}`;
  const config={SMTP_URL:url,MAIL_FROM:`Gamely <${email}>`};
  const mailer=mailerFromEnv(config);
  console.log('Отправляем одно проверочное письмо в этот же ящик…');
  await mailer.send({to:email,subject:'Gamely: почта подключена',text:'Проверка отправки писем Gamely прошла. Этот ящик будет отправлять письма подтверждения и восстановления пароля.'});
  const file=path.resolve('.env');
  if(!fs.existsSync(file))throw new Error('Файл .env не найден. Запустите команду из папки приложения.');
  let content=fs.readFileSync(file,'utf8');
  for(const [name,value] of Object.entries(config)) {
    const re=new RegExp(`^${name}=.*$`,'m');
    content=re.test(content)?content.replace(re,()=>`${name}=${value}`):content+`\n${name}=${value}\n`;
  }
  const temp=file+'.mail-tmp';
  try { fs.writeFileSync(temp,content,{mode:0o600,flag:'wx'});fs.renameSync(temp,file);fs.chmodSync(file,0o600); }
  finally { if(fs.existsSync(temp))fs.unlinkSync(temp); }
  console.log('Проверка прошла, .env обновлён. Перезапустите только приложение:');
  console.log('docker compose up -d --no-deps --force-recreate app');
} catch(err) { hidden=false;console.error('Настройка не завершена:',err.message);process.exitCode=1; }
finally {rl.close();}
