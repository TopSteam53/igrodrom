import { useCallback, useEffect, useRef, useState } from 'react';

// Расхождение с остальными, которое терпим (в секундах). Больше — подматываем плеер.
const SYNC_TOLERANCE = 1.5;
// На паузе перемотка ничего не стоит, поэтому выравниваем точнее — чтобы у всех был один кадр.
const PAUSED_TOLERANCE = 0.25;
// Сколько ждём, пока плеер выполнит нашу команду.
const COMMAND_TIMEOUT_MS = { play: 3000, pause: 2000 };
// Если видео при этом ещё грузится, ждём дольше, но не бесконечно.
const BUFFERING_TIMEOUT_MS = 15000;

// Где должно быть видео прямо сейчас по общему состоянию.
// receivedAt — когда это состояние пришло (по часам этой вкладки).
export function expectedPosition(shared, now = performance.now()) {
  if (!shared.isPlaying) return shared.position;
  return shared.position + (now - shared.receivedAt) / 1000;
}

/**
 * Синхронизация плеера с комнатой. Работает с любым адаптером из src/player.
 *   сервер → плеер: применяем общее состояние (какое видео, play/пауза, позиция);
 *   плеер → сервер: отправляем действия зрителя (play, пауза, перемотка).
 *
 * ЗАЩИТА ОТ ПЕТЛИ. Когда мы сами управляем плеером по команде сервера, плеер шлёт
 * те же события, что и при клике зрителя. Если отправить их обратно, сервер разошлёт
 * их всем, те применят и отправят снова, и так без конца. Поэтому:
 *   1. Пока плеер выполняет нашу команду, его события не отправляются (command).
 *   2. Отправляется только то, что меняет общее состояние: «play», когда все
 *      и так смотрят, — не новость, и на сервер не уходит.
 *   3. Свою перемотку адаптер не считает перемоткой зрителя (см. YouTubeAdapter.seek).
 *   4. Сервер не рассылает команды, которые ничего не меняют (PlaybackState.apply).
 */
export function usePlaybackSync({ socket, adapter, playback }) {
  const socketRef = useRef(socket);
  const sharedRef = useRef(null); // последнее известное общее состояние
  const applyRef = useRef(() => {});
  const joinRef = useRef(() => {});
  const [isOutOfSync, setIsOutOfSync] = useState(false);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    if (!adapter) return;

    let command = null; // { isPlaying, startedAt } — что мы сейчас велели плееру
    let loadedVideoId = null; // какое видео уже открыто в этом плеере
    let mismatchCount = 0;

    function startCommand(isPlaying) {
      command = { isPlaying, startedAt: performance.now() };
    }

    // Выполняет ли плеер ещё нашу команду.
    function isCommandInProgress() {
      if (!command) return false;
      const age = performance.now() - command.startedAt;
      if (age < (command.isPlaying ? COMMAND_TIMEOUT_MS.play : COMMAND_TIMEOUT_MS.pause)) return true;
      return command.isPlaying && age < BUFFERING_TIMEOUT_MS && adapter.getState() === 'buffering';
    }

    // ---------- сервер → плеер ----------
    function applySharedState() {
      const shared = sharedRef.current;
      if (!shared?.videoId) return;
      const target = expectedPosition(shared);

      if (loadedVideoId !== shared.videoId) {
        loadedVideoId = shared.videoId;
        if (shared.isPlaying) startCommand(true);
        adapter.load(shared.videoId, { startSeconds: target, autoplay: shared.isPlaying });
        return;
      }
      if (!adapter.isReady()) return; // доприменим, когда плеер скажет 'ready'

      const drift = Math.abs(adapter.getCurrentTime() - target);
      if (shared.isPlaying) {
        if (drift > SYNC_TOLERANCE) adapter.seek(target);
        if (!adapter.isPlaying()) {
          startCommand(true);
          adapter.play();
        }
      } else {
        if (adapter.isPlaying()) {
          startCommand(false);
          adapter.pause();
        }
        if (drift > PAUSED_TOLERANCE) adapter.seek(target);
      }
    }

    // ---------- плеер → сервер ----------
    function send(type, position) {
      const socket = socketRef.current;
      const shared = sharedRef.current;
      if (!socket?.connected || !shared) return;
      // Сразу обновляем общее состояние у себя, не дожидаясь сервера,
      // чтобы подгонка позиции не откатила действие зрителя.
      sharedRef.current = {
        ...shared,
        isPlaying: type === 'play' ? true : type === 'pause' ? false : shared.isPlaying,
        position,
        receivedAt: performance.now(),
      };
      socket.emit(`playback:${type}`, { position });
    }

    function handlePlayerEvent(event) {
      const shared = sharedRef.current;
      if (!shared?.videoId) return;

      if (event.type === 'ready') {
        applySharedState();
        return;
      }
      if (event.type === 'tick') {
        check();
        return;
      }
      // Видео закончилось — это факт, а не чьё-то решение: ставим всем паузу в конце.
      if (event.type === 'ended') {
        if (shared.isPlaying) send('pause', event.time);
        return;
      }
      if (event.type !== 'play' && event.type !== 'pause' && event.type !== 'seek') return;

      // Защита 1: плеер выполняет нашу команду — это эхо, а не действие зрителя.
      if (isCommandInProgress()) {
        const reachedTarget = event.type === (command.isPlaying ? 'play' : 'pause');
        if (reachedTarget) command = null;
        return;
      }
      command = null;

      // Защита 2: отправляем только то, что отличается от общего состояния.
      if (event.type === 'play' && !shared.isPlaying) {
        send('play', event.time);
      } else if (event.type === 'pause' && shared.isPlaying) {
        send('pause', event.time);
      } else if (event.type === 'seek' && Math.abs(event.time - expectedPosition(shared)) > SYNC_TOLERANCE) {
        send('seek', event.time);
      }
    }

    // ---------- регулярная сверка (по событию 'tick' от адаптера) ----------
    function check() {
      const shared = sharedRef.current;
      if (!shared?.videoId || !adapter.isReady()) return;

      if (command) {
        if (adapter.isPlaying() === command.isPlaying) command = null; // команда выполнена
        else if (isCommandInProgress()) return; // ещё выполняется
        else command = null; // не получилось (например, браузер запретил автозапуск)
      }

      // Разошлись с остальными в play/пауза? Ждём две проверки подряд (~1 с), чтобы не дёргаться
      // (например, пока адаптер решает, пауза это или перемотка).
      const state = adapter.getState();
      const behind = shared.isPlaying && !adapter.isPlaying() && state !== 'buffering';
      const ahead = !shared.isPlaying && adapter.isPlaying();
      mismatchCount = behind || ahead ? mismatchCount + 1 : 0;

      // У всех идёт, а у нас нет. Запустить сами не можем (браузеру нужен клик) — покажем кнопку.
      // 'idle' — видео даже не начиналось (автозапуск запрещён), тут ждать нечего.
      setIsOutOfSync(behind && (mismatchCount >= 2 || state === 'idle'));
      if (ahead && mismatchCount >= 2) applySharedState();

      // Подгоняем позицию, если отстали или убежали вперёд.
      if (shared.isPlaying && state === 'playing') {
        const target = expectedPosition(shared);
        if (Math.abs(adapter.getCurrentTime() - target) > SYNC_TOLERANCE) adapter.seek(target);
      }
    }

    // Кнопка «Смотреть со всеми» — клик зрителя разрешает браузеру запустить видео.
    function join() {
      const shared = sharedRef.current;
      if (!shared?.videoId) return;
      mismatchCount = 0;
      setIsOutOfSync(false);
      adapter.seek(expectedPosition(shared));
      startCommand(true);
      adapter.play();
    }

    applyRef.current = applySharedState;
    joinRef.current = join;
    applySharedState();
    const unsubscribe = adapter.subscribe(handlePlayerEvent);

    return () => {
      unsubscribe();
      applyRef.current = () => {};
      joinRef.current = () => {};
      setIsOutOfSync(false);
    };
  }, [adapter]);

  // Пришло новое общее состояние от сервера.
  useEffect(() => {
    sharedRef.current = playback;
    applyRef.current();
  }, [playback]);

  const joinPlayback = useCallback(() => joinRef.current(), []);

  const loadVideo = useCallback(
    (url) =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) return resolve({ ok: false, error: 'OFFLINE' });
        socket.timeout(5000).emit('playback:load', { url }, (err, response) => {
          resolve(err ? { ok: false, error: 'TIMEOUT' } : response);
        });
      }),
    [],
  );

  return { isOutOfSync, joinPlayback, loadVideo };
}
