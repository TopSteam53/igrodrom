// Загружает YouTube IFrame API один раз на всю страницу.

const API_URL = 'https://www.youtube.com/iframe_api';
const TIMEOUT_MS = 15000;

let apiPromise = null;

export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const fail = () => {
      apiPromise = null; // при следующей попытке попробуем загрузить заново
      reject(new Error('YouTube IFrame API не загрузился'));
    };
    const timer = setTimeout(fail, TIMEOUT_MS);

    // YouTube сам вызывает эту глобальную функцию, когда API готов.
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      clearTimeout(timer);
      resolve(window.YT);
    };

    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      fail();
    };
    document.head.append(script);
  });

  return apiPromise;
}
