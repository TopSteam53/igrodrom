// Сторона площадки для Gamely SDK (public/sdk/v1.js).
// Подключается на странице игры и отвечает на запросы игры из её iframe.
//
// Безопасность: принимаем сообщения только от своего iframe (event.source), а id игры берём
// со страницы, не из сообщения — игра не может прочитать или затереть сохранение другой игры.
(function () {
  const PROTOCOL = 'igrodrom-sdk';
  const MAX_SAVE_BYTES = 200 * 1024;

  // Сервер: сохранение привязано к игроку через cookie vid.
  function serverStore(gameId) {
    const url = `/api/games/${encodeURIComponent(gameId)}/save`;
    const call = async (method, body) => {
      const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Ошибка ${r.status}`);
      return data;
    };
    return {
      kind: 'server',
      get: async () => { const { data } = await call('GET'); return data == null ? null : JSON.stringify(data); },
      set: (json) => call('PUT', `{"data":${json}}`),
      clear: () => call('DELETE'),
    };
  }

  // Статическая версия (GitHub Pages): хранилище браузера на стороне страницы, не игры.
  function browserStore(gameId) {
    const key = `igrodrom:save:${gameId}`;
    let memory = null;
    return {
      kind: 'browser',
      get: async () => { try { return localStorage.getItem(key); } catch { return memory; } },
      set: async (json) => { memory = json; try { localStorage.setItem(key, json); } catch {} },
      clear: async () => { memory = null; try { localStorage.removeItem(key); } catch {} },
    };
  }

  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || `Ошибка ${r.status}`); e.status = r.status; throw e; }
    return data;
  }

  // Таблицы рекордов: на сервере — общие для всех вошедших игроков.
  function serverBoards(gameId) {
    const url = `/api/games/${encodeURIComponent(gameId)}/leaderboard`;
    return {
      set: async ({ board, score, extra }) => {
        const { entry } = await api('POST', url, { board, score, extra });
        window.Igr?.checkNews?.(); // рекорд мог дать достижение — уведомление сразу
        return entry;
      },
      get: ({ board, top, around }) => api('GET', `${url}?${new URLSearchParams({ board, top, around })}`),
    };
  }

  // Без сервера — только свои результаты в хранилище страницы.
  function browserBoards(gameId) {
    const key = `igrodrom:lb:${gameId}`;
    let memory = {};
    const read = () => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return memory; } };
    const write = (all) => { memory = all; try { localStorage.setItem(key, JSON.stringify(all)); } catch {} };
    const entry = (board) => {
      const row = read()[board];
      return row ? { rank: 1, name: 'Вы', score: row.score, extra: row.extra, player: 'local', me: true } : null;
    };
    return {
      set: async ({ board, score, extra }) => {
        const all = read();
        if (!all[board] || score > all[board].score) { all[board] = { score, extra }; write(all); }
        return entry(board);
      },
      get: async ({ board, around }) => {
        const me = entry(board);
        return { board, total: me ? 1 : 0, entries: me ? [me] : [], around: me && around ? [me] : [], me };
      },
    };
  }

  // Тестовый запуск из кабинета: сохранение и рекорды живут в памяти страницы и пропадают при её закрытии.
  // Для игры это выглядит как сервер площадки — она ведёт себя так же, как у игроков.
  function memoryStore() {
    let saved = null;
    return {
      kind: 'server',
      get: async () => saved,
      set: async (json) => { saved = json; },
      clear: async () => { saved = null; },
      get size() { return saved == null ? 0 : new TextEncoder().encode(saved).length; },
    };
  }
  function memoryBoards(name = 'Вы') {
    const all = {};
    const entry = (board) => {
      const row = all[board];
      return row ? { rank: 1, name, score: row.score, extra: row.extra, player: 'test', me: true } : null;
    };
    return {
      set: async ({ board, score, extra }) => {
        if (!all[board] || score > all[board].score) all[board] = { score, extra };
        return entry(board);
      },
      get: async ({ board, around }) => {
        const me = entry(board);
        return { board, total: me ? 1 : 0, entries: me ? [me] : [], around: me && around ? [me] : [], me };
      },
    };
  }

  // Без рекламной сети: полноэкранная не показывается, награда выдаётся сразу.
  const NO_ADS = {
    fullscreen: async () => ({ shown: false }),
    rewarded: async (hooks) => { hooks.open?.(); return { rewarded: true, shown: false }; },
  };

  /**
   * Начать обслуживать игру в iframe. Вызывать до того, как iframe начнёт загружаться.
   * player() — кто играет: { authorized, name, id }; id у каждой игры свой, по нему нельзя
   * связать игрока между играми. onEvent(type) — события игры: game.ready, game.start, game.stop.
   * ads — реклама страницы (IgrAds из ads.js); onAd(kind) — реклама показана, для статистики.
   * coins — монетки игрока: { balance(), confirm({ amount, title, balance }) → true/false, spend(amount, title) };
   * без него монетки недоступны. feedback — { can() → { value, reason }, request() → true, если отзыв написан }.
   * onScore(entry) — игра записала результат в таблицу рекордов.
   * Тестовый запуск: store и boards заменяют хранилища (memoryStore, memoryBoards), onCall({ type, payload, ok,
   * result, error, ms }) получает каждый запрос игры с ответом, onPush(event) — события площадки для игры.
   */
  function attach(frame, {
    gameId, live, player = async () => null, onEvent = () => {}, ads = NO_ADS, onAd = () => {}, coins = null, feedback = null,
    onScore = () => {}, store: storeOverride = null, boards: boardsOverride = null, onCall = null, onPush = null,
  }) {
    const store = storeOverride || (live ? serverStore(gameId) : browserStore(gameId));
    const boards = boardsOverride || (live ? serverBoards(gameId) : browserBoards(gameId));
    const BOARD_RE = /^[\w.-]{1,40}$/;
    function boardArgs(p) {
      const board = String(p?.board ?? 'main');
      if (!BOARD_RE.test(board)) throw new Error('Некорректное имя таблицы');
      return board;
    }

    async function spend(p) {
      const amount = Number(p?.amount);
      const title = String(p?.title ?? '').trim().slice(0, 60);
      if (!Number.isInteger(amount) || amount < 1 || amount > 1000 || !title) throw new Error('Некорректная покупка');
      if (!coins) return { ok: false, reason: 'unavailable' };
      const balance = await coins.balance();
      // Окно подтверждения — на странице площадки, вне песочницы: игра не может нажать «Потратить» сама.
      const yes = await coins.confirm({ amount, title, balance });
      if (balance == null) return { ok: false, reason: 'guest' };
      // Окно площадки уже сказало «Не хватает монеток» — игре сообщаем причину, а не отказ игрока.
      if (balance < amount) return { ok: false, reason: 'not_enough' };
      if (!yes) return { ok: false, reason: 'cancelled' };
      try {
        return { ok: true, balance: await coins.spend(amount, title) };
      } catch (err) {
        if (err.status === 409) return { ok: false, reason: 'not_enough' };
        if (err.status === 401) return { ok: false, reason: 'guest' };
        throw err;
      }
    }
    // События площадки для игры: пауза на время рекламы и продолжение.
    const push = (event) => { onPush?.(event); frame.contentWindow?.postMessage({ protocol: PROTOCOL, event }, '*'); };

    async function advert(kind) {
      let opened = false;
      const result = await ads[kind]({ open: () => { opened = true; push('pause'); } });
      // «Продолжить» уходит после ответа: игра сначала узнаёт результат, потом снимается с паузы.
      if (opened) setTimeout(() => push('resume'), 0);
      if (kind === 'fullscreen') {
        if (result.shown) onAd('fullscreen');
        return { shown: !!result.shown };
      }
      if (result.shown && result.rewarded) onAd('rewarded');
      return { rewarded: !!result.rewarded };
    }

    async function handle(m) {
      switch (m.type) {
        case 'init': {
          const p = await player().catch(() => null);
          return { gameId, storage: store.kind, lang: 'ru', sdk: 1, player: p || { authorized: false, name: '', id: null } };
        }
        case 'adv.fullscreen': return advert('fullscreen');
        case 'adv.rewarded': return advert('rewarded');
        case 'game.ready': case 'game.start': case 'game.stop': onEvent(m.type); return null;
        case 'data.get': return store.get();
        case 'data.set': {
          const json = m.payload;
          if (typeof json !== 'string') throw new Error('Некорректное сохранение');
          if (new TextEncoder().encode(json).length > MAX_SAVE_BYTES) throw new Error('Сохранение больше 200 КБ');
          JSON.parse(json); // только валидный JSON
          await store.set(json);
          return null;
        }
        case 'data.clear': await store.clear(); return null;
        case 'lb.set': {
          const score = m.payload?.score;
          if (!Number.isSafeInteger(score)) throw new Error('Результат должен быть целым числом');
          const entry = await boards.set({ board: boardArgs(m.payload), score, extra: String(m.payload?.extra ?? '').slice(0, 128) });
          onScore(entry);
          return entry;
        }
        case 'lb.get': {
          const top = Math.min(100, Math.max(0, Number(m.payload?.top) || 0));
          const around = Math.min(10, Math.max(0, Number(m.payload?.around) || 0));
          return boards.get({ board: boardArgs(m.payload), top, around });
        }
        case 'coins.balance': return coins ? coins.balance() : null;
        case 'coins.spend': return spend(m.payload);
        case 'feedback.can': return feedback ? feedback.can() : { value: false, reason: 'UNKNOWN' };
        case 'feedback.request': return { sent: feedback ? !!(await feedback.request()) : false };
        default: throw new Error(`Неизвестный запрос: ${m.type}`);
      }
    }

    function onMessage(e) {
      if (e.source !== frame.contentWindow) return;
      const m = e.data;
      if (!m || m.protocol !== PROTOCOL || typeof m.id !== 'number') return;
      // Песочница даёт игре «пустой» origin, поэтому адресат ответа — '*', но окно-получатель — только наш iframe.
      const reply = (msg) => e.source.postMessage({ protocol: PROTOCOL, id: m.id, ...msg }, '*');
      const t0 = Date.now();
      const log = (msg) => onCall?.({ type: m.type, payload: m.payload, ms: Date.now() - t0, ...msg });
      handle(m).then((result) => { log({ ok: true, result }); reply({ ok: true, result }); },
        (err) => { log({ ok: false, error: err.message }); reply({ ok: false, error: err.message }); });
    }

    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  }

  // Постоянный id игрока для одной игры: хэш от id аккаунта и id игры.
  async function playerIdFor(userId, gameId) {
    const bytes = new TextEncoder().encode(`igrodrom:${userId}:${gameId}`);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...hash.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  window.IgrodromHost = { attach, playerIdFor, memoryStore, memoryBoards };
})();
