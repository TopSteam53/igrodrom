/*!
 * Игродром SDK v1 — сохранения, реклама и события для HTML5-игр.
 *
 *   <script src="/sdk/v1.js"></script>
 *   const sdk = await Igrodrom.init();
 *   const save = (await sdk.data.get()) || { level: 1 };
 *   sdk.game.ready();                                  // игра загрузилась
 *   await sdk.data.set({ level: 2, coins: 150 });
 *   const { rewarded } = await sdk.ads.rewarded();     // награда за рекламу
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
  var MAX_SAVE_BYTES = 200 * 1024; // как у Яндекс Игр: перенесённые игры влезают без изменений
  var HANDSHAKE_MS = 1500;   // столько ждём ответа площадки, потом считаем, что её нет
  var REQUEST_MS = 10000;
  var AD_MS = 5 * 60 * 1000; // реклама может идти долго
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
    if (sizeOf(json) > MAX_SAVE_BYTES) throw new RangeError('Igrodrom SDK: сохранение больше 200 КБ');
    return json;
  }

  // ---------- связь с площадкой ----------
  var seq = 0;
  var pending = {};

  // События от площадки (без id): 'pause' — началась реклама, 'resume' — можно продолжать.
  var listeners = {};
  function on(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
    return function () { listeners[name] = (listeners[name] || []).filter(function (f) { return f !== fn; }); };
  }

  function onMessage(e) {
    if (e.source !== global.parent) return;
    var m = e.data;
    if (m && m.protocol === PROTOCOL && typeof m.event === 'string' && m.id === undefined) {
      (listeners[m.event] || []).slice().forEach(function (fn) { try { fn(); } catch (err) { setTimeout(function () { throw err; }); } });
      return;
    }
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

  // Площадка сама решает, показывать ли рекламу. Без рекламной сети полноэкранная не показывается,
  // а награду игрок получает сразу — игра не должна ломаться от того, что реклама не пришла.
  function hostedAds() {
    return {
      fullscreen: function () {
        return request('adv.fullscreen', null, AD_MS).then(function (r) { return { shown: !!(r && r.shown) }; },
          function () { return { shown: false }; });
      },
      rewarded: function () {
        return request('adv.rewarded', null, AD_MS).then(function (r) { return { rewarded: !!(r && r.rewarded) }; },
          function () { return { rewarded: false }; });
      },
    };
  }

  // События игры: площадка по ним прячет заставку и считает время. Ошибки игре не нужны.
  function hostedGame() {
    function notify(type) { return request(type).then(function () {}, function () {}); }
    return {
      ready: function () { return notify('game.ready'); },
      start: function () { return notify('game.start'); },
      stop: function () { return notify('game.stop'); },
    };
  }

  function playerOf(p) {
    p = p || {};
    return { anonymous: !p.authorized, name: p.name || '', id: p.id || null };
  }

  function hosted(info) {
    var write = throttledWriter(function (json) { return request('data.set', json); });
    return {
      version: VERSION,
      environment: { host: 'igrodrom', storage: info.storage, gameId: info.gameId, lang: info.lang || 'ru' },
      player: playerOf(info.player),
      data: {
        get: function () { return request('data.get').then(function (json) { return json == null ? null : JSON.parse(json); }); },
        set: function (value) {
          var json;
          try { json = serialize(value); } catch (e) { return Promise.reject(e); }
          return write(json).then(function () {});
        },
        clear: function () { return request('data.clear').then(function () {}); },
      },
      ads: hostedAds(),
      game: hostedGame(),
      // sdk.on('pause' | 'resume', fn): площадка показывает рекламу — выключите звук и остановите игру.
      on: on,
    };
  }

  // ---------- без площадки ----------
  function noop() { return Promise.resolve(); }

  function standalone(key) {
    var storageKey = 'igrodrom-sdk:' + key;
    var memory = null;
    var storage = 'memory';
    try { global.localStorage.setItem(storageKey + ':probe', '1'); global.localStorage.removeItem(storageKey + ':probe'); storage = 'browser'; } catch (e) {}
    return {
      version: VERSION,
      environment: { host: 'standalone', storage: storage, gameId: null, lang: 'ru' },
      player: playerOf(null),
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
      ads: {
        fullscreen: function () { return Promise.resolve({ shown: false }); },
        rewarded: function () { return Promise.resolve({ rewarded: true }); },
      },
      game: { ready: noop, start: noop, stop: noop },
      on: function () { return function () {}; },
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
