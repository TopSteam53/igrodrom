// Экономика «Перекупа»: кейсы, состояние вещей, покупатели, работа. Файл читают игра (game.js)
// и проверка баланса (test/perekup.test.js), поэтому здесь только данные и чистые функции.
'use strict';
(function (root) {
  const ITEMS = root.ITEMS;
  const TIER_NAMES = { 1: 'обычная', 2: 'нужная', 3: 'редкая', 4: 'ценная', 5: 'роскошь', 6: 'клад' };
  // «Сломано» из кейса не выпадает (w: 0): таким становится вещь, если ремонт не удался.
  const CONDITIONS = [
    { id: 'broken', label: 'сломано', k: 0.3, w: 0 },
    { id: 'worn', label: 'потёртое', k: 0.75, w: 40 },
    { id: 'good', label: 'хорошее', k: 1, w: 45 },
    { id: 'mint', label: 'как новое', k: 1.3, w: 15 },
  ];
  // Внутри уровня дешёвые вещи выпадают чаще: вес 1/√цены.
  const weightOf = (item) => 1 / Math.sqrt(item.price);
  // Шансы уровней вещей в кейсе, %. Цену кейса не задаём руками: это EDGE от средней цены выпавшего. По цене
  // рынка открытие в среднем даёт +18 %, торг добавляет ещё; «продать сразу» (60 %) — в минус. Новые вещи баланс не ломают.
  const EDGE = 0.85;
  // Основной кейс уровня (4-е поле — уровень вещей) почти целиком из своего уровня: так средняя находка — обычная
  // находка, а не джекпот, и открытие в среднем в плюс. Уровень выше — 0,5 %, через уровень — 0,1 %: редкая удача.
  // Между основными (решение пользователя 30.10.2026: «33 тысячи до следующего кейса не накопить») — кейсы из
  // ценовой полосы: верх одного уровня и низ следующего. Разброс у них как у обычного кейса (не «почти всегда
  // дешёвка, изредка джекпот» — с таким кейсом игрок чаще разоряется), а каждый следующий кейс дороже в 2–4 раза.
  const ODDS = [
    ['junk', 'Барахло', { 1: 99.4, 2: 0.5, 3: 0.1 }, 1],
    ['attic', 'Чердак', [250, 2400]],
    ['home', 'Быт', { 2: 99.4, 3: 0.5, 4: 0.1 }, 2],
    ['garage', 'Гараж', [3400, 27000]],
    ['tech', 'Техника', { 3: 99.4, 4: 0.5, 5: 0.1 }, 3],
    ['consign', 'Комиссионка', [38000, 260000]],
    ['antique', 'Антиквариат', { 4: 99.5, 5: 0.5 }, 4],
    ['mansion', 'Особняк', [520000, 3.9e6]],
    ['lux', 'Роскошь', { 5: 99.85, 6: 0.15 }, 5],
    ['safe', 'Сейф', [9.5e6, 28e6]],
    ['vault', 'Хранилище', [11e6, 260e6]],
    ['legend', 'Клад', { 5: 50, 6: 50 }, 6],
  ];
  const condK = CONDITIONS.reduce((n, c) => n + c.k * c.w, 0) / CONDITIONS.reduce((n, c) => n + c.w, 0);
  // Что лежит в кейсе: пары [вещь, вероятность]. Кейс уровня — шансы уровней, внутри уровня вес 1/√цены;
  // кейс-полоса — все вещи в полосе цен с тем же весом.
  function poolOf(spec) {
    const norm = (list) => { const w = list.reduce((n, i) => n + weightOf(i), 0); return list.map((i) => [i, weightOf(i) / w]); };
    if (Array.isArray(spec)) return norm(ITEMS.filter((i) => i.price >= spec[0] && i.price <= spec[1]));
    const total = Object.values(spec).reduce((a, b) => a + b, 0);
    return Object.entries(spec).flatMap(([tier, p]) => norm(ITEMS.filter((i) => i.tier === Number(tier))).map(([i, q]) => [i, (q * p) / total]));
  }
  const expected = (pool) => pool.reduce((n, [i, p]) => n + i.price * p, 0) * condK;
  // Чем дороже кейс, тем меньше он даёт сверху: начало быстрое (до «Техники» — минуты), а к «Кладу» путь
  // длиннее, чтобы было куда расти (тест темпа в test/perekup.test.js).
  const edgeOf = (k) => Math.min(0.93, EDGE + Math.max(0, k - 4) * 0.012);
  const CASES = ODDS.map(([id, title, spec, tier], k) => {
    const pool = poolOf(spec), ev = expected(pool);
    // odds — доля уровней вещей в кейсе, %, для подписи под кейсом и для рынка.
    const odds = {};
    for (const [i, p] of pool) odds[i.tier] = (odds[i.tier] || 0) + p * 100;
    for (const t of Object.keys(odds)) odds[t] = Math.round(odds[t] * 100) / 100;
    return { id, title, tier: tier || 0, pool, odds, ev, price: nice(ev * edgeOf(k)) };
  });
  // Основной кейс уровня вещей: по нему называются полки коллекции и считаются их награды.
  const caseOfTier = (tier) => CASES.find((c) => c.tier === tier);
  // Покупатели: сколько готовы заплатить (доля от цены рынка), с чего начинают торг, сколько раз уступают.
  // mood — настроение в начале разговора (0–100): от него зависят потолок цены и уступчивость (moodK, game.js).
  // Перекупщик торгуется долго и платит мало, коллекционер переплачивает, мошенник «берёт без торга», но денег
  // не будет, постоянный клиент — тот, с кем раньше хорошо договорились (state.regulars).
  const BUYERS = {
    chatty: { w: 24, max: [0.95, 1.22], first: [0.84, 0.94], patience: 3, accept: 0.92, mood: 62 },
    hurry: { w: 18, max: [0.9, 1.12], first: [0.93, 1.0], patience: 1, accept: 0.85, bolt: 0.4, mood: 50 },
    thrifty: { w: 26, max: [0.8, 1.03], first: [0.62, 0.78], patience: 2, accept: 0.75, mood: 45 },
    reseller: { w: 12, max: [0.72, 0.9], first: [0.45, 0.6], patience: 4, accept: 0.9, mood: 38 },
    collector: { w: 6, max: [1.15, 1.5], first: [0.95, 1.1], patience: 3, accept: 0.85, mood: 55, minTier: 2 },
    regular: { w: 0, max: [1.0, 1.25], first: [0.9, 1.0], patience: 3, accept: 0.95, mood: 75 },
    scammer: { w: 7, mood: 70 },
    troll: { w: 7 },
  };
  const REGULAR_W = 12;       // вес постоянного клиента, когда такие есть
  // Потолок цены от настроения: при 50 — как задумано, при 100 — на 10 % выше, при 0 — на 10 % ниже.
  const moodK = (mood) => 0.9 + 0.2 * Math.max(0, Math.min(100, mood)) / 100;
  const QUICK = 0.6;          // «продать сразу» — 60 % цены рынка
  const MAX_LISTINGS = 4;
  const START_MONEY = 1000;
  const AVA = ['#4F6BD8', '#D8564F', '#3E9E6A', '#8D5BD3', '#C9852C', '#2E9C9A', '#BE4C86', '#5B6479'];
  // Работа — подстраховка, когда сидишь без денег, а не способ разбогатеть (решение 29.10.2026: «имба»).
  // Доход растёт ровно (+5 ₽ за уровень, до 15-го), прокачка дорожает быстро, а клики тратят силы: чем выше
  // уровень, тем больше сил уходит на клик (1, 2, 3… до 8), запас растёт на 10 за уровень, восстанавливается одна
  // сила за 1,5 с. Поэтому прокачка даёт больше денег за клик, но почти не ускоряет заработок в час:
  // 5 ₽ за силу на 1-м уровне и около 9 ₽ на 15-м — примерно 22 тыс. ₽ в час (решение 29.10.2026).
  const WORK = { maxLevel: 15, regenMs: 1500 };
  const workEnergyMax = (l) => 100 + 10 * (l - 1);
  const workClickCost = (l) => 1 + Math.floor((l - 1) / 2);
  const workIncome = (l) => 5 * l;
  const workCost = (l) => nice(150 * Math.pow(1.8, l - 1));
  // Покупатель приходит тем позже, чем жаднее цена: на рынке — секунд через 8, вдвое дороже — минуты через три.
  const waitFor = (ratio) => Math.min(600, Math.max(4, 8 * Math.exp(3 * (ratio - 1)))) * 1000;

  // ---------- продавец (решение пользователя 30.10.2026: прокачка и ремонт сверх механик оригинала) ----------
  // Рейтинг растёт от сделок и открывает следующий уровень улучшений; улучшения покупаются за деньги.
  // Цены идут за кейсами (сотни рублей, потом тысячи, миллионы), поэтому каждое улучшение — заметная трата,
  // а не «купил всё на старте». Предложения покупателей: +1,5 % за уровень, не больше +7,5 %: темп до «Клада»
  // держит test/perekup.test.js.
  const RANKS = [0, 5, 15, 40, 100, 250];          // сделок до уровня продавца 1…6
  const rankOf = (deals) => RANKS.filter((n) => deals >= n).length;
  const UPGRADES = {
    slots: { title: 'Больше объявлений', text: 'ещё одно место для объявления', cost: [4000, 60000, 900000, 15000000] },
    speed: { title: 'Быстрые покупатели', text: 'покупатели приходят на 12 % быстрее', cost: [2500, 35000, 500000, 8000000, 120000000] },
    offer: { title: 'Щедрые покупатели', text: 'предложения на 1,5 % выше', cost: [8000, 120000, 1800000, 30000000, 400000000] },
  };
  const slotsOf = (up) => MAX_LISTINGS + (up.slots || 0);
  const speedOf = (up) => Math.pow(0.88, up.speed || 0);   // множитель ожидания покупателя
  const offerOf = (up) => 1 + 0.015 * (up.offer || 0);      // множитель цены, которую готов дать покупатель
  // Ремонт поднимает состояние на ступень (потёртое → хорошее → как новое). Стоит 70 % прироста цены:
  // в плюс, но немного — «купил хлам, починил, продал» выгодно, а не главная стратегия.
  const REPAIR_K = 0.7;
  // Ремонт может не удаться (решение пользователя 30.10.2026): вещь теряет ступень состояния, деньги потрачены.
  // Шанс падает с навыком «Починка»; со «сломано» чинить дороже.
  const BREAK = [0.25, 0.17, 0.1, 0.05, 0.02];
  const breakChance = (skill) => BREAK[Math.min(skill || 0, BREAK.length - 1)];
  // skill — уровень «Починки»: ремонт дешевле на 6 % за уровень и реже ломает вещь.
  function repairOf(thing, skill = 0) {
    if (thing.fake) return null;
    const i = CONDITIONS.findIndex((c) => c.id === thing.cond);
    if (i < 0 || i >= CONDITIONS.length - 1) return null;
    const next = CONDITIONS[i + 1];
    const value = nice(thing.value * next.k / CONDITIONS[i].k);
    const k = (thing.cond === 'broken' ? 0.85 : REPAIR_K) * (1 - 0.06 * skill);
    // Цену ремонта округляем вверх: у дешёвых вещей обычное округление делало его почти бесплатным.
    const x = (value - thing.value) * k, step = nice(x) === x ? 0 : stepOf(x);
    const prev = CONDITIONS[Math.max(0, i - 1)];
    return { cond: next.id, label: next.label, value, cost: step ? Math.ceil(x / step) * step : x, chance: breakChance(skill),
      fail: { cond: prev.id, label: prev.label, value: i > 0 ? nice(thing.value * prev.k / CONDITIONS[i].k) : thing.value } };
  }

  // ---------- навыки (решение пользователя 30.10.2026) ----------
  // Очки навыков дают только показы рекламы сети VK (за награду и полноэкранная), не заставка сайта.
  // Уровень навыка n стоит n очков. Что даёт каждый уровень — в text.
  const SKILLS = {
    repair: { title: 'Починка', text: ['ремонт на 6 % дешевле, шанс сломать 17 %', 'ремонт на 12 % дешевле, шанс сломать 10 %',
      'ремонт на 18 % дешевле, шанс сломать 5 %', 'ремонт на 24 % дешевле, шанс сломать 2 %'] },
    appraise: { title: 'Оценщик', text: ['на рынке видна оценка вещи (±15 %), в переписке — примерный потолок покупателя',
      'оценка точнее (±5 %)', 'точная цена, подделки видно сразу'] },
    talk: { title: 'Красноречие', text: ['покупатели готовы дать на 3 % больше', 'ещё +3 % и на один торг больше',
      'ещё +3 %', 'ещё +3 % и ещё на один торг больше'] },
    sense: { title: 'Чутьё', text: ['мошенника видно по пометке в переписке', 'видно, правда ли покупатель дошёл до последней цены',
      'на аукционе видно, до скольких примерно готов дойти соперник'] },
  };
  const skillCost = (lvl) => lvl;             // цена перехода на уровень lvl, в очках
  const talkK = (lvl) => 1 + 0.03 * (lvl || 0);
  const talkPatience = (lvl) => ((lvl || 0) >= 2 ? 1 : 0) + ((lvl || 0) >= 4 ? 1 : 0);
  // Погрешность оценки по уровню «Оценщика»: null — оценки нет.
  const appraiseErr = (lvl) => [null, 0.15, 0.05, 0][Math.min(lvl || 0, 3)];

  // ---------- уровень продавца и сам что-то даёт (решение пользователя 30.10.2026: «прокачка ничего не даёт») ----------
  // +1 % к предложениям за уровень и разделы рынка.
  const rankK = (rank) => 1 + 0.01 * Math.max(0, rank - 1);
  const MARKET_RANK = { flea: 1, shop: 1, orders: 2, auction: 3 };

  // ---------- рынок ----------
  const FLEA = { lots: 5, refreshMs: 15 * 60e3, fake: 0.1, ask: [0.6, 1.3] };
  const AUCTION = { durMs: 75e3, extendMs: 8e3, pauseMs: 45e3, start: 0.4, step: 0.05, rivals: [0.7, 1.2] };
  const ORDERS = { n: 3, ttl: [40, 90], pay: [1.35, 1.7] };     // минуты жизни заказа, надбавка к цене
  // Лавка: доход в час по уровню и цена следующего уровня. Окупается за 5–35 часов и копит не больше 8 часов:
  // повод заходить, а не замена торговле.
  const SHOP = { capH: 8, income: [0, 600, 1500, 4000, 11000, 30000, 85000, 240000, 700000, 2e6, 6e6],
    cost: [3000, 12000, 40000, 150000, 500000, 1.8e6, 6e6, 2e7, 7e7, 2.5e8] };

  // ---------- задания дня ----------
  // Три в день; награда — доля цены кейса, до которого дорос игрок; за все три — ещё бонус.
  const QUESTS = [
    { id: 'open', text: 'Открыть {n} кейсов', n: 5 },
    { id: 'sell', text: 'Продать {n} вещи покупателям', n: 4 },
    { id: 'haggle', text: 'Продать дороже цены рынка {n} раза', n: 2 },
    { id: 'repair', text: 'Починить вещь', n: 1 },
    { id: 'flea', text: 'Купить вещь на барахолке', n: 1 },
    { id: 'order', text: 'Выполнить заказ', n: 1, rank: 2 },
    { id: 'auction', text: 'Выиграть аукцион', n: 1, rank: 3 },
    { id: 'work', text: 'Сделать {n} кликов на работе', n: 100 },
    { id: 'shop', text: 'Собрать выручку лавки', n: 1, shop: true },
    { id: 'answer', text: 'Ответить покупателям на {n} вопроса', n: 3 },
  ];
  const questReward = (best) => Math.max(300, nice(reachedCase(best).price * 0.6));
  const questBonus = (best) => Math.max(500, nice(reachedCase(best).price));

  // ---------- награды ----------
  // Награды меряются кейсом, до которого игрок дорос: самый дорогой кейс не дороже рекорда денег.
  // Так подарок на 7-й день и в начале, и через час игры ощутим, но не ломает темп.
  const reachedCase = (best) => CASES.filter((c) => c.price <= Math.max(best, START_MONEY)).at(-1) || CASES[0];
  // Уровень вещей, до которого дорос игрок: самый частый уровень в самом дорогом доступном кейсе (для рынка).
  const tierNow = (best) => { const o = reachedCase(best).odds; return Number(Object.keys(o).reduce((a, b) => (o[b] > o[a] ? b : a))); };
  const DAILY = [0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.6];          // доля цены кейса, дни 1…7 серии
  const dailyGift = (day, best) => Math.max(200 * day, nice(reachedCase(best).price * DAILY[(day - 1) % 7]));
  // Полка коллекции (все вещи уровня) — три кейса этого уровня.
  const shelfReward = (tier) => nice(caseOfTier(tier).price * 3);
  // Достижение — половина кейса, до которого игрок дорос, но не меньше 300 ₽.
  const achReward = (best) => Math.max(300, nice(reachedCase(best).price * 0.5));
  // Цели: проверяет game.js по полям состояния; n — сколько нужно, of(state) — сколько есть.
  const ACHIEVEMENTS = [
    { id: 'deal1', title: 'Первая сделка', text: 'Продать вещь покупателю', n: 1, of: (s) => s.stats.sold },
    { id: 'deal10', title: 'Свой человек', text: 'Продать 10 вещей', n: 10, of: (s) => s.stats.sold },
    { id: 'deal100', title: 'Перекуп со стажем', text: 'Продать 100 вещей', n: 100, of: (s) => s.stats.sold },
    { id: 'haggle', title: 'Мастер торга', text: 'Продать в 1,5 раза дороже рынка', n: 1, of: (s) => s.stats.haggle || 0 },
    { id: 'troll', title: 'Тишина в чате', text: 'Заблокировать тролля', n: 1, of: (s) => s.stats.blocked || 0 },
    { id: 'repair', title: 'Золотые руки', text: 'Починить вещь', n: 1, of: (s) => s.stats.repaired || 0 },
    { id: 'repair20', title: 'Мастерская', text: 'Починить 20 вещей', n: 20, of: (s) => s.stats.repaired || 0 },
    { id: 'open50', title: 'Азарт', text: 'Открыть 50 кейсов', n: 50, of: (s) => s.stats.opened },
    { id: 'shelf', title: 'Первая полка', text: 'Собрать все вещи одного кейса', n: 1, of: (s) => Object.keys(s.shelves || {}).length },
    { id: 'found50', title: 'Коллекционер', text: 'Найти 50 разных вещей', n: 50, of: (s) => Object.keys(s.found || {}).length },
    { id: 'found100', title: 'Полный альбом', text: 'Найти все 100 вещей', n: ITEMS.length, of: (s) => Object.keys(s.found || {}).length },
    { id: 'legend', title: 'Охотник за кладом', text: 'Открыть кейс «Клад»', n: 1, of: (s) => (s.first && s.first.legend ? 1 : 0) },
    { id: 'million', title: 'Миллионер', text: 'Накопить 1 млн ₽', n: 1e6, of: (s) => s.stats.best },
    { id: 'billion', title: 'Миллиардер', text: 'Накопить 1 млрд ₽', n: 1e9, of: (s) => s.stats.best },
    { id: 'rank6', title: 'Лучший продавец', text: 'Дойти до 6-го уровня продавца', n: 6, of: (s) => rankOf(s.stats.sold) },
    { id: 'streak7', title: 'Постоянный гость', text: 'Забрать подарки 7 дней подряд', n: 7, of: (s) => (s.daily ? s.daily.best || 0 : 0) },
    { id: 'scam', title: 'Меня не проведёшь', text: 'Раскусить мошенника', n: 1, of: (s) => s.stats.scamCaught || 0 },
    { id: 'regular', title: 'Свои люди', text: 'Завести 3 постоянных клиентов', n: 3, of: (s) => (s.regulars || []).length },
    { id: 'flea10', title: 'Охотник за находками', text: 'Купить 10 вещей на барахолке', n: 10, of: (s) => s.stats.bought || 0 },
    { id: 'auction', title: 'Молоток', text: 'Выиграть аукцион', n: 1, of: (s) => s.stats.auctions || 0 },
    { id: 'orders10', title: 'Под заказ', text: 'Выполнить 10 заказов', n: 10, of: (s) => s.stats.orders || 0 },
    { id: 'shop5', title: 'Своё дело', text: 'Прокачать лавку до 5-го уровня', n: 5, of: (s) => (s.shop ? s.shop.level || 0 : 0) },
    { id: 'skill', title: 'Ученик', text: 'Открыть первый навык', n: 1, of: (s) => Object.values(s.skills || {}).reduce((a, b) => a + b, 0) },
  ];

  // Цены, которые пишут люди: 1 250, 18 400, 2,2 млн.
  function stepOf(n) { return n < 1e3 ? 10 : n < 1e4 ? 50 : n < 1e5 ? 100 : n < 1e6 ? 1000 : n < 1e7 ? 10000 : n < 1e8 ? 100000 : 1000000; }
  function nice(n) {
    const step = stepOf(n);
    return Math.max(step, Math.round(n / step) * step);
  }

  root.PEREKUP_ECON = { WORK, workEnergyMax, workClickCost, CASES, weightOf, TIER_NAMES, CONDITIONS, BUYERS, QUICK, MAX_LISTINGS, START_MONEY, AVA, workIncome, workCost, waitFor, nice,
    RANKS, rankOf, UPGRADES, slotsOf, speedOf, offerOf, REPAIR_K, repairOf, reachedCase, DAILY, dailyGift, shelfReward, achReward, ACHIEVEMENTS,
    caseOfTier, tierNow, REGULAR_W, moodK, BREAK, breakChance, SKILLS, skillCost, talkK, talkPatience, appraiseErr, rankK, MARKET_RANK,
    FLEA, AUCTION, ORDERS, SHOP, QUESTS, questReward, questBonus, stepOf };
})(typeof window !== 'undefined' ? window : globalThis);
