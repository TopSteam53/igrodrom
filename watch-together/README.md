# Смотрим вместе — MVP, этап 1

Комнаты, вход по ссылке с ником, чат в реальном времени и список участников онлайн.
Видео появится на этапе 2.

## Структура

```
watch-together/
├── server/                     Node.js + Express + Socket.IO (порт 3001)
│   └── src/
│       ├── index.js            запуск сервера, REST: POST /api/rooms, GET /api/health
│       ├── config.js           настройки (порт, время жизни пустой комнаты, лимиты)
│       ├── rooms/              хранение комнат в памяти (Room, RoomStore, генерация id)
│       └── socket/             обработчики событий: комнаты, чат (позже — синхронизация)
└── client/                     React + Vite (порт 5173)
    └── src/
        ├── pages/              HomePage (создание комнаты), RoomPage (сама комната)
        ├── components/         NicknameModal, ParticipantList, Chat
        ├── hooks/useRoom.js    подключение к комнате через Socket.IO
        └── lib/nickname.js     ник в localStorage, цвет ника
```

## Запуск (нужен Node.js 22 LTS или новее)

Терминал 1 — сервер:

```bash
cd watch-together/server
npm install
npm run dev
```

Терминал 2 — клиент:

```bash
cd watch-together/client
npm install
npm run dev
```

Откройте http://localhost:5173

Проверить удаление пустой комнаты быстрее, чем через 10 минут (macOS/Linux):

```bash
EMPTY_ROOM_TTL_MS=10000 npm run dev
```

## Продакшен-сборка на одном порту

```bash
cd watch-together/client && npm run build
cd ../server && npm start
```

Сайт будет на http://localhost:3001 — сервер сам отдаёт собранный клиент.

## События Socket.IO

| Событие             | Кто отправляет | Данные                               |
| ------------------- | -------------- | ------------------------------------ |
| `room:join`         | клиент         | `{ roomId, nickname }` → ответ с участниками и историей |
| `room:rename`       | клиент         | `{ nickname }`                       |
| `room:participants` | сервер         | массив участников                    |
| `chat:send`         | клиент         | `{ text }`                           |
| `chat:message`      | сервер         | сообщение (`type: 'user' \| 'system'`) |

## Задел под этап 2

- Сервер: новый файл `socket/playbackHandlers.js` (события `playback:*`) и поле `playback`
  в `Room` — состояние «что играет, пауза или нет, позиция», одинаковое для любой площадки.
- Клиент: `src/player/` — адаптеры плееров (YouTube, позже Rutube и VK Видео) с общим
  интерфейсом `play / pause / seek / getCurrentTime`; `src/sync/usePlaybackSync.js` —
  синхронизация, которая работает с любым адаптером и использует `socket` из `useRoom`.
