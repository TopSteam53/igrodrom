import { useState } from 'react';

const ERRORS = {
  INVALID_URL: 'Это не похоже на ссылку на видео YouTube.',
  OFFLINE: 'Нет связи с сервером.',
  TIMEOUT: 'Сервер не ответил, попробуйте ещё раз.',
};

export default function VideoUrlForm({ onSubmit, onDone, disabled, autoFocus }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    const value = url.trim();
    if (!value || isSending) return;

    setIsSending(true);
    setError('');
    const response = await onSubmit(value);
    setIsSending(false);

    if (response?.ok) {
      setUrl('');
      onDone?.();
    } else {
      setError(ERRORS[response?.error] ?? 'Не получилось включить видео.');
    }
  }

  return (
    <form className="url-form" onSubmit={handleSubmit}>
      <div className="url-form__row">
        <input
          className="input"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://youtu.be/…"
          aria-label="Ссылка на видео"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setError('');
          }}
          disabled={disabled}
          autoFocus={autoFocus}
        />
        <button type="submit" className="btn btn--primary" disabled={disabled || isSending || !url.trim()}>
          Включить
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </form>
  );
}
