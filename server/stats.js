// Счётчик запусков и статистика для автора.
//
// Запуск = игрок открыл одобренную игру в каталоге. Повторное открытие тем же игроком
// в течение 30 минут — та же сессия, не новый запуск. Время в игре присылает браузер
// при закрытии. Это клиентские данные: перед выплатами по ним нужен антифрод.

const SESSION_GAP_MS = 30 * 60 * 1000;
const MAX_SESSION_SEC = 2 * 3600;
const END_GRACE_MS = MAX_SESSION_SEC * 1000 + 10 * 60 * 1000;
const MAX_PLAYS_PER_IP_GAME_DAY = 30;
const MAX_ADS_PER_IP_GAME_DAY = 300; // защита от накрутки показов одним браузером
export const AD_KINDS = ['fullscreen', 'rewarded', 'banner'];
const BOT_UA = /bot|crawl|spider|slurp|headless|preview|lighthouse|curl|wget|python|java\/|go-http/i;

export function createStats({ db, now = Date.now, tz = 'Europe/Moscow' }) {
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayOf = (ms) => dayFmt.format(new Date(ms)); // YYYY-MM-DD
  const shiftDay = (day, delta) => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  };

  const q = {
    visitor: db.prepare('SELECT * FROM play_visitors WHERE game_id = ? AND day = ? AND visitor = ?'),
    upsertVisitor: db.prepare(`INSERT INTO play_visitors (game_id, day, visitor, last_at, open) VALUES (?, ?, ?, ?, 1)
                               ON CONFLICT (game_id, day, visitor) DO UPDATE SET last_at = excluded.last_at, open = 1`),
    closeVisitor: db.prepare('UPDATE play_visitors SET open = 0 WHERE game_id = ? AND day = ? AND visitor = ?'),
    addDaily: db.prepare(`INSERT INTO play_daily (game_id, day, plays, uniques, seconds) VALUES (?, ?, ?, ?, ?)
                          ON CONFLICT (game_id, day) DO UPDATE SET plays = plays + excluded.plays,
                            uniques = uniques + excluded.uniques, seconds = seconds + excluded.seconds`),
    prune: db.prepare('DELETE FROM play_visitors WHERE day < ?'),
    // Новый день у игрока: +1 к дням, если он уже играл раньше.
    player: db.prepare(`INSERT INTO game_players (game_id, visitor, first_day, last_day, days) VALUES (?, ?, ?, ?, 1)
                         ON CONFLICT (game_id, visitor) DO UPDATE SET days = days + (last_day <> excluded.last_day),
                           last_day = excluded.last_day`),
    // Игроки по играм автора за период: активные (играли в периоде), новые (впервые в периоде), вернувшиеся
    // (играли хотя бы в двух разных днях и хотя бы раз в периоде).
    authorPlayers: db.prepare(`SELECT p.game_id, COUNT(*) AS players, SUM(p.first_day >= ?) AS fresh,
                                  SUM(p.days >= 2) AS came_back
                                FROM game_players p JOIN games g ON g.id = p.game_id
                                WHERE g.author_id = ? AND p.last_day >= ? GROUP BY p.game_id`),
    // За всё время: сохранения, оценки, отзывы, игроки в таблицах рекордов.
    authorEngagement: db.prepare(`SELECT g.id AS game_id,
        (SELECT COUNT(*) FROM game_saves s WHERE s.game_id = g.id) AS saves,
        (SELECT COUNT(*) FROM game_votes v WHERE v.game_id = g.id AND v.value = 1) AS likes,
        (SELECT COUNT(*) FROM game_votes v WHERE v.game_id = g.id AND v.value = -1) AS dislikes,
        (SELECT COUNT(*) FROM game_reviews r WHERE r.game_id = g.id) AS reviews,
        (SELECT COUNT(DISTINCT l.user_id) FROM leaderboard_scores l WHERE l.game_id = g.id) AS ranked
      FROM games g WHERE g.author_id = ?`),
    gameDaily: db.prepare(`SELECT d.day, d.plays, d.uniques, d.seconds FROM play_daily d JOIN games g ON g.id = d.game_id
                           WHERE g.author_id = ? AND d.game_id = ? AND d.day BETWEEN ? AND ?`),
    gameAdsDaily: db.prepare(`SELECT a.day, a.fullscreen, a.rewarded, a.banner FROM ad_daily a JOIN games g ON g.id = a.game_id
                              WHERE g.author_id = ? AND a.game_id = ? AND a.day BETWEEN ? AND ?`),
    addAd: Object.fromEntries(AD_KINDS.map((k) => [k, db.prepare(
      `INSERT INTO ad_daily (game_id, day, ${k}) VALUES (?, ?, 1) ON CONFLICT (game_id, day) DO UPDATE SET ${k} = ${k} + 1`)])),
    authorAdsDaily: db.prepare(`SELECT a.day, SUM(a.fullscreen) AS fullscreen, SUM(a.rewarded) AS rewarded, SUM(a.banner) AS banner
                                FROM ad_daily a JOIN games g ON g.id = a.game_id
                                WHERE g.author_id = ? AND a.day BETWEEN ? AND ? GROUP BY a.day`),
    authorAdsGames: db.prepare(`SELECT a.game_id, SUM(a.fullscreen + a.rewarded) AS ads
                                FROM ad_daily a JOIN games g ON g.id = a.game_id
                                WHERE g.author_id = ? AND a.day BETWEEN ? AND ? GROUP BY a.game_id`),
    authorDaily: db.prepare(`SELECT d.day, SUM(d.plays) AS plays, SUM(d.uniques) AS uniques, SUM(d.seconds) AS seconds
                             FROM play_daily d JOIN games g ON g.id = d.game_id
                             WHERE g.author_id = ? AND d.day BETWEEN ? AND ? GROUP BY d.day`),
    authorGames: db.prepare(`SELECT g.id, g.title, g.status,
                               COALESCE(SUM(CASE WHEN d.day BETWEEN ? AND ? THEN d.plays END), 0) AS plays,
                               COALESCE(SUM(CASE WHEN d.day BETWEEN ? AND ? THEN d.uniques END), 0) AS uniques,
                               COALESCE(SUM(CASE WHEN d.day BETWEEN ? AND ? THEN d.seconds END), 0) AS seconds,
                               COALESCE(SUM(d.plays), 0) AS plays_all_time
                             FROM games g LEFT JOIN play_daily d ON d.game_id = g.id
                             WHERE g.author_id = ? GROUP BY g.id ORDER BY plays DESC, g.created_at DESC`),
  };

  db.exec(`INSERT OR IGNORE INTO game_players (game_id, visitor, first_day, last_day, days)
           SELECT game_id, visitor, MIN(day), MAX(day), COUNT(DISTINCT day) FROM play_visitors GROUP BY game_id, visitor`);

  // Считаем, сколько запусков уже засчитано с одного IP на игру за день (в памяти процесса).
  const perIp = new Map();
  const adsPerIp = new Map();
  let lastPruneDay = '';

  function maintenance(today) {
    if (today === lastPruneDay) return;
    lastPruneDay = today;
    q.prune.run(shiftDay(today, -2));
    perIp.clear();
    adsPerIp.clear();
  }

  return {
    dayOf,
    isBot: (ua) => !ua || BOT_UA.test(ua),

    /** Открытие игры. Возвращает true, если засчитан новый запуск. */
    recordStart(gameId, visitor, ip) {
      const t = now();
      const day = dayOf(t);
      maintenance(day);
      const prev = q.visitor.get(gameId, day, visitor);
      if (prev && t - prev.last_at < SESSION_GAP_MS) {
        q.upsertVisitor.run(gameId, day, visitor, t);
        return false;
      }
      const ipKey = `${ip}|${gameId}`;
      const fromIp = perIp.get(ipKey) || 0;
      if (fromIp >= MAX_PLAYS_PER_IP_GAME_DAY) return false;
      perIp.set(ipKey, fromIp + 1);

      db.exec('BEGIN');
      try {
        q.upsertVisitor.run(gameId, day, visitor, t);
        q.addDaily.run(gameId, day, 1, prev ? 0 : 1, 0);
        q.player.run(gameId, visitor, day, day);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return true;
    },

    /** Показ рекламы в игре. Возвращает true, если засчитан. */
    recordAd(gameId, kind, ip) {
      if (!AD_KINDS.includes(kind)) return false;
      const day = dayOf(now());
      maintenance(day);
      const key = `${ip}|${gameId}`;
      const n = adsPerIp.get(key) || 0;
      if (n >= MAX_ADS_PER_IP_GAME_DAY) return false;
      adsPerIp.set(key, n + 1);
      q.addAd[kind].run(gameId, day);
      return true;
    },

    /** Закрытие игры: время сессии засчитывается один раз на открытие. */
    recordEnd(gameId, visitor, seconds) {
      const t = now();
      const today = dayOf(t);
      // Сессия могла начаться вчера (игра через полночь).
      const row = [today, shiftDay(today, -1)]
        .map((day) => q.visitor.get(gameId, day, visitor))
        .find((r) => r && r.open && t - r.last_at <= END_GRACE_MS);
      if (!row) return false;
      const elapsed = Math.floor((t - row.last_at) / 1000) + 5;
      const sec = Math.max(0, Math.min(Math.floor(Number(seconds) || 0), MAX_SESSION_SEC, elapsed));
      db.exec('BEGIN');
      try {
        q.closeVisitor.run(gameId, row.day, visitor);
        q.addDaily.run(gameId, row.day, 0, 0, sec);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return true;
    },

    /** Статистика автора за последние `days` дней, включая сегодня; gameId — только одна его игра. */
    authorStats(authorId, days, gameId = null) {
      const to = dayOf(now());
      const from = shiftDay(to, -(days - 1));
      const dailyRows = gameId ? q.gameDaily.all(authorId, gameId, from, to) : q.authorDaily.all(authorId, from, to);
      const adsRows = gameId ? q.gameAdsDaily.all(authorId, gameId, from, to) : q.authorAdsDaily.all(authorId, from, to);
      const byDay = new Map(dailyRows.map((r) => [r.day, r]));
      const adsByDay = new Map(adsRows.map((r) => [r.day, r]));
      const daily = [];
      for (let i = 0; i < days; i++) {
        const day = shiftDay(from, i);
        const r = byDay.get(day);
        const a = adsByDay.get(day);
        daily.push({
          day, plays: r?.plays ?? 0, uniques: r?.uniques ?? 0, seconds: r?.seconds ?? 0,
          ads: (a?.fullscreen ?? 0) + (a?.rewarded ?? 0), banners: a?.banner ?? 0,
        });
      }
      const adsByGame = new Map(q.authorAdsGames.all(authorId, from, to).map((r) => [r.game_id, r.ads]));
      const players = new Map(q.authorPlayers.all(from, authorId, from).map((r) => [r.game_id, r]));
      const engaged = new Map(q.authorEngagement.all(authorId).map((r) => [r.game_id, r]));
      const games = q.authorGames.all(from, to, from, to, from, to, authorId).map((g) => {
        const p = players.get(g.id);
        const e = engaged.get(g.id) || {};
        return {
          ...g, ads: adsByGame.get(g.id) ?? 0,
          players: p?.players ?? 0, fresh: p?.fresh ?? 0, returning: p?.came_back ?? 0,
          saves: e.saves ?? 0, likes: e.likes ?? 0, dislikes: e.dislikes ?? 0, reviews: e.reviews ?? 0, ranked: e.ranked ?? 0,
        };
      });
      const totals = daily.reduce((s, d) => ({
        plays: s.plays + d.plays, uniques: s.uniques + d.uniques, seconds: s.seconds + d.seconds, ads: s.ads + d.ads,
      }), { plays: 0, uniques: 0, seconds: 0, ads: 0 });
      // Уникальные, новые и вернувшиеся — по выбранной игре или сумма по играм (один человек в двух играх — двое).
      for (const k of ['players', 'fresh', 'returning', 'saves', 'likes', 'dislikes', 'reviews', 'ranked']) {
        totals[k] = games.filter((g) => !gameId || g.id === gameId).reduce((n, g) => n + g[k], 0);
      }
      return {
        period: { from, to, days, tz },
        game: gameId,
        totals,
        daily,
        games,
      };
    },
  };
}
