import { useEffect, useRef, useState } from 'react';
import { formatClock } from '../lib/format.js';
import { nicknameColor } from '../lib/nickname.js';

const MAX_MESSAGE_LENGTH = 500;

export default function Chat({ messages, selfId, onSend, disabled, className = '' }) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  // Прокручиваем вниз, только если пользователь и так внизу (не мешаем читать историю).
  const stickToBottomRef = useRef(true);

  // className меняется, когда на телефоне открывают вкладку чата, — тоже прокручиваем вниз.
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [messages, className]);

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
      setError('Сообщение не отправилось. Проверьте соединение.');
    }
  }

  return (
    <section className={`chat ${className}`} aria-label="Чат">
      <h2 className="side-title">Чат</h2>

      <ol className="chat__log" ref={listRef} onScroll={handleScroll}>
        {messages.length === 0 && <li className="chat__empty">Сообщений пока нет.</li>}

        {messages.map((message) => {
          const time = (
            <time className="line__time" dateTime={new Date(message.createdAt).toISOString()}>
              {formatClock(message.createdAt)}
            </time>
          );

          if (message.type === 'system') {
            return (
              <li key={message.id} className="line line--system">
                <p className="line__body">{message.text}</p>
                {time}
              </li>
            );
          }

          const isOwn = message.author.id === selfId;
          return (
            <li key={message.id} className={isOwn ? 'line is-own' : 'line'}>
              <p className="line__body">
                <span className="line__name" style={{ color: nicknameColor(message.author.nickname) }}>
                  {message.author.nickname}
                </span>
                {message.text}
              </p>
              {time}
            </li>
          );
        })}
      </ol>

      {error && <p className="field-error chat__error">{error}</p>}

      <form className="composer" onSubmit={handleSubmit}>
        <input
          className="input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={disabled ? 'Нет соединения…' : 'Написать в чат'}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={disabled}
          enterKeyHint="send"
          aria-label="Сообщение"
        />
        <button
          type="submit"
          className="btn btn--primary composer__send"
          disabled={disabled || isSending || !text.trim()}
          aria-label="Отправить"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path
              d="M3 10h13M11 5l5 5-5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
    </section>
  );
}
