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
 * clipboard, serverTime, on/off, getFlags, isAvailableMethod.
 * Заглушки, чтобы игра не падала: лидерборды (пустые), покупки (каталог пуст, купить нельзя),
 * бонусы, отзывы, ярлык на рабочий стол, мультиплеер, аналитика, вход через Яндекс.
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

  // ---------- лидерборды и покупки: пока заглушки ----------
  function lbDescription(name) {
    return { appID: '', default: false, name: name, title: { ru: name, en: name },
      description: { invert_sort_order: false, score_format: { options: { decimal_offset: 0 } }, type: 'numeric' } };
  }
  function lbEntries(name) { return { leaderboard: lbDescription(name), ranges: [], userRank: 0, entries: [] }; }
  var leaderboards = {
    getDescription: function (name) { return resolved(lbDescription(name)); },
    setScore: function () { return resolved(); },
    getPlayerEntry: function () { return rejected('Игрока нет в таблице', 'LEADERBOARD_PLAYER_NOT_PRESENT'); },
    getEntries: function (name) { return resolved(lbEntries(name)); },
  };
  var legacyLeaderboards = {
    getLeaderboardDescription: leaderboards.getDescription,
    setLeaderboardScore: leaderboards.setScore,
    getLeaderboardPlayerEntry: leaderboards.getPlayerEntry,
    getLeaderboardEntries: leaderboards.getEntries,
  };
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
      feedback: {
        canReview: function () { return resolved({ value: false, reason: 'UNKNOWN' }); },
        requestReview: function () { return resolved({ feedbackSent: false }); },
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
      return makeYsdk({ environment: s.environment, player: s.player, ads: s.ads, game: s.game });
    });
    return initPromise;
  }

  connect().catch(function () {});
  global.YaGames = { init: init };
})(typeof window !== 'undefined' ? window : globalThis);
