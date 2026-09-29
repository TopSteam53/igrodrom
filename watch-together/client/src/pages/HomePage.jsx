import { useState } from 'react';
import { useNavigate } from 'react-router';

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
    <div className="center-screen home">
      <div className="card">
        <div className="home__logo" aria-hidden="true">🍿</div>
        <h1 className="home__title">Смотрим вместе</h1>
        <p className="muted">
          Создайте комнату, отправьте ссылку друзьям и смотрите видео синхронно. Без регистрации.
        </p>
        <button
          type="button"
          className="btn btn--primary btn--large"
          onClick={handleCreateRoom}
          disabled={isCreating}
        >
          {isCreating ? 'Создаём…' : 'Создать комнату'}
        </button>
        {error && <p className="error-text">{error}</p>}
        <ul className="home__features">
          <li>Синхронный плеер</li>
          <li>Чат</li>
          <li>Вход по ссылке</li>
        </ul>
      </div>
    </div>
  );
}
