import { MAX_MESSAGE_LENGTH, MAX_NICKNAME_LENGTH } from '../config.js';

// Отвечает клиенту, только если он передал функцию-ответ (ack).
export function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

// Возвращает очищенный ник или null, если ник не подходит.
export function cleanNickname(value) {
  if (typeof value !== 'string') return null;
  const nickname = value.trim().replace(/\s+/g, ' ');
  if (!nickname || nickname.length > MAX_NICKNAME_LENGTH) return null;
  return nickname;
}

// Позиция видео в секундах (не больше недели — хватит даже для трансляций) или null.
export function cleanPosition(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), 7 * 24 * 3600);
}

// Возвращает очищенный текст сообщения или null.
export function cleanMessageText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > MAX_MESSAGE_LENGTH) return null;
  return text;
}
