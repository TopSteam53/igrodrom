import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server, base, dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-test-'));
  server = createApp({ dataDir, publicDir: path.join(root, 'public'), adminEmails: ['admin@test.ru'] });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Minimal cookie-keeping client.
function client() {
  let cookie = '';
  return async (method, url, { json, body, headers = {} } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(cookie && { cookie }), ...(json && { 'content-type': 'application/json' }), ...headers },
      body: json ? JSON.stringify(json) : body,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
  };
}

const GAME = '<!doctype html><canvas id="c"></canvas><script>console.log(1)</script>';
const upload = (c, title = 'Тест', genre = 'Аркады', body = GAME) =>
  c('POST', `/api/games?title=${encodeURIComponent(title)}&genre=${encodeURIComponent(genre)}`,
    { body, headers: { 'content-type': 'text/html' } });

test('регистрация, вход, выход', async () => {
  const c = client();
  let r = await c('POST', '/api/register', { json: { email: 'Author@Test.ru', password: 'secret123', name: 'Автор' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, 'author@test.ru');
  assert.equal(r.data.user.isAdmin, false);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);

  r = await c('GET', '/api/me');
  assert.equal(r.data.user.name, 'Автор');

  r = await c('POST', '/api/register', { json: { email: 'author@test.ru', password: 'secret123', name: 'Дубль' } });
  assert.equal(r.status, 409);

  await c('POST', '/api/logout');
  assert.equal((await c('GET', '/api/me')).data.user, null);

  r = await c('POST', '/api/login', { json: { email: 'author@test.ru', password: 'wrong-pass' } });
  assert.equal(r.status, 401);
  r = await c('POST', '/api/login', { json: { email: 'author@test.ru', password: 'secret123' } });
  assert.equal(r.status, 200);
});

test('валидация регистрации', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/register', { json: { email: 'bad', password: 'secret123', name: 'Ок' } })).status, 400);
  assert.equal((await c('POST', '/api/register', { json: { email: 'a@b.ru', password: 'short', name: 'Ок' } })).status, 400);
  assert.equal((await c('POST', '/api/register', { json: { email: 'a@b.ru', password: 'secret123', name: 'x' } })).status, 400);
});

test('загрузка → модерация → каталог', async () => {
  const author = client();
  await author('POST', '/api/register', { json: { email: 'dev@test.ru', password: 'secret123', name: 'Разработчик' } });
  const admin = client();
  await admin('POST', '/api/register', { json: { email: 'admin@test.ru', password: 'secret123', name: 'Модератор' } });
  const guest = client();

  assert.equal((await upload(guest)).status, 401, 'без входа загружать нельзя');

  const up = await upload(author, 'Моя <b>игра</b>');
  assert.equal(up.status, 201);
  const { id } = up.data.game;
  assert.equal(up.data.game.status, 'pending');

  // Пока на модерации: не в каталоге и не открывается гостю, но открывается автору.
  assert.equal((await guest('GET', '/api/games')).data.games.length, 0);
  assert.equal((await guest('GET', `/play/${id}`)).status, 404);
  const own = await author('GET', `/play/${id}`);
  assert.equal(own.status, 200);
  assert.equal(own.data, GAME);

  assert.equal((await author('GET', '/api/admin/games')).status, 403, 'автор не модератор');
  assert.equal((await author('POST', `/api/admin/games/${id}`, { json: { action: 'approve' } })).status, 403);

  const queue = await admin('GET', '/api/admin/games?status=pending');
  assert.deepEqual(queue.data.games.map((g) => g.id), [id]);
  assert.equal((await admin('POST', `/api/admin/games/${id}`, { json: { action: 'approve' } })).status, 200);

  const list = await guest('GET', '/api/games');
  assert.equal(list.data.games.length, 1);
  assert.equal(list.data.games[0].title, 'Моя <b>игра</b>');
  assert.equal(list.data.games[0].author, 'Разработчик');

  const play = await guest('GET', `/play/${id}`);
  assert.equal(play.status, 200);
  assert.match(play.headers.get('content-security-policy'), /^sandbox allow-scripts/);
  assert.doesNotMatch(play.headers.get('content-security-policy'), /allow-same-origin/);

  const mine = await author('GET', '/api/my/games');
  assert.equal(mine.data.games[0].status, 'approved');
});

test('отклонение с причиной и удаление только своим автором', async () => {
  const a = client();
  await a('POST', '/api/register', { json: { email: 'a1@test.ru', password: 'secret123', name: 'Первый' } });
  const b = client();
  await b('POST', '/api/register', { json: { email: 'b1@test.ru', password: 'secret123', name: 'Второй' } });
  const admin = client();
  await admin('POST', '/api/login', { json: { email: 'admin@test.ru', password: 'secret123' } });

  const { id } = (await upload(a, 'Чужая')).data.game;
  await admin('POST', `/api/admin/games/${id}`, { json: { action: 'reject', reason: 'Нарушает правила' } });
  const g = (await a('GET', '/api/my/games')).data.games.find((x) => x.id === id);
  assert.equal(g.status, 'rejected');
  assert.equal(g.reject_reason, 'Нарушает правила');

  assert.equal((await b('DELETE', `/api/games/${id}`)).status, 404, 'чужую игру удалить нельзя');
  assert.equal((await a('DELETE', `/api/games/${id}`)).status, 200);
  assert.equal(fs.existsSync(path.join(dataDir, 'games', `${id}.html`)), false);
});

test('проверки загрузки', async () => {
  const c = client();
  await c('POST', '/api/register', { json: { email: 'up@test.ru', password: 'secret123', name: 'Загрузчик' } });
  assert.equal((await upload(c, 'x')).status, 400, 'короткое название');
  assert.equal((await upload(c, 'Норм', 'Казино')).status, 400, 'неизвестный жанр');
  assert.equal((await upload(c, 'Норм', 'Аркады', '')).status, 400, 'пустой файл');
  assert.equal((await upload(c, 'Норм', 'Аркады', 'просто текст')).status, 400, 'не HTML');
  const big = '<html>' + 'x'.repeat(5 * 1024 * 1024);
  assert.equal((await upload(c, 'Норм', 'Аркады', big)).status, 413, 'больше 5 МБ');
});

test('запросы с чужого сайта отклоняются', async () => {
  const c = client();
  const r = await c('POST', '/api/register', {
    json: { email: 'x@test.ru', password: 'secret123', name: 'Икс' }, headers: { origin: 'https://evil.example' },
  });
  assert.equal(r.status, 403);
});

test('статика и защита от выхода из папки', async () => {
  const c = client();
  assert.equal((await c('GET', '/')).status, 200);
  assert.equal((await c('GET', '/games/snake.html')).status, 200);
  assert.equal((await c('GET', '/%2e%2e/package.json')).status, 404);
  assert.equal((await c('GET', '/..%2fserver%2fapp.js')).status, 404);
});

test('ограничение попыток входа', async () => {
  const c = client();
  for (let i = 0; i < 10; i++) await c('POST', '/api/login', { json: { email: 'brute@test.ru', password: 'nope-nope' } });
  const r = await c('POST', '/api/login', { json: { email: 'brute@test.ru', password: 'nope-nope' } });
  assert.equal(r.status, 429);
});
