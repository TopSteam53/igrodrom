import { useEffect, useState } from 'react';
import { formatTimecode } from '../lib/format.js';
import VideoPlayer from '../player/VideoPlayer.jsx';
import VideoUrlForm from './VideoUrlForm.jsx';

const PLAYER_ERRORS = {
  API_LOAD_FAILED: 'Не удалось загрузить плеер YouTube. Проверьте интернет (или VPN) и обновите страницу.',
  2: 'YouTube не принял ссылку на это видео.',
  5: 'Браузер не смог воспроизвести это видео.',
  100: 'Видео не найдено: его удалили или скрыли.',
  101: 'Автор запретил показывать это видео на других сайтах.',
  150: 'Автор запретил показывать это видео на других сайтах.',
};

const ACTION_LABELS = { play: 'Воспроизведение с', pause: 'Пауза на', seek: 'Перемотка на' };

// Подпись под плеером: что последнее сделали с видео и кто.
function LastAction({ playback }) {
  const action = playback.lastAction;
  if (!action || action.type === 'load') {
    return <span>{playback.isPlaying ? 'Идёт' : 'Нажмите ▶ в плеере — видео запустится у всех'}</span>;
  }
  return (
    <span>
      {ACTION_LABELS[action.type]} <span className="timecode">{formatTimecode(action.position)}</span>
      {action.nickname && ` — ${action.nickname}`}
    </span>
  );
}

export default function Screen({ playback, adapter, onAdapter, isOutOfSync, onJoin, onLoadVideo, disabled }) {
  // Название и ошибка приходят из плеера и относятся к конкретному видео.
  const [meta, setMeta] = useState({ videoId: null, title: '', error: null });
  const [isChangingVideo, setIsChangingVideo] = useState(false);
  const videoId = playback?.videoId;

  useEffect(() => {
    if (!adapter) return;
    return adapter.subscribe((event) => {
      if (event.type !== 'title' && event.type !== 'error') return;
      setMeta((prev) => {
        const base = prev.videoId === event.videoId ? prev : { videoId: event.videoId, title: '', error: null };
        return event.type === 'title' ? { ...base, title: event.title } : { ...base, error: event.code };
      });
    });
  }, [adapter]);

  if (!videoId) {
    return (
      <div className="screen">
        <div className="screen__frame screen__frame--empty">
          <div className="screen__prompt">
            <h2 className="screen__heading">Что смотрим?</h2>
            <p className="screen__hint">Вставьте ссылку на видео с YouTube — оно откроется у всех в комнате.</p>
            <VideoUrlForm onSubmit={onLoadVideo} disabled={disabled} />
          </div>
        </div>
      </div>
    );
  }

  const title = meta.videoId === videoId ? meta.title : '';
  const errorCode = meta.videoId === videoId ? meta.error : null;
  const errorText =
    errorCode === null ? null : (PLAYER_ERRORS[errorCode] ?? `Не удалось воспроизвести видео (код ${errorCode}).`);

  return (
    <div className="screen">
      <div className="screen__frame">
        <VideoPlayer provider={playback.provider} onAdapter={onAdapter} />
        {errorText && (
          <div className="screen__error">
            <p>{errorText}</p>
          </div>
        )}
      </div>

      {isOutOfSync && !errorText && (
        <div className="notice" role="status">
          <span>У остальных видео уже идёт.</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={onJoin}>
            Смотреть со всеми
          </button>
        </div>
      )}

      <div className="now">
        <div className="now__info">
          <p className="now__title">{title || 'Видео с YouTube'}</p>
          <p className="now__status">
            <span className={playback.isPlaying ? 'state-dot is-playing' : 'state-dot'} aria-hidden="true" />
            <LastAction playback={playback} />
          </p>
        </div>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setIsChangingVideo((open) => !open)}>
          {isChangingVideo ? 'Отмена' : 'Другое видео'}
        </button>
      </div>

      {isChangingVideo && (
        <div className="screen__change">
          <VideoUrlForm onSubmit={onLoadVideo} onDone={() => setIsChangingVideo(false)} disabled={disabled} autoFocus />
        </div>
      )}
    </div>
  );
}
