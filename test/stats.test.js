import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60 * 1000;
// 13 октября 2026, 12:00 по Москве.
let clock = Date.parse('2026-10-13T12:00:00+03:00');
let server, base, dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-stats-'));
  server = createApp({
    dataDir, publicDir: path.join(root, 'public'), adminEmails: ['admin@test.ru'],
    now: () => clock,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const UA = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130';

// Отдельный «браузер» со своими cookie.
function browser() {
  let jar = {};
  return async (method, url, { json, body, headers = {} } = {}) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method,
      headers: { 'user-agent': UA, ...(cookie && { cookie }), ...(json && { 'content-type': 'application/json' }), ...headers },
      body: json ? JSON.stringify(json) : body,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
  };
}

async function publishGame(author, admin, title) {
  const r = await author('POST', `/api/games?title=${encodeURIComponent(title)}&genre=${encodeURIComponent('Аркады')}`,
    { body: '<html><canvas></canvas></html>', headers: { 'content-type': 'text/html' } });
  await admin('POST', `/api/admin/games/${r.data.game.id}`, { json: { action: 'approve' } });
  return r.data.game.id;
}

let author, admin, gameA, gameB;

test('подготовка: автор, модератор, две игры', async () => {
  author = browser();
  await author('POST', '/api/register', { json: { email: 'stat@test.ru', password: 'secret123', name: 'Статист' } });
  admin = browser();
  await admin('POST', '/api/register', { json: { email: 'admin@test.ru', password: 'secret123', name: 'Модер' } });
  await author('POST', '/api/developer/application', {
    json: { studio: 'Статист', about: 'Делаю небольшие браузерные игры.', contact: '@stat' },
  });
  const me = (await author('GET', '/api/me')).data.user;
  await admin('POST', `/api/admin/developers/${me.id}`, { json: { action: 'approve' } });
  gameA = await publishGame(author, admin, 'Игра А');
  gameB = await publishGame(author, admin, 'Игра Б');
});

test('запуск засчитывается один раз за 30 минут на игрока', async () => {
  const p1 = browser();
  assert.equal((await p1('POST', `/api/games/${gameA}/play`)).data.counted, true);
  assert.equal((await p1('POST', `/api/games/${gameA}/play`)).data.counted, false, 'обновил страницу');
  clock += 20 * MIN;
  assert.equal((await p1('POST', `/api/games/${gameA}/play`)).data.counted, false, 'вернулся через 20 минут');
  clock += 31 * MIN;
  assert.equal((await p1('POST', `/api/games/${gameA}/play`)).data.counted, true, 'вернулся через 31 минуту');

  const p2 = browser();
  assert.equal((await p2('POST', `/api/games/${gameA}/play`)).data.counted, true, 'другой игрок');

  const s = (await author('GET', '/api/my/stats?days=7')).data;
  const a = s.games.find((g) => g.id === gameA);
  assert.equal(a.plays, 3);
  assert.equal(a.uniques, 2, 'p1 дважды, но игрок один');
});

test('время сессии: засчитывается один раз, не больше реального', async () => {
  const p = browser();
  await p('POST', `/api/games/${gameB}/play`);
  clock += 4 * MIN;
  assert.equal((await p('POST', `/api/games/${gameB}/play-end`, { json: { seconds: 240 } })).data.recorded, true);
  assert.equal((await p('POST', `/api/games/${gameB}/play-end`, { json: { seconds: 240 } })).data.recorded, false, 'повтор');

  const cheat = browser();
  await cheat('POST', `/api/games/${gameB}/play`);
  clock += 1 * MIN;
  await cheat('POST', `/api/games/${gameB}/play-end`, { json: { seconds: 99999 } });

  const stranger = browser();
  assert.equal((await stranger('POST', `/api/games/${gameB}/play-end`, { json: { seconds: 100 } })).data.recorded, false,
    'без открытия игры время не принимается');

  const b = (await author('GET', '/api/my/stats?days=7')).data.games.find((g) => g.id === gameB);
  assert.equal(b.plays, 2);
  assert.ok(b.seconds >= 240 + 60 && b.seconds <= 240 + 65, `ожидали ~300 с, получили ${b.seconds}`);
});

test('боты, неодобренные игры и чужая статистика', async () => {
  const bot = browser();
  const r = await bot('POST', `/api/games/${gameA}/play`, { headers: { 'user-agent': 'Googlebot/2.1' } });
  assert.equal(r.data.counted, false);

  const pending = (await author('POST', `/api/games?title=${encodeURIComponent('Черновик')}&genre=${encodeURIComponent('Прочее')}`,
    { body: '<html></html>', headers: { 'content-type': 'text/html' } })).data.game.id;
  assert.equal((await browser()('POST', `/api/games/${pending}/play`)).status, 404);

  const other = browser();
  await other('POST', '/api/register', { json: { email: 'other@test.ru', password: 'secret123', name: 'Другой' } });
  assert.equal((await other('GET', '/api/my/stats')).status, 403, 'статистика — только для разработчиков');
  assert.equal((await browser()('GET', '/api/my/stats')).status, 401);
  assert.equal((await author('GET', '/api/my/stats?days=0')).status, 400);
  assert.equal((await author('GET', '/api/my/stats?days=1000')).status, 400);
});

test('ограничение накрутки с одного IP', async () => {
  const id = await publishGame(author, admin, 'Накрутка');
  let counted = 0;
  for (let i = 0; i < 40; i++) {
    if ((await browser()('POST', `/api/games/${id}/play`)).data.counted) counted++;
  }
  assert.equal(counted, 30, 'новые cookie каждый раз, но IP один');
});

test('дни, итоги и каталог', async () => {
  // Следующий день по Москве.
  clock = Date.parse('2026-10-14T09:00:00+03:00');
  const p = browser();
  await p('POST', `/api/games/${gameA}/play`);
  clock += 6 * MIN;
  await p('POST', `/api/games/${gameA}/play-end`, { json: { seconds: 360 } });

  const s = (await author('GET', '/api/my/stats?days=2')).data;
  assert.deepEqual(s.period, { from: '2026-10-13', to: '2026-10-14', days: 2, tz: 'Europe/Moscow' });
  assert.deepEqual(s.daily.map((d) => d.day), ['2026-10-13', '2026-10-14']);
  assert.equal(s.daily[1].plays, 1);
  assert.equal(s.daily[1].seconds, 360);
  assert.equal(s.totals.plays, s.daily[0].plays + s.daily[1].plays);

  const a = s.games.find((g) => g.id === gameA);
  assert.equal(a.plays, 4);
  assert.equal(s.totals.seconds, s.daily[0].seconds + s.daily[1].seconds);

  const oneDay = (await author('GET', '/api/my/stats?days=1')).data.games.find((g) => g.id === gameA);
  assert.equal(oneDay.plays, 1, 'только сегодня');
  assert.equal(oneDay.plays_all_time, 4);
  assert.equal(oneDay.seconds, 360, 'время только за сегодня');

  const catalog = (await browser()('GET', '/api/games')).data.games;
  assert.equal(catalog.find((g) => g.id === gameA).plays, 4);
});

test('игроки за период: разные, новые и вернувшиеся; одна игра на выбор', async () => {
  clock = Date.parse('2026-10-15T10:00:00+03:00');
  const x = browser();
  const y = browser();
  await x('POST', `/api/games/${gameA}/play`);
  await y('POST', `/api/games/${gameB}/play`);
  clock = Date.parse('2026-10-16T10:00:00+03:00');
  await x('POST', `/api/games/${gameA}/play`);
  await x('POST', `/api/games/${gameA}/play-end`, { json: { seconds: 5 } });

  const two = (await author('GET', '/api/my/stats?days=2')).data;
  const a = two.games.find((g) => g.id === gameA);
  assert.deepEqual([a.players, a.fresh, a.returning], [1, 1, 1], 'x — один человек, новый, и вернулся на следующий день');
  const b = two.games.find((g) => g.id === gameB);
  assert.deepEqual([b.players, b.fresh, b.returning], [1, 1, 0]);
  assert.equal(two.totals.players, 2);

  const one = (await author('GET', `/api/my/stats?days=1&game=${gameA}`)).data;
  assert.equal(one.game, gameA);
  assert.equal(one.totals.players, 1);
  assert.equal(one.totals.fresh, 0, 'сегодня x уже не новый');
  assert.equal(one.totals.plays, 1, 'по дням — только выбранная игра');
  assert.equal((await author('GET', '/api/my/stats?days=1&game=zzz')).status, 400);
  // Чужую игру через фильтр не увидеть: по ней просто пусто.
  const other = browser();
  await other('POST', '/api/register', { json: { email: 'other-stat@test.ru', password: 'secret123', name: 'Другой' } });
  assert.equal((await other('GET', `/api/my/stats?days=7&game=${gameA}`)).status, 403);
});

test('удаление игры удаляет её статистику', async () => {
  await author('DELETE', `/api/games/${gameB}`);
  const s = (await author('GET', '/api/my/stats?days=7')).data;
  assert.equal(s.games.find((g) => g.id === gameB), undefined);
});
