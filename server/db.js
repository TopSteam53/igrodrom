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

  // Колонки, добавленные после первых версий: старые базы дополняются при запуске.
  const columns = db.prepare('PRAGMA table_info(games)').all().map((c) => c.name);
  const addColumn = (name, ddl) => { if (!columns.includes(name)) db.exec(`ALTER TABLE games ADD COLUMN ${name} ${ddl}`); };
  addColumn('file_count', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('description', "TEXT NOT NULL DEFAULT ''");
  addColumn('how_to_play', "TEXT NOT NULL DEFAULT ''");
  addColumn('age', "TEXT NOT NULL DEFAULT '0+'");
  addColumn('cover', 'TEXT'); // имя файла обложки внутри папки игры
  return db;
}
