const STORAGE_KEY = 'watch-together:nickname';

export const MAX_NICKNAME_LENGTH = 24;

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
  return `hsl(${Math.abs(hash) % 360} 70% 68%)`;
}
