// Задания «Подпишитесь на Telegram-канал» (решение пользователя 27.10.2026): монетки за подписку, проверенную самим Telegram.
// Как подтверждается подписка: игрок открывает нашего бота по ссылке t.me/<бот>?start=<код> — код одноразовый и связывает
// Telegram-аккаунт с аккаунтом Gamely (один Telegram — один аккаунт сайта, иначе награду собирали бы с разных аккаунтов).
// Потом сервер спрашивает getChatMember: подписан — монетки. 7 дней подписка перепроверяется раз в RECHECK_MS;
// отписался — монетки списываются (сколько есть на счёте), задание второй раз не выполнить. Игрока предупреждаем заранее.
// Бот должен быть админом канала (без прав на публикацию): иначе Telegram не отвечает про чужих подписчиков.
// С сервера api.telegram.org закрыт — запросы идут через свой прокси на Cloudflare (TG_API, scripts/promo/tg-worker.js);
// обновления бот получает вебхуком /api/tg/webhook, его подлинность — заголовок с секретом.
// Задания для чужих каналов — реклама: в карточке пометка «Реклама», рекламодатель и erid (их вводит владелец).
import { createHmac, randomBytes } from 'node:crypto';

export const TASK_REWARD = 50;
export const HOLD_DAYS = 7;
const DAY = 864e5;
const RECHECK_MS = 12 * 3600e3;
const CODE_TTL = 3600e3;
const SUBSCRIBED = new Set(['creator', 'administrator', 'member', 'restricted']);

export function telegramFromEnv(env = process.env) {
  const token = String(env.TG_BOT_TOKEN || '').trim();
  const username = String(env.TG_BOT_USERNAME || '').trim().replace(/^@/, '');
  return {
    token, username, enabled: !!(token && username),
    api: String(env.TG_API || 'https://api.telegram.org').trim().replace(/\/+$/, ''),
    // Наш сервер Telegram не видит в обе стороны: вебхук до него не доходит, поэтому по умолчанию сервер сам
    // забирает обновления (getUpdates через прокси). webhook — если сервер Telegram доступен.
    mode: env.TG_MODE === 'webhook' ? 'webhook' : 'poll',
  };
}

// Канал: @name, t.me/name или -100…; храним @name или числовой id.
export function normChat(s) {
  const v = String(s || '').trim();
  const m = v.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{4,64})\/?$/) || v.match(/^@?([A-Za-z][A-Za-z0-9_]{3,63})$/);
  if (m) return `@${m[1]}`;
  return /^-100\d{5,15}$/.test(v) ? v : null;
}

export function migrateTgTasks(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tg_links (
      user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      tg_id     INTEGER NOT NULL UNIQUE,
      tg_name   TEXT NOT NULL DEFAULT '',
      linked_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tg_codes (
      code       TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    -- Задание: канал, награда, лимит подписчиков (0 — без лимита). advertiser/erid — для чужих каналов (реклама).
    CREATE TABLE IF NOT EXISTS tg_tasks (
      id         INTEGER PRIMARY KEY,
      chat       TEXT NOT NULL,
      title      TEXT NOT NULL,
      reward     INTEGER NOT NULL,
      max_subs   INTEGER NOT NULL DEFAULT 0,
      active     INTEGER NOT NULL DEFAULT 1,
      advertiser TEXT NOT NULL DEFAULT '',
      erid       TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    -- Выполненные задания. status: paid — монетки выданы, идёт перепроверка; kept — продержался HOLD_DAYS дней;
    -- left — отписался в первые дни, монетки списаны.
    CREATE TABLE IF NOT EXISTS tg_subs (
      task_id    INTEGER NOT NULL REFERENCES tg_tasks(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tg_id      INTEGER NOT NULL,
      status     TEXT NOT NULL DEFAULT 'paid',
      reward     INTEGER NOT NULL,
      paid_at    INTEGER NOT NULL,
      checked_at INTEGER NOT NULL,
      PRIMARY KEY (task_id, user_id),
      UNIQUE (task_id, tg_id)
    );
    CREATE INDEX IF NOT EXISTS tg_subs_by_check ON tg_subs(status, checked_at);
  `);
}

export function createTgTasks({ db, now, send, readJson, HttpError, requireUser, requireOwner, currentUser, economy, logAction, siteUrl, secret, telegram, fetchImpl = fetch }) {
  const tg = telegram || telegramFromEnv({});
  const hookSecret = createHmac('sha256', secret).update('tg-webhook').digest('hex').slice(0, 48);
  const q = {
    link: db.prepare('SELECT * FROM tg_links WHERE user_id = ?'),
    linkByTg: db.prepare('SELECT * FROM tg_links WHERE tg_id = ?'),
    addLink: db.prepare('INSERT INTO tg_links (user_id, tg_id, tg_name, linked_at) VALUES (?, ?, ?, ?)'),
    code: db.prepare('SELECT * FROM tg_codes WHERE code = ? AND created_at > ?'),
    codeOf: db.prepare('SELECT code FROM tg_codes WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1'),
    addCode: db.prepare('INSERT INTO tg_codes (code, user_id, created_at) VALUES (?, ?, ?)'),
    dropCodes: db.prepare('DELETE FROM tg_codes WHERE user_id = ? OR created_at < ?'),
    task: db.prepare('SELECT * FROM tg_tasks WHERE id = ?'),
    active: db.prepare('SELECT * FROM tg_tasks WHERE active = 1 ORDER BY id'),
    all: db.prepare(`SELECT t.*, COUNT(s.user_id) AS joined, COALESCE(SUM(s.status = 'left'), 0) AS left_n,
                       COALESCE(SUM(s.status = 'kept'), 0) AS kept, COALESCE(SUM(s.status = 'paid'), 0) AS holding
                     FROM tg_tasks t LEFT JOIN tg_subs s ON s.task_id = t.id GROUP BY t.id ORDER BY t.id DESC`),
    taken: db.prepare("SELECT COUNT(*) AS n FROM tg_subs WHERE task_id = ? AND status != 'left'"),
    sub: db.prepare('SELECT * FROM tg_subs WHERE task_id = ? AND user_id = ?'),
    subByTg: db.prepare('SELECT 1 FROM tg_subs WHERE task_id = ? AND tg_id = ?'),
    addSub: db.prepare('INSERT INTO tg_subs (task_id, user_id, tg_id, reward, paid_at, checked_at) VALUES (?, ?, ?, ?, ?, ?)'),
    due: db.prepare("SELECT s.*, t.chat, t.title FROM tg_subs s JOIN tg_tasks t ON t.id = s.task_id WHERE s.status = 'paid' AND s.checked_at < ? ORDER BY s.checked_at LIMIT ?"),
    setSub: db.prepare('UPDATE tg_subs SET status = ?, checked_at = ? WHERE task_id = ? AND user_id = ?'),
    addTask: db.prepare('INSERT INTO tg_tasks (chat, title, reward, max_subs, advertiser, erid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    updTask: db.prepare('UPDATE tg_tasks SET chat = ?, title = ?, reward = ?, max_subs = ?, advertiser = ?, erid = ?, active = ? WHERE id = ?'),
    coins: db.prepare('SELECT coins FROM users WHERE id = ?'),
  };

  // ---------- Bot API через прокси ----------
  // Первое соединение с прокси иногда виснет (часть адресов Cloudflare из России режется) — сетевые ошибки повторяем.
  async function call(method, body, { timeout = 15000, tries = 3 } = {}) {
    for (let i = 1; ; i++) {
      let res;
      try {
        res = await fetchImpl(`${tg.api}/bot${tg.token}/${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(timeout),
        });
      } catch (err) {
        if (i >= tries) throw err;
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
      return data.result;
    }
  }
  // true / false — подписан или нет; null — Telegram не ответил (бот не админ, канал не найден, сеть): никого не наказываем.
  async function isMember(chat, tgId) {
    try { return SUBSCRIBED.has((await call('getChatMember', { chat_id: chat, user_id: tgId })).status); }
    catch { return null; }
  }
  const link = (chat) => `https://t.me/${String(chat).replace(/^@/, '')}`;
  const reply = (chatId, text, buttons) => call('sendMessage', {
    chat_id: chatId, text, disable_web_page_preview: true,
    ...(buttons && { reply_markup: { inline_keyboard: buttons } }),
  }).catch(() => {});

  function botUrl(userId) {
    const fresh = q.codeOf.get(userId, now() - CODE_TTL / 2);
    let code = fresh?.code;
    if (!code) {
      q.dropCodes.run(userId, now() - CODE_TTL);
      code = randomBytes(12).toString('base64url');
      q.addCode.run(code, userId, now());
    }
    return `https://t.me/${tg.username}?start=${code}`;
  }
  const isFull = (t) => t.max_subs > 0 && q.taken.get(t.id).n >= t.max_subs;

  // Выдать награду за задание. Возвращает статус: paid | not_member | done | left | used | closed | error.
  async function claim(userId, tgId, task) {
    const had = q.sub.get(task.id, userId);
    if (had) return had.status === 'left' ? 'left' : 'done';
    if (!task.active || isFull(task)) return 'closed';
    if (q.subByTg.get(task.id, tgId)) return 'used';
    const member = await isMember(task.chat, tgId);
    if (member === null) return 'error';
    if (!member) return 'not_member';
    try {
      economy.move(userId, task.reward, 'task', `Подписка: ${task.title}`, {
        ref: `tg:${task.id}`, during: () => q.addSub.run(task.id, userId, tgId, task.reward, now(), now()),
      });
    } catch { return q.sub.get(task.id, userId) ? 'done' : 'used'; }
    return 'paid';
  }

  // Перепроверка подписок в первые HOLD_DAYS дней. Отписался — списываем награду (сколько есть).
  async function sweep(limit = 25) {
    for (const s of q.due.all(now() - RECHECK_MS, limit)) {
      const member = await isMember(s.chat, s.tg_id);
      if (member === null) continue;
      if (member) {
        q.setSub.run(now() - s.paid_at >= HOLD_DAYS * DAY ? 'kept' : 'paid', now(), s.task_id, s.user_id);
        continue;
      }
      const take = Math.min(s.reward, q.coins.get(s.user_id)?.coins ?? 0);
      if (take > 0) economy.move(s.user_id, -take, 'task', `Отписка: ${s.title}`, { ref: `tg:${s.task_id}`, during: () => q.setSub.run('left', now(), s.task_id, s.user_id) });
      else q.setSub.run('left', now(), s.task_id, s.user_id);
      reply(s.tg_id, `Вы отписались от «${s.title}» раньше ${HOLD_DAYS} дней — ${take} монеток списано с Gamely.`);
    }
  }
  let sweeping = false;
  const runSweep = () => { if (tg.enabled && !sweeping) { sweeping = true; sweep().catch(() => {}).finally(() => { sweeping = false; }); } };
  const timer = setInterval(runSweep, 30 * 60e3);
  timer.unref?.();

  // ---------- сайт ----------
  const view = (t, sub) => ({
    id: t.id, title: t.title, link: link(t.chat), reward: t.reward, advertiser: t.advertiser, erid: t.erid,
    status: sub ? sub.status : null, until: sub && sub.status === 'paid' ? sub.paid_at + HOLD_DAYS * DAY : null,
  });

  function list(req, res) {
    if (!tg.enabled) return send(res, 200, { enabled: false, tasks: [] });
    const user = currentUser(req);
    const tasks = q.active.all().map((t) => view(t, user && q.sub.get(t.id, user.id))).filter((t) => t.status || !isFull(q.task.get(t.id)));
    const linked = !!(user && q.link.get(user.id));
    send(res, 200, { enabled: true, hold_days: HOLD_DAYS, linked, bot_url: user && !linked ? botUrl(user.id) : null, tasks });
  }

  async function check(req, res, id) {
    const user = requireUser(req);
    const task = q.task.get(id);
    if (!tg.enabled || !task) throw new HttpError(404, 'Задание не найдено');
    const l = q.link.get(user.id);
    if (!l) return send(res, 200, { status: 'need_link', bot_url: botUrl(user.id) });
    const status = await claim(user.id, l.tg_id, task);
    send(res, 200, { status, reward: task.reward, coins: economy.balance(user.id) });
  }

  // ---------- бот ----------
  const MESSAGES = {
    paid: (t) => `Готово: +${t.reward} монеток на Gamely за подписку на «${t.title}». Не отписывайтесь ${HOLD_DAYS} дней — иначе монетки спишутся.`,
    not_member: (t) => `Пока не видим подписки на «${t.title}». Подпишитесь и нажмите «Я подписался».`,
    done: (t) => `Награда за «${t.title}» уже получена.`,
    left: (t) => `Вы отписались от «${t.title}» — повторно задание не выполнить.`,
    used: (t) => `За «${t.title}» с этого Telegram уже получали награду на другом аккаунте Gamely.`,
    closed: (t) => `Задание «${t.title}» уже закончилось.`,
    error: () => 'Telegram сейчас не ответил. Попробуйте через минуту.',
  };
  const backButton = [{ text: 'Вернуться в Gamely', url: `${siteUrl}/account#tasks` }];

  // Пройти все открытые задания: выполненные — наградить, остальные — прислать кнопки подписки.
  async function runTasks(chatId, userId, tgId) {
    const open = q.active.all().filter((t) => !q.sub.get(t.id, userId));
    if (!open.length) return reply(chatId, 'Все задания выполнены. Новые появятся на Gamely.', [backButton]);
    for (const t of open) {
      const status = await claim(userId, tgId, t);
      if (status === 'not_member') {
        await reply(chatId, MESSAGES.not_member(t), [[{ text: 'Подписаться', url: link(t.chat) }], [{ text: 'Я подписался', callback_data: `check:${t.id}` }]]);
      } else if (status !== 'closed') await reply(chatId, MESSAGES[status](t), status === 'paid' ? [backButton] : undefined);
    }
  }

  async function onStart(msg, code) {
    const from = msg.from;
    const row = code && q.code.get(code, now() - CODE_TTL);
    if (!row) {
      const known = q.linkByTg.get(from.id);
      if (known) return runTasks(msg.chat.id, known.user_id, from.id);
      return reply(msg.chat.id, 'Это бот Gamely. Откройте задание на сайте и нажмите «Проверить» — бот подтвердит подписку и начислит монетки.',
        [[{ text: 'Открыть Gamely', url: `${siteUrl}/account#tasks` }]]);
    }
    const mine = q.link.get(row.user_id);
    const other = q.linkByTg.get(from.id);
    if (other && other.user_id !== row.user_id) return reply(msg.chat.id, 'Этот Telegram уже привязан к другому аккаунту Gamely.');
    if (mine && mine.tg_id !== from.id) return reply(msg.chat.id, 'К этому аккаунту Gamely уже привязан другой Telegram.');
    if (!mine) {
      q.addLink.run(row.user_id, from.id, [from.first_name, from.username && `@${from.username}`].filter(Boolean).join(' ').slice(0, 80), now());
      q.dropCodes.run(row.user_id, now() - CODE_TTL);
    }
    return runTasks(msg.chat.id, row.user_id, from.id);
  }

  async function webhook(req, res) {
    if (!tg.enabled || req.headers['x-telegram-bot-api-secret-token'] !== hookSecret) throw new HttpError(403, 'Нет доступа');
    const upd = await readJson(req);
    send(res, 200, { ok: true }); // Telegram ждёт быстрый ответ, остальное — после
    await handleUpdate(upd);
  }

  // Режим poll: длинный опрос getUpdates (25 с) через прокси. Ошибка сети — пауза и снова; offset подтверждает обработанное.
  let polling = tg.enabled && tg.mode === 'poll';
  async function poll() {
    let offset = 0;
    await call('deleteWebhook', {}).catch(() => {});
    while (polling) {
      try {
        const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, { timeout: 40000, tries: 1 });
        for (const upd of updates) {
          offset = upd.update_id + 1;
          await handleUpdate(upd);
        }
      } catch (err) {
        if (polling) await new Promise((r) => setTimeout(r, /Conflict/.test(err.message) ? 30000 : 5000).unref?.());
      }
    }
  }
  if (polling) poll();
  else if (tg.enabled) {
    call('setWebhook', { url: `${siteUrl}/api/tg/webhook`, secret_token: hookSecret, allowed_updates: ['message', 'callback_query'] })
      .catch((err) => console.error('Telegram: вебхук не поставлен —', err.message));
  }

  async function handleUpdate(upd) {
    try {
      const msg = upd.message;
      if (msg?.chat?.type === 'private' && typeof msg.text === 'string' && msg.from) {
        const m = msg.text.match(/^\/start(?:\s+([A-Za-z0-9_-]{8,32}))?/);
        if (m) await onStart(msg, m[1]);
      }
      const cb = upd.callback_query;
      if (cb?.data && cb.from) {
        const id = Number(String(cb.data).replace(/^check:/, ''));
        const l = q.linkByTg.get(cb.from.id);
        const task = q.task.get(id);
        const status = l && task ? await claim(l.user_id, cb.from.id, task) : 'error';
        await call('answerCallbackQuery', { callback_query_id: cb.id, text: status === 'paid' ? `+${task.reward} монеток` : '' }).catch(() => {});
        if (task && cb.message) await reply(cb.message.chat.id, MESSAGES[status](task), status === 'paid' ? [backButton] : undefined);
      }
    } catch (err) { console.error('Telegram webhook:', err.message); }
  }

  // ---------- админка ----------
  async function adminList(req, res) {
    requireOwner(req);
    if (tg.enabled) await sweep(25).catch(() => {});
    send(res, 200, { enabled: tg.enabled, bot: tg.username, hold_days: HOLD_DAYS, default_reward: TASK_REWARD, tasks: q.all.all() });
  }
  function fields(body, old = {}) {
    const chat = normChat(body.chat ?? old.chat);
    if (!chat) throw new HttpError(400, 'Канал: @имя или ссылка t.me/имя');
    const title = String(body.title ?? old.title ?? '').trim();
    if (title.length < 2 || title.length > 60) throw new HttpError(400, 'Название: от 2 до 60 символов');
    const reward = Number(body.reward ?? old.reward);
    if (!Number.isInteger(reward) || reward < 1 || reward > 500) throw new HttpError(400, 'Награда: от 1 до 500 монеток');
    const max = Number(body.max_subs ?? old.max_subs ?? 0);
    if (!Number.isInteger(max) || max < 0) throw new HttpError(400, 'Лимит: целое число, 0 — без лимита');
    const advertiser = String(body.advertiser ?? old.advertiser ?? '').trim().slice(0, 120);
    const erid = String(body.erid ?? old.erid ?? '').trim().slice(0, 64);
    return { chat, title, reward, max, advertiser, erid };
  }
  async function create(req, res) {
    const owner = requireOwner(req);
    const f = fields(await readJson(req));
    const { lastInsertRowid } = q.addTask.run(f.chat, f.title, f.reward, f.max, f.advertiser, f.erid, now());
    logAction(owner, 'task.create', Number(lastInsertRowid), f.title, `${f.chat}, ${f.reward} монеток`);
    send(res, 201, { id: Number(lastInsertRowid) });
  }
  async function update(req, res, id) {
    const owner = requireOwner(req);
    const old = q.task.get(id);
    if (!old) throw new HttpError(404, 'Задание не найдено');
    const body = await readJson(req);
    const f = fields(body, old);
    const active = body.active === undefined ? old.active : body.active ? 1 : 0;
    q.updTask.run(f.chat, f.title, f.reward, f.max, f.advertiser, f.erid, active, id);
    logAction(owner, 'task.update', id, f.title, active ? 'включено' : 'выключено');
    send(res, 200, { ok: true });
  }
  // Проверка канала: бот видит канал и он там админ — иначе подписку не проверить.
  async function probe(req, res, id) {
    requireOwner(req);
    const task = q.task.get(id);
    if (!task) throw new HttpError(404, 'Задание не найдено');
    if (!tg.enabled) return send(res, 200, { ok: false, error: 'Бот не настроен на сервере' });
    try {
      const me = await call('getMe');
      const m = await call('getChatMember', { chat_id: task.chat, user_id: me.id });
      send(res, 200, { ok: m.status === 'administrator', status: m.status });
    } catch (err) { send(res, 200, { ok: false, error: err.message }); }
  }

  return {
    stop: () => { clearInterval(timer); polling = false; },
    route(p, m) {
      let mm;
      if (p === '/api/tasks' && m === 'GET') return list;
      if ((mm = p.match(/^\/api\/tasks\/(\d+)\/check$/)) && m === 'POST') return (req, res) => check(req, res, Number(mm[1]));
      if (p === '/api/tg/webhook' && m === 'POST') return webhook;
      if (p === '/api/admin/tasks' && m === 'GET') return adminList;
      if (p === '/api/admin/tasks' && m === 'POST') return create;
      if ((mm = p.match(/^\/api\/admin\/tasks\/(\d+)$/)) && m === 'POST') return (req, res) => update(req, res, Number(mm[1]));
      if ((mm = p.match(/^\/api\/admin\/tasks\/(\d+)\/probe$/)) && m === 'POST') return (req, res) => probe(req, res, Number(mm[1]));
      return null;
    },
  };
}
