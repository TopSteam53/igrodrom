// Покупка монеток через ЮKassa (подставной API) и аватарки игроков.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { packsFromEnv, yookassaFromEnv } from '../server/economy.js';
import { sniffImage } from '../server/images.js';

let server, base, dataDir, publicDir;
const payments = new Map(); // подставная ЮKassa: id → платёж
const calls = [];

// Минимальная ЮKassa: создать платёж и прочитать его. Статус меняет тест.
async function fakeKassa(url, init = {}) {
  calls.push({ url, init });
  assert.match(init.headers.Authorization, /^Basic /);
  const m = url.match(/\/payments(?:\/([\w-]+))?$/);
  if (init.method === 'POST' && m && !m[1]) {
    assert.ok(init.headers['Idempotence-Key'], 'у создания платежа есть ключ идемпотентности');
    const body = JSON.parse(init.body);
    const id = `pay-${payments.size + 1}`;
    const p = { id, status: 'pending', paid: false, amount: body.amount, metadata: body.metadata, description: body.description,
      confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.test/checkout/${id}` }, receipt: body.receipt };
    payments.set(id, p);
    return Response.json(p);
  }
  if (init.method === 'GET' && m && payments.has(m[1])) return Response.json(payments.get(m[1]));
  return Response.json({ type: 'error', code: 'not_found' }, { status: 404 });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-eco-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-ecopub-'));
  server = createApp({
    dataDir, publicDir, adminEmails: ['owner@test.ru'], siteUrl: 'https://igry.test',
    coinPacks: packsFromEnv({ COIN_PACKS: '100:99,500:399' }),
    yookassa: yookassaFromEnv({ YOOKASSA_SHOP_ID: '12345', YOOKASSA_SECRET_KEY: 'test_secret', YOOKASSA_RECEIPT: '1' }),
    fetchImpl: fakeKassa,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

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
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
async function player(email, name = 'Игрок') {
  const b = browser();
  assert.equal((await b('POST', '/api/register', { email, password: 'secret123', name })).status, 201);
  return b;
}
const webhook = (paymentId, event = 'payment.succeeded') => fetch(`${base}/api/payments/yookassa`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'notification', event, object: { id: paymentId, status: 'succeeded' } }),
});

test('пакеты: выгода считается от самого маленького', () => {
  assert.deepEqual(packsFromEnv({ COIN_PACKS: '100:99,500:399' }).map((p) => [p.id, p.coins, p.price, p.bonus]),
    [['p1', 100, 99, 0], ['p2', 500, 399, 19]]);
  assert.equal(packsFromEnv({ COIN_PACKS: 'мусор,10:0' }).length, 0);
  assert.equal(yookassaFromEnv({}).enabled, false);
});

test('покупка: заказ → оплата → монетки зачисляются один раз', async () => {
  const p = await player('buyer@test.ru', 'Покупатель');
  const shop = (await p('GET', '/api/me/coins')).data.shop;
  assert.equal(shop.enabled, true);
  assert.equal(shop.test, true, 'тестовый ключ — тестовый магазин');

  assert.equal((await p('POST', '/api/coins/orders', { pack: 'нет' })).status, 400);
  const r = await p('POST', '/api/coins/orders', { pack: 'p2' });
  assert.equal(r.status, 201);
  assert.match(r.data.confirmation_url, /^https:\/\/yoomoney\.test\/checkout\//);
  const orderId = r.data.order.id;
  const pay = [...payments.values()].at(-1);
  assert.deepEqual(pay.amount, { value: '399.00', currency: 'RUB' });
  assert.equal(pay.metadata.order_id, orderId);
  assert.equal(pay.receipt.customer.email, 'buyer@test.ru', 'чек уходит на почту покупателя');
  const create = calls.find((c) => c.init.method === 'POST');
  assert.equal(JSON.parse(create.init.body).confirmation.return_url, `https://igry.test/account.html?order=${orderId}#coins`);

  // Пока не оплачено — монеток нет.
  let s = await p('GET', `/api/coins/orders/${orderId}`);
  assert.equal(s.data.order.status, 'pending');
  assert.equal(s.data.coins, 50);

  // Уведомление без настоящей оплаты ничего не даёт: статус проверяется запросом в ЮKassa.
  await webhook(pay.id);
  assert.equal((await p('GET', '/api/me')).data.user.coins, 50);

  // Сумма не сошлась — не зачисляем.
  Object.assign(pay, { status: 'succeeded', paid: true, amount: { value: '1.00', currency: 'RUB' } });
  await webhook(pay.id);
  assert.equal((await p('GET', '/api/me')).data.user.coins, 50);

  pay.amount = { value: '399.00', currency: 'RUB' };
  assert.equal((await webhook(pay.id)).status, 200);
  await webhook(pay.id); // повтор уведомления
  s = await p('GET', `/api/coins/orders/${orderId}`); // и опрос со страницы
  assert.equal(s.data.order.status, 'paid');
  assert.equal(s.data.coins, 550, '500 монеток зачислены ровно один раз');
  const history = (await p('GET', '/api/me/coins')).data.history;
  assert.deepEqual(history.filter((h) => h.kind === 'purchase').map((h) => h.delta), [500]);

  // Чужой заказ не виден.
  const other = await player('other@test.ru');
  assert.equal((await other('GET', `/api/coins/orders/${orderId}`)).status, 404);
});

test('покупка: отменённый платёж не даёт монеток, уведомления о чужих платежах игнорируются', async () => {
  const p = await player('cancel@test.ru');
  const { order } = (await p('POST', '/api/coins/orders', { pack: 'p1' })).data;
  const pay = [...payments.values()].at(-1);
  pay.status = 'canceled';
  await webhook(pay.id, 'payment.canceled');
  const s = await p('GET', `/api/coins/orders/${order.id}`);
  assert.equal(s.data.order.status, 'canceled');
  assert.equal(s.data.coins, 50);
  assert.equal((await webhook('pay-unknown')).status, 200);
  assert.equal((await p('POST', '/api/coins/orders', {})).status, 400);
});

// Картинки 64×64 разных форматов: только заголовки, тела хватает для проверки размеров.
function png(w, h) {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w, h) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08]),
    Buffer.from([h >> 8, h & 255, w >> 8, w & 255]), Buffer.alloc(40)]);
}

test('картинки: тип по сигнатуре и размеры', () => {
  assert.deepEqual(sniffImage(png(300, 200)), { type: 'png', width: 300, height: 200 });
  assert.deepEqual(sniffImage(jpeg(640, 480)), { type: 'jpeg', width: 640, height: 480 });
  const webp = Buffer.alloc(40);
  webp.write('RIFF', 0, 'latin1'); webp.write('WEBPVP8X', 8, 'latin1'); webp.writeUIntLE(255, 24, 3); webp.writeUIntLE(127, 27, 3);
  assert.deepEqual(sniffImage(webp), { type: 'webp', width: 256, height: 128 });
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(64))), null);
});

test('аватарки: готовая сразу, своя — после проверки модератором', async () => {
  const p = await player('ava@test.ru', 'Ава');
  let me = (await p('GET', '/api/me')).data.user;
  assert.equal(me.avatar, null);

  assert.equal((await p('PUT', '/api/me/avatar', { preset: 17 })).status, 400);
  assert.equal((await p('PUT', '/api/me/avatar', { preset: 7 })).data.avatar, '/avatars/7.webp');

  assert.equal((await p('POST', '/api/me/avatar', Buffer.from('not an image'.padEnd(64)), 'image/png')).status, 400);
  assert.equal((await p('POST', '/api/me/avatar', png(20, 20), 'image/png')).status, 400, 'слишком маленькая');
  const up = await p('POST', '/api/me/avatar', png(256, 256), 'image/png');
  assert.equal(up.status, 201);
  assert.equal(up.data.avatar, '/avatars/7.webp', 'пока на проверке — прежняя');
  assert.match(up.data.avatarPending, /^\/avatars\/u\/[0-9a-f]{32}\.png$/);
  const file = await fetch(base + up.data.avatarPending);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');

  const owner = await player('owner@test.ru', 'Владелец');
  const { id } = me;
  assert.equal((await p('GET', '/api/admin/avatars')).status, 403);
  const queue = (await owner('GET', '/api/admin/avatars')).data.avatars;
  assert.deepEqual(queue.map((a) => [a.user_id, a.url]), [[id, up.data.avatarPending]]);

  // Отказ — с причиной, картинка удаляется.
  assert.equal((await owner('POST', `/api/admin/avatars/${id}`, { action: 'reject', reason: 'Чужое фото' })).status, 200);
  me = (await p('GET', '/api/me')).data.user;
  assert.deepEqual([me.avatar, me.avatarPending, me.avatarNote], ['/avatars/7.webp', null, 'Чужое фото']);
  assert.equal((await fetch(base + up.data.avatarPending)).status, 404);

  // Одобрение — своя становится аватаркой и видна в таблицах рекордов и отзывах.
  const again = await p('POST', '/api/me/avatar', png(128, 128), 'image/png');
  assert.equal((await owner('POST', `/api/admin/avatars/${id}`, { action: 'approve' })).status, 200);
  me = (await p('GET', '/api/me')).data.user;
  assert.equal(me.avatar, again.data.avatarPending);
  assert.equal(me.avatarPending, null);
  assert.equal((await owner('GET', '/api/admin/avatars')).data.avatars.length, 0);

  // Модератору проверка не нужна.
  const mine = await owner('POST', '/api/me/avatar', png(128, 128), 'image/png');
  assert.match(mine.data.avatar, /^\/avatars\/u\//);
});
