// Блогеры-партнёры: ссылка /p/<код>, промокод при регистрации, подарок новичку, засчёт по играм и дням, кабинет, выплаты.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { PARTNER_BONUS } from '../server/partners.js';

let server, base, dataDir, publicDir, games;
let clock = Date.parse('2026-03-02T09:00:00Z');
const DAY = 864e5;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-pt-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-ptpub-'));
  for (const slug of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(publicDir, 'games', slug), { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'meta.json'), JSON.stringify({ title: slug, category: 'Аркады' }));
  }
  server = createApp({
    dataDir, publicDir, adminEmails: ['owner@test.ru'], seedDemoGames: true, siteUrl: 'https://igry.test',
    now: () => clock, trustProxy: true, statsTz: 'Europe/Moscow',
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  games = (await (await fetch(`${base}/api/games`)).json()).games;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

function browser(ip = '10.0.0.1', jar = {}) {
  const b = async (method, url, json, { raw = false } = {}) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { 'x-forwarded-for': ip, ...(cookie && { cookie }), ...(json && { 'content-type': 'application/json' }) },
      body: json ? JSON.stringify(json) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      jar[kv.slice(0, kv.indexOf('='))] = kv.slice(kv.indexOf('=') + 1);
    }
    if (raw) return res;
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  b.jar = jar;
  return b;
}
const register = (b, email, extra = {}) => b('POST', '/api/register', { email, password: 'secret123', name: email.split('@')[0], ...extra });
const coins = async (b) => (await b('GET', '/api/me')).data.user.coins;

let owner;
test('владелец заводит блогера, игроки — нет', async () => {
  owner = browser('10.0.0.100');
  assert.equal((await register(owner, 'owner@test.ru')).status, 201);
  const blogger = browser('10.9.9.9');
  assert.equal((await register(blogger, 'blogger@test.ru')).status, 201);
  const slug = games.find((g) => g.slug).slug;
  const r = await owner('POST', '/api/admin/partners', { name: 'Обби-канал', code: 'obbi', promo: 'ОббИ', rate: 15, target: slug, email: 'blogger@test.ru', contact: '@obbi' });
  assert.equal(r.status, 201, r.data?.error);
  assert.equal(r.data.partner.promo, 'ОББИ');
  assert.equal(r.data.link, 'https://igry.test/p/obbi');
  assert.equal((await owner('POST', '/api/admin/partners', { name: 'Копия', code: 'obbi', rate: 1 })).status, 409);
  assert.equal((await owner('POST', '/api/admin/partners', { name: 'Плохой', code: 'Плохой код' })).status, 400);
  assert.equal((await blogger('GET', '/api/admin/partners')).status, 403);
  assert.equal((await blogger('GET', '/api/me')).data.user.partner, true);
  assert.equal((await owner('GET', '/api/me')).data.user.partner, false);
});

test('ссылка: переход в игру, cookie и счётчик — один раз на браузер', async () => {
  const v = browser('10.1.0.1');
  const res = await v('GET', '/p/obbi', undefined, { raw: true });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/game\//);
  assert.equal(v.jar.pref, 'obbi');
  await v('GET', '/p/obbi', undefined, { raw: true });
  const unknown = await browser('10.1.0.2')('GET', '/p/nobody', undefined, { raw: true });
  assert.equal(unknown.headers.get('location'), '/', 'неизвестный код — просто на главную');
  const list = (await owner('GET', '/api/admin/partners')).data.partners;
  assert.equal(list[0].clicks, 1);
});

test('регистрация по ссылке и по промокоду: подарок сразу, неверный промокод — ошибка без аккаунта', async () => {
  const byLink = browser('10.2.0.1');
  await byLink('GET', '/p/obbi', undefined, { raw: true });
  assert.equal((await register(byLink, 'link@test.ru')).status, 201);
  assert.equal(await coins(byLink), 50 + PARTNER_BONUS);

  const byPromo = browser('10.2.0.2');
  assert.equal((await register(byPromo, 'promo@test.ru', { promo: ' оббё ' })).status, 400, 'ё ≠ и — такого кода нет');
  assert.equal((await register(byPromo, 'promo@test.ru', { promo: 'нет-такого' })).status, 400);
  assert.equal((await byPromo('GET', '/api/me')).data.user, null, 'аккаунт не создан');
  assert.equal((await register(byPromo, 'promo@test.ru', { promo: ' оббИ ' })).status, 201);
  assert.equal(await coins(byPromo), 50 + PARTNER_BONUS);

  const plain = browser('10.2.0.3');
  assert.equal((await register(plain, 'plain@test.ru')).status, 201);
  assert.equal(await coins(plain), 50);

  // Свой аккаунт блогера (тот же адрес, что при его регистрации) — не засчитывается, но подарок не отнимаем.
  const self = browser('10.9.9.9');
  assert.equal((await register(self, 'self@test.ru', { promo: 'obbi' })).status, 201);

  const d = (await owner('GET', `/api/admin/partners/${(await owner('GET', '/api/admin/partners')).data.partners[0].id}`)).data;
  assert.equal(d.totals.regs, 3);
  assert.equal(d.totals.refused, 1);
  assert.deepEqual(d.players.map((p) => p.via).sort(), ['link', 'promo', 'promo']);
  globalThis.players = { byLink, byPromo };
});

test('засчёт: две разные игры и два разных дня; ставка и выплаты; кабинет блогера', async () => {
  const { byLink, byPromo } = globalThis.players;
  const [g1, g2] = games.map((g) => g.id);
  // byLink: две игры в первый день — ещё не засчитан (нужен второй день).
  await byLink('POST', '/api/me/coins/daily');
  await byLink('POST', `/api/games/${g1}/play`);
  await byLink('POST', `/api/games/${g2}/play`);
  const id = (await owner('GET', '/api/admin/partners')).data.partners[0].id;
  let d = (await owner('GET', `/api/admin/partners/${id}`)).data;
  assert.equal(d.totals.counted, 0);
  // Ставка меняется до засчёта — засчитывается по новой.
  await owner('PUT', `/api/admin/partners/${id}`, { rate: 20 });
  clock += DAY;
  await byLink('POST', '/api/me/coins/daily');
  // byPromo: два дня, но одна игра — не засчитан.
  await byPromo('POST', '/api/me/coins/daily');
  await byPromo('POST', `/api/games/${g1}/play`);
  d = (await owner('GET', `/api/admin/partners/${id}`)).data;
  assert.equal(d.totals.counted, 1);
  assert.equal(d.totals.earned, 20);
  assert.equal(d.totals.pending, 1);
  assert.equal(d.days.at(-1).counted, 1);

  // Ставка после засчёта уже не меняет начисленное.
  await owner('PUT', `/api/admin/partners/${id}`, { rate: 100 });
  assert.equal((await owner('POST', `/api/admin/partners/${id}/payouts`, { amount: 0 })).status, 400);
  d = (await owner('POST', `/api/admin/partners/${id}/payouts`, { amount: 20, note: 'карта' })).data;
  assert.deepEqual([d.totals.earned, d.totals.paid, d.totals.due], [20, 20, 0]);

  // Кабинет: те же цифры, имена игроков скрыты, чужим — 404.
  const blogger = browser('10.9.9.9');
  await blogger('POST', '/api/login', { email: 'blogger@test.ru', password: 'secret123' });
  const mine = (await blogger('GET', '/api/partner/me')).data;
  assert.equal(mine.totals.counted, 1);
  assert.equal(mine.partner.promo, 'ОББИ');
  assert.ok(mine.players.every((p) => !('user_id' in p) && /•|…/.test(p.name)));
  assert.equal((await byLink('GET', '/api/partner/me')).status, 404);

  // Выключенный блогер: ссылка ведёт на главную без cookie, промокод не принимается.
  await owner('PUT', `/api/admin/partners/${id}`, { active: false });
  const late = browser('10.3.0.1');
  const res = await late('GET', '/p/obbi', undefined, { raw: true });
  assert.equal(res.headers.get('location'), '/');
  assert.equal(late.jar.pref, undefined);
  assert.equal((await register(late, 'late@test.ru', { promo: 'obbi' })).status, 400);
});

test('кабинет блогера и плашка для стрима закрыты от поисковиков', async () => {
  const robots = await (await fetch(`${base}/robots.txt`)).text();
  assert.match(robots, /Disallow: \/p\//);
  assert.match(robots, /Disallow: \/partner/);
});
