import { registerChatHandlers } from './chatHandlers.js';
import { registerRoomHandlers } from './roomHandlers.js';

// Каждая тема (комнаты, чат, позже — синхронизация плеера) живёт в своём файле.
export function registerSocketHandlers(io, store) {
  io.on('connection', (socket) => {
    registerRoomHandlers(io, socket, store);
    registerChatHandlers(io, socket, store);
    // Этап 2: registerPlaybackHandlers(io, socket, store) — синхронизация play/пауза/перемотка.
  });
}
