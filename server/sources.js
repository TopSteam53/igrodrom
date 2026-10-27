// Откуда пришли люди (решение пользователя 27.10.2026, после запуска рекламы во VK): переходы по ссылкам с utm-метками.
// Страница, открытая с ?utm_source=…, сама сообщает о заходе (POST /api/visit) — боты без JS не попадают в отчёт.
// Браузер считается по тому же хэшу cookie vid, что и игроки игр (game_players), поэтому видно, кто из пришедших
// начал играть и кто вернулся в другой день. Первый источник браузер запоминает в cookie src на 30 дней,
// регистрация записывает его в users.source.
// Свои заходы не считаются: браузеры владельца и модераторов запоминаются в staff_visitors (при /api/me и при
// заходе по ссылке) и убираются из отчёта целиком — даже переходы, сделанные до входа в аккаунт.
const COOKIE = 'src';
const TTL_SEC = 30 * 24 * 3600;
const DAY = 864e5;

// В метку пускаем только латиницу, цифры и _ . - (VK подставляет номера кампаний и объявлений).
const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);

export function migrateSources(db) {
  db.exec(`
    -- Браузер, пришедший по метке: первый и последний день и в скольких днях приходил по ней.
    CREATE TABLE IF NOT EXISTS source_visits (
      source    TEXT NOT NULL,
      campaign  TEXT NOT NULL DEFAULT '',
      visitor   TEXT NOT NULL,
      first_day TEXT NOT NULL,
      last_day  TEXT NOT NULL,
      days      INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (source, campaign, visitor)
    );
    CREATE INDEX IF NOT EXISTS source_visits_by_last ON source_visits(last_day);
    -- Браузеры команды сайта: их заходы в отчёт не идут.
    CREATE TABLE IF NOT EXISTS staff_visitors (visitor TEXT PRIMARY KEY);
    CREATE INDEX IF NOT EXISTS game_players_by_visitor ON game_players(visitor);
  `);
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('source')) db.exec('ALTER TABLE users ADD COLUMN source TEXT');
}

export function createSources({ db, now, dayOf, send, readJson, requireOwner, currentUser, isModerator, isBot, visitorOf, cookies, sha256, secureCookies }) {
  const q = {
    staff: db.prepare('SELECT 1 FROM staff_visitors WHERE visitor = ?'),
    addStaff: db.prepare('INSERT OR IGNORE INTO staff_visitors (visitor) VALUES (?)'),
    visit: db.prepare(`INSERT INTO source_visits (source, campaign, visitor, first_day, last_day) VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT (source, campaign, visitor) DO UPDATE SET
                         days = days + (excluded.last_day > last_day), last_day = MAX(last_day, excluded.last_day)`),
    setSource: db.prepare('UPDATE users SET source = ? WHERE id = ? AND source IS NULL'),
    // played — начал играть в день прихода или позже, came_back — играл в другой день после прихода.
    rows: db.prepare(`
      SELECT v.source, v.campaign, COUNT(*) AS visitors, SUM(v.days > 1) AS again,
             SUM(EXISTS (SELECT 1 FROM game_players g WHERE g.visitor = v.visitor AND g.last_day >= v.first_day)) AS played,
             SUM(EXISTS (SELECT 1 FROM game_players g WHERE g.visitor = v.visitor AND g.last_day > v.first_day)) AS came_back,
             MIN(v.first_day) AS first_day, MAX(v.last_day) AS last_day
      FROM source_visits v
      WHERE v.first_day >= ? AND v.visitor NOT IN (SELECT visitor FROM staff_visitors)
      GROUP BY v.source, v.campaign ORDER BY visitors DESC`),
    regs: db.prepare(`
      SELECT u.source AS tag, COUNT(*) AS regs,
             SUM(EXISTS (SELECT 1 FROM user_played_games p WHERE p.user_id = u.id)) AS reg_played
      FROM users u WHERE u.source IS NOT NULL AND u.created_at >= ? GROUP BY u.source`),
    daily: db.prepare(`SELECT first_day AS day, COUNT(*) AS n FROM source_visits
                       WHERE first_day >= ? AND visitor NOT IN (SELECT visitor FROM staff_visitors) GROUP BY first_day`),
  };

  // Хэш cookie vid без выдачи новой: для пометки браузера команды.
  const knownVisitor = (req) => {
    const id = cookies(req).vid;
    return id && /^[A-Za-z0-9_-]{43}$/.test(id) ? sha256(id) : null;
  };

  // Вошёл владелец или модератор — этот браузер больше не считается.
  function markStaff(req, user) {
    if (!user || !isModerator(user)) return;
    const v = knownVisitor(req);
    if (v) q.addStaff.run(v);
  }

  async function visit(req, res) {
    const body = await readJson(req);
    const source = clean(body.source), campaign = clean(body.campaign);
    if (!source || isBot(req.headers['user-agent'])) return send(res, 200, { counted: false });
    const { visitor, setCookie } = visitorOf(req);
    const headers = [];
    if (setCookie) headers.push(setCookie);
    const user = currentUser(req);
    if (user && isModerator(user)) q.addStaff.run(visitor);
    const counted = !q.staff.get(visitor);
    if (counted) {
      const day = dayOf(now());
      q.visit.run(source, campaign, visitor, day, day);
      if (!cookies(req)[COOKIE]) {
        headers.push(`${COOKIE}=${source}:${campaign}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_SEC}${secureCookies ? '; Secure' : ''}`);
      }
    }
    send(res, 200, { counted }, headers.length ? { 'Set-Cookie': headers } : {});
  }

  // Аккаунт создан: запоминаем, по какой метке пришёл браузер.
  function onRegister(req, userId) {
    const [source, campaign = ''] = String(cookies(req)[COOKIE] || '').split(':');
    if (clean(source)) q.setSource.run(`${clean(source)}:${clean(campaign)}`, userId);
  }

  function report(req, res, url) {
    requireOwner(req);
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const from = dayOf(now() - (days - 1) * DAY);
    const regs = new Map(q.regs.all(now() - days * DAY).map((r) => [r.tag, r]));
    const rows = q.rows.all(from).map((r) => {
      const reg = regs.get(`${r.source}:${r.campaign}`) || { regs: 0, reg_played: 0 };
      return { ...r, regs: reg.regs, reg_played: reg.reg_played };
    });
    const byDay = new Map(q.daily.all(from).map((d) => [d.day, d.n]));
    const daily = [];
    for (let i = days - 1; i >= 0; i--) { const day = dayOf(now() - i * DAY); daily.push({ day, n: byDay.get(day) || 0 }); }
    send(res, 200, { days, rows, daily });
  }

  return {
    markStaff,
    onRegister,
    route(p, m) {
      if (p === '/api/visit' && m === 'POST') return visit;
      if (p === '/api/admin/sources' && m === 'GET') return report;
      return null;
    },
  };
}
