// Витрина: покупка рамок, цветов имени, значков и платных аватарок за монетки, надеть и снять, показ в отзывах и рекордах.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { fileURLToPath } from 'node:url';
import { ITEMS, tierOf } from '../server/shop.js';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));

let server, base, dataDir, publicDir, gameId, owner;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-shop-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-shoppub-'));
  fs.mkdirSync(path.join(publicDir, 'games', 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'games', 'alpha', 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(publicDir, 'games', 'alpha', 'meta.json'), JSON.stringify({ title: 'Альфа', category: 'Аркады' }));
  server = createApp({ dataDir, publicDir, adminEmails: ['owner@test.ru'], seedDemoGames: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  gameId = (await (await fetch(`${base}/api/games`)).json()).games[0].id;
  owner = await player('owner@test.ru', 'Владелец');
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

function browser() {
  const jar = {};
  return async (method, url, json) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method,
      headers: { ...(cookie && { cookie }), ...(json !== undefined && { 'content-type': 'application/json' }) },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      jar[kv.slice(0, kv.indexOf('='))] = kv.slice(kv.indexOf('=') + 1);
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
async function player(email, name = 'Игрок') {
  const b = browser();
  const r = await b('POST', '/api/register', { email, password: 'secret123', name });
  assert.equal(r.status, 201, r.data?.error);
  b.id = r.data.user.id;
  return b;
}
const me = async (b) => (await b('GET', '/api/me')).data.user;
const grant = async (b, amount) => assert.equal((await owner('POST', `/api/admin/users/${b.id}/coins`, { amount, reason: 'Для теста витрины' })).status, 200);
const shopSpent = async (b) => (await b('GET', '/api/me/coins')).data.history.filter((h) => h.kind === 'shop').map((h) => h.delta);

test('каталог: рамки, цвета, значки, платные звери; цены целые и положительные', async () => {
  const p = await player('look@test.ru');
  const r = await p('GET', '/api/shop');
  assert.equal(r.status, 200);
  assert.equal(r.data.coins, 50, 'подарок новичку');
  const slots = (s) => r.data.items.filter((i) => i.slot === s).length;
  assert.equal(slots('frame'), 16);
  assert.equal(slots('color'), 10);
  assert.equal(slots('icon'), 9);
  assert.equal(slots('avatar'), 17);
  const sold = r.data.items.filter((i) => !i.invite);
  assert.ok(r.data.items.every((i) => !i.owned && !i.equipped));
  assert.ok(sold.every((i) => Number.isInteger(i.price) && i.price > 0 && i.tier === tierOf(i.price)), 'цена и редкость по цене');
  assert.deepEqual(r.data.items.filter((i) => i.invite).map((i) => [i.id, i.invite, i.tier]),
    [['frame:soul', 3, 'exclusive'], ['icon:leader', 5, 'exclusive'], ['avatar:33', 10, 'exclusive']], 'за друзей');
  assert.equal(sold.filter((i) => i.anim).length, 28, 'анимированные новинки');
  for (const i of ITEMS.filter((x) => x.slot === 'avatar')) assert.ok(fs.existsSync(path.join(PUBLIC, i.image)), i.image);
  assert.equal((await browser()('GET', '/api/shop')).status, 401, 'без входа витрины нет');
});

test('покупка: хватает и не хватает монеток, повтор — 409, списание одно', async () => {
  const p = await player('buyer@test.ru', 'Покупатель');
  await grant(p, 200); // 50 + 200

  assert.equal((await p('POST', '/api/shop/buy', { item: 'frame:nope' })).status, 400);
  assert.equal((await p('POST', '/api/shop/buy', {})).status, 400);
  const poor = await p('POST', '/api/shop/buy', { item: 'frame:gold' }); // 300
  assert.equal(poor.status, 402);
  assert.equal((await me(p)).coins, 250, 'без покупки монетки на месте');

  const ok = await p('POST', '/api/shop/buy', { item: 'frame:laurel' }); // 200
  assert.equal(ok.status, 200, ok.data?.error);
  assert.equal(ok.data.coins, 50);
  assert.equal(ok.data.items.find((i) => i.id === 'frame:laurel').owned, true);
  assert.equal(ok.data.equipped.frame, null, 'купленное само не надевается');

  const again = await p('POST', '/api/shop/buy', { item: 'frame:laurel' });
  assert.equal(again.status, 409);
  assert.equal((await me(p)).coins, 50);

  // Два одинаковых запроса разом: купится один раз.
  const both = await Promise.all([p('POST', '/api/shop/buy', { item: 'color:blue' }), p('POST', '/api/shop/buy', { item: 'color:blue' })]);
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 409]);
  assert.equal((await me(p)).coins, 0);
  assert.deepEqual(await shopSpent(p), [-50, -200], 'в истории ровно две траты');
  const hist = (await p('GET', '/api/me/coins')).data.history.find((h) => h.kind === 'shop');
  assert.match(hist.title, /Синий/);
});

test('надеть и снять; чужое и несуществующее — отказ; вид виден в /api/me, отзывах и рекордах', async () => {
  const p = await player('wear@test.ru', 'Модник');
  await grant(p, 500);
  for (const item of ['frame:stars', 'color:purple']) assert.equal((await p('POST', '/api/shop/buy', { item })).status, 200);

  assert.equal((await p('POST', '/api/shop/equip', { slot: 'frame', item: 'frame:gold' })).status, 403, 'не куплено');
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'color', item: 'frame:stars' })).status, 400, 'не тот слот');
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'hat', item: null })).status, 400);
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'frame', item: 'frame:nope' })).status, 400);

  const eq = await p('POST', '/api/shop/equip', { slot: 'frame', item: 'frame:stars' });
  assert.equal(eq.status, 200);
  assert.equal(eq.data.equipped.frame, 'frame:stars');
  await p('POST', '/api/shop/equip', { slot: 'color', item: 'color:purple' });
  let u = await me(p);
  assert.equal(u.frame, 'stars');
  assert.equal(u.nameColor, 'purple');

  // Отзыв и рекорд — с рамкой и цветом имени.
  assert.equal((await p('PUT', `/api/games/${gameId}/reviews`, { text: 'Отличная игра' })).status, 200);
  assert.equal((await p('POST', `/api/games/${gameId}/leaderboard`, { score: 42 })).status, 200);
  const guest = browser();
  let review = (await guest('GET', `/api/games/${gameId}/reviews`)).data.reviews.find((r) => r.name === 'Модник');
  assert.equal(review.frame, 'stars');
  assert.equal(review.nameColor, 'purple');
  const lb = (await guest('GET', `/api/games/${gameId}/leaderboard`)).data;
  const entry = lb.entries.find((e) => e.name === 'Модник');
  assert.equal(entry.frame, 'stars');
  assert.equal(entry.nameColor, 'purple');
  const mine = (await p('GET', `/api/games/${gameId}/leaderboard?around=2`)).data;
  assert.equal(mine.me.frame, 'stars');
  assert.equal(mine.around[0].nameColor, 'purple');

  // Снять рамку: пропадает везде.
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'frame', item: null })).status, 200);
  u = await me(p);
  assert.equal(u.frame, null);
  assert.equal(u.nameColor, 'purple', 'цвет остался');
  review = (await guest('GET', `/api/games/${gameId}/reviews`)).data.reviews.find((r) => r.name === 'Модник');
  assert.equal(review.frame, null);
  assert.equal((await p('GET', '/api/shop')).data.items.find((i) => i.id === 'frame:stars').owned, true, 'снятое остаётся купленным');
});

test('платная аватарка: только после покупки, обычный выбор аватарки её не открывает', async () => {
  const p = await player('ava@test.ru');
  await grant(p, 100);
  assert.equal((await p('PUT', '/api/me/avatar', { preset: 17 })).status, 400, 'мимо витрины не поставить');
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'avatar', item: 'avatar:17' })).status, 403);
  assert.equal((await p('POST', '/api/shop/buy', { item: 'avatar:17' })).status, 200);
  const eq = await p('POST', '/api/shop/equip', { slot: 'avatar', item: 'avatar:17' });
  assert.equal(eq.status, 200);
  assert.equal(eq.data.equipped.avatar, 'avatar:17');
  assert.equal((await me(p)).avatar, '/avatars/17.svg');
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'avatar', item: null })).status, 400);
  // Бесплатная аватарка сменяет платную, купленная остаётся.
  await p('PUT', '/api/me/avatar', { preset: 3 });
  const s = (await p('GET', '/api/shop')).data;
  assert.equal(s.equipped.avatar, null);
  assert.equal(s.items.find((i) => i.id === 'avatar:17').owned, true);
});

test('достижение рядом с именем: только полученное', async () => {
  const p = await player('badge@test.ru', 'Значок');
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'badge', item: 'champion' })).status, 403);
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'badge', item: 'нет-такого' })).status, 400);
  await p('POST', `/api/games/${gameId}/leaderboard`, { score: 1 });
  await p('GET', '/api/me/rewards'); // достижения выдаются при проверке
  const s = (await p('GET', '/api/shop')).data;
  assert.ok(s.badges.some((b) => b.key === 'record'));
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'badge', item: 'record' })).status, 200);
  await p('PUT', `/api/games/${gameId}/reviews`, { text: 'Хорошо' });
  const review = (await browser()('GET', `/api/games/${gameId}/reviews`)).data.reviews.find((r) => r.name === 'Значок');
  assert.equal(review.badge, 'Первый рекорд');
  assert.equal((await me(p)).badge, 'Первый рекорд');
  await p('POST', '/api/shop/equip', { slot: 'badge', item: null });
  assert.equal((await me(p)).badge, null);
});

test('каждый предмет витрины нарисован на сайте: рамка, значок, цвет имени, аватарка', () => {
  const app = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
  for (const i of ITEMS) {
    // FRAME_ART, FRAME_FX и ICON_ART в app.js — объекты, ключ с отступом в 6 пробелов
    if (i.slot === 'frame' || i.slot === 'icon') assert.match(app, new RegExp(`\\n {6}${i.key}: `), i.id);
    if (i.slot === 'color') assert.match(css, new RegExp(`\\.nc-${i.key}[{,]`), i.id);
    if (i.anim && i.slot === 'avatar') assert.match(fs.readFileSync(path.join(PUBLIC, i.image), 'utf8'), /@keyframes/, i.image);
  }
});

test('значок перед именем: купить, надеть, виден в /api/me, отзывах и рекордах, снять', async () => {
  const p = await player('icon@test.ru', 'Значкист');
  await grant(p, 1500);
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'icon', item: 'icon:crown' })).status, 403, 'не куплено');
  assert.equal((await p('POST', '/api/shop/buy', { item: 'icon:crown' })).status, 200);
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'icon', item: 'frame:crown' })).status, 400, 'не тот слот');
  const eq = await p('POST', '/api/shop/equip', { slot: 'icon', item: 'icon:crown' });
  assert.equal(eq.status, 200);
  assert.equal(eq.data.equipped.icon, 'icon:crown');
  assert.equal((await me(p)).icon, 'crown');
  await p('PUT', `/api/games/${gameId}/reviews`, { text: 'С короной' });
  await p('POST', `/api/games/${gameId}/leaderboard`, { score: 7 });
  const guest = browser();
  assert.equal((await guest('GET', `/api/games/${gameId}/reviews`)).data.reviews.find((r) => r.name === 'Значкист').icon, 'crown');
  assert.equal((await guest('GET', `/api/games/${gameId}/leaderboard`)).data.entries.find((e) => e.name === 'Значкист').icon, 'crown');
  assert.deepEqual(await shopSpent(p), [-1200]);
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'icon', item: null })).status, 200);
  assert.equal((await me(p)).icon, null);
});

test('анимированная аватарка из витрины ставится как обычная платная', async () => {
  const p = await player('anim@test.ru');
  await grant(p, 1500);
  assert.equal((await p('POST', '/api/shop/buy', { item: 'avatar:32' })).status, 200);
  assert.equal((await p('POST', '/api/shop/equip', { slot: 'avatar', item: 'avatar:32' })).status, 200);
  assert.equal((await me(p)).avatar, '/avatars/32.svg');
});
