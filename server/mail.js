// Отправка писем: подтверждение почты и сброс пароля.
//
// SMTP_URL=smtps://логин:пароль@smtp.yandex.ru:465 — шифрование сразу (порт 465);
// SMTP_URL=smtp://логин:пароль@smtp.example.ru:587 — обычное соединение, потом STARTTLS.
// Без SMTP_URL письма не отправляются, а печатаются в лог сервера — для локальной разработки.
// Свой минимальный SMTP-клиент: проекту не нужны внешние зависимости.
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
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
  const secure = url.protocol === 'smtps:';
  const host = url.hostname;
  const port = Number(url.port) || (secure ? 465 : 587);
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);

  // Ответы сервера читаются построчно; многострочный ответ кончается строкой «250 …» (код и пробел).
  function session(socket) {
    let buf = '';
    let waiter = null;
    const lines = [];
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        lines.push(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
      flush();
    };
    function flush() {
      if (!waiter) return;
      const end = lines.findIndex((l) => /^\d{3}(?: |$)/.test(l));
      if (end < 0) return;
      const reply = lines.splice(0, end + 1);
      const w = waiter;
      waiter = null;
      w({ code: Number(reply[end].slice(0, 3)), text: reply.join('\n') });
    }
    let sock = socket;
    sock.on('data', onData);
    const read = () => new Promise((resolve) => { waiter = resolve; flush(); });
    return {
      read,
      async cmd(line, expect) {
        sock.write(`${line}\r\n`);
        const r = await read();
        if (!expect.includes(r.code)) throw new Error(`SMTP: ${line.split(' ')[0]} → ${r.text}`);
        return r;
      },
      upgrade() {
        sock.off('data', onData);
        return new Promise((resolve, reject) => {
          const t = tls.connect({ socket: sock, servername: host }, () => resolve());
          t.on('error', reject);
          t.on('data', onData);
          sock = t;
        });
      },
      end() { try { sock.end(); } catch {} },
    };
  }

  async function send({ to, subject, text }) {
    const socket = await new Promise((resolve, reject) => {
      const s = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
      s.setTimeout(20000, () => s.destroy(new Error('SMTP: таймаут')));
      s.once(secure ? 'secureConnect' : 'connect', () => resolve(s));
      s.once('error', reject);
    });
    const s = session(socket);
    try {
      const hello = await s.read();
      if (hello.code !== 220) throw new Error(`SMTP: ${hello.text}`);
      const name = os.hostname() || 'localhost';
      let ehlo = await s.cmd(`EHLO ${name}`, [250]);
      if (!secure && /STARTTLS/i.test(ehlo.text)) {
        await s.cmd('STARTTLS', [220]);
        await s.upgrade();
        ehlo = await s.cmd(`EHLO ${name}`, [250]);
      }
      if (user) await s.cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, [235]);
      await s.cmd(`MAIL FROM:<${parseFrom(from).address}>`, [250]);
      await s.cmd(`RCPT TO:<${to}>`, [250, 251]);
      await s.cmd('DATA', [354]);
      // Строки, начинающиеся с точки, удваиваются (RFC 5321); в base64 их нет, но заголовки проверяем.
      const msg = buildMessage({ from, to, subject, text }).replace(/^\./gm, '..');
      await s.cmd(`${msg}\r\n.`, [250]);
      await s.cmd('QUIT', [221]).catch(() => {});
    } finally {
      s.end();
    }
  }

  return { enabled: true, send };
}
