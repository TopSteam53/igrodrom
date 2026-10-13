/*!
 * Игродром SDK v1 — сохранения для HTML5-игр.
 *
 *   <script src="/sdk/v1.js"></script>
 *   const sdk = await Igrodrom.init();
 *   const save = (await sdk.data.get()) || { level: 1 };
 *   await sdk.data.set({ level: 2, coins: 150 });
 *
 * Игра на Игродроме работает в песочнице без доступа к хранилищу браузера, поэтому SDK передаёт
 * сохранения странице площадки через postMessage, а та хранит их на сервере за игроком.
 * Вне площадки (локальная отладка, другой сайт) SDK сохраняет в localStorage, а если и он
 * недоступен — в память. Игра работает одинаково во всех случаях.
 * Документация: /developers.html#sdk
 */
(function (global) {
  'use strict';

  var PROTOCOL = 'igrodrom-sdk';
  var VERSION = 1;
  var MAX_SAVE_BYTES = 64 * 1024;
  var HANDSHAKE_MS = 1500;   // столько ждём ответа площадки, потом считаем, что её нет
  var REQUEST_MS = 10000;
  var MIN_WRITE_GAP_MS = 1000; // не чаще одной записи в секунду; лишние склеиваются

  function inFrame() {
    try { return global.parent && global.parent !== global; } catch (e) { return true; }
  }

  function sizeOf(json) {
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length;
  }

  // Проверяем до отправки: ошибка должна прийти в игру сразу, а не после сетевого запроса.
  function serialize(value) {
    var json;
    try { json = JSON.stringify(value); } catch (e) { throw new TypeError('Igrodrom SDK: сохранение должно сериализоваться в JSON'); }
    if (json === undefined) throw new TypeError('Igrodrom SDK: сохранение должно быть JSON-значением');
    if (sizeOf(json) > MAX_SAVE_BYTES) throw new RangeError('Igrodrom SDK: сохранение больше 64 КБ');
    return json;
  }

  // ---------- связь с площадкой ----------
  var seq = 0;
  var pending = {};

  function onMessage(e) {
    if (e.source !== global.parent) return;
    var m = e.data;
    if (!m || m.protocol !== PROTOCOL || !pending[m.id]) return;
    var p = pending[m.id];
    delete pending[m.id];
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error || 'Igrodrom SDK: ошибка площадки'));
  }

  function request(type, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = {
        resolve: resolve,
        reject: reject,
        timer: setTimeout(function () {
          delete pending[id];
          reject(new Error('Igrodrom SDK: площадка не ответила'));
        }, timeoutMs || REQUEST_MS),
      };
      global.parent.postMessage({ protocol: PROTOCOL, version: VERSION, id: id, type: type, payload: payload }, '*');
    });
  }

  // Последняя запись побеждает: частые set() склеиваются в одну отправку раз в секунду.
  function throttledWriter(write) {
    var latest, hasLatest = false, waiters = [], timer = null, lastAt = 0, busy = false;
    function flush() {
      timer = null;
      if (busy || !hasLatest) return;
      var value = latest, done = waiters;
      hasLatest = false; waiters = []; busy = true; lastAt = Date.now();
      write(value).then(function (r) { done.forEach(function (w) { w.resolve(r); }); },
        function (err) { done.forEach(function (w) { w.reject(err); }); })
        .then(function () { busy = false; if (hasLatest) schedule(); });
    }
    function schedule() {
      if (timer) return;
      timer = setTimeout(flush, Math.max(0, MIN_WRITE_GAP_MS - (Date.now() - lastAt)));
    }
    return function (json) {
      latest = json; hasLatest = true;
      return new Promise(function (resolve, reject) { waiters.push({ resolve: resolve, reject: reject }); schedule(); });
    };
  }

  function hosted(info) {
    var write = throttledWriter(function (json) { return request('data.set', json); });
    return {
      version: VERSION,
      environment: { host: 'igrodrom', storage: info.storage, gameId: info.gameId, lang: info.lang || 'ru' },
      player: { anonymous: true },
      data: {
        get: function () { return request('data.get').then(function (json) { return json == null ? null : JSON.parse(json); }); },
        set: function (value) {
          var json;
          try { json = serialize(value); } catch (e) { return Promise.reject(e); }
          return write(json).then(function () {});
        },
        clear: function () { return request('data.clear').then(function () {}); },
      },
    };
  }

  // ---------- без площадки ----------
  function standalone(key) {
    var storageKey = 'igrodrom-sdk:' + key;
    var memory = null;
    var storage = 'memory';
    try { global.localStorage.setItem(storageKey + ':probe', '1'); global.localStorage.removeItem(storageKey + ':probe'); storage = 'browser'; } catch (e) {}
    return {
      version: VERSION,
      environment: { host: 'standalone', storage: storage, gameId: null, lang: 'ru' },
      player: { anonymous: true },
      data: {
        get: function () {
          try {
            var v = storage === 'browser' ? global.localStorage.getItem(storageKey) : memory;
            return Promise.resolve(v == null ? null : JSON.parse(v));
          } catch (e) { return Promise.resolve(null); }
        },
        set: function (value) {
          try {
            var json = serialize(value);
            memory = json;
            if (storage === 'browser') global.localStorage.setItem(storageKey, json);
            return Promise.resolve();
          } catch (e) { return Promise.reject(e); }
        },
        clear: function () {
          memory = null;
          try { if (storage === 'browser') global.localStorage.removeItem(storageKey); } catch (e) {}
          return Promise.resolve();
        },
      },
    };
  }

  var initPromise = null;

  /**
   * Подключение к площадке. Вызывайте один раз при старте игры, повторные вызовы вернут тот же объект.
   * options.key — имя сохранения вне площадки (по умолчанию путь страницы).
   */
  function init(options) {
    if (initPromise) return initPromise;
    var key = (options && options.key) || global.location.pathname;
    initPromise = new Promise(function (resolve) {
      if (!inFrame()) return resolve(standalone(key));
      global.addEventListener('message', onMessage);
      request('init', { sdk: VERSION }, HANDSHAKE_MS).then(
        function (info) { resolve(hosted(info || {})); },
        function () { resolve(standalone(key)); }
      );
    });
    return initPromise;
  }

  global.Igrodrom = { init: init, version: VERSION, MAX_SAVE_BYTES: MAX_SAVE_BYTES };
})(typeof window !== 'undefined' ? window : globalThis);
