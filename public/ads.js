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

  // ---------- свои вставки ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let catalog = null;

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
  // За награду ждём дольше: своей заставки на этот случай больше нет (решение пользователя 31.10.2026),
  // а на телефоне ответ VK бывает и через 10 с.
  const VK_WAIT_MS = 8000, VK_REWARD_WAIT_MS = 15000, VK_MAX_MS = 45000;
  // Показ VK — рамка или слой поверх страницы, которые стали видны после запроса и закрывают заметную часть
  // экрана (от 10 %). Смотрим не «новый элемент», а «стал видимым»: VK со второго показа переиспользует уже
  // вставленную рамку, и проверка «рамка новая» такой показ не замечала — игра не получала shown и не давала очко.
  // Не считаются: баннер под игрой (.ad-banner), наши окна (.ad-test) и всё, что было видно до запроса.
  function vkWatcher() {
    const candidates = () => [...document.querySelectorAll('iframe, ins.mrg-tag, ins.mrg-tag > *'), ...document.body.children]
      .filter((e) => e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE');
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
    const before = new Set(candidates().filter(big));
    // Слой страницы засчитываем, только если он лежит поверх (fixed/absolute) — иначе это обычная вёрстка.
    const overlay = (e) => e.tagName === 'IFRAME' || e.closest('ins.mrg-tag') || ['fixed', 'absolute'].includes(getComputedStyle(e).position);
    return () => candidates().find((e) => !before.has(e) && big(e) && overlay(e)) || null;
  }
  function vkFullscreen(slot, watch, waitMs = VK_WAIT_MS) {
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
        else if (Date.now() - started > waitMs) done('none');
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

  // Пока VK думает — небольшое окно «Загружаем рекламу», чтобы игрок не смотрел на замершую игру. Пришла реклама —
  // окно прячется под ней; рекламы нет — пишет об этом и закрывается само. Это не реклама и не замена ей.
  function waitNote() {
    const el = document.createElement('div');
    el.className = 'ad-test ad-wait';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="ad-test-card"><p class="ad-test-title">Загружаем рекламу</p><p class="ad-test-sub">Обычно это несколько секунд.</p></div>';
    document.body.append(el);
    return {
      hide() { el.style.display = 'none'; },
      remove() { el.remove(); },
      nothing() {
        el.style.display = '';
        el.querySelector('.ad-test-title').textContent = 'Сейчас рекламы нет';
        el.querySelector('.ad-test-sub').textContent = 'Награду за неё дать не можем. Попробуйте чуть позже.';
        return new Promise((r) => setTimeout(() => { el.remove(); r(); }, 2200));
      },
    };
  }
  const vk = {
    async fullscreen() {
      return (await vkFullscreen((config.vk || {}).fullscreenSlot, vkWatcher())) === 'closed';
    },
    // true — реклама VK показана и закрыта, false — рекламы нет, null — блок за награду не настроен.
    async rewarded() {
      const slot = (config.vk || {}).rewardedSlot;
      if (!slot) return null;
      const note = waitNote();
      const watch = vkWatcher();
      const r = await vkFullscreen(slot, () => { const ad = watch(); if (ad) note.hide(); return ad; }, VK_REWARD_WAIT_MS);
      if (r === 'closed') { note.remove(); return true; }
      await note.nothing();
      return false;
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
     * Своей заставки «Gamely советует» больше нет (решение пользователя 31.10.2026: она путала игроков и мешала
     * засчитывать показы VK). Рекламы у сети сейчас нет — награды нет. Реклама на сайте не подключена вовсе
     * (провайдер none или блок за награду не настроен) — награда сразу, иначе кнопки в играх не работали бы.
     */
    async rewarded(hooks = {}) {
      await ready;
      await leaveFrameFullscreen();
      const p = PROVIDERS[config.provider];
      if (busy) return { rewarded: false, shown: false };
      if (!p || !p.rewarded) return { rewarded: true, shown: false };
      busy = true;
      hooks.open?.();
      try {
        const result = await p.rewarded().catch(() => false);
        if (result === null) return { rewarded: true, shown: false };
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
