import { DatabaseSync } from 'node:sqlite';

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY,
      email      TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      pass_hash  TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS games (
      id            TEXT PRIMARY KEY,
      author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      genre         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
      reject_reason TEXT,
      size          INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS games_by_status ON games(status, created_at);
    CREATE INDEX IF NOT EXISTS games_by_author ON games(author_id, created_at);
  `);

  db.exec(`
    -- Агрегаты по дням (день — по часовому поясу STATS_TZ). Источник для статистики автора.
    CREATE TABLE IF NOT EXISTS play_daily (
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      day     TEXT NOT NULL,              -- YYYY-MM-DD
      plays   INTEGER NOT NULL DEFAULT 0, -- запуски (повтор того же игрока в течение 30 минут не считается)
      uniques INTEGER NOT NULL DEFAULT 0, -- разные игроки за день
      seconds INTEGER NOT NULL DEFAULT 0, -- суммарное время в игре
      PRIMARY KEY (game_id, day)
    );

    -- Кто уже играл сегодня: для уникальных игроков и защиты от накрутки. Старше 2 дней удаляется.
    CREATE TABLE IF NOT EXISTS play_visitors (
      game_id   TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      day       TEXT NOT NULL,
      visitor   TEXT NOT NULL,              -- sha256 анонимного cookie посетителя
      last_at   INTEGER NOT NULL,           -- время последнего открытия
      open      INTEGER NOT NULL DEFAULT 1, -- 1, пока не пришло время сессии
      PRIMARY KEY (game_id, day, visitor)
    );
    CREATE INDEX IF NOT EXISTS play_visitors_by_day ON play_visitors(day);
  `);

  db.exec(`
    -- Оценки игроков: одна на игру от анонимного посетителя (хэш cookie vid).
    CREATE TABLE IF NOT EXISTS game_votes (
      game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      visitor    TEXT NOT NULL,
      value      INTEGER NOT NULL CHECK (value IN (-1, 1)),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, visitor)
    );
  `);

  db.exec(`
    -- Сохранения игр через SDK: одно на игру у каждого игрока (анонимный cookie vid, в базе — хэш).
    CREATE TABLE IF NOT EXISTS game_saves (
      game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      visitor    TEXT NOT NULL,
      data       TEXT NOT NULL,   -- JSON от игры
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, visitor)
    );
  `);

  db.exec(`
    -- Заявки на аккаунт разработчика. Публиковать игры можно только с одобренной заявкой.
    CREATE TABLE IF NOT EXISTS developer_applications (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      studio     TEXT NOT NULL,              -- имя или студия, как увидят игроки
      about      TEXT NOT NULL,              -- чем занимается, какие игры делает
      links      TEXT NOT NULL DEFAULT '',   -- портфолио, страницы игр
      contact    TEXT NOT NULL DEFAULT '',   -- Telegram, сайт — как связаться
      status     TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
      reason     TEXT,                       -- причина отказа
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS developer_applications_by_status ON developer_applications(status, updated_at);

    -- Журнал решений модераторов и изменений команды: кто, что, когда и почему.
    CREATE TABLE IF NOT EXISTS moderation_log (
      id           INTEGER PRIMARY KEY,
      actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name   TEXT NOT NULL,         -- имя на момент решения: журнал не меняется задним числом
      action       TEXT NOT NULL,         -- game.approve | game.reject | game.delete | developer.approve | developer.reject | team.add | team.remove
      target_id    TEXT NOT NULL,
      target_title TEXT NOT NULL,
      reason       TEXT,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS moderation_log_by_time ON moderation_log(created_at);

    -- Показы рекламы по играм и дням: для кабинета разработчика и будущих выплат авторам.
    CREATE TABLE IF NOT EXISTS ad_daily (
      game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      day        TEXT NOT NULL,
      fullscreen INTEGER NOT NULL DEFAULT 0, -- показанные полноэкранные
      rewarded   INTEGER NOT NULL DEFAULT 0, -- досмотренные за награду
      banner     INTEGER NOT NULL DEFAULT 0, -- загруженные баннеры
      PRIMARY KEY (game_id, day)
    );
  `);

  db.exec(`
    -- Одноразовые ссылки из писем: подтверждение почты и сброс пароля. В базе — только хэш токена.
    CREATE TABLE IF NOT EXISTS email_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,              -- verify | reset
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS email_tokens_by_user ON email_tokens(user_id, kind);

    -- Таблицы рекордов игр (SDK). Лучший результат игрока в каждой таблице игры.
    CREATE TABLE IF NOT EXISTS leaderboard_scores (
      game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      board      TEXT NOT NULL,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score      INTEGER NOT NULL,
      extra      TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, board, user_id)
    );
    CREATE INDEX IF NOT EXISTS leaderboard_rank ON leaderboard_scores(game_id, board, score DESC, updated_at);

    -- Монетки: начисляются за время в играх (не больше дневного лимита), тратятся в играх через SDK.
    CREATE TABLE IF NOT EXISTS coin_daily (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day     TEXT NOT NULL,
      earned  INTEGER NOT NULL DEFAULT 0,
      last_at INTEGER NOT NULL DEFAULT 0,  -- последнее начисление: не чаще раза в минуту на все вкладки
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS coin_spends (
      id         INTEGER PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id    TEXT REFERENCES games(id) ON DELETE SET NULL,
      game_title TEXT NOT NULL,
      amount     INTEGER NOT NULL,
      title      TEXT NOT NULL,                -- что купил игрок, как назвала игра
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS coin_spends_by_user ON coin_spends(user_id, created_at);

    -- Отзывы игроков: один на игру от аккаунта, можно изменить или удалить.
    CREATE TABLE IF NOT EXISTS game_reviews (
      game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS game_reviews_by_game ON game_reviews(game_id, updated_at);
  `);

  // Колонки, добавленные после первых версий: старые базы дополняются при запуске.
  const addColumnTo = (table) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    return (name, ddl) => { if (!columns.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`); };
  };
  const addUserColumn = addColumnTo('users');
  addUserColumn('role', "TEXT NOT NULL DEFAULT 'player'"); // player | moderator; владельцы — из ADMIN_EMAILS
  addUserColumn('role_since', 'INTEGER');
  addUserColumn('email_verified_at', 'INTEGER'); // NULL — почта не подтверждена
  addUserColumn('coins', 'INTEGER NOT NULL DEFAULT 0');
  const addColumn = addColumnTo('games');
  addColumn('file_count', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('description', "TEXT NOT NULL DEFAULT ''");
  addColumn('how_to_play', "TEXT NOT NULL DEFAULT ''");
  addColumn('age', "TEXT NOT NULL DEFAULT '0+'");
  addColumn('cover', 'TEXT'); // имя файла обложки внутри папки игры (16:9)
  addColumn('icon', 'TEXT');  // квадратная иконка (1:1) — для маленьких размеров
  addColumn('featured', 'INTEGER NOT NULL DEFAULT 0'); // в подборке на главной: больше — раньше
  return db;
}
