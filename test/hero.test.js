// Админка: отзывы всех игр одним списком (поиск, фильтр, удаление с журналом) и карусель на главной
// (слайды игр и свои, порядок, включение, картинка), а ещё подборка «на главную», которая не сбрасывается перезапуском.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

let server, base, dataDir, publicDir, games;
const clock = Date.parse('2026-03-02T09:00:00Z');
const opts = () => ({ dataDir, publicDir, adminEmails: ['owner@test.ru'], seedDemoGames: true, now: () => clock, trustProxy: true });

async function start() {
  server = createApp(opts());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-hero-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-heropub-'));
  for (const slug of ['alpha', 'beta', 'gamma']) {
    fs.mkdirSync(path.join(publicDir, 'games', slug), { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'cover.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'meta.json'), JSON.stringify({ title: slug, category: 'Аркады' }));
  }
  await start();
  games = (await (await fetch(`${base}/api/games`)).json()).games;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

function browser(ip, jar = {}) {
  return async (method, url, body, type) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const json = body !== undefined && !Buffer.isBuffer(body);
    const res = await fetch(base + url, {
      method,
      headers: { 'x-forwarded-for': ip, ...(cookie && { cookie }), ...(json && { 'content-type': 'application/json' }), ...(type && { 'content-type': type }) },
      body: body === undefined ? undefined : json ? JSON.stringify(body) : body,
    });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); jar[kv.slice(0, kv.indexOf('='))] = kv.slice(kv.indexOf('=') + 1); }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const register = (b, email) => b('POST', '/api/register', { email, password: 'secret123', name: email.split('@')[0] });
// Заголовок PNG нужного размера: проверка картинки читает только сигнатуру и IHDR.
function png(w, h) {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

let owner, player;
test('отзывы: список всех игр, поиск, фильтр по игре, удаление с записью в журнал; игроку нельзя', async () => {
  owner = browser('10.0.0.1'); player = browser('10.0.0.2');
  assert.equal((await register(owner, 'owner@test.ru')).status, 201);
  assert.equal((await register(player, 'ann@test.ru')).status, 201);
  assert.equal((await player('PUT', `/api/games/${games[0].id}/reviews`, { text: 'Отличная игра, спасибо' })).status, 200);
  assert.equal((await player('PUT', `/api/games/${games[1].id}/reviews`, { text: 'Реклама: заходите на мой канал' })).status, 200);

  assert.equal((await player('GET', '/api/admin/reviews')).status, 403);
  const all = (await owner('GET', '/api/admin/reviews')).data;
  assert.equal(all.total, 2);
  assert.equal(all.day, 2);
  assert.equal(all.games.length, 2);
  assert.ok(all.reviews.every((r) => r.name === 'ann' && r.game_title));

  const found = (await owner('GET', `/api/admin/reviews?q=${encodeURIComponent('РЕКЛАМА')}`)).data;
  assert.deepEqual(found.reviews.map((r) => r.game_id), [games[1].id]);
  assert.equal((await owner('GET', `/api/admin/reviews?game=${games[0].id}`)).data.total, 1);

  const r = found.reviews[0];
  assert.equal((await player('DELETE', `/api/admin/reviews/${r.game_id}/${r.user_id}`)).status, 403);
  assert.equal((await owner('DELETE', `/api/admin/reviews/${r.game_id}/${r.user_id}`)).status, 200);
  assert.equal((await owner('DELETE', `/api/admin/reviews/${r.game_id}/${r.user_id}`)).status, 404);
  assert.equal((await owner('GET', '/api/admin/reviews')).data.total, 1);
  const log = (await owner('GET', '/api/admin/log')).data.entries;
  assert.ok(log.some((e) => e.action === 'review.delete'));
});

test('карусель: только владелец; свой слайд без картинки на главной не показывается', async () => {
  assert.deepEqual((await (await fetch(`${base}/api/hero`)).json()).slides, []);
  assert.equal((await player('POST', '/api/admin/hero', { kind: 'game', game_id: games[0].id })).status, 403);

  const a = (await owner('POST', '/api/admin/hero', { kind: 'game', game_id: games[2].id })).data.slide;
  assert.equal(a.kind, 'game');
  assert.equal((await owner('POST', '/api/admin/hero', { kind: 'game', game_id: 'ffffffffffffffff' })).status, 400);
  assert.equal((await owner('POST', '/api/admin/hero', { kind: 'custom', title: 'Акция', link: 'javascript:alert(1)' })).status, 400);
  const c = (await owner('POST', '/api/admin/hero', { kind: 'custom', title: 'Турнир недели', link: '/tournament', button: 'Смотреть' })).data.slide;

  let pub = (await (await fetch(`${base}/api/hero`)).json()).slides;
  assert.deepEqual(pub.map((s) => s.kind), ['game'], 'без картинки свой слайд не виден');

  assert.equal((await owner('POST', `/api/admin/hero/${c.id}/image`, png(800, 450), 'image/png')).status, 400, 'меньше 960 px');
  assert.equal((await owner('POST', `/api/admin/hero/${c.id}/image`, png(1280, 1280), 'image/png')).status, 400, 'не 16:9');
  const up = await owner('POST', `/api/admin/hero/${c.id}/image`, png(1280, 720), 'image/png');
  assert.equal(up.status, 200);
  const img = await fetch(base + up.data.slide.image_url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  pub = (await (await fetch(`${base}/api/hero`)).json()).slides;
  assert.deepEqual(pub.map((s) => s.kind), ['game', 'custom']);
  assert.equal(pub[1].button, 'Смотреть');

  // Порядок, выключение, удаление.
  assert.equal((await owner('POST', '/api/admin/hero/order', { ids: [c.id] })).status, 400, 'нужны все слайды');
  assert.equal((await owner('POST', '/api/admin/hero/order', { ids: [c.id, a.id] })).status, 200);
  assert.equal((await owner('PUT', `/api/admin/hero/${a.id}`, { active: false })).status, 200);
  pub = (await (await fetch(`${base}/api/hero`)).json()).slides;
  assert.deepEqual(pub.map((s) => s.kind), ['custom']);
  assert.equal((await owner('PUT', `/api/admin/hero/${c.id}`, { title: 'Новый турнир' })).data.slide.title, 'Новый турнир');
  assert.equal((await owner('DELETE', `/api/admin/hero/${c.id}`)).status, 200);
  assert.equal((await fetch(base + up.data.slide.image_url)).status, 404, 'картинка удалённого слайда стирается');
});

test('отметка «на главную» у демо-игры переживает перезапуск сервера', async () => {
  assert.equal((await owner('POST', `/api/admin/games/${games[1].id}`, { action: 'feature' })).status, 200);
  await new Promise((r) => server.close(r));
  await start();
  const g = (await (await fetch(`${base}/api/games`)).json()).games.find((x) => x.id === games[1].id);
  assert.ok(g.featured > 0, 'после перезапуска отметка на месте');
});
