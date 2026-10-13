// Сторона площадки для Игродром SDK (public/sdk/v1.js).
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
   */
  function attach(frame, { gameId, live, player = async () => null, onEvent = () => {}, ads = NO_ADS, onAd = () => {} }) {
    const store = live ? serverStore(gameId) : browserStore(gameId);
    // События площадки для игры: пауза на время рекламы и продолжение.
    const push = (event) => frame.contentWindow?.postMessage({ protocol: PROTOCOL, event }, '*');

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
        default: throw new Error(`Неизвестный запрос: ${m.type}`);
      }
    }

    function onMessage(e) {
      if (e.source !== frame.contentWindow) return;
      const m = e.data;
      if (!m || m.protocol !== PROTOCOL || typeof m.id !== 'number') return;
      // Песочница даёт игре «пустой» origin, поэтому адресат ответа — '*', но окно-получатель — только наш iframe.
      const reply = (msg) => e.source.postMessage({ protocol: PROTOCOL, id: m.id, ...msg }, '*');
      handle(m).then((result) => reply({ ok: true, result }), (err) => reply({ ok: false, error: err.message }));
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

  window.IgrodromHost = { attach, playerIdFor };
})();
