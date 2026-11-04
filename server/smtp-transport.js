import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';

export function smtpTransport({ url, from, buildMessage, timeoutMs = 15000 }) {
  if (!['smtp:', 'smtps:'].includes(url.protocol)) throw new Error('SMTP: используйте smtp:// или smtps://');
  if (!url.hostname || /[\r\n]/.test(from)) throw new Error('SMTP: неверный сервер или отправитель');
  const host = url.hostname, secure = url.protocol === 'smtps:';
  const port = Number(url.port) || (secure ? 465 : 587);
  const user = decodeURIComponent(url.username), pass = decodeURIComponent(url.password);
  const address = (from.match(/<([^>]+)>/) || [null, from])[1].trim();
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(address)) throw new Error('SMTP: неверный адрес отправителя');

  async function send({ to, subject, text }) {
    if (/[\r\n]/.test(to + subject) || !/^[^\s<>@]+@[^\s<>@]+$/.test(to)) throw new Error('SMTP: неверный адрес получателя');
    let sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buffer = '', lines = [], pending = null, failure = null;
    const fail = (err) => {
      failure = err;
      if (pending) { const { reject } = pending; pending = null; reject(err); }
    };
    const close = () => fail(new Error('SMTP: соединение закрыто до завершения команды'));
    function flush() {
      if (!pending) return;
      const end = lines.findIndex((l) => /^\d{3}(?: |$)/.test(l));
      if (end < 0) return;
      const reply = lines.splice(0, end + 1);
      const { resolve } = pending; pending = null;
      resolve({ code: Number(reply.at(-1).slice(0, 3)), text: reply.join('\n') });
    }
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 65536) return sock.destroy(new Error('SMTP: слишком длинный ответ'));
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) { lines.push(buffer.slice(0, i)); buffer = buffer.slice(i + 2); }
      flush();
    };
    function listen() {
      sock.setTimeout(timeoutMs, () => sock.destroy(new Error('SMTP: сервер не ответил вовремя')));
      sock.on('data', onData); sock.on('error', fail); sock.on('close', close);
    }
    listen();
    const read = () => failure ? Promise.reject(failure) : new Promise((resolve, reject) => { pending = { resolve, reject }; flush(); });
    async function cmd(line, codes) {
      const response = read();
      sock.write(line + '\r\n');
      const reply = await response;
      if (!codes.includes(reply.code)) throw new Error(`SMTP: ${line.split(' ')[0]} отклонено (${reply.code})`);
      return reply;
    }
    try {
      const hello = await read();
      if (hello.code !== 220) throw new Error(`SMTP: приветствие отклонено (${hello.code})`);
      const name = os.hostname() || 'localhost';
      let ehlo = await cmd(`EHLO ${name}`, [250]);
      if (!secure) {
        if (!/(?:^|\n)250[ -]STARTTLS(?:\s|$)/i.test(ehlo.text)) throw new Error('SMTP: сервер не поддерживает STARTTLS');
        await cmd('STARTTLS', [220]);
        sock.off('data', onData); sock.off('error', fail); sock.off('close', close);
        buffer = ''; lines = [];
        sock = tls.connect({ socket: sock, servername: host });
        listen();
        await new Promise((resolve, reject) => {
          const clear = () => { sock.off('error', rejected); sock.off('close', closed); sock.off('secureConnect', ready); };
          const ready = () => { clear(); resolve(); };
          const rejected = (err) => { clear(); reject(err); };
          const closed = () => rejected(new Error('SMTP: соединение закрыто во время STARTTLS'));
          sock.once('secureConnect', ready); sock.once('error', rejected); sock.once('close', closed);
        });
        ehlo = await cmd(`EHLO ${name}`, [250]);
      }
      if (user) await cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, [235]);
      await cmd(`MAIL FROM:<${address}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd('DATA', [354]);
      const msg = buildMessage({ from, to, subject, text }).replace(/^\./gm, '..');
      await cmd(`${msg}\r\n.`, [250]);
      await cmd('QUIT', [221]).catch(() => {});
    } finally { sock.destroy(); }
  }
  return { enabled: true, send };
}
