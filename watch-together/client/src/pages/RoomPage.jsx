import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import Avatar from '../components/Avatar.jsx';
import Chat from '../components/Chat.jsx';
import NicknameModal from '../components/NicknameModal.jsx';
import ParticipantList from '../components/ParticipantList.jsx';
import Screen from '../components/Screen.jsx';
import Wordmark from '../components/Wordmark.jsx';
import { useRoom } from '../hooks/useRoom.js';
import { loadNickname, saveNickname } from '../lib/nickname.js';
import { usePlaybackSync } from '../sync/usePlaybackSync.js';

export default function RoomPage({ roomId }) {
  const [nickname, setNickname] = useState(loadNickname);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const [adapter, setAdapter] = useState(null); // плеер, который создал VideoPlayer
  const [tab, setTab] = useState('chat'); // вкладка на телефоне: 'chat' | 'people'

  const room = useRoom(roomId, nickname);
  const sync = usePlaybackSync({ socket: room.socket, adapter, playback: room.playback });

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

  async function handleInvite() {
    const url = window.location.href;
    // На телефоне открываем системное меню «Поделиться» — сразу в Telegram, WhatsApp и т. д.
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: 'Смотрим вместе', url });
      } catch {
        // меню просто закрыли
      }
      return;
    }
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
      <div className="page">
        <header className="page__top">
          <Wordmark />
        </header>
        <main className="home">
          <h1 className="home__title home__title--small">{notFound ? 'Комната не найдена' : 'Не удалось войти'}</h1>
          <p className="home__lead">
            {notFound
              ? 'Ссылка неверная, или комнату удалили: в ней долго никого не было.'
              : 'Попробуйте обновить страницу.'}
          </p>
          <div className="home__actions">
            <Link to="/" className="btn btn--primary btn--lg">
              На главную
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const isJoined = room.status === 'joined';

  return (
    <div className="room">
      <header className="topbar">
        <Wordmark />
        <div className="topbar__room">
          <span>комната</span>
          <code className="room-code">{roomId}</code>
        </div>
        <div className="topbar__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={handleInvite}>
            {isLinkCopied ? 'Ссылка скопирована' : 'Пригласить'}
          </button>
          <button type="button" className="me" onClick={() => setIsEditingNickname(true)} title="Сменить ник">
            <Avatar name={nickname} />
            <span className="me__name">{nickname}</span>
          </button>
        </div>
      </header>

      {!isJoined && (
        <div className="banner" role="status">
          {room.status === 'reconnecting' ? 'Связь потеряна, переподключаемся…' : 'Подключаемся к комнате…'}
        </div>
      )}

      <main className="room__main">
        <section className="room__stage">
          <Screen
            playback={room.playback}
            adapter={adapter}
            onAdapter={setAdapter}
            isOutOfSync={sync.isOutOfSync}
            onJoin={sync.joinPlayback}
            onLoadVideo={sync.loadVideo}
            disabled={!isJoined}
          />
        </section>

        <aside className="room__side">
          <div className="side-tabs" role="tablist">
            <button type="button" role="tab" className="side-tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
              Чат
            </button>
            <button
              type="button"
              role="tab"
              className="side-tab"
              aria-selected={tab === 'people'}
              onClick={() => setTab('people')}
            >
              В комнате · {room.participants.length}
            </button>
          </div>
          <ParticipantList
            className={tab === 'people' ? 'side-panel is-active' : 'side-panel'}
            participants={room.participants}
            selfId={room.self?.id}
          />
          <Chat
            className={tab === 'chat' ? 'side-panel is-active' : 'side-panel'}
            messages={room.messages}
            selfId={room.self?.id}
            onSend={room.sendMessage}
            disabled={!isJoined}
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
