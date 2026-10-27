import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { openDb } from './db.js';
import { extractZip, isZip, ZipError } from './zip.js';
import { createStats } from './stats.js';
import { adsFromEnv, siteFromEnv, publicConfig } from './config.js';
import { logMailer } from './mail.js';
import { createEconomy, migrateLedger, packsFromEnv, yookassaFromEnv } from './economy.js';
import { createAvatars, migrateAvatars, avatarUrl } from './avatars.js';
import { createGameDev, migrateGameMeta, metaView } from './gamedev.js';
import { createDevRef } from './devref.js';
import { createAdmin, migrateAdmin } from './admin.js';
import { createRewards, migrateRewards } from './rewards.js';
import { createSupport, migrateSupport } from './support.js';
import { createShop, migrateShop, LOOK_COLS } from './shop.js';
import { createPartners, migratePartners } from './partners.js';
import { createSources, migrateSources } from './sources.js';
import { createTgTasks, migrateTgTasks, telegramFromEnv } from './tgtasks.js';
import { slugify } from './slug.js';
import {
  hashPassword, verifyPassword, DUMMY_HASH, newToken, sha256, newGameId, createLimiter,
} from './auth.js';

export const CATEGORIES = [
  'Аркады', 'Головоломки', 'Три в ряд', 'Казуальные', 'Настольные', 'Карточные', 'Стратегии', 'Гонки',
  'Симуляторы', 'Приключения', 'Спорт', 'Викторины', 'Обучающие', 'Для двоих', 'Кликеры', 'Прочее',
];
export const GENRES = CATEGORIES; // старое имя
export const AGES = ['0+', '6+', '12+', '16+', '18+'];
const STUDIO_EMAIL = 'studio@igrodrom.local'; // владелец демо-игр (адрес служебный, не меняется)
const STUDIO_NAME = 'Gamely';
const COVER_FILES = ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp', 'cover.svg'];
const ICON_FILES = ['icon.png', 'icon.jpg', 'icon.jpeg', 'icon.webp', 'icon.svg'];
const RATING_SQL = `(SELECT COUNT(*) FROM game_votes v WHERE v.game_id = g.id AND v.value = 1) AS likes,
                    (SELECT COUNT(*) FROM game_votes v WHERE v.game_id = g.id AND v.value = -1) AS dislikes,
                    (SELECT COALESCE(SUM(plays), 0) FROM play_daily d WHERE d.game_id = g.id) AS plays`;
// Автор игры для игроков — название студии из заявки разработчика, у демо-игр — имя площадки.
const AUTHOR_SQL = `CASE WHEN u.email = '${STUDIO_EMAIL}' THEN u.name ELSE COALESCE((SELECT a.studio FROM developer_applications a
                      WHERE a.user_id = g.author_id AND a.status = 'approved'), u.name) END AS author`;
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
const MAX_SPEND = 1000; // монеток за одну покупку в игре
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
// Префиксы: закрывают и чистые адреса (/login), и старые (/login.html).
const NOINDEX = ['/api/', '/preview/', '/preview-next/', '/test-run/', '/cabinet', '/admin', '/account', '/login', '/reset', '/verify', '/partner', '/overlay', '/p/'];

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
// Журнал тестового запуска: сервер подключает его в HTML игры только по ссылке /test-run/…
const TEST_CONSOLE_JS = fs.readFileSync(new URL('./test-console.js', import.meta.url));

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
  // Магазин монеток: пакеты и ЮKassa из .env; fetchImpl подменяют тесты.
  coinPacks = packsFromEnv(), yookassa = yookassaFromEnv(), fetchImpl = fetch,
  // Бот Gamely для заданий «подпишитесь на канал» (server/tgtasks.js).
  telegram = telegramFromEnv({}),
}) {
  siteUrl = siteUrl.replace(/\/+$/, '');
  const gamesDir = path.join(dataDir, 'games');
  fs.mkdirSync(gamesDir, { recursive: true });
  migrateSingleFileGames(gamesDir);
  const db = openDb(path.join(dataDir, 'igrodrom.db'));
  migrateLedger(db);
  migrateAvatars(db);
  migrateGameMeta(db);
  migrateAdmin(db);
  migrateRewards(db);
  migrateSupport(db);
  migrateShop(db);
  migratePartners(db);
  migrateSources(db);
  migrateTgTasks(db);
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
    sessionUser: db.prepare(`SELECT u.id, u.email, u.name, u.role, u.email_verified_at, u.coins, u.avatar, u.avatar_pending, u.avatar_note, u.last_seen_at, ${LOOK_COLS} FROM sessions s JOIN users u ON u.id = s.user_id
                             WHERE s.token_hash = ? AND s.expires_at > ? AND u.blocked_at IS NULL`),
    touchUser: db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    setPassword: db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?'),
    verifyEmail: db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL'),
    insertToken: db.prepare('INSERT INTO email_tokens (token_hash, user_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'),
    token: db.prepare('SELECT * FROM email_tokens WHERE token_hash = ?'),
    deleteToken: db.prepare('DELETE FROM email_tokens WHERE token_hash = ?'),
    deleteTokens: db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?'),
    purgeTokens: db.prepare('DELETE FROM email_tokens WHERE expires_at <= ?'),
    lbTop: db.prepare(`SELECT s.user_id, s.score, s.extra, s.updated_at, u.name, u.avatar, ${LOOK_COLS} FROM leaderboard_scores s JOIN users u ON u.id = s.user_id
                       WHERE s.game_id = ? AND s.board = ? ORDER BY s.score DESC, s.updated_at ASC LIMIT ?`),
    lbMine: db.prepare(`SELECT s.user_id, s.score, s.extra, s.updated_at, u.name, u.avatar, ${LOOK_COLS} FROM leaderboard_scores s JOIN users u ON u.id = s.user_id
                        WHERE s.game_id = ? AND s.board = ? AND s.user_id = ?`),
    lbAbove: db.prepare(`SELECT s.user_id, s.score, s.extra, s.updated_at, u.name, u.avatar, ${LOOK_COLS} FROM leaderboard_scores s JOIN users u ON u.id = s.user_id
                         WHERE s.game_id = ? AND s.board = ? AND (s.score > ? OR (s.score = ? AND s.updated_at < ?))
                         ORDER BY s.score ASC, s.updated_at DESC LIMIT ?`),
    lbBelow: db.prepare(`SELECT s.user_id, s.score, s.extra, s.updated_at, u.name, u.avatar, ${LOOK_COLS} FROM leaderboard_scores s JOIN users u ON u.id = s.user_id
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
    reviews: db.prepare(`SELECT r.user_id, r.text, r.created_at, r.updated_at, u.name, u.avatar, ${LOOK_COLS} FROM game_reviews r JOIN users u ON u.id = r.user_id
                         WHERE r.game_id = ? ORDER BY r.updated_at DESC LIMIT 200`),
    reviewCount: db.prepare('SELECT COUNT(*) AS n FROM game_reviews WHERE game_id = ?'),
    myReview: db.prepare('SELECT text, created_at, updated_at FROM game_reviews WHERE game_id = ? AND user_id = ?'),
    upsertReview: db.prepare(`INSERT INTO game_reviews (game_id, user_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
                              ON CONFLICT (game_id, user_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`),
    deleteReview: db.prepare('DELETE FROM game_reviews WHERE game_id = ? AND user_id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    publicGames: db.prepare(`SELECT g.id, g.slug, g.title, g.genre, g.age, g.cover, g.icon, g.description, g.short_description, g.tags,
                               g.featured, g.author_id, ${AUTHOR_SQL}, g.created_at, ${RATING_SQL},
                               u.email = '${STUDIO_EMAIL}' AS demo
                             FROM games g JOIN users u ON u.id = g.author_id
                             WHERE g.status = 'approved' ORDER BY g.created_at DESC LIMIT 500`),
    publicGame: db.prepare(`SELECT g.*, ${AUTHOR_SQL}, ${RATING_SQL}, u.email = '${STUDIO_EMAIL}' AS demo
                            FROM games g JOIN users u ON u.id = g.author_id
                            WHERE g.id = ? AND g.status = 'approved'`),
    gameBySlug: db.prepare(`SELECT g.*, ${AUTHOR_SQL}, ${RATING_SQL}, u.email = '${STUDIO_EMAIL}' AS demo
                            FROM games g JOIN users u ON u.id = g.author_id
                            WHERE g.slug = ? AND g.status = 'approved'`),
    slugTaken: db.prepare('SELECT 1 FROM games WHERE slug = ?'),
    setSlug: db.prepare('UPDATE games SET slug = ? WHERE id = ? AND slug IS NULL'),
    unslugged: db.prepare("SELECT id, title FROM games WHERE status = 'approved' AND slug IS NULL"),
    myGames: db.prepare('SELECT * FROM games WHERE author_id = ? ORDER BY created_at DESC'),
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
    applicationsByStatus: db.prepare(`SELECT a.*, u.name, u.email, r.studio AS referrer FROM developer_applications a
                                      JOIN users u ON u.id = a.user_id LEFT JOIN developer_applications r ON r.user_id = a.referred_by
                                      WHERE a.status = ? ORDER BY a.updated_at ASC LIMIT 200`),
    setApplicationStatus: db.prepare('UPDATE developer_applications SET status = ?, reason = ?, updated_at = ? WHERE user_id = ?'),
    // Авторы, у которых игры появились до введения заявок, считаются одобренными разработчиками.
    grandfatherAuthors: db.prepare(`INSERT OR IGNORE INTO developer_applications (user_id, studio, about, status, created_at, updated_at)
                                    SELECT DISTINCT u.id, u.name, 'Публиковал игры до введения заявок', 'approved', ?, ?
                                    FROM users u JOIN games g ON g.author_id = u.id`),
    gamesByStatus: db.prepare(`SELECT g.id, g.title, g.genre, g.status, g.size, g.file_count, g.created_at, g.reject_reason,
                               g.featured, g.author_id, u.name AS author, u.email AS author_email
                               FROM games g JOIN users u ON u.id = g.author_id
                               WHERE g.status = ? ORDER BY g.created_at ASC LIMIT 200`),
    // Новые версии опубликованных игр, ждущие проверки.
    pendingUpdates: db.prepare(`SELECT g.id, g.title, g.genre, g.status, g.next_size AS size, g.next_file_count AS file_count,
                                  g.next_at AS created_at, g.version, g.changelog, g.author_id, u.name AS author, u.email AS author_email
                                FROM games g JOIN users u ON u.id = g.author_id
                                WHERE g.next_status = 'pending' ORDER BY g.next_at ASC LIMIT 200`),
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
  const rewards = createRewards({
    db, now, dayOf: (t) => stats.dayOf(t), tz: statsTz, secret: previewSecret, send, readJson, HttpError, requireUser, requireOwner,
    currentUser, cookies, clientIp, logAction, siteUrl,
  });
  const economy = createEconomy({
    db, now, dayOf: (t) => stats.dayOf(t), send, readJson, HttpError, requireUser, requireOwner, logAction, createLimiter,
    siteUrl, packs: coinPacks, yookassa, fetchImpl, daily: rewards.daily,
  });
  const avatars = createAvatars({
    db, dataDir, now, send, readBody, readJson, HttpError, requireUser, requireModerator, isModerator, logAction, createLimiter,
  });
  const gamedev = createGameDev({
    db, now, send, readJson, readBody, HttpError, requireUser, requireDeveloper, requireModerator, isAdmin, isModerator, logAction, gameDir,
    previewSign: (id, exp) => sign(id, exp), CATEGORIES, AGES, unpackBuild, writeBuild, detectArt, avatarUrl,
  });
  const support = createSupport({ db, now, send, readJson, HttpError, requireUser, economy });
  const devref = createDevRef({ db, secret: previewSecret, secureCookies, cookies, send, requireDeveloper, siteUrl });
  const admin = createAdmin({
    db, now, dayOf: (t) => stats.dayOf(t), send, readJson, HttpError, requireModerator, isAdmin, isModerator, admins, logAction,
    studioEmail: STUDIO_EMAIL, avatars, economy,
  });
  const shop = createShop({ db, now, send, readJson, HttpError, requireUser, economy, avatars });
  const partners = createPartners({
    db, now, dayOf: (t) => stats.dayOf(t), send, readJson, HttpError, requireUser, requireOwner, cookies, secureCookies, economy,
    logAction, siteUrl,
  });
  const sources = createSources({
    db, now, dayOf: (t) => stats.dayOf(t), send, readJson, requireOwner, currentUser: (req) => currentUser(req), isModerator,
    isBot: (ua) => stats.isBot(ua), visitorOf: (req) => visitorOf(req), cookies, sha256, secureCookies,
  });
  const tgtasks = createTgTasks({
    db, now, send, readJson, HttpError, requireUser, requireOwner, currentUser: (req) => currentUser(req), economy, logAction, siteUrl,
    secret: previewSecret, telegram, fetchImpl,
  });
  if (seedDemoGames) seedDemo();
  for (const g of q.unslugged.all()) assignSlug(g.id, g.title);

  // Адрес /game/<slug> выдаётся один раз при публикации: потом ссылка не ломается, даже если игру переименуют.
  function assignSlug(id, base) {
    const root = slugify(base) || 'game';
    let slug = root;
    for (let n = 2; q.slugTaken.get(slug); n++) slug = `${root}-${n}`;
    q.setSlug.run(slug, id);
  }
  q.grandfatherAuthors.run(Date.now(), Date.now());
  db.prepare('UPDATE developer_applications SET studio = ? WHERE user_id = (SELECT id FROM users WHERE email = ?)').run(STUDIO_NAME, STUDIO_EMAIL);

  // Демо-игры из public/games/<slug>/ (с meta.json) заводятся как обычные одобренные игры
  // от имени «Gamely»: тогда у них работают счётчик, оценки и страница игры.
  function seedDemo() {
    const root = path.join(publicDir, 'games');
    if (!fs.existsSync(root)) return;
    let studio = q.userByEmail.get(STUDIO_EMAIL);
    if (!studio) {
      // Пароль-заглушка: verifyPassword его никогда не примет, войти под этим аккаунтом нельзя.
      q.insertUser.run(STUDIO_EMAIL, STUDIO_NAME, '!', Date.now());
      studio = q.userByEmail.get(STUDIO_EMAIL);
    }
    // Площадку переименовали: в уже заведённой базе автор демо-игр получает новое имя.
    if (studio.name !== STUDIO_NAME) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(STUDIO_NAME, studio.id);
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
      assignSlug(id, slug);
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
  // Новая версия опубликованной игры, ждущая проверки.
  function previewNextUrl(id) {
    const exp = Math.floor(Date.now() / 1000) + PREVIEW_TTL_SEC;
    return `/preview-next/${id}.${exp}.${sign(`${id}.next`, exp)}/`;
  }
  // Игра в кабинете автора: карточка целиком, ссылки проверки и состояние новой версии.
  function myGameView(g) {
    const { tags, languages, platforms, controls, screenshots, next_size, next_file_count, next_at, ...rest } = g;
    // Картинки неопубликованной игры /play/ не отдаёт — автору нужны подписанные ссылки, как у проверки.
    const preview = previewUrl(g.id);
    const base = g.status === 'approved' ? `/play/${g.id}/` : preview;
    const url = (file) => `${base}${file.split('/').map(encodeURIComponent).join('/')}`;
    let shots = [];
    try { shots = JSON.parse(screenshots); } catch {}
    return {
      ...rest, ...metaView(g), preview_url: preview,
      screenshots: shots.map(url),
      cover_url: g.cover ? url(g.cover) : null,
      icon_url: g.icon ? url(g.icon) : null,
      next: g.next_status ? {
        status: g.next_status, reason: g.next_reason, size: next_size, file_count: next_file_count, at: next_at,
        preview_url: g.next_status === 'pending' ? previewNextUrl(g.id) : null,
      } : null,
    };
  }

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
    const user = q.sessionUser.get(sha256(token), Date.now()) || null;
    // «Был на сайте» для админки — не чаще раза в 10 минут, чтобы не писать в базу на каждый запрос.
    if (user && !(user.last_seen_at > Date.now() - 600000)) q.touchUser.run(Date.now(), user.id);
    return user;
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
  // news — сначала: проверка может выдать достижение, и баланс тогда берём уже с наградой.
  const publicUser = (u) => {
    const news = rewards.hasNews(u.id);
    return {
      id: u.id, email: u.email, name: u.name, isAdmin: isAdmin(u), role: roleOf(u), canModerate: isModerator(u),
      developer: developerStatus(u), canPublish: canPublish(u),
      emailVerified: !!u.email_verified_at, coins: economy.balance(u.id) ?? u.coins ?? 0, dailyBonus: economy.dailyAvailable(u.id), news,
      ...avatars.info(u), ...shop.look(u), noAdsUntil: support.noAdsUntil(u), partner: partners.isPartner(u.id),
    };
  };

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
    const { email: rawEmail, password, name: rawName, ticket, website, promo } = await readJson(req);
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
    const promoPartner = partners.checkPromo(promo); // промокод блогера: неверный — ошибка до создания аккаунта
    if (registerGuard) { registerHourLimiter.fail(ip); registerDayLimiter.fail(ip); }

    const { lastInsertRowid } = q.insertUser.run(email, name, await hashPassword(password), Date.now());
    const id = Number(lastInsertRowid);
    economy.welcome(id);
    rewards.onRegister(req, id);
    partners.onRegister(req, id, promoPartner);
    sources.onRegister(req, id);
    const user = q.userById.get(id);
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
    sendMail(user.email, 'Подтвердите почту на Gamely', [
      `Здравствуйте, ${user.name}!`, '',
      'Чтобы подтвердить почту, откройте ссылку:', `${siteUrl}/verify.html?token=${token}`, '',
      'Ссылка действует 3 дня. Если вы не регистрировались на Gamely, просто удалите это письмо.',
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
      sendMail(user.email, 'Сброс пароля на Gamely', [
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
    rewards.onVerified(row.user_id);
    const user = q.userById.get(row.user_id);
    loginLimiter.reset(`${clientIp(req)}|${user.email}`);
    send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': startSession(user.id) });
  }

  async function confirmEmail(req, res) {
    const row = takeToken((await readJson(req)).token, 'verify');
    if (!row) throw new HttpError(400, 'Ссылка устарела или уже использована. Отправьте письмо ещё раз из профиля');
    q.verifyEmail.run(Date.now(), row.user_id);
    rewards.onVerified(row.user_id); // награда за приглашение и достижение «Настоящая почта»
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
    if (user.blocked_at) throw new HttpError(403, `Аккаунт заблокирован: ${user.blocked_reason || 'нарушение правил'}. Если это ошибка — напишите нам, адрес на странице «Контакты»`);
    adoptGuestSaves(req, user.id);
    send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': startSession(user.id) });
  }

  function logout(req, res) {
    const token = cookies(req).sid;
    if (token) q.deleteSession.run(sha256(token));
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  // Сборка из запроса: ZIP-архив или один HTML. Проверяет архив и index.html, подключает наш Яндекс SDK.
  async function unpackBuild(req) {
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
    return { files, yandexSdk: adaptYandexSdk(files) };
  }

  // Файлы пишутся во временную папку и переносятся целиком: при ошибке на диске не остаётся половины игры.
  async function writeBuild(files, dest) {
    const tmp = `${dest}.tmp`;
    try {
      for (const f of files) {
        const file = path.join(tmp, f.path);
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, f.data);
      }
      await fs.promises.rename(tmp, dest);
    } catch (err) {
      await fs.promises.rm(tmp, { recursive: true, force: true });
      // A file and a folder with the same name ("a" and "a/b") cannot both exist on disk.
      if (['ENOTDIR', 'EISDIR', 'EEXIST'].includes(err.code)) throw new HttpError(400, 'Конфликт путей в архиве');
      throw err;
    }
  }

  // Обложка и иконка: загруженные в кабинете (_media/…) остаются, иначе — cover.* и icon.* из корня сборки.
  function detectArt(files, game = {}) {
    const has = (name) => files.some((f) => f.path === name);
    const keep = (v) => (v && v.startsWith('_media/') ? v : null);
    return {
      cover: keep(game.cover) || COVER_FILES.find(has) || null,
      icon: keep(game.icon) || ICON_FILES.find(has) || null,
    };
  }

  async function uploadGame(req, res, url) {
    const user = requireDeveloper(req);
    const title = String(url.searchParams.get('title') || '').trim();
    const genre = String(url.searchParams.get('genre') || '');
    if (title.length < 2 || title.length > 60) throw new HttpError(400, 'Название: от 2 до 60 символов');
    if (!CATEGORIES.includes(genre)) throw new HttpError(400, 'Неизвестная категория');

    const { files, yandexSdk } = await unpackBuild(req);
    const id = newGameId();
    await writeBuild(files, gameDir(id));
    const size = files.reduce((n, f) => n + f.data.length, 0);
    const now = Date.now();
    const { cover, icon } = detectArt(files);
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
    await fs.promises.rm(`${gameDir(id)}.next`, { recursive: true, force: true });
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
      assignSlug(id, game.title);
      logAction(user, 'game.approve', id, game.title);
    } else if (action === 'reject') {
      // Отказ и снятие с публикации — всегда с причиной: её увидит разработчик.
      const why = String(reason || '').trim();
      if (why.length < 3) throw new HttpError(400, 'Напишите причину — её увидит разработчик');
      q.setStatus.run('rejected', why.slice(0, 300), Date.now(), id);
      logAction(user, 'game.reject', id, game.title, why.slice(0, 300));
    } else if (action === 'feature' || action === 'unfeature') {
      // Подборка вверху главной: владелец ставит игру первой или убирает её оттуда.
      if (!isAdmin(user)) throw new HttpError(403, 'Подборку на главной меняет владелец');
      if (game.status !== 'approved') throw new HttpError(400, 'На главную можно поставить только опубликованную игру');
      const top = db.prepare("SELECT COALESCE(MAX(featured), 0) AS n FROM games WHERE status = 'approved'").get().n;
      db.prepare('UPDATE games SET featured = ? WHERE id = ?').run(action === 'feature' ? top + 1 : 0, id);
      logAction(user, `game.${action}`, id, game.title);
    } else throw new HttpError(400, 'action: approve, reject, feature или unfeature');
    send(res, 200, { ok: true });
  }

  // Карточка игры: всё, что нужно странице игры.
  function gameDetails(req, res, id) {
    const game = q.publicGame.get(id);
    if (!game) throw new HttpError(404, 'Игра не найдена');
    const token = cookies(req).vid;
    const vote = token ? q.myVote.get(id, sha256(token)) : null;
    const { tags, languages, platforms, controls, screenshots, next_status, next_reason, next_size, next_file_count, next_at, ...rest } = game;
    send(res, 200, { game: { ...rest, ...metaView(game), my_vote: vote ? vote.value : 0 } });
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
    studio: a.studio, about: a.about, links: a.links, contact: a.contact, website: a.website || '', public_contact: a.public_contact || '',
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
    devref.remember(req, user.id);
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
      rank: n + 1, name: row.name, avatar: avatarUrl(row.avatar), ...shop.look(row), score: row.score, extra: row.extra || '',
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
      rank: i + 1, name: r.name, avatar: avatarUrl(r.avatar), ...shop.look(r), score: r.score, extra: r.extra || '', player: playerIdOf(r.user_id, id), me: r.user_id === user?.id,
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
    rewards.onScore(id, board, user.id, score); // турнир недели и достижения за рекорды
    send(res, 200, { improved: changes > 0, entry: lbEntry(id, board, q.lbMine.get(id, board, user.id), user) });
  }

  // ---------- монетки ----------
  // Монетки за время в игре больше не начисляются (см. server/economy.js). Старые открытые вкладки
  // ещё шлют этот запрос раз в минуту — отвечаем балансом без начисления.
  function coinTick(req, res) {
    const user = currentUser(req);
    send(res, 200, { earned: 0, coins: user ? economy.balance(user.id) : null });
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
    send(res, 200, { ok: true, coins: economy.spend(user.id, game, amount, title) });
  }

  // ---------- отзывы ----------
  function getReviews(req, res, id) {
    approvedGame(id);
    const user = currentUser(req);
    const reviews = q.reviews.all(id).map((r) => ({
      id: playerIdOf(r.user_id, id), name: r.name, avatar: avatarUrl(r.avatar), ...shop.look(r), text: r.text, created_at: r.created_at, updated_at: r.updated_at,
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
    send(res, 200, { review: { id: playerIdOf(user.id, id), name: user.name, avatar: avatarUrl(user.avatar), ...shop.look(user), text, mine: true, ...q.myReview.get(id, user.id) } });
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
    const user = currentUser(req);
    if (user) rewards.onPlay(user.id, id); // разные игры: так засчитывается приглашённый друг
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

  // ---------- адреса страниц ----------
  // Игра — /game/<slug>, категория — /category/<slug>, страница — /developers. Старые адреса с .html и ?id=
  // переадресуются сюда навсегда (301), чтобы ссылки из поиска и соцсетей не ломались.
  const gamePath = (g) => (g.slug ? `/game/${g.slug}` : `/game.html?id=${g.id}`);
  const catPath = (c) => `/category/${slugify(c)}`;
  const devPath = (id) => `/developer/${id}`;
  const pagePath = (rel) => (rel === '/index.html' ? '/' : rel.replace(/\.html$/, ''));
  const gamesWord = (n) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'игра' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'игры' : 'игр'; };

  function sitemapXml(req, res) {
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const games = q.publicGames.all();
    const newest = Math.max(0, ...games.map((g) => g.created_at));
    const cats = [...new Set(games.map((g) => g.genre))].sort((a, b) => a.localeCompare(b, 'ru'));
    const devs = [...new Set(games.filter((g) => !g.demo).map((g) => g.author_id))].filter((id) => gamedev.studio(id));
    const urls = [
      { loc: `${siteUrl}/`, lastmod: newest ? day(newest) : null },
      ...cats.map((c) => ({ loc: `${siteUrl}${catPath(c)}` })),
      ...games.map((g) => ({ loc: `${siteUrl}${gamePath(g)}`, lastmod: day(g.created_at) })),
      ...devs.map((id) => ({ loc: `${siteUrl}${devPath(id)}` })),
      ...['developers', 'tournament', 'terms', 'privacy', 'contacts'].map((f) => ({ loc: `${siteUrl}/${f}` })),
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
  // скрипты не выполняют. У страниц игры и категории они свои, у остальных — из <title> и description самой страницы.
  // ctx.game / ctx.cat — страница открыта по чистому адресу; ctx.nested — адрес вложенный, нужен <base>.
  function withMeta(html, rel, url, ctx = {}) {
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const description = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
    let meta = { title, description, image: `${siteUrl}/og.jpg`, url: `${siteUrl}${pagePath(rel)}`, type: 'website' };
    const game = rel === '/game.html' ? ctx.game || pageGame(url) : null;
    const games = rel === '/index.html' ? q.publicGames.all() : null;
    if (game) {
      const text = String(game.description || '').replace(/\s+/g, ' ').trim();
      meta = {
        title: `${game.title} — играть онлайн бесплатно`,
        description: text.length > 200 ? `${text.slice(0, 197).replace(/\s+\S*$/, '')}…` : text || `${game.genre}: играйте в браузере без скачивания.`,
        image: ogImageOf(game), url: `${siteUrl}${gamePath(game)}`, type: 'website',
      };
    }
    if (ctx.cat) {
      const n = games.filter((g) => g.genre === ctx.cat).length;
      meta = {
        ...meta, title: `${ctx.cat} — играть онлайн бесплатно | Gamely`, url: `${siteUrl}${catPath(ctx.cat)}`,
        description: `${ctx.cat} онлайн: ${n} ${gamesWord(n)} в браузере без скачивания и регистрации. Играйте бесплатно на Gamely.`,
      };
    }
    if (ctx.dev) {
      const d = ctx.dev.developer, n = ctx.dev.games.length;
      const about = String(d.about || '').replace(/\s+/g, ' ').trim();
      meta = {
        ...meta, title: `${d.studio} — игры на Gamely`, url: `${siteUrl}${devPath(d.id)}`,
        description: `${d.studio}: ${n} ${gamesWord(n)} на Gamely, играйте бесплатно в браузере.${about ? ` ${about.slice(0, 150)}` : ''}`,
      };
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
    // На вложенном адресе ссылки страницы (style.css, app.js, login.html) должны считаться от корня сайта.
    if (ctx.nested) out = out.replace('<head>', '<head>\n<base href="/">');
    out = out.replace('</head>', `${tags}\n${jsonLd(rel, meta, game, ctx.cat)}</head>`);
    if (games) out = catalogHtml(out, games, ctx.cat);
    if (game) out = gameHtml(out, game);
    if (ctx.dev) out = devHtml(out, ctx.dev);
    return out;
  }

  // Каталог и страница игры заполняются скриптом, а Яндекс скрипты почти не выполняет. Поэтому сервер
  // сразу кладёт в HTML карточки игр, ссылки на категории и текст об игре — скрипт потом перерисует их так же.
  const fileUrl = (id, file) => `/play/${id}/${file.split('/').map(encodeURIComponent).join('/')}`;
  const pageGame = (url) => { const id = url.searchParams.get('id'); return id && /^[0-9a-f]{16}$/.test(id) ? q.publicGame.get(id) : null; };
  function cardHtml(g) {
    const e = escHtml;
    return `<a class="card" href="${e(gamePath(g))}"><div class="cover">` +
      (g.cover ? `<img src="${e(fileUrl(g.id, g.cover))}" alt="${e(g.title)}" loading="lazy">` : '') +
      `<span class="age">${e(g.age || '0+')}</span></div><div class="card-body"><b class="card-title">${e(g.title)}</b>` +
      `<span class="card-meta"><span>${e(g.genre)}</span></span></div></a>`;
  }
  function catalogHtml(html, games, cat) {
    const e = escHtml;
    const cats = [...new Set(games.map((g) => g.genre))].sort((a, b) => a.localeCompare(b, 'ru'));
    const chips = [`<a class="chip ${cat ? '' : 'on'}" href="/" data-cat="">Все игры</a>`,
      ...cats.map((c) => `<a class="chip ${c === cat ? 'on' : ''}" href="${catPath(c)}" data-cat="${e(c)}">${e(c)}</a>`)].join('');
    const list = cat ? games.filter((g) => g.genre === cat) : games;
    let out = html
      .replace('<nav class="chips" id="chips" aria-label="Категории"></nav>', () => `<nav class="chips" id="chips" aria-label="Категории">${chips}</nav>`)
      .replace(/<!--grid-->[\s\S]*?<!--\/grid-->/, () => `<!--grid-->${list.map(cardHtml).join('')}<!--/grid-->`);
    if (cat) {
      out = out.replace('<div id="home">', '<div id="home" class="hidden">')
        .replace('<h2 id="allTitle">Все игры</h2>', () => `<h2 id="allTitle">${e(cat)}</h2>`)
        .replace('</head>', () => `<meta name="gamely-category" content="${e(cat)}">\n</head>`);
    }
    return out;
  }
  function gameHtml(html, game) {
    const e = escHtml;
    return html
      .replace('</head>', () => `<meta name="gamely-game" content="${game.id}">\n</head>`)
      .replace('<div class="empty" id="loading">', '<div class="empty hidden" id="loading">')
      .replace('<article id="game" class="hidden">', '<article id="game">')
      .replace('<h1 id="title"></h1>', () => `<h1 id="title">${e(game.title)}</h1>`)
      .replace('<a id="category"></a>', () => `<a id="category" href="${catPath(game.genre)}">${e(game.genre)}</a>`)
      .replace('<p id="desc"></p>', () => `<p id="desc">${e(game.description || '')}</p>`)
      .replace('<p id="howto"></p>', () => `<p id="howto">${e(game.how_to_play || '')}</p>`);
  }
  function devHtml(html, { developer: d, games }) {
    const e = escHtml;
    const all = new Map(q.publicGames.all().map((g) => [g.id, g]));
    const cards = games.map((g) => all.get(g.id)).filter(Boolean).map(cardHtml).join('');
    return html
      .replace('</head>', () => `<meta name="gamely-developer" content="${d.id}">\n</head>`)
      .replace('<div class="empty" id="loading">Загрузка…</div>', '<div class="empty hidden" id="loading">Загрузка…</div>')
      .replace('<section class="me-card hidden" id="head">', '<section class="me-card" id="head">')
      .replace('<h1 id="studio" class="profile-name"></h1>', () => `<h1 id="studio" class="profile-name">${e(d.studio)}</h1>`)
      .replace('<p class="dev-about hidden" id="about"></p>', () => (d.about ? `<p class="dev-about" id="about">${e(d.about)}</p>` : '<p class="dev-about hidden" id="about"></p>'))
      .replace('<section class="sec hidden" id="gamesSec">', '<section class="sec" id="gamesSec">')
      .replace('<div class="grid" id="games"></div>', () => `<div class="grid" id="games">${cards}</div>`);
  }
  // Разметка schema.org: поисковик понимает, что это сайт с играми, что на странице — игра и где она в каталоге.
  function jsonLd(rel, meta, game, cat) {
    const blocks = [];
    if (rel === '/index.html' && !cat) {
      blocks.push({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Gamely', url: `${siteUrl}/`, inLanguage: 'ru',
        potentialAction: { '@type': 'SearchAction', target: `${siteUrl}/?q={query}`, 'query-input': 'required name=query' } });
    }
    if (game) {
      blocks.push({ '@context': 'https://schema.org', '@type': 'VideoGame', name: game.title, description: meta.description, url: meta.url,
        image: meta.image, genre: game.genre, inLanguage: 'ru', gamePlatform: 'Web browser', applicationCategory: 'Game',
        operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' } });
    }
    const crumbs = game ? [['Игры', '/'], [game.genre, catPath(game.genre)], [game.title, gamePath(game)]] : cat ? [['Игры', '/'], [cat, catPath(cat)]] : null;
    if (crumbs) {
      blocks.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: crumbs.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${siteUrl}${p}` })) });
    }
    return blocks.map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>\n`).join('');
  }

  async function playEnd(req, res, id) {
    const { seconds } = await readJson(req);
    const token = cookies(req).vid;
    const recorded = token && q.game.get(id) ? stats.recordEnd(id, sha256(token), seconds) : false;
    send(res, 200, { recorded });
  }

  function notFound(res, text = 'Игра не найдена', headers = {}) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers });
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
    serveFromDir(req, res, gameDir(id), rest, cacheControl);
  }

  // transformHtml(buf) — правка HTML-страниц игры перед отдачей (журнал тестового запуска).
  function serveFromDir(req, res, root, rest, cacheControl, transformHtml = null) {
    // 404 тоже с CORS: fetch из песочницы получит ответ 404, а не сетевую ошибку.
    const missing = () => notFound(res, 'Файл не найден', { 'Access-Control-Allow-Origin': '*' });
    let rel;
    try { rel = decodeURIComponent(rest); } catch { return missing(); }
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return missing();

    const ext = path.extname(file).toLowerCase();
    const encoding = ENCODINGS[ext];
    const typeExt = encoding ? path.extname(file.slice(0, -ext.length)).toLowerCase() : ext;
    const headers = (size) => ({
      'Content-Type': MIME[typeExt] || 'application/octet-stream',
      ...(encoding && { 'Content-Encoding': encoding }),
      'Content-Length': size,
      'Content-Security-Policy': GAME_CSP,
      // The sandboxed game has an opaque origin, so its own fetch() calls are cross-origin.
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': cacheControl,
    });
    if (transformHtml && !encoding && (ext === '.html' || ext === '.htm')) {
      return fs.readFile(file, (err, buf) => {
        if (err) return missing();
        const body = transformHtml(buf);
        res.writeHead(200, headers(body.length));
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    }
    fs.stat(file, (err, st) => {
      if (!err && st.isFile()) {
        res.writeHead(200, headers(st.size));
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(file).pipe(res);
      }
      // Файла нет, но рядом лежит сжатый file.br: так хранятся большие сборки (index.wasm игр на Godot).
      // Браузер распакует его сам; тому, кто не принимает br, распаковываем на лету.
      if (encoding) return missing();
      fs.stat(`${file}.br`, (err2, st2) => {
        if (err2 || !st2.isFile()) return missing();
        const acceptsBr = /\bbr\b/.test(String(req.headers['accept-encoding'] || ''));
        const h = headers(st2.size);
        if (acceptsBr) h['Content-Encoding'] = 'br';
        else delete h['Content-Length'];
        h.Vary = 'Accept-Encoding';
        res.writeHead(200, h);
        if (req.method === 'HEAD') return res.end();
        const src = fs.createReadStream(`${file}.br`);
        (acceptsBr ? src : src.pipe(zlib.createBrotliDecompress())).pipe(res);
      });
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
    let mm;
    if ((mm = rel.match(/^\/game\/([a-z0-9-]+)\/?$/))) {
      const game = q.gameBySlug.get(mm[1]);
      return game ? sendPage(req, res, '/game.html', url, { game, nested: true }) : pageNotFound(req, res);
    }
    if ((mm = rel.match(/^\/category\/([a-z0-9-]+)\/?$/))) {
      const cat = CATEGORIES.find((c) => slugify(c) === mm[1]);
      return cat ? sendPage(req, res, '/index.html', url, { cat, nested: true }) : pageNotFound(req, res);
    }
    if ((mm = rel.match(/^\/developer\/(\d{1,9})\/?$/))) {
      const dev = gamedev.studio(Number(mm[1]));
      return dev ? sendPage(req, res, '/developer.html', url, { dev, nested: true }) : pageNotFound(req, res);
    }
    const moved = oldAddress(rel, url);
    if (moved) {
      res.writeHead(301, { Location: moved, 'Cache-Control': 'public, max-age=86400' });
      return res.end();
    }
    if (rel === '/') rel = '/index.html';
    else if (/^\/[\w-]+$/.test(rel) && fs.existsSync(path.join(publicDir, `${rel}.html`))) rel = `${rel}.html`;
    const file = path.resolve(publicDir, `.${rel}`);
    if (!file.startsWith(publicDir + path.sep)) return pageNotFound(req, res);

    fs.stat(file, (err, st) => {
      if (err || !st.isFile() || rel === '/404.html') return pageNotFound(req, res);
      const ext = path.extname(file);
      if (ext === '.html') return sendPage(req, res, rel, url);
      res.writeHead(200, pageHeaders(MIME[ext] || 'application/octet-stream'));
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  function sendPage(req, res, rel, url, ctx) {
    fs.readFile(path.join(publicDir, rel), 'utf8', (err, html) => {
      if (err) return pageNotFound(req, res);
      res.writeHead(200, { ...pageHeaders(MIME['.html']), ...devref.cookieHeader(url) });
      res.end(req.method === 'HEAD' ? undefined : withMeta(html, rel, url, ctx));
    });
  }

  // Старый адрес → новый: /game.html?id=… → /game/<slug>, /?category=… → /category/<slug>, /terms.html → /terms.
  function oldAddress(rel, url) {
    const qs = new URLSearchParams(url.search);
    const tail = () => (qs.toString() ? `?${qs}` : '');
    if (rel === '/game.html') {
      const game = pageGame(url);
      if (!game || !game.slug) return null;
      qs.delete('id');
      return `/game/${game.slug}${tail()}`;
    }
    if (rel === '/developer.html' || rel === '/developer') {
      const id = qs.get('id');
      if (!/^\d{1,9}$/.test(id || '')) return rel === '/developer.html' ? `/developer${tail()}` : null;
      qs.delete('id');
      return `/developer/${id}${tail()}`;
    }
    if (rel === '/' || rel === '/index.html') {
      const c = qs.get('category');
      if (c && CATEGORIES.includes(c)) { qs.delete('category'); return `${catPath(c)}${tail()}`; }
      return rel === '/index.html' ? `/${tail()}` : null;
    }
    if (/^\/[\w-]+\.html$/.test(rel) && rel !== '/404.html' && fs.existsSync(path.join(publicDir, rel))) return `${rel.slice(0, -5)}${tail()}`;
    return null;
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
    const moduleRoute = economy.route(p, m) || avatars.route(p, m) || gamedev.route(p, m) || devref.route(p, m) || support.route(p, m) || admin.route(p, m) || rewards.route(p, m) || shop.route(p, m) || partners.route(p, m) || sources.route(p, m) || tgtasks.route(p, m);
    if (moduleRoute) return moduleRoute(req, res, url);
    if (p === '/api/me' && m === 'GET') {
      const u = currentUser(req);
      sources.markStaff(req, u);
      return send(res, 200, { user: u ? publicUser(u) : null });
    }
    if ((p === '/api/categories' || p === '/api/genres') && m === 'GET') {
      return send(res, 200, { categories: CATEGORIES, genres: CATEGORIES, ages: AGES });
    }
    if (p === '/api/games' && m === 'GET') {
      return send(res, 200, { games: q.publicGames.all().map((g) => ({ ...g, tags: metaView(g).tags })) });
    }
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
        applications: q.applicationsByStatus.all(status).map((a) => ({ user_id: a.user_id, name: a.name, email: a.email, referrer: a.referrer, ...appView(a) })),
      });
    }
    if ((mm = p.match(/^\/api\/admin\/developers\/(\d+)$/)) && m === 'POST') return reviewDeveloper(req, res, Number(mm[1]));
    if (p === '/api/my/games' && m === 'GET') {
      return send(res, 200, { games: q.myGames.all(requireDeveloper(req).id).map(myGameView) });
    }

    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})$/)) && m === 'DELETE') return deleteGame(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})$/)) && m === 'GET') return gameDetails(req, res, mm[1]);
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
      const game = url.searchParams.get('game');
      if (game && !/^[0-9a-f]{16}$/.test(game)) throw new HttpError(400, 'game: id игры');
      return send(res, 200, stats.authorStats(user.id, days, game || null));
    }
    if ((mm = p.match(/^\/api\/admin\/games\/([0-9a-f]{16})$/)) && m === 'POST') return moderate(req, res, mm[1]);
    if (p === '/api/admin/games' && m === 'GET') {
      requireModerator(req);
      const status = url.searchParams.get('status') || 'pending';
      if (!['pending', 'approved', 'rejected'].includes(status)) throw new HttpError(400, 'Неизвестный статус');
      return send(res, 200, {
        games: withPreview(q.gamesByStatus.all(status)),
        updates: status === 'pending' ? q.pendingUpdates.all().map((g) => ({ ...g, preview_url: previewNextUrl(g.id) })) : [],
      });
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
    if ((mm = p.match(/^\/(play\/[0-9a-f]{16}|preview(?:-next)?\/[0-9a-f]{16}\.\d+\.[0-9a-f]{32}|test-run\/[0-9a-f]{16}\.(?:cur|next)\.\d+\.[0-9a-f]{32})$/)) && isRead) {
      // Relative paths inside the game resolve against the folder, so it needs a trailing slash.
      res.writeHead(301, { Location: `${p}/${url.search}` });
      return res.end();
    }
    if ((mm = p.match(/^\/play\/([0-9a-f]{16})\/(.*)$/)) && isRead) return playGame(req, res, mm[1], mm[2]);
    if ((mm = p.match(/^\/preview\/([0-9a-f]{16})\.(\d+)\.([0-9a-f]{32})\/(.*)$/)) && isRead) {
      return previewGame(req, res, mm[1], mm[2], mm[3], mm[4]);
    }
    if ((mm = p.match(/^\/preview-next\/([0-9a-f]{16})\.(\d+)\.([0-9a-f]{32})\/(.*)$/)) && isRead) {
      return gamedev.previewNext(req, res, mm[1], mm[2], mm[3], mm[4], (rq, rs, root, rest) => serveFromDir(rq, rs, root, rest, 'private, no-store'));
    }
    // Тестовый запуск из кабинета: та же игра, но с журналом консоли (server/test-console.js).
    if ((mm = p.match(/^\/test-run\/([0-9a-f]{16})\.(cur|next)\.(\d+)\.([0-9a-f]{32})\/(.*)$/)) && isRead) {
      return gamedev.testRunFile(req, res, mm[1], mm[2], mm[3], mm[4], mm[5],
        (rq, rs, root, rest, transform) => serveFromDir(rq, rs, root, rest, 'private, no-store', transform));
    }
    if (p === '/test-run-console.js' && isRead) {
      res.writeHead(200, {
        'Content-Type': MIME['.js'], 'Content-Length': TEST_CONSOLE_JS.length, 'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*',
      });
      return res.end(req.method === 'HEAD' ? undefined : TEST_CONSOLE_JS);
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
  server.on('close', () => { tgtasks.stop(); db.close(); });
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
