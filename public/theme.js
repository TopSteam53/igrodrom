// Тема оформления: светлая, тёмная или как в системе (по умолчанию).
// Подключается в <head> до стилей страницы, чтобы при загрузке не мигало светлым.
(function () {
  const KEY = 'igrodrom-theme';
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  } catch {}

  const system = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : system.matches);
  const icon = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const SUN = icon('<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>');
  const MOON = icon('<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>');

  // Кнопка-клавиша для шапки: показывает, на какую тему переключит.
  function button() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn theme-btn';
    const paint = () => {
      const dark = isDark();
      b.innerHTML = dark ? SUN : MOON;
      b.title = dark ? 'Светлая тема' : 'Тёмная тема';
      b.setAttribute('aria-label', b.title);
    };
    b.onclick = () => {
      const next = isDark() ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch {}
      paint();
    };
    system.addEventListener('change', paint);
    paint();
    return b;
  }

  window.IgrTheme = { button, isDark };
})();
