// Все настройки сервера в одном месте.
// Любую из первых двух можно переопределить переменной окружения.

// Порт, на котором работает сервер.
export const PORT = Number(process.env.PORT) || 3001;

// Сколько пустая комната хранится в памяти, прежде чем её удалят (по умолчанию 10 минут).
export const EMPTY_ROOM_TTL_MS = Number(process.env.EMPTY_ROOM_TTL_MS) || 10 * 60 * 1000;

// Сколько последних сообщений чата хранить (их увидит тот, кто зайдёт позже).
export const MAX_MESSAGES_PER_ROOM = 100;

export const MAX_NICKNAME_LENGTH = 24;
export const MAX_MESSAGE_LENGTH = 500;
