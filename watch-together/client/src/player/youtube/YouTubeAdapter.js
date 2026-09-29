import { loadYouTubeApi } from './loadYouTubeApi.js';

// Состояния плеера YouTube
const YT = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

// Как часто проверяем позицию (у YouTube нет события «перемотали», приходится замечать скачки).
const POLL_INTERVAL_MS = 500;
// Скачок позиции больше этого (в секундах) считаем перемоткой.
const SEEK_JUMP_SECONDS = 1.5;
// Пока зритель тащит ползунок, YouTube ставит паузу. Ждём немного,
// чтобы отличить настоящую паузу от перемотки.
const PAUSE_SETTLE_MS = 300;
// После нашей собственной перемотки какое-то время не ищем «скачков»: позиция ещё устанавливается.
const OWN_SEEK_QUIET_MS = 1000;

/**
 * Адаптер плеера YouTube: переводит особенности YouTube IFrame API
 * на общий язык плееров (описан в createPlayer.js).
 */
export class YouTubeAdapter {
  constructor(container) {
    this.container = container;
    this.listeners = new Set();
    this.player = null;
    this.creating = false;
    this.ready = false;
    this.destroyed = false;
    this.videoId = null;
    this.initialLoad = null; // с каким видео создавали плеер
    this.pendingLoad = null; // видео, которое попросили загрузить до готовности плеера
    this.playing = false; // идёт ли просмотр (буферизация посреди просмотра — тоже «идёт»)
    this.cuedAt = 0; // с какой секунды начнётся подготовленное, но не запущенное видео
    this.title = '';
    this.pauseTimer = null;
    this.pollTimer = null;
    this.tracking = null; // { time, at, advancing } — прошлый замер позиции
    this.quietUntil = 0;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  isReady() {
    return this.ready;
  }

  load(videoId, { startSeconds = 0, autoplay = false } = {}) {
    if (this.destroyed) return;
    this.videoId = videoId;
    this.title = '';

    if (!this.ready) {
      this.pendingLoad = { videoId, startSeconds, autoplay };
      if (!this.creating) this.create();
      return;
    }

    this.clearPauseTimer();
    this.resetTracking();
    this.playing = false;
    this.cuedAt = startSeconds;
    if (autoplay) this.player.loadVideoById({ videoId, startSeconds });
    else this.player.cueVideoById({ videoId, startSeconds });
  }

  play() {
    if (this.ready) this.player.playVideo();
  }

  pause() {
    if (this.ready) this.player.pauseVideo();
  }

  // Перемотка без смены play/пауза. Сама по себе событие 'seek' не порождает.
  seek(seconds) {
    if (!this.ready) return;
    this.resetTracking();
    const state = this.player.getPlayerState();
    if (state === YT.CUED || state === YT.UNSTARTED || state === YT.ENDED) {
      // Из этих состояний seekTo запускает видео, а нам нужно только переставить позицию.
      this.cuedAt = seconds;
      this.player.cueVideoById({ videoId: this.videoId, startSeconds: seconds });
    } else {
      this.player.seekTo(seconds, true);
    }
  }

  getCurrentTime() {
    if (!this.ready) return this.pendingLoad?.startSeconds ?? 0;
    const state = this.player.getPlayerState();
    if (state === YT.CUED || state === YT.UNSTARTED) return this.cuedAt;
    return this.player.getCurrentTime() ?? 0;
  }

  // Идёт ли видео прямо сейчас (буферизация посреди просмотра тоже считается).
  isPlaying() {
    if (!this.ready) return false;
    const state = this.player.getPlayerState();
    return state === YT.PLAYING || (state === YT.BUFFERING && this.playing);
  }

  // 'loading' | 'idle' | 'playing' | 'paused' | 'buffering' | 'ended'
  getState() {
    if (!this.ready) return 'loading';
    switch (this.player.getPlayerState()) {
      case YT.PLAYING:
        return 'playing';
      case YT.PAUSED:
        return 'paused';
      case YT.BUFFERING:
        return 'buffering';
      case YT.ENDED:
        return 'ended';
      default:
        return 'idle';
    }
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.pollTimer);
    this.clearPauseTimer();
    this.listeners.clear();
    try {
      this.player?.destroy?.();
    } catch {
      // плеер мог ещё не успеть создаться
    }
    this.container.replaceChildren();
  }

  // ---------- внутреннее ----------

  async create() {
    this.creating = true;
    this.initialLoad = this.pendingLoad;
    let YTApi;
    try {
      YTApi = await loadYouTubeApi();
    } catch {
      this.emit({ type: 'error', code: 'API_LOAD_FAILED', videoId: this.videoId });
      return;
    }
    if (this.destroyed) return;

    // YouTube заменяет переданный элемент на iframe, поэтому создаём его сами, а не отдаём React-элемент.
    const element = document.createElement('div');
    this.container.replaceChildren(element);

    const { videoId, startSeconds, autoplay } = this.initialLoad;
    this.player = new YTApi.Player(element, {
      width: '100%',
      height: '100%',
      videoId,
      playerVars: {
        start: Math.floor(startSeconds),
        autoplay: autoplay ? 1 : 0,
        playsinline: 1, // на iPhone играть внутри страницы, а не на весь экран
        rel: 0,
      },
      events: {
        onReady: () => this.handleReady(),
        onStateChange: (event) => this.handleStateChange(event.data),
        onError: (event) => this.emit({ type: 'error', code: event.data, videoId: this.videoId }),
      },
    });
  }

  handleReady() {
    if (this.destroyed) return;
    this.ready = true;
    this.cuedAt = this.initialLoad.startSeconds;

    // Пока плеер создавался, могли попросить другое видео.
    const latest = this.pendingLoad;
    this.pendingLoad = null;
    if (latest && latest !== this.initialLoad) this.load(latest.videoId, latest);

    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    this.emit({ type: 'ready' });
  }

  handleStateChange(state) {
    this.updateTitle();

    switch (state) {
      case YT.PLAYING:
        this.clearPauseTimer(); // «пауза» была перетаскиванием ползунка
        if (!this.playing) {
          this.playing = true;
          this.emit({ type: 'play', time: this.getCurrentTime() });
        }
        break;

      case YT.PAUSED:
        // Пауза засчитывается, только если видео действительно шло
        // (например, заблокированный браузером автозапуск паузой не считается).
        if (this.playing && !this.pauseTimer) {
          this.pauseTimer = setTimeout(() => {
            this.pauseTimer = null;
            if (this.player.getPlayerState() !== YT.PAUSED) return;
            this.playing = false;
            this.emit({ type: 'pause', time: this.getCurrentTime() });
          }, PAUSE_SETTLE_MS);
        }
        break;

      case YT.ENDED:
        this.clearPauseTimer();
        this.playing = false;
        this.emit({ type: 'ended', time: this.getCurrentTime() });
        break;

      case YT.CUED:
      case YT.UNSTARTED:
        this.clearPauseTimer();
        this.playing = false;
        break;

      // BUFFERING: ничего не меняем — это остановка не по воле зрителя.
    }
  }

  // Регулярная проверка: сначала ищем перемотку, потом сообщаем 'tick'.
  // Порядок важен: модуль синхронизации по 'tick' подгоняет позицию и должен
  // к этому моменту уже знать о перемотке зрителя, иначе откатит её назад.
  poll() {
    if (this.destroyed || !this.ready) return;
    this.detectSeek();
    this.emit({ type: 'tick' });
  }

  // Ищем перемотку: сравниваем, где видео сейчас, с тем, где оно должно быть.
  detectSeek() {
    const state = this.player.getPlayerState();
    if (state === YT.CUED || state === YT.UNSTARTED) {
      this.tracking = null;
      return;
    }

    const now = performance.now();
    const time = this.getCurrentTime();
    const previous = this.tracking;
    this.tracking = { time, at: now, advancing: state === YT.PLAYING };
    if (!previous || now < this.quietUntil) return;

    const elapsed = (now - previous.at) / 1000;
    const expected = previous.advancing ? previous.time + elapsed * this.player.getPlaybackRate() : previous.time;
    if (Math.abs(time - expected) > SEEK_JUMP_SECONDS) {
      this.emit({ type: 'seek', time });
    }
  }

  resetTracking() {
    this.tracking = null;
    this.quietUntil = performance.now() + OWN_SEEK_QUIET_MS;
  }

  clearPauseTimer() {
    clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
  }

  updateTitle() {
    const title = this.player.getVideoData?.()?.title ?? '';
    if (title && title !== this.title) {
      this.title = title;
      this.emit({ type: 'title', title, videoId: this.videoId });
    }
  }
}
