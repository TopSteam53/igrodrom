import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SDK = fs.readFileSync(path.join(root, 'sdk', 'v1.js'), 'utf8');
const HOST = fs.readFileSync(path.join(root, 'sdk-host.js'), 'utf8');

// Мини-окно браузера: события message, postMessage с указанием отправителя, localStorage.
function fakeWindow({ storage = true } = {}) {
  const listeners = new Set();
  const data = new Map();
  const win = {
    setTimeout, clearTimeout, TextEncoder, JSON, Promise, Date, console,
    location: { pathname: '/games/test/index.html' },
    addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'message') listeners.delete(fn); },
    dispatch: (event) => { for (const fn of [...listeners]) fn(event); },
    localStorage: storage ? {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => { data.set(k, String(v)); },
      removeItem: (k) => { data.delete(k); },
    } : {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('SecurityError'); },
      removeItem() { throw new Error('SecurityError'); },
    },
    storageData: data,
  };
  win.window = win;
  return win;
}

// Связываем окно игры (child) со страницей площадки (parent).
function linked({ host = true } = {}) {
  const parent = fakeWindow();
  const child = fakeWindow({ storage: false }); // в песочнице хранилище недоступно
  child.parent = parent;
  parent.parent = parent;
  parent.sent = [];
  parent.postMessage = (msg) => {
    parent.sent.push(msg);
    setTimeout(() => parent.dispatch({ source: child, data: structuredClone(msg) }), 0);
  };
  child.postMessage = (msg) => setTimeout(() => child.dispatch({ source: parent, data: structuredClone(msg) }), 0);
  vm.runInNewContext(SDK, child);
  if (host) {
    vm.runInNewContext(HOST, parent);
    parent.IgrodromHost.attach({ contentWindow: child }, { gameId: 'demo-game', live: false });
  }
  return { parent, child };
}

test('на площадке: init, сохранение и чтение', async () => {
  const { parent, child } = linked();
  const sdk = await child.Igrodrom.init();
  assert.equal(sdk.environment.host, 'igrodrom');
  assert.equal(sdk.environment.gameId, 'demo-game');
  assert.equal(await sdk.data.get(), null);
  await sdk.data.set({ level: 3, coins: 150, items: ['меч'] });
  assert.deepEqual(await sdk.data.get(), { level: 3, coins: 150, items: ['меч'] });
  // Хранится на стороне страницы, под id игры со страницы.
  assert.equal(parent.storageData.get('igrodrom:save:demo-game'), '{"level":3,"coins":150,"items":["меч"]}');
  await sdk.data.clear();
  assert.equal(await sdk.data.get(), null);
  assert.strictEqual(await child.Igrodrom.init(), sdk, 'повторный init — тот же объект');
});

test('частые сохранения склеиваются, побеждает последнее', async () => {
  const { parent, child } = linked();
  const sdk = await child.Igrodrom.init();
  const writes = [];
  for (let i = 1; i <= 20; i++) writes.push(sdk.data.set({ clicks: i }));
  await Promise.all(writes);
  const sets = parent.sent.filter((m) => m.type === 'data.set');
  assert.ok(sets.length <= 2, `ожидали не больше 2 записей, было ${sets.length}`);
  assert.deepEqual(await sdk.data.get(), { clicks: 20 });
});

test('слишком большое или не-JSON сохранение отклоняется сразу', async () => {
  const { parent, child } = linked();
  const sdk = await child.Igrodrom.init();
  await assert.rejects(sdk.data.set({ blob: 'x'.repeat(70 * 1024) }), /64 КБ/);
  await assert.rejects(sdk.data.set(undefined), /JSON/);
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(sdk.data.set(cyclic), /JSON/);
  assert.equal(parent.sent.filter((m) => m.type === 'data.set').length, 0, 'до площадки не дошло');
});

test('площадка игнорирует сообщения не от своего iframe', async () => {
  const { parent } = linked();
  const stranger = fakeWindow();
  const replies = [];
  stranger.postMessage = (msg) => replies.push(msg);
  parent.dispatch({ source: stranger, data: { protocol: 'igrodrom-sdk', id: 1, type: 'data.get' } });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(replies, []);
});

test('без площадки: игра продолжает работать (память)', async () => {
  const { child } = linked({ host: false });
  const started = Date.now();
  const sdk = await child.Igrodrom.init();
  assert.ok(Date.now() - started >= 1400, 'ждали ответа площадки ~1.5 с');
  assert.equal(sdk.environment.host, 'standalone');
  assert.equal(sdk.environment.storage, 'memory', 'localStorage в песочнице недоступен');
  await sdk.data.set({ best: 42 });
  assert.deepEqual(await sdk.data.get(), { best: 42 });
});

test('открыта напрямую, не в iframe: сохраняет в localStorage', async () => {
  const win = fakeWindow();
  win.parent = win;
  vm.runInNewContext(SDK, win);
  const sdk = await win.Igrodrom.init({ key: 'my-game' });
  assert.equal(sdk.environment.storage, 'browser');
  await sdk.data.set({ best: 7 });
  assert.equal(win.storageData.get('igrodrom-sdk:my-game'), '{"best":7}');
  assert.deepEqual(await sdk.data.get(), { best: 7 });
});
