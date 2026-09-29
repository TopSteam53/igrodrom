const STORAGE_KEY = 'watch-together:nickname';

export const MAX_NICKNAME_LENGTH = 24;

// Цвета ников в чате и аватарок — подобраны под тёмный фон.
const COLORS = ['#f2c14e', '#7fb8f0', '#f08a73', '#8fd19e', '#c9a2f2', '#f5a65b', '#6fcfc4', '#ee9bc0', '#b8cf6a'];

// Приводим ник к единому виду: без лишних пробелов и не длиннее лимита.
export function normalizeNickname(value) {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_NICKNAME_LENGTH);
}

export function loadNickname() {
  try {
    return normalizeNickname(localStorage.getItem(STORAGE_KEY) ?? '');
  } catch {
    return ''; // localStorage может быть недоступен (например, в строгом приватном режиме)
  }
}

export function saveNickname(nickname) {
  try {
    localStorage.setItem(STORAGE_KEY, nickname);
  } catch {
    // Не получилось сохранить — просто спросим ник в следующий раз.
  }
}

// Один и тот же ник всегда получает один и тот же цвет.
export function nicknameColor(nickname) {
  let hash = 0;
  for (const char of nickname) {
    hash = (hash * 31 + char.codePointAt(0)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}
