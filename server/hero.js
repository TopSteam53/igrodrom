// Карусель на главной (решение владельца 29.10.2026: менять её самому). Слайд — игра каталога (обложка, название и
// описание берутся из игры) или свой: картинка, заголовок, текст и ссылка (турнир, канал, акция). Порядок и
// включение — в админке, раздел «Карусель», только владелец. Пока слайдов нет, главная собирает карусель сама:
// отмеченные игры, потом популярные (public/index.html).
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { sniffImage, IMAGE_TYPES, IMAGE_EXT } from './images.js';

const MAX_SLIDES = 12;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const FILE_RE = /^[0-9a-f]{24}\.(png|jpg|webp)$/;

export function migrateHero(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hero_slides (
      id         INTEGER PRIMARY KEY,
      kind       TEXT NOT NULL CHECK (kind IN ('game', 'custom')),
      game_id    TEXT REFERENCES games(id) ON DELETE CASCADE,
      kicker     TEXT NOT NULL DEFAULT '',
      title      TEXT NOT NULL DEFAULT '',
      text       TEXT NOT NULL DEFAULT '',
      link       TEXT NOT NULL DEFAULT '',
      button     TEXT NOT NULL DEFAULT '',
      image      TEXT,
      position   INTEGER NOT NULL DEFAULT 0,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

// Ссылка своего слайда: страница сайта (/tournament) или https-адрес (канал в Telegram).
function cleanLink(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\/(?!\/)[^\s]*$/.test(s)) return s.slice(0, 300);
  try {
    const u = new URL(s);
    if (u.protocol === 'https:') return u.href.slice(0, 300);
  } catch {}
  return null;
}

export function createHero({ db, dataDir, now, send, readJson, readBody, HttpError, requireOwner, logAction }) {
  const dir = path.join(dataDir, 'hero');
  const q = {
    all: db.prepare(`SELECT s.*, g.title AS game_title, g.status AS game_status FROM hero_slides s
                     LEFT JOIN games g ON g.id = s.game_id ORDER BY s.position, s.id`),
    one: db.prepare('SELECT * FROM hero_slides WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM hero_slides'),
    maxPos: db.prepare('SELECT COALESCE(MAX(position), 0) AS n FROM hero_slides'),
    insert: db.prepare(`INSERT INTO hero_slides (kind, game_id, kicker, title, text, link, button, position, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    update: db.prepare(`UPDATE hero_slides SET kicker = ?, title = ?, text = ?, link = ?, button = ?, active = ?, updated_at = ? WHERE id = ?`),
    setImage: db.prepare('UPDATE hero_slides SET image = ?, updated_at = ? WHERE id = ?'),
    setPos: db.prepare('UPDATE hero_slides SET position = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM hero_slides WHERE id = ?'),
    game: db.prepare("SELECT id, title FROM games WHERE id = ? AND status = 'approved'"),
  };
  const imageUrl = (f) => (f ? `/hero-img/${f}` : null);
  const view = (s) => ({
    id: s.id, kind: s.kind, game_id: s.game_id, kicker: s.kicker, title: s.title, text: s.text, link: s.link, button: s.button,
    image_url: imageUrl(s.image), active: !!s.active, ...(s.kind === 'game' && { game_title: s.game_title, game_live: s.game_status === 'approved' }),
  });
  const drop = (f) => { if (f && FILE_RE.test(f)) fs.rm(path.join(dir, f), { force: true }, () => {}); };

  // Главной: только включённые слайды, игры — только опубликованные, свои — только с картинкой и заголовком.
  function publicList(req, res) {
    const slides = q.all.all().filter((s) => s.active && (s.kind === 'game' ? s.game_status === 'approved' : s.image && s.title))
      .map((s) => (s.kind === 'game' ? { kind: 'game', game_id: s.game_id }
        : { kind: 'custom', kicker: s.kicker, title: s.title, text: s.text, link: s.link, button: s.button || 'Подробнее', image_url: imageUrl(s.image) }));
    send(res, 200, { slides }); // без кэша: изменения в админке видны на главной сразу
  }

  function adminList(req, res) {
    requireOwner(req);
    send(res, 200, { slides: q.all.all().map(view), max: MAX_SLIDES });
  }

  const field = (b, k, max) => String(b[k] ?? '').trim().slice(0, max);

  async function create(req, res) {
    const owner = requireOwner(req);
    const b = await readJson(req);
    if (q.count.get().n >= MAX_SLIDES) throw new HttpError(400, `В карусели не больше ${MAX_SLIDES} слайдов`);
    const t = now();
    const pos = q.maxPos.get().n + 1;
    let id;
    if (b.kind === 'game') {
      const g = q.game.get(String(b.game_id || ''));
      if (!g) throw new HttpError(400, 'Игра не найдена или не опубликована');
      id = q.insert.run('game', g.id, '', '', '', '', '', pos, t, t).lastInsertRowid;
      logAction(owner, 'hero.add', String(id), `игра «${g.title}»`);
    } else if (b.kind === 'custom') {
      const title = field(b, 'title', 80);
      if (title.length < 2) throw new HttpError(400, 'Заголовок: от 2 до 80 символов');
      const link = cleanLink(b.link);
      if (link === null) throw new HttpError(400, 'Ссылка: страница сайта (/tournament) или адрес https://');
      id = q.insert.run('custom', null, field(b, 'kicker', 40), title, field(b, 'text', 240), link, field(b, 'button', 24), pos, t, t).lastInsertRowid;
      logAction(owner, 'hero.add', String(id), `свой слайд «${title}»`);
    } else throw new HttpError(400, 'kind: game или custom');
    send(res, 201, { slide: view(q.all.all().find((s) => s.id === Number(id))) });
  }

  async function update(req, res, id) {
    const owner = requireOwner(req);
    const s = q.one.get(id);
    if (!s) throw new HttpError(404, 'Слайд не найден');
    const b = await readJson(req);
    const active = b.active === undefined ? s.active : b.active ? 1 : 0;
    if (s.kind === 'game') {
      q.update.run('', '', '', '', '', active, now(), id);
    } else {
      const title = b.title === undefined ? s.title : field(b, 'title', 80);
      if (title.length < 2) throw new HttpError(400, 'Заголовок: от 2 до 80 символов');
      const link = b.link === undefined ? s.link : cleanLink(b.link);
      if (link === null) throw new HttpError(400, 'Ссылка: страница сайта (/tournament) или адрес https://');
      q.update.run(b.kicker === undefined ? s.kicker : field(b, 'kicker', 40), title, b.text === undefined ? s.text : field(b, 'text', 240),
        link, b.button === undefined ? s.button : field(b, 'button', 24), active, now(), id);
    }
    logAction(owner, 'hero.edit', String(id), s.kind === 'game' ? 'слайд игры' : `свой слайд «${s.title}»`);
    send(res, 200, { slide: view(q.all.all().find((x) => x.id === id)) });
  }

  async function upload(req, res, id) {
    requireOwner(req);
    const s = q.one.get(id);
    if (!s) throw new HttpError(404, 'Слайд не найден');
    if (s.kind !== 'custom') throw new HttpError(400, 'У слайда игры картинка — обложка игры');
    const body = await readBody(req, MAX_IMAGE_BYTES);
    const img = sniffImage(body);
    if (!img) throw new HttpError(400, 'Нужна картинка PNG, JPEG или WebP до 3 МБ');
    const ratio = img.width / img.height;
    if (img.width < 960 || ratio < 1.6 || ratio > 2.0 || img.width > 4096) {
      throw new HttpError(400, `Картинка 16:9, от 960 px в ширину (у вас ${img.width}×${img.height})`);
    }
    const file = `${randomBytes(12).toString('hex')}${IMAGE_EXT[img.type]}`;
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, file), body);
    drop(s.image);
    q.setImage.run(file, now(), id);
    send(res, 200, { slide: view(q.all.all().find((x) => x.id === id)) });
  }

  async function order(req, res) {
    requireOwner(req);
    const ids = (await readJson(req)).ids;
    const have = new Set(q.all.all().map((s) => s.id));
    if (!Array.isArray(ids) || ids.length !== have.size || !ids.every((i) => have.has(i))) throw new HttpError(400, 'ids: все слайды по порядку');
    db.exec('BEGIN');
    try { ids.forEach((i, n) => q.setPos.run(n + 1, i)); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }
    send(res, 200, { slides: q.all.all().map(view) });
  }

  async function remove(req, res, id) {
    const owner = requireOwner(req);
    const s = q.one.get(id);
    if (!s) throw new HttpError(404, 'Слайд не найден');
    q.del.run(id);
    if (s.image && FILE_RE.test(s.image)) await fs.promises.rm(path.join(dir, s.image), { force: true });
    logAction(owner, 'hero.delete', String(id), s.kind === 'game' ? 'слайд игры' : `свой слайд «${s.title}»`);
    send(res, 200, { ok: true });
  }

  function serve(req, res, file) {
    if (!FILE_RE.test(file)) throw new HttpError(404, 'Нет такой картинки');
    const full = path.join(dir, file);
    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Нет такой картинки'); }
      const type = file.endsWith('.webp') ? IMAGE_TYPES.webp : file.endsWith('.png') ? IMAGE_TYPES.png : IMAGE_TYPES.jpeg;
      res.writeHead(200, {
        'Content-Type': type, 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'public, max-age=86400, immutable',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(full).pipe(res);
    });
  }

  function route(p, m) {
    let mm;
    if (p === '/api/hero' && m === 'GET') return publicList;
    if ((mm = p.match(/^\/hero-img\/([^/]+)$/)) && (m === 'GET' || m === 'HEAD')) return (req, res) => serve(req, res, mm[1]);
    if (p === '/api/admin/hero' && m === 'GET') return adminList;
    if (p === '/api/admin/hero' && m === 'POST') return create;
    if (p === '/api/admin/hero/order' && m === 'POST') return order;
    if ((mm = p.match(/^\/api\/admin\/hero\/(\d+)$/))) {
      if (m === 'PUT') return (req, res) => update(req, res, Number(mm[1]));
      if (m === 'DELETE') return (req, res) => remove(req, res, Number(mm[1]));
    }
    if ((mm = p.match(/^\/api\/admin\/hero\/(\d+)\/image$/)) && m === 'POST') return (req, res) => upload(req, res, Number(mm[1]));
    return null;
  }

  return { route };
}
