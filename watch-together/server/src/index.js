import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { EMPTY_ROOM_TTL_MS, PORT } from './config.js';
import { RoomStore } from './rooms/RoomStore.js';
import { registerSocketHandlers } from './socket/index.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const store = new RoomStore({ emptyRoomTtlMs: EMPTY_ROOM_TTL_MS });

app.use(express.json());

// Проверка, что сервер жив: http://localhost:3001/api/health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, rooms: store.size });
});

// Создание комнаты. Клиент получает id и переходит на /room/:id
app.post('/api/rooms', (req, res) => {
  const room = store.create();
  res.status(201).json({ roomId: room.id });
});

registerSocketHandlers(io, store);

// Для продакшена: если клиент собран (npm run build в папке client),
// сервер сам отдаёт сайт, и всё работает на одном порту.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // Любой другой адрес (например /room/abc) — отдаём index.html, дальше разберётся React Router.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

httpServer.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
