// Траты монеток на сайте: благодарность автору игры и день без рекламы.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

let server, base, dataDir, publicDir, owner, dev, player, devId, gameId;
let clock = Date.parse('2026-10-24T12:00:00+03:00');

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

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-support-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-supportpub-'));
  server = createApp({ dataDir, publicDir, adminEmails: ['owner@test.ru'], now: () => clock });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  owner = browser();
  await owner('POST', '/api/register', { email: 'owner@test.ru', password: 'secret123', name: 'Владелец' });
  dev = browser();
  await dev('POST', '/api/register', { email: 'dev@test.ru', password: 'secret123', name: 'Автор' });
  devId = (await dev('GET', '/api/me')).data.user.id;
  await dev('POST', '/api/developer/application', { studio: 'Студия', about: 'Делаю браузерные игры давно.', contact: '@dev' });
  await owner('POST', `/api/admin/developers/${devId}`, { action: 'approve' });
  gameId = (await dev('POST', `/api/games?${new URLSearchParams({ title: 'Игра', genre: 'Аркады' })}`, '<html></html>', 'text/html')).data.game.id;
  await owner('POST', `/api/admin/games/${gameId}`, { action: 'approve' });
  player = browser();
  await player('POST', '/api/register', { email: 'player@test.ru', password: 'secret123', name: 'Игрок' });
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

const coins = async (b) => (await b('GET', '/api/me')).data.user.coins;

test('благодарность автору: списывается, видна в статистике, свою игру нельзя', async () => {
  assert.equal((await browser()('POST', `/api/games/${gameId}/thanks`, { amount: 5 })).status, 401);
  assert.equal((await dev('POST', `/api/games/${gameId}/thanks`, { amount: 5 })).status, 400, 'свою игру');
  assert.equal((await player('POST', `/api/games/${gameId}/thanks`, { amount: 7 })).status, 400, 'только 5, 10, 25');
  const before = await coins(player);
  const r = await player('POST', `/api/games/${gameId}/thanks`, { amount: 10 });
  assert.equal(r.status, 200);
  assert.equal(r.data.coins, before - 10);
  assert.deepEqual(r.data.thanks, { times: 1, coins: 10 });
  const s = (await dev('GET', '/api/my/stats?days=7')).data;
  assert.deepEqual([s.games[0].thanks, s.games[0].thanks_coins, s.totals.thanks], [1, 10, 1]);
  const history = (await player('GET', '/api/me/coins')).data;
  assert.ok(JSON.stringify(history).includes('Благодарность автору'), 'в истории монеток');
});

test('благодарности: не больше 100 монеток за сутки и не больше, чем есть', async () => {
  const rich = browser();
  await rich('POST', '/api/register', { email: 'rich@test.ru', password: 'secret123', name: 'Богач' });
  const richId = (await rich('GET', '/api/me')).data.user.id;
  await owner('POST', `/api/admin/users/${richId}/coins`, { amount: 500, reason: 'тест' });
  for (let i = 0; i < 4; i++) assert.equal((await rich('POST', `/api/games/${gameId}/thanks`, { amount: 25 })).status, 200);
  assert.equal((await rich('POST', `/api/games/${gameId}/thanks`, { amount: 5 })).status, 429, 'лимит за сутки');
  clock += 25 * 3600 * 1000;
  assert.equal((await rich('POST', `/api/games/${gameId}/thanks`, { amount: 5 })).status, 200, 'через сутки снова можно');

  const poor = browser();
  await poor('POST', '/api/register', { email: 'poor@test.ru', password: 'secret123', name: 'Бедняк' });
  const left = await coins(poor);
  const spendAll = Math.floor(left / 25);
  for (let i = 0; i < spendAll && i < 4; i++) await poor('POST', `/api/games/${gameId}/thanks`, { amount: 25 });
  if (await coins(poor) < 5) assert.equal((await poor('POST', `/api/games/${gameId}/thanks`, { amount: 5 })).status, 409);
});

test('день без рекламы: 30 монеток за сутки, покупка продлевает', async () => {
  const playerId = (await player('GET', '/api/me')).data.user.id;
  await owner('POST', `/api/admin/users/${playerId}/coins`, { amount: 100, reason: 'тест' });
  const before = await coins(player);
  const r = await player('POST', '/api/me/no-ads');
  assert.equal(r.status, 200);
  assert.equal(r.data.coins, before - 30);
  assert.equal(r.data.noAdsUntil, clock + 24 * 3600 * 1000);
  assert.equal((await player('GET', '/api/me')).data.user.noAdsUntil, clock + 24 * 3600 * 1000);
  const again = await player('POST', '/api/me/no-ads');
  assert.equal(again.data.noAdsUntil, clock + 48 * 3600 * 1000, 'вторые сутки добавляются к первым');
  clock += 49 * 3600 * 1000;
  assert.equal((await player('GET', '/api/me')).data.user.noAdsUntil, 0, 'кончилось');
  assert.equal((await browser()('POST', '/api/me/no-ads')).status, 401);
});
