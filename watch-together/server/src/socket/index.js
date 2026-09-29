import { registerChatHandlers } from './chatHandlers.js';
import { registerPlaybackHandlers } from './playbackHandlers.js';
import { registerRoomHandlers } from './roomHandlers.js';

// Каждая тема (комнаты, чат, плеер) живёт в своём файле.
export function registerSocketHandlers(io, store) {
  io.on('connection', (socket) => {
    registerRoomHandlers(io, socket, store);
    registerChatHandlers(io, socket, store);
    registerPlaybackHandlers(io, socket, store);
  });
}
