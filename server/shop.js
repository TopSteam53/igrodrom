// Витрина: игрок тратит монетки на то, как он выглядит на сайте. Рамка вокруг аватарки, цвет имени,
// зверь из платного набора (public/avatars/17–24.svg). Ещё можно показать рядом с именем одно своё достижение —
// это бесплатно. Всё только для вида: в играх ничего не даёт, на деньги не меняется, другим не передаётся.
//
// Купленное — в user_items, надетое — в users.frame, users.name_color, users.badge; платный зверь надевается
// как обычная аватарка (users.avatar = 'p:<n>'). Списание пишется в coin_ledger с kind = 'shop'.
import { ACHIEVEMENTS } from './rewards.js';

// Рамки рисует public/app.js (avatarHTML), цвета имени — public/style.css (.nc-*).
export const FRAMES = [
  { id: 'dashed', title: 'Пунктир', price: 40 },
  { id: 'double', title: 'Двойное кольцо', price: 60 },
  { id: 'buttons', title: 'Кнопки геймпада', price: 90 },
  { id: 'pixel', title: 'Пиксели', price: 120 },
  { id: 'stars', title: 'Звёзды', price: 150 },
  { id: 'laurel', title: 'Лавры', price: 200 },
  { id: 'gold', title: 'Золото', price: 300 },
];
export const NAME_COLORS = [
  { id: 'blue', title: 'Синий', price: 50 },
  { id: 'green', title: 'Зелёный', price: 50 },
  { id: 'red', title: 'Красный', price: 50 },
  { id: 'purple', title: 'Фиолетовый', price: 70 },
  { id: 'pink', title: 'Малиновый', price: 70 },
  { id: 'gold', title: 'Золотой', price: 100 },
];
export const PREMIUM_AVATARS = [
  { n: 17, title: 'Дракон' }, { n: 18, title: 'Ёжик' }, { n: 19, title: 'Кит' }, { n: 20, title: 'Осьминог' },
  { n: 21, title: 'Хомяк' }, { n: 22, title: 'Попугай' }, { n: 23, title: 'Олень' }, { n: 24, title: 'Акула' },
].map((a) => ({ ...a, price: 80 }));

// Каталог: id вида «слот:что». Цена — в монетках.
export const ITEMS = [
  ...FRAMES.map((f) => ({ id: `frame:${f.id}`, slot: 'frame', key: f.id, title: f.title, price: f.price })),
  ...NAME_COLORS.map((c) => ({ id: `color:${c.id}`, slot: 'color', key: c.id, title: c.title, price: c.price })),
  ...PREMIUM_AVATARS.map((a) => ({ id: `avatar:${a.n}`, slot: 'avatar', key: String(a.n), title: a.title, price: a.price,
    image: `/avatars/${a.n}.svg` })),
];
const ITEM = new Map(ITEMS.map((i) => [i.id, i]));
const SLOT_NOUN = { frame: 'рамка', color: 'цвет имени', avatar: 'аватарка' };
const FRAME_IDS = new Set(FRAMES.map((f) => f.id));
const COLOR_IDS = new Set(NAME_COLORS.map((c) => c.id));
const SLOTS = ['frame', 'color', 'avatar', 'badge'];

// Колонки users, которые нужны для внешнего вида игрока, — для запросов с JOIN users u.
export const LOOK_COLS = 'u.frame, u.name_color, u.badge';

// Внешний вид для чужих глаз: только то, что есть в каталоге (снятый с витрины предмет просто не показывается).
let achTitle;
export function lookOf(row) {
  achTitle ??= new Map(ACHIEVEMENTS.map((a) => [a.key, a.title]));
  return {
    frame: FRAME_IDS.has(row?.frame) ? row.frame : null,
    nameColor: COLOR_IDS.has(row?.name_color) ? row.name_color : null,
    badge: achTitle.get(row?.badge) || null,
  };
}

export function migrateShop(db) {
  db.exec(`
    -- Купленное в витрине: один предмет — один раз.
    CREATE TABLE IF NOT EXISTS user_items (
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item      TEXT NOT NULL,
      bought_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, item)
    );
  `);
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`); };
  add('frame', 'TEXT');      // надетая рамка (id из FRAMES)
  add('name_color', 'TEXT'); // цвет имени (id из NAME_COLORS)
  add('badge', 'TEXT');      // достижение рядом с именем (key из ACHIEVEMENTS)
}

export function createShop({ db, now, send, readJson, HttpError, requireUser, economy, avatars }) {
  const q = {
    user: db.prepare('SELECT id, coins, avatar, frame, name_color, badge FROM users WHERE id = ?'),
    owned: db.prepare('SELECT item, bought_at FROM user_items WHERE user_id = ?'),
    has: db.prepare('SELECT 1 FROM user_items WHERE user_id = ? AND item = ?'),
    insert: db.prepare('INSERT OR IGNORE INTO user_items (user_id, item, bought_at) VALUES (?, ?, ?)'),
    earned: db.prepare('SELECT key FROM player_achievements WHERE user_id = ? ORDER BY at'),
    setFrame: db.prepare('UPDATE users SET frame = ? WHERE id = ?'),
    setColor: db.prepare('UPDATE users SET name_color = ? WHERE id = ?'),
    setBadge: db.prepare('UPDATE users SET badge = ? WHERE id = ?'),
  };

  function equippedOf(u) {
    const ava = /^p:(\d{1,2})$/.exec(u.avatar || '');
    return {
      frame: FRAME_IDS.has(u.frame) ? `frame:${u.frame}` : null,
      color: COLOR_IDS.has(u.name_color) ? `color:${u.name_color}` : null,
      avatar: ava && ITEM.has(`avatar:${ava[1]}`) ? `avatar:${ava[1]}` : null,
      badge: u.badge || null,
    };
  }

  function view(userId) {
    const u = q.user.get(userId);
    const owned = new Set(q.owned.all(userId).map((r) => r.item));
    const equipped = equippedOf(u);
    const earned = new Set(q.earned.all(userId).map((r) => r.key));
    return {
      coins: u.coins,
      items: ITEMS.map((i) => ({ ...i, owned: owned.has(i.id), equipped: equipped[i.slot] === i.id })),
      equipped,
      // Достижения, которые можно показать рядом с именем: только полученные.
      badges: ACHIEVEMENTS.filter((a) => earned.has(a.key)).map((a) => ({ key: a.key, title: a.title })),
      look: lookOf(u),
    };
  }

  function catalogue(req, res) {
    send(res, 200, view(requireUser(req).id));
  }

  // Покупка: проверка, списание, запись в журнал и в user_items — одной транзакцией (economy.move).
  // Повтор того же запроса не спишет второй раз: предмет уже куплен — 409.
  async function buy(req, res) {
    const user = requireUser(req);
    const { item: id } = await readJson(req);
    const item = typeof id === 'string' ? ITEM.get(id) : null;
    if (!item) throw new HttpError(400, 'Нет такого предмета');
    if (q.has.get(user.id, item.id)) throw new HttpError(409, 'Уже куплено');
    if (economy.balance(user.id) < item.price) throw new HttpError(402, 'Не хватает монеток');
    economy.move(user.id, -item.price, 'shop', `Витрина: ${SLOT_NOUN[item.slot]} «${item.title}»`, {
      ref: item.id,
      during: () => {
        if (!q.insert.run(user.id, item.id, now()).changes) throw new HttpError(409, 'Уже куплено');
      },
    });
    send(res, 200, view(user.id));
  }

  // Надеть или снять. item: id из каталога (для badge — key полученного достижения) или null.
  async function equip(req, res) {
    const user = requireUser(req);
    const { slot, item = null } = await readJson(req);
    if (!SLOTS.includes(slot)) throw new HttpError(400, `slot: ${SLOTS.join(', ')}`);
    if (slot === 'badge') {
      if (item !== null && !(typeof item === 'string' && ACHIEVEMENTS.some((a) => a.key === item))) {
        throw new HttpError(400, 'Нет такого достижения');
      }
      if (item !== null && !q.earned.all(user.id).some((r) => r.key === item)) {
        throw new HttpError(403, 'Это достижение ещё не получено');
      }
      q.setBadge.run(item, user.id);
      return send(res, 200, view(user.id));
    }
    if (item === null) {
      if (slot === 'avatar') throw new HttpError(400, 'Аватарку меняют в профиле: нажмите на неё');
      (slot === 'frame' ? q.setFrame : q.setColor).run(null, user.id);
      return send(res, 200, view(user.id));
    }
    const it = typeof item === 'string' ? ITEM.get(item) : null;
    if (!it || it.slot !== slot) throw new HttpError(400, 'Нет такого предмета для этого места');
    if (!q.has.get(user.id, it.id)) throw new HttpError(403, 'Сначала купите это в витрине');
    if (slot === 'frame') q.setFrame.run(it.key, user.id);
    else if (slot === 'color') q.setColor.run(it.key, user.id);
    else avatars.setPreset(user.id, Number(it.key));
    send(res, 200, view(user.id));
  }

  function route(p, m) {
    if (p === '/api/shop' && m === 'GET') return catalogue;
    if (p === '/api/shop/buy' && m === 'POST') return buy;
    if (p === '/api/shop/equip' && m === 'POST') return equip;
    return null;
  }

  return { route, look: lookOf };
}
