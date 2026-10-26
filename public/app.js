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
  const devUrl = (id) => (onServer() ? `/developer/${encodeURIComponent(id)}` : `developer.html?id=${encodeURIComponent(id)}`);
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

  // Маленькая плитка: иконка и название в две строки — для ленты «Продолжить играть».
  function miniHTML(g) {
    return `<a class="mini" href="${gameUrl(g)}">${iconHTML(g)}<span class="mini-title">${esc(g.title)}</span></a>`;
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

  // Аватарка: картинка или первая буква имени на цветном круге. С рамкой из витрины (u.frame) — тот же размер
  // снаружи: сама аватарка уменьшается до 78 %, рамка рисуется в оставшемся кольце, соседи не сдвигаются.
  const AVATAR_BG = ['#2E6BFF', '#F2434F', '#17B26A', '#8B5CF6', '#E8890C', '#0E9F9A', '#C2417B', '#475569'];
  function avatarHTML(u, size = 32) {
    const art = FRAME_ART[u?.frame];
    const fx = FRAME_FX[u?.frame];
    const s = art || fx ? Math.round(size * 0.78) : size;
    const name = String(u?.name || '?').trim();
    let ava;
    if (u?.avatar) ava = `<img class="ava" src="${esc(u.avatar)}" width="${s}" height="${s}" alt="" loading="lazy">`;
    else {
      const bg = AVATAR_BG[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_BG.length];
      ava = `<span class="ava ava-letter" style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.45)}px;background:${bg}" aria-hidden="true">${esc([...name][0].toUpperCase())}</span>`;
    }
    // Анимированная рамка: слои под аватаркой (кольцо, свечение) и над ней (корона), --s — размер для свечения.
    if (fx) return `<span class="ava-fr fx-${u.frame}" style="width:${size}px;height:${size}px;--s:${size}px">${fx.under || ''}${ava}${fx.over || ''}</span>`;
    return art ? `<span class="ava-fr" style="width:${size}px;height:${size}px">${ava}<svg viewBox="0 0 100 100" aria-hidden="true">${art}</svg></span>` : ava;
  }

  // Рамки витрины (server/shop.js, FRAMES). Круг 100×100: аватарка занимает r = 39, рамка — кольцо от 39 до 50.
  // Цвета — токены темы, поэтому рамки сами подстраиваются под тёмную тему.
  const FRAME_ART = (() => {
    const rad = (d) => (d * Math.PI) / 180;
    const at = (deg, r) => [50 + r * Math.cos(rad(deg)), 50 + r * Math.sin(rad(deg))];
    const n = (v) => +v.toFixed(2);
    const ring = (r, w, color, extra = '') => `<circle cx="50" cy="50" r="${r}" fill="none" style="stroke:var(${color})" stroke-width="${w}"${extra}/>`;
    const star = (cx, cy, R) => `<path style="fill:var(--start);stroke:var(--navy)" stroke-width="1.3" stroke-linejoin="round" d="M${Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 ? R * 0.46 : R;
      return `${n(cx + r * Math.cos(rad(-90 + i * 36)))} ${n(cy + r * Math.sin(rad(-90 + i * 36)))}`;
    }).join('L')}Z"/>`;
    // Пиксели: клетки сетки 20×20, чей центр попадает в кольцо.
    const cell = 100 / 20;
    let pixels = '';
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      const d = Math.hypot((x + 0.5) * cell - 50, (y + 0.5) * cell - 50);
      if (d > 41 && d < 49) pixels += `M${n(x * cell)} ${n(y * cell)}h${cell}v${cell}h-${cell}z`;
    }
    // Лавры: две ветки от низа к верху, листья попеременно снаружи и внутри.
    const leaf = (deg, side) => {
      const [x, y] = at(deg, side ? 46.4 : 43.2);
      const rot = deg + 90 + (side ? -28 : 28);
      return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="6.4" ry="2.7" transform="rotate(${n(rot)} ${n(x)} ${n(y)})"/>`;
    };
    let branch = '';
    for (let i = 0; i < 9; i++) branch += leaf(106 + i * 15, i % 2);
    const mirror = (svg) => `<g transform="matrix(-1 0 0 1 100 0)">${svg}</g>`;
    return {
      dashed: ring(45, 5, '--a', ' stroke-dasharray="8.84 5.3"'),
      double: ring(47.4, 3.2, '--y') + ring(41.4, 2, '--y'),
      buttons: ring(45, 2.6, '--ink-2') + [['--y', -90], ['--b', 0], ['--x', 90], ['--a', 180]].map(([c, d]) => {
        const [x, y] = at(d, 44.5);
        return `<circle cx="${n(x)}" cy="${n(y)}" r="6.6" style="fill:var(${c});stroke:var(--panel)" stroke-width="1.8"/>`;
      }).join(''),
      pixel: `<path style="fill:var(--b)" shape-rendering="crispEdges" d="${pixels}"/>`,
      stars: ring(45, 2.6, '--start') + [-90, -18, 54, 126, 198].map((d) => star(...at(d, 44.5), 7.4)).join(''),
      laurel: `<g style="fill:var(--x)">${branch}${mirror(branch)}</g>`,
      gold: ring(45, 9, '--start') + ring(45, 9, '--start-deep', ' stroke-dasharray="1.6 2.327"')
        + ring(40.3, 1.5, '--navy') + ring(49.3, 1.5, '--navy'),
    };
  })();

  // Анимированные рамки (дорогие в витрине). Слои: .fxl.ring — кольцо из CSS-градиента (маска оставляет кольцо 39–50),
  // .fxl.glow — свечение тенью, SVG 100×100 — детали. Двигаются только transform и opacity (style.css, .fx-*);
  // при «уменьшить движение» всё стоит, а рамка остаётся красивой и без движения.
  // Цвета здесь фиксированные, а не токены: эффект должен выглядеть одинаково в обеих темах.
  const FRAME_FX = (() => {
    const rad = (d) => (d * Math.PI) / 180;
    const at = (deg, r) => [50 + r * Math.cos(rad(deg)), 50 + r * Math.sin(rad(deg))];
    const n = (v) => +v.toFixed(2);
    const svg = (body, cls = '') => `<svg class="fxl${cls}" viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;
    const RING = '<i class="fxl ring"></i>', GLOW = '<i class="fxl glow"></i>';
    const dl = (s) => ` style="animation-delay:-${n(s)}s"`;
    const spark = (x, y, r, d, c = '#fff') => `<path class="tw"${dl(d)} fill="${c}" d="M${n(x)} ${n(y - r)}Q${n(x + r * 0.2)} ${n(y - r * 0.2)} ${n(x + r)} ${n(y)}Q${n(x + r * 0.2)} ${n(y + r * 0.2)} ${n(x)} ${n(y + r)}Q${n(x - r * 0.2)} ${n(y + r * 0.2)} ${n(x - r)} ${n(y)}Q${n(x - r * 0.2)} ${n(y - r * 0.2)} ${n(x)} ${n(y - r)}Z"/>`;
    const heart = 'M0 3.6C-1.2 2.6-5 0-5-2.8-5-4.6-3.6-5.8-2.2-5.8-1.2-5.8-.4-5.2 0-4.4.4-5.2 1.2-5.8 2.2-5.8 3.6-5.8 5-4.6 5-2.8 5 0 1.2 2.6 0 3.6Z';
    const blossom = (deg) => {
      const [x, y] = at(deg, 45);
      const petals = [0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-2.5" rx="2.1" ry="2.9" transform="rotate(${a})"/>`).join('');
      return `<g transform="translate(${n(x)} ${n(y)}) rotate(${deg})"><g fill="#FFB7D0" stroke="#FF8FB8" stroke-width=".5">${petals}</g><circle r="1.3" fill="#FFD23F"/></g>`;
    };
    // Молния: ломаная вдоль кольца, радиус прыгает между 41 и 49.
    const zig = (from, len, seed) => Array.from({ length: 9 }, (_, i) => {
      const r = i % 2 ? 41.5 + ((seed + i * 7) % 3) : 48 - ((seed + i * 5) % 3);
      return at(from + (len * i) / 8, r).map(n).join(' ');
    }).join(' ');
    const gem = (deg, c, i) => {
      const [x, y] = at(deg, 45);
      return `<circle cx="${n(x)}" cy="${n(y)}" r="3.3" fill="${c}" stroke="#8A5A00" stroke-width=".8"/><circle cx="${n(x - 1)}" cy="${n(y - 1)}" r="1" fill="#fff" opacity=".85"/>${spark(x + 1.6, y - 1.6, 3.2, i * 0.45)}`;
    };
    return {
      hearts: {
        under: GLOW + svg(`<circle cx="50" cy="50" r="45" fill="none" stroke="#FF5C8A" stroke-width="2.6"/>`),
        over: svg(`<g class="spin">${[0, 60, 120, 180, 240, 300].map((a, i) => {
          const [x, y] = at(a - 90, 45);
          return `<g transform="translate(${n(x)} ${n(y)})"><path class="beat"${dl(i * 0.2)} d="${heart}" fill="#FF4D7E" stroke="#fff" stroke-width=".9"/></g>`;
        }).join('')}</g>`),
      },
      neon: { under: GLOW + RING },
      sakura: {
        under: GLOW + svg(`<circle cx="50" cy="50" r="45.5" fill="none" stroke="#FFC2D9" stroke-width="2.4"/><circle cx="50" cy="50" r="41" fill="none" stroke="#FF8FB8" stroke-width="1" opacity=".7"/>`),
        over: svg(`${[205, 325, 85].map(blossom).join('')}<g class="spin">${[[20, 44], [95, 47.5], [160, 43], [235, 47], [290, 44.5]].map(([a, r], i) => {
          const [x, y] = at(a, r);
          return `<g transform="translate(${n(x)} ${n(y)})"><ellipse class="flut"${dl(i * 0.5)} rx="1.9" ry="3" fill="#FFB7D0" stroke="#FF8FB8" stroke-width=".4"/></g>`;
        }).join('')}</g>`),
      },
      rainbow: { under: GLOW + RING, over: svg(`<g class="spin">${spark(50, 5, 4.6, 0)}</g><g class="spin rev">${spark(50, 95, 3.4, 0.8)}</g>`) },
      electric: {
        under: GLOW + svg(`<circle cx="50" cy="50" r="45" fill="none" stroke="#1E3A8A" stroke-width="7"/><circle cx="50" cy="50" r="45" fill="none" stroke="#60A5FA" stroke-width="1.4"/>`),
        over: svg(`<g class="jump">${[0, 120, 240].map((a, i) => `<g class="zap"${dl(i * 0.33)}><polyline points="${zig(a, 55, i)}" fill="none" stroke="#38BDF8" stroke-width="3.4" stroke-linejoin="round" opacity=".55"/><polyline points="${zig(a, 55, i)}" fill="none" stroke="#F0FBFF" stroke-width="1.4" stroke-linejoin="round"/></g>`).join('')}</g>`),
      },
      flame: {
        under: GLOW + RING,
        over: svg(Array.from({ length: 14 }, (_, i) => {
          const d = 0.7 + (i % 4) * 0.13;
          return `<g transform="rotate(${n(i * (360 / 14))} 50 50)"><path class="flick" style="animation-duration:${n(d)}s;animation-delay:-${n(i * 0.21)}s" d="M46.4 10 Q45 4.6 50 -1.4 Q55 4.6 53.6 10Z" fill="#FF7A1A"/><path class="flick" style="animation-duration:${n(d)}s;animation-delay:-${n(i * 0.21)}s" d="M48.2 10 Q47.5 6 50 2.6 Q52.5 6 51.8 10Z" fill="#FFD23F"/></g>`;
        }).join('')),
      },
      galaxy: {
        under: GLOW + RING,
        over: svg(`${[[15, 1.1], [70, .8], [130, 1], [190, .7], [250, 1.2], [310, .9], [345, .7], [100, .6]].map(([a, r], i) => {
          const [x, y] = at(a, 42 + (i % 3) * 2.6);
          return `<circle class="tw"${dl(i * 0.4)} cx="${n(x)}" cy="${n(y)}" r="${r}" fill="#fff"/>`;
        }).join('')}
          <g class="spin" style="animation-duration:7s"><circle cx="50" cy="5.4" r="3.8" fill="#FBBF24" stroke="#B45309" stroke-width=".6"/></g>
          <g class="spin rev" style="animation-duration:11s"><g transform="rotate(140 50 50)"><circle cx="50" cy="5" r="3" fill="#F472B6"/><ellipse cx="50" cy="5" rx="5.6" ry="1.5" fill="none" stroke="#FDE68A" stroke-width=".9" transform="rotate(-20 50 5)"/></g></g>
          <g class="spin" style="animation-duration:4.5s"><g transform="rotate(250 50 50)"><circle cx="50" cy="4.6" r="1.9" fill="#A5F3FC"/></g></g>`),
      },
      crown: {
        under: GLOW + svg(`<circle cx="50" cy="50" r="45" fill="none" stroke="#E5A400" stroke-width="9"/><circle cx="50" cy="50" r="45" fill="none" stroke="#FFC531" stroke-width="5.5"/>
          <circle cx="50" cy="50" r="49.3" fill="none" stroke="#8A5A00" stroke-width="1.2"/><circle cx="50" cy="50" r="40.6" fill="none" stroke="#8A5A00" stroke-width="1.2"/>
          <g class="spin" style="animation-duration:3.2s"><circle cx="50" cy="50" r="45" fill="none" stroke="#FFF7D6" stroke-width="5" stroke-linecap="round" stroke-dasharray="9 274"/></g>`),
        over: svg(`${[-45, 0, 45, 90, 135, 180, 225].map((a, i) => gem(a, ['#F2434F', '#2E9BFF', '#17B26A'][i % 3], i)).join('')}
          <g class="bob"><path d="M37 13.5 L35.4 1.2 L43.4 6.6 L50 -2.4 L56.6 6.6 L64.6 1.2 L63 13.5Z" fill="#FFC531" stroke="#8A5A00" stroke-width="1.3" stroke-linejoin="round"/>
          <rect x="37" y="10.6" width="26" height="3.4" rx="1" fill="#E5A400" stroke="#8A5A00" stroke-width=".8"/>
          <circle cx="50" cy="7.6" r="2" fill="#F2434F"/><circle cx="42.4" cy="9" r="1.3" fill="#2E9BFF"/><circle cx="57.6" cy="9" r="1.3" fill="#2E9BFF"/>
          ${spark(50, -2.6, 3.4, 0.2)}</g>`, ' over'),
      },
    };
  })();

  // Значок рядом с именем (витрина, u.icon). 24×24, фиксированные цвета: видно и на светлом, и на тёмном.
  const ICON_ART = (() => {
    const sp = (x, y, r, d = 0) => `<path class="tw" style="animation-delay:-${d}s" fill="#fff" d="M${x} ${y - r}Q${x + r * 0.2} ${y - r * 0.2} ${x + r} ${y}Q${x + r * 0.2} ${y + r * 0.2} ${x} ${y + r}Q${x - r * 0.2} ${y + r * 0.2} ${x - r} ${y}Q${x - r * 0.2} ${y - r * 0.2} ${x} ${y - r}Z"/>`;
    const s = (body) => `<svg viewBox="0 0 24 24">${body}</svg>`;
    return {
      heart: s('<path class="beat" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.6.7-1.5 2.2-2.6 4.3-2.6 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" fill="#F2434F" stroke="#B91C2C" stroke-width="1"/>'),
      star: s('<path class="twirl" d="M12 1.8l3 6.4 7 .8-5.2 4.7 1.5 6.9L12 17l-6.3 3.6 1.5-6.9L2 9l7-.8z" fill="#FFC531" stroke="#B37A00" stroke-width="1.2" stroke-linejoin="round"/>'),
      gamepad: s('<path d="M7 6h10c3 0 5 2.4 5.6 6l.7 4.3c.4 2.6-2.6 4-4.3 2l-2.4-2.8H7.4L5 18.3c-1.7 2-4.7.6-4.3-2L1.4 12C2 8.4 4 6 7 6z" fill="#8B5CF6" stroke="#5B21B6" stroke-width="1"/><path d="M6.3 9.2v4.4M4.1 11.4h4.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle class="blink1" cx="16.6" cy="9.8" r="1.5" fill="#FFC531"/><circle class="blink2" cx="18.8" cy="12.6" r="1.5" fill="#3DCB81"/>'),
      fire: s('<path class="flick" d="M12 22.5c-4.6 0-7.6-3-7.6-7 0-3.6 2.6-5.8 3.8-8.8.6 1.8 1.6 2.8 2.6 3.2C10.4 6 12.8 3 15.4 1.5c-.6 3.4 1.6 5.4 2.8 7.6 1 1.8 1.4 3.4 1.4 5 0 4.6-3 8.4-7.6 8.4z" fill="#FF6A1A"/><path class="flick" style="animation-delay:-.3s" d="M12 22.5c-2.4 0-4-1.6-4-3.8 0-2.4 2-3.6 2.8-5.6.8 1.4 1.6 1.8 2.4 2 0-1.4.6-2.8 1.6-3.6.2 2 2 3.4 2 5.8 0 2.6-1.8 5.2-4.8 5.2z" fill="#FFD23F"/>'),
      bolt: s('<path class="zapi" d="M13.5 1.5L3.8 13.6h6.8L9 22.5l10.2-12.8h-6.8l1.1-8.2z" fill="#FFD60A" stroke="#B37A00" stroke-width="1.2" stroke-linejoin="round"/>'),
      rocket: s('<g class="shake"><path class="flick" d="M6.2 17.8c-1.4 1.4-2 3.6-2.2 4.8 1.2-.2 3.4-.8 4.8-2.2z" fill="#FF9F1C"/><path d="M14.5 3.6c2.6-1.4 5-1.6 6.2-1.4.2 1.2 0 3.6-1.4 6.2l-7 7-4.8-4.8z" fill="#F1F5F9" stroke="#475569" stroke-width="1"/><circle cx="15.6" cy="8.4" r="1.9" fill="#38BDF8" stroke="#475569" stroke-width=".8"/><path d="M7.5 10.6L4 10l2.6-3.4 4-.2zM13.4 16.5l.6 3.5 3.4-2.6.2-4z" fill="#F2434F"/><path d="M8.5 15.5l-2.2 2.2" stroke="#475569" stroke-width="1"/></g>'),
      diamond: s(`<path d="M6.3 3h11.4L22 9l-10 12.5L2 9z" fill="#22D3EE" stroke="#0E7490" stroke-width="1.1" stroke-linejoin="round"/><path d="M2 9h20M8.6 3L6.6 9 12 21.5 17.4 9l-2-6" fill="none" stroke="#A5F3FC" stroke-width=".9"/><path d="M6.6 9L12 21.5 9.2 9z" fill="#67E8F9"/>${sp(18.5, 4.2, 3.4, 0)}${sp(5.2, 13.6, 2.2, 1.1)}`),
      crown: s(`<g class="bob"><path d="M3 18.5L1.8 7.2l5.6 4.2L12 3.6l4.6 7.8 5.6-4.2L21 18.5z" fill="#FFC531" stroke="#B37A00" stroke-width="1.2" stroke-linejoin="round"/><rect x="3" y="17.2" width="18" height="3.4" rx="1" fill="#E5A400" stroke="#B37A00" stroke-width="1"/><circle cx="12" cy="13.6" r="1.7" fill="#F2434F"/><circle cx="7.2" cy="14.6" r="1.1" fill="#2E9BFF"/><circle cx="16.8" cy="14.6" r="1.1" fill="#2E9BFF"/>${sp(12, 2.6, 3, .3)}</g>`),
    };
  })();
  const nameIconHTML = (id) => (ICON_ART[id] ? `<span class="nico ni-${id}" aria-hidden="true">${ICON_ART[id]}</span>` : '');

  // Имя игрока с цветом из витрины (u.nameColor) и значком (u.icon). Цвета — токены --nc-* с контрастом
  // не меньше 4.5:1 в обеих темах; переливы (neon…goldshine) — тоже токены, в style.css.
  const NAME_COLORS = ['blue', 'green', 'red', 'purple', 'pink', 'gold', 'neon', 'rainbow', 'fire', 'goldshine'];
  function nameHTML(u, tag = 'span') {
    const c = NAME_COLORS.includes(u?.nameColor) ? ` class="nc-${u.nameColor}"` : '';
    return `<${tag}${c}>${nameIconHTML(u?.icon)}${esc(u?.name)}</${tag}>`;
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
      // Вебвизор: записи визитов в Метрике (пароли и платёжные поля Метрика скрывает сама; игры в песочнице не пишутся)
      window.ym(Number(id), 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true });
    });
  }

  // Цель Метрики: регистрация, запуск игры, заявка автора, оплата. Цели с такими же именами нужно завести
  // в настройках счётчика. Обещание выполняется, когда цель ушла (или через 800 мс), — перед уходом со страницы его ждут.
  function goal(name, params) {
    return config().then(({ site }) => {
      const id = site && Number(site.metrika);
      if (!id || !window.ym) return;
      return new Promise((done) => {
        setTimeout(done, 800);
        try { window.ym(id, 'reachGoal', name, params || {}, done); } catch { done(); }
      });
    }).catch(() => {});
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
    $, esc, fmt, me, goal, safeNext, slugify, gameUrl, catUrl, devUrl, homeUrl, withParam, config, fillSite, fromApi, loadCatalog, rating, isNew, cardHTML, miniHTML, coverHTML, iconHTML, initHeader,
    toast, matches, CATEGORY_ICONS, COIN_SVG, plural, coinsText, setCoins, dialog, avatarHTML, nameHTML, nameIconHTML, timeLeft, invited,
  };
})();
