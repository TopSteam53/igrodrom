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
      el.innerHTML = `<div class="ad-test-card"><span class="ad-test-label">Реклама · тестовый показ</span>
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
  async function houseAd() {
    catalog ??= fetch('/api/games').then((r) => r.json()).then((d) => d.games || []).catch(() => []);
    tasks ??= fetch('/api/tasks').then((r) => r.json()).then((d) => (d.enabled ? d.tasks.filter((t) => !t.status) : [])).catch(() => []);
    const open = window.Igr && (await window.Igr.me().catch(() => null)) ? await tasks : [];
    const here = decodeURIComponent(location.pathname.split('/game/')[1] || '');
    const pool = (await catalog).filter((g) => g.cover && g.slug && g.slug !== here);
    const task = open.length && (!pool.length || Math.random() < 0.5) ? open[Math.floor(Math.random() * open.length)] : null;
    if (!task && !pool.length) return true;
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
      const close = (watched) => { clearInterval(tick); el.remove(); removeEventListener('keydown', onKey); resolve(watched); };
      const onKey = (e) => { if (e.key === 'Escape') close(left <= 0); };
      addEventListener('keydown', onKey);
      btn.onclick = () => close(true);
    });
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
  const VK_WAIT_MS = 6000;
  function vkFullscreen(slot) {
    if (!slot) return Promise.resolve(null);
    return loadScript('https://ad.mail.ru/static/ads-async.js').then(() => settle((finish) => {
      const before = new Set(document.querySelectorAll('iframe'));
      const ins = document.createElement('ins');
      ins.className = 'mrg-tag';
      ins.setAttribute('data-ad-client', `ad-${slot}`);
      ins.setAttribute('data-ad-slot', slot);
      ins.setAttribute('data-ad_query', `dl=${encodeURIComponent(location.href)}`);
      document.body.append(ins);
      const started = Date.now();
      let shown = false;
      const visible = (f) => f.isConnected && f.offsetWidth > 0 && f.offsetHeight > 0;
      const done = (result) => { clearInterval(poll); ins.remove(); finish(result); };
      const poll = setInterval(() => {
        const fresh = [...document.querySelectorAll('iframe')].filter((f) => !before.has(f) && visible(f));
        if (fresh.length) shown = true;
        else if (shown) done('closed');
        else if (Date.now() - started > VK_WAIT_MS) done('none');
      }, 400);
      (window.MRGtag = window.MRGtag || []).push({ onNoAds: () => { if (!shown) done('none'); } });
    })).catch(() => 'none');
  }

  const vk = {
    async fullscreen() {
      return (await vkFullscreen((config.vk || {}).fullscreenSlot)) === 'closed';
    },
    async rewarded() {
      const r = await vkFullscreen((config.vk || {}).rewardedSlot);
      // Блок не настроен или рекламы сейчас нет — награду даём, как без сети: игра не должна ломаться.
      return r === 'closed' ? true : null;
    },
    banner(el) {
      const { bannerClient, bannerSlot } = config.vk || {};
      if (!bannerClient || !bannerSlot) return false;
      el.innerHTML = `<ins class="mrg-tag" style="display:inline-block;width:100%;max-width:728px;height:90px"
        data-ad-client="${bannerClient}" data-ad-slot="${bannerSlot}"></ins>`;
      loadScript('https://ad.mail.ru/static/ads-async.js').catch(() => {});
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
      banner(el) { el.innerHTML = '<div class="ad-test-banner">Реклама · тестовый баннер 728×90</div>'; return true; },
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
      const p = PROVIDERS[config.provider];
      if (busy) return { rewarded: false, shown: false };
      if (!p || !p.rewarded) {
        busy = true;
        hooks.open?.();
        try { return { rewarded: await houseAd(), shown: false }; } finally { busy = false; }
      }
      busy = true;
      hooks.open?.();
      try {
        const result = await p.rewarded().catch(() => false);
        if (result === null) return { rewarded: await houseAd(), shown: false };
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
