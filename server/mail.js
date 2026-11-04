// Отправка писем: подтверждение почты и сброс пароля.
//
// SMTP_URL=smtps://логин:пароль@smtp.yandex.ru:465 — шифрование сразу (порт 465);
// SMTP_URL=smtp://логин:пароль@smtp.example.ru:587 — обычное соединение, потом STARTTLS.
// Без SMTP_URL письма не отправляются, а печатаются в лог сервера — для локальной разработки.
// Свой минимальный SMTP-клиент: проекту не нужны внешние зависимости.
import { smtpTransport } from './smtp-transport.js';
import { randomBytes } from 'node:crypto';

export function mailerFromEnv(env = {}) {
  const url = String(env.SMTP_URL || '').trim();
  if (!url) return logMailer();
  const parsed = new URL(url);
  const from = String(env.MAIL_FROM || '').trim() || decodeURIComponent(parsed.username);
  return smtpMailer({ url: parsed, from });
}

// Письма в лог: удобно открыть ссылку из консоли, пока почта не настроена.
export function logMailer(log = console.log) {
  return {
    enabled: false,
    async send({ to, subject, text }) {
      log(`[почта не настроена] Кому: ${to}\nТема: ${subject}\n${text}\n`);
    },
  };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const header = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

// «Gamely <hello@site.ru>» → адрес для MAIL FROM и заголовок From.
function parseFrom(from) {
  const m = String(from).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!m) return { address: from.trim(), header: from.trim() };
  return { address: m[2], header: m[1] ? `${header(m[1].replace(/^"|"$/g, ''))} <${m[2]}>` : `<${m[2]}>` };
}

export function buildMessage({ from, to, subject, text, date = new Date() }) {
  const domain = parseFrom(from).address.split('@')[1] || 'localhost';
  const body = b64(text.replace(/\r?\n/g, '\r\n')).replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${parseFrom(from).header}`,
    `To: <${to}>`,
    `Subject: ${header(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

function smtpMailer({ url, from }) {
  return { ...smtpTransport({ url, from, buildMessage }), sender: parseFrom(from).address };
}
