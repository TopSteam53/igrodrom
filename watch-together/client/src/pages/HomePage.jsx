import { useState } from 'react';
import { useNavigate } from 'react-router';
import Wordmark from '../components/Wordmark.jsx';

export default function HomePage() {
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  async function handleCreateRoom() {
    setIsCreating(true);
    setError('');
    try {
      const response = await fetch('/api/rooms', { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { roomId } = await response.json();
      navigate(`/room/${roomId}`);
    } catch {
      setError('Не удалось создать комнату. Проверьте, что сервер запущен.');
      setIsCreating(false);
    }
  }

  return (
    <div className="page">
      <header className="page__top">
        <Wordmark />
      </header>

      <main className="home">
        <h1 className="home__title">Смотрите видео вместе, даже если вы не рядом</h1>
        <p className="home__lead">
          Создайте комнату, отправьте ссылку друзьям и включите видео с YouTube. Пауза и перемотка срабатывают у всех
          одновременно.
        </p>
        <div className="home__actions">
          <button type="button" className="btn btn--primary btn--lg" onClick={handleCreateRoom} disabled={isCreating}>
            {isCreating ? 'Создаём…' : 'Создать комнату'}
          </button>
          <span className="home__note">Без регистрации</span>
        </div>
        {error && <p className="field-error">{error}</p>}
      </main>

      <ol className="steps">
        <li className="step">
          <span className="step__n">01</span>
          <h2 className="step__title">Комната</h2>
          <p className="step__text">Получите короткую ссылку и отправьте её в любой мессенджер.</p>
        </li>
        <li className="step">
          <span className="step__n">02</span>
          <h2 className="step__title">Друзья</h2>
          <p className="step__text">Заходят по ссылке и вводят ник. Аккаунты не нужны.</p>
        </li>
        <li className="step">
          <span className="step__n">03</span>
          <h2 className="step__title">Видео</h2>
          <p className="step__text">Вставьте ссылку на YouTube. Плеер у всех идёт синхронно, рядом чат.</p>
        </li>
      </ol>
    </div>
  );
}
