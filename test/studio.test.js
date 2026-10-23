// Страница студии (/developer/<id>, кнопка «Связаться»), приглашения авторов, подборка на главной.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { contactLink } from '../server/gamedev.js';

let server, base, dataDir, publicDir, dev, owner, devId, gameId;

function browser() {
  const jar = {};
  return async (method, url, body, type = 'application/json') => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method, redirect: 'manual',
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
    return { status: res.status, data, location: res.headers.get('location'), jar };
  };
}
const html = (text) => `<!doctype html><html><body><canvas></canvas><p>${text}</p></body></html>`;

async function developer(email, studio, ref) {
  const b = browser();
  await b('POST', '/api/register', { email, password: 'secret123', name: studio });
  if (ref) await b('GET', `/developers?ref=${ref}`);
  await b('POST', '/api/developer/application', { studio, about: 'Делаю небольшие игры для браузера.', contact: '@private_contact' });
  return { b, id: (await b('GET', '/api/me')).data.user.id };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-studio-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-studiopub-'));
  fs.copyFileSync(new URL('../public/developer.html', import.meta.url), path.join(publicDir, 'developer.html'));
  fs.writeFileSync(path.join(publicDir, 'developers.html'), '<!doctype html><html><head><title>Разработчикам</title></head><body></body></html>');
  fs.writeFileSync(path.join(publicDir, '404.html'), '<!doctype html><html><head><title>Нет</title></head><body></body></html>');
  server = createApp({ dataDir, publicDir, adminEmails: ['owner@test.ru'], siteUrl: 'https://igry.test' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  owner = browser();
  await owner('POST', '/api/register', { email: 'owner@test.ru', password: 'secret123', name: 'Владелец' });
  ({ b: dev, id: devId } = await developer('dev@test.ru', 'Студия Ёж'));
  await owner('POST', `/api/admin/developers/${devId}`, { action: 'approve' });
  gameId = (await dev('POST', `/api/games?${new URLSearchParams({ title: 'Ёжик', genre: 'Головоломки' })}`, html('v1'), 'text/html')).data.game.id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

test('контакт для «Связаться»: Telegram, почта, ссылка https', () => {
  assert.deepEqual(contactLink('@ezh_games'), { href: 'https://t.me/ezh_games', label: '@ezh_games' });
  assert.deepEqual(contactLink('t.me/ezh_games'), { href: 'https://t.me/ezh_games', label: '@ezh_games' });
  assert.equal(contactLink('hi@ezh.ru').href, 'mailto:hi@ezh.ru');
  assert.equal(contactLink('https://vk.com/ezh').href, 'https://vk.com/ezh');
  for (const bad of ['javascript:alert(1)', 'http://ezh.ru', '@ab', 'просто текст']) assert.equal(contactLink(bad), null, bad);
});

test('настройки студии: сайт и контакт сохраняются и возвращаются в кабинет', async () => {
  assert.equal((await dev('PATCH', '/api/developer/profile', { public_contact: 'javascript:alert(1)' })).status, 400);
  const ok = await dev('PATCH', '/api/developer/profile', { website: 'https://ezh.ru', public_contact: '@ezh_games' });
  assert.equal(ok.status, 200);
  const { application: a } = (await dev('GET', '/api/developer/application')).data;
  assert.equal(a.website, 'https://ezh.ru', 'сайт не теряется при следующем сохранении');
  assert.equal(a.public_contact, '@ezh_games');
});

test('страница студии открыта без входа, со своим адресом и текстом в HTML', async () => {
  const anon = browser();
  assert.equal((await anon('GET', `/developer/${devId}`)).status, 404, 'без опубликованных игр страницы нет');
  await owner('POST', `/api/admin/games/${gameId}`, { action: 'approve' });

  const api = await anon('GET', `/api/developers/${devId}`);
  assert.equal(api.status, 200);
  assert.deepEqual(api.data.developer.public_contact, { href: 'https://t.me/ezh_games', label: '@ezh_games' });
  assert.ok(!JSON.stringify(api.data).includes('private_contact'), 'контакт из заявки не публикуется');

  const page = await anon('GET', `/developer/${devId}`);
  assert.equal(page.status, 200);
  assert.match(page.data, /<h1 id="studio" class="profile-name">Студия Ёж<\/h1>/);
  assert.match(page.data, /<title>Студия Ёж — игры на Gamely<\/title>/);
  assert.ok(page.data.includes(`<link rel="canonical" href="https://igry.test/developer/${devId}">`));
  assert.ok(page.data.includes('<base href="/">'));
  assert.ok(page.data.includes('/game/ezhik'), 'карточка игры прямо в HTML');

  const old = await anon('GET', `/developer.html?id=${devId}`);
  assert.equal(old.status, 301);
  assert.equal(old.location, `/developer/${devId}`);
  assert.ok((await anon('GET', '/sitemap.xml')).data.includes(`<loc>https://igry.test/developer/${devId}</loc>`));
});

test('приглашение автора: заявка по ссылке засчитывается пригласившему', async () => {
  const { link, invited } = (await dev('GET', '/api/developer/referrals')).data;
  assert.equal(invited, 0);
  const code = new URL(link).searchParams.get('ref');
  assert.match(link, /^https:\/\/igry\.test\/developers\?ref=/);

  const visit = await browser()('GET', `/developers?ref=${code}`);
  assert.equal(visit.jar.devref, code, 'ссылка ставит cookie');
  assert.equal((await browser()('GET', '/developers?ref=1deadbeef')).jar.devref, undefined, 'поддельный код не принимается');

  const friend = await developer('friend@test.ru', 'Студия Лис', code);
  await developer('stranger@test.ru', 'Студия Волк');
  let r = (await dev('GET', '/api/developer/referrals')).data;
  assert.deepEqual([r.invited, r.approved], [1, 0]);
  await owner('POST', `/api/admin/developers/${friend.id}`, { action: 'approve' });
  r = (await dev('GET', '/api/developer/referrals')).data;
  assert.deepEqual([r.invited, r.approved], [1, 1]);
  const apps = (await owner('GET', '/api/admin/developers?status=approved')).data.applications;
  assert.equal(apps.find((a) => a.user_id === friend.id).referrer, 'Студия Ёж');
  assert.equal((await browser()('GET', '/api/developer/referrals')).status, 401);
});

test('подборка на главной: ставит и убирает только владелец', async () => {
  const mod = await developer('mod@test.ru', 'Модератор');
  await owner('POST', '/api/admin/team', { email: 'mod@test.ru' });
  assert.equal((await mod.b('POST', `/api/admin/games/${gameId}`, { action: 'feature' })).status, 403);
  assert.equal((await owner('POST', `/api/admin/games/${gameId}`, { action: 'feature' })).status, 200);
  const featured = async () => (await owner('GET', '/api/admin/games?status=approved')).data.games.find((g) => g.id === gameId).featured;
  assert.ok(await featured() > 0);
  assert.equal((await owner('POST', `/api/admin/games/${gameId}`, { action: 'unfeature' })).status, 200);
  assert.equal(await featured(), 0);
});
