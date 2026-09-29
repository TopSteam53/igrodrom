import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import Chat from '../components/Chat.jsx';
import NicknameModal from '../components/NicknameModal.jsx';
import ParticipantList from '../components/ParticipantList.jsx';
import { useRoom } from '../hooks/useRoom.js';
import { loadNickname, saveNickname } from '../lib/nickname.js';

export default function RoomPage() {
  const { roomId } = useParams();
  const [nickname, setNickname] = useState(loadNickname);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const room = useRoom(roomId, nickname);

  // Через 2 секунды после копирования возвращаем кнопке обычный текст.
  useEffect(() => {
    if (!isLinkCopied) return;
    const timer = setTimeout(() => setIsLinkCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [isLinkCopied]);

  function handleNicknameSubmit(newNickname) {
    saveNickname(newNickname);
    setNickname(newNickname);
    setIsEditingNickname(false);
    if (room.status === 'joined') room.rename(newNickname);
  }

  async function handleCopyLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setIsLinkCopied(true);
    } catch {
      // Буфер обмена доступен только на https и localhost — в остальных случаях покажем ссылку.
      window.prompt('Скопируйте ссылку на комнату:', url);
    }
  }

  if (!nickname) {
    return <NicknameModal title="Как вас зовут?" submitLabel="Войти в комнату" onSubmit={handleNicknameSubmit} />;
  }

  if (room.status === 'not_found' || room.status === 'error') {
    const notFound = room.status === 'not_found';
    return (
      <div className="center-screen">
        <div className="card">
          <h1 className="card__title">{notFound ? 'Комната не найдена' : 'Не удалось войти'}</h1>
          <p className="muted">
            {notFound
              ? 'Ссылка неверная, или комнату удалили, потому что в ней долго никого не было.'
              : 'Попробуйте обновить страницу.'}
          </p>
          <Link to="/" className="btn btn--primary btn--large">
            На главную
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="room">
      <header className="room-header">
        <Link to="/" className="logo" title="На главную">
          <span aria-hidden="true">🍿</span>
          <span className="logo__text">Смотрим вместе</span>
        </Link>
        <div className="room-header__actions">
          <button type="button" className="btn btn--small btn--primary" onClick={handleCopyLink}>
            {isLinkCopied ? 'Скопировано ✓' : 'Ссылка на комнату'}
          </button>
          <button
            type="button"
            className="btn btn--small btn--ghost nickname-button"
            onClick={() => setIsEditingNickname(true)}
            title="Сменить ник"
          >
            {nickname}
          </button>
        </div>
      </header>

      {room.status !== 'joined' && (
        <div className="banner" role="status">
          {room.status === 'reconnecting' ? 'Связь потеряна, переподключаемся…' : 'Подключаемся к комнате…'}
        </div>
      )}

      <main className="room-layout">
        <section className="stage">
          {/* Этап 2: здесь будет плеер. Он будет получать команды от модуля синхронизации. */}
          <div className="stage__placeholder">
            <div className="stage__icon" aria-hidden="true">▶</div>
            <p>Здесь будет видео</p>
            <p className="muted small">Комната {roomId}</p>
          </div>
        </section>

        <aside className="sidebar">
          <ParticipantList participants={room.participants} selfId={room.self?.id} />
          <Chat
            messages={room.messages}
            selfId={room.self?.id}
            onSend={room.sendMessage}
            disabled={room.status !== 'joined'}
          />
        </aside>
      </main>

      {isEditingNickname && (
        <NicknameModal
          title="Сменить ник"
          submitLabel="Сохранить"
          initialValue={nickname}
          onSubmit={handleNicknameSubmit}
          onCancel={() => setIsEditingNickname(false)}
        />
      )}
    </div>
  );
}
