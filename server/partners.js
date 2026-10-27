// Блогеры-партнёры (решение пользователя 27.10.2026): реклама Gamely в видео и на стримах — плашка, промокод, ссылка.
// У партнёра короткая ссылка /p/<code> (ведёт на главную или в выбранную игру) и промокод для формы регистрации.
// Новичок по ссылке или промокоду сразу получает PARTNER_BONUS монеток. Партнёру игрок засчитывается, когда сыграл
// в PARTNER_GAMES разные игры и заходил на сайт PARTNER_DAYS разных дней (бонус за вход — раз в день), — так
// отсекаются пустые регистрации. За засчитанного игрока партнёру начисляется ставка в рублях (rate фиксируется
// в момент засчёта); выплаты владелец отмечает в админке. Самих денег сайт не переводит.
// Своих игроков партнёру не засчитать: регистрации с того же адреса или браузера, что у его аккаунта, — refused.

export const PARTNER_BONUS = 100;
export const PARTNER_GAMES = 2;
export const PARTNER_DAYS = 2;
const COOKIE = 'pref';
const TTL_SEC = 30 * 24 * 3600;
const CODE_RE = /^[a-z0-9_-]{2,24}$/;            // в ссылке — только латиница
const PROMO_RE = /^[a-zа-я0-9_-]{2,24}$/;        // промокод можно и по-русски: ОББИ
const DAY = 864e5;

// Промокод сравниваем без регистра, «ё» = «е»: зритель набирает как услышал.
export const normPromo = (s) => String(s || '').trim().toLowerCase().replaceAll('ё', 'е');

export function migratePartners(db) {
  db.exec(`
    -- Партнёр-блогер. user_id — его аккаунт на сайте (кабинет /partner), может быть пустым.
    -- target — slug игры, куда ведёт ссылка (NULL — главная). rate — рублей за засчитанного игрока.
    CREATE TABLE IF NOT EXISTS partners (
      id         INTEGER PRIMARY KEY,
      code       TEXT NOT NULL UNIQUE,
      promo      TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      contact    TEXT NOT NULL DEFAULT '',
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      target     TEXT,
      rate       INTEGER NOT NULL DEFAULT 0,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS partners_by_user ON partners(user_id);

    -- Новые браузеры, пришедшие по ссылке, по дням.
    CREATE TABLE IF NOT EXISTS partner_clicks (
      partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      day        TEXT NOT NULL,
      n          INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (partner_id, day)
    );

    -- Игроки партнёра. via: link | promo. status: pending — ещё не засчитан, counted — засчитан (rate — ставка
    -- на тот момент), refused — свой аккаунт партнёра или заблокирован.
    CREATE TABLE IF NOT EXISTS partner_players (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      via        TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      rate       INTEGER,
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS partner_players_by_partner ON partner_players(partner_id, status);

    -- Выплаты партнёру — отметки владельца, сами деньги переводятся вне сайта.
    CREATE TABLE IF NOT EXISTS partner_payouts (
      id         INTEGER PRIMARY KEY,
      partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      amount     INTEGER NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

export function createPartners({
  db, now, dayOf, send, readJson, HttpError, requireUser, requireOwner, cookies, secureCookies, economy, logAction, siteUrl,
}) {
  const q = {
    byCode: db.prepare('SELECT * FROM partners WHERE code = ? AND active = 1'),
    byPromo: db.prepare('SELECT * FROM partners WHERE promo = ? AND active = 1'),
    byId: db.prepare('SELECT * FROM partners WHERE id = ?'),
    byUser: db.prepare('SELECT * FROM partners WHERE user_id = ? ORDER BY id LIMIT 1'),
    all: db.prepare('SELECT * FROM partners ORDER BY active DESC, created_at DESC'),
    insert: db.prepare(`INSERT INTO partners (code, promo, name, contact, user_id, target, rate, active, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`),
    update: db.prepare(`UPDATE partners SET code = ?, promo = ?, name = ?, contact = ?, user_id = ?, target = ?, rate = ?, active = ?
                        WHERE id = ?`),
    click: db.prepare(`INSERT INTO partner_clicks (partner_id, day, n) VALUES (?, ?, 1)
                       ON CONFLICT (partner_id, day) DO UPDATE SET n = n + 1`),
    insertPlayer: db.prepare('INSERT OR IGNORE INTO partner_players (user_id, partner_id, via, status, created_at) VALUES (?, ?, ?, ?, ?)'),
    origin: db.prepare('SELECT reg_ip, reg_vid FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT id, name, email FROM users WHERE email = ?'),
    userById: db.prepare('SELECT id, name, email FROM users WHERE id = ?'),
    game: db.prepare("SELECT slug, title FROM games WHERE slug = ? AND status = 'approved'"),
    // Засчитываем всех, кто уже набрал игры и дни. Ставка — текущая ставка партнёра.
    settle: db.prepare(`UPDATE partner_players SET status = 'counted', decided_at = ?,
                          rate = (SELECT rate FROM partners p WHERE p.id = partner_players.partner_id)
                        WHERE status = 'pending'
                          AND (SELECT COUNT(*) FROM user_played_games g WHERE g.user_id = partner_players.user_id) >= ?
                          AND (SELECT COUNT(*) FROM coin_ledger l WHERE l.user_id = partner_players.user_id AND l.kind = 'daily') >= ?
                          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = partner_players.user_id AND u.blocked_at IS NOT NULL)`),
    totals: db.prepare(`SELECT COUNT(*) AS regs, COALESCE(SUM(status = 'counted'), 0) AS counted,
                               COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(status = 'refused'), 0) AS refused,
                               COALESCE(SUM(CASE WHEN status = 'counted' THEN rate END), 0) AS earned
                        FROM partner_players WHERE partner_id = ?`),
    clicks: db.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM partner_clicks WHERE partner_id = ?'),
    paid: db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM partner_payouts WHERE partner_id = ?'),
    clicksByDay: db.prepare('SELECT day, n FROM partner_clicks WHERE partner_id = ? AND day >= ?'),
    regsSince: db.prepare('SELECT created_at, decided_at, status FROM partner_players WHERE partner_id = ? AND (created_at >= ? OR decided_at >= ?)'),
    players: db.prepare(`SELECT p.user_id, p.via, p.status, p.rate, p.created_at, p.decided_at, u.name,
                                (SELECT COUNT(*) FROM user_played_games g WHERE g.user_id = p.user_id) AS games,
                                (SELECT COUNT(*) FROM coin_ledger l WHERE l.user_id = p.user_id AND l.kind = 'daily') AS days
                         FROM partner_players p JOIN users u ON u.id = p.user_id
                         WHERE p.partner_id = ? ORDER BY p.created_at DESC LIMIT ?`),
    payouts: db.prepare('SELECT id, amount, note, created_at FROM partner_payouts WHERE partner_id = ? ORDER BY created_at DESC'),
    addPayout: db.prepare('INSERT INTO partner_payouts (partner_id, amount, note, actor_id, created_at) VALUES (?, ?, ?, ?, ?)'),
  };

  // ---------- ссылка ----------
  // /p/<code>: новый браузер помечаем cookie (первый партнёр не перезаписывается) и считаем переход.
  function landing(req, res, code) {
    const partner = q.byCode.get(String(code).toLowerCase());
    const target = partner?.target && q.game.get(partner.target) ? `/game/${partner.target}` : '/';
    const headers = { Location: target, 'Cache-Control': 'no-store' };
    if (partner && !cookies(req)[COOKIE]) {
      q.click.run(partner.id, dayOf(now()));
      headers['Set-Cookie'] = `${COOKIE}=${partner.code}; Path=/; SameSite=Lax; Max-Age=${TTL_SEC}${secureCookies ? '; Secure' : ''}`;
    }
    res.writeHead(302, headers);
    res.end();
  }

  // Промокод из формы: проверяем до создания аккаунта, чтобы ошибка в коде не съела регистрацию.
  function checkPromo(raw) {
    const promo = normPromo(raw);
    if (!promo) return null;
    // Подходит и промокод, и код ссылки: зритель мог прочитать «obbi» в адресе.
    const partner = PROMO_RE.test(promo) ? q.byPromo.get(promo) || q.byCode.get(promo) : null;
    if (!partner) throw new HttpError(400, 'Такого промокода нет — проверьте, как он написан, или оставьте поле пустым');
    return partner;
  }

  // Аккаунт создан: промокод важнее cookie ссылки. Подарок — сразу; засчитают партнёру позже, по играм и дням.
  function onRegister(req, userId, promoPartner) {
    const fromLink = CODE_RE.test(cookies(req)[COOKIE] || '') ? q.byCode.get(cookies(req)[COOKIE]) : null;
    const partner = promoPartner || fromLink;
    if (!partner) return;
    let status = 'pending';
    if (partner.user_id) {
      const own = q.origin.get(partner.user_id) || {};
      const mine = q.origin.get(userId) || {};
      if (partner.user_id === userId || (own.reg_ip && own.reg_ip === mine.reg_ip) || (own.reg_vid && own.reg_vid === mine.reg_vid)) status = 'refused';
    }
    if (!q.insertPlayer.run(userId, partner.id, promoPartner ? 'promo' : 'link', status, now()).changes) return;
    economy.move(userId, PARTNER_BONUS, 'partner', `Подарок по промокоду ${partner.promo.toUpperCase()}`, { ref: `partner:${partner.id}` });
  }

  const settle = () => q.settle.run(now(), PARTNER_GAMES, PARTNER_DAYS);

  // ---------- сводка партнёра (кабинет и админка) ----------
  // Имя игрока в кабинете партнёра — только первые буквы: партнёр видит, что люди живые, но не чужие профили.
  const mask = (name) => { const s = [...String(name)]; return s.length <= 2 ? `${s[0] || ''}…` : `${s.slice(0, 2).join('')}${'•'.repeat(Math.min(4, s.length - 2))}`; };

  function report(p, { full = false } = {}) {
    settle();
    const t = q.totals.get(p.id);
    const clicks = q.clicks.get(p.id).n;
    const paid = q.paid.get(p.id).n;
    // 30 дней: переходы, регистрации, засчитанные.
    const today = now();
    const days = Array.from({ length: 30 }, (_, i) => dayOf(today - (29 - i) * DAY));
    const byDay = Object.fromEntries(days.map((d) => [d, { day: d, clicks: 0, regs: 0, counted: 0 }]));
    for (const r of q.clicksByDay.all(p.id, days[0])) if (byDay[r.day]) byDay[r.day].clicks = r.n;
    const from = today - 31 * DAY;
    for (const r of q.regsSince.all(p.id, from, from)) {
      if (byDay[dayOf(r.created_at)]) byDay[dayOf(r.created_at)].regs += 1;
      if (r.status === 'counted' && r.decided_at && byDay[dayOf(r.decided_at)]) byDay[dayOf(r.decided_at)].counted += 1;
    }
    const target = p.target ? q.game.get(p.target) : null;
    return {
      partner: {
        id: p.id, name: p.name, code: p.code, promo: p.promo.toUpperCase(), rate: p.rate, active: !!p.active,
        target: target ? { slug: target.slug, title: target.title } : null,
        ...(full && { contact: p.contact, account: p.user_id ? q.userById.get(p.user_id) : null, created_at: p.created_at }),
      },
      link: `${siteUrl}/p/${p.code}`,
      // Промокод в адресе как есть (буквы, цифры, - и _ — проверено при сохранении): так ссылку читает человек.
      overlay: `${siteUrl}/overlay?code=${p.promo.toUpperCase()}`,
      bonus: PARTNER_BONUS, rules: { games: PARTNER_GAMES, days: PARTNER_DAYS },
      totals: { clicks, regs: t.regs, counted: t.counted, pending: t.pending, refused: t.refused, earned: t.earned, paid, due: t.earned - paid },
      days: days.map((d) => byDay[d]),
      players: q.players.all(p.id, full ? 200 : 50).map((r) => ({
        ...(full ? { user_id: r.user_id, name: r.name } : { name: mask(r.name) }),
        via: r.via, status: r.status, rate: r.rate, games: r.games, days: r.days, created_at: r.created_at, decided_at: r.decided_at,
      })),
      payouts: q.payouts.all(p.id),
    };
  }

  function mine(req, res) {
    const user = requireUser(req);
    const p = q.byUser.get(user.id);
    if (!p) throw new HttpError(404, 'Кабинет блогера открывается после подключения к партнёрской программе');
    send(res, 200, report(p));
  }

  // ---------- админка (только владелец: ставки и выплаты — деньги) ----------
  function list(req, res) {
    requireOwner(req);
    settle();
    send(res, 200, {
      bonus: PARTNER_BONUS, rules: { games: PARTNER_GAMES, days: PARTNER_DAYS },
      partners: q.all.all().map((p) => {
        const t = q.totals.get(p.id);
        const paid = q.paid.get(p.id).n;
        return {
          id: p.id, name: p.name, code: p.code, promo: p.promo.toUpperCase(), rate: p.rate, active: !!p.active, target: p.target,
          contact: p.contact, account: p.user_id ? q.userById.get(p.user_id) : null,
          clicks: q.clicks.get(p.id).n, regs: t.regs, counted: t.counted, pending: t.pending, earned: t.earned, paid, due: t.earned - paid,
        };
      }),
    });
  }

  // Поля партнёра из формы админки: проверяем всё, аккаунт — по почте.
  function fields(body, prev = null) {
    const code = String(body.code ?? prev?.code ?? '').trim().toLowerCase();
    const promo = normPromo(body.promo ?? prev?.promo ?? code);
    const name = String(body.name ?? prev?.name ?? '').trim();
    const contact = String(body.contact ?? prev?.contact ?? '').trim().slice(0, 200);
    const rate = Number(body.rate ?? prev?.rate ?? 0);
    const target = String(body.target ?? prev?.target ?? '').trim() || null;
    if (!CODE_RE.test(code)) throw new HttpError(400, 'Код ссылки: 2–24 символа, латиница, цифры, - и _');
    if (!PROMO_RE.test(promo)) throw new HttpError(400, 'Промокод: 2–24 символа, буквы, цифры, - и _');
    if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Имя блогера: от 2 до 60 символов');
    if (!Number.isInteger(rate) || rate < 0 || rate > 10000) throw new HttpError(400, 'Ставка: целое число рублей от 0 до 10 000');
    if (target && !q.game.get(target)) throw new HttpError(400, 'Нет опубликованной игры с таким адресом');
    let userId = prev?.user_id ?? null;
    if ('email' in body) {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) userId = null;
      else {
        const u = q.userByEmail.get(email);
        if (!u) throw new HttpError(400, 'Аккаунт с такой почтой не найден — блогер должен сначала зарегистрироваться');
        userId = u.id;
      }
    }
    const active = 'active' in body ? (body.active ? 1 : 0) : (prev?.active ?? 1);
    return { code, promo, name, contact, rate, target, userId, active };
  }
  const unique = (fn) => {
    try { return fn(); } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'Такой код ссылки или промокод уже занят');
      throw e;
    }
  };

  async function create(req, res) {
    const owner = requireOwner(req);
    const f = fields(await readJson(req));
    const { lastInsertRowid } = unique(() => q.insert.run(f.code, f.promo, f.name, f.contact, f.userId, f.target, f.rate, now()));
    logAction(owner, 'partner.create', lastInsertRowid, f.name, `код ${f.code}, промокод ${f.promo.toUpperCase()}, ${f.rate} ₽ за игрока`);
    send(res, 201, report(q.byId.get(Number(lastInsertRowid)), { full: true }));
  }

  async function edit(req, res, id) {
    const owner = requireOwner(req);
    const prev = q.byId.get(id);
    if (!prev) throw new HttpError(404, 'Партнёр не найден');
    const f = fields(await readJson(req), prev);
    unique(() => q.update.run(f.code, f.promo, f.name, f.contact, f.userId, f.target, f.rate, f.active, id));
    logAction(owner, 'partner.edit', id, f.name, `${f.rate} ₽ за игрока${f.active ? '' : ', выключен'}`);
    send(res, 200, report(q.byId.get(id), { full: true }));
  }

  function detail(req, res, id) {
    requireOwner(req);
    const p = q.byId.get(id);
    if (!p) throw new HttpError(404, 'Партнёр не найден');
    send(res, 200, report(p, { full: true }));
  }

  async function payout(req, res, id) {
    const owner = requireOwner(req);
    const p = q.byId.get(id);
    if (!p) throw new HttpError(404, 'Партнёр не найден');
    const { amount, note } = await readJson(req);
    const n = Number(amount);
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 1e6) throw new HttpError(400, 'Сумма: целое число рублей, не ноль');
    const text = String(note || '').trim().slice(0, 200);
    q.addPayout.run(id, n, text, owner.id, now());
    logAction(owner, 'partner.payout', id, p.name, `${n} ₽${text ? ` — ${text}` : ''}`);
    send(res, 200, report(p, { full: true }));
  }

  function route(p, m) {
    let mm;
    if ((mm = p.match(/^\/p\/([A-Za-z0-9_-]{2,24})\/?$/)) && (m === 'GET' || m === 'HEAD')) return (req, res) => landing(req, res, mm[1]);
    if (p === '/api/partner/me' && m === 'GET') return mine;
    if (p === '/api/admin/partners' && m === 'GET') return list;
    if (p === '/api/admin/partners' && m === 'POST') return create;
    if ((mm = p.match(/^\/api\/admin\/partners\/(\d+)$/))) {
      if (m === 'GET') return (req, res) => detail(req, res, Number(mm[1]));
      if (m === 'PUT') return (req, res) => edit(req, res, Number(mm[1]));
    }
    if ((mm = p.match(/^\/api\/admin\/partners\/(\d+)\/payouts$/)) && m === 'POST') return (req, res) => payout(req, res, Number(mm[1]));
    return null;
  }

  return { route, checkPromo, onRegister, settle, isPartner: (userId) => !!q.byUser.get(userId) };
}
