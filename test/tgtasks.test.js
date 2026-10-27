// Задания «подпишитесь на Telegram-канал»: привязка через бота, проверка подписки, списание при отписке.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { createApp } from '../server/app.js';

let server, base, dataDir, publicDir, owner;
let clock = Date.parse('2026-10-27T12:00:00+03:00');
const DAY = 864e5;
const SECRET = 'tg-test-secret';
const hook = createHmac('sha256', SECRET).update('tg-webhook').digest('hex').slice(0, 48);

// Поддельный Telegram: кто в каком канале, что бот отправил.
const members = new Set(); // `${chat}:${tgId}`
const sent = [];
async function fakeFetch(url, opts) {
  const method = String(url).split('/').pop();
  const body = opts?.body ? JSON.parse(opts.body) : {};
  const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
  if (method === 'getChatMember') {
    if (body.user_id === 999) return ok({ status: 'administrator' });
    return ok({ status: members.has(`${body.chat_id}:${body.user_id}`) ? 'member' : 'left' });
  }
  if (method === 'getMe') return ok({ id: 999, username: 'gamely_test_bot' });
  if (method === 'sendMessage') sent.push(body);
  return ok(true);
}

function browser() {
  const jar = {};
  return async (method, url, body, headers = {}) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method,
      headers: { ...(cookie && { cookie }), ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      jar[kv.slice(0, kv.indexOf('='))] = kv.slice(kv.indexOf('=') + 1);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}
const tgSend = (update) => browser()('POST', '/api/tg/webhook', update, { 'x-telegram-bot-api-secret-token': hook });
const start = (tgId, code) => tgSend({ message: { chat: { id: tgId, type: 'private' }, from: { id: tgId, first_name: 'Тест' }, text: `/start ${code}` } });
const codeOf = (url) => new URL(url).searchParams.get('start');
const settle = () => new Promise((r) => setTimeout(r, 50)); // вебхук отвечает сразу, работа идёт после ответа
const coins = async (b) => (await b('GET', '/api/me')).data.user.coins;
let taskId;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-tg-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-tgpub-'));
  server = createApp({
    dataDir, publicDir, adminEmails: ['owner@test.ru'], now: () => clock, previewSecret: SECRET, fetchImpl: fakeFetch,
    telegram: { token: '1:test', username: 'gamely_test_bot', api: 'http://tg.test', enabled: true },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  owner = browser();
  await owner('POST', '/api/register', { email: 'owner@test.ru', password: 'secret123', name: 'Владелец' });
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

test('владелец заводит задание, чужим нельзя, канал проверяется', async () => {
  assert.equal((await owner('POST', '/api/admin/tasks', { chat: 'нет', title: 'Канал', reward: 50 })).status, 400);
  const r = await owner('POST', '/api/admin/tasks', { chat: 'https://t.me/gamely_news', title: 'Gamely в Telegram', reward: 50 });
  assert.equal(r.status, 201);
  taskId = r.data.id;
  const p = await browser();
  await p('POST', '/api/register', { email: 'x@test.ru', password: 'secret123', name: 'Игрок' });
  assert.equal((await p('POST', '/api/admin/tasks', { chat: '@a_channel', title: 'Канал', reward: 5 })).status, 403);
  assert.equal((await owner('POST', `/api/admin/tasks/${taskId}/probe`)).data.ok, true);
});

test('подписка: привязка через бота, награда только подписанным, один Telegram — один аккаунт', async () => {
  const p = browser();
  await p('POST', '/api/register', { email: 'p1@test.ru', password: 'secret123', name: 'Подписчик' });
  const before = await coins(p);
  const list = (await p('GET', '/api/tasks')).data;
  assert.equal(list.linked, false);
  assert.equal(list.tasks[0].status, null);

  // Не подписан — монеток нет, бот прислал кнопки
  await start(111, codeOf(list.bot_url));
  await settle();
  assert.equal(await coins(p), before);
  assert.ok(sent.at(-1).text.includes('не видим подписки'));

  // Подписался и нажал «Я подписался»
  members.add('@gamely_news:111');
  await tgSend({ callback_query: { id: 'cb1', from: { id: 111 }, data: `check:${taskId}`, message: { chat: { id: 111 } } } });
  await settle();
  assert.equal(await coins(p), before + 50);
  assert.equal((await p('GET', '/api/tasks')).data.tasks[0].status, 'paid');
  assert.equal((await p('POST', `/api/tasks/${taskId}/check`)).data.status, 'done');

  // Тот же Telegram на другом аккаунте — нельзя
  const q = browser();
  await q('POST', '/api/register', { email: 'p2@test.ru', password: 'secret123', name: 'Второй' });
  const qBefore = await coins(q);
  await start(111, codeOf((await q('GET', '/api/tasks')).data.bot_url));
  await settle();
  assert.equal(await coins(q), qBefore);
  assert.ok(sent.at(-1).text.includes('другому аккаунту'));

  // Чужой вебхук без секрета не принимается
  assert.equal((await browser()('POST', '/api/tg/webhook', { message: {} })).status, 403);
});

test('отписался в первые 7 дней — монетки списаны; продержался — засчитан', async () => {
  const quitter = browser();
  await quitter('POST', '/api/register', { email: 'q@test.ru', password: 'secret123', name: 'Ушёл' });
  members.add('@gamely_news:222');
  await start(222, codeOf((await quitter('GET', '/api/tasks')).data.bot_url));
  await settle();
  const paid = await coins(quitter);

  const stayer = browser();
  await stayer('POST', '/api/register', { email: 's@test.ru', password: 'secret123', name: 'Остался' });
  await start(333, codeOf((await stayer('GET', '/api/tasks')).data.bot_url)); // привязали, но ещё не подписан
  await settle();
  members.add('@gamely_news:333');
  assert.equal((await stayer('POST', `/api/tasks/${taskId}/check`)).data.status, 'paid');

  members.delete('@gamely_news:222');
  clock += 13 * 3600e3;
  await owner('GET', '/api/admin/tasks'); // перепроверка
  assert.equal(await coins(quitter), paid - 50);
  assert.equal((await quitter('GET', '/api/tasks')).data.tasks[0].status, 'left');
  assert.equal((await quitter('POST', `/api/tasks/${taskId}/check`)).data.status, 'left');

  clock += 8 * DAY;
  await owner('GET', '/api/admin/tasks');
  assert.equal((await stayer('GET', '/api/tasks')).data.tasks[0].status, 'kept');
  const row = (await owner('GET', '/api/admin/tasks')).data.tasks.find((t) => t.id === taskId);
  assert.equal(row.left_n, 1);
  assert.ok(row.kept >= 1);
});

test('лимит подписчиков: заполненное задание пропадает у новых игроков', async () => {
  const r = await owner('POST', '/api/admin/tasks', { chat: '@partner_channel', title: 'Канал партнёра', reward: 20, max_subs: 1, advertiser: 'ИП Иванов', erid: 'abc123' });
  const id = r.data.id;
  const a = browser();
  await a('POST', '/api/register', { email: 'a@test.ru', password: 'secret123', name: 'Первый' });
  members.add('@partner_channel:444');
  await start(444, codeOf((await a('GET', '/api/tasks')).data.bot_url));
  await settle();
  const mine = (await a('GET', '/api/tasks')).data.tasks.find((t) => t.id === id);
  assert.equal(mine.status, 'paid');
  assert.equal(mine.erid, 'abc123');
  const b = browser();
  await b('POST', '/api/register', { email: 'b@test.ru', password: 'secret123', name: 'Второй' });
  assert.equal((await b('GET', '/api/tasks')).data.tasks.some((t) => t.id === id), false);
});
