// Общий код страниц каталога. Работает и с сервером (API), и как статика на GitHub Pages:
// если API недоступен, каталог берётся из games/catalog.json, а оценки и счётчики отключаются.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

  const CATEGORY_ICONS = {
    'Аркады': '🕹️', 'Головоломки': '🧩', 'Три в ряд': '💎', 'Казуальные': '🎈', 'Настольные': '♟️', 'Карточные': '🃏',
    'Стратегии': '🏰', 'Гонки': '🏎️', 'Симуляторы': '🛠️', 'Приключения': '🗺️', 'Спорт': '⚽', 'Викторины': '❓',
    'Обучающие': '📚', 'Для двоих': '👥', 'Кликеры': '👆', 'Прочее': '🎮',
  };
  const COVER_BG = ['#3b2f8f', '#14532d', '#7c2d12', '#134e4a', '#1e3a8a', '#701a75', '#713f12', '#1f2937'];
  const NEW_DAYS = 14;

  // Чистые адреса (/game/ogonek, /category/arkady) есть только у сервера: он всегда вставляет og:url.
  // Статическая версия на GitHub Pages живёт на старых game.html?id= и index.html?category=.
  const SLUG_MAP = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  // Та же функция — в server/slug.js.
  const slugify = (text) => [...String(text || '').toLowerCase()].map((c) => SLUG_MAP[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  const onServer = () => !!document.querySelector('meta[property="og:url"]');
  const gameUrl = (g) => (g.slug ? `/game/${encodeURIComponent(g.slug)}` : `game.html?id=${encodeURIComponent(g.id)}`);
  const catUrl = (c) => (onServer() ? `/category/${slugify(c)}` : `index.html?category=${encodeURIComponent(c)}`);
  const homeUrl = () => (onServer() ? '/' : 'index.html');
  const withParam = (url, kv) => url + (url.includes('?') ? '&' : '?') + kv;

  // Нормализованная игра: одинаковые поля для API и статического каталога.
  function fromApi(g) {
    return {
      ...g,
      live: true,
      src: `/play/${g.id}/`,
      cover_url: g.cover ? `/play/${g.id}/${encodeURIComponent(g.cover)}` : null,
      icon_url: g.icon ? `/play/${g.id}/${encodeURIComponent(g.icon)}` : null,
    };
  }
  function fromStatic(g) {
    return {
      ...g,
      live: false,
      src: `games/${g.id}/index.html`,
      cover_url: g.cover ? `games/${g.id}/${g.cover}` : null,
      icon_url: g.icon ? `games/${g.id}/${g.icon}` : null,
      likes: 0, dislikes: 0, plays: 0,
    };
  }

  let catalogPromise;
  function loadCatalog() {
    catalogPromise ??= fetch('/api/games')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(({ games }) => ({ live: true, games: games.map(fromApi) }))
      .catch(() => fetch('games/catalog.json').then((r) => r.json())
        .then(({ games }) => ({ live: false, games: games.map(fromStatic) })))
      .catch(() => ({ live: false, games: [] }));
    return catalogPromise;
  }

  function rating(g) {
    const total = (g.likes || 0) + (g.dislikes || 0);
    return total >= 3 ? Math.round((g.likes / total) * 100) : null;
  }
  // Демо-игры заводятся при каждом развёртывании — «новинками» они не считаются.
  const isNew = (g) => g.live && !g.demo && Date.now() - g.created_at < NEW_DAYS * 864e5;

  function coverHTML(g, i = 0) {
    const icon = CATEGORY_ICONS[g.genre] || '🎮';
    const bg = COVER_BG[[...String(g.id)].reduce((n, c) => n + c.charCodeAt(0), i) % COVER_BG.length];
    return `<div class="cover" style="background:${bg}">` +
      (g.cover_url ? `<img src="${esc(g.cover_url)}" alt="" loading="lazy" onerror="this.remove()">` : '') +
      `<span class="cover-icon" aria-hidden="true">${icon}</span>` +
      `<span class="age">${esc(g.age || '0+')}</span>` +
      (isNew(g) ? '<span class="flag">Новинка</span>' : '') + '</div>';
  }

  // Квадратная иконка для маленьких размеров. Нет иконки — центр обложки, нет обложки — значок категории.
  function iconHTML(g, cls = 'game-icon') {
    const icon = CATEGORY_ICONS[g.genre] || '🎮';
    const bg = COVER_BG[[...String(g.id)].reduce((n, c) => n + c.charCodeAt(0), 0) % COVER_BG.length];
    const src = g.icon_url || g.cover_url;
    return `<div class="${cls}" style="background:${bg}"><span aria-hidden="true">${icon}</span>` +
      (src ? `<img src="${esc(src)}" alt="" onerror="this.remove()">` : '') + '</div>';
  }

  function cardHTML(g, i) {
    const r = rating(g);
    return `<a class="card" href="${gameUrl(g)}">${coverHTML(g, i)}
      <div class="card-body"><b class="card-title">${esc(g.title)}</b>
      <span class="card-meta">${r !== null ? `<span class="score" title="Доля положительных оценок">👍 ${r}%</span>` : ''}
      <span>${esc(g.genre)}</span></span></div></a>`;
  }

  // Шапка: поиск на любой странице ведёт в каталог; на главной — фильтрует на месте.
  function initHeader({ onSearch } = {}) {
    const form = $('searchForm');
    const input = $('q');
    if (form && input) {
      input.value = new URLSearchParams(location.search).get('q') || '';
      form.onsubmit = (e) => {
        if (!onSearch) return; // обычный переход на index.html?q=
        e.preventDefault();
        onSearch(input.value.trim());
      };
      if (onSearch) {
        let t;
        input.oninput = () => { clearTimeout(t); t = setTimeout(() => onSearch(input.value.trim()), 200); };
      }
    }
    // «Войти» ведёт на вход и возвращает на эту же страницу; вошедшему — имя и ссылка на профиль.
    const login = $('login');
    if (login && window.IgrTheme) login.before(IgrTheme.button());
    metrika();
    if (login) login.href = `login.html?next=${encodeURIComponent(here())}`;
    me().then((user) => {
      if (user && login) {
        login.innerHTML = `${avatarHTML(user, 26)}<span class="user-name">${esc(user.name)}</span>`;
        login.classList.add('user-btn');
        login.href = 'account.html';
        login.setAttribute('aria-label', `Профиль: ${user.name}`);
        const chip = document.createElement('a');
        chip.className = 'coin-chip'; chip.id = 'coinChip'; chip.href = 'account.html#coins';
        (login.previousElementSibling?.classList.contains('theme-btn') ? login.previousElementSibling : login).before(chip);
        setCoins(user.coins);
        if (user.dailyBonus) claimDaily();
      }
    });
  }

  // Бонус за вход: раз в день забираем сами, при первом заходе на любую страницу.
  // Сумма растёт с серией дней подряд; страница профиля узнаёт о бонусе по событию igr:daily.
  async function claimDaily() {
    try {
      const r = await fetch('/api/me/coins/daily', { method: 'POST' });
      const data = await r.json();
      if (!r.ok) return;
      setCoins(data.coins);
      document.dispatchEvent(new CustomEvent('igr:daily', { detail: data }));
      if (!data.claimed) return;
      const n = data.streak?.streak || 1;
      toast(n > 1 ? `+${coinsText(data.claimed)} за вход, ${n} ${plural(n, ['день', 'дня', 'дней'])} подряд`
        : `+${coinsText(data.claimed)} — бонус за вход. Завтра будет больше`);
      // Новые достижения — следующей подсказкой, когда первая скроется.
      (data.achievements || []).forEach((a, i) => setTimeout(() => toast(`Достижение «${a.title}»: +${coinsText(a.coins)}`), 2700 * (i + 1)));
    } catch {}
  }

  // Ссылка-приглашение от друга (?invite=<код>): запоминаем на 30 дней, награды сервер выдаст после регистрации
  // и подтверждения почты. Первая ссылка не перезаписывается. Параметр убираем из адреса, чтобы он не расходился дальше.
  (function rememberInvite() {
    const params = new URLSearchParams(location.search);
    const code = params.get('invite');
    if (code === null) return;
    if (/^[A-Za-z0-9_-]{8}$/.test(code) && !/(?:^|;\s*)invite=/.test(document.cookie)) {
      document.cookie = `invite=${code}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    }
    params.delete('invite');
    history.replaceState(history.state, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
  })();
  const invited = () => /(?:^|;\s*)invite=[A-Za-z0-9_-]{8}(?:;|$)/.test(document.cookie);

  // Сколько осталось: «2 дня 5 часов», «3 часа 10 минут», «15 минут».
  function timeLeft(ms) {
    const min = Math.max(1, Math.ceil(ms / 6e4));
    const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
    const w = (n, forms) => (n ? `${n} ${plural(n, forms)}` : '');
    const H = ['час', 'часа', 'часов'], M = ['минута', 'минуты', 'минут'];
    return (d ? [w(d, ['день', 'дня', 'дней']), w(h, H)] : h ? [w(h, H), w(m, M)] : [w(m, M)]).filter(Boolean).join(' ');
  }

  // Аватарка: картинка или первая буква имени на цветном круге.
  const AVATAR_BG = ['#2E6BFF', '#F2434F', '#17B26A', '#8B5CF6', '#E8890C', '#0E9F9A', '#C2417B', '#475569'];
  function avatarHTML(u, size = 32) {
    const name = String(u?.name || '?').trim();
    if (u?.avatar) return `<img class="ava" src="${esc(u.avatar)}" width="${size}" height="${size}" alt="" loading="lazy">`;
    const bg = AVATAR_BG[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_BG.length];
    return `<span class="ava ava-letter" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px;background:${bg}" aria-hidden="true">${esc([...name][0].toUpperCase())}</span>`;
  }

  // ---------- монетки ----------
  const COIN_SVG = '<svg class="coin-ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#FFC531" stroke="#1C2140" stroke-width="1.6"/><circle cx="10" cy="10" r="5.2" fill="none" stroke="#1C2140" stroke-width="1.4"/></svg>';
  const plural = (n, [one, few, many]) => {
    const a = Math.abs(n) % 100, b = a % 10;
    return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  };
  const coinsText = (n) => `${fmt(n)} ${plural(n, ['монетка', 'монетки', 'монеток'])}`;
  function setCoins(n) {
    const chip = $('coinChip');
    if (!chip || typeof n !== 'number') return;
    chip.innerHTML = `${COIN_SVG}<span>${fmt(n)}</span>`;
    chip.title = `${coinsText(n)} — валюта Gamely: тратится в играх, пополняется в профиле`;
    chip.setAttribute('aria-label', `Монетки: ${fmt(n)}`);
  }

  // Окно поверх страницы. buttons: [{ text, value, cls, href }]; Esc и клик мимо — null.
  // В полноэкранном режиме окно кладётся внутрь развёрнутого элемента, иначе его не будет видно.
  function dialog({ title, html, buttons, body }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
        <h3 id="dlgTitle">${esc(title)}</h3>${html || ''}<div class="modal-acts"></div></div>`;
      const card = wrap.firstElementChild;
      if (body) card.insertBefore(body, card.lastElementChild);
      const back = document.activeElement;
      const done = (v) => { wrap.remove(); removeEventListener('keydown', onKey, true); back?.focus?.(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      addEventListener('keydown', onKey, true);
      wrap.onclick = (e) => { if (e.target === wrap) done(null); };
      for (const b of buttons) {
        const el = document.createElement(b.href ? 'a' : 'button');
        el.className = `btn ${b.cls || ''}`;
        el.textContent = b.text;
        if (b.href) { el.href = b.href; el.target = '_blank'; el.rel = 'noopener'; el.onclick = () => done(b.value ?? null); }
        else { el.type = 'button'; el.onclick = () => done(b.value); }
        card.querySelector('.modal-acts').append(el);
      }
      (document.fullscreenElement || document.body).append(wrap);
      (card.querySelector('textarea') || card.querySelector('.modal-acts .primary') || card.querySelector('.modal-acts > *:last-child'))?.focus();
    });
  }

  // Настройки сервера: контакты владельца, счётчик, реклама. Без сервера — пусто.
  let configPromise;
  function config() {
    configPromise ??= fetch('/api/config').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    return configPromise;
  }

  // Контакты на страницах «Контакты», «Правила», «Конфиденциальность»: элементы с data-site.
  function fillSite() {
    config().then(({ site }) => {
      if (!site) return;
      for (const el of document.querySelectorAll('[data-site]')) {
        const key = el.dataset.site;
        const value = site[key];
        if (!value) continue;
        if (key === 'email') { el.textContent = value; el.href = `mailto:${value}`; }
        else if (key === 'telegram') { el.textContent = `@${value}`; el.href = `https://t.me/${encodeURIComponent(value)}`; }
        else el.textContent = value;
      }
    });
  }

  // Яндекс Метрика — если номер счётчика задан в .env (METRIKA_ID).
  function metrika() {
    config().then(({ site }) => {
      const id = site && site.metrika;
      if (!id || window.ym) return;
      window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
      window.ym.l = Date.now();
      const s = document.createElement('script');
      s.async = true; s.src = 'https://mc.yandex.ru/metrika/tag.js';
      document.head.append(s);
      window.ym(Number(id), 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
    });
  }

  // Адрес текущей страницы для возврата после входа: чистый путь или имя .html-файла.
  const here = () => (/\.html$|^\/$/.test(location.pathname) || !onServer()
    ? (location.pathname.split('/').pop() || 'index.html') : location.pathname) + location.search;

  // Текущий пользователь (или null). Без сервера — тоже null.
  let mePromise;
  function me() {
    mePromise ??= fetch('/api/me').then((r) => (r.ok ? r.json() : { user: null })).then(({ user }) => user || null).catch(() => null);
    return mePromise;
  }

  // Куда вернуть после входа: только страница этого же сайта, никаких внешних адресов.
  function safeNext(value, fallback = 'account.html') {
    return /^(?:[\w-]+\.html|\/(?:(?:game|category)\/[a-z0-9-]+|[\w-]*))(\?[^#]*)?$/.test(value || '') ? value : fallback;
  }

  function toast(msg) {
    let t = $('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.append(t); }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = 'none'; }, 2500);
  }

  // Поиск без учёта регистра и «ё».
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const matches = (g, q) => !q || norm(`${g.title} ${g.genre} ${g.author} ${(g.tags || []).join(' ')} ${g.short_description || ''} ${g.description || ''}`).includes(norm(q));

  window.Igr = {
    $, esc, fmt, me, safeNext, slugify, gameUrl, catUrl, homeUrl, withParam, config, fillSite, fromApi, loadCatalog, rating, isNew, cardHTML, coverHTML, iconHTML, initHeader,
    toast, matches, CATEGORY_ICONS, COIN_SVG, plural, coinsText, setCoins, dialog, avatarHTML, timeLeft, invited,
  };
})();
