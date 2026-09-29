// Общее состояние плеера в комнате. Не зависит от площадки: сервер не знает,
// как устроен плеер YouTube, он хранит только «что смотрим, где и играет ли».

// Разницу в позиции меньше этого (в секундах) считаем «тем же местом».
const SAME_POSITION_SECONDS = 1;

export class PlaybackState {
  constructor() {
    this.provider = null; // 'youtube' (позже 'rutube', 'vk')
    this.videoId = null;
    this.isPlaying = false;
    this.position = 0; // позиция в секундах на момент updatedAt
    this.updatedAt = Date.now();
    this.revision = 0; // растёт с каждым изменением, клиенты по нему отбрасывают устаревшее
    this.lastAction = null; // { type, position, nickname } — для подписи под плеером
  }

  // Где видео сейчас. Если оно играет, прибавляем время, прошедшее с updatedAt.
  getPosition(now = Date.now()) {
    if (!this.isPlaying) return this.position;
    return this.position + (now - this.updatedAt) / 1000;
  }

  load({ provider, videoId, startSeconds }, nickname) {
    this.provider = provider;
    this.videoId = videoId;
    this.isPlaying = false; // новое видео ждёт, пока кто-нибудь нажмёт ▶
    this.position = startSeconds;
    this.commit('load', nickname);
  }

  // type: 'play' | 'pause' | 'seek'.
  // Возвращает false, если по сути ничего не изменилось — тогда никому ничего не рассылаем.
  apply(type, position, nickname) {
    if (!this.videoId) return false;

    const now = Date.now();
    const isPlaying = type === 'play' ? true : type === 'pause' ? false : this.isPlaying;
    const samePlayState = isPlaying === this.isPlaying;
    const samePosition = Math.abs(position - this.getPosition(now)) < SAME_POSITION_SECONDS;
    if (samePlayState && samePosition) return false;

    this.isPlaying = isPlaying;
    this.position = position;
    this.commit(type, nickname, now);
    return true;
  }

  commit(type, nickname, now = Date.now()) {
    this.updatedAt = now;
    this.revision += 1;
    this.lastAction = { type, position: this.position, nickname };
  }

  // То, что уходит клиентам: позиция уже пересчитана на текущий момент.
  snapshot(now = Date.now()) {
    return {
      provider: this.provider,
      videoId: this.videoId,
      isPlaying: this.isPlaying,
      position: this.getPosition(now),
      updatedAt: now,
      revision: this.revision,
      lastAction: this.lastAction,
    };
  }
}
