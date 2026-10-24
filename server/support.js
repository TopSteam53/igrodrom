// Ещё две траты монеток: «Поблагодарить автора» игры и «День без рекламы».
// Благодарность — знак внимания: автор видит её в статистике, рублей за неё не получает.
// День без рекламы — 24 часа без полноэкранной рекламы и баннеров; реклама за награду остаётся, её смотрят по желанию.

export const THANKS_AMOUNTS = [5, 10, 25];
export const THANKS_DAILY_LIMIT = 100;   // монеток в благодарностях от одного игрока за сутки
export const NO_ADS_PRICE = 30;
export const NO_ADS_MS = 24 * 3600 * 1000;

export function migrateSupport(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_thanks (
      id         INTEGER PRIMARY KEY,
      game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount     INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS game_thanks_by_game ON game_thanks(game_id, created_at);
    CREATE INDEX IF NOT EXISTS game_thanks_by_user ON game_thanks(user_id, created_at);
  `);
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('no_ads_until')) db.exec('ALTER TABLE users ADD COLUMN no_ads_until INTEGER');
}

export function createSupport({ db, now, send, readJson, HttpError, requireUser, economy }) {
  const q = {
    game: db.prepare(`SELECT g.id, g.title, g.author_id, g.status FROM games g WHERE g.id = ?`),
    add: db.prepare('INSERT INTO game_thanks (game_id, user_id, amount, created_at) VALUES (?, ?, ?, ?)'),
    givenToday: db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM game_thanks WHERE user_id = ? AND created_at >= ?'),
    total: db.prepare('SELECT COUNT(*) AS times, COALESCE(SUM(amount), 0) AS coins FROM game_thanks WHERE game_id = ?'),
    noAds: db.prepare('SELECT no_ads_until FROM users WHERE id = ?'),
    setNoAds: db.prepare('UPDATE users SET no_ads_until = ? WHERE id = ?'),
  };

  const noAdsUntil = (user) => {
    const t = user.no_ads_until ?? q.noAds.get(user.id)?.no_ads_until ?? 0;
    return t > now() ? t : 0;
  };

  async function thank(req, res, gameId) {
    const user = requireUser(req);
    const game = q.game.get(gameId);
    if (!game || game.status !== 'approved') throw new HttpError(404, 'Игра не найдена');
    if (game.author_id === user.id) throw new HttpError(400, 'Свою игру благодарить нельзя');
    const amount = Number((await readJson(req)).amount);
    if (!THANKS_AMOUNTS.includes(amount)) throw new HttpError(400, `Сумма: ${THANKS_AMOUNTS.join(', ')} монеток`);
    const today = q.givenToday.get(user.id, now() - 24 * 3600 * 1000).n;
    if (today + amount > THANKS_DAILY_LIMIT) {
      throw new HttpError(429, `За сутки можно отдать в благодарностях до ${THANKS_DAILY_LIMIT} монеток`);
    }
    const coins = economy.move(user.id, -amount, 'thanks', `Благодарность автору — ${game.title}`, { gameId: game.id });
    q.add.run(game.id, user.id, amount, now());
    send(res, 200, { coins, thanks: q.total.get(game.id) });
  }

  // Продлевает: купленный поверх действующего день добавляется к нему.
  function buyNoAds(req, res) {
    const user = requireUser(req);
    const from = Math.max(now(), noAdsUntil(user));
    const coins = economy.move(user.id, -NO_ADS_PRICE, 'no_ads', 'День без рекламы');
    q.setNoAds.run(from + NO_ADS_MS, user.id);
    send(res, 200, { coins, noAdsUntil: from + NO_ADS_MS });
  }

  function route(p, m) {
    let mm;
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/thanks$/)) && m === 'POST') return (req, res) => thank(req, res, mm[1]);
    if ((mm = p.match(/^\/api\/games\/([0-9a-f]{16})\/thanks$/)) && m === 'GET') return (req, res) => send(res, 200, { thanks: q.total.get(mm[1]) });
    if (p === '/api/me/no-ads' && m === 'POST') return buyNoAds;
    return null;
  }

  return { route, noAdsUntil, thanksOf: (gameId) => q.total.get(gameId) };
}
