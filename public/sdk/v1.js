/*!
 * Gamely SDK v1 — сохранения, реклама и события для HTML5-игр.
 *
 *   <script src="/sdk/v1.js"></script>
 *   const sdk = await Gamely.init();
 *   const save = (await sdk.data.get()) || { level: 1 };
 *   sdk.game.ready();                                  // игра загрузилась
 *   await sdk.data.set({ level: 2, coins: 150 });
 *   const { rewarded, shown } = await sdk.ads.rewarded(); // награда за рекламу; shown — показала ли её сеть (не заставка сайта)
 *   await sdk.leaderboard.setScore(1200);              // таблица рекордов (только вошедшие игроки)
 *   const { ok } = await sdk.coins.spend(30, 'Щит');   // монетки площадки, игрок подтверждает трату
 *
 * Игра на Gamely работает в песочнице без доступа к хранилищу браузера, поэтому SDK передаёт
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

  // В песочнице площадки (без allow-same-origin) чтение window.caches бросает SecurityError. Загрузчик Unity 6
  // читает его перед скачиванием данных игры, падает на ошибке и запускает игру пустой («Could not open
  // global-metadata.dat»). Свойство, которое бросает ошибку, заменяем на undefined: загрузчик видит,
  // что кэша нет, и скачивает файлы напрямую, как на Яндекс Играх без кэша.
  ['caches', 'indexedDB'].forEach(function (name) {
    try { void global[name]; } catch (e) {
      try { Object.defineProperty(global, name, { value: undefined, configurable: true }); } catch (e2) { /* оставляем как есть */ }
    }
  });

  // Настоящий localStorage — запоминаем при загрузке, до того как совместимость с Яндексом (sdk/yandex.js)
  // подменит его своим хранилищем: иначе сохранение вне площадки попадало бы внутрь самого себя.
  var browserStorage = null;
  try { browserStorage = global.localStorage; browserStorage.getItem('igrodrom'); } catch (e) { browserStorage = null; }

  function inFrame() {
    try { return global.parent && global.parent !== global; } catch (e) { return true; }
  }

  function sizeOf(json) {
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length;
  }

  // Проверяем до отправки: ошибка должна прийти в игру сразу, а не после сетевого запроса.
  function serialize(value) {
    var json;
    try { json = JSON.stringify(value); } catch (e) { throw new TypeError('Gamely SDK: сохранение должно сериализоваться в JSON'); }
    if (json === undefined) throw new TypeError('Gamely SDK: сохранение должно быть JSON-значением');
    if (sizeOf(json) > MAX_SAVE_BYTES) throw new RangeError('Gamely SDK: сохранение больше 200 КБ');
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
    else p.reject(new Error(m.error || 'Gamely SDK: ошибка площадки'));
  }

  function request(type, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = {
        resolve: resolve,
        reject: reject,
        timer: setTimeout(function () {
          delete pending[id];
          reject(new Error('Gamely SDK: площадка не ответила'));
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
        return request('adv.rewarded', null, AD_MS).then(function (r) { return { rewarded: !!(r && r.rewarded), shown: !!(r && r.shown) }; },
          function () { return { rewarded: false, shown: false }; });
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
    if (!BOARD_RE.test(board)) throw new TypeError('Gamely SDK: имя таблицы — латиница, цифры, «_», «-», «.», до 40 символов');
    return board;
  }
  function checkScore(score) {
    if (typeof score !== 'number' || !isFinite(score) || Math.floor(score) !== score) {
      throw new TypeError('Gamely SDK: результат должен быть целым числом');
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
          return Promise.reject(new RangeError('Gamely SDK: сумма — целое число от 1 до 1000'));
        }
        title = String(title == null ? '' : title).trim().slice(0, 60);
        if (!title) return Promise.reject(new TypeError('Gamely SDK: укажите, за что списываются монетки'));
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
      environment: { host: 'gamely', storage: info.storage, gameId: info.gameId, lang: info.lang || 'ru' },
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
    try { browserStorage.setItem(storageKey + ':probe', '1'); browserStorage.removeItem(storageKey + ':probe'); storage = 'browser'; } catch (e) {}
    var boards = {};
    function readBoards() {
      try { if (storage === 'browser') return JSON.parse(browserStorage.getItem(storageKey + ':lb') || '{}'); } catch (e) {}
      return boards;
    }
    function writeBoards(all) {
      boards = all;
      try { if (storage === 'browser') browserStorage.setItem(storageKey + ':lb', JSON.stringify(all)); } catch (e) {}
    }
    var coins = options && typeof options.debugCoins === 'number' ? Math.max(0, Math.floor(options.debugCoins)) : null;
    return {
      version: VERSION,
      environment: { host: 'standalone', storage: storage, gameId: null, lang: 'ru' },
      player: playerOf(null),
      data: {
        get: function () {
          try {
            var v = storage === 'browser' ? browserStorage.getItem(storageKey) : memory;
            return Promise.resolve(v == null ? null : JSON.parse(v));
          } catch (e) { return Promise.resolve(null); }
        },
        set: function (value) {
          try {
            var json = serialize(value);
            memory = json;
            if (storage === 'browser') browserStorage.setItem(storageKey, json);
            return Promise.resolve();
          } catch (e) { return Promise.reject(e); }
        },
        clear: function () {
          memory = null;
          try { if (storage === 'browser') browserStorage.removeItem(storageKey); } catch (e) {}
          return Promise.resolve();
        },
      },
      ads: {
        fullscreen: function () { return Promise.resolve({ shown: false }); },
        rewarded: function () { return Promise.resolve({ rewarded: true, shown: false }); },
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
      // Первое касание, клик или клавиша в игре — один раз сообщаем площадке: так она отличает игрока,
      // который начал играть, от случайного захода (игра по рекламной ссылке открывается сама).
      var touched = false, connected = false;
      var reportInput = function () { request('game.input').then(function () {}, function () {}); };
      var onInput = function (e) {
        if (touched || (e && e.isTrusted === false)) return;
        touched = true;
        ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) { global.removeEventListener(t, onInput, true); });
        if (connected) reportInput();
      };
      ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) { global.addEventListener(t, onInput, true); });
      request('init', { sdk: VERSION }, HANDSHAKE_MS).then(
        function (info) { connected = true; if (touched) reportInput(); resolve(hosted(info || {})); },
        function () { resolve(standalone(key, options)); }
      );
    });
    return initPromise;
  }

  global.Gamely = { init: init, version: VERSION, MAX_SAVE_BYTES: MAX_SAVE_BYTES };
  global.Igrodrom = global.Gamely; // старое имя площадки: игры, собранные под него, продолжают работать
})(typeof window !== 'undefined' ? window : globalThis);
