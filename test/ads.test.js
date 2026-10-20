import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { adsFromEnv, siteFromEnv } from '../server/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const servers = [];
after(async () => { for (const { server, dir } of servers) { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); } });

async function start(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-ads-'));
  const server = createApp({ dataDir: dir, publicDir: root, seedDemoGames: true, ads: adsFromEnv(env), site: siteFromEnv(env) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push({ server, dir });
  return { base: `http://127.0.0.1:${server.address().port}`, dir };
}
const UA = { 'user-agent': 'Mozilla/5.0 Chrome/130' };
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...UA, ...headers }, body: JSON.stringify(body) });

test('настройки рекламы из .env: значения по умолчанию и проверка', () => {
  const none = adsFromEnv({});
  assert.equal(none.provider, 'none');
  assert.equal(none.banner, 'none');
  assert.equal(none.fullscreenInterval, 60);
  assert.equal(none.firstDelay, 30);
  assert.equal(adsFromEnv({ ADS_PROVIDER: 'casino' }).provider, 'none', 'неизвестная сеть — без рекламы');
  const y = adsFromEnv({ ADS_PROVIDER: 'yandex', ADS_BANNER: 'vk', ADS_FULLSCREEN_INTERVAL: '90', ADS_FIRST_DELAY: '0',
    ADS_YANDEX_REWARDED_TOUCH: ' R-A-1-2 ', ADS_TXT: 'a.com, 1, DIRECT\\nb.com, 2, RESELLER' });
  assert.equal(y.banner, 'vk');
  assert.equal(y.fullscreenInterval, 90);
  assert.equal(y.firstDelay, 0);
  assert.equal(y.yandex.rewardedTouch, 'R-A-1-2');
  assert.equal(y.adsTxt, 'a.com, 1, DIRECT\nb.com, 2, RESELLER');
  assert.equal(siteFromEnv({ METRIKA_ID: '12345678', SITE_TELEGRAM: '@igrodrom' }).telegram, 'igrodrom');
  assert.equal(siteFromEnv({ METRIKA_ID: '<script>' }).metrika, '', 'в номер счётчика ничего лишнего');
});

test('/api/config и /ads.txt', async () => {
  const { base, dir } = await start({ ADS_PROVIDER: 'test', ADS_TXT: 'yandex.ru, 123, DIRECT', SITE_EMAIL: 'hi@igrodrom.ru' });
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.equal(cfg.ads.provider, 'test');
  assert.equal(cfg.ads.adsTxt, undefined, 'ads.txt странице не нужен');
  assert.equal(cfg.site.email, 'hi@igrodrom.ru');

  let r = await fetch(`${base}/ads.txt`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'yandex.ru, 123, DIRECT\n');
  fs.writeFileSync(path.join(dir, 'ads.txt'), 'vk.com, 9, DIRECT\n');
  assert.equal(await (await fetch(`${base}/ads.txt`)).text(), 'vk.com, 9, DIRECT\n', 'файл в DATA_DIR важнее');

  const bare = await start({});
  assert.equal((await fetch(`${bare.base}/ads.txt`)).status, 404);
  assert.equal((await (await fetch(`${bare.base}/api/config`)).json()).ads.provider, 'none');
});

test('показы рекламы попадают в статистику автора, только когда сеть включена', async () => {
  const off = await start({});
  const offGame = (await (await fetch(`${off.base}/api/games`)).json()).games[0];
  assert.equal((await (await post(`${off.base}/api/games/${offGame.id}/ad`, { kind: 'fullscreen' })).json()).counted, false);

  const { base, dir } = await start({ ADS_PROVIDER: 'test', ADMIN_EMAILS: '' });
  const games = (await (await fetch(`${base}/api/games`)).json()).games;
  const g = games[0];
  for (const kind of ['fullscreen', 'fullscreen', 'rewarded', 'banner']) {
    assert.equal((await (await post(`${base}/api/games/${g.id}/ad`, { kind })).json()).counted, true);
  }
  assert.equal((await (await post(`${base}/api/games/${g.id}/ad`, { kind: 'popup' })).json()).counted, false, 'неизвестный формат');
  assert.equal((await (await post(`${base}/api/games/${g.id}/ad`, { kind: 'fullscreen' }, { 'user-agent': 'Googlebot' })).json()).counted, false, 'боты');
  assert.equal((await post(`${base}/api/games/0000000000000000/ad`, { kind: 'fullscreen' })).status, 404);

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'igrodrom.db'));
  const row = db.prepare('SELECT fullscreen, rewarded, banner FROM ad_daily WHERE game_id = ?').get(g.id);
  db.close();
  assert.deepEqual({ ...row }, { fullscreen: 2, rewarded: 1, banner: 1 });
});

// ---------- площадка и игра: пауза на время рекламы ----------
function fakeWindow() {
  const listeners = new Set();
  const win = {
    setTimeout, clearTimeout, TextEncoder, URLSearchParams, JSON, Promise, Date, console, crypto,
    location: { pathname: '/play/x/index.html', search: '' },
    navigator: { userAgent: 'Mozilla/5.0 Chrome/130' },
    addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'message') listeners.delete(fn); },
    dispatch: (event) => { for (const fn of [...listeners]) fn(event); },
  };
  Object.defineProperty(win, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  win.window = win;
  win.globalThis = win;
  return win;
}
function hosted(ads, onAd) {
  const parent = fakeWindow();
  const child = fakeWindow();
  parent.parent = parent;
  child.parent = parent;
  parent.postMessage = (msg) => setTimeout(() => parent.dispatch({ source: child, data: structuredClone(msg) }), 0);
  child.postMessage = (msg) => setTimeout(() => child.dispatch({ source: parent, data: structuredClone(msg) }), 0);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sdk-host.js'), 'utf8'), parent);
  parent.IgrodromHost.attach({ contentWindow: child }, { gameId: 'g', live: false, ads, onAd });
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sdk.js'), 'utf8'), child);
  return child;
}

test('реклама показана: игра встаёт на паузу, узнаёт результат, потом продолжает; показ засчитан', async () => {
  const counted = [];
  const ads = {
    fullscreen: async (hooks) => { hooks.open(); await new Promise((r) => setTimeout(r, 10)); return { shown: true }; },
    rewarded: async (hooks) => { hooks.open(); return { rewarded: true, shown: true }; },
  };
  const child = hosted(ads, (kind) => counted.push(kind));
  const sdk = await child.Igrodrom.init();
  const log = [];
  sdk.on('pause', () => log.push('pause'));
  sdk.on('resume', () => log.push('resume'));
  const r = await sdk.ads.fullscreen();
  log.push(`shown:${r.shown}`);
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(log, ['pause', 'shown:true', 'resume']);

  const ysdk = await child.YaGames.init();
  const ya = [];
  ysdk.on('game_api_pause', () => ya.push('pause'));
  ysdk.on('game_api_resume', () => ya.push('resume'));
  await new Promise((done) => ysdk.adv.showFullscreenAdv({ callbacks: {
    onOpen: () => ya.push('open'),
    onClose: (shown) => { ya.push(`close:${shown}`); setTimeout(done, 10); },
  } }));
  assert.deepEqual(ya, ['pause', 'open', 'close:true', 'resume'], 'Яндекс-игра получает onOpen, когда реклама реально открылась');
  await sdk.ads.rewarded();
  assert.deepEqual(counted, ['fullscreen', 'fullscreen', 'rewarded']);
});

test('реклама не показана (частота, нет сети): без паузы и без onOpen', async () => {
  const counted = [];
  const child = hosted({ fullscreen: async () => ({ shown: false }), rewarded: async () => ({ rewarded: false, shown: false }) },
    (kind) => counted.push(kind));
  const ysdk = await child.YaGames.init();
  const ya = [];
  ysdk.on('game_api_pause', () => ya.push('pause'));
  await new Promise((done) => ysdk.adv.showFullscreenAdv({ callbacks: {
    onOpen: () => ya.push('open'),
    onClose: (shown) => { ya.push(`close:${shown}`); setTimeout(done, 10); },
  } }));
  assert.deepEqual(ya, ['close:false']);
  ya.length = 0;
  await new Promise((done) => ysdk.adv.showRewardedVideo({ callbacks: {
    onRewarded: () => ya.push('reward'),
    onClose: () => { ya.push('close'); done(); },
  } }));
  assert.deepEqual(ya, ['close'], 'реклама не досмотрена — награды нет');
  assert.deepEqual(counted, []);
});
