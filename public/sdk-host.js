// Сторона площадки для Игродром SDK (public/sdk/v1.js).
// Подключается на странице игры и отвечает на запросы игры из её iframe.
//
// Безопасность: принимаем сообщения только от своего iframe (event.source), а id игры берём
// со страницы, не из сообщения — игра не может прочитать или затереть сохранение другой игры.
(function () {
  const PROTOCOL = 'igrodrom-sdk';
  const MAX_SAVE_BYTES = 64 * 1024;

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

  /** Начать обслуживать игру в iframe. Вызывать до того, как iframe начнёт загружаться. */
  function attach(frame, { gameId, live }) {
    const store = live ? serverStore(gameId) : browserStore(gameId);

    async function handle(m) {
      switch (m.type) {
        case 'init': return { gameId, storage: store.kind, lang: 'ru', sdk: 1 };
        case 'data.get': return store.get();
        case 'data.set': {
          const json = m.payload;
          if (typeof json !== 'string') throw new Error('Некорректное сохранение');
          if (new TextEncoder().encode(json).length > MAX_SAVE_BYTES) throw new Error('Сохранение больше 64 КБ');
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

  window.IgrodromHost = { attach };
})();
