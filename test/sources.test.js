// Источники: переходы по ссылкам с utm-метками (VK Реклама) и что эти люди делали дальше.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

let server, base, dataDir, publicDir, owner, dev, devId, gameId;
let clock = Date.parse('2026-10-27T12:00:00+03:00');
const DAY = 864e5;

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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-sources-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-sourcespub-'));
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
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

const vk = { source: 'vk_ads', campaign: '12804956' };
const report = async () => (await owner('GET', '/api/admin/sources?days=30')).data;

test('переход по метке: пришёл, играл, вернулся, зарегистрировался', async () => {
  const a = browser();
  assert.equal((await a('POST', '/api/visit', vk)).data.counted, true);
  await a('POST', '/api/register', { email: 'a@test.ru', password: 'secret123', name: 'Пришёл из VK' });
  await a('POST', `/api/games/${gameId}/play`);

  const b = browser();
  await b('POST', '/api/visit', vk);
  clock += DAY;
  await b('POST', `/api/games/${gameId}/play`);

  await browser()('POST', '/api/visit', vk); // просто посмотрел
  assert.equal((await browser()('POST', '/api/visit', { source: '' })).data.counted, false);

  const row = (await report()).rows.find((r) => r.source === 'vk_ads');
  assert.equal(row.campaign, '12804956');
  assert.equal(row.visitors, 3);
  assert.equal(row.played, 2);
  assert.equal(row.came_back, 1);
  assert.equal(row.regs, 1);
  assert.equal(row.reg_played, 1);
});

test('заходы владельца не считаются, даже сделанные до входа', async () => {
  const before = (await report()).rows.find((r) => r.source === 'vk_ads').visitors;
  assert.equal((await owner('POST', '/api/visit', vk)).data.counted, false);

  const phone = browser();
  assert.equal((await phone('POST', '/api/visit', vk)).data.counted, true);
  assert.equal((await report()).rows.find((r) => r.source === 'vk_ads').visitors, before + 1);
  await phone('POST', '/api/login', { email: 'owner@test.ru', password: 'secret123' });
  await phone('GET', '/api/me');
  assert.equal((await report()).rows.find((r) => r.source === 'vk_ads').visitors, before);
});

test('отчёт видит только владелец', async () => {
  assert.equal((await dev('GET', '/api/admin/sources')).status, 403);
  assert.equal((await browser()('GET', '/api/admin/sources')).status, 401);
  const d = await report();
  assert.equal(d.daily.length, 30);
  assert.ok(d.daily.reduce((n, x) => n + x.n, 0) >= 3);
});
