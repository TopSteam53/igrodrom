// Экономика «Перекупа»: кейсы, состояние вещей, покупатели, работа. Файл читают игра (game.js)
// и проверка баланса (test/perekup.test.js), поэтому здесь только данные и чистые функции.
'use strict';
(function (root) {
  const ITEMS = root.ITEMS;
  const TIER_NAMES = { 1: 'обычная', 2: 'нужная', 3: 'редкая', 4: 'ценная', 5: 'роскошь', 6: 'клад' };
  const CONDITIONS = [
    { id: 'worn', label: 'потёртое', k: 0.75, w: 40 },
    { id: 'good', label: 'хорошее', k: 1, w: 45 },
    { id: 'mint', label: 'как новое', k: 1.3, w: 15 },
  ];
  // Внутри уровня дешёвые вещи выпадают чаще: вес 1/√цены.
  const weightOf = (item) => 1 / Math.sqrt(item.price);
  // Шансы уровней вещей в кейсе, %. Цену кейса не задаём руками: это EDGE от средней цены выпавшего. По цене
  // рынка открытие в среднем даёт +18 %, торг добавляет ещё; «продать сразу» (60 %) — в минус. Новые вещи баланс не ломают.
  const EDGE = 0.85;
  // Каждый кейс почти целиком из своего уровня: так средняя находка — это обычная находка, а не джекпот,
  // и открытие в среднем в плюс. Уровень выше — 0,5 %, через уровень — 0,1 %: редкая удача сверху.
  const ODDS = [
    ['junk', 'Барахло', { 1: 99.4, 2: 0.5, 3: 0.1 }],
    ['home', 'Быт', { 2: 99.4, 3: 0.5, 4: 0.1 }],
    ['tech', 'Техника', { 3: 99.4, 4: 0.5, 5: 0.1 }],
    ['antique', 'Антиквариат', { 4: 99.5, 5: 0.5 }],
    ['lux', 'Роскошь', { 5: 99.85, 6: 0.15 }],
    ['legend', 'Клад', { 5: 50, 6: 50 }],
  ];
  const condK = CONDITIONS.reduce((n, c) => n + c.k * c.w, 0) / CONDITIONS.reduce((n, c) => n + c.w, 0);
  function expected(odds) {
    let ev = 0, total = 0;
    for (const [tier, p] of Object.entries(odds)) {
      const pool = ITEMS.filter((i) => i.tier === Number(tier));
      const w = pool.reduce((n, i) => n + weightOf(i), 0);
      ev += p * pool.reduce((n, i) => n + (i.price * weightOf(i)) / w, 0);
      total += p;
    }
    return (ev / total) * condK;
  }
  const CASES = ODDS.map(([id, title, odds]) => ({ id, title, odds, ev: expected(odds), price: nice(expected(odds) * EDGE) }));
  // Покупатели: сколько готовы заплатить (доля от цены рынка), с чего начинают торг, сколько раз уступают.
  const BUYERS = {
    chatty: { w: 30, max: [0.95, 1.22], first: [0.84, 0.94], patience: 3, accept: 0.92 },
    hurry: { w: 25, max: [0.9, 1.12], first: [0.93, 1.0], patience: 1, accept: 0.85, bolt: 0.4 },
    thrifty: { w: 35, max: [0.8, 1.03], first: [0.62, 0.78], patience: 2, accept: 0.75 },
    troll: { w: 10 },
  };
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
  function repairOf(thing) {
    const i = CONDITIONS.findIndex((c) => c.id === thing.cond);
    if (i < 0 || i >= CONDITIONS.length - 1) return null;
    const next = CONDITIONS[i + 1];
    const value = nice(thing.value * next.k / CONDITIONS[i].k);
    // Цену ремонта округляем вверх: у дешёвых вещей обычное округление делало его почти бесплатным.
    const x = (value - thing.value) * REPAIR_K, step = nice(x) === x ? 0 : stepOf(x);
    return { cond: next.id, label: next.label, value, cost: step ? Math.ceil(x / step) * step : x };
  }

  // ---------- награды ----------
  // Награды меряются кейсом, до которого игрок дорос: самый дорогой кейс не дороже рекорда денег.
  // Так подарок на 7-й день и в начале, и через час игры ощутим, но не ломает темп.
  const reachedCase = (best) => CASES.filter((c) => c.price <= Math.max(best, START_MONEY)).at(-1) || CASES[0];
  const DAILY = [0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.6];          // доля цены кейса, дни 1…7 серии
  const dailyGift = (day, best) => Math.max(200 * day, nice(reachedCase(best).price * DAILY[(day - 1) % 7]));
  // Полка коллекции (все вещи уровня) — три кейса этого уровня.
  const shelfReward = (tier) => nice(CASES[tier - 1].price * 3);
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
  ];

  // Цены, которые пишут люди: 1 250, 18 400, 2,2 млн.
  function stepOf(n) { return n < 1e3 ? 10 : n < 1e4 ? 50 : n < 1e5 ? 100 : n < 1e6 ? 1000 : n < 1e7 ? 10000 : n < 1e8 ? 100000 : 1000000; }
  function nice(n) {
    const step = stepOf(n);
    return Math.max(step, Math.round(n / step) * step);
  }

  root.PEREKUP_ECON = { WORK, workEnergyMax, workClickCost, CASES, weightOf, TIER_NAMES, CONDITIONS, BUYERS, QUICK, MAX_LISTINGS, START_MONEY, AVA, workIncome, workCost, waitFor, nice,
    RANKS, rankOf, UPGRADES, slotsOf, speedOf, offerOf, REPAIR_K, repairOf, reachedCase, DAILY, dailyGift, shelfReward, achReward, ACHIEVEMENTS };
})(typeof window !== 'undefined' ? window : globalThis);
