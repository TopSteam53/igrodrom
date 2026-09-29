import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const MAX_MESSAGES = 200;

/**
 * Подключение к комнате: участники онлайн, чат и статус соединения.
 * Про видео этот хук ничего не знает. На этапе 2 синхронизация плеера
 * станет отдельным хуком, которому мы передадим тот же `socket`.
 *
 * status: 'idle' | 'connecting' | 'joined' | 'reconnecting' | 'not_found' | 'error'
 */
export function useRoom(roomId, nickname) {
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState('idle');
  const [self, setSelf] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);

  // Актуальный ник нужен при переподключении, но его смена не должна пересоздавать соединение.
  const nicknameRef = useRef(nickname);
  useEffect(() => {
    nicknameRef.current = nickname;
  }, [nickname]);

  const hasNickname = Boolean(nickname);

  useEffect(() => {
    if (!hasNickname) return;

    // Без адреса = подключаемся к тому же сайту (в разработке Vite передаст запрос серверу).
    const newSocket = io();
    setSocket(newSocket);
    setStatus('connecting');

    // `connect` срабатывает и при первом подключении, и после обрыва связи,
    // поэтому (пере)входим в комнату именно здесь.
    newSocket.on('connect', () => {
      newSocket.emit('room:join', { roomId, nickname: nicknameRef.current }, (response) => {
        if (!response?.ok) {
          setStatus(response?.error === 'ROOM_NOT_FOUND' ? 'not_found' : 'error');
          newSocket.disconnect();
          return;
        }
        setSelf(response.self);
        setParticipants(response.participants);
        setMessages(response.messages);
        setStatus('joined');
      });
    });

    newSocket.on('disconnect', (reason) => {
      // 'io client disconnect' — это мы сами отключились, переподключаться не нужно.
      if (reason !== 'io client disconnect') setStatus('reconnecting');
    });

    newSocket.on('room:participants', setParticipants);

    newSocket.on('chat:message', (message) => {
      setMessages((prev) => [...prev, message].slice(-MAX_MESSAGES));
    });

    // Ушли со страницы комнаты — отключаемся, сервер уберёт нас из списка.
    return () => {
      newSocket.disconnect();
      setSocket(null);
    };
  }, [roomId, hasNickname]);

  const sendMessage = useCallback(
    (text) =>
      new Promise((resolve) => {
        if (!socket?.connected) return resolve({ ok: false, error: 'OFFLINE' });
        socket.timeout(5000).emit('chat:send', { text }, (err, response) => {
          resolve(err ? { ok: false, error: 'TIMEOUT' } : response);
        });
      }),
    [socket],
  );

  const rename = useCallback(
    (newNickname) => {
      if (!socket?.connected) return;
      socket.emit('room:rename', { nickname: newNickname }, (response) => {
        if (response?.ok) setSelf(response.self);
      });
    },
    [socket],
  );

  return { socket, status, self, participants, messages, sendMessage, rename };
}
