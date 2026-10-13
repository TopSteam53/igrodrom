import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildSdk } from '../scripts/build-sdk.js';
import { adaptYandexSdk } from '../server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BUNDLE = fs.readFileSync(path.join(root, 'sdk.js'), 'utf8');
const HOST = fs.readFileSync(path.join(root, 'sdk-host.js'), 'utf8');
// Объекты из другого контекста vm: сравниваем по содержимому, а не по прототипу.
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function fakeWindow({ storage = true } = {}) {
  const listeners = new Set();
  const data = new Map();
  const win = {
    setTimeout, clearTimeout, TextEncoder, URLSearchParams, JSON, Promise, Date, console, crypto,
    location: { pathname: '/play/abc/index.html', search: '' },
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' },
    addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'message') listeners.delete(fn); },
    dispatch: (event) => { for (const fn of [...listeners]) fn(event); },
    storageData: data,
  };
  const ls = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
  // В песочнице само обращение к localStorage бросает ошибку — как в браузере.
  Object.defineProperty(win, 'localStorage', {
    configurable: true,
    get() { if (!storage) throw new Error('SecurityError'); return ls; },
  });
  win.window = win;
  win.globalThis = win;
  return win;
}

// Страница площадки; каждая session() — новый запуск игры в iframe.
function platform(player) {
  const parent = fakeWindow();
  parent.parent = parent;
  parent.sent = [];
  vm.runInNewContext(HOST, parent);
  return {
    parent,
    session() {
      const child = fakeWindow({ storage: false });
      child.parent = parent;
      parent.postMessage = (msg) => {
        parent.sent.push(msg);
        setTimeout(() => parent.dispatch({ source: child, data: structuredClone(msg) }), 0);
      };
      child.postMessage = (msg) => setTimeout(() => child.dispatch({ source: parent, data: structuredClone(msg) }), 0);
      parent.IgrodromHost.attach({ contentWindow: child }, { gameId: 'ya-game', live: false, ...(player && { player }) });
      vm.runInNewContext(BUNDLE, child);
      return child;
    },
  };
}

test('public/sdk.js собран из sdk/v1.js и sdk/yandex.js (npm run build:sdk)', () => {
  assert.equal(BUNDLE, buildSdk());
});

test('YaGames: облачные сохранения переживают перезапуск', async () => {
  const p = platform();
  let child = p.session();
  let ysdk = await child.YaGames.init();
  assert.strictEqual(await child.YaGames.init(), ysdk, 'повторный init — тот же объект');
  assert.equal(ysdk.environment.i18n.lang, 'ru');
  assert.equal(ysdk.environment.app.id, 'ya-game');
  assert.equal(ysdk.deviceInfo.isDesktop(), true);

  let player = await ysdk.getPlayer({ scopes: false });
  assert.equal(player.getMode(), 'lite');
  assert.equal(player.isAuthorized(), false);
  assert.deepEqual(plain(await player.getData()), {});
  await player.setData({ level: 4, coins: 120, items: ['меч'] }, true);
  await player.setStats({ best: 10, name: 'не число' });
  assert.deepEqual(plain(await player.incrementStats({ best: 5, runs: 1 })), { best: 15, runs: 1 });
  await tick(1100); // запись склеивается раз в секунду

  child = p.session();
  ysdk = await child.YaGames.init();
  player = await ysdk.getPlayer();
  assert.deepEqual(plain(await player.getData()), { level: 4, coins: 120, items: ['меч'] });
  assert.deepEqual(plain(await player.getData(['coins', 'нет'])), { coins: 120 });
  assert.deepEqual(plain(await player.getStats()), { best: 15, runs: 1 });
});

test('localStorage в песочнице: работает и сохраняется вместе с прогрессом', async () => {
  const p = platform();
  let child = p.session();
  assert.doesNotThrow(() => child.localStorage.setItem('record', 42));
  assert.equal(child.localStorage.getItem('record'), '42');
  assert.equal(child.localStorage.length, 1);
  await child.YaGames.init();
  await tick(1100);

  child = p.session();
  // Игра при старте пишет значение по умолчанию раньше, чем пришло сохранение, — оно не должно затереть прогресс.
  if (child.localStorage.getItem('record') === null) child.localStorage.setItem('record', '0');
  const ysdk = await child.YaGames.init();
  assert.equal(child.localStorage.getItem('record'), '42');
  const safe = await ysdk.getStorage();
  assert.equal(safe.getItem('record'), '42', 'getStorage — то же хранилище');
  safe.removeItem('record');
  assert.equal(child.localStorage.getItem('record'), null);
});

test('YaGames: реклама не ломает игру, награда выдаётся', async () => {
  const child = platform().session();
  const ysdk = await child.YaGames.init();
  const events = [];
  ysdk.on('game_api_pause', () => events.push('pause'));
  ysdk.on('game_api_resume', () => events.push('resume'));

  await new Promise((done) => ysdk.adv.showFullscreenAdv({ callbacks: {
    onOpen: () => events.push('open'),
    onClose: (shown) => { events.push(`close:${shown}`); done(); },
  } }));
  assert.deepEqual(events, ['close:false'], 'без рекламной сети полноэкранная не показывается');

  events.length = 0;
  await new Promise((done) => ysdk.adv.showRewardedVideo({ callbacks: {
    onOpen: () => events.push('open'),
    onRewarded: () => events.push('reward'),
    onClose: () => { events.push('close'); setTimeout(done); },
  } }));
  assert.deepEqual(events, ['pause', 'open', 'reward', 'close', 'resume']);
});

test('YaGames: вошедший игрок, заглушки лидербордов и покупок', async () => {
  const child = platform(async () => ({ authorized: true, name: 'Миша', id: 'p1' })).session();
  const ysdk = await child.YaGames.init();
  const player = await ysdk.getPlayer();
  assert.equal(player.getMode(), '');
  assert.equal(player.getName(), 'Миша');
  assert.equal(player.getUniqueID(), 'p1');

  ysdk.features.LoadingAPI.ready();
  ysdk.features.GameplayAPI.start();
  const lb = await ysdk.getLeaderboards();
  await lb.setLeaderboardScore('main', 100);
  assert.deepEqual(plain((await lb.getLeaderboardEntries('main')).entries), []);
  await assert.rejects(lb.getLeaderboardPlayerEntry('main'), (e) => e.code === 'LEADERBOARD_PLAYER_NOT_PRESENT');
  const pay = await ysdk.getPayments({ signed: false });
  assert.equal((await pay.getPurchases()).length, 0);
  await assert.rejects(pay.purchase({ id: 'gold' }));
  assert.deepEqual(plain(await ysdk.getFlags({ defaultFlags: { hard: 'no' } })), { hard: 'no' });
  assert.equal(await ysdk.isAvailableMethod('payments.purchase'), false);
});

test('при загрузке ссылки на Яндекс SDK переводятся на /sdk.js', () => {
  const f = (p, text) => ({ path: p, data: Buffer.from(text, 'latin1') });
  const files = [
    f('index.html', '<script src="https://yandex.ru/games/sdk/v2"></script><script src="sdk.js"></script>'),
    f('Build/loader.js', 's.src="//yandex.ru/games/sdk/v2";\xff'),
    f('Build/game.data', 'https://yandex.ru/games/sdk/v2'),
  ];
  assert.equal(adaptYandexSdk(files), true);
  assert.equal(files[0].data.toString(), '<script src="/sdk.js"></script><script src="/sdk.js"></script>');
  assert.equal(files[1].data.toString('latin1'), 's.src="/sdk.js";\xff', 'байты вне UTF-8 не портятся');
  assert.equal(files[2].data.toString(), 'https://yandex.ru/games/sdk/v2', 'данные не трогаем');

  assert.equal(adaptYandexSdk([f('index.html', '<script src="/sdk.js"></script>')]), true, 'уже /sdk.js');
  const own = [f('index.html', '<script src="sdk.js"></script>'), f('sdk.js', '')];
  assert.equal(adaptYandexSdk(own), false, 'свой sdk.js в архиве — не трогаем');
  assert.equal(adaptYandexSdk([f('index.html', '<canvas></canvas>')]), false);
});
