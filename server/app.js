import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { openDb } from './db.js';
import { extractZip, isZip, ZipError } from './zip.js';
import {
  hashPassword, verifyPassword, DUMMY_HASH, newToken, sha256, newGameId, createLimiter,
} from './auth.js';

export const GENRES = ['Аркады', 'Головоломки', 'Кликеры', 'Прочее'];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // архив целиком
const MAX_HTML_BYTES = 5 * 1024 * 1024; // одиночный .html
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
const MAX_GAME_FILES = 1000;
const PREVIEW_TTL_SEC = 6 * 3600;
const MAX_JSON_BYTES = 16 * 1024;
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// Uploaded games run with an opaque origin: no access to our cookies, storage or API.
const GAME_CSP = 'sandbox allow-scripts allow-pointer-lock';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createApp({
  dataDir, publicDir, adminEmails = [], secureCookies = false, previewSecret = randomBytes(32), trustProxy = false,
}) {
  const gamesDir = path.join(dataDir, 'games');
  fs.mkdirSync(gamesDir, { recursive: true });
  migrateSingleFileGames(gamesDir);
  const db = openDb(path.join(dataDir, 'igrodrom.db'));
  const admins = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const loginLimiter = createLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    insertUser: db.prepare('INSERT INTO users (email, name, pass_hash, created_at) VALUES (?, ?, ?, ?)'),
    sessionUser: db.prepare(`SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
                             WHERE s.token_hash = ? AND s.expires_at > ?`),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    publicGames: db.prepare(`SELECT g.id, g.title, g.genre, u.name AS author, g.created_at
                             FROM games g JOIN users u ON u.id = g.author_id
                             WHERE g.status = 'approved' ORDER BY g.created_at DESC LIMIT 500`),
    myGames: db.prepare(`SELECT id, title, genre, status, reject_reason, size, file_count, created_at
                         FROM games WHERE author_id = ? ORDER BY created_at DESC`),
    gamesByStatus: db.prepare(`SELECT g.id, g.title, g.genre, g.status, g.size, g.file_count, g.created_at,
                               u.name AS author, u.email AS author_email
                               FROM games g JOIN users u ON u.id = g.author_id
                               WHERE g.status = ? ORDER BY g.created_at ASC LIMIT 200`),
    game: db.prepare('SELECT * FROM games WHERE id = ?'),
    insertGame: db.prepare(`INSERT INTO games (id, author_id, title, genre, status, size, file_count, created_at, updated_at)
                            VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`),
    setStatus: db.prepare('UPDATE games SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?'),
    deleteGame: db.prepare('DELETE FROM games WHERE id = ?'),
  };

  const isAdmin = (user) => !!user && admins.has(user.email);
  const gameDir = (id) => path.join(gamesDir, id);

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

  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, isAdmin: isAdmin(u) });

  // ---------- API ----------

  async function register(req, res) {
    const { email: rawEmail, password, name: rawName } = await readJson(req);
    const email = String(rawEmail || '').trim().toLowerCase();
    const name = String(rawName || '').trim();
    if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Некорректный email');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
      throw new HttpError(400, 'Пароль: от 8 до 200 символов');
    }
    if (name.length < 2 || name.length > 40) throw new HttpError(400, 'Имя автора: от 2 до 40 символов');
    if (q.userByEmail.get(email)) throw new HttpError(409, 'Этот email уже зарегистрирован');

    const { lastInsertRowid } = q.insertUser.run(email, name, await hashPassword(password), Date.now());
    const user = { id: Number(lastInsertRowid), email, name };
    send(res, 201, { user: publicUser(user) }, { 'Set-Cookie': startSession(user.id) });
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
    send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': startSession(user.id) });
  }

  function logout(req, res) {
    const token = cookies(req).sid;
    if (token) q.deleteSession.run(sha256(token));
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  async function uploadGame(req, res, url) {
    const user = requireUser(req);
    const title = String(url.searchParams.get('title') || '').trim();
    const genre = String(url.searchParams.get('genre') || '');
    if (title.length < 2 || title.length > 60) throw new HttpError(400, 'Название: от 2 до 60 символов');
    if (!GENRES.includes(genre)) throw new HttpError(400, 'Неизвестный жанр');

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
    q.insertGame.run(id, user.id, title, genre, size, files.length, now, now);
    send(res, 201, {
      game: { id, title, genre, status: 'pending', size, file_count: files.length, created_at: now, preview_url: previewUrl(id) },
    });
  }

  async function deleteGame(req, res, id) {
    const user = requireUser(req);
    const game = q.game.get(id);
    if (!game || (game.author_id !== user.id && !isAdmin(user))) throw new HttpError(404, 'Игра не найдена');
    q.deleteGame.run(id);
    await fs.promises.rm(gameDir(id), { recursive: true, force: true });
    send(res, 200, { ok: true });
  }

  async function moderate(req, res, id) {
    const user = requireUser(req);
    if (!isAdmin(user)) throw new HttpError(403, 'Только для модераторов');
    const { action, reason } = await readJson(req);
    if (!q.game.get(id)) throw new HttpError(404, 'Игра не найдена');
    if (action === 'approve') q.setStatus.run('approved', null, Date.now(), id);
    else if (action === 'reject') q.setStatus.run('rejected', String(reason || 'Без пояснения').slice(0, 300), Date.now(), id);
    else throw new HttpError(400, 'action: approve или reject');
    send(res, 200, { ok: true });
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

    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return notFound(res, 'Файл не найден');
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
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

  function serveStatic(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, { error: 'Bad path' }); }
    if (rel === '/') rel = '/index.html';
    if (rel === '/cabinet') rel = '/cabinet.html';
    const file = path.resolve(publicDir, `.${rel}`);
    if (!file.startsWith(publicDir + path.sep)) return send(res, 404, { error: 'Not found' });

    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, { error: 'Not found' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'same-origin',
      });
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
    if (p === '/api/register' && m === 'POST') return register(req, res);
    if (p === '/api/login' && m === 'POST') return login(req, res);
    if (p === '/api/logout' && m === 'POST') return logout(req, res);
    if (p === '/api/me' && m === 'GET') {
      const u = currentUser(req);
      return send(res, 200, { user: u ? publicUser(u) : null });
    }
    if (p === '/api/genres' && m === 'GET') return send(res, 200, { genres: GENRES });
    if (p === '/api/games' && m === 'GET') return send(res, 200, { games: q.publicGames.all() });
    if (p === '/api/games' && m === 'POST') return uploadGame(req, res, url);
    if (p === '/api/my/games' && m === 'GET') {
      return send(res, 200, { games: withPreview(q.myGames.all(requireUser(req).id)) });
    }

    let mm;
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})$/)) && m === 'DELETE') return deleteGame(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/admin\/games\/([0-9a-f]{16})$/)) && m === 'POST') return moderate(req, res, mm[1]);
    if (p === '/api/admin/games' && m === 'GET') {
      const user = requireUser(req);
      if (!isAdmin(user)) throw new HttpError(403, 'Только для модераторов');
      const status = url.searchParams.get('status') || 'pending';
      if (!['pending', 'approved', 'rejected'].includes(status)) throw new HttpError(400, 'Неизвестный статус');
      return send(res, 200, { games: withPreview(q.gamesByStatus.all(status)) });
    }
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
    if (isRead) return serveStatic(req, res, p);
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

// v0.2 stored single-file games as games/<id>.html; v0.3 keeps every game in games/<id>/.
function migrateSingleFileGames(gamesDir) {
  for (const name of fs.readdirSync(gamesDir)) {
    const m = name.match(/^([0-9a-f]{16})\.html$/);
    if (!m) continue;
    fs.mkdirSync(path.join(gamesDir, m[1]), { recursive: true });
    fs.renameSync(path.join(gamesDir, name), path.join(gamesDir, m[1], 'index.html'));
  }
}
