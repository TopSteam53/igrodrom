// Админка: обзор площадки, пользователи (поиск, карточка, блокировка), платежи.
// Модераторы видят обзор и пользователей; деньги, выдачу монеток и блокировку команды — только владелец.
import { avatarUrl } from './avatars.js';

const PAGE = 50;

export function migrateAdmin(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('blocked_at')) db.exec('ALTER TABLE users ADD COLUMN blocked_at INTEGER');
  if (!cols.includes('blocked_reason')) db.exec('ALTER TABLE users ADD COLUMN blocked_reason TEXT');
  if (!cols.includes('last_seen_at')) db.exec('ALTER TABLE users ADD COLUMN last_seen_at INTEGER');
}

export function createAdmin({
  db, now, dayOf, send, readJson, HttpError, requireModerator, isAdmin, isModerator, admins, logAction, studioEmail,
  avatars, economy,
}) {
  const DAY = 864e5;
  // Встроенный lower() в SQLite понимает только латиницу — для поиска по русским именам нужен свой.
  db.function('lower_u', { deterministic: true }, (v) => String(v ?? '').toLowerCase().replace(/ё/g, 'е'));
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const q = {
    user: db.prepare('SELECT * FROM users WHERE id = ?'),
    block: db.prepare('UPDATE users SET blocked_at = ?, blocked_reason = ? WHERE id = ?'),
    dropSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    userGames: db.prepare('SELECT id, title, status, created_at FROM games WHERE author_id = ? ORDER BY created_at DESC'),
    userOrders: db.prepare('SELECT id, coins, amount, status, created_at, paid_at FROM coin_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'),
    application: db.prepare('SELECT studio, status, contact, links, created_at FROM developer_applications WHERE user_id = ?'),
    reviews: db.prepare('SELECT COUNT(*) AS n FROM game_reviews WHERE user_id = ?'),
    regsByDay: db.prepare('SELECT created_at FROM users WHERE created_at >= ? AND email <> ?'),
    orders: db.prepare(`SELECT o.id, o.coins, o.amount, o.status, o.payment_id, o.created_at, o.paid_at, u.id AS user_id, u.name, u.email
                        FROM coin_orders o JOIN users u ON u.id = o.user_id
                        WHERE (? = 'all' OR o.status = ?) AND o.status <> 'new' ORDER BY o.created_at DESC LIMIT 200`),
  };

  const roleOf = (u) => (admins.has(u.email) ? 'owner' : u.role === 'moderator' ? 'moderator' : 'player');
  const view = (u) => ({
    id: u.id, name: u.name, email: u.email, avatar: avatarUrl(u.avatar), role: roleOf(u), coins: u.coins,
    created_at: u.created_at, last_seen_at: u.last_seen_at || null, verified: !!u.email_verified_at,
    blocked: !!u.blocked_at, blocked_reason: u.blocked_reason || null,
    developer: u.dev_status || 'none', games: u.games ?? 0, avatar_pending: !!u.avatar_pending,
  });

  function overview(req, res) {
    const me = requireModerator(req);
    const t = now();
    const count = (sql, ...a) => one(sql, ...a).n;
    const notStudio = `email <> '${studioEmail.replace(/'/g, "''")}'`;
    // Регистрации по дням за 30 дней — для графика.
    const days = [];
    for (let i = 29; i >= 0; i--) days.push(dayOf(t - i * DAY));
    const regs = Object.fromEntries(days.map((d) => [d, 0]));
    for (const { created_at: c } of q.regsByDay.all(t - 31 * DAY, studioEmail)) {
      const d = dayOf(c);
      if (d in regs) regs[d]++;
    }
    const plays = (from) => one('SELECT COALESCE(SUM(plays), 0) AS n, COALESCE(SUM(uniques), 0) AS u FROM play_daily WHERE day >= ?', from);
    const out = {
      users: {
        total: count(`SELECT COUNT(*) AS n FROM users WHERE ${notStudio}`),
        today: count(`SELECT COUNT(*) AS n FROM users WHERE ${notStudio} AND created_at >= ?`, t - DAY),
        week: count(`SELECT COUNT(*) AS n FROM users WHERE ${notStudio} AND created_at >= ?`, t - 7 * DAY),
        month: count(`SELECT COUNT(*) AS n FROM users WHERE ${notStudio} AND created_at >= ?`, t - 30 * DAY),
        active_week: count(`SELECT COUNT(*) AS n FROM users WHERE ${notStudio} AND last_seen_at >= ?`, t - 7 * DAY),
        verified: count(`SELECT COUNT(*) AS n FROM users WHERE ${notStudio} AND email_verified_at IS NOT NULL`),
        blocked: count('SELECT COUNT(*) AS n FROM users WHERE blocked_at IS NOT NULL'),
        developers: count("SELECT COUNT(*) AS n FROM developer_applications a JOIN users u ON u.id = a.user_id WHERE a.status = 'approved' AND u." + notStudio),
      },
      games: {
        approved: count("SELECT COUNT(*) AS n FROM games WHERE status = 'approved'"),
        pending: count("SELECT COUNT(*) AS n FROM games WHERE status = 'pending'"),
        updates: count("SELECT COUNT(*) AS n FROM games WHERE next_status = 'pending'"),
        rejected: count("SELECT COUNT(*) AS n FROM games WHERE status = 'rejected'"),
      },
      queues: {
        games: count("SELECT COUNT(*) AS n FROM games WHERE status = 'pending'") + count("SELECT COUNT(*) AS n FROM games WHERE next_status = 'pending'"),
        developers: count("SELECT COUNT(*) AS n FROM developer_applications WHERE status = 'pending'"),
        avatars: count('SELECT COUNT(*) AS n FROM users WHERE avatar_pending IS NOT NULL'),
      },
      plays: { today: plays(dayOf(t)), week: plays(dayOf(t - 6 * DAY)) },
      reviews: count('SELECT COUNT(*) AS n FROM game_reviews'),
      registrations: days.map((d) => ({ day: d, n: regs[d] })),
    };
    if (isAdmin(me)) {
      const sum = (from) => one("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS rub, COALESCE(SUM(coins), 0) AS coins FROM coin_orders WHERE status = 'paid' AND paid_at >= ?", from);
      out.money = {
        today: sum(t - DAY), month: sum(t - 30 * DAY), all: sum(0),
        circulation: count('SELECT COALESCE(SUM(coins), 0) AS n FROM users'),
        spent_month: -count("SELECT COALESCE(SUM(delta), 0) AS n FROM coin_ledger WHERE kind = 'spend' AND created_at >= ?", t - 30 * DAY),
        given_month: count("SELECT COALESCE(SUM(delta), 0) AS n FROM coin_ledger WHERE kind IN ('welcome', 'daily', 'grant', 'achievement', 'tournament', 'referral') AND delta > 0 AND created_at >= ?", t - 30 * DAY),
      };
    }
    send(res, 200, out);
  }

  // Список: поиск по имени и почте, фильтр по роли, сортировка, страницы по 50.
  function users(req, res, url) {
    requireModerator(req);
    const search = String(url.searchParams.get('q') || '').trim().toLowerCase().replace(/ё/g, 'е').slice(0, 100);
    const filter = String(url.searchParams.get('filter') || 'all');
    const sort = { new: 'u.created_at DESC', old: 'u.created_at ASC', coins: 'u.coins DESC, u.id', name: 'u.name COLLATE NOCASE, u.id', seen: 'u.last_seen_at DESC NULLS LAST, u.id' }[url.searchParams.get('sort')] || 'u.created_at DESC';
    const page = Math.max(0, Number(url.searchParams.get('page')) || 0);
    const where = ['u.email <> ?'];
    const args = [studioEmail];
    if (search) {
      where.push("(lower_u(u.email) LIKE ? ESCAPE '\\' OR lower_u(u.name) LIKE ? ESCAPE '\\' OR CAST(u.id AS TEXT) = ?)");
      const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      args.push(like, like, search);
    }
    const owners = [...admins];
    const ownersIn = owners.length ? `u.email IN (${owners.map(() => '?').join(',')})` : '0';
    if (filter === 'team') { where.push(`(u.role = 'moderator' OR ${ownersIn})`); args.push(...owners); }
    if (filter === 'developers') where.push("EXISTS (SELECT 1 FROM developer_applications a WHERE a.user_id = u.id AND a.status = 'approved')");
    if (filter === 'blocked') where.push('u.blocked_at IS NOT NULL');
    if (filter === 'unverified') where.push('u.email_verified_at IS NULL');
    if (filter === 'buyers') where.push("EXISTS (SELECT 1 FROM coin_orders o WHERE o.user_id = u.id AND o.status = 'paid')");
    const sql = `FROM users u WHERE ${where.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...args).n;
    const rows = db.prepare(`SELECT u.*, (SELECT status FROM developer_applications a WHERE a.user_id = u.id) AS dev_status,
                               (SELECT COUNT(*) FROM games g WHERE g.author_id = u.id) AS games
                             ${sql} ORDER BY ${search ? 'CAST(u.id AS TEXT) = ? DESC, ' : ''}${sort}
                             LIMIT ${PAGE} OFFSET ${page * PAGE}`).all(...args, ...(search ? [search] : []));
    send(res, 200, { users: rows.map(view), total, page, pages: Math.ceil(total / PAGE) });
  }

  function userDetail(req, res, id) {
    const me = requireModerator(req);
    const u = q.user.get(id);
    if (!u || u.email === studioEmail) throw new HttpError(404, 'Пользователь не найден');
    const app = q.application.get(id);
    send(res, 200, {
      user: { ...view({ ...u, dev_status: app?.status, games: q.userGames.all(id).length }), avatar_pending_url: u.avatar_pending ? `/avatars/u/${u.avatar_pending}` : null },
      application: app || null,
      games: q.userGames.all(id),
      reviews: q.reviews.get(id).n,
      history: economy.history(id, 50),
      orders: isAdmin(me) ? q.userOrders.all(id) : null,
    });
  }

  // Блокировка: вход закрыт, сессии сброшены. Модератор блокирует игроков, владелец — и модераторов.
  async function block(req, res, id) {
    const me = requireModerator(req);
    const u = q.user.get(id);
    if (!u || u.email === studioEmail) throw new HttpError(404, 'Пользователь не найден');
    if (admins.has(u.email)) throw new HttpError(403, 'Владельца заблокировать нельзя');
    if (isModerator(u) && !isAdmin(me)) throw new HttpError(403, 'Модератора блокирует только владелец');
    if (u.id === me.id) throw new HttpError(400, 'Себя заблокировать нельзя');
    const { blocked, reason } = await readJson(req);
    if (blocked) {
      const why = String(reason || '').trim();
      if (why.length < 3) throw new HttpError(400, 'Напишите причину — её увидит пользователь при входе');
      q.block.run(now(), why.slice(0, 200), id);
      q.dropSessions.run(id);
      logAction(me, 'user.block', id, `${u.name} (${u.email})`, why.slice(0, 200));
    } else {
      q.block.run(null, null, id);
      logAction(me, 'user.unblock', id, `${u.name} (${u.email})`);
    }
    send(res, 200, { ok: true });
  }

  async function resetAvatar(req, res, id) {
    const me = requireModerator(req);
    await avatars.reset(id, me);
    send(res, 200, { ok: true });
  }

  function payments(req, res, url) {
    const me = requireModerator(req);
    if (!isAdmin(me)) throw new HttpError(403, 'Только для владельца площадки');
    const status = ['paid', 'pending', 'canceled'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'all';
    send(res, 200, { orders: q.orders.all(status, status) });
  }

  function route(p, m) {
    let mm;
    if (p === '/api/admin/overview' && m === 'GET') return overview;
    if (p === '/api/admin/users' && m === 'GET') return users;
    if ((mm = p.match(/^\/api\/admin\/users\/(\d+)$/)) && m === 'GET') return (req, res) => userDetail(req, res, Number(mm[1]));
    if ((mm = p.match(/^\/api\/admin\/users\/(\d+)\/block$/)) && m === 'POST') return (req, res) => block(req, res, Number(mm[1]));
    if ((mm = p.match(/^\/api\/admin\/users\/(\d+)\/avatar$/)) && m === 'DELETE') return (req, res) => resetAvatar(req, res, Number(mm[1]));
    if (p === '/api/admin/payments' && m === 'GET') return payments;
    return null;
  }

  return { route };
}
