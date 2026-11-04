import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {smtpTransport} from '../server/smtp-transport.js';
import {buildMessage, mailerFromEnv} from '../server/mail.js';

async function fake(t, onConnection) {
  const sockets = new Set();
  const server = net.createServer((s) => { sockets.add(s); s.on('error', () => {}); s.on('close', () => sockets.delete(s)); onConnection(s); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { for (const s of sockets) s.destroy(); await new Promise((r) => server.close(r)); });
  return smtpTransport({url:new URL(`smtp://sender%40test.ru:private-test-password@127.0.0.1:${server.address().port}`),from:'Gamely <sender@test.ru>',buildMessage,timeoutMs:100});
}
const message = {to:'player@test.ru',subject:'Восстановление',text:'Проверка'};
test('SMTP: закрытие сервера завершает отправку ошибкой', async (t) => {
  const mailer = await fake(t, (s) => { s.write('220 ready\r\n'); s.once('data', () => s.destroy()); });
  await assert.rejects(mailer.send(message), /закрыто|reset|closed/i);
});
test('SMTP: зависшая команда завершается по таймауту', async (t) => {
  const mailer = await fake(t, (s) => s.write('220 ready\r\n'));
  await assert.rejects(mailer.send(message), /вовремя/);
});
test('SMTP: пароль не передаётся, если STARTTLS не поддержан', async (t) => {
  let commands = '';
  const mailer = await fake(t, (s) => {
    s.write('220 ready\r\n'); s.on('data', (d) => { commands += d; s.write('250 localhost\r\n'); });
  });
  await assert.rejects(mailer.send(message), /STARTTLS/);
  assert.match(commands, /^EHLO /); assert.doesNotMatch(commands, /AUTH|MAIL FROM|RCPT|private-test/);
});
test('SMTP: неверная конфигурация и инъекция заголовков отклоняются', () => {
  assert.equal(mailerFromEnv({}).enabled, false);
  assert.throws(() => mailerFromEnv({SMTP_URL:'https://user:secret@example.com',MAIL_FROM:'a@test.ru'}), /smtp/);
  assert.throws(() => mailerFromEnv({SMTP_URL:'smtps://example.com',MAIL_FROM:'a@test.ru\r\nBcc: b@test.ru'}), /отправитель/);
});
