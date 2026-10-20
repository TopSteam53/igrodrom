// Собрано из public/sdk/v1.js и public/sdk/yandex.js командой npm run build:sdk. Не редактируйте вручную.
/*!
 * Игродром SDK v1 — сохранения, реклама и события для HTML5-игр.
 *
 *   <script src="/sdk/v1.js"></script>
 *   const sdk = await Igrodrom.init();
 *   const save = (await sdk.data.get()) || { level: 1 };
 *   sdk.game.ready();                                  // игра загрузилась
 *   await sdk.data.set({ level: 2, coins: 150 });
 *   const { rewarded } = await sdk.ads.rewarded();     // награда за рекламу
 *   await sdk.leaderboard.setScore(1200);              // таблица рекордов (только вошедшие игроки)
 *   const { ok } = await sdk.coins.spend(30, 'Щит');   // монетки площадки, игрок подтверждает трату
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

  // ---------- рекорды, монетки, отзывы ----------
  var BOARD_RE = /^[\w.-]{1,40}$/;
  function boardOf(opts) {
    var board = opts && opts.board != null ? String(opts.board) : 'main';
    if (!BOARD_RE.test(board)) throw new TypeError('Igrodrom SDK: имя таблицы — латиница, цифры, «_», «-», «.», до 40 символов');
    return board;
  }
  function checkScore(score) {
    if (typeof score !== 'number' || !isFinite(score) || Math.floor(score) !== score) {
      throw new TypeError('Igrodrom SDK: результат должен быть целым числом');
    }
  }
  function attempt(fn) { try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); } }

  function hostedLeaderboard() {
    return {
      // Сохраняет результат, если он лучше прежнего. Гостю — ошибка: в таблице только вошедшие игроки.
      setScore: function (score, opts) {
        return attempt(function () {
          checkScore(score);
          var extra = opts && opts.extra != null ? String(opts.extra) : '';
          return request('lb.set', { board: boardOf(opts), score: score, extra: extra });
        });
      },
      // { board, total, entries: [{ rank, name, score, extra, player, me }], around, me }
      getEntries: function (opts) {
        return attempt(function () {
          return request('lb.get', { board: boardOf(opts), top: (opts && opts.top) || 10, around: (opts && opts.around) || 0 });
        });
      },
      getPlayerEntry: function (opts) {
        return attempt(function () { return request('lb.get', { board: boardOf(opts), top: 0, around: 0 }); })
          .then(function (r) { return (r && r.me) || null; });
      },
    };
  }

  function hostedCoins() {
    return {
      // Баланс монеток игрока на площадке или null, если игрок не вошёл.
      balance: function () { return request('coins.balance').then(function (r) { return r == null ? null : r; }); },
      // Игрок подтверждает трату в окне площадки. { ok: true, balance } или { ok: false, reason }:
      // reason — 'cancelled' (отказался), 'not_enough', 'guest' (не вошёл), 'unavailable'.
      spend: function (amount, title) {
        if (typeof amount !== 'number' || Math.floor(amount) !== amount || amount < 1 || amount > 1000) {
          return Promise.reject(new RangeError('Igrodrom SDK: сумма — целое число от 1 до 1000'));
        }
        title = String(title == null ? '' : title).trim().slice(0, 60);
        if (!title) return Promise.reject(new TypeError('Igrodrom SDK: укажите, за что списываются монетки'));
        return request('coins.spend', { amount: amount, title: title }, AD_MS)
          .then(function (r) { return r || { ok: false, reason: 'unavailable' }; },
            function () { return { ok: false, reason: 'unavailable' }; });
      },
    };
  }

  function hostedFeedback() {
    return {
      // { value: true } — можно попросить отзыв; иначе reason: 'NO_AUTH' | 'GAME_RATED' | 'UNKNOWN'.
      canReview: function () {
        return request('feedback.can').then(function (r) { return r || { value: false, reason: 'UNKNOWN' }; },
          function () { return { value: false, reason: 'UNKNOWN' }; });
      },
      // Площадка показывает окно отзыва. { sent: true }, если игрок написал отзыв.
      request: function () {
        return request('feedback.request', null, AD_MS).then(function (r) { return { sent: !!(r && r.sent) }; },
          function () { return { sent: false }; });
      },
    };
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
      leaderboard: hostedLeaderboard(),
      coins: hostedCoins(),
      feedback: hostedFeedback(),
      // sdk.on('pause' | 'resume', fn): площадка показывает рекламу — выключите звук и остановите игру.
      on: on,
    };
  }

  // ---------- без площадки ----------
  function noop() { return Promise.resolve(); }

  // Вне площадки таблица — только из своих результатов (для отладки), монетки — из options.debugCoins.
  function localLeaderboard(read, write) {
    function entry(board) {
      var row = read()[board];
      return row ? { rank: 1, name: 'Вы', score: row.score, extra: row.extra || '', player: 'local', me: true } : null;
    }
    return {
      setScore: function (score, opts) {
        return attempt(function () {
          checkScore(score);
          var board = boardOf(opts), all = read();
          if (!all[board] || score > all[board].score) {
            all[board] = { score: score, extra: opts && opts.extra != null ? String(opts.extra) : '' };
            write(all);
          }
          return entry(board);
        });
      },
      getEntries: function (opts) {
        return attempt(function () {
          var board = boardOf(opts), me = entry(board);
          return { board: board, total: me ? 1 : 0, entries: me ? [me] : [], around: me && opts && opts.around ? [me] : [], me: me };
        });
      },
      getPlayerEntry: function (opts) { return attempt(function () { return entry(boardOf(opts)); }); },
    };
  }

  function standalone(key, options) {
    var storageKey = 'igrodrom-sdk:' + key;
    var memory = null;
    var storage = 'memory';
    try { global.localStorage.setItem(storageKey + ':probe', '1'); global.localStorage.removeItem(storageKey + ':probe'); storage = 'browser'; } catch (e) {}
    var boards = {};
    function readBoards() {
      try { if (storage === 'browser') return JSON.parse(global.localStorage.getItem(storageKey + ':lb') || '{}'); } catch (e) {}
      return boards;
    }
    function writeBoards(all) {
      boards = all;
      try { if (storage === 'browser') global.localStorage.setItem(storageKey + ':lb', JSON.stringify(all)); } catch (e) {}
    }
    var coins = options && typeof options.debugCoins === 'number' ? Math.max(0, Math.floor(options.debugCoins)) : null;
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
      leaderboard: localLeaderboard(readBoards, writeBoards),
      coins: {
        balance: function () { return Promise.resolve(coins); },
        spend: function (amount) {
          if (coins === null) return Promise.resolve({ ok: false, reason: 'unavailable' });
          if (amount > coins) return Promise.resolve({ ok: false, reason: 'not_enough' });
          coins -= amount;
          return Promise.resolve({ ok: true, balance: coins });
        },
      },
      feedback: {
        canReview: function () { return Promise.resolve({ value: false, reason: 'UNKNOWN' }); },
        request: function () { return Promise.resolve({ sent: false }); },
      },
      on: function () { return function () {}; },
    };
  }

  var initPromise = null;

  /**
   * Подключение к площадке. Вызывайте один раз при старте игры, повторные вызовы вернут тот же объект.
   * options.key — имя сохранения вне площадки (по умолчанию путь страницы).
   * options.debugCoins — сколько монеток дать вне площадки, чтобы проверить покупки при отладке.
   */
  function init(options) {
    if (initPromise) return initPromise;
    var key = (options && options.key) || global.location.pathname;
    initPromise = new Promise(function (resolve) {
      if (!inFrame()) return resolve(standalone(key, options));
      global.addEventListener('message', onMessage);
      request('init', { sdk: VERSION }, HANDSHAKE_MS).then(
        function (info) { resolve(hosted(info || {})); },
        function () { resolve(standalone(key, options)); }
      );
    });
    return initPromise;
  }

  global.Igrodrom = { init: init, version: VERSION, MAX_SAVE_BYTES: MAX_SAVE_BYTES };
})(typeof window !== 'undefined' ? window : globalThis);

/*!
 * Совместимость с Яндекс Игры SDK v2 для Игродрома.
 *
 * Игра, сделанная под Яндекс Игры, вызывает YaGames.init() и работает с объектом ysdk. Этот файл
 * даёт тот же объект поверх Игродром SDK (v1.js), поэтому архив из консоли Яндекса загружается
 * как есть: при загрузке сервер меняет адрес https://yandex.ru/games/sdk/v2 на /sdk.js
 * (это v1.js и этот файл одним скриптом).
 *
 * Работает: player.getData/setData, getStats/setStats/incrementStats, getStorage, localStorage в песочнице,
 * environment, deviceInfo, LoadingAPI и GameplayAPI, реклама (через площадку), screen.fullscreen,
 * clipboard, serverTime, on/off, getFlags, isAvailableMethod, лидерборды (таблицы рекордов площадки),
 * feedback (окно отзыва на странице игры).
 * Заглушки, чтобы игра не падала: покупки (каталог пуст, купить нельзя), бонусы, ярлык на рабочий стол,
 * мультиплеер, аналитика, вход через Яндекс.
 */
(function (global) {
  'use strict';
  if (global.YaGames) return;

  var FORMAT = 'yandex-v2'; // метка сохранения, чтобы не спутать с сохранением в другом формате
  var MAX_BYTES = 200 * 1024;

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function pick(obj, keys) {
    if (!Array.isArray(keys)) return clone(obj);
    var out = {};
    keys.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = clone(obj[k]); });
    return out;
  }
  function sizeOf(v) {
    var json = JSON.stringify(v);
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length;
  }
  function numbers(obj) {
    var out = {};
    Object.keys(obj || {}).forEach(function (k) { if (typeof obj[k] === 'number' && isFinite(obj[k])) out[k] = obj[k]; });
    return out;
  }
  function resolved(v) { return Promise.resolve(v); }
  function rejected(msg, code) { var e = new Error(msg); if (code) e.code = code; return Promise.reject(e); }

  function deviceType() {
    var ua = (global.navigator && global.navigator.userAgent) || '';
    if (/SmartTV|SMART-TV|\bTV\b|Tizen|WebOS/i.test(ua)) return 'tv';
    if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
    if (/Mobi|iPhone|Android/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  // ---------- localStorage в песочнице ----------
  // Игра на площадке работает с «пустым» origin, где обращение к localStorage бросает ошибку.
  // Многие игры с Яндекса пишут в него напрямую, поэтому подменяем его хранилищем, которое
  // сохраняется вместе с остальным прогрессом игры. Если настоящий localStorage доступен — не трогаем.
  function makeStorage(items, onChange) {
    var api = {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(items(), k) ? items()[k] : null; },
      setItem: function (k, v) { items()[String(k)] = String(v); onChange(); },
      removeItem: function (k) { delete items()[String(k)]; onChange(); },
      clear: function () { var it = items(); Object.keys(it).forEach(function (k) { delete it[k]; }); onChange(); },
      key: function (i) { var keys = Object.keys(items()); return i >= 0 && i < keys.length ? keys[i] : null; },
    };
    Object.defineProperty(api, 'length', { get: function () { return Object.keys(items()).length; } });
    return api;
  }

  var state = { format: FORMAT, data: {}, stats: {}, storage: {} };
  var sdk = null;          // Игродром SDK после init
  var dirty = false;
  var saving = null;

  function persist() {
    if (!sdk) { dirty = true; return resolved(); } // запишем, когда SDK подключится
    saving = sdk.data.set(state).catch(function (e) {
      if (global.console) console.warn('[Игродром] сохранение не удалось:', e && e.message);
    });
    return saving;
  }

  var storage = makeStorage(function () { return state.storage; }, persist);

  (function patchLocalStorage() {
    try { global.localStorage.getItem('igrodrom'); return; } catch (e) { /* песочница */ }
    try { Object.defineProperty(global, 'localStorage', { value: storage, configurable: true }); } catch (e) {}
  })();

  // Другие API, которые в песочнице бросают ошибку при обращении. Игры с Яндекса проверяют их
  // через 'serviceWorker' in navigator и падают, поэтому даём безобидные заменители.
  (function patchSandbox() {
    var nav = global.navigator;
    try { if (nav) void nav.serviceWorker; } catch (e) {
      try {
        Object.defineProperty(nav, 'serviceWorker', { configurable: true, value: {
          controller: null,
          ready: new Promise(function () {}),
          register: function () { return rejected('Service Worker недоступен'); },
          getRegistration: function () { return resolved(undefined); },
          getRegistrations: function () { return resolved([]); },
          addEventListener: function () {}, removeEventListener: function () {},
        } });
      } catch (e2) {}
    }
    var doc = global.document;
    try { if (doc) void doc.cookie; } catch (e) {
      try { Object.defineProperty(doc, 'cookie', { configurable: true, get: function () { return ''; }, set: function () {} }); } catch (e2) {}
    }
  })();

  // ---------- события ----------
  var listeners = {};
  function on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); return function () { off(name, fn); }; }
  function off(name, fn) { listeners[name] = (listeners[name] || []).filter(function (f) { return f !== fn; }); }
  function emit(name) {
    (listeners[name] || []).slice().forEach(function (fn) { try { fn(); } catch (e) { setTimeout(function () { throw e; }); } });
  }

  // ---------- игрок ----------
  function makePlayer(info) {
    var authorized = !info.anonymous;
    return {
      getMode: function () { return authorized ? '' : 'lite'; },
      isAuthorized: function () { return authorized; },
      getUniqueID: function () { return info.id || ''; },
      getIDsPerGame: function () { return resolved([]); },
      getName: function () { return info.name || ''; },
      getPhoto: function () { return ''; },
      getAvatarSrc: function () { return ''; },
      getAvatarSrcSet: function () { return ''; },
      getPayingStatus: function () { return 'unknown'; },
      signature: undefined,
      // Внутреннее поле Яндекса, но игры его читают: '0' — «аватара нет».
      _personalInfo: { avatarIdHash: '0', publicName: info.name || '' },
      getData: function (keys) { return resolved(pick(state.data, keys)); },
      setData: function (data) {
        var next = clone(data || {});
        if (sizeOf(Object.assign({}, state, { data: next })) > MAX_BYTES) return rejected('Сохранение больше 200 КБ');
        state.data = next;
        return persist().then(function () {});
      },
      getStats: function (keys) { return resolved(pick(state.stats, keys)); },
      setStats: function (stats) { state.stats = numbers(stats); return persist().then(function () {}); },
      incrementStats: function (inc) {
        var add = numbers(inc);
        Object.keys(add).forEach(function (k) { state.stats[k] = (state.stats[k] || 0) + add[k]; });
        return persist().then(function () { return pick(state.stats, Object.keys(add)); });
      },
    };
  }

  // ---------- лидерборды: таблицы рекордов площадки ----------
  // Порядок всегда «больше — лучше», как у таблиц Яндекса по умолчанию.
  function lbDescription(name) {
    return { appID: '', default: name === 'main', name: name, title: { ru: name, en: name },
      description: { invert_sort_order: false, score_format: { options: { decimal_offset: 0 } }, type: 'numeric' } };
  }
  function lbEntry(e) {
    return {
      score: e.score, extraData: e.extra || '', rank: e.rank, formattedScore: String(e.score),
      player: {
        lang: 'ru', publicName: e.name, uniqueID: e.player,
        scopePermissions: { avatar: 'forbid', public_name: 'allow' },
        getAvatarSrc: function () { return ''; }, getAvatarSrcSet: function () { return ''; },
      },
    };
  }
  function needBoard() { return connect().then(function (s) { return s.leaderboard; }); }
  var leaderboards = {
    getDescription: function (name) { return resolved(lbDescription(name)); },
    setScore: function (name, score, extraData) {
      return needBoard().then(function (lb) {
        return lb.setScore(Math.round(Number(score)), { board: name, extra: extraData == null ? '' : String(extraData).slice(0, 128) });
      }).then(function () {});
    },
    getPlayerEntry: function (name) {
      return needBoard().then(function (lb) { return lb.getPlayerEntry({ board: name }); }).then(function (me) {
        return me ? lbEntry(me) : rejected('Игрока нет в таблице', 'LEADERBOARD_PLAYER_NOT_PRESENT');
      });
    },
    getEntries: function (name, opts) {
      opts = opts || {};
      var top = opts.quantityTop || 5;
      var around = opts.includeUser ? opts.quantityAround || 5 : 0;
      return needBoard().then(function (lb) { return lb.getEntries({ board: name, top: top, around: around }); }).then(function (r) {
        var list = r.entries.slice();
        var ranges = [{ start: 0, size: list.length }];
        var near = (r.around || []).filter(function (e) { return e.rank > list.length; });
        if (near.length) {
          ranges.push({ start: near[0].rank - 1, size: near.length });
          list = list.concat(near);
        }
        return { leaderboard: lbDescription(name), ranges: ranges, userRank: r.me ? r.me.rank : 0, entries: list.map(lbEntry) };
      });
    },
  };
  var legacyLeaderboards = {
    getLeaderboardDescription: leaderboards.getDescription,
    setLeaderboardScore: leaderboards.setScore,
    getLeaderboardPlayerEntry: leaderboards.getPlayerEntry,
    getLeaderboardEntries: leaderboards.getEntries,
  };
  // Покупки за деньги на площадке не продаются: каталог пуст, купить нельзя.
  var payments = {
    getCatalog: function () { return resolved([]); },
    getPurchases: function () { var list = []; list.signature = ''; return resolved(list); },
    purchase: function () { return rejected('Покупки на Игродроме пока недоступны'); },
    consumePurchase: function () { return resolved(); },
  };

  var AVAILABLE = {
    'adv.showFullscreenAdv': true, 'adv.showRewardedVideo': true, 'player.getData': true, 'player.setData': true,
    'player.getStats': true, 'player.setStats': true, 'player.incrementStats': true, 'getStorage': true,
    'features.LoadingAPI.ready': true, 'features.GameplayAPI.start': true, 'features.GameplayAPI.stop': true,
    'leaderboards.setScore': true, 'leaderboards.getEntries': true, 'leaderboards.getPlayerEntry': true,
    'leaderboards.getDescription': true, 'feedback.canReview': true, 'feedback.requestReview': true,
  };

  function call(fn) { if (typeof fn === 'function') { try { fn.apply(null, [].slice.call(arguments, 1)); } catch (e) { setTimeout(function () { throw e; }); } } }

  // Площадка присылает pause/resume на время рекламы — это game_api_pause/resume Яндекса.
  var openWaiters = [];
  function whenOpened(fn) {
    var w = { fired: false, cancel: function () { openWaiters = openWaiters.filter(function (x) { return x !== w; }); } };
    w.fire = function () { w.fired = true; w.cancel(); fn(); };
    openWaiters.push(w);
    return w;
  }
  function listenHost(s) {
    if (!s.on) return;
    s.on('pause', function () { emit('game_api_pause'); openWaiters.slice().forEach(function (w) { w.fire(); }); });
    s.on('resume', function () { emit('game_api_resume'); });
  }

  function makeYsdk(info) {
    var player = makePlayer(info.player || { anonymous: true });
    var gameId = info.environment.gameId || 'igrodrom';
    var payload = null;
    try { payload = new URLSearchParams(global.location.search).get('payload'); } catch (e) {}
    var type = deviceType();

    var ysdk = {
      environment: {
        app: { id: gameId },
        browser: { lang: 'ru' },
        i18n: { lang: 'ru', tld: 'ru' },
        payload: payload || undefined,
      },
      deviceInfo: {
        type: type,
        isMobile: function () { return type === 'mobile'; },
        isTablet: function () { return type === 'tablet'; },
        isDesktop: function () { return type === 'desktop'; },
        isTV: function () { return type === 'tv'; },
      },
      features: {
        LoadingAPI: { ready: function () { info.game.ready(); } },
        GameplayAPI: { start: function () { info.game.start(); }, stop: function () { info.game.stop(); } },
        GamesAPI: {
          getAllGames: function () { return resolved({ games: [], developerURL: '' }); },
          getGameByID: function () { return resolved({ isAvailable: false }); },
        },
        PluginEngineDataReporterAPI: { report: function () {} },
      },
      adv: {
        // onOpen вызывается, когда площадка действительно открыла рекламу (событие pause).
        showFullscreenAdv: function (opts) {
          var cb = (opts && opts.callbacks) || {};
          var opened = whenOpened(function () { call(cb.onOpen); });
          info.ads.fullscreen().then(function (r) {
            opened.cancel();
            call(cb.onClose, r.shown);
          });
        },
        showRewardedVideo: function (opts) {
          var cb = (opts && opts.callbacks) || {};
          var opened = whenOpened(function () { call(cb.onOpen); });
          info.ads.rewarded().then(function (r) {
            if (!opened.fired) call(cb.onOpen); // без рекламы игра всё равно ждёт onOpen перед наградой
            opened.cancel();
            if (r.rewarded) call(cb.onRewarded);
            call(cb.onClose);
          });
        },
        showBannerAdv: function () { return resolved({ stickyAdvIsShowing: false, reason: 'ADV_IS_NOT_CONNECTED' }); },
        hideBannerAdv: function () { return resolved({ stickyAdvIsShowing: false }); },
        getBannerAdvStatus: function () { return resolved({ stickyAdvIsShowing: false, reason: 'ADV_IS_NOT_CONNECTED' }); },
      },
      auth: { openAuthDialog: function () { return rejected('Войдите на Игродроме на странице игры'); } },
      getPlayer: function () { return resolved(player); },
      getStorage: function () { return resolved(storage); },
      getLeaderboards: function () { return resolved(legacyLeaderboards); },
      leaderboards: leaderboards,
      getPayments: function () { return resolved(payments); },
      payments: payments,
      // Отзыв пишется в окне площадки под игрой.
      feedback: {
        canReview: function () { return info.feedback.canReview(); },
        requestReview: function () { return info.feedback.request().then(function (r) { return { feedbackSent: r.sent }; }); },
      },
      shortcut: {
        canShowPrompt: function () { return resolved({ canShow: false }); },
        showPrompt: function () { return resolved({ outcome: 'rejected' }); },
      },
      screen: {
        fullscreen: {
          get status() { return global.document && global.document.fullscreenElement ? 'on' : 'off'; },
          request: function () {
            var el = global.document && global.document.documentElement;
            return el && el.requestFullscreen ? el.requestFullscreen() : rejected('Полноэкранный режим недоступен');
          },
          exit: function () {
            var d = global.document;
            return d && d.fullscreenElement && d.exitFullscreen ? d.exitFullscreen() : resolved();
          },
        },
      },
      clipboard: {
        writeText: function (text) {
          var c = global.navigator && global.navigator.clipboard;
          return c && c.writeText ? c.writeText(String(text)) : rejected('Буфер обмена недоступен');
        },
      },
      bonuses: {
        getPlayerBonuses: function () { return resolved([]); },
        consume: function () { return resolved(); },
      },
      yandexApp: { enabled: false },
      analytics: { yaMetrikaCounter: { reachGoal: function () {} } },
      multiplayer: { sessions: { init: function () { return resolved([]); }, commit: function () {}, push: function () {} } },
      serverTime: function () { return Date.now(); },
      getFlags: function (opts) { return resolved(Object.assign({}, (opts && opts.defaultFlags) || {})); },
      isAvailableMethod: function (name) { return resolved(!!AVAILABLE[name]); },
      on: on,
      off: off,
      dispatchEvent: function () { return resolved(); },
      EVENTS: { ACCOUNT_SELECTION_DIALOG_OPENED: 'ACCOUNT_SELECTION_DIALOG_OPENED', ACCOUNT_SELECTION_DIALOG_CLOSED: 'ACCOUNT_SELECTION_DIALOG_CLOSED', HISTORY_BACK: 'HISTORY_BACK', EXIT: 'EXIT' },
    };
    return ysdk;
  }

  // Подключаемся сразу при загрузке скрипта, не дожидаясь YaGames.init(): игра может читать
  // localStorage раньше, и чем быстрее придёт сохранение, тем меньше шанс прочитать пустое.
  var connected = null;
  function connect() {
    if (connected) return connected;
    if (!global.Igrodrom) { connected = rejected('Игродром SDK не подключён: нужен /sdk.js'); return connected; }
    connected = global.Igrodrom.init({ key: 'yandex:' + global.location.pathname }).then(function (s) {
      return s.data.get().catch(function () { return null; }).then(function (saved) {
        if (saved && saved.format === FORMAT) {
          // Сохранённое важнее записанного до подключения: игры при старте часто пишут значения
          // по умолчанию, и они не должны затереть настоящий прогресс.
          var early = state.storage;
          state = { format: FORMAT, data: saved.data || {}, stats: numbers(saved.stats), storage: saved.storage || {} };
          Object.keys(early).forEach(function (k) {
            if (!Object.prototype.hasOwnProperty.call(state.storage, k)) state.storage[k] = early[k];
          });
        }
        sdk = s;
        listenHost(s);
        if (dirty) { dirty = false; persist(); }
        return s;
      });
    });
    return connected;
  }

  var initPromise = null;
  function init() {
    initPromise = initPromise || connect().then(function (s) {
      return makeYsdk({ environment: s.environment, player: s.player, ads: s.ads, game: s.game, feedback: s.feedback });
    });
    return initPromise;
  }

  connect().catch(function () {});
  global.YaGames = { init: init };
})(typeof window !== 'undefined' ? window : globalThis);
