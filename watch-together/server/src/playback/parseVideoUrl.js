// Разбор ссылки на видео → { provider, videoId, startSeconds } или null.
// Сейчас поддерживается YouTube. Rutube и VK Видео добавятся сюда отдельными функциями.

const YOUTUBE_ID = /^[\w-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com']);

export function parseVideoUrl(input) {
  if (typeof input !== 'string' || input.length > 2000) return null;
  const text = input.trim();

  // Прислали просто id видео
  if (YOUTUBE_ID.test(text)) return { provider: 'youtube', videoId: text, startSeconds: 0 };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  return parseYouTube(url);
}

function parseYouTube(url) {
  const host = url.hostname.replace(/^www\./, '');
  let videoId = null;

  if (host === 'youtu.be') {
    videoId = url.pathname.split('/')[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    videoId =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/)?.[1];
  }

  if (!videoId || !YOUTUBE_ID.test(videoId)) return null;
  const startSeconds = parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start'));
  return { provider: 'youtube', videoId, startSeconds };
}

// Метка времени из ссылки: «90», «90s», «1m30s», «1h2m3s» → секунды.
function parseStartTime(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;
  const [, hours = 0, minutes = 0, seconds = 0] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}
