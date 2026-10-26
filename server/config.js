// Настройки рекламы и сведений о сайте из переменных окружения (.env).
// Страница получает их через GET /api/config; ads.txt отдаётся по /ads.txt.

export const AD_PROVIDERS = ['none', 'test', 'yandex', 'vk', 'google'];

const str = (v) => String(v || '').trim();
const seconds = (v, fallback) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
};
const provider = (v, fallback = 'none') => (AD_PROVIDERS.includes(str(v)) ? str(v) : fallback);

export function adsFromEnv(env = {}) {
  const main = provider(env.ADS_PROVIDER);
  return {
    // Полноэкранная реклама и реклама за награду.
    provider: main,
    // Баннер под игрой может идти из другой сети, по умолчанию — из той же.
    banner: provider(env.ADS_BANNER, main),
    fullscreenInterval: seconds(env.ADS_FULLSCREEN_INTERVAL, 60), // не чаще раза в N секунд
    firstDelay: seconds(env.ADS_FIRST_DELAY, 30),                 // и не в первые N секунд игры
    yandex: {
      fullscreenDesktop: str(env.ADS_YANDEX_FULLSCREEN_DESKTOP),
      fullscreenTouch: str(env.ADS_YANDEX_FULLSCREEN_TOUCH),
      rewardedDesktop: str(env.ADS_YANDEX_REWARDED_DESKTOP),
      rewardedTouch: str(env.ADS_YANDEX_REWARDED_TOUCH),
      banner: str(env.ADS_YANDEX_BANNER),
    },
    vk: {
      bannerClient: str(env.ADS_VK_BANNER_CLIENT),
      bannerSlot: str(env.ADS_VK_BANNER_SLOT),
      // Полноэкранные блоки: у VK на сайтах нет видео за награду, награда — за отдельный полноэкранный блок.
      fullscreenSlot: str(env.ADS_VK_FULLSCREEN_SLOT),
      rewardedSlot: str(env.ADS_VK_REWARDED_SLOT),
    },
    google: { client: str(env.ADS_GOOGLE_CLIENT), bannerSlot: str(env.ADS_GOOGLE_BANNER_SLOT), test: env.ADS_GOOGLE_TEST === '1' },
    // Строки ads.txt; в .env переносы пишутся как \n. Файл DATA_DIR/ads.txt важнее.
    adsTxt: str(env.ADS_TXT).replace(/\\n/g, '\n'),
  };
}

export function siteFromEnv(env = {}) {
  return {
    email: str(env.SITE_EMAIL),
    telegram: str(env.SITE_TELEGRAM).replace(/^@/, ''),
    owner: str(env.SITE_OWNER), // «Иванов Иван Иванович, самозанятый, ИНН …»
    metrika: /^\d{4,12}$/.test(str(env.METRIKA_ID)) ? str(env.METRIKA_ID) : '',
  };
}

// То, что можно показать странице: без ads.txt и прочего служебного.
export function publicConfig(ads, site) {
  const { adsTxt, ...pub } = ads; // eslint-disable-line no-unused-vars
  return { ads: pub, site };
}
