import { YouTubeAdapter } from './youtube/YouTubeAdapter.js';

/**
 * Общий «язык» всех плееров. Модуль синхронизации (src/sync) работает только через
 * эти методы и не знает, какая площадка внутри. Чтобы добавить Rutube или VK Видео,
 * пишем ещё один адаптер с такими же методами и добавляем его в PLAYERS.
 *
 * Методы:
 *   load(videoId, { startSeconds, autoplay })  — открыть видео
 *   play() / pause()
 *   seek(seconds)       — перемотать, не меняя play/пауза
 *   getCurrentTime()    — позиция в секундах
 *   isPlaying()         — идёт ли видео (буферизация посреди просмотра тоже считается)
 *   getState()          — 'loading' | 'idle' | 'playing' | 'paused' | 'buffering' | 'ended'
 *   isReady()           — плеер создан и слушается команд
 *   subscribe(listener) — подписка на события, возвращает функцию отписки
 *   destroy()
 *
 * События: { type, time }
 *   'ready'  — плеер готов
 *   'play'   — видео пошло (после паузы, остановки или с начала)
 *   'pause'  — видео остановили, когда оно шло
 *   'seek'   — позиция перескочила (перемотка в самом плеере)
 *   'ended'  — видео закончилось
 *   'tick'   — регулярно, пару раз в секунду, уже после проверки на перемотку
 *   'title'  — стало известно название ({ title, videoId })
 *   'error'  — ошибка ({ code, videoId })
 *
 * Важно: 'play' и 'pause' приходят и тогда, когда мы сами вызвали play()/pause().
 * Отличать их от действий зрителя — задача модуля синхронизации.
 * Свою перемотку seek() адаптер событием 'seek' не считает.
 */
const PLAYERS = {
  youtube: YouTubeAdapter,
};

export function createPlayer(provider, container) {
  const Player = PLAYERS[provider];
  if (!Player) throw new Error(`Неизвестная площадка: ${provider}`);
  return new Player(container);
}
