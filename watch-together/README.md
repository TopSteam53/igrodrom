# Смотрим вместе — MVP, этап 2

Комнаты по ссылке, ник без регистрации, чат, список участников и общий плеер YouTube:
play, пауза и перемотка у одного срабатывают у всех.

## Структура

```
watch-together/
├── server/                        Node.js + Express + Socket.IO (порт 3001)
│   └── src/
│       ├── index.js               запуск, REST: POST /api/rooms, GET /api/health
│       ├── config.js              настройки
│       ├── rooms/                 комнаты в памяти (Room, RoomStore, генерация id)
│       ├── playback/              общее состояние плеера и разбор ссылок
│       └── socket/                обработчики: комнаты, чат, плеер
└── client/                        React + Vite (порт 5173)
    └── src/
        ├── pages/                 главная и комната
        ├── components/            экран с видео, чат, участники, окно ника…
        ├── hooks/useRoom.js       соединение с комнатой
        ├── player/                ПЛЕЕРЫ: общий интерфейс + адаптер YouTube
        └── sync/                  СИНХРОНИЗАЦИЯ: работает с любым адаптером
```

Плеер и синхронизация разделены: `sync/usePlaybackSync.js` не знает, что внутри YouTube.
Чтобы добавить Rutube или VK Видео, пишем адаптер в `player/` с теми же методами
(список — в `player/createPlayer.js`) и учим сервер разбирать их ссылки (`playback/parseVideoUrl.js`).

## Запуск (Node.js 22 LTS или новее)

```bash
cd watch-together/server && npm install && npm run dev     # терминал 1
cd watch-together/client && npm install && npm run dev     # терминал 2
```

Откройте http://localhost:5173. YouTube должен открываться в вашем браузере (в России может понадобиться VPN).

## Продакшен-сборка на одном порту

```bash
cd watch-together/client && npm run build
cd ../server && npm start          # сайт на http://localhost:3001
```

## События Socket.IO

| Событие             | Кто шлёт | Данные |
| ------------------- | -------- | ------ |
| `room:join`         | клиент   | `{ roomId, nickname }` → ответ: участники, история чата, состояние плеера |
| `room:rename`       | клиент   | `{ nickname }` |
| `room:participants` | сервер   | массив участников |
| `chat:send`         | клиент   | `{ text }` |
| `chat:message`      | сервер   | сообщение (`type: 'user' \| 'system'`) |
| `playback:load`     | клиент   | `{ url }` — новое видео |
| `playback:play`     | клиент   | `{ position }` |
| `playback:pause`    | клиент   | `{ position }` |
| `playback:seek`     | клиент   | `{ position }` |
| `playback:state`    | сервер   | `{ provider, videoId, isPlaying, position, updatedAt, revision, lastAction }` |

Сервер хранит `position` на момент `updatedAt` и перед отправкой пересчитывает её на «сейчас»:
`position + (сейчас − updatedAt)`, если видео играет.

## Защита от петли

Когда клиент применяет команду сервера, плеер шлёт такие же события, как при клике зрителя.
Чтобы они не ушли обратно на сервер:

1. Пока плеер выполняет нашу команду, его события не отправляются.
2. Отправляется только то, что меняет общее состояние (`play`, когда все и так смотрят, — не отправляется).
3. Свою перемотку адаптер не считает перемоткой зрителя.
4. Сервер не рассылает команды, которые ничего не меняют.
