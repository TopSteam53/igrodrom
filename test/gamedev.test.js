// Кабинет разработчика: карточка игры, картинки, обновление сборки через модерацию, страница студии.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

let server, base, dataDir, publicDir, dev, owner, devId, gameId;

function browser() {
  const jar = {};
  return async (method, url, body, type = 'application/json') => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method,
      headers: { ...(cookie && { cookie }), ...(body !== undefined && { 'content-type': type }) },
      body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
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
function png(w, h) {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
const html = (text) => `<!doctype html><html><body><canvas></canvas><p>${text}</p></body></html>`;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-dev-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-devpub-'));
  server = createApp({ dataDir, publicDir, adminEmails: ['owner@test.ru'] });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  owner = browser();
  await owner('POST', '/api/register', { email: 'owner@test.ru', password: 'secret123', name: 'Владелец' });
  dev = browser();
  await dev('POST', '/api/register', { email: 'dev@test.ru', password: 'secret123', name: 'Иван' });
  devId = (await dev('GET', '/api/me')).data.user.id;
  await dev('POST', '/api/developer/application', { studio: 'Студия Ёж', about: 'Делаю головоломки для браузера уже пять лет.', contact: '@ezh' });
  await owner('POST', `/api/admin/developers/${devId}`, { action: 'approve' });
  const up = await dev('POST', `/api/games?${new URLSearchParams({ title: 'Ёжик', genre: 'Головоломки' })}`, html('v1'), 'text/html');
  gameId = up.data.game.id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

test('карточка: теги, платформы, управление, языки, поддержка, версия', async () => {
  const ok = await dev('PATCH', `/api/games/${gameId}`, {
    short_description: 'Собери ежа из иголок', tags: ['Логика', 'логика', 'для всех'], languages: ['ru', 'en'],
    platforms: ['desktop', 'mobile'], controls: ['mouse', 'touch'], orientation: 'portrait',
    support: '@ezh_support', version: '1.0', changelog: 'Первая версия',
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.game.tags, ['логика', 'для всех'], 'теги в нижнем регистре и без повторов');

  const bad = async (body) => (await dev('PATCH', `/api/games/${gameId}`, body)).status;
  assert.equal(await bad({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), 400, 'не больше 5 тегов');
  assert.equal(await bad({ tags: ['<script>'] }), 400);
  assert.equal(await bad({ platforms: ['ps5'] }), 400);
  assert.equal(await bad({ platforms: [] }), 400);
  assert.equal(await bad({ orientation: 'diagonal' }), 400);
  assert.equal(await bad({ short_description: 'x'.repeat(121) }), 400);
  assert.equal((await owner('PATCH', `/api/games/${gameId}`, { version: '2' })).status, 404, 'чужую игру не редактируют');

  const mine = (await dev('GET', '/api/my/games')).data.games[0];
  assert.deepEqual([mine.orientation, mine.platforms, mine.controls, mine.languages, mine.version],
    ['portrait', ['desktop', 'mobile'], ['mouse', 'touch'], ['ru', 'en'], '1.0']);
});

test('картинки: обложка 16:9, квадратная иконка, до 8 скриншотов', async () => {
  const media = (kind, buf) => dev('POST', `/api/games/${gameId}/media/${kind}`, buf, 'image/png');
  assert.equal((await media('cover', png(600, 600))).status, 400, 'обложка — горизонтальная');
  assert.equal((await media('cover', png(320, 180))).status, 400, 'слишком маленькая');
  assert.equal((await media('cover', Buffer.from('<svg>'.padEnd(64)))).status, 400);
  const cover = await media('cover', png(1280, 720));
  assert.equal(cover.status, 201);
  assert.match(cover.data.url, new RegExp(`^/play/${gameId}/_media/cover-[0-9a-f]{12}\\.png$`));
  assert.equal((await media('icon', png(512, 300))).status, 400, 'иконка — квадратная');
  assert.equal((await media('icon', png(512, 512))).status, 201);
  for (let i = 0; i < 8; i++) assert.equal((await media('shot', png(1280, 720))).status, 201);
  assert.equal((await media('shot', png(1280, 720))).status, 400, 'девятый не принимаем');

  let shots = (await dev('GET', '/api/my/games')).data.games[0].screenshots;
  assert.equal(shots.length, 8);
  const name = (u) => u.split('/').pop();
  const first = name(shots[0]);
  shots = (await dev('POST', `/api/games/${gameId}/media/shot/0`, { to: 2 })).data.screenshots;
  assert.equal(name(shots[2]), first, 'порядок меняется');
  shots = (await dev('DELETE', `/api/games/${gameId}/media/shot/2`)).data.screenshots;
  assert.equal(shots.length, 7);
  assert.ok(!shots.map(name).includes(first));
  const mine = (await dev('GET', '/api/my/games')).data.games[0];
  assert.match(mine.cover_url, /_media\/cover-/);
});

test('новая сборка опубликованной игры ждёт проверки, игроки играют в прежнюю', async () => {
  // Пока игра не опубликована, сборка просто заменяется.
  let r = await dev('POST', `/api/games/${gameId}/build`, html('v1.1'), 'text/html');
  assert.equal(r.data.replaced, true);
  assert.equal((await owner('POST', `/api/admin/games/${gameId}`, { action: 'approve' })).status, 200);
  const play = async () => (await fetch(`${base}/play/${gameId}/`)).text();
  assert.match(await play(), /v1\.1/);

  r = await dev('POST', `/api/games/${gameId}/build`, html('v2'), 'text/html');
  assert.deepEqual([r.data.replaced, r.data.next_status], [false, 'pending']);
  assert.match(await play(), /v1\.1/, 'до проверки — прежняя версия');

  const queue = (await owner('GET', '/api/admin/games?status=pending')).data;
  assert.equal(queue.updates.length, 1);
  const preview = await fetch(base + queue.updates[0].preview_url);
  assert.match(await preview.text(), /v2/, 'модератор открывает новую версию');
  assert.equal((await fetch(`${base}/preview-next/${gameId}.1.${'0'.repeat(32)}/`)).status, 404);

  assert.equal((await owner('POST', `/api/admin/games/${gameId}/build`, { action: 'reject', reason: '' })).status, 400);
  assert.equal((await owner('POST', `/api/admin/games/${gameId}/build`, { action: 'reject', reason: 'Чёрный экран' })).status, 200);
  let mine = (await dev('GET', '/api/my/games')).data.games[0];
  assert.deepEqual([mine.next.status, mine.next.reason], ['rejected', 'Чёрный экран']);
  assert.match(await play(), /v1\.1/);

  await dev('POST', `/api/games/${gameId}/build`, html('v3'), 'text/html');
  assert.equal((await owner('POST', `/api/admin/games/${gameId}/build`, { action: 'approve' })).status, 200);
  assert.match(await play(), /v3/);
  mine = (await dev('GET', '/api/my/games')).data.games[0];
  assert.equal(mine.next, null);
  assert.equal((await fetch(base + mine.cover_url)).status, 200, 'обложка из кабинета пережила обновление');
  assert.equal(mine.screenshots.length, 7);
  const log = (await owner('GET', '/api/admin/log')).data.entries.map((e) => e.action);
  assert.ok(log.includes('game.update.approve') && log.includes('game.update.reject'));
});

test('страница игры и студии для игроков', async () => {
  const g = (await dev('GET', `/api/games/${gameId}`)).data.game;
  assert.equal(g.author, 'Студия Ёж');
  assert.deepEqual(g.tags, ['логика', 'для всех']);
  assert.equal(g.screenshots.length, 7);
  assert.equal(g.short_description, 'Собери ежа из иголок');
  assert.equal(g.next_status, undefined, 'служебное о новой версии игрокам не отдаём');

  assert.equal((await dev('PATCH', '/api/developer/profile', { website: 'javascript:alert(1)' })).status, 400);
  assert.equal((await dev('PATCH', '/api/developer/profile', { studio: 'Ёж и Ко', about: 'Головоломки', website: 'https://ezh.test' })).status, 200);
  const page = (await browser()('GET', `/api/developers/${devId}`)).data;
  assert.deepEqual([page.developer.studio, page.developer.website, page.games.length], ['Ёж и Ко', 'https://ezh.test', 1]);
  assert.equal(page.developer.contact, undefined, 'контакт из заявки — только для модераторов');
  const ownerId = (await owner('GET', '/api/me')).data.user.id;
  assert.equal((await browser()('GET', `/api/developers/${ownerId}`)).status, 404);
});
