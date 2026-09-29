import { useState } from 'react';
import { MAX_NICKNAME_LENGTH, normalizeNickname } from '../lib/nickname.js';

export default function NicknameModal({ title, submitLabel, initialValue = '', onSubmit, onCancel }) {
  const [value, setValue] = useState(initialValue);
  const nickname = normalizeNickname(value);

  function handleSubmit(event) {
    event.preventDefault();
    if (nickname) onSubmit(nickname);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && onCancel) onCancel();
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nickname-title"
      >
        <h2 id="nickname-title" className="modal__title">
          {title}
        </h2>
        <p className="modal__text">Ник увидят остальные в комнате. Регистрация не нужна.</p>
        <input
          className="input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={MAX_NICKNAME_LENGTH}
          placeholder="Ваш ник"
          aria-label="Ваш ник"
          autoFocus
          autoComplete="nickname"
          enterKeyHint="go"
        />
        <div className="modal__actions">
          {onCancel && (
            <button type="button" className="btn btn--quiet" onClick={onCancel}>
              Отмена
            </button>
          )}
          <button type="submit" className="btn btn--primary" disabled={!nickname}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
