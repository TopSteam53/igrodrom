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

  // Нормализованная игра: одинаковые поля для API и статического каталога.
  function fromApi(g) {
    return {
      ...g,
      live: true,
      src: `/play/${g.id}/`,
      cover_url: g.cover ? `/play/${g.id}/${encodeURIComponent(g.cover)}` : null,
    };
  }
  function fromStatic(g) {
    return {
      ...g,
      live: false,
      src: `games/${g.id}/index.html`,
      cover_url: g.cover ? `games/${g.id}/${g.cover}` : null,
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
  const isNew = (g) => g.live && Date.now() - g.created_at < NEW_DAYS * 864e5;

  function coverHTML(g, i = 0) {
    const icon = CATEGORY_ICONS[g.genre] || '🎮';
    const bg = COVER_BG[[...String(g.id)].reduce((n, c) => n + c.charCodeAt(0), i) % COVER_BG.length];
    return `<div class="cover" style="background:${bg}">` +
      (g.cover_url ? `<img src="${esc(g.cover_url)}" alt="" loading="lazy" onerror="this.remove()">` : '') +
      `<span class="cover-icon" aria-hidden="true">${icon}</span>` +
      `<span class="age">${esc(g.age || '0+')}</span>` +
      (isNew(g) ? '<span class="flag">Новинка</span>' : '') + '</div>';
  }

  function cardHTML(g, i) {
    const r = rating(g);
    return `<a class="card" href="game.html?id=${encodeURIComponent(g.id)}">${coverHTML(g, i)}
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
    fetch('/api/me').then((r) => r.json()).then(({ user }) => {
      if (user && $('login')) $('login').textContent = user.name;
    }).catch(() => {});
  }

  function toast(msg) {
    let t = $('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.append(t); }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = 'none'; }, 2500);
  }

  // Поиск без учёта регистра и «ё».
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const matches = (g, q) => !q || norm(`${g.title} ${g.genre} ${g.author} ${g.description || ''}`).includes(norm(q));

  window.Igr = { $, esc, fmt, loadCatalog, rating, cardHTML, coverHTML, initHeader, toast, matches, CATEGORY_ICONS };
})();
