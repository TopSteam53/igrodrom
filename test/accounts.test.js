import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';

let server, base, dataDir, publicDir;
const open = async (app) => { await new Promise((r) => app.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${app.address().port}`; };

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-acc-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-accpub-'));
  for (const slug of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(publicDir, 'games', slug), { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'meta.json'), JSON.stringify({ title: slug, category: 'Аркады' }));
  }
  server = createApp({ dataDir, publicDir, adminEmails: ['admin@test.ru'], seedDemoGames: true });
  base = await open(server);
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

// Браузер с собственными cookie.
function browser() {
  const jar = {};
  return async (method, url, json, raw) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const type = json ? 'application/json' : raw ? 'text/html' : null;
    const res = await fetch(base + url, {
      method,
      headers: { 'user-agent': 'Mozilla/5.0 Chrome/130', ...(cookie && { cookie }), ...(type && { 'content-type': type }) },
      body: json ? JSON.stringify(json) : raw,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      jar[kv.slice(0, kv.indexOf('='))] = kv.slice(kv.indexOf('=') + 1);
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

const APP = { studio: 'Пиксель', about: 'Делаю аркады для браузера третий год.', links: 'https://example.com', contact: '@pixel' };
const upload = (b) => b('POST', `/api/games?title=${encodeURIComponent('Моя игра')}&genre=${encodeURIComponent('Аркады')}`, null, '<html><canvas></canvas></html>');
const games = async () => (await browser()('GET', '/api/games')).data.games;

let admin;
test('модератор', async () => {
  admin = browser();
  const r = await admin('POST', '/api/register', { email: 'admin@test.ru', password: 'secret123', name: 'Модератор' });
  assert.equal(r.data.user.isAdmin, true);
  assert.equal(r.data.user.canPublish, true, 'модератор публикует без заявки');
});

test('игрок не может публиковать игры', async () => {
  const p = browser();
  const r = await p('POST', '/api/register', { email: 'player@test.ru', password: 'secret123', name: 'Игрок' });
  assert.equal(r.data.user.developer, 'none');
  assert.equal(r.data.user.canPublish, false);
  assert.equal((await upload(p)).status, 403);
  assert.equal((await p('GET', '/api/my/games')).status, 403);
  assert.equal((await p('GET', '/api/admin/developers')).status, 403, 'и не видит заявки');
});

test('заявка разработчика: проверка, отказ с причиной, повтор, одобрение', async () => {
  const d = browser();
  await d('POST', '/api/register', { email: 'dev@test.ru', password: 'secret123', name: 'Дев' });

  assert.equal((await d('POST', '/api/developer/application', { ...APP, about: 'коротко' })).status, 400);
  assert.equal((await d('POST', '/api/developer/application', { ...APP, contact: '' })).status, 400);
  assert.equal((await browser()('POST', '/api/developer/application', APP)).status, 401, 'без входа — нельзя');

  let r = await d('POST', '/api/developer/application', APP);
  assert.equal(r.status, 201);
  assert.equal(r.data.application.status, 'pending');
  assert.equal((await d('POST', '/api/developer/application', APP)).status, 409, 'повторно, пока на рассмотрении');
  assert.equal((await d('GET', '/api/me')).data.user.developer, 'pending');
  assert.equal((await upload(d)).status, 403, 'до одобрения публиковать нельзя');

  const queue = (await admin('GET', '/api/admin/developers?status=pending')).data.applications;
  const mine = queue.find((a) => a.email === 'dev@test.ru');
  assert.equal(mine.studio, 'Пиксель');
  assert.equal(mine.contact, '@pixel');

  assert.equal((await admin('POST', `/api/admin/developers/${mine.user_id}`, { action: 'reject' })).status, 400, 'отказ — с причиной');
  await admin('POST', `/api/admin/developers/${mine.user_id}`, { action: 'reject', reason: 'Добавьте ссылку на свои игры' });
  r = await d('GET', '/api/developer/application');
  assert.equal(r.data.application.status, 'rejected');
  assert.equal(r.data.application.reason, 'Добавьте ссылку на свои игры');

  r = await d('POST', '/api/developer/application', { ...APP, links: 'https://pixel.example/games' });
  assert.equal(r.data.application.status, 'pending', 'после отказа можно подать снова');
  assert.equal(r.data.application.reason, null);

  await admin('POST', `/api/admin/developers/${mine.user_id}`, { action: 'approve' });
  assert.equal((await d('GET', '/api/me')).data.user.canPublish, true);
  assert.equal((await d('POST', '/api/developer/application', APP)).status, 409, 'уже разработчик');

  const up = await upload(d);
  assert.equal(up.status, 201);
  assert.equal(up.data.game.status, 'pending', 'игра всё равно идёт на модерацию');
  assert.ok(!(await games()).some((g) => g.id === up.data.game.id));
});

test('сохранения гостя переезжают в аккаунт и доступны с другого устройства', async () => {
  const [alpha, beta] = await games();
  const phone = browser();
  await phone('PUT', `/api/games/${alpha.id}/save`, { data: { level: 7 } });
  await phone('PUT', `/api/games/${beta.id}/save`, { data: { best: 120 } });

  await phone('POST', '/api/register', { email: 'gamer@test.ru', password: 'secret123', name: 'Геймер' });
  assert.deepEqual((await phone('GET', `/api/games/${alpha.id}/save`)).data.data, { level: 7 });
  const recent = (await phone('GET', '/api/me/recent')).data.games.map((g) => g.id).sort();
  assert.deepEqual(recent, [alpha.id, beta.id].sort());

  const laptop = browser();
  await laptop('POST', '/api/login', { email: 'gamer@test.ru', password: 'secret123' });
  assert.deepEqual((await laptop('GET', `/api/games/${beta.id}/save`)).data.data, { best: 120 }, 'с другого устройства');

  await phone('POST', '/api/logout');
  assert.equal((await phone('GET', `/api/games/${alpha.id}/save`)).data.data, null, 'гостевая копия переехала, а не скопировалась');
});

test('при входе остаётся более свежее сохранение', async () => {
  const [alpha] = await games();
  const acc = browser();
  await acc('POST', '/api/register', { email: 'fresh@test.ru', password: 'secret123', name: 'Свежий' });
  await acc('PUT', `/api/games/${alpha.id}/save`, { data: { level: 'старый' } });
  await new Promise((r) => setTimeout(r, 5));

  const guest = browser();
  await guest('PUT', `/api/games/${alpha.id}/save`, { data: { level: 'новый' } });
  await guest('POST', '/api/login', { email: 'fresh@test.ru', password: 'secret123' });
  assert.deepEqual((await guest('GET', `/api/games/${alpha.id}/save`)).data.data, { level: 'новый' });
});

test('авторы, публиковавшие игры до заявок, становятся разработчиками автоматически', async () => {
  // Имитируем старую базу: у автора есть игра, а заявки нет.
  const db = new DatabaseSync(path.join(dataDir, 'igrodrom.db'));
  const dev = db.prepare("SELECT id FROM users WHERE email = 'dev@test.ru'").get();
  db.prepare('DELETE FROM developer_applications WHERE user_id = ?').run(dev.id);
  db.close();

  const again = createApp({ dataDir, publicDir });
  const url = await open(again);
  const login = await fetch(`${url}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dev@test.ru', password: 'secret123' }),
  });
  const { user } = await login.json();
  assert.equal(user.developer, 'approved');
  await new Promise((r) => again.close(r));
});
