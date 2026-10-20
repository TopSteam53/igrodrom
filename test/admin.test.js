// Админка: обзор, пользователи, блокировка, платежи — с разными правами владельца и модератора.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

let server, base, dataDir, publicDir, owner, mod, ids = {};

function browser() {
  const jar = {};
  return async (method, url, body) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method,
      headers: { ...(cookie && { cookie }), ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      jar[kv.slice(0, kv.indexOf('='))] = kv.slice(kv.indexOf('=') + 1);
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
async function user(email, name) {
  const b = browser();
  assert.equal((await b('POST', '/api/register', { email, password: 'secret123', name })).status, 201);
  ids[email] = (await b('GET', '/api/me')).data.user.id;
  return b;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-adm-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-admpub-'));
  server = createApp({ dataDir, publicDir, adminEmails: ['owner@test.ru'] });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  owner = await user('owner@test.ru', 'Владелец');
  mod = await user('mod@test.ru', 'Модератор');
  await owner('POST', '/api/admin/team', { email: 'mod@test.ru' });
  for (let i = 1; i <= 55; i++) await user(`p${i}@test.ru`, i === 7 ? 'Особый_игрок%' : `Игрок ${i}`);
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

test('обзор: модератор видит площадку, деньги — только владелец', async () => {
  const o = (await owner('GET', '/api/admin/overview')).data;
  assert.equal(o.users.total, 57);
  assert.equal(o.users.today, 57);
  assert.equal(o.registrations.length, 30);
  assert.equal(o.registrations.at(-1).n, 57);
  assert.ok(o.money, 'владельцу — выручка и монетки');
  assert.equal(o.money.circulation, 57 * 50, 'подарки новичкам в обороте');
  const m = (await mod('GET', '/api/admin/overview')).data;
  assert.equal(m.money, undefined);
  const p = await user('nobody@test.ru', 'Никто');
  assert.equal((await p('GET', '/api/admin/overview')).status, 403);
});

test('пользователи: поиск, фильтры, страницы', async () => {
  let r = (await mod('GET', '/api/admin/users')).data;
  assert.equal(r.total, 58);
  assert.equal(r.users.length, 50);
  assert.equal(r.pages, 2);
  assert.equal((await mod('GET', '/api/admin/users?page=1')).data.users.length, 8);

  r = (await mod('GET', `/api/admin/users?q=${encodeURIComponent('особый_')}`)).data;
  assert.deepEqual(r.users.map((u) => u.email), ['p7@test.ru'], 'поиск без учёта регистра, _ и % — обычные символы');
  assert.equal((await mod('GET', `/api/admin/users?q=${encodeURIComponent('_')}`)).data.users.length, 1);
  assert.equal((await mod('GET', `/api/admin/users?q=${ids['p3@test.ru']}`)).data.users[0].email, 'p3@test.ru', 'поиск по id');

  r = (await mod('GET', '/api/admin/users?filter=team')).data;
  assert.deepEqual(r.users.map((u) => [u.email, u.role]).sort(), [['mod@test.ru', 'moderator'], ['owner@test.ru', 'owner']]);
  assert.equal((await mod('GET', '/api/admin/users?filter=unverified')).data.total, 58);

  await owner('POST', `/api/admin/users/${ids['p1@test.ru']}/coins`, { amount: 500, reason: 'Победитель конкурса' });
  r = (await mod('GET', '/api/admin/users?sort=coins')).data;
  assert.deepEqual([r.users[0].email, r.users[0].coins], ['p1@test.ru', 550]);

  const d = (await mod('GET', `/api/admin/users/${ids['p1@test.ru']}`)).data;
  assert.deepEqual(d.history.map((h) => h.kind), ['grant', 'welcome']);
  assert.equal(d.orders, null, 'покупки видит только владелец');
  assert.deepEqual((await owner('GET', `/api/admin/users/${ids['p1@test.ru']}`)).data.orders, []);
});

test('блокировка: вход закрыт, сессии сброшены; модератора блокирует только владелец', async () => {
  const p = browser();
  await p('POST', '/api/login', { email: 'p2@test.ru', password: 'secret123' });
  assert.ok((await p('GET', '/api/me')).data.user);

  const id = ids['p2@test.ru'];
  assert.equal((await mod('POST', `/api/admin/users/${id}/block`, { blocked: true, reason: '' })).status, 400);
  assert.equal((await mod('POST', `/api/admin/users/${id}/block`, { blocked: true, reason: 'Спам в отзывах' })).status, 200);
  assert.equal((await p('GET', '/api/me')).data.user, null, 'сессия больше не действует');
  const login = await browser()('POST', '/api/login', { email: 'p2@test.ru', password: 'secret123' });
  assert.equal(login.status, 403);
  assert.match(login.data.error, /Спам в отзывах/);
  assert.equal((await browser()('POST', '/api/login', { email: 'p2@test.ru', password: 'wrong-pass' })).status, 401, 'без пароля о блокировке не узнать');
  assert.equal((await mod('GET', '/api/admin/users?filter=blocked')).data.users[0].email, 'p2@test.ru');

  assert.equal((await mod('POST', `/api/admin/users/${id}/block`, { blocked: false })).status, 200);
  assert.equal((await browser()('POST', '/api/login', { email: 'p2@test.ru', password: 'secret123' })).status, 200);

  assert.equal((await mod('POST', `/api/admin/users/${ids['owner@test.ru']}/block`, { blocked: true, reason: 'Бунт' })).status, 403);
  const mod2 = await user('mod2@test.ru', 'Второй модератор');
  await owner('POST', '/api/admin/team', { email: 'mod2@test.ru' });
  assert.equal((await mod('POST', `/api/admin/users/${ids['mod2@test.ru']}/block`, { blocked: true, reason: 'Конкуренция' })).status, 403);
  assert.equal((await owner('POST', `/api/admin/users/${ids['mod2@test.ru']}/block`, { blocked: true, reason: 'Злоупотребление' })).status, 200);
  assert.equal((await mod2('GET', '/api/me')).data.user, null);
  const log = (await owner('GET', '/api/admin/log')).data.entries.map((e) => e.action);
  assert.ok(log.includes('user.block') && log.includes('user.unblock'));
});

test('сброс аватарки и платежи', async () => {
  const p = browser();
  await p('POST', '/api/login', { email: 'p5@test.ru', password: 'secret123' });
  await p('PUT', '/api/me/avatar', { preset: 3 });
  assert.equal((await mod('DELETE', `/api/admin/users/${ids['p5@test.ru']}/avatar`)).status, 200);
  assert.equal((await p('GET', '/api/me')).data.user.avatar, null);

  assert.equal((await mod('GET', '/api/admin/payments')).status, 403);
  assert.deepEqual((await owner('GET', '/api/admin/payments')).data.orders, []);
});
