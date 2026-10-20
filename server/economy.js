// Монетки — валюта сайта. Откуда берутся: покупка через ЮKassa, подарок при регистрации,
// бонус за вход раз в день, выдача владельцем. Куда уходят: покупки в играх через SDK.
// Каждое движение пишется в журнал coin_ledger, баланс — в users.coins.
import { randomBytes, randomUUID } from 'node:crypto';

export const DAILY_COINS = 5;
export const WELCOME_COINS = 50;
const MAX_GRANT = 100000;
const ORDER_TTL_MS = 2 * 3600 * 1000;  // неоплаченный заказ живёт 2 часа
const YOOKASSA_API = 'https://api.yookassa.ru/v3';

// Пакеты: «монетки:рубли» через запятую (COIN_PACKS). Цена — целые рубли.
const DEFAULT_PACKS = '100:99,300:249,700:499,1500:990';
export function packsFromEnv(env = {}) {
  const packs = String(env.COIN_PACKS || DEFAULT_PACKS).split(',').map((s, i) => {
    const [coins, rub] = s.split(':').map((x) => Number(x.trim()));
    return { id: `p${i + 1}`, coins, price: rub };
  }).filter((p) => Number.isInteger(p.coins) && p.coins > 0 && Number.isInteger(p.price) && p.price > 0);
  // Выгода пакета — сколько монеток сверх цены первого (самого маленького) пакета.
  const base = packs.length ? packs[0].price / packs[0].coins : 0;
  return packs.map((p) => ({ ...p, bonus: base ? Math.max(0, Math.round((1 - p.price / (p.coins * base)) * 100)) : 0 }));
}

export function yookassaFromEnv(env = {}) {
  const shopId = String(env.YOOKASSA_SHOP_ID || '').trim();
  const secretKey = String(env.YOOKASSA_SECRET_KEY || '').trim();
  return {
    shopId, secretKey,
    enabled: !!(shopId && secretKey),
    test: secretKey.startsWith('test_'),
    apiUrl: String(env.YOOKASSA_API_URL || YOOKASSA_API).replace(/\/+$/, ''),
    // Чек от ЮKassa (54-ФЗ) для ИП и ООО. Самозанятым не нужен: ЮKassa сама передаёт продажу в «Мой налог».
    receipt: env.YOOKASSA_RECEIPT === '1',
    vatCode: Number(env.YOOKASSA_VAT_CODE) || 1, // 1 — без НДС
  };
}

export function migrateLedger(db) {
  db.exec(`
    -- Все движения монеток: + покупка, подарок, бонус, выдача; − трата в игре, списание владельцем.
    CREATE TABLE IF NOT EXISTS coin_ledger (
      id         INTEGER PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta      INTEGER NOT NULL,
      kind       TEXT NOT NULL,      -- purchase | welcome | daily | grant | spend | play (старое начисление за время)
      title      TEXT NOT NULL,      -- что увидит игрок в истории
      game_id    TEXT REFERENCES games(id) ON DELETE SET NULL,
      ref        TEXT,               -- id заказа или платежа
      actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL, -- кто выдал вручную
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS coin_ledger_by_user ON coin_ledger(user_id, created_at);
    CREATE INDEX IF NOT EXISTS coin_ledger_by_kind ON coin_ledger(kind, created_at);

    -- Заказы монеток через ЮKassa.
    CREATE TABLE IF NOT EXISTS coin_orders (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      coins      INTEGER NOT NULL,
      amount     INTEGER NOT NULL,   -- рубли
      status     TEXT NOT NULL DEFAULT 'new', -- new | pending | paid | canceled
      payment_id TEXT UNIQUE,
      confirmation_url TEXT,
      created_at INTEGER NOT NULL,
      paid_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS coin_orders_by_user ON coin_orders(user_id, created_at);
    CREATE INDEX IF NOT EXISTS coin_orders_by_status ON coin_orders(status, created_at);
  `);
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('daily_bonus_day')) db.exec('ALTER TABLE users ADD COLUMN daily_bonus_day TEXT');
  // Старые записи (до журнала): начисления за время в играх и траты переносим один раз.
  const empty = !db.prepare('SELECT 1 FROM coin_ledger LIMIT 1').get();
  if (empty) {
    db.exec(`
      INSERT INTO coin_ledger (user_id, delta, kind, title, created_at)
        SELECT user_id, earned, 'play', 'За время в играх', last_at FROM coin_daily WHERE earned > 0;
      INSERT INTO coin_ledger (user_id, delta, kind, title, game_id, created_at)
        SELECT user_id, -amount, 'spend', title || ' — ' || game_title, game_id, created_at FROM coin_spends;
    `);
  }
}

export function createEconomy({
  db, now, dayOf, send, readJson, HttpError, requireUser, requireOwner, logAction, createLimiter,
  siteUrl, packs, yookassa, fetchImpl = fetch,
}) {
  const orderLimiter = createLimiter({ max: 10, windowMs: 3600 * 1000 });
  const q = {
    coinsOf: db.prepare('SELECT coins FROM users WHERE id = ?'),
    add: db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?'),
    take: db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?'),
    ledger: db.prepare(`INSERT INTO coin_ledger (user_id, delta, kind, title, game_id, ref, actor_id, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    history: db.prepare(`SELECT delta, kind, title, game_id, created_at FROM coin_ledger WHERE user_id = ?
                         ORDER BY created_at DESC, id DESC LIMIT ?`),
    claimDaily: db.prepare('UPDATE users SET daily_bonus_day = ? WHERE id = ? AND (daily_bonus_day IS NULL OR daily_bonus_day <> ?)'),
    dailyDay: db.prepare('SELECT daily_bonus_day FROM users WHERE id = ?'),
    insertOrder: db.prepare('INSERT INTO coin_orders (id, user_id, coins, amount, status, created_at) VALUES (?, ?, ?, ?, \'new\', ?)'),
    setPayment: db.prepare('UPDATE coin_orders SET status = \'pending\', payment_id = ?, confirmation_url = ? WHERE id = ?'),
    order: db.prepare('SELECT * FROM coin_orders WHERE id = ?'),
    orderByPayment: db.prepare('SELECT * FROM coin_orders WHERE payment_id = ?'),
    markPaid: db.prepare('UPDATE coin_orders SET status = \'paid\', paid_at = ? WHERE id = ? AND status IN (\'new\', \'pending\')'),
    markCanceled: db.prepare('UPDATE coin_orders SET status = \'canceled\' WHERE id = ? AND status IN (\'new\', \'pending\')'),
  };

  // Движение монеток одной транзакцией: баланс и журнал всегда сходятся.
  function move(userId, delta, kind, title, { gameId = null, ref = null, actorId = null } = {}) {
    db.exec('BEGIN');
    try {
      if (delta < 0) {
        const { changes } = q.take.run(-delta, userId, -delta);
        if (!changes) throw new HttpError(409, 'Не хватает монет');
      } else q.add.run(delta, userId);
      q.ledger.run(userId, delta, kind, title, gameId, ref, actorId, now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return q.coinsOf.get(userId).coins;
  }

  const balance = (userId) => q.coinsOf.get(userId).coins;
  const dailyAvailable = (userId) => q.dailyDay.get(userId)?.daily_bonus_day !== dayOf(now());

  function welcome(userId) {
    if (WELCOME_COINS > 0) move(userId, WELCOME_COINS, 'welcome', 'Подарок за регистрацию');
  }

  // Бонус за вход: раз в календарный день (по Москве). Повторный запрос в тот же день ничего не даёт.
  function claimDaily(req, res) {
    const user = requireUser(req);
    const day = dayOf(now());
    let claimed = 0;
    db.exec('BEGIN');
    try {
      if (q.claimDaily.run(day, user.id, day).changes) {
        q.add.run(DAILY_COINS, user.id);
        q.ledger.run(user.id, DAILY_COINS, 'daily', 'Бонус за вход', null, null, null, now());
        claimed = DAILY_COINS;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    send(res, 200, { claimed, coins: balance(user.id) });
  }

  function myCoins(req, res) {
    const user = requireUser(req);
    send(res, 200, {
      coins: balance(user.id),
      daily: { available: dailyAvailable(user.id), amount: DAILY_COINS },
      history: q.history.all(user.id, 50),
      shop: { enabled: yookassa.enabled, test: yookassa.test, packs },
    });
  }

  // Трата из игры. Игра в песочнице и сама сюда не ходит: запрос шлёт страница игры после того,
  // как игрок подтвердил покупку в окне площадки.
  function spend(userId, game, amount, title) {
    return move(userId, -amount, 'spend', `${title} — ${game.title}`, { gameId: game.id });
  }

  // ---------- покупка через ЮKassa ----------
  const auth = () => `Basic ${Buffer.from(`${yookassa.shopId}:${yookassa.secretKey}`).toString('base64')}`;
  async function kassa(method, pathname, body) {
    const res = await fetchImpl(`${yookassa.apiUrl}${pathname}`, {
      method,
      headers: {
        Authorization: auth(), 'Content-Type': 'application/json',
        ...(method === 'POST' && { 'Idempotence-Key': randomUUID() }),
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('ЮKassa:', res.status, data.description || data.code || '');
      throw new HttpError(502, 'Платёжный сервис не ответил. Попробуйте через минуту');
    }
    return data;
  }

  async function createOrder(req, res) {
    const user = requireUser(req);
    if (!yookassa.enabled) throw new HttpError(503, 'Покупка монеток скоро появится');
    const { pack: packId } = await readJson(req);
    const pack = packs.find((p) => p.id === packId);
    if (!pack) throw new HttpError(400, 'Нет такого набора');
    if (orderLimiter.blocked(String(user.id))) throw new HttpError(429, 'Слишком много заказов, попробуйте через час');
    orderLimiter.fail(String(user.id));

    const id = randomBytes(8).toString('hex');
    q.insertOrder.run(id, user.id, pack.coins, pack.price, now());
    const value = `${pack.price}.00`;
    const description = `${pack.coins} монеток Gamely`;
    const payment = await kassa('POST', '/payments', {
      amount: { value, currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: `${siteUrl}/account.html?order=${id}#coins` },
      description,
      metadata: { order_id: id, user_id: String(user.id) },
      ...(yookassa.receipt && {
        receipt: {
          customer: { email: user.email },
          items: [{
            description, quantity: '1.00', amount: { value, currency: 'RUB' },
            vat_code: yookassa.vatCode, payment_mode: 'full_payment', payment_subject: 'service',
          }],
        },
      }),
    });
    const url = payment.confirmation?.confirmation_url;
    if (!payment.id || !url) throw new HttpError(502, 'Платёжный сервис не вернул ссылку на оплату');
    q.setPayment.run(payment.id, url, id);
    send(res, 201, { order: { id, coins: pack.coins, amount: pack.price, status: 'pending' }, confirmation_url: url });
  }

  // Платёж проверяем запросом к ЮKassa, а не по тому, что прислали: уведомления не подписаны.
  function applyPayment(order, payment) {
    if (!payment || payment.id !== order.payment_id) return order.status;
    if (payment.status === 'canceled') {
      q.markCanceled.run(order.id);
      return 'canceled';
    }
    const amountOk = payment.amount?.currency === 'RUB' && Number(payment.amount?.value) === order.amount;
    if (payment.status !== 'succeeded' || !payment.paid || !amountOk || payment.metadata?.order_id !== order.id) {
      return order.status;
    }
    db.exec('BEGIN');
    try {
      // Зачисляем один раз: повторное уведомление и опрос со страницы не удваивают монетки.
      if (q.markPaid.run(now(), order.id).changes) {
        q.add.run(order.coins, order.user_id);
        q.ledger.run(order.user_id, order.coins, 'purchase', `Покупка: ${order.coins} монеток`, null, order.id, null, now());
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return 'paid';
  }

  async function refresh(order) {
    if (!['new', 'pending'].includes(order.status) || !order.payment_id || !yookassa.enabled) return order.status;
    if (now() - order.created_at > ORDER_TTL_MS * 12) return order.status; // старые не опрашиваем
    return applyPayment(order, await kassa('GET', `/payments/${encodeURIComponent(order.payment_id)}`));
  }

  // Страница профиля после возврата с оплаты спрашивает статус заказа.
  async function orderStatus(req, res, id) {
    const user = requireUser(req);
    const order = q.order.get(id);
    if (!order || order.user_id !== user.id) throw new HttpError(404, 'Заказ не найден');
    const status = await refresh(order).catch(() => order.status);
    send(res, 200, { order: { id, coins: order.coins, amount: order.amount, status }, coins: balance(user.id) });
  }

  // Уведомление ЮKassa (HTTP-уведомления в личном кабинете: https://<сайт>/api/payments/yookassa).
  async function webhook(req, res) {
    const body = await readJson(req);
    const paymentId = body?.object?.id;
    const order = typeof paymentId === 'string' ? q.orderByPayment.get(paymentId) : null;
    if (order && yookassa.enabled) {
      await refresh(order);
    }
    send(res, 200, { ok: true });
  }

  // ---------- выдача и списание владельцем ----------
  async function grant(req, res, userId) {
    const owner = requireOwner(req);
    const target = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId);
    if (!target) throw new HttpError(404, 'Пользователь не найден');
    const { amount, reason } = await readJson(req);
    const why = String(reason ?? '').trim();
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > MAX_GRANT) {
      throw new HttpError(400, `Сумма: целое число от −${MAX_GRANT} до ${MAX_GRANT}, не ноль`);
    }
    if (why.length < 3 || why.length > 200) throw new HttpError(400, 'Напишите причину — её увидит игрок в истории');
    const coins = move(target.id, amount, 'grant', why, { actorId: owner.id });
    logAction(owner, amount > 0 ? 'coins.grant' : 'coins.take', target.id, `${target.name} (${target.email})`, `${amount > 0 ? '+' : ''}${amount}: ${why}`);
    send(res, 200, { coins });
  }

  // Обработчик для пути и метода или null, если путь не наш.
  function route(p, m) {
    let mm;
    if (p === '/api/me/coins' && m === 'GET') return myCoins;
    if (p === '/api/me/coins/daily' && m === 'POST') return claimDaily;
    if (p === '/api/coins/orders' && m === 'POST') return createOrder;
    if ((mm = p.match(/^\/api\/coins\/orders\/([0-9a-f]{16})$/)) && m === 'GET') return (req, res) => orderStatus(req, res, mm[1]);
    if (p === '/api/payments/yookassa' && m === 'POST') return webhook;
    if ((mm = p.match(/^\/api\/admin\/users\/(\d+)\/coins$/)) && m === 'POST') return (req, res) => grant(req, res, Number(mm[1]));
    return null;
  }

  return { route, welcome, spend, balance, dailyAvailable, history: (userId, n = 50) => q.history.all(userId, n) };
}
