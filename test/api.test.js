import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { makeZip } from './make-zip.js';

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
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
  };
}

const APPLICATION = { studio: 'Студия', about: 'Делаю небольшие браузерные игры уже два года.', links: '', contact: '@studio' };

// Подать заявку разработчика и одобрить её модератором — без этого загружать игры нельзя.
async function approveDeveloper(c) {
  const admin = client();
  const r = await admin('POST', '/api/login', { json: { email: 'admin@test.ru', password: 'secret123' } });
  if (r.status !== 200) await admin('POST', '/api/register', { json: { email: 'admin@test.ru', password: 'secret123', name: 'Модератор' } });
  await c('POST', '/api/developer/application', { json: APPLICATION });
  const me = (await c('GET', '/api/me')).data.user;
  await admin('POST', `/api/admin/developers/${me.id}`, { json: { action: 'approve' } });
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
  await approveDeveloper(author);
  const guest = client();

  assert.equal((await upload(guest)).status, 401, 'без входа загружать нельзя');

  const up = await upload(author, 'Моя <b>игра</b>');
  assert.equal(up.status, 201);
  const { id } = up.data.game;
  assert.equal(up.data.game.status, 'pending');

  // Пока на модерации: нет в каталоге и по /play/, но автор открывает по подписанной ссылке.
  assert.equal((await guest('GET', '/api/games')).data.games.length, 0);
  assert.equal((await guest('GET', `/play/${id}/`)).status, 404);
  assert.equal((await author('GET', `/play/${id}/`)).status, 404);
  const { preview_url } = (await author('GET', '/api/my/games')).data.games[0];
  assert.match(preview_url, /^\/preview\/[0-9a-f]{16}\.\d+\.[0-9a-f]{32}\/$/);
  const own = await guest('GET', preview_url); // ссылка работает и без cookie: так грузятся ресурсы игры
  assert.equal(own.status, 200);
  assert.equal(own.data, GAME);
  assert.match(own.headers.get('content-security-policy'), /^sandbox allow-scripts/);
  const forged = preview_url.replace(/[0-9a-f]{32}\/$/, '0'.repeat(32) + '/');
  assert.equal((await guest('GET', forged)).status, 404, 'поддельная подпись');
  const otherId = preview_url.replace(id, 'f'.repeat(16));
  assert.equal((await guest('GET', otherId)).status, 404, 'подпись от другой игры');

  assert.equal((await author('GET', '/api/admin/games')).status, 403, 'автор не модератор');
  assert.equal((await author('POST', `/api/admin/games/${id}`, { json: { action: 'approve' } })).status, 403);

  const queue = await admin('GET', '/api/admin/games?status=pending');
  assert.deepEqual(queue.data.games.map((g) => g.id), [id]);
  assert.equal((await admin('POST', `/api/admin/games/${id}`, { json: { action: 'approve' } })).status, 200);

  const list = await guest('GET', '/api/games');
  assert.equal(list.data.games.length, 1);
  assert.equal(list.data.games[0].title, 'Моя <b>игра</b>');
  assert.equal(list.data.games[0].author, 'Разработчик');

  const redirect = await guest('GET', `/play/${id}`);
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), `/play/${id}/`);
  const play = await guest('GET', `/play/${id}/`);
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
  await approveDeveloper(a);
  const admin = client();
  await admin('POST', '/api/login', { json: { email: 'admin@test.ru', password: 'secret123' } });

  const { id } = (await upload(a, 'Чужая')).data.game;
  await admin('POST', `/api/admin/games/${id}`, { json: { action: 'reject', reason: 'Нарушает правила' } });
  const g = (await a('GET', '/api/my/games')).data.games.find((x) => x.id === id);
  assert.equal(g.status, 'rejected');
  assert.equal(g.reject_reason, 'Нарушает правила');

  assert.equal((await b('DELETE', `/api/games/${id}`)).status, 404, 'чужую игру удалить нельзя');
  assert.equal((await a('DELETE', `/api/games/${id}`)).status, 200);
  assert.equal(fs.existsSync(path.join(dataDir, 'games', id)), false);
});

test('проверки загрузки', async () => {
  const c = client();
  await c('POST', '/api/register', { json: { email: 'up@test.ru', password: 'secret123', name: 'Загрузчик' } });
  await approveDeveloper(c);
  assert.equal((await upload(c, 'x')).status, 400, 'короткое название');
  assert.equal((await upload(c, 'Норм', 'Казино')).status, 400, 'неизвестный жанр');
  assert.equal((await upload(c, 'Норм', 'Аркады', '')).status, 400, 'пустой файл');
  assert.equal((await upload(c, 'Норм', 'Аркады', 'просто текст')).status, 400, 'не HTML');
  const big = '<html>' + 'x'.repeat(5 * 1024 * 1024);
  assert.equal((await upload(c, 'Норм', 'Аркады', big)).status, 413, 'html больше 5 МБ');
  const huge = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100 * 1024 * 1024)]);
  assert.equal((await upload(c, 'Норм', 'Аркады', huge)).status, 413, 'архив больше 100 МБ');
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
  assert.equal((await c('GET', '/games/snake/index.html')).status, 200);
  assert.equal((await c('GET', '/%2e%2e/package.json')).status, 404);
  assert.equal((await c('GET', '/..%2fserver%2fapp.js')).status, 404);
});

test('ограничение попыток входа', async () => {
  const c = client();
  for (let i = 0; i < 10; i++) await c('POST', '/api/login', { json: { email: 'brute@test.ru', password: 'nope-nope' } });
  const r = await c('POST', '/api/login', { json: { email: 'brute@test.ru', password: 'nope-nope' } });
  assert.equal(r.status, 429);
});

test('загрузка ZIP: подпапки, MIME-типы, модерация, удаление', async () => {
  const author = client();
  await author('POST', '/api/register', { json: { email: 'zip@test.ru', password: 'secret123', name: 'Архиватор' } });
  await approveDeveloper(author);
  const admin = client();
  await admin('POST', '/api/login', { json: { email: 'admin@test.ru', password: 'secret123' } });
  const guest = client();

  const zip = makeZip([
    { name: 'my-game/index.html', data: '<!doctype html><script src="js/main.js"></script>' },
    { name: 'my-game/js/main.js', data: 'fetch("data/level.json")' },
    { name: 'my-game/data/level.json', data: '{"level":1}' },
    { name: 'my-game/img/hero.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), method: 0 },
    { name: 'my-game/core.wasm', data: Buffer.from([0, 0x61, 0x73, 0x6d]) },
  ]);
  const up = await upload(author, 'Архивная игра', 'Аркады', zip);
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const { id, preview_url } = up.data.game;
  assert.equal(up.data.game.file_count, 5);

  // До одобрения: ресурсы доступны только по подписанной ссылке.
  assert.equal((await guest('GET', `/play/${id}/js/main.js`)).status, 404);
  assert.equal((await guest('GET', `${preview_url}js/main.js`)).status, 200);

  await admin('POST', `/api/admin/games/${id}`, { json: { action: 'approve' } });

  const expect = {
    '': 'text/html', 'js/main.js': 'text/javascript', 'data/level.json': 'application/json',
    'img/hero.png': 'image/png', 'core.wasm': 'application/wasm',
  };
  for (const [file, type] of Object.entries(expect)) {
    const r = await guest('GET', `/play/${id}/${file}`);
    assert.equal(r.status, 200, file);
    assert.ok(r.headers.get('content-type').startsWith(type), `${file}: ${r.headers.get('content-type')}`);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.match(r.headers.get('content-security-policy'), /^sandbox/);
  }
  assert.equal((await guest('GET', `/play/${id}/nope.js`)).status, 404);
  assert.equal((await guest('GET', `/play/${id}/..%2f..%2figrodrom.db`)).status, 404);
  assert.equal((await guest('GET', `/play/${id}/%2e%2e/%2e%2e/igrodrom.db`)).status, 404);

  assert.equal((await author('DELETE', `/api/games/${id}`)).status, 200);
  assert.equal(fs.existsSync(path.join(dataDir, 'games', id)), false);
});

test('плохие архивы отклоняются с понятной ошибкой', async () => {
  const c = client();
  await c('POST', '/api/register', { json: { email: 'badzip@test.ru', password: 'secret123', name: 'Ломатель' } });
  await approveDeveloper(c);
  const cases = [
    [makeZip([{ name: 'game.html', data: '<html>' }]), /index\.html/],
    [makeZip([{ name: 'index.html', data: '<html>' }, { name: '../evil.js', data: 'x' }]), /Недопустимый путь/],
    [makeZip([{ name: 'index.html', data: 'просто текст' }]), /не похож/],
    [makeZip([{ name: 'index.html', data: '<html>' }, { name: 'a', data: '1' }, { name: 'a/b', data: '2' }]), /Конфликт путей/],
  ];
  for (const [zip, re] of cases) {
    const r = await upload(c, 'Плохая', 'Прочее', zip);
    assert.equal(r.status, 400);
    assert.match(r.data.error, re);
  }
  assert.equal((await c('GET', '/api/my/games')).data.games.length, 0, 'ничего не сохранилось');
  const leftovers = fs.readdirSync(path.join(dataDir, 'games')).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'временные папки убраны');
});

test('игры старого формата (games/<id>.html) переезжают в папки', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-migrate-'));
  try {
    fs.mkdirSync(path.join(dir, 'games'));
    fs.writeFileSync(path.join(dir, 'games', '0123456789abcdef.html'), '<html>old</html>');
    const app = createApp({ dataDir: dir, publicDir: path.join(root, 'public') });
    assert.equal(fs.readFileSync(path.join(dir, 'games', '0123456789abcdef', 'index.html'), 'utf8'), '<html>old</html>');
    assert.equal(fs.existsSync(path.join(dir, 'games', '0123456789abcdef.html')), false);
    app.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('healthz для мониторинга и Docker', async () => {
  const r = await client()('GET', '/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
});

test('X-Forwarded-For учитывается только за своим прокси', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-proxy-'));
  const proxied = createApp({ dataDir: dir, publicDir: path.join(root, 'public'), trustProxy: true });
  await new Promise((r) => proxied.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${proxied.address().port}/api/login`;
  const login = (ip) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email: 'victim@test.ru', password: 'wrong-pass' }),
  });
  try {
    for (let i = 0; i < 10; i++) await login('203.0.113.1');
    assert.equal((await login('203.0.113.1')).status, 429, 'перебор с одного IP блокируется');
    assert.equal((await login('198.51.100.7')).status, 401, 'другой посетитель за тем же прокси не страдает');
  } finally {
    await new Promise((r) => proxied.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // Без TRUST_PROXY подделка заголовка не помогает обойти лимит.
  const c = client();
  for (let i = 0; i < 10; i++) {
    await c('POST', '/api/login', { json: { email: 'spoof@test.ru', password: 'nope-nope' }, headers: { 'x-forwarded-for': `10.0.0.${i}` } });
  }
  const r = await c('POST', '/api/login', { json: { email: 'spoof@test.ru', password: 'nope-nope' }, headers: { 'x-forwarded-for': '10.0.0.99' } });
  assert.equal(r.status, 429);
});

test('игра с Яндекс Игр: SDK подменяется, сжатая Unity-сборка отдаётся с Content-Encoding', async () => {
  const zlib = await import('node:zlib');
  const c = client();
  await c('POST', '/api/register', { json: { email: 'ya@test.ru', password: 'secret123', name: 'Яндексовец' } });
  await approveDeveloper(c);
  const wasm = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  const zip = makeZip([
    { name: 'index.html', data: '<!doctype html><script src="https://yandex.ru/games/sdk/v2"></script><canvas></canvas>' },
    { name: 'Build/game.wasm.br', data: zlib.brotliCompressSync(wasm) },
    { name: 'Build/game.data.gz', data: zlib.gzipSync(Buffer.from('level-data')) },
  ]);
  const r = await c('POST', `/api/games?title=${encodeURIComponent('С Яндекса')}&genre=${encodeURIComponent('Аркады')}`,
    { body: zip, headers: { 'content-type': 'application/zip' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.yandex_sdk, true, 'кабинет покажет, что нашёл Яндекс SDK');

  const preview = r.data.game.preview_url;
  const html = await (await fetch(base + preview)).text();
  assert.match(html, /<script src="\/sdk\.js"><\/script>/);
  // fetch сам распаковывает по Content-Encoding — получаем исходные байты.
  const br = await fetch(`${base}${preview}Build/game.wasm.br`);
  assert.equal(br.headers.get('content-type'), 'application/wasm');
  assert.equal(br.headers.get('content-encoding'), 'br');
  assert.deepEqual(Buffer.from(await br.arrayBuffer()), wasm);
  const gz = await fetch(`${base}${preview}Build/game.data.gz`);
  assert.equal(gz.headers.get('content-encoding'), 'gzip');
  assert.equal(await gz.text(), 'level-data');

  const sdk = await fetch(`${base}/sdk.js`);
  assert.equal(sdk.status, 200);
  assert.match(await sdk.text(), /YaGames/);
});
