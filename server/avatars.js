// Аватарки игроков: одна из готовых (public/avatars/<n>.svg, рисует scripts/avatars-svg.mjs)
// или своя картинка. Своя видна другим только после проверки модератором; до этого — прежняя.
// В users.avatar: 'p:<n>' — готовая, 'u:<файл>' — своя (DATA_DIR/avatars), NULL — буква имени.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { sniffImage, IMAGE_TYPES, IMAGE_EXT } from './images.js';

export const PRESET_AVATARS = 16;
const MAX_AVATAR_BYTES = 400 * 1024;
const FILE_RE = /^[0-9a-f]{32}\.(webp|png|jpg)$/;

export function migrateAvatars(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`); };
  add('avatar', 'TEXT');
  add('avatar_pending', 'TEXT');     // своя картинка на проверке (имя файла)
  add('avatar_pending_at', 'INTEGER');
  add('avatar_note', 'TEXT');        // причина, по которой модератор отклонил последнюю
}

export function avatarUrl(value) {
  const v = String(value || '');
  if (/^p:\d{1,2}$/.test(v)) return `/avatars/${v.slice(2)}.svg`;
  if (v.startsWith('u:') && FILE_RE.test(v.slice(2))) return `/avatars/u/${v.slice(2)}`;
  return null;
}

export function createAvatars({
  db, dataDir, now, send, readBody, readJson, HttpError, requireUser, requireModerator, isModerator, logAction, createLimiter,
}) {
  const dir = path.join(dataDir, 'avatars');
  fs.mkdirSync(dir, { recursive: true });
  const uploadLimiter = createLimiter({ max: 10, windowMs: 3600 * 1000 });
  const q = {
    get: db.prepare('SELECT id, name, email, avatar, avatar_pending, avatar_pending_at, avatar_note FROM users WHERE id = ?'),
    setAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),
    setPending: db.prepare('UPDATE users SET avatar_pending = ?, avatar_pending_at = ?, avatar_note = NULL WHERE id = ?'),
    approve: db.prepare('UPDATE users SET avatar = ?, avatar_pending = NULL, avatar_pending_at = NULL, avatar_note = NULL WHERE id = ?'),
    reject: db.prepare('UPDATE users SET avatar_pending = NULL, avatar_pending_at = NULL, avatar_note = ? WHERE id = ?'),
    queue: db.prepare(`SELECT id, name, email, avatar, avatar_pending, avatar_pending_at FROM users
                       WHERE avatar_pending IS NOT NULL ORDER BY avatar_pending_at LIMIT 200`),
  };

  // Файл своей аватарки больше никому не нужен — удаляем.
  const drop = (file) => { if (file && FILE_RE.test(file)) fs.rm(path.join(dir, file), { force: true }, () => {}); };
  const ownFile = (value) => (String(value || '').startsWith('u:') ? value.slice(2) : null);

  const info = (u) => ({
    avatar: avatarUrl(u.avatar),
    avatarPending: u.avatar_pending ? `/avatars/u/${u.avatar_pending}` : null,
    avatarNote: u.avatar_note || null,
  });

  async function choosePreset(req, res) {
    const user = requireUser(req);
    const { preset } = await readJson(req);
    if (preset !== null && !(Number.isInteger(preset) && preset >= 1 && preset <= PRESET_AVATARS)) {
      throw new HttpError(400, `preset: от 1 до ${PRESET_AVATARS} или null`);
    }
    const row = q.get.get(user.id);
    q.setAvatar.run(preset === null ? null : `p:${preset}`, user.id);
    drop(ownFile(row.avatar));
    send(res, 200, info(q.get.get(user.id)));
  }

  async function upload(req, res) {
    const user = requireUser(req);
    if (uploadLimiter.blocked(String(user.id))) throw new HttpError(429, 'Слишком много загрузок, попробуйте через час');
    uploadLimiter.fail(String(user.id));
    const body = await readBody(req, MAX_AVATAR_BYTES);
    const img = sniffImage(body);
    if (!img) throw new HttpError(400, 'Нужна картинка PNG, JPEG или WebP');
    if (img.width < 64 || img.height < 64 || img.width > 1024 || img.height > 1024) {
      throw new HttpError(400, 'Картинка: от 64 до 1024 пикселей по каждой стороне');
    }
    const file = `${randomBytes(16).toString('hex')}${IMAGE_EXT[img.type]}`;
    await fs.promises.writeFile(path.join(dir, file), body);
    const row = q.get.get(user.id);
    // Модераторам и владельцу проверка не нужна — их картинка ставится сразу.
    if (isModerator(user)) {
      q.approve.run(`u:${file}`, user.id);
      drop(ownFile(row.avatar));
      drop(row.avatar_pending);
    } else {
      q.setPending.run(file, now(), user.id);
      drop(row.avatar_pending);
    }
    send(res, 201, info(q.get.get(user.id)));
  }

  function cancelPending(req, res) {
    const user = requireUser(req);
    const row = q.get.get(user.id);
    q.reject.run(null, user.id);
    drop(row.avatar_pending);
    send(res, 200, info(q.get.get(user.id)));
  }

  function queue(req, res) {
    requireModerator(req);
    send(res, 200, {
      avatars: q.queue.all().map((u) => ({
        user_id: u.id, name: u.name, email: u.email, current: avatarUrl(u.avatar),
        url: `/avatars/u/${u.avatar_pending}`, at: u.avatar_pending_at,
      })),
    });
  }

  async function review(req, res, userId) {
    const mod = requireModerator(req);
    const { action, reason } = await readJson(req);
    const row = q.get.get(userId);
    if (!row || !row.avatar_pending) throw new HttpError(404, 'Картинка уже проверена или удалена');
    if (action === 'approve') {
      q.approve.run(`u:${row.avatar_pending}`, userId);
      drop(ownFile(row.avatar));
      logAction(mod, 'avatar.approve', userId, `${row.name} (${row.email})`);
    } else if (action === 'reject') {
      const why = String(reason || '').trim() || 'Картинка не подходит для сайта';
      q.reject.run(why.slice(0, 200), userId);
      drop(row.avatar_pending);
      logAction(mod, 'avatar.reject', userId, `${row.name} (${row.email})`, why.slice(0, 200));
    } else throw new HttpError(400, 'action: approve или reject');
    send(res, 200, { ok: true });
  }

  // Сброс аватарки модератором (неприличная картинка, уже одобренная по ошибке).
  async function reset(userId, mod) {
    const row = q.get.get(userId);
    if (!row) throw new HttpError(404, 'Пользователь не найден');
    q.setAvatar.run(null, userId);
    drop(ownFile(row.avatar));
    logAction(mod, 'avatar.reset', userId, `${row.name} (${row.email})`);
  }

  // Своя картинка. Имя файла — 128 случайных бит: ссылку на картинку на проверке знают только автор и модераторы.
  function serve(req, res, file) {
    if (!FILE_RE.test(file)) return false;
    const full = path.join(dir, file);
    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Нет такой картинки');
      }
      const type = file.endsWith('.webp') ? IMAGE_TYPES.webp : file.endsWith('.png') ? IMAGE_TYPES.png : IMAGE_TYPES.jpeg;
      res.writeHead(200, {
        'Content-Type': type, 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'public, max-age=86400, immutable',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(full).pipe(res);
    });
    return true;
  }

  function route(p, m) {
    let mm;
    if (p === '/api/me/avatar' && m === 'PUT') return choosePreset;
    if (p === '/api/me/avatar' && m === 'POST') return upload;
    if (p === '/api/me/avatar/pending' && m === 'DELETE') return cancelPending;
    if (p === '/api/admin/avatars' && m === 'GET') return queue;
    if ((mm = p.match(/^\/api\/admin\/avatars\/(\d+)$/)) && m === 'POST') return (req, res) => review(req, res, Number(mm[1]));
    if ((mm = p.match(/^\/avatars\/u\/([^/]+)$/)) && (m === 'GET' || m === 'HEAD')) return (req, res) => serve(req, res, mm[1]) || send(res, 404, { error: 'Not found' });
    return null;
  }

  return { route, info, reset };
}
