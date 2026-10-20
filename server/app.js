import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { openDb } from './db.js';
import { extractZip, isZip, ZipError } from './zip.js';
import { createStats } from './stats.js';
import { adsFromEnv, siteFromEnv, publicConfig } from './config.js';
import { logMailer } from './mail.js';
import {
  hashPassword, verifyPassword, DUMMY_HASH, newToken, sha256, newGameId, createLimiter,
} from './auth.js';

export const CATEGORIES = [
  'Аркады', 'Головоломки', 'Три в ряд', 'Казуальные', 'Настольные', 'Карточные', 'Стратегии', 'Гонки',
  'Симуляторы', 'Приключения', 'Спорт', 'Викторины', 'Обучающие', 'Для двоих', 'Кликеры', 'Прочее',
];
export const GENRES = CATEGORIES; // старое имя
export const AGES = ['0+', '6+', '12+', '16+', '18+'];
const STUDIO_EMAIL = 'studio@igrodrom.local'; // владелец демо-игр
const COVER_FILES = ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp', 'cover.svg'];
const ICON_FILES = ['icon.png', 'icon.jpg', 'icon.jpeg', 'icon.webp', 'icon.svg'];
const RATING_SQL = `(SELECT COUNT(*) FROM game_votes v WHERE v.game_id = g.id AND v.value = 1) AS likes,
                    (SELECT COUNT(*) FROM game_votes v WHERE v.game_id = g.id AND v.value = -1) AS dislikes,
                    (SELECT COALESCE(SUM(plays), 0) FROM play_daily d WHERE d.game_id = g.id) AS plays`;
// Лимиты как у Яндекс Игр: игра оттуда переносится тем же архивом.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // архив целиком
const MAX_HTML_BYTES = 5 * 1024 * 1024; // одиночный .html
const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024;
const MAX_GAME_FILES = 5000;
const PREVIEW_TTL_SEC = 6 * 3600;
const VISITOR_TTL_SEC = 365 * 24 * 3600;
export const MAX_SAVE_BYTES = 200 * 1024; // одно сохранение игры, как у Яндекс Игр
const SAVE_WRITES_PER_MINUTE = 60;
const MAX_JSON_BYTES = 16 * 1024;
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFY_TTL_MS = 3 * 24 * 3600 * 1000; // ссылка подтверждения почты
const RESET_TTL_MS = 3600 * 1000;           // ссылка сброса пароля
// Монетки: одна за минуту в игре (вкладка видна), не больше COIN_DAILY_CAP в день на все игры.
export const COIN_EVERY_MS = 55 * 1000;
export const COIN_DAILY_CAP = 60;
const MAX_SPEND = 1000;
const BOARD_RE = /^[\w.-]{1,40}$/;
const MAX_SCORE = 1e15;
// Защита регистрации от ботов: форма выдаёт подписанный билет, а отправить её можно не раньше чем
// через FORM_MIN_MS и не позже FORM_MAX_MS. Скрипт, который сразу шлёт POST, получает отказ.
const FORM_MIN_MS = 3000;
const FORM_MAX_MS = 6 * 3600 * 1000;
// Ссылки и адреса в имени: имя видно в рекордах и отзывах, спамеры пишут туда свои сайты.
const NAME_SPAM_RE = /https?:|www\.|t\.me\/|@\w|\.(ru|com|net|org|su|xyz|top|io|me|рф|cc|biz|info|pro|online|site|shop)(\/|\s|$)/i;
// Картинка для превью ссылок (Telegram, ВК, поисковики): своя у игры, иначе растровая обложка, иначе общая.
const OG_FILES = ['og.jpg', 'og.png'];
const RASTER_RE = /\.(png|jpe?g|webp)$/i;
// Страницы, которые поисковикам не нужны.
const NOINDEX = ['/api/', '/preview/', '/cabinet', '/account.html', '/login.html', '/reset.html', '/verify.html'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

// Ссылки на Яндекс Игры SDK в играх оттуда. При загрузке они заменяются на /sdk.js — наш SDK
// с тем же API (public/sdk/yandex.js), поэтому игру с Яндекса не нужно пересобирать.
const YANDEX_SDK_URL = /(?:https?:)?\/\/(?:yandex\.(?:ru|com|com\.tr|by|kz|uz)\/games\/sdk\/v2|sdk\.games\.s3\.yandex\.net\/sdk\.js)/g;
// Сборки под Яндекс подключают SDK как <script src="/sdk.js">, иногда без слэша.
const RELATIVE_SDK = /(<script\b[^>]*\bsrc\s*=\s*["'])(?:\.\/)?sdk\.js(["'])/gi;
// Сжатые файлы Unity-сборок (Build/*.br, *.gz) браузер распаковывает сам по заголовку Content-Encoding.
const ENCODINGS = { '.br': 'br', '.gz': 'gzip' };

// Uploaded games run with an opaque origin: no access to our cookies, storage or API.
const GAME_CSP = 'sandbox allow-scripts allow-pointer-lock';

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createApp({
  dataDir, publicDir, adminEmails = [], secureCookies = false, previewSecret = randomBytes(32), trustProxy = false,
  seedDemoGames = false, ads = adsFromEnv(), site = siteFromEnv(),
  now = Date.now, statsTz = 'Europe/Moscow',
  mailer = logMailer(() => {}), siteUrl = 'http://localhost:3000',
  // Защита регистрации (билет формы и лимит с одного адреса). На сайте её включает index.js,
  // в тестах она выключена, чтобы заводить много аккаунтов подряд.
  registerGuard = false, registerPerHour = 10, registerPerDay = 30,
}) {
  siteUrl = siteUrl.replace(/\/+$/, '');
  const gamesDir = path.join(dataDir, 'games');
  fs.mkdirSync(gamesDir, { recursive: true });
  migrateSingleFileGames(gamesDir);
  const db = openDb(path.join(dataDir, 'igrodrom.db'));
  const admins = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const loginLimiter = createLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
  const saveLimiter = createLimiter({ max: SAVE_WRITES_PER_MINUTE, windowMs: 60 * 1000 });
  const mailLimiter = createLimiter({ max: 5, windowMs: 3600 * 1000 });
  const scoreLimiter = createLimiter({ max: 30, windowMs: 60 * 1000 });
  const spendLimiter = createLimiter({ max: 20, windowMs: 60 * 1000 });
  const reviewLimiter = createLimiter({ max: 10, windowMs: 3600 * 1000 });
  const registerHourLimiter = createLimiter({ max: registerPerHour, windowMs: 3600 * 1000 });
  const registerDayLimiter = createLimiter({ max: registerPerDay, windowMs: 24 * 3600 * 1000 });
  const stats = createStats({ db, now, tz: statsTz });

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (email, name, pass_hash, created_at) VALUES (?, ?, ?, ?)'),
    sessionUser: db.prepare(`SELECT u.id, u.email, u.name, u.role, u.email_verified_at, u.coins FROM sessions s JOIN users u ON u.id = s.user_id
                             WHERE s.token_hash = ? AND s.expires_at > ?`),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    setPassword: db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?'),
    verifyEmail: db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL'),
    insertToken: db.prepare('INSERT INTO email_tokens (token_hash, user_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'),
    token: db.prepare('SELECT * FROM email_tokens WHERE token_hash = ?'),
    deleteToken: db.prepare('DELETE FROM email_tokens WHERE token_hash = ?'),
    deleteTokens: db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?'),
    purgeTokens: db.prepare('DELETE FROM email_tokens WHERE expires_at <= ?'),
    lbTop: db.prepare(`SELECT s.user_id, s.score, s.extra, s.updated_at, u.name FROM leaderboard_scores s JOIN users u ON u.id = s.user_id
                       WHERE s.game_id = ? AND s.board = ? ORDER BY s.score DESC, s.updated_at ASC LIMIT ?`),
    lbMine: db.prepare(`SELECT s.user_id, s.score, s.extra, s.updated_at, u.name FROM leaderboard_scores s JOIN users u ON u.id = s.user_id
                        WHERE s.game_id = ? AND s.board = ? AND s.user_id = ?`),
    lbAbove: db.prepare(`SELECT s.user_id, s.score, s.extra, s.updated_at, u.name FROM leaderboard_scores s JOIN users u ON u.id = s.user_id
                         WHERE s.game_id = ? AND s.board = ? AND (s.score > ? OR (s.score = ? AND s.updated_at < ?))
                         ORDER BY s.score ASC, s.updated_at DESC LIMIT ?`),
    lbBelow: db.prepare(`SELECT s.user_id, s.score, s.extra, s.updated_at, u.name FROM leaderboard_scores s JOIN users u ON u.id = s.user_id
                         WHERE s.game_id = ? AND s.board = ? AND (s.score < ? OR (s.score = ? AND s.updated_at > ?))
                         ORDER BY s.score DESC, s.updated_at ASC LIMIT ?`),
    lbRank: db.prepare(`SELECT COUNT(*) AS n FROM leaderboard_scores WHERE game_id = ? AND board = ?
                        AND (score > ? OR (score = ? AND updated_at < ?))`),
    lbCount: db.prepare('SELECT COUNT(*) AS n FROM leaderboard_scores WHERE game_id = ? AND board = ?'),
    lbBoards: db.prepare(`SELECT board, COUNT(*) AS players FROM leaderboard_scores WHERE game_id = ?
                          GROUP BY board ORDER BY players DESC, board LIMIT 20`),
    // Лучший результат побеждает: худший не перезаписывает рекорд.
    lbUpsert: db.prepare(`INSERT INTO leaderboard_scores (game_id, board, user_id, score, extra, updated_at) VALUES (?, ?, ?, ?, ?, ?)
                          ON CONFLICT (game_id, board, user_id) DO UPDATE SET score = excluded.score, extra = excluded.extra,
                            updated_at = excluded.updated_at WHERE excluded.score > leaderboard_scores.score`),
    coinsOf: db.prepare('SELECT coins FROM users WHERE id = ?'),
    coinDay: db.prepare('SELECT earned, last_at FROM coin_daily WHERE user_id = ? AND day = ?'),
    coinLastTick: db.prepare('SELECT MAX(last_at) AS t FROM coin_daily WHERE user_id = ?'),
    coinEarn: db.prepare(`INSERT INTO coin_daily (user_id, day, earned, last_at) VALUES (?, ?, 1, ?)
                          ON CONFLICT (user_id, day) DO UPDATE SET earned = earned + 1, last_at = excluded.last_at`),
    coinDays: db.prepare('SELECT day, earned FROM coin_daily WHERE user_id = ? ORDER BY day DESC LIMIT 14'),
    addCoins: db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?'),
    takeCoins: db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?'),
    insertSpend: db.prepare(`INSERT INTO coin_spends (user_id, game_id, game_title, amount, title, created_at)
                             VALUES (?, ?, ?, ?, ?, ?)`),
    spends: db.prepare(`SELECT game_id, game_title, amount, title, created_at FROM coin_spends WHERE user_id = ?
                        ORDER BY created_at DESC, id DESC LIMIT 50`),
    reviews: db.prepare(`SELECT r.user_id, r.text, r.created_at, r.updated_at, u.name FROM game_reviews r JOIN users u ON u.id = r.user_id
                         WHERE r.game_id = ? ORDER BY r.updated_at DESC LIMIT 200`),
    reviewCount: db.prepare('SELECT COUNT(*) AS n FROM game_reviews WHERE game_id = ?'),
    myReview: db.prepare('SELECT text, created_at, updated_at FROM game_reviews WHERE game_id = ? AND user_id = ?'),
    upsertReview: db.prepare(`INSERT INTO game_reviews (game_id, user_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
                              ON CONFLICT (game_id, user_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`),
    deleteReview: db.prepare('DELETE FROM game_reviews WHERE game_id = ? AND user_id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    publicGames: db.prepare(`SELECT g.id, g.title, g.genre, g.age, g.cover, g.icon, g.description, g.featured, u.name AS author, g.created_at, ${RATING_SQL},
                               u.email = '${STUDIO_EMAIL}' AS demo
                             FROM games g JOIN users u ON u.id = g.author_id
                             WHERE g.status = 'approved' ORDER BY g.created_at DESC LIMIT 500`),
    publicGame: db.prepare(`SELECT g.id, g.title, g.genre, g.age, g.cover, g.icon, g.description, g.how_to_play,
                              u.name AS author, g.created_at, g.updated_at, ${RATING_SQL},
                              u.email = '${STUDIO_EMAIL}' AS demo
                            FROM games g JOIN users u ON u.id = g.author_id
                            WHERE g.id = ? AND g.status = 'approved'`),
    myGames: db.prepare(`SELECT id, title, genre, age, cover, icon, description, how_to_play, status, reject_reason,
                           size, file_count, created_at
                         FROM games WHERE author_id = ? ORDER BY created_at DESC`),
    updateMeta: db.prepare(`UPDATE games SET title = ?, genre = ?, age = ?, description = ?, how_to_play = ?, updated_at = ?
                            WHERE id = ?`),
    myVote: db.prepare('SELECT value FROM game_votes WHERE game_id = ? AND visitor = ?'),
    upsertVote: db.prepare(`INSERT INTO game_votes (game_id, visitor, value, created_at) VALUES (?, ?, ?, ?)
                            ON CONFLICT (game_id, visitor) DO UPDATE SET value = excluded.value`),
    deleteVote: db.prepare('DELETE FROM game_votes WHERE game_id = ? AND visitor = ?'),
    getSave: db.prepare('SELECT data, updated_at FROM game_saves WHERE game_id = ? AND visitor = ?'),
    putSave: db.prepare(`INSERT INTO game_saves (game_id, visitor, data, updated_at) VALUES (?, ?, ?, ?)
                         ON CONFLICT (game_id, visitor) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
    deleteSave: db.prepare('DELETE FROM game_saves WHERE game_id = ? AND visitor = ?'),
    savesOf: db.prepare('SELECT game_id, updated_at FROM game_saves WHERE visitor = ?'),
    moveSave: db.prepare('UPDATE game_saves SET visitor = ? WHERE game_id = ? AND visitor = ?'),
    recentGames: db.prepare(`SELECT g.id, g.title, g.genre, g.age, g.cover, g.icon, s.updated_at AS played_at
                             FROM game_saves s JOIN games g ON g.id = s.game_id
                             WHERE s.visitor = ? AND g.status = 'approved' ORDER BY s.updated_at DESC LIMIT 24`),
    application: db.prepare('SELECT * FROM developer_applications WHERE user_id = ?'),
    upsertApplication: db.prepare(`INSERT INTO developer_applications (user_id, studio, about, links, contact, status, reason, created_at, updated_at)
                                   VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
                                   ON CONFLICT (user_id) DO UPDATE SET studio = excluded.studio, about = excluded.about,
                                     links = excluded.links, contact = excluded.contact, status = 'pending', reason = NULL,
                                     updated_at = excluded.updated_at`),
    applicationsByStatus: db.prepare(`SELECT a.*, u.name, u.email FROM developer_applications a JOIN users u ON u.id = a.user_id
                                      WHERE a.status = ? ORDER BY a.updated_at ASC LIMIT 200`),
    setApplicationStatus: db.prepare('UPDATE developer_applications SET status = ?, reason = ?, updated_at = ? WHERE user_id = ?'),
    // Авторы, у которых игры появились до введения заявок, считаются одобренными разработчиками.
    grandfatherAuthors: db.prepare(`INSERT OR IGNORE INTO developer_applications (user_id, studio, about, status, created_at, updated_at)
                                    SELECT DISTINCT u.id, u.name, 'Публиковал игры до введения заявок', 'approved', ?, ?
                                    FROM users u JOIN games g ON g.author_id = u.id`),
    gamesByStatus: db.prepare(`SELECT g.id, g.title, g.genre, g.status, g.size, g.file_count, g.created_at, g.reject_reason,
                               g.author_id, u.name AS author, u.email AS author_email
                               FROM games g JOIN users u ON u.id = g.author_id
                               WHERE g.status = ? ORDER BY g.created_at ASC LIMIT 200`),
    game: db.prepare('SELECT * FROM games WHERE id = ?'),
    insertGame: db.prepare(`INSERT INTO games (id, author_id, title, genre, status, size, file_count, cover, icon, created_at, updated_at)
                            VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`),
    setStatus: db.prepare('UPDATE games SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?'),
    deleteGame: db.prepare('DELETE FROM games WHERE id = ?'),
    setRole: db.prepare('UPDATE users SET role = ?, role_since = ? WHERE id = ?'),
    moderators: db.prepare(`SELECT u.id, u.name, u.email, u.role_since,
                              (SELECT COUNT(*) FROM moderation_log l WHERE l.actor_id = u.id AND l.action NOT LIKE 'team.%') AS decisions
                            FROM users u WHERE u.role = 'moderator' ORDER BY u.role_since`),
    logInsert: db.prepare(`INSERT INTO moderation_log (actor_id, actor_name, action, target_id, target_title, reason, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?)`),
    logRecent: db.prepare('SELECT * FROM moderation_log ORDER BY created_at DESC, id DESC LIMIT ?'),
  };

  // Роли: владелец — почта в ADMIN_EMAILS (может всё, включая команду); модератор — назначает владелец
  // в кабинете (проверяет заявки и игры); остальные — игроки, а с одобренной заявкой ещё и разработчики.
  const isAdmin = (user) => !!user && admins.has(user.email); // владелец
  const isModerator = (user) => !!user && (isAdmin(user) || user.role === 'moderator');
  const roleOf = (user) => (isAdmin(user) ? 'owner' : user.role === 'moderator' ? 'moderator' : 'player');
  function requireModerator(req) {
    const user = requireUser(req);
    if (!isModerator(user)) throw new HttpError(403, 'Только для модераторов');
    return user;
  }
  function requireOwner(req) {
    const user = requireUser(req);
    if (!isAdmin(user)) throw new HttpError(403, 'Только для владельца площадки');
    return user;
  }
  const logAction = (actor, action, targetId, title, reason = null) =>
    q.logInsert.run(actor.id, actor.name, action, String(targetId), title, reason, Date.now());
  const gameDir = (id) => path.join(gamesDir, id);
  if (seedDemoGames) seedDemo();
  q.grandfatherAuthors.run(Date.now(), Date.now());

  // Демо-игры из public/games/<slug>/ (с meta.json) заводятся как обычные одобренные игры
  // от имени «Игродрома»: тогда у них работают счётчик, оценки и страница игры.
  function seedDemo() {
    const root = path.join(publicDir, 'games');
    if (!fs.existsSync(root)) return;
    let studio = q.userByEmail.get(STUDIO_EMAIL);
    if (!studio) {
      // Пароль-заглушка: verifyPassword его никогда не примет, войти под этим аккаунтом нельзя.
      q.insertUser.run(STUDIO_EMAIL, 'Игродром', '!', Date.now());
      studio = q.userByEmail.get(STUDIO_EMAIL);
    }
    const slugs = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'meta.json'))).sort();
    for (const slug of slugs) {
      const src = path.join(root, slug);
      let meta;
      try { meta = JSON.parse(fs.readFileSync(path.join(src, 'meta.json'), 'utf8')); } catch { continue; }
      if (!fs.existsSync(path.join(src, 'index.html'))) continue;
      const id = sha256(`demo:${slug}`).slice(0, 16);
      fs.cpSync(src, gameDir(id), { recursive: true, force: true });
      const genre = CATEGORIES.includes(meta.category) ? meta.category : 'Прочее';
      const age = AGES.includes(meta.age) ? meta.age : '0+';
      const cover = COVER_FILES.find((f) => fs.existsSync(path.join(src, f))) || null;
      const icon = ICON_FILES.find((f) => fs.existsSync(path.join(src, f))) || null;
      const files = fs.readdirSync(src, { recursive: true }).filter((f) => fs.statSync(path.join(src, f)).isFile());
      const size = files.reduce((n, f) => n + fs.statSync(path.join(src, f)).size, 0);
      if (!q.game.get(id)) {
        const t = Date.now();
        q.insertGame.run(id, studio.id, meta.title || slug, genre, size, files.length, cover, icon, t, t);
        q.setStatus.run('approved', null, t, id);
      }
      q.updateMeta.run(String(meta.title || slug).slice(0, 60), genre, age,
        String(meta.description || '').slice(0, 1500), String(meta.how_to_play || '').slice(0, 600), Date.now(), id);
      const featured = Number.isInteger(meta.featured) ? meta.featured : 0;
      db.prepare('UPDATE games SET cover = ?, icon = ?, size = ?, file_count = ?, featured = ? WHERE id = ?')
        .run(cover, icon, size, files.length, featured, id);
    }
  }

  // Pending and rejected games are opened through a signed link instead of a cookie check:
  // the game runs with an opaque origin, so its scripts and images would arrive without cookies.
  const sign = (id, exp) => createHmac('sha256', previewSecret).update(`${id}.${exp}`).digest('hex').slice(0, 32);
  function previewUrl(id) {
    const exp = Math.floor(Date.now() / 1000) + PREVIEW_TTL_SEC;
    return `/preview/${id}.${exp}.${sign(id, exp)}/`;
  }
  function previewValid(id, exp, sig) {
    if (Number(exp) < Date.now() / 1000) return false;
    const expected = Buffer.from(sign(id, exp));
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
  const withPreview = (games) => games.map((g) => ({ ...g, preview_url: previewUrl(g.id) }));

  // Билет формы регистрации: время выдачи + подпись, привязанная к адресу клиента.
  const ticketSig = (ts, ip) => createHmac('sha256', previewSecret).update(`register.${ts}.${ip}`).digest('hex').slice(0, 32);
  const formTicket = (req) => { const ts = now(); return `${ts}.${ticketSig(ts, clientIp(req))}`; };
  function checkTicket(req, ticket) {
    const [ts, sig = ''] = String(ticket || '').split('.');
    const expected = Buffer.from(ticketSig(ts, clientIp(req)));
    const given = Buffer.from(sig);
    if (!/^\d{13}$/.test(ts) || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new HttpError(400, 'Обновите страницу и попробуйте ещё раз');
    }
    const age = now() - Number(ts);
    if (age < FORM_MIN_MS) throw new HttpError(429, 'Слишком быстро. Подождите пару секунд и нажмите ещё раз');
    if (age > FORM_MAX_MS) throw new HttpError(400, 'Страница устарела: обновите её и попробуйте ещё раз');
  }

  // ---------- helpers ----------

  function send(res, status, body, headers = {}) {
    const json = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(json);
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length']);
      if (declared > limit) { req.pause(); return reject(new HttpError(413, 'Файл слишком большой')); }
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          // Stop reading; the 413 response is sent with Connection: close.
          req.pause();
          chunks.length = 0;
          reject(new HttpError(413, 'Файл слишком большой'));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  async function readJson(req) {
    const buf = await readBody(req, MAX_JSON_BYTES);
    try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Некорректный JSON'); }
  }

  function cookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function sessionCookie(token, maxAgeSec) {
    return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secureCookies ? '; Secure' : ''}`;
  }

  function currentUser(req) {
    const token = cookies(req).sid;
    if (!token) return null;
    return q.sessionUser.get(sha256(token), Date.now()) || null;
  }

  function requireUser(req) {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Нужно войти в аккаунт');
    return user;
  }

  function startSession(userId) {
    const token = newToken();
    q.purgeSessions.run(Date.now());
    q.insertSession.run(sha256(token), userId, Date.now() + SESSION_TTL_MS);
    return sessionCookie(token, SESSION_TTL_MS / 1000);
  }

  // Cross-site writes are refused: SameSite=Lax covers cookies, this covers the rest.
  function checkOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return;
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.headers.host) throw new HttpError(403, 'Запрос с чужого сайта');
  }

  // Behind a reverse proxy every request comes from the proxy, so the client IP is in X-Forwarded-For.
  // Only trust that header when the proxy is ours, otherwise anyone can forge it.
  function clientIp(req) {
    if (trustProxy) {
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress;
  }

  // Анонимный id браузера для подсчёта игроков. В базе хранится только его хэш.
  function visitorOf(req) {
    let id = cookies(req).vid;
    let setCookie;
    if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) {
      id = newToken();
      setCookie = `vid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${VISITOR_TTL_SEC}${secureCookies ? '; Secure' : ''}`;
    }
    return { visitor: sha256(id), setCookie };
  }

  // ---------- роли ----------
  // Игрок — любой вошедший пользователь. Разработчик — пользователь с одобренной заявкой (или модератор).
  const developerStatus = (u) => q.application.get(u.id)?.status || 'none';
  const canPublish = (u) => isAdmin(u) || developerStatus(u) === 'approved';
  const publicUser = (u) => ({
    id: u.id, email: u.email, name: u.name, isAdmin: isAdmin(u), role: roleOf(u), canModerate: isModerator(u),
    developer: developerStatus(u), canPublish: canPublish(u),
    emailVerified: !!u.email_verified_at, coins: u.coins ?? 0,
  });

  function requireDeveloper(req) {
    const user = requireUser(req);
    if (!canPublish(user)) throw new HttpError(403, 'Публиковать игры могут разработчики с одобренной заявкой');
    return user;
  }

  // Заявку разработчика и отзывы принимаем только с подтверждённой почтой. Пока почта не настроена
  // (локальная разработка), подтверждать нечем — тогда не требуем.
  function requireVerified(user) {
    if (mailer.enabled && !user.email_verified_at && !isAdmin(user)) {
      throw new HttpError(403, 'Сначала подтвердите почту: ссылка в письме, отправить ещё раз можно в профиле');
    }
  }

  // Id игрока внутри одной игры — тот же, что страница даёт игре (sdk-host.js, playerIdFor).
  const playerIdOf = (userId, gameId) => sha256(`igrodrom:${userId}:${gameId}`).slice(0, 24);

  // Сохранения вошедшего игрока хранятся за аккаунтом, гостя — за браузером.
  const userSaveKey = (userId) => `user:${userId}`;

  // При входе прогресс, накопленный гостем в этом браузере, переезжает в аккаунт.
  // Если у аккаунта уже есть сохранение этой игры, остаётся более свежее.
  function adoptGuestSaves(req, userId) {
    const token = cookies(req).vid;
    if (!token) return;
    const guest = sha256(token);
    const target = userSaveKey(userId);
    const mine = new Map(q.savesOf.all(target).map((s) => [s.game_id, s.updated_at]));
    db.exec('BEGIN');
    try {
      for (const s of q.savesOf.all(guest)) {
        if (!mine.has(s.game_id)) q.moveSave.run(target, s.game_id, guest);
        else if (s.updated_at > mine.get(s.game_id)) {
          q.deleteSave.run(s.game_id, target);
          q.moveSave.run(target, s.game_id, guest);
        } else q.deleteSave.run(s.game_id, guest);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---------- API ----------

  async function register(req, res) {
    const { email: rawEmail, password, name: rawName, ticket, website } = await readJson(req);
    const email = String(rawEmail || '').trim().toLowerCase();
    const name = String(rawName || '').trim();
    // website — поле-ловушка: человек его не видит, а боты заполняют все поля подряд.
    if (website) throw new HttpError(400, 'Не получилось создать аккаунт');
    const ip = clientIp(req);
    if (registerGuard) {
      checkTicket(req, ticket);
      if (registerHourLimiter.blocked(ip) || registerDayLimiter.blocked(ip)) {
        throw new HttpError(429, 'С этого адреса уже создано много аккаунтов. Попробуйте позже');
      }
    }
    if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Некорректный email');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
      throw new HttpError(400, 'Пароль: от 8 до 200 символов');
    }
    if (name.length < 2 || name.length > 40) throw new HttpError(400, 'Имя: от 2 до 40 символов');
    if (NAME_SPAM_RE.test(name)) throw new HttpError(400, 'В имени не должно быть ссылок и адресов');
    if (q.userByEmail.get(email)) throw new HttpError(409, 'Этот email уже зарегистрирован');
    if (registerGuard) { registerHourLimiter.fail(ip); registerDayLimiter.fail(ip); }

    const { lastInsertRowid } = q.insertUser.run(email, name, await hashPassword(password), Date.now());
    const user = { id: Number(lastInsertRowid), email, name, coins: 0 };
    adoptGuestSaves(req, user.id);
    sendVerification(user);
    send(res, 201, { user: publicUser(user) }, { 'Set-Cookie': startSession(user.id) });
  }

  // ---------- почта: подтверждение и сброс пароля ----------
  // В письме — одноразовая ссылка со случайным токеном; в базе только его хэш.
  function issueToken(userId, kind, ttlMs) {
    q.purgeTokens.run(Date.now());
    q.deleteTokens.run(userId, kind); // действует только последняя ссылка
    const token = newToken();
    q.insertToken.run(sha256(token), userId, kind, Date.now() + ttlMs, Date.now());
    return token;
  }

  function takeToken(token, kind) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = q.token.get(sha256(token));
    if (!row || row.kind !== kind || row.expires_at <= Date.now()) return null;
    q.deleteToken.run(row.token_hash);
    return row;
  }

  function sendMail(to, subject, text) {
    Promise.resolve()
      .then(() => mailer.send({ to, subject, text }))
      .catch((err) => console.error(`Письмо «${subject}» не отправлено:`, err.message));
  }

  function sendVerification(user) {
    const token = issueToken(user.id, 'verify', VERIFY_TTL_MS);
    sendMail(user.email, 'Подтвердите почту на Игродроме', [
      `Здравствуйте, ${user.name}!`, '',
      'Чтобы подтвердить почту, откройте ссылку:', `${siteUrl}/verify.html?token=${token}`, '',
      'Ссылка действует 3 дня. Если вы не регистрировались на Игродроме, просто удалите это письмо.',
    ].join('\n'));
  }

  async function forgotPassword(req, res) {
    const email = String((await readJson(req)).email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Некорректный email');
    const key = `reset|${clientIp(req)}|${email}`;
    if (mailLimiter.blocked(key)) throw new HttpError(429, 'Слишком много запросов, попробуйте через час');
    mailLimiter.fail(key);
    const user = q.userByEmail.get(email);
    if (user && email !== STUDIO_EMAIL) {
      const token = issueToken(user.id, 'reset', RESET_TTL_MS);
      sendMail(user.email, 'Сброс пароля на Игродроме', [
        `Здравствуйте, ${user.name}!`, '',
        'Кто-то, возможно вы, попросил сбросить пароль. Задать новый пароль можно по ссылке:',
        `${siteUrl}/reset.html?token=${token}`, '',
        'Ссылка действует час. Если вы не просили сброс, ничего не делайте: пароль останется прежним.',
      ].join('\n'));
    }
    // Ответ одинаковый, есть аккаунт или нет: по нему нельзя узнать, кто зарегистрирован.
    send(res, 200, { ok: true });
  }

  async function resetPassword(req, res) {
    const { token, password } = await readJson(req);
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
      throw new HttpError(400, 'Пароль: от 8 до 200 символов');
    }
    const row = takeToken(token, 'reset');
    if (!row) throw new HttpError(400, 'Ссылка устарела или уже использована. Запросите новую');
    q.setPassword.run(await hashPassword(password), row.user_id);
    q.deleteUserSessions.run(row.user_id); // выходим на всех устройствах
    q.verifyEmail.run(Date.now(), row.user_id); // письмо дошло — значит, почта настоящая
    const user = q.userById.get(row.user_id);
    loginLimiter.reset(`${clientIp(req)}|${user.email}`);
    send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': startSession(user.id) });
  }

  async function confirmEmail(req, res) {
    const row = takeToken((await readJson(req)).token, 'verify');
    if (!row) throw new HttpError(400, 'Ссылка устарела или уже использована. Отправьте письмо ещё раз из профиля');
    q.verifyEmail.run(Date.now(), row.user_id);
    send(res, 200, { ok: true });
  }

  function resendVerification(req, res) {
    const user = requireUser(req);
    if (user.email_verified_at) throw new HttpError(409, 'Почта уже подтверждена');
    const key = `verify|${user.id}`;
    if (mailLimiter.blocked(key)) throw new HttpError(429, 'Письмо уже отправлено несколько раз, попробуйте через час');
    mailLimiter.fail(key);
    sendVerification(user);
    send(res, 200, { ok: true });
  }

  async function login(req, res) {
    const { email: rawEmail, password } = await readJson(req);
    const email = String(rawEmail || '').trim().toLowerCase();
    const key = `${clientIp(req)}|${email}`;
    if (loginLimiter.blocked(key)) throw new HttpError(429, 'Слишком много попыток, подождите 15 минут');

    const user = q.userByEmail.get(email);
    const ok = await verifyPassword(String(password || ''), user ? user.pass_hash : DUMMY_HASH);
    if (!user || !ok) {
      loginLimiter.fail(key);
      throw new HttpError(401, 'Неверный email или пароль');
    }
    loginLimiter.reset(key);
    adoptGuestSaves(req, user.id);
    send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': startSession(user.id) });
  }

  function logout(req, res) {
    const token = cookies(req).sid;
    if (token) q.deleteSession.run(sha256(token));
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  async function uploadGame(req, res, url) {
    const user = requireDeveloper(req);
    const title = String(url.searchParams.get('title') || '').trim();
    const genre = String(url.searchParams.get('genre') || '');
    if (title.length < 2 || title.length > 60) throw new HttpError(400, 'Название: от 2 до 60 символов');
    if (!CATEGORIES.includes(genre)) throw new HttpError(400, 'Неизвестная категория');

    const body = await readBody(req, MAX_UPLOAD_BYTES);
    if (body.length === 0) throw new HttpError(400, 'Пустой файл');

    let files;
    if (isZip(body)) {
      try {
        files = extractZip(body, { maxFiles: MAX_GAME_FILES, maxTotalBytes: MAX_UNZIPPED_BYTES });
      } catch (err) {
        if (err instanceof ZipError) throw new HttpError(400, err.message);
        throw err;
      }
    } else {
      if (body.length > MAX_HTML_BYTES) throw new HttpError(413, 'HTML-файл больше 5 МБ, загрузите игру ZIP-архивом');
      files = [{ path: 'index.html', data: body }];
    }
    const index = files.find((f) => f.path === 'index.html');
    if (!/<\s*(html|body|script|canvas|div)\b/i.test(index.data.subarray(0, 64 * 1024).toString('utf8'))) {
      throw new HttpError(400, 'index.html не похож на HTML-игру');
    }

    const yandexSdk = adaptYandexSdk(files);

    const id = newGameId();
    const tmp = `${gameDir(id)}.tmp`;
    try {
      for (const f of files) {
        const dest = path.join(tmp, f.path);
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.writeFile(dest, f.data);
      }
      await fs.promises.rename(tmp, gameDir(id));
    } catch (err) {
      await fs.promises.rm(tmp, { recursive: true, force: true });
      // A file and a folder with the same name ("a" and "a/b") cannot both exist on disk.
      if (['ENOTDIR', 'EISDIR', 'EEXIST'].includes(err.code)) throw new HttpError(400, 'Конфликт путей в архиве');
      throw err;
    }
    const size = files.reduce((n, f) => n + f.data.length, 0);
    const now = Date.now();
    const cover = COVER_FILES.find((name) => files.some((f) => f.path === name)) || null;
    const icon = ICON_FILES.find((name) => files.some((f) => f.path === name)) || null;
    q.insertGame.run(id, user.id, title, genre, size, files.length, cover, icon, now, now);
    send(res, 201, {
      game: {
        id, title, genre, cover, icon, status: 'pending', size, file_count: files.length, created_at: now, preview_url: previewUrl(id),
      },
      yandex_sdk: yandexSdk,
    });
  }

  async function deleteGame(req, res, id) {
    const user = requireUser(req);
    const game = q.game.get(id);
    if (!game || (game.author_id !== user.id && !isAdmin(user))) throw new HttpError(404, 'Игра не найдена');
    if (game.author_id !== user.id) logAction(user, 'game.delete', id, game.title);
    q.deleteGame.run(id);
    await fs.promises.rm(gameDir(id), { recursive: true, force: true });
    send(res, 200, { ok: true });
  }

  async function moderate(req, res, id) {
    const user = requireModerator(req);
    const { action, reason } = await readJson(req);
    const game = q.game.get(id);
    if (!game) throw new HttpError(404, 'Игра не найдена');
    // Свою игру модератор не проверяет: это делает другой модератор или владелец.
    if (game.author_id === user.id && !isAdmin(user)) throw new HttpError(403, 'Свою игру проверяет другой модератор');
    if (action === 'approve') {
      q.setStatus.run('approved', null, Date.now(), id);
      logAction(user, 'game.approve', id, game.title);
    } else if (action === 'reject') {
      // Отказ и снятие с публикации — всегда с причиной: её увидит разработчик.
      const why = String(reason || '').trim();
      if (why.length < 3) throw new HttpError(400, 'Напишите причину — её увидит разработчик');
      q.setStatus.run('rejected', why.slice(0, 300), Date.now(), id);
      logAction(user, 'game.reject', id, game.title, why.slice(0, 300));
    } else throw new HttpError(400, 'action: approve или reject');
    send(res, 200, { ok: true });
  }

  // Карточка игры: всё, что нужно странице игры.
  function gameDetails(req, res, id) {
    const game = q.publicGame.get(id);
    if (!game) throw new HttpError(404, 'Игра не найдена');
    const token = cookies(req).vid;
    const vote = token ? q.myVote.get(id, sha256(token)) : null;
    send(res, 200, { game: { ...game, my_vote: vote ? vote.value : 0 } });
  }

  // Автор меняет описание, правила, категорию, возраст и название.
  async function updateGame(req, res, id) {
    const user = requireDeveloper(req);
    const game = q.game.get(id);
    if (!game || game.author_id !== user.id) throw new HttpError(404, 'Игра не найдена');
    const body = await readJson(req);
    const pick = (key, fallback) => (body[key] === undefined ? fallback : String(body[key]).trim());
    const title = pick('title', game.title);
    const genre = pick('genre', game.genre);
    const age = pick('age', game.age);
    const description = pick('description', game.description);
    const howToPlay = pick('how_to_play', game.how_to_play);
    if (title.length < 2 || title.length > 60) throw new HttpError(400, 'Название: от 2 до 60 символов');
    if (!CATEGORIES.includes(genre)) throw new HttpError(400, 'Неизвестная категория');
    if (!AGES.includes(age)) throw new HttpError(400, 'Неизвестная возрастная метка');
    if (description.length > 1500) throw new HttpError(400, 'Описание: до 1500 символов');
    if (howToPlay.length > 600) throw new HttpError(400, '«Как играть»: до 600 символов');
    q.updateMeta.run(title, genre, age, description, howToPlay, Date.now(), id);
    send(res, 200, { ok: true });
  }

  // Нравится / не нравится. value: 1, -1 или 0 (снять оценку).
  async function vote(req, res, id) {
    const { value } = await readJson(req);
    if (![1, -1, 0].includes(value)) throw new HttpError(400, 'value: 1, -1 или 0');
    if (!q.publicGame.get(id)) throw new HttpError(404, 'Игра не найдена');
    const { visitor, setCookie } = visitorOf(req);
    if (value === 0) q.deleteVote.run(id, visitor);
    else q.upsertVote.run(id, visitor, value, now());
    const { likes, dislikes } = q.publicGame.get(id);
    send(res, 200, { likes, dislikes, my_vote: value }, setCookie ? { 'Set-Cookie': setCookie } : {});
  }

  // ---------- заявки разработчиков ----------
  const appView = (a) => a && ({
    studio: a.studio, about: a.about, links: a.links, contact: a.contact,
    status: a.status, reason: a.reason, created_at: a.created_at, updated_at: a.updated_at,
  });

  async function applyDeveloper(req, res) {
    const user = requireUser(req);
    const current = q.application.get(user.id);
    if (current?.status === 'pending') throw new HttpError(409, 'Заявка уже на рассмотрении');
    if (current?.status === 'approved') throw new HttpError(409, 'Вы уже разработчик');
    requireVerified(user);
    const body = await readJson(req);
    const field = (k) => String(body[k] ?? '').trim();
    const studio = field('studio'), about = field('about'), links = field('links'), contact = field('contact');
    if (studio.length < 2 || studio.length > 60) throw new HttpError(400, 'Имя или студия: от 2 до 60 символов');
    if (about.length < 20 || about.length > 1500) throw new HttpError(400, 'Расскажите о себе и играх: от 20 до 1500 символов');
    if (links.length > 500) throw new HttpError(400, 'Ссылки: до 500 символов');
    if (contact.length < 3 || contact.length > 200) throw new HttpError(400, 'Как с вами связаться: от 3 до 200 символов');
    const t = now();
    q.upsertApplication.run(user.id, studio, about, links, contact, t, t);
    send(res, 201, { application: appView(q.application.get(user.id)) });
  }

  async function reviewDeveloper(req, res, userId) {
    const admin = requireModerator(req);
    const { action, reason } = await readJson(req);
    const app = q.application.get(userId);
    if (!app) throw new HttpError(404, 'Заявка не найдена');
    if (userId === admin.id && !isAdmin(admin)) throw new HttpError(403, 'Свою заявку проверяет другой модератор');
    if (action === 'approve') {
      q.setApplicationStatus.run('approved', null, now(), userId);
      logAction(admin, 'developer.approve', userId, app.studio);
    } else if (action === 'reject') {
      const why = String(reason || '').trim();
      if (why.length < 3) throw new HttpError(400, 'Напишите причину отказа — её увидит заявитель');
      q.setApplicationStatus.run('rejected', why.slice(0, 500), now(), userId);
      logAction(admin, 'developer.reject', userId, app.studio, why.slice(0, 500));
    } else throw new HttpError(400, 'action: approve или reject');
    send(res, 200, { ok: true });
  }

  // ---------- команда: модераторов назначает владелец ----------
  function teamList(req, res) {
    requireOwner(req);
    const owners = [...admins].map((email) => {
      const u = q.userByEmail.get(email);
      return { email, name: u ? u.name : null, registered: !!u };
    });
    send(res, 200, { owners, moderators: q.moderators.all() });
  }

  async function teamAdd(req, res) {
    const owner = requireOwner(req);
    const email = String((await readJson(req)).email || '').trim().toLowerCase();
    const user = q.userByEmail.get(email);
    // Модератором можно сделать только зарегистрированного: так у него уже есть пароль, а у нас — имя для журнала.
    if (!user || email === STUDIO_EMAIL) throw new HttpError(404, 'Нет аккаунта с такой почтой: пусть человек сначала зарегистрируется');
    if (isAdmin(user)) throw new HttpError(409, 'Это владелец площадки, у него и так все права');
    if (user.role === 'moderator') throw new HttpError(409, 'Уже модератор');
    q.setRole.run('moderator', Date.now(), user.id);
    logAction(owner, 'team.add', user.id, `${user.name} (${user.email})`);
    send(res, 201, { moderator: { id: user.id, name: user.name, email: user.email } });
  }

  function teamRemove(req, res, userId) {
    const owner = requireOwner(req);
    const user = q.userById.get(userId);
    if (!user || user.role !== 'moderator') throw new HttpError(404, 'Такого модератора нет');
    q.setRole.run('player', null, user.id);
    logAction(owner, 'team.remove', user.id, `${user.name} (${user.email})`);
    send(res, 200, { ok: true });
  }

  // ---------- сохранения (SDK) ----------
  // Игра сама сюда не ходит: она в песочнице без cookie. Запросы шлёт страница игры
  // по просьбе SDK, а id игры подставляет страница — чужое сохранение игра прочитать не может.
  function saveTarget(req, id) {
    if (!q.publicGame.get(id)) throw new HttpError(404, 'Игра не найдена');
    const user = currentUser(req);
    return user ? { visitor: userSaveKey(user.id) } : visitorOf(req);
  }

  function getSave(req, res, id) {
    const { visitor, setCookie } = saveTarget(req, id);
    const row = q.getSave.get(id, visitor);
    send(res, 200, { data: row ? JSON.parse(row.data) : null, updated_at: row ? row.updated_at : null },
      setCookie ? { 'Set-Cookie': setCookie } : {});
  }

  async function putSave(req, res, id) {
    const { visitor, setCookie } = saveTarget(req, id);
    if (saveLimiter.blocked(`${visitor}|${id}`)) throw new HttpError(429, 'Слишком частые сохранения');
    saveLimiter.fail(`${visitor}|${id}`); // считаем каждую запись
    const raw = (await readBody(req, MAX_SAVE_BYTES + 1024)).toString('utf8');
    let body;
    try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Некорректный JSON'); }
    if (!body || typeof body !== 'object' || !('data' in body)) throw new HttpError(400, 'Нужно поле data');
    const json = JSON.stringify(body.data);
    if (json === undefined) throw new HttpError(400, 'data должно быть JSON-значением');
    if (Buffer.byteLength(json) > MAX_SAVE_BYTES) {
      throw new HttpError(413, `Сохранение больше ${MAX_SAVE_BYTES / 1024} КБ`);
    }
    const t = now();
    q.putSave.run(id, visitor, json, t);
    send(res, 200, { ok: true, updated_at: t }, setCookie ? { 'Set-Cookie': setCookie } : {});
  }

  function deleteSave(req, res, id) {
    const { visitor } = saveTarget(req, id);
    q.deleteSave.run(id, visitor);
    send(res, 200, { ok: true });
  }

  function approvedGame(id) {
    const game = q.game.get(id);
    if (!game || game.status !== 'approved') throw new HttpError(404, 'Игра не найдена');
    return game;
  }

  // ---------- таблицы рекордов (SDK) ----------
  // В таблице — только вошедшие игроки, под своим именем. Хранится лучший результат; больше — лучше.
  function lbEntry(gameId, board, row, me) {
    const { n } = q.lbRank.get(gameId, board, row.score, row.score, row.updated_at);
    return {
      rank: n + 1, name: row.name, score: row.score, extra: row.extra || '',
      player: playerIdOf(row.user_id, gameId), me: !!me && row.user_id === me.id,
    };
  }

  function getLeaderboard(req, res, id, url) {
    approvedGame(id);
    const boards = q.lbBoards.all(id);
    const board = url.searchParams.get('board') || boards[0]?.board || 'main';
    if (!BOARD_RE.test(board)) throw new HttpError(400, 'Имя таблицы: латиница, цифры, «_», «-», «.», до 40 символов');
    const top = Math.min(100, Math.max(0, Number(url.searchParams.get('top') ?? 10) || 0));
    const around = Math.min(10, Math.max(0, Number(url.searchParams.get('around')) || 0));
    const user = currentUser(req);
    const mine = user ? q.lbMine.get(id, board, user.id) : null;
    const entries = q.lbTop.all(id, board, top).map((r, i) => ({
      rank: i + 1, name: r.name, score: r.score, extra: r.extra || '', player: playerIdOf(r.user_id, id), me: r.user_id === user?.id,
    }));
    let near = [];
    if (mine && around) {
      const above = q.lbAbove.all(id, board, mine.score, mine.score, mine.updated_at, around).reverse();
      const below = q.lbBelow.all(id, board, mine.score, mine.score, mine.updated_at, around);
      near = [...above, mine, ...below].map((r) => lbEntry(id, board, r, user));
    }
    send(res, 200, {
      board, boards, total: q.lbCount.get(id, board).n,
      entries, around: near, me: mine ? lbEntry(id, board, mine, user) : null,
    });
  }

  async function setScore(req, res, id) {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Войдите, чтобы попасть в таблицу рекордов');
    approvedGame(id);
    const body = await readJson(req);
    const board = body.board == null ? 'main' : String(body.board);
    const score = body.score;
    const extra = body.extra == null ? '' : String(body.extra);
    if (!BOARD_RE.test(board)) throw new HttpError(400, 'Имя таблицы: латиница, цифры, «_», «-», «.», до 40 символов');
    if (!Number.isSafeInteger(score) || Math.abs(score) > MAX_SCORE) throw new HttpError(400, 'score — целое число');
    if (extra.length > 128) throw new HttpError(400, 'extra: до 128 символов');
    const key = `${user.id}|${id}`;
    if (scoreLimiter.blocked(key)) throw new HttpError(429, 'Слишком часто');
    scoreLimiter.fail(key);
    const { changes } = q.lbUpsert.run(id, board, user.id, score, extra, now());
    send(res, 200, { improved: changes > 0, entry: lbEntry(id, board, q.lbMine.get(id, board, user.id), user) });
  }

  // ---------- монетки ----------
  // Страница игры раз в минуту, пока вкладка видна, сообщает, что игрок играет. Начисляем не чаще раза
  // в COIN_EVERY_MS на аккаунт (несколько вкладок не ускоряют) и не больше COIN_DAILY_CAP за день.
  function coinTick(req, res, id) {
    const user = currentUser(req);
    if (!user) return send(res, 200, { earned: 0, coins: null });
    approvedGame(id);
    const t = now();
    const day = stats.dayOf(t);
    const today = q.coinDay.get(user.id, day)?.earned ?? 0;
    const last = q.coinLastTick.get(user.id)?.t ?? 0;
    let earned = 0;
    if (today < COIN_DAILY_CAP && t - last >= COIN_EVERY_MS && !stats.isBot(req.headers['user-agent'])) {
      db.exec('BEGIN');
      try {
        q.coinEarn.run(user.id, day, t);
        q.addCoins.run(1, user.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      earned = 1;
    }
    send(res, 200, { earned, coins: q.coinsOf.get(user.id).coins, today: today + earned, cap: COIN_DAILY_CAP });
  }

  // Трата из игры. Игра в песочнице и сама сюда не ходит: запрос шлёт страница игры после того,
  // как игрок подтвердил покупку в окне площадки.
  async function spendCoins(req, res, id) {
    const user = requireUser(req);
    const game = approvedGame(id);
    const { amount, title: rawTitle } = await readJson(req);
    const title = String(rawTitle ?? '').trim();
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_SPEND) throw new HttpError(400, `amount: целое от 1 до ${MAX_SPEND}`);
    if (title.length < 1 || title.length > 60) throw new HttpError(400, 'Название покупки: от 1 до 60 символов');
    const key = `${user.id}`;
    if (spendLimiter.blocked(key)) throw new HttpError(429, 'Слишком часто');
    spendLimiter.fail(key);
    db.exec('BEGIN');
    try {
      const { changes } = q.takeCoins.run(amount, user.id, amount);
      if (!changes) throw new HttpError(409, 'Не хватает монет');
      q.insertSpend.run(user.id, id, game.title, amount, title, now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    send(res, 200, { ok: true, coins: q.coinsOf.get(user.id).coins });
  }

  function myCoins(req, res) {
    const user = requireUser(req);
    const today = q.coinDay.get(user.id, stats.dayOf(now()))?.earned ?? 0;
    send(res, 200, {
      coins: q.coinsOf.get(user.id).coins, today, cap: COIN_DAILY_CAP,
      days: q.coinDays.all(user.id), spends: q.spends.all(user.id),
    });
  }

  // ---------- отзывы ----------
  function getReviews(req, res, id) {
    approvedGame(id);
    const user = currentUser(req);
    const reviews = q.reviews.all(id).map((r) => ({
      id: playerIdOf(r.user_id, id), name: r.name, text: r.text, created_at: r.created_at, updated_at: r.updated_at,
      mine: r.user_id === user?.id,
    }));
    send(res, 200, { reviews, total: q.reviewCount.get(id).n, canModerate: isModerator(user) });
  }

  async function putReview(req, res, id) {
    const user = requireUser(req);
    approvedGame(id);
    requireVerified(user);
    const text = String((await readJson(req)).text ?? '').trim().replace(/\n{3,}/g, '\n\n');
    if (text.length < 3 || text.length > 1000) throw new HttpError(400, 'Отзыв: от 3 до 1000 символов');
    const key = `${user.id}`;
    if (reviewLimiter.blocked(key)) throw new HttpError(429, 'Слишком много отзывов за час');
    reviewLimiter.fail(key);
    const t = now();
    q.upsertReview.run(id, user.id, text, t, t);
    send(res, 200, { review: { id: playerIdOf(user.id, id), name: user.name, text, mine: true, ...q.myReview.get(id, user.id) } });
  }

  function deleteMyReview(req, res, id) {
    const user = requireUser(req);
    q.deleteReview.run(id, user.id);
    send(res, 200, { ok: true });
  }

  // Модератор удаляет чужой отзыв (оскорбления, спам). Решение попадает в журнал.
  function removeReview(req, res, id, reviewId) {
    const mod = requireModerator(req);
    const game = q.game.get(id);
    const row = game && q.reviews.all(id).find((r) => playerIdOf(r.user_id, id) === reviewId);
    if (!row) throw new HttpError(404, 'Отзыв не найден');
    q.deleteReview.run(id, row.user_id);
    logAction(mod, 'review.delete', id, `${game.title}: отзыв ${row.name}`, row.text.slice(0, 300));
    send(res, 200, { ok: true });
  }

  function playStart(req, res, id) {
    const game = q.game.get(id);
    if (!game || game.status !== 'approved') throw new HttpError(404, 'Игра не найдена');
    if (stats.isBot(req.headers['user-agent'])) return send(res, 200, { counted: false });
    const { visitor, setCookie } = visitorOf(req);
    const counted = stats.recordStart(id, visitor, clientIp(req));
    send(res, 200, { counted }, setCookie ? { 'Set-Cookie': setCookie } : {});
  }

  // Показ рекламы: страница игры сообщает после показа. Считаем только при включённой сети.
  async function adShown(req, res, id) {
    const { kind } = await readJson(req);
    const game = q.game.get(id);
    if (!game || game.status !== 'approved') throw new HttpError(404, 'Игра не найдена');
    const counted = ads.provider !== 'none' || ads.banner !== 'none'
      ? !stats.isBot(req.headers['user-agent']) && stats.recordAd(id, String(kind), clientIp(req))
      : false;
    send(res, 200, { counted });
  }

  // ads.txt: файл DATA_DIR/ads.txt или строки из ADS_TXT. Сети проверяют его в корне домена.
  function adsTxt(req, res) {
    let body = '';
    try { body = fs.readFileSync(path.join(dataDir, 'ads.txt'), 'utf8'); } catch { body = ads.adsTxt; }
    if (!body.trim()) return notFound(res, 'ads.txt не настроен');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.end(body.endsWith('\n') ? body : `${body}\n`);
  }

  // ---------- поисковики и превью ссылок ----------

  function robotsTxt(req, res) {
    const body = ['User-agent: *', ...NOINDEX.map((p) => `Disallow: ${p}`), '', `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.end(body);
  }

  function sitemapXml(req, res) {
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const games = q.publicGames.all();
    const newest = Math.max(0, ...games.map((g) => g.created_at));
    const urls = [
      { loc: `${siteUrl}/`, lastmod: newest ? day(newest) : null },
      ...games.map((g) => ({ loc: `${siteUrl}/game.html?id=${g.id}`, lastmod: day(g.created_at) })),
      ...['developers.html', 'terms.html', 'privacy.html', 'contacts.html'].map((f) => ({ loc: `${siteUrl}/${f}` })),
    ];
    const body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((u) => `  <url><loc>${escHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') +
      '\n</urlset>\n';
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.end(body);
  }

  function ogImageOf(game) {
    const own = OG_FILES.find((f) => fs.existsSync(path.join(gameDir(game.id), f)));
    const file = own || (game.cover && RASTER_RE.test(game.cover) ? game.cover : null);
    return file ? `${siteUrl}/play/${game.id}/${encodeURIComponent(file)}` : `${siteUrl}/og.jpg`;
  }

  // Заголовок, описание и картинка для превью — в HTML до запуска скриптов: Telegram, ВК и поисковики
  // скрипты не выполняют. У страницы игры они свои, у остальных — из <title> и description самой страницы.
  function withMeta(html, rel, url) {
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const description = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
    let meta = { title, description, image: `${siteUrl}/og.jpg`, url: `${siteUrl}${rel === '/index.html' ? '/' : rel}`, type: 'website' };
    if (rel === '/game.html') {
      const id = url.searchParams.get('id');
      const game = id && /^[0-9a-f]{16}$/.test(id) ? q.publicGame.get(id) : null;
      if (game) {
        const text = String(game.description || '').replace(/\s+/g, ' ').trim();
        meta = {
          title: `${game.title} — играть онлайн бесплатно`,
          description: text.length > 200 ? `${text.slice(0, 197).replace(/\s+\S*$/, '')}…` : text || `${game.genre}: играйте в браузере без скачивания.`,
          image: ogImageOf(game), url: `${siteUrl}/game.html?id=${game.id}`, type: 'website',
        };
      }
    }
    const e = escHtml;
    const tags = [
      `<meta property="og:type" content="${meta.type}">`,
      `<meta property="og:title" content="${e(meta.title)}">`,
      meta.description && `<meta property="og:description" content="${e(meta.description)}">`,
      `<meta property="og:url" content="${e(meta.url)}">`,
      `<meta property="og:image" content="${e(meta.image)}">`,
      '<meta name="twitter:card" content="summary_large_image">',
      `<link rel="canonical" href="${e(meta.url)}">`,
    ].filter(Boolean).join('\n');
    let out = html.replace(/<title>[^<]*<\/title>/, `<title>${e(meta.title)}</title>`);
    if (meta.description) {
      out = description ? out.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${e(meta.description)}">`)
        : out.replace('</title>', `</title>\n<meta name="description" content="${e(meta.description)}">`);
    }
    return out.replace('</head>', `${tags}\n</head>`);
  }

  async function playEnd(req, res, id) {
    const { seconds } = await readJson(req);
    const token = cookies(req).vid;
    const recorded = token && q.game.get(id) ? stats.recordEnd(id, sha256(token), seconds) : false;
    send(res, 200, { recorded });
  }

  function notFound(res, text = 'Игра не найдена') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end(text);
  }

  // /play/<id>/<file> — only approved games.
  function playGame(req, res, id, rest) {
    const game = q.game.get(id);
    if (!game || game.status !== 'approved') return notFound(res);
    serveGameFile(req, res, id, rest, 'public, max-age=300');
  }

  // /preview/<id>.<exp>.<sig>/<file> — any status, for the author and moderators.
  function previewGame(req, res, id, exp, sig, rest) {
    if (!previewValid(id, exp, sig)) return notFound(res, 'Ссылка устарела: обновите страницу кабинета');
    if (!q.game.get(id)) return notFound(res);
    serveGameFile(req, res, id, rest, 'private, no-store');
  }

  function serveGameFile(req, res, id, rest, cacheControl) {
    let rel;
    try { rel = decodeURIComponent(rest); } catch { return notFound(res, 'Файл не найден'); }
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const root = gameDir(id);
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return notFound(res, 'Файл не найден');

    const ext = path.extname(file).toLowerCase();
    const encoding = ENCODINGS[ext];
    const typeExt = encoding ? path.extname(file.slice(0, -ext.length)).toLowerCase() : ext;
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return notFound(res, 'Файл не найден');
      res.writeHead(200, {
        'Content-Type': MIME[typeExt] || 'application/octet-stream',
        ...(encoding && { 'Content-Encoding': encoding }),
        'Content-Length': st.size,
        'Content-Security-Policy': GAME_CSP,
        // The sandboxed game has an opaque origin, so its own fetch() calls are cross-origin.
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': cacheControl,
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const pageHeaders = (type) => ({
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
  });

  // Нет такой страницы: человеку — страница 404 сайта, а не голый текст.
  function pageNotFound(req, res) {
    fs.readFile(path.join(publicDir, '404.html'), 'utf8', (err, html) => {
      if (err) return send(res, 404, { error: 'Not found' });
      res.writeHead(404, { ...pageHeaders(MIME['.html']), 'Cache-Control': 'no-store' });
      // base: ссылки в странице относительные, а 404 может открыться на любом вложенном адресе.
      res.end(req.method === 'HEAD' ? undefined
        : html.replace('<head>', '<head>\n<base href="/">').replace('</head>', '<meta name="robots" content="noindex">\n</head>'));
    });
  }

  function serveStatic(req, res, url) {
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'Bad path' }); }
    if (rel === '/') rel = '/index.html';
    if (rel === '/cabinet') rel = '/cabinet.html';
    const file = path.resolve(publicDir, `.${rel}`);
    if (!file.startsWith(publicDir + path.sep)) return pageNotFound(req, res);

    fs.stat(file, (err, st) => {
      if (err || !st.isFile() || rel === '/404.html') return pageNotFound(req, res);
      const ext = path.extname(file);
      if (ext === '.html') {
        return fs.readFile(file, 'utf8', (readErr, html) => {
          if (readErr) return pageNotFound(req, res);
          res.writeHead(200, pageHeaders(MIME[ext]));
          res.end(req.method === 'HEAD' ? undefined : withMeta(html, rel, url));
        });
      }
      res.writeHead(200, pageHeaders(MIME[ext] || 'application/octet-stream'));
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  // ---------- router ----------

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const m = req.method;
    if (m !== 'GET' && m !== 'HEAD') checkOrigin(req);

    if (p === '/healthz' && m === 'GET') {
      db.prepare('SELECT 1').get();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/config' && m === 'GET') return send(res, 200, { ...publicConfig(ads, site), mail: mailer.enabled });
    if (p === '/ads.txt' && (m === 'GET' || m === 'HEAD')) return adsTxt(req, res);
    if (p === '/robots.txt' && (m === 'GET' || m === 'HEAD')) return robotsTxt(req, res);
    if (p === '/sitemap.xml' && (m === 'GET' || m === 'HEAD')) return sitemapXml(req, res);
    if (p === '/api/register/ticket' && m === 'GET') return send(res, 200, { ticket: formTicket(req) });
    if (p === '/api/register' && m === 'POST') return register(req, res);
    if (p === '/api/login' && m === 'POST') return login(req, res);
    if (p === '/api/logout' && m === 'POST') return logout(req, res);
    if (p === '/api/password/forgot' && m === 'POST') return forgotPassword(req, res);
    if (p === '/api/password/reset' && m === 'POST') return resetPassword(req, res);
    if (p === '/api/email/verify' && m === 'POST') return confirmEmail(req, res);
    if (p === '/api/email/resend' && m === 'POST') return resendVerification(req, res);
    if (p === '/api/me/coins' && m === 'GET') return myCoins(req, res);
    if (p === '/api/me' && m === 'GET') {
      const u = currentUser(req);
      return send(res, 200, { user: u ? publicUser(u) : null });
    }
    if ((p === '/api/categories' || p === '/api/genres') && m === 'GET') {
      return send(res, 200, { categories: CATEGORIES, genres: CATEGORIES, ages: AGES });
    }
    if (p === '/api/games' && m === 'GET') return send(res, 200, { games: q.publicGames.all() });
    if (p === '/api/games' && m === 'POST') return uploadGame(req, res, url);
    let mm;
    if (p === '/api/me/recent' && m === 'GET') {
      // «Продолжить играть»: игры, в которых у игрока есть сохранение.
      return send(res, 200, { games: q.recentGames.all(userSaveKey(requireUser(req).id)) });
    }
    if (p === '/api/recent' && m === 'GET') {
      // То же для главной: вошедшему — по аккаунту, гостю — по этому браузеру.
      const user = currentUser(req);
      const token = cookies(req).vid;
      const key = user ? userSaveKey(user.id) : token ? sha256(token) : null;
      return send(res, 200, { games: key ? q.recentGames.all(key) : [] });
    }
    if (p === '/api/developer/application' && m === 'GET') {
      return send(res, 200, { application: appView(q.application.get(requireUser(req).id)) || null });
    }
    if (p === '/api/developer/application' && m === 'POST') return applyDeveloper(req, res);
    if (p === '/api/admin/developers' && m === 'GET') {
      requireModerator(req);
      const status = url.searchParams.get('status') || 'pending';
      if (!['pending', 'approved', 'rejected'].includes(status)) throw new HttpError(400, 'Неизвестный статус');
      return send(res, 200, {
        applications: q.applicationsByStatus.all(status).map((a) => ({ user_id: a.user_id, name: a.name, email: a.email, ...appView(a) })),
      });
    }
    if ((mm = p.match(/^\/api\/admin\/developers\/(\d+)$/)) && m === 'POST') return reviewDeveloper(req, res, Number(mm[1]));
    if (p === '/api/my/games' && m === 'GET') {
      return send(res, 200, { games: withPreview(q.myGames.all(requireDeveloper(req).id)) });
    }

    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})$/)) && m === 'DELETE') return deleteGame(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})$/)) && m === 'GET') return gameDetails(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})$/)) && m === 'PATCH') return updateGame(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/vote$/)) && m === 'POST') return vote(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/save$/))) {
      if (m === 'GET') return getSave(req, res, mm[1]);
      if (m === 'PUT') return putSave(req, res, mm[1]);
      if (m === 'DELETE') return deleteSave(req, res, mm[1]);
    }
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/leaderboard$/))) {
      if (m === 'GET') return getLeaderboard(req, res, mm[1], url);
      if (m === 'POST') return setScore(req, res, mm[1]);
    }
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/reviews$/))) {
      if (m === 'GET') return getReviews(req, res, mm[1]);
      if (m === 'PUT') return putReview(req, res, mm[1]);
      if (m === 'DELETE') return deleteMyReview(req, res, mm[1]);
    }
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/reviews\/([0-9a-f]{24})$/)) && m === 'DELETE') return removeReview(req, res, mm[1], mm[2]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/coins\/tick$/)) && m === 'POST') return coinTick(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/coins\/spend$/)) && m === 'POST') return spendCoins(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/play$/)) && m === 'POST') return playStart(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/play-end$/)) && m === 'POST') return playEnd(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/ad$/)) && m === 'POST') return adShown(req, res, mm[1]);
    if (p === '/api/my/stats' && m === 'GET') {
      const user = requireDeveloper(req);
      const days = Number(url.searchParams.get('days') || 30);
      if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpError(400, 'days: от 1 до 365');
      return send(res, 200, stats.authorStats(user.id, days));
    }
    if ((mm = p.match(/^\/api\/admin\/games\/([0-9a-f]{16})$/)) && m === 'POST') return moderate(req, res, mm[1]);
    if (p === '/api/admin/games' && m === 'GET') {
      requireModerator(req);
      const status = url.searchParams.get('status') || 'pending';
      if (!['pending', 'approved', 'rejected'].includes(status)) throw new HttpError(400, 'Неизвестный статус');
      return send(res, 200, { games: withPreview(q.gamesByStatus.all(status)) });
    }
    if (p === '/api/admin/log' && m === 'GET') {
      requireModerator(req);
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
      return send(res, 200, { entries: q.logRecent.all(limit) });
    }
    if (p === '/api/admin/team' && m === 'GET') return teamList(req, res);
    if (p === '/api/admin/team' && m === 'POST') return teamAdd(req, res);
    if ((mm = p.match(/^\/api\/admin\/team\/(\d+)$/)) && m === 'DELETE') return teamRemove(req, res, Number(mm[1]));
    const isRead = m === 'GET' || m === 'HEAD';
    if ((mm = p.match(/^\/(play\/[0-9a-f]{16}|preview\/[0-9a-f]{16}\.\d+\.[0-9a-f]{32})$/)) && isRead) {
      // Relative paths inside the game resolve against the folder, so it needs a trailing slash.
      res.writeHead(301, { Location: `${p}/${url.search}` });
      return res.end();
    }
    if ((mm = p.match(/^\/play\/([0-9a-f]{16})\/(.*)$/)) && isRead) return playGame(req, res, mm[1], mm[2]);
    if ((mm = p.match(/^\/preview\/([0-9a-f]{16})\.(\d+)\.([0-9a-f]{32})\/(.*)$/)) && isRead) {
      return previewGame(req, res, mm[1], mm[2], mm[3], mm[4]);
    }
    if (p.startsWith('/api/')) throw new HttpError(404, 'Нет такого метода');
    if (isRead) return serveStatic(req, res, url);
    throw new HttpError(405, 'Метод не поддерживается');
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      if (res.headersSent) { res.destroy(); return; }
      if (err instanceof HttpError) {
        // Close the connection after a rejected upload so the client stops sending the body.
        send(res, err.status, { error: err.message }, err.status === 413 ? { Connection: 'close' } : {});
      } else {
        console.error(err);
        send(res, 500, { error: 'Внутренняя ошибка сервера' });
      }
    });
  });
  server.on('close', () => db.close());
  return server;
}

// Игра с Яндекс Игр: ссылки на их SDK ведут на наш /sdk.js. Меняем только HTML и JS, в которых
// есть такие ссылки; работаем с байтами как с latin1, чтобы не испортить файлы не в UTF-8.
// Возвращает true, если игра использует Яндекс SDK.
export function adaptYandexSdk(files) {
  const hasOwnSdk = files.some((f) => f.path === 'sdk.js');
  let found = false;
  for (const f of files) {
    const isHtml = /\.html?$/i.test(f.path);
    if (!isHtml && !/\.m?js$/i.test(f.path)) continue;
    const text = f.data.toString('latin1');
    let out = text.replace(YANDEX_SDK_URL, '/sdk.js');
    if (isHtml && !hasOwnSdk) out = out.replace(RELATIVE_SDK, '$1/sdk.js$2');
    if (out !== text) f.data = Buffer.from(out, 'latin1');
    // Подключение может быть и тегом, и из скрипта: s.src = '/sdk.js'.
    if (out !== text || /["']\/sdk\.js["']/.test(out)) found = true;
  }
  return found;
}

// v0.2 stored single-file games as games/<id>.html; v0.3 keeps every game in games/<id>/.
function migrateSingleFileGames(gamesDir) {
  for (const name of fs.readdirSync(gamesDir)) {
    const m = name.match(/^([0-9a-f]{16})\.html$/);
    if (!m) continue;
    fs.mkdirSync(path.join(gamesDir, m[1]), { recursive: true });
    fs.renameSync(path.join(gamesDir, name), path.join(gamesDir, m[1], 'index.html'));
  }
}
