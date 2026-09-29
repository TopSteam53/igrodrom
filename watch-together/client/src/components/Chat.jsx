import { useEffect, useRef, useState } from 'react';
import { nicknameColor } from '../lib/nickname.js';

const MAX_MESSAGE_LENGTH = 500;

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function Chat({ messages, selfId, onSend, disabled }) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  // Прокручиваем вниз, только если пользователь и так внизу (не мешаем читать историю).
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function handleScroll() {
    const list = listRef.current;
    stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setError('');
    setText(''); // очищаем поле сразу, не дожидаясь сервера
    stickToBottomRef.current = true; // своё сообщение всегда показываем
    const response = await onSend(trimmed);
    setIsSending(false);

    if (!response?.ok) {
      // Не отправилось — возвращаем текст, если пользователь не начал писать новый.
      setText((current) => current || trimmed);
      setError('Сообщение не отправлено. Проверьте соединение.');
    }
  }

  return (
    <section className="panel chat">
      <h2 className="panel__title chat__title">Чат</h2>

      <ul className="chat__messages" ref={listRef} onScroll={handleScroll}>
        {messages.length === 0 && <li className="chat__empty">Сообщений пока нет. Напишите первым!</li>}

        {messages.map((message) => {
          if (message.type === 'system') {
            return (
              <li key={message.id} className="msg msg--system">
                {message.text}
              </li>
            );
          }

          const isOwn = message.author.id === selfId;
          return (
            <li key={message.id} className={isOwn ? 'msg msg--own' : 'msg'}>
              <div className="msg__meta">
                {!isOwn && (
                  <span className="msg__author" style={{ color: nicknameColor(message.author.nickname) }}>
                    {message.author.nickname}
                  </span>
                )}
                <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
              </div>
              <div className="msg__text">{message.text}</div>
            </li>
          );
        })}
      </ul>

      {error && <p className="error-text chat__error">{error}</p>}

      <form className="chat__form" onSubmit={handleSubmit}>
        <input
          className="input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={disabled ? 'Нет соединения…' : 'Сообщение'}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={disabled}
          enterKeyHint="send"
          aria-label="Сообщение"
        />
        <button
          type="submit"
          className="btn btn--primary"
          disabled={disabled || isSending || !text.trim()}
          aria-label="Отправить"
        >
          ➤
        </button>
      </form>
    </section>
  );
}
