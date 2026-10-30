// Реклама на странице игры. Игра просит её через SDK (sdk.ads.* или ysdk.adv.*),
// а показывает площадка — поэтому сеть подключается здесь один раз для всех игр.
//
// Сеть выбирается на сервере (.env → GET /api/config):
//   none   — рекламы нет: полноэкранная не показывается, награда выдаётся сразу;
//   test   — тестовая реклама, чтобы проверить всё до одобрения сети;
//   yandex — Рекламная сеть Яндекса (Ya.Context.AdvManager);
//   vk     — Рекламная сеть VK: баннер и полноэкранные блоки (за награду — отдельный полноэкранный блок);
//   google — Google H5 Games Ads (adBreak).
// Частота: полноэкранная не чаще раза в fullscreenInterval секунд и не в первые firstDelay секунд игры.
(function () {
  const NONE = { provider: 'none', banner: 'none', fullscreenInterval: 60, firstDelay: 30 };
  const SAFETY_MS = 90 * 1000; // если сеть не сообщила о закрытии, через это время игра продолжится

  let config = NONE;
  const ready = fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => { if (c && c.ads) config = { ...NONE, ...c.ads }; })
    .catch(() => {});

  let startedAt = 0;
  let lastFullscreen = 0;
  let busy = false;

  const isTouch = () => matchMedia('(pointer: coarse)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const loaded = {};
  function loadScript(src, attrs = {}) {
    loaded[src] ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
      s.onload = resolve; s.onerror = () => reject(new Error(`Не загрузился ${src}`));
      document.head.append(s);
    });
    return loaded[src];
  }
  // Обещание, которое гарантированно завершится: сеть может не вызвать ни один колбэк.
  function settle(run) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
      const t = setTimeout(() => finish(null), SAFETY_MS);
      try { run(finish); } catch { finish(null); }
    });
  }

  // ---------- тестовая реклама ----------
  function testOverlay({ rewarded }) {
    return new Promise((resolve) => {
      const SEC = 5;
      const el = document.createElement('div');
      el.className = 'ad-test';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Реклама');
      el.innerHTML = `<div class="ad-test-card"><span class="ad-test-label">Реклама, тестовый показ</span>
        <p class="ad-test-title">${rewarded ? 'Реклама за награду' : 'Полноэкранная реклама'}</p>
        <p class="ad-test-sub">Здесь будет реклама сети, когда её подключат. ${rewarded ? 'Досмотрите, чтобы получить награду.' : ''}</p>
        <button class="btn" type="button" disabled>Закрыть через ${SEC}</button></div>`;
      document.body.append(el);
      const btn = el.querySelector('button');
      let left = SEC;
      const tick = setInterval(() => {
        left -= 1;
        if (left > 0) { btn.textContent = `Закрыть через ${left}`; return; }
        clearInterval(tick);
        btn.disabled = false; btn.textContent = rewarded ? 'Получить награду' : 'Закрыть';
        btn.focus();
      }, 1000);
      // Закрыли раньше времени (Esc) — награды нет, как в настоящих сетях.
      const close = (watched) => { clearInterval(tick); el.remove(); removeEventListener('keydown', onKey); resolve(watched); };
      const onKey = (e) => { if (e.key === 'Escape') close(left <= 0); };
      addEventListener('keydown', onKey);
      btn.onclick = () => close(true);
    });
  }

  // ---------- своя заставка ----------
  // Реклама за награду, а у сети рекламы нет (решение пользователя 27.10.2026): 5 секунд показываем другую игру
  // каталога, потом награда. Игрок не получает награду «просто так», а каталог рекламирует сам себя.
  // Каталог не загрузился — награда сразу, как раньше.
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // Вошедшему с невыполненным заданием «подпишитесь на канал» каждый второй раз показываем задание (server/tgtasks.js).
  let catalog = null;
  let tasks = null;
  // watch — для VK: если реклама сети всё-таки появилась поверх нашей заставки (ответ пришёл поздно),
  // заставка прячется, ждёт закрытия рекламы и даёт награду: игрок уже посмотрел рекламу.
  // Ответ — { watched, network }: network — это был показ сети, а не наша заставка (игры засчитывают только такие;
  // на телефоне реклама VK часто приходит позже 8 секунд, и без этого очко за неё не давалось).
  async function houseAd(watch) {
    catalog ??= fetch('/api/games').then((r) => r.json()).then((d) => d.games || []).catch(() => []);
    tasks ??= fetch('/api/tasks').then((r) => r.json()).then((d) => (d.enabled ? d.tasks.filter((t) => !t.status) : [])).catch(() => []);
    const open = window.Igr && (await window.Igr.me().catch(() => null)) ? await tasks : [];
    const here = decodeURIComponent(location.pathname.split('/game/')[1] || '');
    const pool = (await catalog).filter((g) => g.cover && g.slug && g.slug !== here);
    const task = open.length && (!pool.length || Math.random() < 0.5) ? open[Math.floor(Math.random() * open.length)] : null;
    if (!task && !pool.length) return { watched: true, network: false };
    const g = pool[Math.floor(Math.random() * pool.length)];
    return new Promise((resolve) => {
      const SEC = 5;
      const el = document.createElement('div');
      el.className = 'ad-test ad-house';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', task ? 'Задание Gamely' : 'Игра из каталога Gamely');
      el.innerHTML = task ? `<div class="ad-test-card"><span class="ad-test-label">${task.advertiser ? `Реклама. ${esc(task.advertiser)}${task.erid ? `. erid: ${esc(task.erid)}` : ''}` : 'Задание Gamely'}</span>
        <span class="ad-house-tg">${window.Igr.taskIcon}</span>
        <p class="ad-test-title">${esc(task.title)}</p>
        <p class="ad-test-sub">Подпишитесь на канал в Telegram и получите +${task.reward} монеток. Подтвердить подписку — в профиле, раздел «Задания».</p>
        <div class="ad-house-acts"><a class="btn" href="${esc(task.link)}" target="_blank" rel="noopener">Подписаться</a>
          <button class="btn primary" type="button" disabled>Награда через ${SEC}</button></div></div>`
      : `<div class="ad-test-card"><span class="ad-test-label">Gamely советует</span>
        <a class="ad-house-cover" href="/game/${encodeURIComponent(g.slug)}" target="_blank" rel="noopener">
          <img src="/play/${encodeURIComponent(g.id)}/${encodeURIComponent(g.cover)}" alt=""></a>
        <p class="ad-test-title">${esc(g.title)}</p>
        ${g.short_description ? `<p class="ad-test-sub">${esc(g.short_description)}</p>` : ''}
        <div class="ad-house-acts"><a class="btn" href="/game/${encodeURIComponent(g.slug)}" target="_blank" rel="noopener">Открыть игру</a>
          <button class="btn primary" type="button" disabled>Награда через ${SEC}</button></div></div>`;
      document.body.append(el);
      const btn = el.querySelector('button');
      let left = SEC;
      const tick = setInterval(() => {
        left -= 1;
        if (left > 0) { btn.textContent = `Награда через ${left}`; return; }
        clearInterval(tick);
        btn.disabled = false; btn.textContent = 'Получить награду';
        btn.focus();
      }, 1000);
      let seen = false;
      const spy = watch ? setInterval(() => {
        const ad = watch();
        if (ad) { seen = true; el.style.display = 'none'; } else if (seen) close(true);
      }, 400) : 0;
      const close = (watched) => { clearInterval(tick); clearInterval(spy); el.remove(); removeEventListener('keydown', onKey); resolve({ watched, network: seen }); };
      const onKey = (e) => { if (e.key === 'Escape' && !seen) close(left <= 0); };
      addEventListener('keydown', onKey);
      btn.onclick = () => close(true);
    });
  }

  // Свой баннер под игрой, когда у сети нет рекламы: другая игра каталога, а не пустая полоса.
  async function houseBanner(el) {
    catalog ??= fetch('/api/games').then((r) => r.json()).then((d) => d.games || []).catch(() => []);
    const here = decodeURIComponent(location.pathname.split('/game/')[1] || '');
    const pool = (await catalog).filter((g) => g.cover && g.slug && g.slug !== here);
    if (!pool.length) { el.classList.add('hidden'); return; }
    const g = pool[Math.floor(Math.random() * pool.length)];
    const href = `/game/${encodeURIComponent(g.slug)}`;
    el.innerHTML = `<a class="ad-house-strip" href="${href}">
      <img src="/play/${encodeURIComponent(g.id)}/${encodeURIComponent(g.cover)}" alt="" loading="lazy">
      <span class="ad-house-strip-tx"><small>Gamely советует</small><b>${esc(g.title)}</b>${g.short_description ? `<span>${esc(g.short_description)}</span>` : ''}</span>
      <span class="btn primary sm">Играть</span></a>`;
  }

  // ---------- Рекламная сеть Яндекса ----------
  // Код блоков сверьте с кабинетом partner.yandex.ru: там показан точный вызов для каждого блока.
  function yandexRender(params) {
    window.yaContextCb = window.yaContextCb || [];
    return loadScript('https://yandex.ru/ads/system/context.js').then(() => settle((finish) => {
      window.yaContextCb.push(() => window.Ya.Context.AdvManager.render({
        ...params,
        onClose: () => finish('closed'),
        onError: () => finish(null),
      }));
    }));
  }
  const yandex = {
    async fullscreen() {
      const y = config.yandex || {};
      const blockId = isTouch() ? y.fullscreenTouch || y.fullscreenDesktop : y.fullscreenDesktop || y.fullscreenTouch;
      if (!blockId) return false;
      return (await yandexRender({ blockId, type: 'fullscreen', platform: isTouch() ? 'touch' : 'desktop' }).catch(() => null)) === 'closed';
    },
    async rewarded() {
      const y = config.yandex || {};
      const blockId = isTouch() ? y.rewardedTouch || y.rewardedDesktop : y.rewardedDesktop || y.rewardedTouch;
      if (!blockId) return null; // формат не подключён — как без рекламы
      let rewarded = false;
      await yandexRender({ blockId, type: 'rewarded', platform: isTouch() ? 'touch' : 'desktop', onRewarded: (ok) => { rewarded = !!ok; } })
        .catch(() => null);
      return rewarded;
    },
    banner(el) {
      const blockId = (config.yandex || {}).banner;
      if (!blockId) return false;
      el.innerHTML = `<div id="yandex_rtb_${blockId}"></div>`;
      window.yaContextCb = window.yaContextCb || [];
      loadScript('https://yandex.ru/ads/system/context.js').then(() => window.yaContextCb.push(() =>
        window.Ya.Context.AdvManager.render({ blockId, renderTo: `yandex_rtb_${blockId}` }))).catch(() => {});
      return true;
    },
  };

  // ---------- Рекламная сеть VK ----------
  // Полноэкранный блок на сайте — тот же тег mrg-tag; событий «показан/закрыт» у него нет,
  // поэтому следим за рекламными фреймами: появился — показ идёт, все пропали — закрыли.
  // Если за VK_WAIT_MS ничего не появилось — рекламы нет.
  const VK_WAIT_MS = 8000, VK_MAX_MS = 45000;
  // Показ VK — новая рамка или новый слой поверх страницы, появившиеся после запроса, видимые и на заметную
  // часть экрана (от 10 %). Не считаются: рамки баннера под игрой (.ad-banner) — он догружается когда угодно,
  // служебные рамки 1×1 тега VK и наши заставки (.ad-test). Раньше ловили только рамку на 35 % экрана: окно VK
  // на компьютере бывало меньше, сайт решал, что рекламы нет, и поверх выводил «Gamely советует».
  function vkWatcher() {
    const frames = new Set(document.querySelectorAll('iframe'));
    const layers = new Set(document.body.children);
    const big = (e) => {
      if (!e.isConnected || e.closest('.ad-banner, .ad-test')) return false;
      const r = e.getBoundingClientRect();
      if (r.width * r.height < innerWidth * innerHeight * 0.1) return false;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
      for (let x = e; x && x !== document.documentElement; x = x.parentElement) {
        const st = getComputedStyle(x);
        if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      }
      return true;
    };
    return () => [...document.querySelectorAll('iframe')].find((f) => !frames.has(f) && big(f))
      || [...document.body.children].find((e) => !layers.has(e) && e.tagName !== 'INS' && e.tagName !== 'SCRIPT'
        && ['fixed', 'absolute'].includes(getComputedStyle(e).position) && big(e))
      || null;
  }
  function vkFullscreen(slot, watch) {
    if (!slot) return Promise.resolve(null);
    return loadScript('https://ad.mail.ru/static/ads-async.js').then(() => settle((finish) => {
      const ins = document.createElement('ins');
      ins.className = 'mrg-tag';
      ins.setAttribute('data-ad-client', `ad-${slot}`);
      ins.setAttribute('data-ad-slot', slot);
      ins.setAttribute('data-ad_query', `dl=${encodeURIComponent(location.href)}`);
      document.body.append(ins);
      const started = Date.now();
      let shown = false, shownAt = 0;
      // Тег не убираем, если рекламы не дождались: ответ VK может прийти позже, и тогда окно появится —
      // его заметит watch (заставка за награду) или оно просто закроется само.
      const done = (result) => { clearInterval(poll); setTimeout(() => ins.remove(), result === 'none' ? 60000 : 0); finish(result); };
      const poll = setInterval(() => {
        if (watch()) { if (!shown) shownAt = Date.now(); shown = true; }
        else if (shown) done('closed');
        else if (Date.now() - started > VK_WAIT_MS) done('none');
        // Закрытие так и не заметили, а показ шёл: через VK_MAX_MS считаем рекламу досмотренной, не держим игру.
        if (shown && Date.now() - shownAt > VK_MAX_MS) done('closed');
      }, 400);
      (window.MRGtag = window.MRGtag || []).push({ onNoAds: () => { if (!shown) done('none'); } });
    })).catch(() => 'none');
  }

  // Игра сама развернула свою рамку во весь экран (screen.fullscreen в Яндекс-SDK, кнопка Unity): тогда браузер
  // показывает только её, а реклама сетей и наши заставки — в body и не видны. Перед показом выходим из такого режима.
  // Если развёрнута вся страница (кнопка «Во весь экран» на сайте), реклама и так видна — режим не трогаем.
  async function leaveFrameFullscreen() {
    const el = document.fullscreenElement;
    if (el && el !== document.documentElement && document.exitFullscreen) await document.exitFullscreen().catch(() => {});
  }

  let vkLate = null; // наблюдатель последнего запроса за награду, на случай позднего показа
  const vk = {
    async fullscreen() {
      return (await vkFullscreen((config.vk || {}).fullscreenSlot, vkWatcher())) === 'closed';
    },
    async rewarded() {
      vkLate = vkWatcher();
      const r = await vkFullscreen((config.vk || {}).rewardedSlot, vkLate);
      // Блок не настроен или рекламы сейчас нет — своя заставка (она уступит место поздней рекламе VK).
      return r === 'closed' ? true : null;
    },
    banner(el) {
      const { bannerClient, bannerSlot } = config.vk || {};
      if (!bannerClient || !bannerSlot) return false;
      el.innerHTML = `<ins class="mrg-tag" style="display:inline-block;width:100%;max-width:728px;height:90px"
        data-ad-client="${bannerClient}" data-ad-slot="${bannerSlot}"></ins>`;
      const ins = el.firstElementChild;
      // Заполняемость у нового сайта низкая: если VK за 20 с ничего не поставил — свой баннер вместо пустоты.
      // Ответ VK на запрос баннера бывает и через 15 с, поэтому раньше не сдаёмся.
      const filled = () => [...ins.querySelectorAll('iframe, img')].some((x) => x.offsetHeight > 20);
      let tries = 0;
      const wait = setInterval(() => {
        if (!ins.isConnected || filled()) return clearInterval(wait);
        if (++tries >= 20) { clearInterval(wait); houseBanner(el); }
      }, 1000);
      loadScript('https://ad.mail.ru/static/ads-async.js').catch(() => { clearInterval(wait); houseBanner(el); });
      (window.MRGtag = window.MRGtag || []).push({});
      return true;
    },
  };

  // ---------- Google H5 Games Ads ----------
  function googleReady() {
    const g = config.google || {};
    if (!g.client) return null;
    window.adsbygoogle = window.adsbygoogle || [];
    window.adBreak = window.adConfig = window.adBreak || function (o) { window.adsbygoogle.push(o); };
    const attrs = { 'data-ad-client': g.client, crossorigin: 'anonymous' };
    if (g.test) attrs['data-adbreak-test'] = 'on';
    return loadScript(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(g.client)}`, attrs)
      .then(() => { window.adConfig({ preloadAdBreaks: 'on', sound: 'on' }); });
  }
  const google = {
    async fullscreen() {
      const r = googleReady();
      if (!r) return false;
      await r.catch(() => null);
      const info = await settle((finish) => window.adBreak({ type: 'next', name: 'igrodrom-next', adBreakDone: finish }));
      return !!info && info.breakStatus === 'viewed';
    },
    async rewarded() {
      const r = googleReady();
      if (!r) return null;
      await r.catch(() => null);
      let rewarded = false;
      await settle((finish) => window.adBreak({
        type: 'reward', name: 'igrodrom-reward',
        beforeReward: (showAdFn) => showAdFn(), // игрок уже согласился в игре
        adViewed: () => { rewarded = true; },
        adDismissed: () => { rewarded = false; },
        adBreakDone: finish,
      }));
      return rewarded;
    },
    banner(el) {
      const g = config.google || {};
      if (!g.client || !g.bannerSlot) return false;
      el.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${g.client}" data-ad-slot="${g.bannerSlot}"
        data-ad-format="horizontal" data-full-width-responsive="true"></ins>`;
      googleReady()?.then(() => window.adsbygoogle.push({})).catch(() => {});
      return true;
    },
  };

  const PROVIDERS = {
    test: {
      fullscreen: () => testOverlay({ rewarded: false }).then(() => true),
      rewarded: () => testOverlay({ rewarded: true }),
      banner(el) { el.innerHTML = '<div class="ad-test-banner">Реклама, тестовый баннер 728×90</div>'; return true; },
    },
    yandex, vk, google,
  };

  let noAdsUntil = 0;

  window.IgrAds = {
    ready,
    /** Игрок купил день без рекламы: до этого времени (мс) — без полноэкранной и баннеров. */
    setNoAds(until) { noAdsUntil = Number(until) || 0; },
    get noAds() { return Date.now() < noAdsUntil; },
    get config() { return config; },
    /** Игрок нажал «Играть»: отсюда считаются первые секунды без рекламы. */
    start() { startedAt = Date.now(); },

    /**
     * Полноэкранная реклама между уровнями. hooks.open() вызывается прямо перед показом —
     * площадка ставит игру на паузу. Возвращает { shown }.
     */
    async fullscreen(hooks = {}) {
      await ready;
      const p = PROVIDERS[config.provider];
      const now = Date.now();
      if (!p || !p.fullscreen || busy || Date.now() < noAdsUntil) return { shown: false };
      if (now - startedAt < config.firstDelay * 1000) return { shown: false };
      if (lastFullscreen && now - lastFullscreen < config.fullscreenInterval * 1000) return { shown: false };
      busy = true;
      hooks.open?.();
      await leaveFrameFullscreen();
      try {
        const shown = await p.fullscreen().catch(() => false);
        if (shown) lastFullscreen = Date.now();
        return { shown: !!shown };
      } finally { busy = false; }
    },

    /**
     * Реклама за награду — только по нажатию игрока. Возвращает { rewarded, shown }.
     * Сеть без такого формата (или без рекламы вообще): своя заставка с игрой каталога, потом награда.
     * Если реклама есть, но не догрузилась или игрок закрыл раньше — награды нет.
     */
    async rewarded(hooks = {}) {
      await ready;
      await leaveFrameFullscreen();
      const p = PROVIDERS[config.provider];
      if (busy) return { rewarded: false, shown: false };
      if (!p || !p.rewarded) {
        busy = true;
        hooks.open?.();
        try { return { rewarded: (await houseAd()).watched, shown: false }; } finally { busy = false; }
      }
      busy = true;
      hooks.open?.();
      try {
        const result = await p.rewarded().catch(() => false);
        if (result === null) {
          // Сеть не успела за VK_WAIT_MS — наша заставка; если реклама VK всё-таки пришла поверх неё, это показ сети.
          const h = await houseAd(p === vk ? vkLate : null);
          if (h.network) lastFullscreen = Date.now();
          return { rewarded: h.watched, shown: h.network };
        }
        // Досмотренная реклама за награду тоже сдвигает паузу перед следующей полноэкранной.
        if (result) lastFullscreen = Date.now();
        return { rewarded: !!result, shown: !!result };
      } finally { busy = false; }
    },

    /**
     * Тестовый показ без сети и без ограничений частоты — для тестового запуска в кабинете.
     * Возвращает true, если досмотрели (для полноэкранной — когда закрыли).
     */
    testShow({ rewarded = false } = {}) { return testOverlay({ rewarded }); },

    /** Баннер под игрой. Возвращает true, если блок поставлен. */
    async banner(el) {
      await ready;
      const p = PROVIDERS[config.banner];
      if (Date.now() < noAdsUntil) return false;
      return !!(p && p.banner && p.banner(el));
    },
  };
})();
