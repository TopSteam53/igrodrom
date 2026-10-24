// Кабинет разработчика: карточка игры как в консоли Яндекс Игр (теги, платформы, управление, языки,
// поддержка, версия), обложка, иконка и скриншоты, обновление сборки через модерацию, страница студии.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sniffImage, IMAGE_EXT } from './images.js';
import { ZipWriter } from './zip.js';
import { lookOf } from './shop.js';

export const PLATFORMS = ['desktop', 'mobile', 'tv'];
export const CONTROLS = ['keyboard', 'mouse', 'touch', 'gamepad'];
export const ORIENTATIONS = ['any', 'landscape', 'portrait'];
export const LANGUAGES = ['ru', 'en', 'uk', 'be', 'kk', 'uz', 'tr', 'de', 'es', 'other'];
const MAX_TAGS = 5;
const MAX_SHOTS = 8;
const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
const MEDIA_DIR = '_media';
const TEST_RUN_TTL_SEC = 6 * 3600;
// Первым в <head> игры при тестовом запуске. Без перевода строки: номера строк в ошибках игры не сдвигаются.
export const TEST_CONSOLE_TAG = '<script src="/test-run-console.js"></script>';
// Требования к картинкам — как у Яндекс Игр, чуть мягче по минимальным размерам.
const MEDIA = {
  cover: { min: [640, 360], ratio: [1.6, 1.95], text: 'Обложка: горизонтальная 16:9, от 640×360' },
  icon: { min: [256, 256], ratio: [0.9, 1.1], text: 'Иконка: квадратная, от 256×256' },
  shot: { min: [480, 270], ratio: [0.4, 2.5], text: 'Скриншот: от 480 пикселей по короткой стороне' },
};

export function migrateGameMeta(db) {
  const cols = db.prepare('PRAGMA table_info(games)').all().map((c) => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE games ADD COLUMN ${name} ${ddl}`); };
  add('short_description', "TEXT NOT NULL DEFAULT ''");
  add('tags', "TEXT NOT NULL DEFAULT '[]'");
  add('languages', 'TEXT NOT NULL DEFAULT \'["ru"]\'');
  add('orientation', "TEXT NOT NULL DEFAULT 'any'");
  add('platforms', 'TEXT NOT NULL DEFAULT \'["desktop","mobile"]\'');
  add('controls', "TEXT NOT NULL DEFAULT '[]'");
  add('support', "TEXT NOT NULL DEFAULT ''");       // контакт поддержки для игроков
  add('version', "TEXT NOT NULL DEFAULT ''");
  add('changelog', "TEXT NOT NULL DEFAULT ''");     // «Что нового» в последней версии
  add('screenshots', "TEXT NOT NULL DEFAULT '[]'"); // файлы в папке игры: _media/shot-….webp
  // Новая сборка уже опубликованной игры: ждёт проверки в папке <id>.next, игроки пока играют в старую.
  add('next_status', 'TEXT');                       // pending | rejected | NULL
  add('next_reason', 'TEXT');
  add('next_size', 'INTEGER');
  add('next_file_count', 'INTEGER');
  add('next_at', 'INTEGER');
  const appCols = db.prepare('PRAGMA table_info(developer_applications)').all().map((c) => c.name);
  if (!appCols.includes('website')) db.exec("ALTER TABLE developer_applications ADD COLUMN website TEXT NOT NULL DEFAULT ''");
  // Контакт для игроков и партнёров — кнопка «Связаться» на странице студии. Контакт из заявки видят только модераторы.
  if (!appCols.includes('public_contact')) db.exec("ALTER TABLE developer_applications ADD COLUMN public_contact TEXT NOT NULL DEFAULT ''");
}

// Контакт студии → ссылка: @ник или t.me/… → Telegram, адрес почты → mailto:, https://… как есть.
export function contactLink(s) {
  const v = String(s || '').trim();
  let m;
  if ((m = v.match(/^(?:@|(?:https:\/\/)?t\.me\/)([A-Za-z0-9_]{4,32})$/))) return { href: `https://t.me/${m[1]}`, label: `@${m[1]}` };
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v)) return { href: `mailto:${v}`, label: v };
  if (/^https:\/\/[^\s]+$/i.test(v)) return { href: v, label: v.replace(/^https:\/\//i, '').replace(/\/$/, '') };
  return null;
}

// Вставка разметки первой в <head>: сразу после открывающего тега, без перевода строки. Нет <head> —
// после <html>, нет и его — после <!doctype> (иначе браузер включит режим совместимости), иначе в начало.
// Байты читаются как latin1, чтобы не испортить страницу не в UTF-8.
export function injectHead(buf, markup) {
  const html = buf.toString('latin1');
  const at = [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i].map((re) => html.match(re)).find(Boolean);
  const pos = at ? at.index + at[0].length : 0;
  return Buffer.from(html.slice(0, pos) + markup + html.slice(pos), 'latin1');
}

// HTML игры при тестовом запуске: журнал первым в <head>, а у скриптов игры (src с относительным путём) —
// crossorigin. Игра в песочнице, и без CORS браузер прячет текст ошибок её скриптов («Script error.»).
// Файлы игры сервер отдаёт с Access-Control-Allow-Origin: *, так что загрузка от этого не ломается.
const LOCAL_SCRIPT = /<script\b(?![^>]*\bcrossorigin\b)([^>]*\ssrc\s*=\s*)(["']?)(?![a-z][\w+.-]*:|\/|["'\s])/gi;
export function testRunHtml(buf) {
  const withCors = Buffer.from(buf.toString('latin1').replace(LOCAL_SCRIPT, '<script crossorigin$1$2'), 'latin1');
  return injectHead(withCors, TEST_CONSOLE_TAG);
}

const json = (s, fallback) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : fallback; } catch { return fallback; } };
const mediaUrl = (id, file) => `/play/${id}/${file.split('/').map(encodeURIComponent).join('/')}`;

// Поля карточки для страницы игры и кабинета.
export function metaView(g) {
  return {
    short_description: g.short_description || '',
    tags: json(g.tags, []), languages: json(g.languages, ['ru']), platforms: json(g.platforms, ['desktop', 'mobile']),
    controls: json(g.controls, []), orientation: g.orientation || 'any',
    support: g.support || '', version: g.version || '', changelog: g.changelog || '',
    screenshots: json(g.screenshots, []).map((f) => mediaUrl(g.id, f)),
  };
}

export function createGameDev({
  db, now, send, readJson, readBody, HttpError, requireUser, requireDeveloper, requireModerator, isAdmin, isModerator,
  logAction, gameDir, previewSign, CATEGORIES, AGES, unpackBuild, writeBuild, detectArt, avatarUrl,
}) {
  const q = {
    game: db.prepare('SELECT * FROM games WHERE id = ?'),
    setCover: db.prepare('UPDATE games SET cover = ?, updated_at = ? WHERE id = ?'),
    setIcon: db.prepare('UPDATE games SET icon = ?, updated_at = ? WHERE id = ?'),
    setShots: db.prepare('UPDATE games SET screenshots = ?, updated_at = ? WHERE id = ?'),
    update: db.prepare(`UPDATE games SET title = ?, genre = ?, age = ?, description = ?, how_to_play = ?, short_description = ?,
                          tags = ?, languages = ?, orientation = ?, platforms = ?, controls = ?, support = ?, version = ?,
                          changelog = ?, updated_at = ? WHERE id = ?`),
    setNext: db.prepare(`UPDATE games SET next_status = ?, next_reason = ?, next_size = ?, next_file_count = ?, next_at = ?
                          WHERE id = ?`),
    replaceBuild: db.prepare('UPDATE games SET size = ?, file_count = ?, cover = ?, icon = ?, updated_at = ? WHERE id = ?'),
    application: db.prepare('SELECT * FROM developer_applications WHERE user_id = ?'),
    updateProfile: db.prepare(`UPDATE developer_applications SET studio = ?, about = ?, website = ?, public_contact = ?, updated_at = ?
                                WHERE user_id = ?`),
    devUser: db.prepare('SELECT id, name, avatar, frame FROM users WHERE id = ?'),
    devGames: db.prepare(`SELECT id, title, genre, age, cover, icon, short_description, description, created_at FROM games
                          WHERE author_id = ? AND status = 'approved' ORDER BY created_at DESC`),
  };

  function ownGame(req, id) {
    const user = requireDeveloper(req);
    const game = q.game.get(id);
    if (!game || game.author_id !== user.id) throw new HttpError(404, 'Игра не найдена');
    return { user, game };
  }

  // ---------- карточка ----------
  const list = (v, allowed, field) => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => !allowed.includes(x))) throw new HttpError(400, `${field}: недопустимое значение`);
    return [...new Set(v)];
  };

  async function updateGame(req, res, id) {
    const { game } = ownGame(req, id);
    const b = await readJson(req);
    const text = (key, max, label, min = 0) => {
      const v = b[key] === undefined ? game[key] : String(b[key]).trim();
      if (v.length < min || v.length > max) throw new HttpError(400, min ? `${label}: от ${min} до ${max} символов` : `${label}: до ${max} символов`);
      return v;
    };
    const title = text('title', 60, 'Название', 2);
    const genre = b.genre === undefined ? game.genre : String(b.genre);
    const age = b.age === undefined ? game.age : String(b.age);
    if (!CATEGORIES.includes(genre)) throw new HttpError(400, 'Неизвестная категория');
    if (!AGES.includes(age)) throw new HttpError(400, 'Неизвестная возрастная метка');
    let tags = json(game.tags, []);
    if (b.tags !== undefined) {
      if (!Array.isArray(b.tags)) throw new HttpError(400, 'tags: список');
      tags = [...new Set(b.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
      if (tags.length > MAX_TAGS) throw new HttpError(400, `Тегов — не больше ${MAX_TAGS}`);
      if (tags.some((t) => t.length > 20 || !/^[\p{L}\p{N} -]+$/u.test(t))) throw new HttpError(400, 'Тег: буквы, цифры, пробел и дефис, до 20 символов');
    }
    const languages = list(b.languages, LANGUAGES, 'Языки') ?? json(game.languages, ['ru']);
    if (!languages.length) throw new HttpError(400, 'Укажите хотя бы один язык');
    const platforms = list(b.platforms, PLATFORMS, 'Платформы') ?? json(game.platforms, ['desktop', 'mobile']);
    if (!platforms.length) throw new HttpError(400, 'Укажите хотя бы одну платформу');
    const controls = list(b.controls, CONTROLS, 'Управление') ?? json(game.controls, []);
    const orientation = b.orientation === undefined ? game.orientation : String(b.orientation);
    if (!ORIENTATIONS.includes(orientation)) throw new HttpError(400, 'Ориентация: any, landscape или portrait');
    q.update.run(title, genre, age, text('description', 1500, 'Описание'), text('how_to_play', 600, '«Как играть»'),
      text('short_description', 120, 'Короткое описание'), JSON.stringify(tags), JSON.stringify(languages), orientation,
      JSON.stringify(platforms), JSON.stringify(controls), text('support', 200, 'Поддержка'), text('version', 20, 'Версия'),
      text('changelog', 1000, '«Что нового»'), now(), id);
    send(res, 200, { ok: true, game: { id, ...metaView(q.game.get(id)) } });
  }

  // ---------- обложка, иконка, скриншоты ----------
  async function uploadMedia(req, res, id, kind) {
    const { game } = ownGame(req, id);
    const rule = MEDIA[kind];
    if (!rule) throw new HttpError(400, 'kind: cover, icon или shot');
    const shots = json(game.screenshots, []);
    if (kind === 'shot' && shots.length >= MAX_SHOTS) throw new HttpError(400, `Скриншотов — не больше ${MAX_SHOTS}`);
    const body = await readBody(req, MAX_MEDIA_BYTES);
    const img = sniffImage(body);
    if (!img) throw new HttpError(400, 'Нужна картинка PNG, JPEG или WebP до 3 МБ');
    const ratio = img.width / img.height;
    const short = Math.min(img.width, img.height);
    const okSize = kind === 'shot' ? short >= rule.min[1] : img.width >= rule.min[0] && img.height >= rule.min[1];
    if (!okSize || ratio < rule.ratio[0] || ratio > rule.ratio[1] || img.width > 4096 || img.height > 4096) {
      throw new HttpError(400, `${rule.text}, не больше 4096 (у вас ${img.width}×${img.height})`);
    }
    const file = `${MEDIA_DIR}/${kind}-${randomBytes(6).toString('hex')}${IMAGE_EXT[img.type]}`;
    await fs.promises.mkdir(path.join(gameDir(id), MEDIA_DIR), { recursive: true });
    await fs.promises.writeFile(path.join(gameDir(id), file), body);
    const drop = (f) => { if (f && f.startsWith(`${MEDIA_DIR}/`)) fs.rm(path.join(gameDir(id), f), { force: true }, () => {}); };
    if (kind === 'cover') { drop(game.cover); q.setCover.run(file, now(), id); }
    if (kind === 'icon') { drop(game.icon); q.setIcon.run(file, now(), id); }
    if (kind === 'shot') q.setShots.run(JSON.stringify([...shots, file]), now(), id);
    send(res, 201, { url: mediaUrl(id, file), ...metaView(q.game.get(id)) });
  }

  function deleteShot(req, res, id, n) {
    const { game } = ownGame(req, id);
    const shots = json(game.screenshots, []);
    if (!(n >= 0 && n < shots.length)) throw new HttpError(404, 'Нет такого скриншота');
    const [file] = shots.splice(n, 1);
    fs.rm(path.join(gameDir(id), file), { force: true }, () => {});
    q.setShots.run(JSON.stringify(shots), now(), id);
    send(res, 200, metaView(q.game.get(id)));
  }

  async function moveShot(req, res, id, n) {
    const { game } = ownGame(req, id);
    const shots = json(game.screenshots, []);
    const { to } = await readJson(req);
    if (!(n >= 0 && n < shots.length) || !Number.isInteger(to) || to < 0 || to >= shots.length) throw new HttpError(400, 'Неверный номер');
    shots.splice(to, 0, shots.splice(n, 1)[0]);
    q.setShots.run(JSON.stringify(shots), now(), id);
    send(res, 200, metaView(q.game.get(id)));
  }

  // ---------- новая сборка ----------
  // Игра ещё не опубликована — файлы просто заменяются. Опубликована — новая версия ждёт проверки
  // рядом (<id>.next), а игроки до одобрения играют в прежнюю.
  async function uploadBuild(req, res, id) {
    const { game } = ownGame(req, id);
    const { files, yandexSdk } = await unpackBuild(req);
    const size = files.reduce((n, f) => n + f.data.length, 0);
    if (game.status !== 'approved') {
      const next = `${gameDir(id)}.next`;
      await writeBuild(files, next);
      await swapIn(id, next);
      const art = detectArt(files, game);
      q.replaceBuild.run(size, files.length, art.cover, art.icon, now(), id);
      if (game.status === 'rejected') db.prepare("UPDATE games SET status = 'pending', reject_reason = NULL WHERE id = ?").run(id);
      return send(res, 200, { replaced: true, yandex_sdk: yandexSdk });
    }
    await fs.promises.rm(`${gameDir(id)}.next`, { recursive: true, force: true });
    await writeBuild(files, `${gameDir(id)}.next`);
    q.setNext.run('pending', null, size, files.length, now(), id);
    send(res, 200, { replaced: false, next_status: 'pending', yandex_sdk: yandexSdk });
  }

  async function cancelBuild(req, res, id) {
    ownGame(req, id);
    await fs.promises.rm(`${gameDir(id)}.next`, { recursive: true, force: true });
    q.setNext.run(null, null, null, null, null, id);
    send(res, 200, { ok: true });
  }

  // Новая сборка становится текущей; загруженные в кабинете картинки (_media) переезжают с ней.
  async function swapIn(id, next) {
    const cur = gameDir(id);
    const media = path.join(cur, MEDIA_DIR);
    if (fs.existsSync(media)) await fs.promises.cp(media, path.join(next, MEDIA_DIR), { recursive: true, force: false, errorOnExist: false });
    const old = `${cur}.old`;
    await fs.promises.rm(old, { recursive: true, force: true });
    if (fs.existsSync(cur)) await fs.promises.rename(cur, old);
    await fs.promises.rename(next, cur);
    await fs.promises.rm(old, { recursive: true, force: true });
  }

  async function moderateBuild(req, res, id) {
    const mod = requireModerator(req);
    const { action, reason } = await readJson(req);
    const game = q.game.get(id);
    if (!game || game.next_status !== 'pending') throw new HttpError(404, 'Новой версии на проверке нет');
    if (game.author_id === mod.id && !isAdmin(mod)) throw new HttpError(403, 'Свою игру проверяет другой модератор');
    if (action === 'approve') {
      const next = `${gameDir(id)}.next`;
      const files = fs.readdirSync(next, { recursive: true }).filter((f) => fs.statSync(path.join(next, f)).isFile())
        .map((f) => ({ path: f.split(path.sep).join('/') }));
      await swapIn(id, next);
      const art = detectArt(files, game);
      q.replaceBuild.run(game.next_size, game.next_file_count, art.cover, art.icon, now(), id);
      q.setNext.run(null, null, null, null, null, id);
      logAction(mod, 'game.update.approve', id, game.title);
    } else if (action === 'reject') {
      const why = String(reason || '').trim();
      if (why.length < 3) throw new HttpError(400, 'Напишите причину — её увидит разработчик');
      await fs.promises.rm(`${gameDir(id)}.next`, { recursive: true, force: true });
      q.setNext.run('rejected', why.slice(0, 300), null, null, now(), id);
      logAction(mod, 'game.update.reject', id, game.title, why.slice(0, 300));
    } else throw new HttpError(400, 'action: approve или reject');
    send(res, 200, { ok: true });
  }

  // Ссылка проверки новой версии — подписанная, как у неопубликованных игр.
  function previewNext(req, res, id, exp, sig, rest, serveDir) {
    if (Number(exp) < Date.now() / 1000 || sig !== previewSign(`${id}.next`, exp)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Ссылка устарела: обновите страницу');
    }
    serveDir(req, res, `${gameDir(id)}.next`, rest);
  }

  // ---------- тестовый запуск и скачивание ----------
  // Автор открывает свою игру с журналом (public/cabinet-test.html) и скачивает сборку и картинки.
  // Модераторам и владельцу это тоже доступно: им проверять игры.
  function inspectGame(req, id) {
    const user = requireUser(req);
    const game = q.game.get(id);
    if (!game || (game.author_id !== user.id && !isModerator(user))) throw new HttpError(404, 'Игра не найдена');
    return { user, game };
  }
  const hasNext = (game) => game.next_status === 'pending' && fs.existsSync(`${gameDir(game.id)}.next`);
  const sameSig = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  // Ссылка подписана, как у проверки, но своей подписью: по ней сервер вставляет в игру журнал.
  function testRunUrl(id, build) {
    const exp = Math.floor(Date.now() / 1000) + TEST_RUN_TTL_SEC;
    return `/test-run/${id}.${build}.${exp}.${previewSign(`${id}.test.${build}`, exp)}/`;
  }

  function testRun(req, res, id) {
    const { user, game } = inspectGame(req, id);
    const builds = [{
      build: 'cur', title: game.status === 'approved' ? 'Опубликованная версия' : 'Черновик',
      size: game.size, file_count: game.file_count, url: testRunUrl(id, 'cur'),
    }];
    if (hasNext(game)) {
      builds.push({ build: 'next', title: 'Новая версия на проверке', size: game.next_size, file_count: game.next_file_count, url: testRunUrl(id, 'next') });
    }
    send(res, 200, { game: { id, title: game.title, status: game.status, version: game.version || '' }, mine: game.author_id === user.id, builds });
  }

  // Файлы игры по ссылке тестового запуска: в каждую HTML-страницу вставляется журнал.
  function testRunFile(req, res, id, build, exp, sig, rest, serveDir) {
    if (Number(exp) < Date.now() / 1000 || !sameSig(sig, previewSign(`${id}.test.${build}`, exp)) || !q.game.get(id)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Ссылка устарела: откройте тестовый запуск из кабинета ещё раз');
    }
    serveDir(req, res, build === 'next' ? `${gameDir(id)}.next` : gameDir(id), rest, testRunHtml);
  }

  // Все файлы папки, пути через «/», по алфавиту.
  function listFiles(root) {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { recursive: true }).map((f) => f.split(path.sep).join('/'))
      .filter((f) => fs.statSync(path.join(root, f)).isFile()).sort();
  }

  // Картинки карточки под понятными именами: cover.webp, icon.png, screenshot-1.png…
  function mediaFiles(game) {
    const out = [];
    const add = (file, name) => {
      const full = file && path.join(gameDir(game.id), file);
      if (full && fs.existsSync(full)) out.push({ name: `${name}${path.extname(file).toLowerCase()}`, file: full });
    };
    add(game.cover, 'cover');
    add(game.icon, 'icon');
    json(game.screenshots, []).forEach((f, i) => add(f, `screenshot-${i + 1}`));
    return out;
  }

  // Сборка (без картинок кабинета — они в своём архиве), новая версия на проверке или картинки — ZIP-архивом.
  // Архив собирается по ходу отдачи: в памяти только один файл, а не вся сборка.
  async function download(req, res, id, url) {
    const { game } = inspectGame(req, id);
    const part = url.searchParams.get('part') || 'build';
    let files;
    if (part === 'build') {
      files = listFiles(gameDir(id)).filter((f) => !f.startsWith(`${MEDIA_DIR}/`)).map((f) => ({ name: f, file: path.join(gameDir(id), f) }));
    } else if (part === 'next') {
      if (!hasNext(game)) throw new HttpError(404, 'Новой версии на проверке нет');
      const root = `${gameDir(id)}.next`;
      files = listFiles(root).map((f) => ({ name: f, file: path.join(root, f) }));
    } else if (part === 'media') {
      files = mediaFiles(game);
    } else throw new HttpError(400, 'part: build, next или media');
    if (!files.length) throw new HttpError(404, part === 'media' ? 'Картинок пока нет' : 'Файлов сборки нет');

    const zip = new ZipWriter();
    async function* chunks() {
      for (const f of files) {
        const [data, st] = await Promise.all([fs.promises.readFile(f.file), fs.promises.stat(f.file)]);
        yield* await zip.addAsync(f.name, data, { mtime: st.mtime });
      }
      yield zip.finish();
    }
    // Имя файла — из адреса игры или её номера: только латиница, цифры и дефис.
    const filename = `${game.slug || id}-${{ build: 'build', next: 'build-next', media: 'images' }[part]}.zip`;
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    await pipeline(Readable.from(chunks()), res);
  }

  // ---------- студия ----------
  async function updateProfile(req, res) {
    const user = requireDeveloper(req);
    const app = q.application.get(user.id);
    if (!app) throw new HttpError(404, 'Сначала подайте заявку разработчика');
    const b = await readJson(req);
    const studio = String(b.studio ?? app.studio).trim();
    const about = String(b.about ?? app.about).trim();
    const website = String(b.website ?? app.website ?? '').trim();
    const contact = String(b.public_contact ?? app.public_contact ?? '').trim();
    if (studio.length < 2 || studio.length > 60) throw new HttpError(400, 'Имя или студия: от 2 до 60 символов');
    if (about.length > 1500) throw new HttpError(400, 'О студии: до 1500 символов');
    if (website && (!/^https:\/\/[^\s]+$/i.test(website) || website.length > 200)) throw new HttpError(400, 'Сайт: ссылка https://…, до 200 символов');
    if (contact && (contact.length > 200 || !contactLink(contact))) throw new HttpError(400, 'Контакт: @ник в Telegram, адрес почты или ссылка https://…');
    q.updateProfile.run(studio, about, website, contact, now(), user.id);
    send(res, 200, { ok: true });
  }

  // Страница студии открыта всем, без входа: одобренный разработчик хотя бы с одной опубликованной игрой.
  function studio(userId) {
    const app = q.application.get(userId);
    const user = q.devUser.get(userId);
    const games = user ? q.devGames.all(userId) : [];
    if (!user || !app || app.status !== 'approved' || !games.length) return null;
    return {
      developer: { id: userId, studio: app.studio, about: app.about, website: app.website || '', public_contact: contactLink(app.public_contact),
        avatar: avatarUrl(user.avatar), frame: lookOf(user).frame },
      games,
    };
  }

  function studioPage(req, res, userId) {
    const data = studio(userId);
    if (!data) throw new HttpError(404, 'Разработчик не найден');
    send(res, 200, data);
  }

  function route(p, m) {
    let mm;
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})$/)) && m === 'PATCH') return (req, res) => updateGame(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/media\/(cover|icon|shot)$/)) && m === 'POST') return (req, res) => uploadMedia(req, res, mm[1], mm[2]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/media\/shot\/(\d+)$/))) {
      if (m === 'DELETE') return (req, res) => deleteShot(req, res, mm[1], Number(mm[2]));
      if (m === 'POST') return (req, res) => moveShot(req, res, mm[1], Number(mm[2]));
    }
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/build$/))) {
      if (m === 'POST') return (req, res) => uploadBuild(req, res, mm[1]);
      if (m === 'DELETE') return (req, res) => cancelBuild(req, res, mm[1]);
    }
    if ((mm = p.match(/^\/api\/admin\/games\/([0-9a-f]{16})\/build$/)) && m === 'POST') return (req, res) => moderateBuild(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/test-run$/)) && m === 'GET') return (req, res) => testRun(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/download$/)) && m === 'GET') return (req, res, url) => download(req, res, mm[1], url);
    if (p === '/api/developer/profile' && m === 'PATCH') return updateProfile;
    if ((mm = p.match(/^\/api\/developers\/(\d+)$/)) && m === 'GET') return (req, res) => studioPage(req, res, Number(mm[1]));
    return null;
  }

  return { route, previewNext, studio, testRunFile };
}
