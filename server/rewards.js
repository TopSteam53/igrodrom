// Награды для игроков: серия входов, достижения, турнир недели по рекордам и приглашения друзей.
// Награда — монетки (каждая пишется в coin_ledger: daily, achievement, tournament, referral), за друзей — ещё
// предметы витрины, которые не купить (shop.js, INVITE_ITEMS).
// Всё выдаётся один раз: отметка «выдано» и начисление идут одной транзакцией, повторный запрос ничего не даёт.
// Крона нет: итоги прошедшей недели подводит первый запрос после её конца.
import { createHmac, randomBytes } from 'node:crypto';
import { avatarUrl } from './avatars.js';
import { lookOf, LOOK_COLS, INVITE_ITEMS } from './shop.js';
import { sha256 } from './auth.js';

// Серия входов: день 1…7, потом круг повторяется, а счётчик дней подряд растёт дальше.
export const STREAK_COINS = [5, 6, 7, 8, 10, 12, 20];
export const TOURNAMENT_PRIZES = [150, 100, 50];
// Приглашения (решения пользователя 27.10.2026: почта не нужна — SMTP нет; хватит двух разных игр). Друг засчитан,
// когда сыграл в INVITE_GAMES разных игр (или подтвердил почту, когда она заработает).
export const INVITE_COINS = 100;  // пригласившему за засчитанного друга
export const INVITED_COINS = 50;  // другу сверх подарка за регистрацию
export const MAX_INVITES = 50;    // наград за приглашения на одного игрока
export const INVITE_GAMES = 2;
export const INVITE_WEEK_PRIZES = [300, 200, 100]; // кто привёл больше друзей за неделю
const INVITE_RE = /^[A-Za-z0-9_-]{8}$/;
const BOARD_RE = /^[\w.-]{1,40}$/;
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 864e5;

// Достижения аккаунта. done — условие по сводке progress(); goal — для счётчика «3 из 5» в профиле.
export const ACHIEVEMENTS = [
  { key: 'record', title: 'Первый рекорд', cond: 'Попасть в таблицу рекордов любой игры', coins: 10, value: (s) => s.records, goal: 1 },
  { key: 'records5', title: 'Рекордсмен', cond: 'Результаты в таблицах рекордов пяти разных игр', coins: 30, value: (s) => s.records, goal: 5 },
  { key: 'review', title: 'Первый отзыв', cond: 'Написать отзыв об игре', coins: 10, value: (s) => s.reviews, goal: 1 },
  { key: 'reviews5', title: 'Критик', cond: 'Отзывы о пяти играх', coins: 30, value: (s) => s.reviews, goal: 5 },
  { key: 'streak7', title: 'Неделя подряд', cond: 'Заходить на Gamely семь дней подряд', coins: 20, value: (s) => s.streak, goal: 7 },
  { key: 'streak30', title: 'Месяц подряд', cond: 'Заходить на Gamely тридцать дней подряд', coins: 50, value: (s) => s.streak, goal: 30 },
  { key: 'spend', title: 'Первая покупка', cond: 'Потратить монетки в игре', coins: 10, value: (s) => s.spent, goal: 1 },
  { key: 'invite', title: 'Позвал друга', cond: 'Друг зарегистрировался по вашей ссылке и сыграл в две разные игры', coins: 20, value: (s) => s.friends, goal: 1 },
  { key: 'invite5', title: 'Своя компания', cond: 'Пять друзей по вашей ссылке', coins: 50, value: (s) => s.friends, goal: 5 },
  { key: 'podium', title: 'Призёр недели', cond: 'Занять место с первого по третье в турнире недели', coins: 30, value: (s) => (s.place && s.place <= 3 ? 1 : 0), goal: 1 },
  { key: 'champion', title: 'Чемпион недели', cond: 'Выиграть турнир недели', coins: 50, value: (s) => (s.place === 1 ? 1 : 0), goal: 1 },
  { key: 'email', title: 'Настоящая почта', cond: 'Подтвердить почту', coins: 10, value: (s) => s.verified, goal: 1 },
  { key: 'avatar', title: 'Своё лицо', cond: 'Выбрать аватарку в профиле', coins: 10, value: (s) => s.avatar, goal: 1 },
];

export function migrateRewards(db) {
  db.exec(`
    -- Полученные достижения: одно на аккаунт, награда — вместе со строкой.
    CREATE TABLE IF NOT EXISTS player_achievements (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key     TEXT NOT NULL,
      at      INTEGER NOT NULL,
      PRIMARY KEY (user_id, key)
    );

    -- Турнир недели: неделя — дата её понедельника по STATS_TZ. Игру и таблицу выбирает владелец.
    CREATE TABLE IF NOT EXISTS tournaments (
      week       TEXT PRIMARY KEY,
      game_id    TEXT NOT NULL,
      game_title TEXT NOT NULL,     -- название на момент выбора: итоги читаются, даже если игру удалят
      board      TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      settled_at INTEGER            -- когда выданы призы; NULL — неделя идёт или итоги не подведены
    );
    -- Лучший результат игрока за неделю турнира; place — призовое место после итогов.
    CREATE TABLE IF NOT EXISTS tournament_scores (
      week    TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score   INTEGER NOT NULL,
      at      INTEGER NOT NULL,
      place   INTEGER,
      PRIMARY KEY (week, user_id)
    );
    CREATE INDEX IF NOT EXISTS tournament_rank ON tournament_scores(week, score DESC, at);

    -- Приглашения: кто кого позвал. status: pending — друг ещё не засчитан (сыграл меньше чем в INVITE_GAMES игр),
    -- rewarded — награды выданы, refused — без награды (лимит приглашений или пригласивший заблокирован).
    -- seen_at — пригласивший увидел уведомление «друг засчитан».
    CREATE TABLE IF NOT EXISTS invites (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS invites_by_inviter ON invites(inviter_id, status);
    CREATE INDEX IF NOT EXISTS invites_by_decided ON invites(status, decided_at);

    -- В какие игры вошедший игрок играл: так засчитывается приглашённый друг.
    CREATE TABLE IF NOT EXISTS user_played_games (
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id  TEXT NOT NULL,
      first_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, game_id)
    );

    -- Итоги недели «кто привёл больше друзей»: winners — JSON [{ user_id, place, friends }], призы выданы вместе со строкой.
    CREATE TABLE IF NOT EXISTS invite_weeks (
      week       TEXT PRIMARY KEY,
      settled_at INTEGER NOT NULL,
      winners    TEXT NOT NULL DEFAULT '[]'
    );

    -- Для сводки достижений: рекорды и отзывы одного игрока.
    CREATE INDEX IF NOT EXISTS leaderboard_by_user ON leaderboard_scores(user_id);
    CREATE INDEX IF NOT EXISTS game_reviews_by_user ON game_reviews(user_id);
  `);
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`); };
  add('daily_streak', 'INTEGER NOT NULL DEFAULT 0'); // дней подряд по последний полученный бонус
  add('invite_code', 'TEXT');  // код личной ссылки-приглашения, выдаётся при первом показе
  add('reg_ip', 'TEXT');       // отпечаток (HMAC) адреса при регистрации — сам адрес не храним
  add('reg_vid', 'TEXT');      // хэш cookie браузера при регистрации
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_invite_code ON users(invite_code)');
  if (!db.prepare('PRAGMA table_info(invites)').all().some((c) => c.name === 'seen_at')) {
    db.exec('ALTER TABLE invites ADD COLUMN seen_at INTEGER');
  }
}

export function createRewards({
  db, now, dayOf, tz, secret, send, readJson, HttpError, requireUser, requireOwner, currentUser, cookies, clientIp,
  logAction, siteUrl,
}) {
  const q = {
    add: db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?'),
    ledger: db.prepare(`INSERT INTO coin_ledger (user_id, delta, kind, title, game_id, ref, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`),
    coins: db.prepare('SELECT coins FROM users WHERE id = ?'),
    user: db.prepare('SELECT id, name, blocked_at, reg_ip, reg_vid FROM users WHERE id = ?'),
    // серия
    daily: db.prepare('SELECT daily_bonus_day, daily_streak FROM users WHERE id = ?'),
    setDaily: db.prepare(`UPDATE users SET daily_bonus_day = ?, daily_streak = ? WHERE id = ?
                          AND (daily_bonus_day IS NULL OR daily_bonus_day <> ?)`),
    // достижения
    progress: db.prepare(`SELECT u.email_verified_at IS NOT NULL AS verified, u.avatar IS NOT NULL AS avatar,
                            u.daily_streak AS streak, u.daily_bonus_day AS day,
                            (SELECT COUNT(DISTINCT game_id) FROM leaderboard_scores WHERE user_id = u.id) AS records,
                            (SELECT COUNT(*) FROM game_reviews WHERE user_id = u.id) AS reviews,
                            EXISTS (SELECT 1 FROM coin_ledger WHERE user_id = u.id AND kind = 'spend') AS spent,
                            (SELECT COUNT(*) FROM invites WHERE inviter_id = u.id AND status = 'rewarded') AS friends,
                            (SELECT MIN(place) FROM tournament_scores WHERE user_id = u.id) AS place
                          FROM users u WHERE u.id = ?`),
    earned: db.prepare('SELECT key, at FROM player_achievements WHERE user_id = ?'),
    grant: db.prepare('INSERT OR IGNORE INTO player_achievements (user_id, key, at) VALUES (?, ?, ?)'),
    // турнир
    tournament: db.prepare('SELECT * FROM tournaments WHERE week = ?'),
    unsettled: db.prepare('SELECT * FROM tournaments WHERE week < ? AND settled_at IS NULL ORDER BY week'),
    settle: db.prepare('UPDATE tournaments SET settled_at = ? WHERE week = ? AND settled_at IS NULL'),
    lastSettled: db.prepare('SELECT * FROM tournaments WHERE settled_at IS NOT NULL ORDER BY week DESC LIMIT ?'),
    setTournament: db.prepare(`INSERT INTO tournaments (week, game_id, game_title, board, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
                               ON CONFLICT (week) DO UPDATE SET game_id = excluded.game_id, game_title = excluded.game_title,
                                 board = excluded.board, created_by = excluded.created_by, created_at = excluded.created_at`),
    dropTournament: db.prepare('DELETE FROM tournaments WHERE week = ?'),
    dropScores: db.prepare('DELETE FROM tournament_scores WHERE week = ?'),
    // Лучший результат побеждает, при равенстве — тот, кто показал его раньше.
    tUpsert: db.prepare(`INSERT INTO tournament_scores (week, user_id, score, at) VALUES (?, ?, ?, ?)
                         ON CONFLICT (week, user_id) DO UPDATE SET score = excluded.score, at = excluded.at
                         WHERE excluded.score > tournament_scores.score`),
    // Начали турнир посреди недели: рекорды, поставленные с понедельника, уже в зачёте.
    tSeed: db.prepare(`INSERT OR IGNORE INTO tournament_scores (week, user_id, score, at)
                       SELECT ?, user_id, score, updated_at FROM leaderboard_scores WHERE game_id = ? AND board = ? AND updated_at >= ?`),
    tTop: db.prepare(`SELECT s.user_id, s.score, s.at, s.place, u.name, u.avatar, ${LOOK_COLS} FROM tournament_scores s JOIN users u ON u.id = s.user_id
                      WHERE s.week = ? AND u.blocked_at IS NULL ORDER BY s.score DESC, s.at ASC LIMIT ?`),
    tMine: db.prepare('SELECT score, at FROM tournament_scores WHERE week = ? AND user_id = ?'),
    tRank: db.prepare(`SELECT COUNT(*) AS n FROM tournament_scores s JOIN users u ON u.id = s.user_id
                       WHERE s.week = ? AND u.blocked_at IS NULL AND (s.score > ? OR (s.score = ? AND s.at < ?))`),
    tCount: db.prepare(`SELECT COUNT(*) AS n FROM tournament_scores s JOIN users u ON u.id = s.user_id
                        WHERE s.week = ? AND u.blocked_at IS NULL`),
    setPlace: db.prepare('UPDATE tournament_scores SET place = ? WHERE week = ? AND user_id = ?'),
    winners: db.prepare(`SELECT s.place, s.score, u.name, u.avatar, ${LOOK_COLS} FROM tournament_scores s JOIN users u ON u.id = s.user_id
                         WHERE s.week = ? AND s.place IS NOT NULL ORDER BY s.place`),
    game: db.prepare("SELECT id, slug, title, genre, cover, icon, status FROM games WHERE id = ?"),
    games: db.prepare("SELECT id, title FROM games WHERE status = 'approved' ORDER BY title COLLATE NOCASE"),
    boards: db.prepare(`SELECT s.game_id, s.board, COUNT(*) AS players FROM leaderboard_scores s JOIN games g ON g.id = s.game_id
                        WHERE g.status = 'approved' GROUP BY s.game_id, s.board ORDER BY players DESC`),
    // приглашения
    code: db.prepare('SELECT invite_code FROM users WHERE id = ?'),
    setCode: db.prepare('UPDATE users SET invite_code = ? WHERE id = ? AND invite_code IS NULL'),
    byCode: db.prepare('SELECT id, reg_ip, reg_vid FROM users WHERE invite_code = ?'),
    setOrigin: db.prepare('UPDATE users SET reg_ip = ?, reg_vid = ? WHERE id = ?'),
    insertInvite: db.prepare('INSERT OR IGNORE INTO invites (user_id, inviter_id, created_at) VALUES (?, ?, ?)'),
    pendingInvite: db.prepare("SELECT * FROM invites WHERE user_id = ? AND status = 'pending'"),
    decideInvite: db.prepare("UPDATE invites SET status = ?, decided_at = ? WHERE user_id = ? AND status = 'pending'"),
    rewardedCount: db.prepare("SELECT COUNT(*) AS n FROM invites WHERE inviter_id = ? AND status = 'rewarded'"),
    inviteStats: db.prepare(`SELECT COUNT(*) AS invited, COALESCE(SUM(status = 'rewarded'), 0) AS confirmed
                             FROM invites WHERE inviter_id = ?`),
    inviteCoins: db.prepare(`SELECT COALESCE(SUM(delta), 0) AS n FROM coin_ledger
                             WHERE user_id = ? AND kind = 'referral' AND ref LIKE 'invite:%'`),
    played: db.prepare('INSERT OR IGNORE INTO user_played_games (user_id, game_id, first_at) VALUES (?, ?, ?)'),
    playedCount: db.prepare('SELECT COUNT(*) AS n FROM user_played_games WHERE user_id = ?'),
    grantItem: db.prepare('INSERT OR IGNORE INTO user_items (user_id, item, bought_at) VALUES (?, ?, ?)'),
    // Уведомления пригласившему: засчитанные друзья, которых он ещё не видел.
    unseen: db.prepare(`SELECT i.user_id, u.name FROM invites i JOIN users u ON u.id = i.user_id
                        WHERE i.inviter_id = ? AND i.status = 'rewarded' AND i.seen_at IS NULL ORDER BY i.decided_at`),
    unseenCount: db.prepare("SELECT COUNT(*) AS n FROM invites WHERE inviter_id = ? AND status = 'rewarded' AND seen_at IS NULL"),
    markSeen: db.prepare("UPDATE invites SET seen_at = ? WHERE inviter_id = ? AND status = 'rewarded' AND seen_at IS NULL"),
    pendingFriends: db.prepare(`SELECT u.name, (SELECT COUNT(*) FROM user_played_games d WHERE d.user_id = i.user_id) AS games
                                FROM invites i JOIN users u ON u.id = i.user_id
                                WHERE i.inviter_id = ? AND i.status = 'pending' ORDER BY i.created_at DESC LIMIT 20`),
    // Кто привёл больше друзей: засчитанные за период [from, to).
    inviteTop: db.prepare(`SELECT i.inviter_id AS user_id, COUNT(*) AS friends, MAX(i.decided_at) AS last_at, u.name, u.avatar, ${LOOK_COLS}
                           FROM invites i JOIN users u ON u.id = i.inviter_id
                           WHERE i.status = 'rewarded' AND i.decided_at >= ? AND i.decided_at < ? AND u.blocked_at IS NULL
                           GROUP BY i.inviter_id ORDER BY friends DESC, last_at ASC LIMIT ?`),
    inviteMine: db.prepare(`SELECT COUNT(*) AS n FROM invites WHERE inviter_id = ? AND status = 'rewarded' AND decided_at >= ? AND decided_at < ?`),
    firstRewarded: db.prepare("SELECT MIN(decided_at) AS t FROM invites WHERE status = 'rewarded'"),
    inviteWeek: db.prepare('SELECT * FROM invite_weeks WHERE week = ?'),
    lastInviteWeek: db.prepare('SELECT * FROM invite_weeks ORDER BY week DESC LIMIT 1'),
    settleInviteWeek: db.prepare('INSERT OR IGNORE INTO invite_weeks (week, settled_at, winners) VALUES (?, ?, ?)'),
    userLook: db.prepare(`SELECT u.id, u.name, u.avatar, ${LOOK_COLS} FROM users u WHERE u.id = ?`),
    byCodePublic: db.prepare(`SELECT u.name, u.avatar, ${LOOK_COLS} FROM users u WHERE u.invite_code = ? AND u.blocked_at IS NULL`),
  };

  function tx(fn) {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  // Начисление внутри уже открытой транзакции: баланс и журнал меняются вместе с отметкой о награде.
  function credit(userId, coins, kind, title, ref = null, gameId = null) {
    q.add.run(coins, userId);
    q.ledger.run(userId, coins, kind, title, gameId, ref, now());
  }

  // ---------- дни и недели по часовому поясу статистики ----------
  const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
  // Неделя — дата её понедельника.
  const weekOf = (t) => {
    const day = dayOf(t);
    return addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
  };
  const partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  // Насколько часы пояса впереди UTC в момент ms.
  function zoneOffset(ms) {
    const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }
  // Полночь дня по поясу — в миллисекундах.
  function midnight(day) {
    const utc = Date.parse(`${day}T00:00:00Z`);
    return utc - zoneOffset(utc - zoneOffset(utc));
  }

  // ---------- серия входов ----------
  const streakCoins = (n) => STREAK_COINS[(n - 1) % STREAK_COINS.length];
  // Состояние серии на сегодня. streak — дней подряд с бонусом (серия жива, если бонус брали сегодня или вчера),
  // day — какой день круга сегодня, amount — бонус сегодняшнего дня, tomorrow — завтрашнего.
  function streakInfo(userId) {
    const row = q.daily.get(userId) || {};
    const today = dayOf(now());
    const claimed = row.daily_bonus_day === today;
    const alive = claimed || row.daily_bonus_day === addDays(today, -1);
    const streak = alive ? Math.max(1, row.daily_streak || 0) : 0; // старые аккаунты без счётчика — с первого дня
    const n = claimed ? streak : streak + 1;
    return {
      available: !claimed, streak, day: ((n - 1) % STREAK_COINS.length) + 1,
      amount: streakCoins(n), tomorrow: streakCoins(n + 1), days: STREAK_COINS,
    };
  }

  // Бонус за вход: раз в календарный день. Пропустили день — серия начинается заново.
  function claimDaily(userId) {
    const today = dayOf(now());
    const before = streakInfo(userId);
    let claimed = 0;
    if (before.available) {
      const n = before.streak + 1;
      tx(() => {
        if (!q.setDaily.run(today, n, userId, today).changes) return;
        credit(userId, before.amount, 'daily', n > 1 ? `Бонус за вход, ${n}-й день подряд` : 'Бонус за вход');
        claimed = before.amount;
      });
    }
    const achievements = claimed ? checkAchievements(userId) : [];
    return { claimed, streak: streakInfo(userId), achievements, friends: friendNews(userId) };
  }

  // ---------- достижения ----------
  const achievementView = (a, at = null, s = null) => ({
    key: a.key, title: a.title, cond: a.cond, coins: a.coins, goal: a.goal, earned_at: at,
    value: s ? Math.min(a.goal, Number(a.value(s)) || 0) : a.goal,
  });

  function progress(userId) {
    const s = q.progress.get(userId);
    if (!s) return null;
    // Серия, которая уже прервалась, в счётчике профиля не показывается — нужны дни подряд.
    const today = dayOf(now());
    if (s.day !== today && s.day !== addDays(today, -1)) s.streak = 0;
    return s;
  }

  // Проверяет условия и выдаёт новые достижения. Возвращает только что полученные.
  function checkAchievements(userId) {
    const s = progress(userId);
    if (!s) return [];
    const have = new Set(q.earned.all(userId).map((r) => r.key));
    const fresh = ACHIEVEMENTS.filter((a) => !have.has(a.key) && a.value(s) >= a.goal);
    if (!fresh.length) return [];
    const t = now();
    return tx(() => fresh.filter((a) => {
      if (!q.grant.run(userId, a.key, t).changes) return false;
      credit(userId, a.coins, 'achievement', `Достижение «${a.title}»`, a.key);
      return true;
    })).map((a) => achievementView(a, t));
  }

  function achievementList(userId) {
    const s = progress(userId);
    const at = new Map(q.earned.all(userId).map((r) => [r.key, r.at]));
    return ACHIEVEMENTS.map((a) => achievementView(a, at.get(a.key) ?? null, at.has(a.key) ? null : s));
  }

  // ---------- турнир недели ----------
  // Итоги недель, которые уже закончились: призы трём лучшим, один раз.
  function settle() {
    for (const t of q.unsettled.all(weekOf(now()))) {
      const winners = tx(() => {
        if (!q.settle.run(now(), t.week).changes) return [];
        const top = q.tTop.all(t.week, TOURNAMENT_PRIZES.length);
        top.forEach((r, i) => {
          q.setPlace.run(i + 1, t.week, r.user_id);
          credit(r.user_id, TOURNAMENT_PRIZES[i], 'tournament', `Турнир недели: ${i + 1}-е место, ${t.game_title}`, `tournament:${t.week}`, null);
        });
        return top;
      });
      for (const r of winners) checkAchievements(r.user_id);
    }
    settleInvites();
  }

  // Результат из таблицы рекордов игры: если на этой неделе турнир по ней, он идёт и в зачёт турнира.
  function onScore(gameId, board, userId, score) {
    const t = q.tournament.get(weekOf(now()));
    if (t && t.game_id === gameId && t.board === board) q.tUpsert.run(t.week, userId, score, now());
    checkAchievements(userId);
  }

  const entry = (r, i, user) => ({ rank: i + 1, name: r.name, avatar: avatarUrl(r.avatar), ...lookOf(r), score: r.score, me: !!user && r.user_id === user.id });

  function tournamentView(t, user, top = 10) {
    const g = q.game.get(t.game_id);
    const mine = user ? q.tMine.get(t.week, user.id) : null;
    return {
      week: t.week, starts_at: midnight(t.week), ends_at: midnight(addDays(t.week, 7)), board: t.board,
      game: g && g.status === 'approved'
        ? { id: g.id, slug: g.slug, title: g.title, genre: g.genre, cover: g.cover, icon: g.icon }
        : { id: t.game_id, slug: null, title: t.game_title },
      prizes: TOURNAMENT_PRIZES,
      total: q.tCount.get(t.week).n,
      top: q.tTop.all(t.week, top).map((r, i) => entry(r, i, user)),
      me: mine ? { rank: q.tRank.get(t.week, mine.score, mine.score, mine.at).n + 1, score: mine.score } : null,
    };
  }

  const resultsView = (t) => ({
    week: t.week, game_id: t.game_id, game_title: t.game_title, board: t.board, settled_at: t.settled_at,
    total: q.tCount.get(t.week).n,
    winners: q.winners.all(t.week).map((w) => ({ place: w.place, name: w.name, avatar: avatarUrl(w.avatar), ...lookOf(w), score: w.score })),
  });

  function currentTournament(req, res) {
    settle();
    const user = currentUser(req);
    const t = q.tournament.get(weekOf(now()));
    const last = q.lastSettled.get(1);
    send(res, 200, { tournament: t ? tournamentView(t, user) : null, last: last ? resultsView(last) : null, now: now() });
  }

  // Владелец: текущий и следующий турнир, прошлые итоги и игры с их таблицами рекордов.
  function adminTournaments(req, res) {
    requireOwner(req);
    settle();
    const current = weekOf(now());
    const next = addDays(current, 7);
    const boards = new Map();
    for (const b of q.boards.all()) {
      if (!boards.has(b.game_id)) boards.set(b.game_id, []);
      boards.get(b.game_id).push({ board: b.board, players: b.players });
    }
    const plan = (week) => {
      const t = q.tournament.get(week);
      return { week, starts_at: midnight(week), ends_at: midnight(addDays(week, 7)), tournament: t ? tournamentView(t, null, 3) : null };
    };
    send(res, 200, {
      current: plan(current), next: plan(next),
      past: q.lastSettled.all(12).map(resultsView),
      games: q.games.all().map((g) => ({ ...g, boards: boards.get(g.id) || [] })),
      prizes: TOURNAMENT_PRIZES,
    });
  }

  async function adminSetTournament(req, res) {
    const owner = requireOwner(req);
    const { when, game_id: gameId, board: rawBoard } = await readJson(req);
    const current = weekOf(now());
    const week = when === 'next' ? addDays(current, 7) : when === 'current' ? current : null;
    if (!week) throw new HttpError(400, 'when: current или next');
    const game = typeof gameId === 'string' ? q.game.get(gameId) : null;
    if (!game || game.status !== 'approved') throw new HttpError(404, 'Игра не найдена');
    const board = String(rawBoard ?? 'main').trim() || 'main';
    if (!BOARD_RE.test(board)) throw new HttpError(400, 'Имя таблицы: латиница, цифры, «_», «-», «.», до 40 символов');
    const old = q.tournament.get(week);
    tx(() => {
      // Сменили игру или таблицу — прежние результаты недели не в счёт.
      if (old && (old.game_id !== game.id || old.board !== board)) q.dropScores.run(week);
      q.setTournament.run(week, game.id, game.title, board, owner.id, now());
      if (week === current) q.tSeed.run(week, game.id, board, midnight(week));
    });
    logAction(owner, 'tournament.set', week, `${game.title}, таблица ${board}`);
    send(res, 200, { tournament: tournamentView(q.tournament.get(week), null, 3) });
  }

  function adminClearTournament(req, res, week) {
    const owner = requireOwner(req);
    const t = WEEK_RE.test(week) ? q.tournament.get(week) : null;
    if (!t) throw new HttpError(404, 'Турнира на эту неделю нет');
    if (t.settled_at || week < weekOf(now())) throw new HttpError(409, 'Неделя уже закончилась, итоги не отменяются');
    tx(() => { q.dropScores.run(week); q.dropTournament.run(week); });
    logAction(owner, 'tournament.clear', week, `${t.game_title}, таблица ${t.board}`);
    send(res, 200, { ok: true });
  }

  // ---------- приглашения ----------
  // Код ссылки случайный и хранится у игрока: по нему нельзя узнать номер аккаунта.
  function inviteCode(userId) {
    for (let i = 0; i < 5; i++) {
      const code = q.code.get(userId)?.invite_code;
      if (code) return code;
      try { q.setCode.run(randomBytes(6).toString('base64url'), userId); } catch { /* совпал с чужим — ещё раз */ }
    }
    throw new HttpError(500, 'Не получилось выдать ссылку');
  }

  // Адрес не храним: только HMAC от него, чтобы узнать регистрацию с того же адреса.
  const ipMark = (ip) => createHmac('sha256', secret).update(`reg-ip:${ip}`).digest('hex').slice(0, 32);

  // Регистрация: запоминаем, откуда она, и кто пригласил (cookie invite ставит страница по ссылке ?invite=).
  // Себя пригласить нельзя: тот же браузер, тот же адрес, что при регистрации пригласившего, или он сам вошёл в этом браузере.
  function onRegister(req, userId) {
    const c = cookies(req);
    const ip = ipMark(clientIp(req));
    const vid = c.vid && /^[A-Za-z0-9_-]{43}$/.test(c.vid) ? sha256(c.vid) : null;
    q.setOrigin.run(ip, vid, userId);
    if (!INVITE_RE.test(c.invite || '')) return;
    const inviter = q.byCode.get(c.invite);
    if (!inviter || inviter.id === userId) return;
    const self = currentUser(req)?.id === inviter.id || inviter.reg_ip === ip || (vid && inviter.reg_vid === vid);
    if (!self) q.insertInvite.run(userId, inviter.id, now());
  }

  // Друг засчитан: монетки обоим, пригласившему — предметы витрины за 3/5/10 друзей. Один раз: решение по
  // приглашению и начисления — одной транзакцией.
  function rewardInvite(userId) {
    const inv = q.pendingInvite.get(userId);
    if (!inv) return;
    tx(() => {
      const inviter = q.user.get(inv.inviter_id);
      const ok = inviter && !inviter.blocked_at && q.rewardedCount.get(inviter.id).n < MAX_INVITES;
      if (!q.decideInvite.run(ok ? 'rewarded' : 'refused', now(), userId).changes || !ok) return;
      const friend = q.user.get(userId);
      credit(inviter.id, INVITE_COINS, 'referral', `Друг принял приглашение: ${friend.name}`, `invite:${userId}`);
      credit(userId, INVITED_COINS, 'referral', 'Подарок за регистрацию по приглашению', 'invited');
      const friends = q.rewardedCount.get(inviter.id).n;
      for (const it of INVITE_ITEMS) if (friends >= it.friends) q.grantItem.run(inviter.id, it.id, now());
    });
    checkAchievements(inv.inviter_id);
  }

  // Почта подтверждена: приглашение засчитывается сразу, без дней игры.
  function onVerified(userId) {
    rewardInvite(userId);
    checkAchievements(userId);
  }

  // Вошедший игрок запустил игру: отмечаем её; на INVITE_GAMES-й разной игре друг засчитан.
  function onPlay(userId, gameId) {
    q.played.run(userId, gameId, now());
    if (q.pendingInvite.get(userId) && q.playedCount.get(userId).n >= INVITE_GAMES) rewardInvite(userId);
  }

  // Для бонуса за вход (его просит каждая страница): какие друзья засчитаны с прошлого раза и что этим открыто.
  function friendNews(userId) {
    const fresh = q.unseen.all(userId);
    if (!fresh.length) return null;
    q.markSeen.run(now(), userId);
    const total = q.rewardedCount.get(userId).n;
    const before = total - fresh.length;
    return {
      names: fresh.map((f) => f.name), coins: fresh.length * INVITE_COINS,
      unlocked: INVITE_ITEMS.filter((it) => it.friends > before && it.friends <= total).map((it) => ({ id: it.id, title: it.title })),
    };
  }

  function inviteInfo(userId) {
    const code = inviteCode(userId);
    const { invited, confirmed } = q.inviteStats.get(userId);
    return {
      url: `${siteUrl}/?invite=${code}`, code, invited, confirmed, coins: q.inviteCoins.get(userId).n,
      limit: MAX_INVITES, reward: INVITE_COINS, friend_reward: INVITED_COINS, play_games: INVITE_GAMES,
      pending: q.pendingFriends.all(userId).map((p) => ({ name: p.name, games: Math.min(p.games, INVITE_GAMES) })),
      items: INVITE_ITEMS.map((it) => ({ id: it.id, slot: it.slot, key: it.key, title: it.title, friends: it.friends, image: it.image || null })),
    };
  }

  // ---------- кто привёл больше друзей ----------
  // Итоги прошедших недель: призы трём лучшим (только у кого хоть один засчитанный друг), один раз.
  function settleInvites() {
    const current = weekOf(now());
    const last = q.lastInviteWeek.get();
    let week = last ? addDays(last.week, 7) : (() => { const t = q.firstRewarded.get().t; return t ? weekOf(t) : current; })();
    for (; week < current; week = addDays(week, 7)) {
      const from = midnight(week), to = midnight(addDays(week, 7));
      const winners = tx(() => {
        const top = q.inviteTop.all(from, to, INVITE_WEEK_PRIZES.length);
        if (!q.settleInviteWeek.run(week, now(), JSON.stringify(top.map((r, i) => ({ user_id: r.user_id, place: i + 1, friends: r.friends })))).changes) return [];
        top.forEach((r, i) => credit(r.user_id, INVITE_WEEK_PRIZES[i], 'referral', `Больше всех друзей за неделю: ${i + 1}-е место`, `invite-week:${week}`));
        return top;
      });
      for (const r of winners) checkAchievements(r.user_id);
    }
  }

  const inviterRow = (r, i, user) => ({ rank: i + 1, name: r.name, avatar: avatarUrl(r.avatar), ...lookOf(r), friends: r.friends, me: !!user && r.user_id === user.id });

  function inviteBoard(req, res) {
    settle();
    const user = currentUser(req);
    const week = weekOf(now());
    const from = midnight(week), to = midnight(addDays(week, 7));
    const lastRow = q.lastInviteWeek.get();
    const last = lastRow ? JSON.parse(lastRow.winners).map((w) => {
      const u = q.userLook.get(w.user_id);
      return u ? { place: w.place, friends: w.friends, name: u.name, avatar: avatarUrl(u.avatar), ...lookOf(u) } : null;
    }).filter(Boolean) : [];
    send(res, 200, {
      week: { starts_at: from, ends_at: to, prizes: INVITE_WEEK_PRIZES, top: q.inviteTop.all(from, to, 10).map((r, i) => inviterRow(r, i, user)),
        mine: user ? q.inviteMine.get(user.id, from, to).n : null },
      all: q.inviteTop.all(0, 8.64e15, 10).map((r, i) => inviterRow(r, i, user)),
      last: lastRow ? { week: lastRow.week, winners: last } : null,
      reward: INVITE_COINS, friend_reward: INVITED_COINS, play_games: INVITE_GAMES,
    });
  }

  // Ссылка-вызов: кто позвал (имя и вид, как в таблицах рекордов — это и так видно всем).
  function publicInvite(req, res, code) {
    const u = INVITE_RE.test(code) ? q.byCodePublic.get(code) : null;
    if (!u) throw new HttpError(404, 'Приглашение не найдено');
    send(res, 200, { name: u.name, avatar: avatarUrl(u.avatar), ...lookOf(u), friend_reward: INVITED_COINS });
  }

  function myInvite(req, res) {
    const user = requireUser(req);
    const code = inviteCode(user.id);
    send(res, 200, { code, url: `${siteUrl}/?invite=${code}`, reward: INVITE_COINS, friend_reward: INVITED_COINS, play_games: INVITE_GAMES });
  }

  // Профиль: серия, достижения (заодно выдаются новые), приглашения.
  function myRewards(req, res) {
    const user = requireUser(req);
    settle();
    const fresh = checkAchievements(user.id);
    send(res, 200, {
      streak: streakInfo(user.id), achievements: achievementList(user.id), fresh,
      invite: inviteInfo(user.id), coins: q.coins.get(user.id).coins,
    });
  }

  // Обработчик для пути и метода или null, если путь не наш.
  function route(p, m) {
    let mm;
    if (p === '/api/me/rewards' && m === 'GET') return myRewards;
    if (p === '/api/me/invite' && m === 'GET') return myInvite;
    if (p === '/api/invites/top' && m === 'GET') return inviteBoard;
    if ((mm = p.match(/^\/api\/invite\/([A-Za-z0-9_-]{8})$/)) && m === 'GET') return (req, res) => publicInvite(req, res, mm[1]);
    if (p === '/api/tournament' && m === 'GET') return currentTournament;
    if (p === '/api/admin/tournaments' && m === 'GET') return adminTournaments;
    if (p === '/api/admin/tournaments' && m === 'POST') return adminSetTournament;
    if ((mm = p.match(/^\/api\/admin\/tournaments\/([\d-]{10})$/)) && m === 'DELETE') return (req, res) => adminClearTournament(req, res, mm[1]);
    return null;
  }

  return {
    route, settle, onScore, onRegister, onVerified, onPlay, checkAchievements, weekOf,
    hasFriendNews: (userId) => q.unseenCount.get(userId).n > 0,
    // Бонус за вход для server/economy.js: тот же адрес /api/me/coins/daily, теперь с серией.
    daily: { claim: claimDaily, info: streakInfo, available: (userId) => streakInfo(userId).available },
  };
}
