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
        showFullscreenAdv: function (opts) {
          var cb = (opts && opts.callbacks) || {};
          info.ads.fullscreen().then(function (r) {
            if (r.shown) { call(cb.onOpen); }
            call(cb.onClose, r.shown);
          });
        },
        showRewardedVideo: function (opts) {
          var cb = (opts && opts.callbacks) || {};
          emit('game_api_pause');
          call(cb.onOpen);
          info.ads.rewarded().then(function (r) {
            if (r.rewarded) call(cb.onRewarded);
            call(cb.onClose);
            emit('game_api_resume');
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
