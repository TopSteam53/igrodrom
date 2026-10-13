import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import {
  hashPassword, verifyPassword, DUMMY_HASH, newToken, sha256, newGameId, createLimiter,
} from './auth.js';

export const GENRES = ['Аркады', 'Головоломки', 'Кликеры', 'Прочее'];
const MAX_GAME_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024;
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
};

// Uploaded games run with an opaque origin: no access to our cookies, storage or API.
const GAME_CSP = 'sandbox allow-scripts allow-pointer-lock';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createApp({ dataDir, publicDir, adminEmails = [], secureCookies = false }) {
  const gamesDir = path.join(dataDir, 'games');
  fs.mkdirSync(gamesDir, { recursive: true });
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
    myGames: db.prepare(`SELECT id, title, genre, status, reject_reason, size, created_at
                         FROM games WHERE author_id = ? ORDER BY created_at DESC`),
    gamesByStatus: db.prepare(`SELECT g.id, g.title, g.genre, g.status, g.size, g.created_at,
                               u.name AS author, u.email AS author_email
                               FROM games g JOIN users u ON u.id = g.author_id
                               WHERE g.status = ? ORDER BY g.created_at ASC LIMIT 200`),
    game: db.prepare('SELECT * FROM games WHERE id = ?'),
    insertGame: db.prepare(`INSERT INTO games (id, author_id, title, genre, status, size, created_at, updated_at)
                            VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`),
    setStatus: db.prepare('UPDATE games SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?'),
    deleteGame: db.prepare('DELETE FROM games WHERE id = ?'),
  };

  const isAdmin = (user) => !!user && admins.has(user.email);
  const gameFile = (id) => path.join(gamesDir, `${id}.html`);

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
    const key = `${req.socket.remoteAddress}|${email}`;
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

    const body = await readBody(req, MAX_GAME_BYTES);
    if (body.length === 0) throw new HttpError(400, 'Пустой файл');
    if (!/<\s*(html|body|script|canvas|div)\b/i.test(body.subarray(0, 64 * 1024).toString('utf8'))) {
      throw new HttpError(400, 'Это не похоже на HTML-игру');
    }

    const id = newGameId();
    const tmp = `${gameFile(id)}.tmp`;
    await fs.promises.writeFile(tmp, body);
    await fs.promises.rename(tmp, gameFile(id));
    const now = Date.now();
    q.insertGame.run(id, user.id, title, genre, body.length, now, now);
    send(res, 201, { game: { id, title, genre, status: 'pending', size: body.length, created_at: now } });
  }

  async function deleteGame(req, res, id) {
    const user = requireUser(req);
    const game = q.game.get(id);
    if (!game || (game.author_id !== user.id && !isAdmin(user))) throw new HttpError(404, 'Игра не найдена');
    q.deleteGame.run(id);
    await fs.promises.rm(gameFile(id), { force: true });
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

  function playGame(req, res, id) {
    const game = q.game.get(id);
    const user = currentUser(req);
    const canSee = game && (game.status === 'approved' || (user && (user.id === game.author_id || isAdmin(user))));
    if (!canSee) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Игра не найдена'); return; }

    const stream = fs.createReadStream(gameFile(id));
    stream.on('error', () => { if (!res.headersSent) res.writeHead(404); res.end(); });
    stream.on('open', () => {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': GAME_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': game.status === 'approved' ? 'public, max-age=300' : 'private, no-store',
      });
      stream.pipe(res);
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
    if (p === '/api/my/games' && m === 'GET') return send(res, 200, { games: q.myGames.all(requireUser(req).id) });

    let mm;
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})$/)) && m === 'DELETE') return deleteGame(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/admin\/games\/([0-9a-f]{16})$/)) && m === 'POST') return moderate(req, res, mm[1]);
    if (p === '/api/admin/games' && m === 'GET') {
      const user = requireUser(req);
      if (!isAdmin(user)) throw new HttpError(403, 'Только для модераторов');
      const status = url.searchParams.get('status') || 'pending';
      if (!['pending', 'approved', 'rejected'].includes(status)) throw new HttpError(400, 'Неизвестный статус');
      return send(res, 200, { games: q.gamesByStatus.all(status) });
    }
    if ((mm = p.match(/^\/play\/([0-9a-f]{16})$/)) && m === 'GET') return playGame(req, res, mm[1]);
    if (p.startsWith('/api/')) throw new HttpError(404, 'Нет такого метода');
    if (m === 'GET' || m === 'HEAD') return serveStatic(req, res, p);
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
