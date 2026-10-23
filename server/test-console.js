// Журнал тестового запуска. Сервер вставляет этот скрипт первым в <head> игры, только когда её
// открывают по ссылке тестового запуска из кабинета (/test-run/…). Скрипт пересылает странице
// кабинета console.*, необработанные ошибки и файлы, которые не загрузились. Поведение игры не меняется:
// исходные console.* вызываются как обычно. Пишется на ES5 — работает и в старых движках.
(function () {
  'use strict';
  var PROTOCOL = 'gamely-console';
  var MAX_TEXT = 4000;
  var PER_SECOND = 200; // игра может писать в консоль в каждом кадре — лишнее не пересылаем
  var parentWin;
  try { parentWin = window.parent !== window ? window.parent : null; } catch (e) { parentWin = null; }
  if (!parentWin) return;

  var sent = 0, dropped = 0, second = 0;
  function send(entry) {
    entry.protocol = PROTOCOL;
    entry.t = Date.now();
    try { parentWin.postMessage(entry, '*'); } catch (e) {}
  }
  function post(entry) {
    var s = Math.floor(Date.now() / 1000);
    if (s !== second) {
      second = s; sent = 0;
      if (dropped) { send({ level: 'warn', text: 'Журнал: пропущено сообщений — ' + dropped + ' (больше ' + PER_SECOND + ' в секунду)' }); dropped = 0; }
    }
    if (++sent > PER_SECOND) { dropped++; return; }
    send(entry);
  }

  // Значение в строку: объекты — JSON без циклов, ошибки — со стеком.
  function show(v) {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.stack && v.stack.indexOf(v.message) >= 0 ? v.stack : v.name + ': ' + v.message + (v.stack ? '\n' + v.stack : '');
    if (v === undefined) return 'undefined';
    if (typeof v === 'function') return 'function ' + (v.name || '') + '()';
    if (typeof v === 'symbol' || typeof v === 'bigint') return String(v);
    if (typeof Element !== 'undefined' && v instanceof Element) return '<' + v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') + '>';
    try {
      var seen = [];
      return JSON.stringify(v, function (k, x) {
        if (typeof x === 'object' && x !== null) { if (seen.indexOf(x) >= 0) return '[цикл]'; seen.push(x); }
        if (typeof x === 'bigint') return String(x);
        return x;
      });
    } catch (e) { return String(v); }
  }
  function text(args) {
    var out = [];
    for (var i = 0; i < args.length; i++) out.push(show(args[i]));
    var s = out.join(' ');
    return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '…' : s;
  }

  // Откуда вызвали console.*: первая строка стека не из этого скрипта (его функции названы gamely…).
  function gamelyCaller() {
    var lines = String((new Error()).stack || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (/gamelyC(onsole|aller)/.test(lines[i])) continue;
      var m = lines[i].match(/((?:https?:)?\/\/[^\s)]+):(\d+):(\d+)/);
      if (m) return { file: m[1], line: +m[2], col: +m[3] };
    }
    return null;
  }

  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var orig = console[level];
    console[level] = function gamelyConsole() {
      var where = null;
      try { where = gamelyCaller(); } catch (e) {}
      post({ level: level, text: text(arguments), file: where && where.file, line: where && where.line, col: where && where.col });
      if (orig) return orig.apply(console, arguments);
    };
  });

  // Необработанные ошибки и картинки, звуки, скрипты, которые не загрузились (событие error на элементе
  // не всплывает, поэтому слушаем на этапе перехвата).
  window.addEventListener('error', function (e) {
    var el = e.target;
    if (el && el !== window && el.tagName) {
      var url = el.currentSrc || el.src || el.href || '';
      post({ level: 'resource', text: '<' + el.tagName.toLowerCase() + '> не загрузился', url: url });
      return;
    }
    post({
      level: 'exception', text: e.message || 'Ошибка', file: e.filename || null, line: e.lineno || null, col: e.colno || null,
      stack: e.error && e.error.stack ? String(e.error.stack) : null,
    });
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    post({ level: 'rejection', text: 'Необработанный отказ промиса: ' + (r instanceof Error ? r.message : show(r)), stack: r && r.stack ? String(r.stack) : null });
  });

  // Скрипты, которые игра добавляет сама (загрузчики Unity, Construct), — тоже с crossorigin, если они из папки
  // игры: иначе браузер покажет вместо их ошибок «Script error.». Теги из HTML размечает сервер.
  var root = (location.href.match(/^.*?\/test-run\/[^/]+\//) || [''])[0];
  function cors(node) {
    if (root && node && node.tagName === 'SCRIPT' && node.src && !node.hasAttribute('crossorigin') && node.src.indexOf(root) === 0) {
      node.crossOrigin = 'anonymous';
    }
  }
  ['appendChild', 'insertBefore'].forEach(function (name) {
    var orig = Node.prototype[name];
    Node.prototype[name] = function (node) { cors(node); return orig.apply(this, arguments); };
  });
  if (Element.prototype.append) {
    var append = Element.prototype.append;
    Element.prototype.append = function () { for (var i = 0; i < arguments.length; i++) cors(arguments[i]); return append.apply(this, arguments); };
  }

  // fetch и XMLHttpRequest: ответы 4xx/5xx и сетевые ошибки (уровни, звуки, данные игры).
  if (window.fetch) {
    var origFetch = window.fetch;
    window.fetch = function (input) {
      var url = typeof input === 'string' ? input : input && input.url;
      return origFetch.apply(this, arguments).then(function (r) {
        if (!r.ok) post({ level: 'resource', text: 'fetch: ответ ' + r.status, url: r.url || url });
        return r;
      }, function (err) {
        post({ level: 'resource', text: 'fetch: не удалось загрузить (' + (err && err.message) + ')', url: url });
        throw err;
      });
    };
  }
  if (window.XMLHttpRequest) {
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var xhr = this, aborted = false;
      xhr.addEventListener('abort', function () { aborted = true; });
      xhr.addEventListener('loadend', function () {
        if (xhr.status >= 400 || (xhr.status === 0 && !aborted)) {
          post({ level: 'resource', text: 'XHR: ' + (xhr.status ? 'ответ ' + xhr.status : 'не удалось загрузить'), url: xhr.responseURL || String(url) });
        }
      });
      return open.apply(this, arguments);
    };
  }
})();
