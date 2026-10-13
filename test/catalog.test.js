import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

// Отдельная папка public с двумя демо-играми, чтобы не зависеть от настоящих.
let server, base, dataDir, publicDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-cat-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-pub-'));
  const mk = (slug, meta, cover) => {
    fs.mkdirSync(path.join(publicDir, 'games', slug), { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'index.html'), `<html>${slug}</html>`);
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'meta.json'), JSON.stringify(meta));
    if (cover) fs.writeFileSync(path.join(publicDir, 'games', slug, 'cover.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  };
  mk('alpha', { title: 'Альфа', category: 'Аркады', description: 'Про альфу', how_to_play: 'Жми', age: '6+' }, true);
  mk('beta', { title: 'Бета', category: 'Несуществующая', age: '99+' }, false);
  fs.mkdirSync(path.join(publicDir, 'games', 'no-meta'));
  fs.writeFileSync(path.join(publicDir, 'games', 'no-meta', 'index.html'), '<html>');

  server = createApp({ dataDir, publicDir, adminEmails: ['admin@test.ru'], seedDemoGames: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

function client() {
  let jar = {};
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

test('демо-игры заводятся в каталог из meta.json', async () => {
  const { games } = (await client()('GET', '/api/games')).data;
  const titles = games.map((g) => g.title).sort();
  assert.deepEqual(titles, ['Альфа', 'Бета'], 'папка без meta.json пропущена');
  const alpha = games.find((g) => g.title === 'Альфа');
  assert.equal(alpha.genre, 'Аркады');
  assert.equal(alpha.age, '6+');
  assert.equal(alpha.cover, 'cover.svg');
  assert.equal(alpha.author, 'Игродром');
  const beta = games.find((g) => g.title === 'Бета');
  assert.equal(beta.genre, 'Прочее', 'неизвестная категория → Прочее');
  assert.equal(beta.age, '0+', 'неизвестный возраст → 0+');
  assert.equal(beta.cover, null);

  const page = await fetch(`${base}/play/${alpha.id}/`);
  assert.equal(await page.text(), '<html>alpha</html>');
  assert.equal((await fetch(`${base}/play/${alpha.id}/cover.svg`)).status, 200);
});

test('повторный запуск не плодит дубли и подтягивает новые описания', async () => {
  fs.writeFileSync(path.join(publicDir, 'games', 'alpha', 'meta.json'),
    JSON.stringify({ title: 'Альфа 2', category: 'Головоломки', description: 'Новое' }));
  const again = createApp({ dataDir, publicDir, seedDemoGames: true });
  const { games } = (await client()('GET', '/api/games')).data;
  assert.equal(games.length, 2);
  const a = games.find((g) => g.title === 'Альфа 2');
  assert.equal(a.genre, 'Головоломки');
  again.close();
});

test('страница игры и оценки', async () => {
  const { games } = (await client()('GET', '/api/games')).data;
  const id = games[0].id;
  const p1 = client();
  let r = await p1('GET', `/api/games/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.game.my_vote, 0);
  assert.ok('description' in r.data.game && 'how_to_play' in r.data.game);

  r = await p1('POST', `/api/games/${id}/vote`, { value: 1 });
  assert.deepEqual(r.data, { likes: 1, dislikes: 0, my_vote: 1 });
  r = await p1('POST', `/api/games/${id}/vote`, { value: 1 });
  assert.equal(r.data.likes, 1, 'повторный лайк не удваивается');
  r = await p1('POST', `/api/games/${id}/vote`, { value: -1 });
  assert.deepEqual([r.data.likes, r.data.dislikes], [0, 1], 'передумал');
  assert.equal((await p1('GET', `/api/games/${id}`)).data.game.my_vote, -1);

  const p2 = client();
  await p2('POST', `/api/games/${id}/vote`, { value: 1 });
  r = await p2('POST', `/api/games/${id}/vote`, { value: 0 });
  assert.deepEqual([r.data.likes, r.data.dislikes], [0, 1], 'снял оценку');

  assert.equal((await p1('POST', `/api/games/${id}/vote`, { value: 5 })).status, 400);
  assert.equal((await p1('GET', '/api/games/0000000000000000')).status, 404);
  const list = (await client()('GET', '/api/games')).data.games.find((g) => g.id === id);
  assert.deepEqual([list.likes, list.dislikes], [0, 1]);
});

test('автор редактирует описание своей игры, чужую — нет', async () => {
  const author = client();
  await author('POST', '/api/register', { email: 'a@test.ru', password: 'secret123', name: 'Автор' });
  const up = await author('POST', `/api/games?title=${encodeURIComponent('Моя')}&genre=${encodeURIComponent('Спорт')}`,
    null, '<html><canvas></canvas></html>');
  const { id } = up.data.game;

  let r = await author('PATCH', `/api/games/${id}`, { description: 'Бегай и прыгай', how_to_play: 'Стрелки', age: '12+' });
  assert.equal(r.status, 200);
  const mine = (await author('GET', '/api/my/games')).data.games.find((g) => g.id === id);
  assert.deepEqual([mine.description, mine.how_to_play, mine.age, mine.genre], ['Бегай и прыгай', 'Стрелки', '12+', 'Спорт']);

  assert.equal((await author('PATCH', `/api/games/${id}`, { age: '21+' })).status, 400);
  assert.equal((await author('PATCH', `/api/games/${id}`, { genre: 'Казино' })).status, 400);
  assert.equal((await author('PATCH', `/api/games/${id}`, { description: 'x'.repeat(1501) })).status, 400);

  const other = client();
  await other('POST', '/api/register', { email: 'b@test.ru', password: 'secret123', name: 'Чужой' });
  assert.equal((await other('PATCH', `/api/games/${id}`, { description: 'взлом' })).status, 404);
  assert.equal((await client()('GET', `/api/games/${id}`)).status, 404, 'неодобренная игра не видна публично');
});

test('категории и возрастные метки', async () => {
  const r = (await client()('GET', '/api/categories')).data;
  assert.ok(r.categories.includes('Три в ряд'));
  assert.deepEqual(r.ages, ['0+', '6+', '12+', '16+', '18+']);
});
