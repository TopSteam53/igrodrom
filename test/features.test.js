// Почта (подтверждение, сброс пароля), таблицы рекордов, монетки и отзывы.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, COIN_DAILY_CAP } from '../server/app.js';
import { buildMessage } from '../server/mail.js';

let server, base, dataDir, publicDir, gameId, otherId;
const mail = [];
let clock = Date.parse('2026-03-10T12:00:00Z');

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-feat-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-featpub-'));
  for (const slug of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(publicDir, 'games', slug), { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'meta.json'), JSON.stringify({ title: slug, category: 'Аркады' }));
  }
  server = createApp({
    dataDir, publicDir, adminEmails: ['admin@test.ru'], seedDemoGames: true, siteUrl: 'https://igry.test/',
    mailer: { enabled: true, send: async (m) => { mail.push(m); } },
    now: () => clock,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const { games } = await (await fetch(`${base}/api/games`)).json();
  [gameId, otherId] = games.map((g) => g.id).sort();
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

function browser() {
  const jar = {};
  return async (method, url, json) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method,
      headers: { 'user-agent': 'Mozilla/5.0 Chrome/130', ...(cookie && { cookie }), ...(json && { 'content-type': 'application/json' }) },
      body: json ? JSON.stringify(json) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      jar[kv.slice(0, kv.indexOf('='))] = kv.slice(kv.indexOf('=') + 1);
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

const lastLink = (to, page) => {
  const m = [...mail].reverse().find((x) => x.to === to);
  return m.text.match(new RegExp(`https://igry\\.test/${page}\\.html\\?token=([\\w-]+)`))[1];
};

async function player(email, name = 'Игрок') {
  const b = browser();
  const r = await b('POST', '/api/register', { email, password: 'secret123', name });
  assert.equal(r.status, 201);
  return b;
}

test('письмо с подтверждением почты при регистрации', async () => {
  const b = await player('verify@test.ru', 'Вера');
  assert.equal((await b('GET', '/api/me')).data.user.emailVerified, false);
  const token = lastLink('verify@test.ru', 'verify');
  assert.match(mail.at(-1).subject, /Подтвердите почту/);

  // Пока почта не подтверждена — ни заявки разработчика, ни отзывов.
  const app = { studio: 'Вера', about: 'Делаю браузерные игры уже два года.', contact: '@vera' };
  assert.equal((await b('POST', '/api/developer/application', app)).status, 403);
  assert.equal((await b('PUT', `/api/games/${gameId}/reviews`, { text: 'Отличная игра' })).status, 403);

  assert.equal((await b('POST', '/api/email/verify', { token: 'x'.repeat(43) })).status, 400);
  assert.equal((await b('POST', '/api/email/verify', { token })).status, 200);
  assert.equal((await b('POST', '/api/email/verify', { token })).status, 400, 'ссылка одноразовая');
  assert.equal((await b('GET', '/api/me')).data.user.emailVerified, true);
  assert.equal((await b('POST', '/api/developer/application', app)).status, 201);
  assert.equal((await b('POST', '/api/email/resend')).status, 409, 'уже подтверждена');
});

test('повторная отправка письма: только последняя ссылка действует', async () => {
  const b = await player('again@test.ru');
  const first = lastLink('again@test.ru', 'verify');
  assert.equal((await b('POST', '/api/email/resend')).status, 200);
  const second = lastLink('again@test.ru', 'verify');
  assert.notEqual(first, second);
  assert.equal((await browser()('POST', '/api/email/verify', { token: first })).status, 400);
  assert.equal((await browser()('POST', '/api/email/verify', { token: second })).status, 200, 'подтверждается и без входа');
  assert.equal((await browser()('POST', '/api/email/resend')).status, 401);
});

test('сброс пароля', async () => {
  const b = await player('forgot@test.ru', 'Забывчивый');
  const sent = mail.length;
  // Ответ одинаковый для известной и неизвестной почты.
  assert.deepEqual((await browser()('POST', '/api/password/forgot', { email: 'nobody@test.ru' })).data, { ok: true });
  assert.equal(mail.length, sent, 'на несуществующую почту письмо не уходит');
  assert.deepEqual((await browser()('POST', '/api/password/forgot', { email: 'Forgot@Test.ru' })).data, { ok: true });
  const token = lastLink('forgot@test.ru', 'reset');

  const other = browser();
  assert.equal((await other('POST', '/api/password/reset', { token, password: 'short' })).status, 400);
  const r = await other('POST', '/api/password/reset', { token, password: 'new-secret-1' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, 'forgot@test.ru');
  assert.equal(r.data.user.emailVerified, true, 'письмо дошло — почта подтверждена');
  assert.equal((await other('GET', '/api/me')).data.user.name, 'Забывчивый', 'после сброса — сразу вход');
  assert.equal((await b('GET', '/api/me')).data.user, null, 'старые сессии закрыты');
  assert.equal((await other('POST', '/api/password/reset', { token, password: 'again-secret' })).status, 400, 'одноразовая');

  assert.equal((await browser()('POST', '/api/login', { email: 'forgot@test.ru', password: 'secret123' })).status, 401);
  assert.equal((await browser()('POST', '/api/login', { email: 'forgot@test.ru', password: 'new-secret-1' })).status, 200);
});

test('ссылка сброса живёт час', async () => {
  await player('late@test.ru');
  await browser()('POST', '/api/password/forgot', { email: 'late@test.ru' });
  const token = lastLink('late@test.ru', 'reset');
  const real = Date.now;
  Date.now = () => real() + 61 * 60 * 1000;
  try {
    assert.equal((await browser()('POST', '/api/password/reset', { token, password: 'new-secret-1' })).status, 400);
  } finally {
    Date.now = real;
  }
});

test('письмо: заголовки в UTF-8 и тело в base64', () => {
  const msg = buildMessage({ from: 'Игры онлайн <hello@igry.test>', to: 'a@b.ru', subject: 'Сброс пароля', text: 'Привет\nмир' });
  assert.match(msg, /^From: =\?UTF-8\?B\?[^?]+\?= <hello@igry\.test>\r\n/);
  assert.match(msg, /Subject: =\?UTF-8\?B\?/);
  const body = msg.split('\r\n\r\n')[1];
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), 'Привет\r\nмир');
});

test('таблица рекордов: лучший результат, места, только вошедшие', async () => {
  assert.equal((await browser()('POST', `/api/games/${gameId}/leaderboard`, { score: 10 })).status, 401);
  const a = await player('lb-a@test.ru', 'Аня');
  const b = await player('lb-b@test.ru', 'Боря');
  const c = await player('lb-c@test.ru', 'Вика');

  let r = await a('POST', `/api/games/${gameId}/leaderboard`, { score: 100 });
  assert.equal(r.data.improved, true);
  assert.equal(r.data.entry.rank, 1);
  r = await a('POST', `/api/games/${gameId}/leaderboard`, { score: 50 });
  assert.equal(r.data.improved, false, 'худший результат не перезаписывает рекорд');
  assert.equal(r.data.entry.score, 100);
  await b('POST', `/api/games/${gameId}/leaderboard`, { score: 300, extra: 'уровень 7' });
  clock += 1000;
  await c('POST', `/api/games/${gameId}/leaderboard`, { score: 100 });

  r = await c('GET', `/api/games/${gameId}/leaderboard?around=1`);
  assert.equal(r.data.board, 'main');
  assert.equal(r.data.total, 3);
  assert.deepEqual(r.data.entries.map((e) => [e.rank, e.name, e.score]), [[1, 'Боря', 300], [2, 'Аня', 100], [3, 'Вика', 100]],
    'при равенстве выше тот, кто набрал раньше');
  assert.equal(r.data.entries[0].extra, 'уровень 7');
  assert.equal(r.data.me.rank, 3);
  assert.equal(r.data.me.me, true);
  assert.deepEqual(r.data.around.map((e) => e.name), ['Аня', 'Вика']);
  assert.match(r.data.me.player, /^[0-9a-f]{24}$/);

  // Отдельные таблицы и отдельные игры.
  await a('POST', `/api/games/${gameId}/leaderboard`, { board: 'time', score: 7 });
  r = await browser()('GET', `/api/games/${gameId}/leaderboard?board=time`);
  assert.deepEqual(r.data.entries.map((e) => e.score), [7]);
  assert.equal(r.data.me, null);
  assert.deepEqual(r.data.boards.map((x) => x.board), ['main', 'time'], 'по умолчанию — самая заполненная');
  assert.equal((await browser()('GET', `/api/games/${otherId}/leaderboard`)).data.total, 0);

  assert.equal((await a('POST', `/api/games/${gameId}/leaderboard`, { score: 1.5 })).status, 400);
  assert.equal((await a('POST', `/api/games/${gameId}/leaderboard`, { score: '9' })).status, 400);
  assert.equal((await a('POST', `/api/games/${gameId}/leaderboard`, { board: 'плохо', score: 1 })).status, 400);
  assert.equal((await a('POST', '/api/games/0000000000000000/leaderboard', { score: 1 })).status, 404);
});

test('монетки: за минуту в игре, не чаще и не больше лимита, трата', async () => {
  const guest = browser();
  assert.deepEqual((await guest('POST', `/api/games/${gameId}/coins/tick`)).data, { earned: 0, coins: null });
  assert.equal((await guest('POST', `/api/games/${gameId}/coins/spend`, { amount: 1, title: 'Щит' })).status, 401);

  const p = await player('coins@test.ru', 'Копилка');
  let r = await p('POST', `/api/games/${gameId}/coins/tick`);
  assert.equal(r.data.earned, 1);
  r = await p('POST', `/api/games/${otherId}/coins/tick`);
  assert.equal(r.data.earned, 0, 'вторая вкладка не ускоряет');
  clock += 56 * 1000;
  r = await p('POST', `/api/games/${otherId}/coins/tick`);
  assert.deepEqual([r.data.earned, r.data.coins], [1, 2]);

  for (let i = 0; i < COIN_DAILY_CAP + 5; i++) {
    clock += 60 * 1000;
    if (new Date(clock).getUTCHours() >= 20) break; // не переходим на следующие сутки по Москве
    r = await p('POST', `/api/games/${gameId}/coins/tick`);
  }
  assert.equal(r.data.coins, COIN_DAILY_CAP, 'дневной лимит');
  assert.equal(r.data.earned, 0);
  assert.equal((await p('GET', '/api/me')).data.user.coins, COIN_DAILY_CAP);

  r = await p('POST', `/api/games/${gameId}/coins/spend`, { amount: 25, title: 'Щит' });
  assert.deepEqual(r.data, { ok: true, coins: COIN_DAILY_CAP - 25 });
  assert.equal((await p('POST', `/api/games/${gameId}/coins/spend`, { amount: 1000, title: 'Всё' })).status, 409);
  assert.equal((await p('POST', `/api/games/${gameId}/coins/spend`, { amount: 0, title: 'Ноль' })).status, 400);
  assert.equal((await p('POST', `/api/games/${gameId}/coins/spend`, { amount: 5, title: '' })).status, 400);

  r = await p('GET', '/api/me/coins');
  assert.equal(r.data.coins, COIN_DAILY_CAP - 25);
  assert.equal(r.data.today, COIN_DAILY_CAP);
  assert.deepEqual(r.data.spends.map((s) => [s.title, s.amount, s.game_id]), [['Щит', 25, gameId]]);
  assert.ok(['alpha', 'beta'].includes(r.data.spends[0].game_title), 'название игры — для истории в профиле');

  // Новый день — снова можно копить.
  clock += 24 * 3600 * 1000;
  assert.equal((await p('POST', `/api/games/${gameId}/coins/tick`)).data.earned, 1);
});

test('отзывы: свой можно изменить и удалить, чужой удаляет модератор', async () => {
  const admin = browser();
  await admin('POST', '/api/register', { email: 'admin@test.ru', password: 'secret123', name: 'Модератор' });
  const p = await player('review@test.ru', 'Критик');
  await p('POST', '/api/email/verify', { token: lastLink('review@test.ru', 'verify') });

  assert.equal((await browser()('PUT', `/api/games/${gameId}/reviews`, { text: 'Гость' })).status, 401);
  assert.equal((await p('PUT', `/api/games/${gameId}/reviews`, { text: 'ok' })).status, 400, 'слишком коротко');
  let r = await p('PUT', `/api/games/${gameId}/reviews`, { text: 'Хорошая игра, но сложно' });
  assert.equal(r.status, 200);
  r = await p('PUT', `/api/games/${gameId}/reviews`, { text: 'Хорошая игра, привык' });
  r = await browser()('GET', `/api/games/${gameId}/reviews`);
  assert.equal(r.data.total, 1, 'один отзыв от аккаунта');
  assert.deepEqual([r.data.reviews[0].name, r.data.reviews[0].text, r.data.reviews[0].mine], ['Критик', 'Хорошая игра, привык', false]);
  assert.equal(r.data.canModerate, false);
  assert.equal((await p('GET', `/api/games/${gameId}/reviews`)).data.reviews[0].mine, true);

  const rid = r.data.reviews[0].id;
  assert.equal((await p('DELETE', `/api/games/${gameId}/reviews/${rid}`)).status, 403, 'игрок не модератор');
  assert.equal((await admin('GET', `/api/games/${gameId}/reviews`)).data.canModerate, true);
  assert.equal((await admin('DELETE', `/api/games/${gameId}/reviews/${rid}`)).status, 200);
  assert.equal((await browser()('GET', `/api/games/${gameId}/reviews`)).data.total, 0);
  const log = (await admin('GET', '/api/admin/log')).data.entries;
  assert.equal(log[0].action, 'review.delete');

  await p('PUT', `/api/games/${gameId}/reviews`, { text: 'Пишу заново' });
  assert.equal((await p('DELETE', `/api/games/${gameId}/reviews`)).status, 200);
  assert.equal((await browser()('GET', `/api/games/${gameId}/reviews`)).data.total, 0);
});
