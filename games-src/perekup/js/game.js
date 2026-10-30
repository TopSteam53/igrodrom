// «Перекуп: от хлама до клада». Кейс → вещь → объявление → покупатель в переписке → торг → деньги → кейс дороже.
// Рынок (js/market.js): барахолка, заказы, аукцион, лавка и работа. Сохранения и реклама — через Gamely SDK.
'use strict';
(function () {
  const ITEMS = window.ITEMS;
  const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
  const T = window.TALK;
  const $ = (id) => document.getElementById(id);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const now = () => Date.now();

  const E = window.PEREKUP_ECON;
  const { CASES, TIER_NAMES, CONDITIONS, BUYERS, QUICK, START_MONEY, AVA, waitFor, nice,
    RANKS, rankOf, UPGRADES, slotsOf, speedOf, offerOf, repairOf, dailyGift, shelfReward, achReward, ACHIEVEMENTS,
    caseOfTier, REGULAR_W, moodK, SKILLS, skillCost, talkK, talkPatience, appraiseErr, rankK, MARKET_RANK,
    QUESTS, questReward, questBonus } = E;

  function weighted(entries) {
    const total = entries.reduce((n, [, w]) => n + w, 0);
    let r = Math.random() * total;
    for (const [v, w] of entries) { if ((r -= w) <= 0) return v; }
    return entries[entries.length - 1][0];
  }
  function money(n) {
    const sp = (x) => Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const dec = (x) => (x < 10 ? x.toFixed(1).replace('.', ',').replace(',0', '') : sp(x));
    if (n >= 1e9) return `${dec(n / 1e9)} млрд ₽`;
    if (n >= 1e6) return `${dec(n / 1e6)} млн ₽`;
    return `${sp(n)} ₽`;
  }
  const forms = (n, [one, few, many]) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
  // Подстановка в реплики: {item} — название в кавычках, строки как есть, числа — деньгами; [муж.|жен.] — по роду.
  const say = (tpl, v) => tpl.replace(/\[([^|\]]*)\|([^\]]*)\]/g, (_, m, f) => (v.f ? f : m))
    .replace(/\{(\w+)\}/g, (_, k) => (k === 'item' ? `«${v.item}»` : typeof v[k] === 'string' ? v[k] : money(v[k])));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // Вещь: цена рынка — от базовой, состояния и небольшого разброса.
  const DROP_CONDS = CONDITIONS.filter((c) => c.w > 0);
  function makeThing(item, cond) {
    const c = cond || weighted(DROP_CONDS.map((x) => [x, x.w]));
    return { uid: state.seq++, id: item.id, cond: c.id, value: nice(item.price * c.k * rnd(0.92, 1.08)) };
  }
  const rollItem = (kase) => makeThing(weighted(kase.pool));
  const condOf = (thing) => CONDITIONS.find((c) => c.id === thing.cond) || CONDITIONS[1];

  // ---------- сохранение ----------
  let sdk = null;
  let state = fresh();
  function fresh() {
    return { v: 1, money: START_MONEY, inv: [], listings: [], chats: [], work: { level: 1 }, seq: 1, kase: 'junk',
      stats: { opened: 0, sold: 0, earned: 0, best: START_MONEY, sales: 0, haggle: 0, blocked: 0, repaired: 0,
        bought: 0, auctions: 0, orders: 0, scamCaught: 0, scammed: 0, answered: 0, repairFail: 0 },
      // found — найденные вещи (коллекция), shelves — полки с полученной наградой, ach — полученные достижения,
      // up — уровни улучшений продавца, daily — серия подарков: последний день (ключ даты) и номер дня в серии.
      // skills — уровни навыков, adPts — очки за показы рекламы VK, regulars — постоянные клиенты,
      // market — барахолка, заказы, аукцион (js/market.js), shop — лавка, quests — задания дня.
      found: {}, shelves: {}, ach: {}, up: {}, daily: { last: null, day: 0, best: 0 },
      skills: {}, adPts: 0, regulars: [], market: {}, shop: { level: 0, at: 0 }, quests: null };
  }
  const slots = () => slotsOf(state.up);
  const skill = (id) => state.skills[id] || 0;
  const rank = () => rankOf(state.stats.sold);
  const ptsSpent = () => Object.values(state.skills).reduce((n, l) => n + (l * (l + 1)) / 2, 0);
  const ptsFree = () => state.adPts - ptsSpent();
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { sdk && sdk.data.set(state).catch(() => {}); }, 800);
  }

  // ---------- деньги ----------
  function addMoney(n) {
    state.money += n;
    if (n > 0) { state.stats.earned += n; state.stats.best = Math.max(state.stats.best, state.money); }
    $('money').textContent = money(state.money);
    const b = $('bal');
    b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    setTimeout(() => b.classList.remove('bump'), 160);
    save();
  }

  // ---------- реклама ----------
  // Очко навыков — только за показ рекламы сети (VK): площадка отвечает shown. Своя заставка сайта («Gamely советует»)
  // награду даёт, но shown у неё нет — очко не засчитывается (решение пользователя 30.10.2026).
  function networkAd() {
    state.adPts += 1;
    toast('Реклама VK засчитана: +1 очко навыков', () => go('seller'));
    progress(); save();
  }
  async function rewardedAd() {
    if (!sdk) return true;
    const r = await sdk.ads.rewarded().catch(() => ({ rewarded: false }));
    if (r && r.shown) networkAd();
    return !!(r && r.rewarded);
  }
  function fullscreenAd() {
    if (sdk) sdk.ads.fullscreen().then((r) => { if (r && r.shown) networkAd(); }).catch(() => {});
  }

  // ---------- покупатели ----------
  // Потолок покупателя с учётом настроения; настроение меняют ответы и торг.
  const effMax = (c) => nice(c.max * moodK(c.mood));
  const thingOf = (l) => l.item;
  function arrive(listing) {
    const item = BY_ID[listing.item.id];
    const entries = Object.entries(BUYERS).filter(([, b]) => b.w && (!b.minTier || item.tier >= b.minTier)).map(([k, b]) => [k, b.w]);
    if (state.regulars.length) entries.push(['regular', REGULAR_W]);
    const type = weighted(entries);
    const b = BUYERS[type];
    let who;
    if (type === 'regular') who = pick(state.regulars);
    else { const f = Math.random() < 0.5; who = { name: pick(f ? T.women : T.men), f, color: pick(AVA) }; }
    const market = listing.item.value;
    const chat = {
      id: state.seq++, listing: listing.item.uid, name: who.name, f: who.f, color: who.color, type, msgs: [], state: 'open',
      unread: true, at: now(), mood: Math.round((b.mood || 50) + rnd(-8, 8)), patience: (b.patience || 0) + talkPatience(skill('talk')),
      noise: rnd(-1, 1), phase: 'bargain',
    };
    if (b.max) chat.max = nice(market * rnd(b.max[0], b.max[1]) * offerOf(state.up) * talkK(skill('talk')) * rankK(rank()));
    const t = T.types[type];
    const v = vars(chat, listing);
    chat.msgs.push({ who: 'them', text: say(pick(t.hello), v) });
    if (type === 'troll') {
      chat.offer = nice(market * rnd(0.05, 0.2));
      chat.msgs.push({ who: 'them', text: say(pick(t.offer), { ...v, offer: chat.offer }) });
      chat.phase = 'troll';
    } else if (type === 'scammer') {
      chat.msgs.push({ who: 'them', text: pick(t.scam) });
      chat.phase = 'scam';
    } else if (type !== 'hurry' && Math.random() < 0.75) {
      chat.q = pick(Object.keys(T.questions));
      chat.msgs.push({ who: 'them', text: pick(T.questions[chat.q].ask) });
      chat.phase = 'q';
    } else makeOffer(chat, listing);
    listing.chat = chat.id;
    state.chats.unshift(chat);
    state.chats = state.chats.slice(0, 40);
    const open = () => { ui.tab = 'chats'; markNav('chats'); ui.chat = chat.id; renderChat(); };
    if (!(ui.tab === 'chats' && ui.chat === chat.id)) toast(`${chat.name} пишет по объявлению «${item.title}»`, open);
    else chat.unread = false;
    updateDot();
    save();
    return chat;
  }
  const listingOf = (chat) => state.listings.find((l) => l.item.uid === chat.listing);
  function vars(chat, l) {
    return { item: BY_ID[l.item.id].title, offer: chat.offer || 0, ask: l.ask, f: chat.f ?? T.women.includes(chat.name), cond: condOf(l.item).label };
  }
  function makeOffer(chat, l, k = 1) {
    const b = BUYERS[chat.type];
    chat.offer = Math.min(l.ask, nice(effMax(chat) * rnd(b.first[0], b.first[1]) * k));
    chat.msgs.push({ who: 'them', text: say(pick(T.types[chat.type].offer), vars(chat, l)) });
    chat.phase = 'bargain';
  }

  function sell(listing, price, chat) {
    state.listings = state.listings.filter((l) => l !== listing);
    const r0 = rank();
    state.stats.sold += 1;
    state.stats.sales += price;
    if (price >= listing.item.value * 1.5) state.stats.haggle += 1;
    addMoney(price);
    quest('sell');
    if (price > listing.item.value) quest('haggle');
    if (rank() > r0) toast(`Уровень продавца ${rank()}: +1 % к предложениям${Object.entries(MARKET_RANK).some(([, r]) => r === rank()) ? ', на рынке открыт новый раздел' : ''}`, () => go('seller'));
    if (chat) {
      chat.state = 'done';
      chat.msgs.push({ who: 'sys', text: `Продано за ${money(price)}` });
      // Хорошо договорились — человек вернётся: постоянный клиент платит больше и не задаёт лишних вопросов.
      if (chat.mood >= 65 && ['chatty', 'thrifty', 'hurry', 'collector'].includes(chat.type) && !state.regulars.some((x) => x.name === chat.name)) {
        state.regulars = [{ name: chat.name, f: chat.f, color: chat.color }, ...state.regulars].slice(0, 8);
        chat.msgs.push({ who: 'sys', text: `${chat.name} теперь ваш постоянный клиент` });
      }
    }
    progress();
  }
  // Покупатель ушёл: объявление остаётся, следующий придёт позже.
  function buyerGone(chat, soon) {
    chat.state = 'gone';
    const l = listingOf(chat);
    if (l) { l.chat = null; l.buyerAt = now() + (soon ? 3000 : waitFor(l.ask / l.item.value) * speedOf(state.up)); }
  }

  // Ответ на вопрос покупателя: число — сдвиг настроения, 'caught' — покупатель поймал на неправде.
  const ANSWERS = {
    honest: (c, th) => (th.cond === 'mint' || th.cond === 'good' ? 9 : 4),
    praise: (c, th) => (th.cond === 'mint' ? 8 : Math.random() < 0.6 ? 'caught' : 10),
    photo: () => -4, move: () => 6, case: () => 2, rude: () => -15, metro: () => 10, post: () => 3, pickup: () => -3,
    small: () => 5, offer: () => 2, firm: (c) => { c.firmAsk = true; c.patience -= 1; return -6; },
  };
  const said = (chat, who, text) => chat.msgs.push({ who, text });
  function answer(chat, action, price) {
    const l = listingOf(chat);
    if (!l || chat.state !== 'open' || chat.waiting) return;
    const t = T.types[chat.type];
    const b = BUYERS[chat.type];
    const v = { ...vars(chat, l), price };
    if (action.startsWith('ans:')) {
      const id = action.slice(4);
      const a = T.questions[chat.q].answers.find((x) => x[0] === id);
      said(chat, 'mine', say(a[1], v));
      chat.waiting = true;
      afterChat(chat);
      state.stats.answered = (state.stats.answered || 0) + 1;
      quest('answer');
      return typing(chat, () => {
        chat.waiting = false;
        const d = ANSWERS[id](chat, l.item);
        const delta = d === 'caught' ? -22 : d;
        chat.mood = Math.max(0, Math.min(100, chat.mood + delta));
        said(chat, 'them', pick(d === 'caught' ? T.react.caught : delta >= 5 ? T.react.good : delta <= -5 ? T.react.bad : T.react.ok));
        makeOffer(chat, l, chat.firmAsk ? 1.06 : 1);
      });
    }
    if (action === 'yes') {
      said(chat, 'mine', say(T.me.yes, v));
      said(chat, 'them', pick(t.deal));
      sell(l, chat.offer, chat);
      return afterChat(chat);
    }
    if (action === 'no') {
      said(chat, 'mine', T.me.no);
      said(chat, 'them', pick(t.decline));
      buyerGone(chat);
      return afterChat(chat);
    }
    if (action === 'block') {
      said(chat, 'sys', chat.type === 'scammer' ? 'Вы заблокировали мошенника. Отличное чутьё.' : T.types.troll.blocked);
      state.stats.blocked += 1;
      if (chat.type === 'scammer') state.stats.scamCaught += 1;
      buyerGone(chat, true);
      progress();
      return afterChat(chat);
    }
    if (action === 'joke') {
      said(chat, 'mine', T.me.joke);
      typing(chat, () => { said(chat, 'them', pick(t.leave)); buyerGone(chat, true); });
      return afterChat(chat);
    }
    // Мошенник: «при встрече» — он исчезает (вы его раскусили), «отправить» — вещь пропала, денег нет.
    if (action === 'meet') {
      said(chat, 'mine', T.me.meet);
      return typing(chat, () => {
        said(chat, 'them', pick(t.gone));
        said(chat, 'sys', 'Похоже, это был мошенник. Вещь осталась у вас.');
        state.stats.scamCaught += 1;
        buyerGone(chat, true);
        progress();
      });
    }
    if (action === 'send') {
      said(chat, 'mine', T.me.send);
      return typing(chat, () => {
        state.listings = state.listings.filter((x) => x !== l);
        said(chat, 'sys', say(t.lost, v));
        chat.state = 'done';
        state.stats.scammed += 1;
        toast(`Вас обманули: «${v.item}» пропала. Не отправляйте вещь, пока не получили деньги.`);
      });
    }
    if (action === 'bluff') {
      said(chat, 'mine', T.me.bluff);
      chat.bluffed = true; chat.waiting = true;
      afterChat(chat);
      return typing(chat, () => {
        chat.waiting = false;
        const eff = effMax(chat);
        if (Math.random() < chat.mood / 100 && eff > chat.offer) {
          chat.offer = Math.min(l.ask, Math.max(chat.offer + E.stepOf(chat.offer), nice(chat.offer + (eff - chat.offer) * rnd(0.55, 0.8))));
          chat.mood -= 4;
          said(chat, 'them', say(pick(T.react.bluffOk), vars(chat, l)));
        } else if (Math.random() < 0.5) {
          said(chat, 'them', pick(T.react.bluffGone));
          buyerGone(chat);
        } else {
          chat.mood -= 10;
          said(chat, 'them', say(pick(T.react.bluffNo), vars(chat, l)));
        }
      });
    }
    // Торг: уступить 5 %, встретиться посередине или стоять на цене объявления. Каждый торг немного портит настроение,
    // «стою на своём» — сильнее; покупатель соглашается, если цена не выше его потолка, иначе поднимает предложение.
    const kind = action;
    said(chat, 'mine', say(T.me[kind] || T.me.counter, v));
    chat.waiting = true;
    chat.mood -= { concede: 1, counter: 3, firm: 7 }[kind] || 3;
    afterChat(chat);
    typing(chat, () => {
      chat.waiting = false;
      if (b.bolt && kind !== 'concede' && Math.random() < b.bolt) { said(chat, 'them', pick(t.leave)); return buyerGone(chat); }
      const eff = effMax(chat);
      if (price <= eff && Math.random() < b.accept + (chat.mood - 50) / 250) {
        said(chat, 'them', pick(t.deal));
        return sell(l, price, chat);
      }
      chat.patience -= kind === 'firm' ? 2 : 1;
      const next = nice(chat.offer + (Math.min(eff, price) - chat.offer) * rnd(0.5, 0.8));
      if (chat.patience < 0 || next <= chat.offer) { said(chat, 'them', pick(t.leave)); return buyerGone(chat); }
      chat.offer = next;
      said(chat, 'them', say(pick(t.raise), vars(chat, l)));
      if (skill('sense') >= 2) said(chat, 'sys', next >= eff * 0.97 ? 'Чутьё: похоже, это правда его предел' : 'Чутьё: может дать больше');
    });
  }
  function typing(chat, then) {
    chat.typing = true;
    rerenderChat(chat);
    setTimeout(() => { chat.typing = false; chat.waiting = false; then(); chat.at = now(); save(); rerenderChat(chat); updateDot(); }, rnd(900, 1700));
  }
  function afterChat(chat) { chat.at = now(); save(); rerenderChat(chat); updateDot(); }

  // ---------- прогресс: коллекция, достижения, подарки, задания, таблицы лидеров ----------
  // Новая вещь попадает в коллекцию; собранная полка (все вещи уровня) один раз даёт награду.
  function discover(id) {
    if (state.found[id]) return;
    state.found[id] = true;
    const tier = BY_ID[id].tier;
    if (!state.shelves[tier] && ITEMS.filter((i) => i.tier === tier).every((i) => state.found[i.id])) {
      state.shelves[tier] = true;
      const r = shelfReward(tier);
      addMoney(r);
      toast(`Полка «${caseOfTier(tier).title}» собрана: +${money(r)}`);
    }
    progress();
  }
  // Проверка целей после каждого заметного события. Награда — сразу деньгами.
  function progress() {
    for (const a of ACHIEVEMENTS) {
      if (state.ach[a.id] || a.of(state) < a.n) continue;
      const r = achReward(state.stats.best);
      state.ach[a.id] = now();
      addMoney(r);
      toast(`Достижение «${a.title}»: +${money(r)}`);
    }
    updateDot();
    pushBoards();
  }
  // Таблицы лидеров сайта: лучший результат игрока. Гостю площадка откажет — это нормально, молча пропускаем.
  const BOARDS = [
    { id: 'rich', title: 'Богачи', of: () => Math.floor(state.stats.best), fmt: (n) => money(n) },
    { id: 'collect', title: 'Коллекционеры', of: () => Object.keys(state.found).length, fmt: (n) => `${n} из ${ITEMS.length}` },
    { id: 'sales', title: 'Продавцы', of: () => Math.floor(state.stats.sales), fmt: (n) => money(n) },
  ];
  let boardTimer = 0, sentBoards = {};
  function pushBoards() {
    if (!sdk || !sdk.leaderboard || boardTimer) return;
    boardTimer = setTimeout(() => {
      boardTimer = 0;
      for (const b of BOARDS) {
        const v = b.of();
        if (v > 0 && v !== sentBoards[b.id]) { sentBoards[b.id] = v; sdk.leaderboard.setScore(v, { board: b.id }).catch(() => {}); }
      }
    }, 30000);
  }
  // Подарок дня: серия из 7 дней, пропуск дня начинает её заново. День — по часам устройства.
  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function giftState() {
    const d = state.daily, today = dayKey(now());
    if (d.last === today) return { ready: false, day: d.day };
    const streak = d.last === dayKey(now() - 864e5) ? d.day % 7 + 1 : 1;
    return { ready: true, day: streak };
  }
  // Задания дня: три случайных из подходящих игроку (раздел рынка открыт, лавка куплена).
  function quests() {
    const today = dayKey(now());
    if (!state.quests || state.quests.day !== today) {
      const fit = QUESTS.filter((q) => (!q.rank || rank() >= q.rank) && (!q.shop || state.shop.level > 0));
      const list = [];
      while (list.length < 3 && fit.length) list.push(fit.splice(Math.floor(Math.random() * fit.length), 1)[0]);
      state.quests = { day: today, list: list.map((q) => ({ id: q.id, n: q.n, have: 0, got: false })), bonus: false };
    }
    return state.quests;
  }
  function quest(id, k = 1) {
    const q = quests().list.find((x) => x.id === id);
    if (!q || q.have >= q.n) return;
    q.have = Math.min(q.n, q.have + k);
    if (q.have >= q.n) toast(`Задание выполнено: заберите награду`, () => go('gift'));
    updateDot(); save();
  }
  const questText = (q) => QUESTS.find((x) => x.id === q.id).text.replace('{n}', q.n);

  // ---------- интерфейс ----------
  const ui = { tab: 'cases', item: null, chat: null, drop: null, spinning: false };
  const view = $('view');
  const isFull = (id) => BY_ID[id].full;
  const ph = (id, cls = 'ph') => `<div class="${cls}${isFull(id) ? ' full' : ''}"><img src="img/${id}.webp" alt="" draggable="false"></div>`;
  const condTag = (thing) => `<span class="tag c${thing.cond === 'broken' ? ' bad' : ''}">${condOf(thing).label}</span>${thing.fake ? '<span class="tag bad">подделка</span>' : ''}`;
  function cardHTML(thing, attrs = '') {
    const it = BY_ID[thing.id];
    return `<button class="card" type="button" ${attrs}>${ph(thing.id)}<div class="tx"><div class="pr">${money(thing.value)}</div>
      <div class="nm">${it.title}</div><div class="tags"><span class="tag t${it.tier}">${TIER_NAMES[it.tier]}</span>
      ${condTag(thing)}</div></div></button>`;
  }
  function setTitle(text, back) {
    $('title').textContent = text;
    $('back').classList.toggle('hidden', !back);
    // На внутренних экранах (есть «Назад») значки сверху прячутся: иначе заголовок не помещается на телефоне.
    document.querySelector('.bar').classList.toggle('sub', !!back);
  }
  // Вкладки снизу — основные экраны; подарок, коллекция, рейтинг и прокачка открываются кнопками сверху
  // поверх текущей вкладки, «Назад» возвращает к ней.
  const EXTRA = ['gift', 'album', 'top', 'seller'];
  function go(tab, sub) {
    if (EXTRA.includes(tab)) { if (!EXTRA.includes(ui.tab)) ui.prev = ui.tab; } else ui.prev = null;
    ui.tab = tab; ui.item = null; ui.chat = null;
    if (sub) ui.market = sub;
    for (const b of document.querySelectorAll('#nav [data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const b of document.querySelectorAll('.bar [data-go]')) b.classList.toggle('on', b.dataset.go === tab);
    render();
  }
  function render() {
    view.scrollTop = 0;
    view.onclick = null;
    ({ cases: renderCases, inv: renderInv, sales: renderSales, chats: renderChats, market: () => market.render(),
      gift: renderGift, album: renderAlbum, top: renderTop, seller: renderSeller })[ui.tab]();
  }

  // Вещь для ленты барабана: редкие попадаются чаще, чем выпадают на деле (корень из шанса), но не через одну.
  const teaser = (k) => weighted(k.pool.map(([i, p]) => [i, Math.sqrt(p)]));
  const pct = (p) => String(p >= 10 ? Math.round(p) : Math.round(p * 10) / 10).replace('.', ',');

  // Кейсы
  function renderCases() {
    setTitle('Кейсы');
    if (ui.drop) return renderDrop();
    const k = CASES.find((c) => c.id === state.kase) || CASES[0];
    const sample = Array.from({ length: 3 }, () => teaser(k));
    // Кейсы намного дороже денег на руках не показываем все сразу: видно ближайшие два, остальные — по мере роста.
    const shown = CASES.filter((c, i) => i < 3 || CASES[i - 2].price <= Math.max(state.money, state.stats.best));
    view.innerHTML = `<div class="cases">
      <div class="reel-wrap"><div class="reel" id="reel">${sample.map((i) => `<div class="it${i.full ? ' full' : ''}"><img src="img/${i.id}.webp" alt=""></div>`).join('')}</div><div class="reel-line"></div></div>
      <div class="cases-side"><div class="case-list">${shown.map((c) => `<button class="case${c.id === k.id ? ' sel' : ''}${c.price > state.money ? ' far' : ''}" type="button" data-case="${c.id}"><b>${money(c.price)}</b>${c.title}</button>`).join('')}
        ${shown.length < CASES.length ? `<div class="case more">ещё ${CASES.length - shown.length} ${forms(CASES.length - shown.length, ['кейс', 'кейса', 'кейсов'])} впереди</div>` : ''}</div>
      <div class="odds">${Object.entries(k.odds).filter(([, p]) => p >= 0.05).map(([t, p]) => `<span class="tag t${t}">${TIER_NAMES[t]} ${pct(p)} %</span>`).join('')}</div>
      <div class="case-actions"><button class="btn deal" id="open" type="button" ${state.money < k.price ? 'disabled' : ''}>Открыть за ${money(k.price)}</button>
      ${state.money < k.price ? `<p class="hint">Не хватает ${money(k.price - state.money)}. Продайте вещи, загляните на рынок или подработайте.</p>
        <button class="btn ghost" id="toWork" type="button">Подработать</button>` : ''}</div></div></div>`;
    view.querySelector('.case-list').onclick = (e) => {
      const b = e.target.closest('[data-case]');
      if (!b || ui.spinning) return;
      state.kase = b.dataset.case; save(); renderCases();
    };
    $('open').onclick = () => openCase(k);
    if ($('toWork')) $('toWork').onclick = () => go('market', 'work');
  }
  function openCase(k) {
    if (ui.spinning || state.money < k.price) return;
    ui.spinning = true;
    addMoney(-k.price);
    state.stats.opened += 1;
    quest('open');
    let won = rollItem(k);
    state.first ||= {};
    if (!state.first[k.id]) {
      for (let i = 0; i < 60 && won.value < k.price * 1.15; i++) { state.seq--; won = rollItem(k); }
      state.first[k.id] = true;
    }
    const strip = Array.from({ length: 34 }, () => teaser(k));
    const WIN = 30;
    strip[WIN] = BY_ID[won.id];
    const reel = $('reel');
    reel.innerHTML = strip.map((i) => `<div class="it${i.full ? ' full' : ''}"><img src="img/${i.id}.webp" alt=""></div>`).join('');
    const pitch = 130, first = 6;
    const wrapH = reel.parentElement.clientHeight;
    const y = wrapH / 2 - (first + WIN * pitch + 62) + rnd(-36, 36);
    reel.style.transition = 'none';
    reel.style.transform = 'translateY(0)';
    void reel.offsetWidth;
    reel.style.transition = 'transform 3.4s cubic-bezier(.12,.62,.08,1)';
    reel.style.transform = `translateY(${y}px)`;
    for (const b of view.querySelectorAll('button')) b.disabled = true;
    setTimeout(() => {
      ui.spinning = false;
      ui.drop = won;
      if (!state.found[won.id]) { ui.drop.isNew = true; }
      discover(won.id);
      progress();
      save();
      if (ui.tab === 'cases') renderDrop();
    }, 3600);
  }
  function renderDrop() {
    const d = ui.drop;
    const it = BY_ID[d.id];
    const quick = nice(d.value * QUICK);
    view.innerHTML = `<div class="drop"><h2>${d.isNew ? 'Новая вещь в коллекции' : 'Выпало'}</h2>${cardHTML(d)}
      <div class="drop-side"><div class="row2" style="margin-top:14px"><button class="btn deal" id="take" type="button">Забрать</button>
      <button class="btn ghost" id="quick" type="button">Продать сразу<span class="sub">${money(quick)}</span></button></div>
      <p class="hint">Цена рынка ${money(d.value)}. Выставите вещь на продажу, и покупатели предложат больше, чем при продаже сразу.</p></div></div>`;
    const done = () => {
      ui.drop = null; save(); renderCases();
      // Полноэкранная реклама — изредка, в паузе между кейсами; частоту дополнительно держит площадка.
      if (state.stats.opened % 5 === 0) fullscreenAd();
    };
    $('take').onclick = () => { delete d.isNew; state.inv.unshift(d); toast(`«${it.title}» в инвентаре`); done(); };
    $('quick').onclick = () => { addMoney(quick); done(); };
  }

  // Инвентарь и продажа
  function renderInv() {
    if (ui.item) return renderItem();
    setTitle('Инвентарь');
    if (!state.inv.length) {
      view.innerHTML = `<div class="empty">Здесь будут ваши вещи. Откройте кейс или купите что-нибудь на барахолке.
        <button class="btn me" type="button" id="toCases">К кейсам</button></div>`;
      $('toCases').onclick = () => go('cases');
      return;
    }
    view.innerHTML = `<div class="cards">${state.inv.map((t) => cardHTML(t, `data-uid="${t.uid}"`)).join('')}</div>`;
    view.querySelector('.cards').onclick = (e) => {
      const c = e.target.closest('[data-uid]');
      if (c) { ui.item = Number(c.dataset.uid); renderItem(); }
    };
  }
  function renderItem() {
    const thing = state.inv.find((t) => t.uid === ui.item);
    if (!thing) { ui.item = null; return renderInv(); }
    const it = BY_ID[thing.id];
    setTitle(it.title, true);
    let ratio = ui.ratio || 1.1;
    const fix = repairOf(thing, skill('repair'));
    const full = state.listings.length >= slots();
    view.innerHTML = `<div class="item">
      <div class="item-head">${ph(thing.id)}<div><b>${it.title}</b><span>${condOf(thing).label}, цена рынка ${money(thing.value)}</span>
        <div class="tags"><span class="tag t${it.tier}">${TIER_NAMES[it.tier]}</span>${thing.fake ? '<span class="tag bad">подделка</span>' : ''}</div></div></div>
      <div class="item-side"><div class="sell">
        <div class="lbl">Ваша цена</div>
        <div class="ask" id="ask"></div>
        <div class="wait" id="wait"></div>
        <div class="range" id="range" style="--g:33.3%;--y:53.3%"><div class="track"></div><div class="knob" id="knob"></div></div>
        <div class="scale"><span>купят быстро</span><span>долго ждать</span></div>
        <button class="btn deal" id="list" type="button" style="margin-top:14px" ${full ? 'disabled' : ''}>Выставить на продажу</button>
        ${full ? `<p class="hint">Все ${slots()} ${forms(slots(), ['место', 'места', 'мест'])} для объявлений заняты. Продайте что-нибудь или снимите объявление.</p>` : ''}
      </div>
      ${fix ? `<button class="btn ghost" id="repair" type="button" style="margin-top:10px" ${state.money < fix.cost ? 'disabled' : ''}>Починить до «${fix.label}» за ${money(fix.cost)}<span class="sub">цена станет ${money(fix.value)}, риск сломать ${Math.round(fix.chance * 100)} %</span></button>` : ''}
      <button class="btn ghost" id="quick" type="button" style="margin-top:10px">Продать сразу за ${money(nice(thing.value * QUICK))}${thing.cond === 'broken' ? '<span class="sub">на запчасти</span>' : ''}</button></div></div>`;
    const MIN = 0.5, MAX = 2.0;
    const ask = () => nice(thing.value * ratio);
    const paint = () => {
      $('knob').style.left = `${((ratio - MIN) / (MAX - MIN)) * 100}%`;
      $('ask').textContent = money(ask());
      const p = Math.round((ratio - 1) * 100);
      const w = Math.round(waitFor(ratio) / 1000);
      $('wait').textContent = `${p === 0 ? 'по цене рынка' : p > 0 ? `на ${p}% дороже рынка` : `на ${-p}% дешевле рынка`}, покупатель придёт примерно через ${w < 60 ? `${w} с` : `${Math.round(w / 60)} мин`}`;
      $('wait').style.color = ratio <= 1 ? 'var(--deal)' : ratio <= 1.3 ? 'var(--gold)' : 'var(--warn)';
    };
    const range = $('range');
    const setFrom = (x) => {
      const r = range.getBoundingClientRect();
      ratio = MIN + Math.min(1, Math.max(0, (x - r.left) / r.width)) * (MAX - MIN);
      ratio = Math.round(ratio * 20) / 20;
      ui.ratio = ratio;
      paint();
    };
    range.onpointerdown = (e) => {
      range.setPointerCapture(e.pointerId); setFrom(e.clientX);
      range.onpointermove = (ev) => setFrom(ev.clientX);
      range.onpointerup = () => { range.onpointermove = null; };
    };
    paint();
    $('list').onclick = () => {
      state.inv = state.inv.filter((t) => t !== thing);
      state.listings.push({ item: thing, ask: ask(), at: now(), buyerAt: now() + waitFor(ratio) * speedOf(state.up), chat: null });
      ui.item = null; ui.ratio = null; save();
      toast(`Объявление «${it.title}»: ${money(ask())}`);
      go('sales');
    };
    $('quick').onclick = () => {
      state.inv = state.inv.filter((t) => t !== thing);
      ui.item = null; addMoney(nice(thing.value * QUICK)); renderInv();
    };
    // Ремонт с риском: не повезло — вещь на ступень хуже, деньги потрачены.
    if ($('repair')) $('repair').onclick = () => {
      if (state.money < fix.cost) return;
      addMoney(-fix.cost);
      if (Math.random() < fix.chance) {
        thing.cond = fix.fail.cond; thing.value = fix.fail.value;
        state.stats.repairFail += 1;
        toast(`Ремонт не удался: «${it.title}» теперь ${fix.fail.label}. Навык «Починка» снижает риск.`, () => go('seller'));
      } else {
        thing.cond = fix.cond; thing.value = fix.value;
        state.stats.repaired += 1;
        quest('repair');
        toast(`«${it.title}» теперь ${fix.label}`);
      }
      progress(); save(); renderItem();
    };
  }

  // Мои продажи
  function renderSales() {
    setTitle('Мои продажи');
    if (!state.listings.length) {
      view.innerHTML = sellerBanner() + `<div class="empty">Объявлений пока нет. Выберите вещь в инвентаре и назначьте цену.
        <button class="btn me" type="button" id="toInv">В инвентарь</button></div>`;
      $('toInv').onclick = () => go('inv');
      return;
    }
    view.innerHTML = sellerBanner() + `<p class="sec">Объявлений ${state.listings.length} из ${slots()}</p><div class="listings">` + state.listings.map((l) => {
      const it = BY_ID[l.item.id];
      return `<div class="listing" data-uid="${l.item.uid}">${ph(l.item.id)}
        <div class="info"><b>${it.title}</b><span>Цена ${money(l.ask)}</span><span>рынок ${money(l.item.value)}</span>
          ${l.chat ? '<span style="color:var(--me)">Есть покупатель</span>' : `<div class="bar-wait"><i data-bar="${l.item.uid}"></i></div>`}</div>
        <div class="acts">${l.chat ? `<button class="btn me" type="button" data-open="${l.chat}">Ответить</button>`
          : `<button class="btn ghost" type="button" data-now="${l.item.uid}">Позвать сейчас<span class="sub">за рекламу</span></button>`}
          <button class="btn ghost" type="button" data-off="${l.item.uid}">Снять</button></div></div>`;
    }).join('') + '</div>';
    paintBars();
    view.onclick = async (e) => {
      const t = e.target.closest('button');
      if (!t || ui.tab !== 'sales') return;
      if (t.dataset.open) { ui.tab = 'chats'; markNav('chats'); ui.chat = Number(t.dataset.open); return renderChat(); }
      const uid = Number(t.dataset.now || t.dataset.off);
      const l = state.listings.find((x) => x.item.uid === uid);
      if (!l) return;
      if (t.dataset.off) {
        state.listings = state.listings.filter((x) => x !== l);
        state.inv.unshift(l.item);
        save(); return renderSales();
      }
      t.disabled = true;
      if (await rewardedAd() && !l.chat && state.listings.includes(l)) arrive(l);
      if (ui.tab === 'sales') renderSales();
    };
  }
  function paintBars() {
    for (const el of view.querySelectorAll('[data-bar]')) {
      const l = state.listings.find((x) => x.item.uid === Number(el.dataset.bar));
      if (!l) continue;
      const total = l.buyerAt - l.at;
      el.style.width = `${Math.min(100, ((now() - l.at) / total) * 100)}%`;
    }
  }

  // Переписки
  const labelOf = (c) => (c.type === 'scammer' && skill('sense') >= 1 ? 'похоже на мошенника' : T.types[c.type].label);
  function renderChats() {
    if (ui.chat) return renderChat();
    setTitle('Переписки');
    const list = state.chats.filter((c) => c.state === 'open' || now() - c.at < 30 * 60 * 1000);
    if (!list.length) {
      view.innerHTML = '<div class="empty">Покупатели напишут сюда, когда вы выставите вещь на продажу.</div>';
      return;
    }
    view.innerHTML = list.map((c) => {
      const last = c.msgs[c.msgs.length - 1];
      return `<button class="thread" type="button" data-chat="${c.id}"><span class="ava" style="background:${c.color}">${c.name[0]}</span>
        <span class="who"><b>${c.name}<em class="${c.type === 'scammer' && skill('sense') >= 1 ? 'bad' : ''}">${labelOf(c)}</em></b><span>${last.who === 'mine' ? 'Вы: ' : ''}${last.text}</span></span>${c.unread ? '<i class="new"></i>' : ''}</button>`;
    }).join('');
    view.onclick = (e) => {
      const t = e.target.closest('[data-chat]');
      if (t && ui.tab === 'chats') { ui.chat = Number(t.dataset.chat); renderChat(); }
    };
  }
  const moodWord = (m) => (m >= 70 ? 'отличное' : m >= 55 ? 'хорошее' : m >= 40 ? 'обычное' : m >= 25 ? 'так себе' : 'плохое');
  function renderChat() {
    const c = state.chats.find((x) => x.id === ui.chat);
    if (!c) { ui.chat = null; return renderChats(); }
    c.unread = false; updateDot();
    const l = listingOf(c);
    const thingId = l ? l.item.id : null;
    setTitle('Переписка', true);
    const goods = thingId ? `<span class="goods${isFull(thingId) ? ' full' : ''}"><img src="img/${thingId}.webp" alt=""><span>${money(l.ask)}</span></span>` : '';
    // Под шапкой: настроение покупателя, цена рынка и, с навыком «Оценщик», его примерный потолок.
    let info = '';
    if (l && c.state === 'open' && c.max) {
      const err = appraiseErr(skill('appraise'));
      const est = err == null ? null : nice(effMax(c) * (1 + c.noise * err));
      info = `<div class="chat-info"><span class="mood" style="--m:${Math.max(0, Math.min(100, c.mood))}%"><i></i></span><span>Настроение ${moodWord(c.mood)}</span>
        <span>рынок ${money(l.item.value)}</span>${est ? `<span class="est">потолок около ${money(est)}</span>` : ''}</div>`;
    }
    let replies = '';
    if (c.state === 'open' && !c.waiting && !c.typing && l) {
      if (c.phase === 'troll') {
        replies = `<button class="btn white" data-a="joke">${T.me.joke}</button><button class="btn white" data-a="block">Заблокировать</button>`;
      } else if (c.phase === 'scam') {
        replies = `<button class="btn white" data-a="send">Отправить курьером</button><button class="btn white" data-a="meet">Только при встрече, наличными</button>
          <button class="btn white" data-a="block">Заблокировать</button>`;
      } else if (c.phase === 'q') {
        const v = vars(c, l);
        replies = T.questions[c.q].answers.map(([id, text]) => `<button class="btn white" data-a="ans:${id}">${say(text, v)}</button>`).join('');
      } else {
        // Варианты цены считаются от предложения и цены объявления, повторы и бессмысленные убираем.
        const ask = l.ask, offer = c.offer;
        const opts = [];
        const concede = nice(ask * 0.95), mid = nice((offer + ask) / 2);
        if (concede > offer * 1.02 && concede < ask) opts.push(['concede', concede, `Уступить 5 %: ${money(concede)}`]);
        if (ask >= offer * 1.08 && mid > offer && mid < ask && mid < concede * 0.98) opts.push(['counter', mid, `Посередине: ${money(mid)}`]);
        if (offer < ask * 0.98) opts.push(['firm', ask, `Стою на своём: ${money(ask)}`]);
        if (!c.bluffed && offer < ask * 0.98) opts.push(['bluff', 0, 'Есть ещё покупатель']);
        replies = `<button class="btn deal" data-a="yes">Продать за ${money(offer)}</button>
          <div class="haggle">${opts.map(([a, p, text]) => `<button class="btn white" data-a="${a}" data-p="${p}">${text}</button>`).join('')}</div>
          <button class="btn ghost small" data-a="no">Отказаться</button>`;
      }
    } else if (c.state !== 'open') {
      replies = `<button class="btn ghost" data-go="${c.state === 'done' ? 'cases' : 'sales'}">${c.state === 'done' ? 'К кейсам' : 'К продажам'}</button>`;
    }
    view.innerHTML = `<div class="chat"><div class="chat-head"><span class="ava" style="background:${c.color}">${c.name[0]}</span>
      <span class="who"><b>${c.name}</b><span class="${c.type === 'scammer' && skill('sense') >= 1 ? 'bad' : ''}">${labelOf(c)}</span></span>${goods}</div>${info}
      <div class="msgs">${c.msgs.map((m) => `<div class="m ${m.who}">${m.text}</div>`).join('')}${c.typing ? '<div class="typing">печатает…</div>' : ''}</div>
      <div class="replies">${replies}</div></div>`;
    view.scrollTop = view.scrollHeight;
    view.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || ui.tab !== 'chats') return;
      if (b.dataset.go) return go(b.dataset.go);
      if (b.dataset.a) answer(c, b.dataset.a, Number(b.dataset.p) || 0);
    };
  }
  function rerenderChat(chat) { if (ui.tab === 'chats' && ui.chat === chat.id) renderChat(); else if (ui.tab === 'chats' && !ui.chat) renderChats(); }

  // Продавец: уровень от сделок, навыки за рекламу VK, улучшения за деньги. Плашка — над объявлениями.
  function sellerBanner() {
    const r = rank();
    const next = RANKS[r];
    const free = ptsFree();
    return `<button class="seller-bar" type="button" data-to="seller"><span class="stars">${'<i class="on"></i>'.repeat(r)}${'<i></i>'.repeat(RANKS.length - r)}</span>
      <span><b>Продавец, уровень ${r}</b><span>${next != null ? `До следующего ${next - state.stats.sold} ${forms(next - state.stats.sold, ['сделка', 'сделки', 'сделок'])}` : 'Высший уровень'}</span></span>
      <span class="more">${free > 0 ? `Очков: ${free}` : 'Прокачка'}</span></button>`;
  }
  function renderSeller() {
    setTitle('Прокачка', true);
    const r = rank();
    const unlocks = { flea: 'барахолка', shop: 'лавка', orders: 'заказы', auction: 'аукцион' };
    const opens = Object.entries(MARKET_RANK).filter(([, x]) => x > r).map(([k, x]) => `${unlocks[k]} на ${x}-м`).join(', ');
    const free = ptsFree();
    view.innerHTML = sellerBanner().replace('data-to="seller"', 'disabled') +
      `<p class="hint">Каждый уровень продавца даёт +1 % к предложениям покупателей (сейчас +${r - 1} %).${opens ? ` Откроются: ${opens} уровне.` : ''}</p>
      <h3 class="h3">Навыки</h3>
      <div class="pts"><div><b>${free}</b> ${forms(free, ['очко', 'очка', 'очков'])} навыков</div>
        <p class="hint">Очко даёт каждый показ рекламы сети VK: за награду и между кейсами. Если сети нечего показать и вместо рекламы открылась заставка Gamely, очко не засчитывается.</p>
        <button class="btn me" id="adPt" type="button">Смотреть рекламу: +1 очко</button></div>
      <div class="ups">${Object.entries(SKILLS).map(([id, s]) => {
        const lvl = skill(id), max = s.text.length, cost = skillCost(lvl + 1);
        return `<div class="up"><div class="up-top"><b>${s.title}</b><span class="pips">${s.text.map((_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span></div>
          <p class="hint">${lvl ? `Сейчас: ${s.text[lvl - 1]}.` : 'Не открыт.'}${lvl < max ? ` Дальше: ${s.text[lvl]}.` : ''}</p>
          ${lvl >= max ? '<p class="hint" style="color:var(--deal)">Прокачано до предела</p>'
            : `<button class="btn deal" type="button" data-skill="${id}" ${free < cost ? 'disabled' : ''}>Открыть уровень ${lvl + 1} за ${cost} ${forms(cost, ['очко', 'очка', 'очков'])}</button>`}</div>`;
      }).join('')}</div>
      <h3 class="h3">Улучшения за деньги</h3>
      <div class="ups">${Object.entries(UPGRADES).map(([id, u]) => {
        const lvl = state.up[id] || 0, max = u.cost.length;
        const cost = u.cost[lvl];
        const locked = lvl < max && r <= lvl;
        return `<div class="up"><div class="up-top"><b>${u.title}</b><span class="pips">${Array.from({ length: max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span></div>
          <p class="hint">${u.text}</p>
          ${lvl >= max ? '<p class="hint" style="color:var(--deal)">Прокачано до предела</p>'
            : locked ? `<button class="btn ghost" type="button" disabled>Нужен уровень продавца ${lvl + 1}</button>`
            : `<button class="btn deal" type="button" data-up="${id}" ${state.money < cost ? 'disabled' : ''}>Улучшить за ${money(cost)}</button>`}</div>`;
      }).join('')}</div>`;
    $('adPt').onclick = async () => {
      $('adPt').disabled = true;
      const before = state.adPts;
      await rewardedAd();
      if (state.adPts === before) toast('Сейчас у сети VK нет рекламы, очко не засчитано. Попробуйте позже.');
      if (ui.tab === 'seller') renderSeller();
    };
    view.onclick = (e) => {
      const s = e.target.closest('[data-skill]');
      if (s) {
        const id = s.dataset.skill, lvl = skill(id), cost = skillCost(lvl + 1);
        if (lvl >= SKILLS[id].text.length || ptsFree() < cost) return;
        state.skills[id] = lvl + 1;
        toast(`${SKILLS[id].title}: уровень ${lvl + 1}`);
        progress(); save(); return renderSeller();
      }
      const b = e.target.closest('[data-up]');
      if (!b) return;
      const id = b.dataset.up, lvl = state.up[id] || 0, cost = UPGRADES[id].cost[lvl];
      if (cost == null || state.money < cost || rank() <= lvl) return;
      addMoney(-cost);
      state.up[id] = lvl + 1;
      toast(`${UPGRADES[id].title}: уровень ${lvl + 1}`);
      save(); renderSeller();
    };
  }

  // Подарок дня и задания дня
  function renderGift() {
    setTitle('Подарок и задания', true);
    const g = giftState();
    const best = state.stats.best;
    const q = quests();
    const allDone = q.list.every((x) => x.got);
    view.innerHTML = `<h3 class="h3">Задания дня</h3>
      <div class="quests">${q.list.map((x, i) => `<div class="quest${x.got ? ' got' : ''}"><span><b>${questText(x)}</b>
        <span class="bar-wait"><i style="width:${(x.have / x.n) * 100}%"></i></span><small>${x.have} из ${x.n}</small></span>
        ${x.got ? '<em>получено</em>' : `<button class="btn deal" type="button" data-q="${i}" ${x.have < x.n ? 'disabled' : ''}>${money(questReward(best))}</button>`}</div>`).join('')}</div>
      <p class="hint">За все три задания ещё ${money(questBonus(best))}. ${q.bonus ? 'Уже получено.' : allDone ? '' : 'Новые задания завтра.'}</p>
      ${allDone && !q.bonus ? `<button class="btn deal" id="qBonus" type="button">Забрать ${money(questBonus(best))}</button>` : ''}
      <h3 class="h3">Подарок дня</h3>
      <p class="hint">Заходите каждый день: подарок растёт, на седьмой день самый большой. Пропустите день — серия начнётся заново.</p>
      <div class="days">${Array.from({ length: 7 }, (_, i) => {
        const day = i + 1;
        const cls = g.ready ? (day < g.day ? 'got' : day === g.day ? 'now' : '') : (day <= g.day ? 'got' : '');
        return `<div class="day ${cls}${day === 7 ? ' big' : ''}"><span>День ${day}</span><b>${money(dailyGift(day, best))}</b></div>`;
      }).join('')}</div>
      ${g.ready ? `<button class="btn deal" id="take" type="button">Забрать ${money(dailyGift(g.day, best))}</button>
        <button class="btn ghost" id="double" type="button" style="margin-top:10px">Забрать вдвое: ${money(dailyGift(g.day, best) * 2)}<span class="sub">за рекламу</span></button>`
        : '<p class="hint" style="text-align:center;margin-top:16px">Сегодняшний подарок уже у вас. Следующий завтра.</p>'}`;
    view.onclick = (e) => {
      const b = e.target.closest('[data-q]');
      if (!b) return;
      const x = q.list[Number(b.dataset.q)];
      if (x.got || x.have < x.n) return;
      x.got = true;
      addMoney(questReward(best));
      toast(`Задание: +${money(questReward(best))}`);
      updateDot(); save(); renderGift();
    };
    if ($('qBonus')) $('qBonus').onclick = () => {
      if (q.bonus) return;
      q.bonus = true;
      addMoney(questBonus(best));
      toast(`Все задания дня: +${money(questBonus(best))}`);
      updateDot(); save(); renderGift();
    };
    if (!g.ready) return;
    const claim = (k) => {
      const v = dailyGift(g.day, best) * k;
      state.daily = { last: dayKey(now()), day: g.day, best: Math.max(state.daily.best || 0, g.day) };
      addMoney(v);
      toast(`Подарок дня: +${money(v)}`);
      progress(); save(); renderGift();
    };
    $('take').onclick = () => claim(1);
    $('double').onclick = async () => {
      $('double').disabled = true;
      const ok = await rewardedAd();
      if (giftState().ready) claim(ok ? 2 : 1);
    };
  }

  // Коллекция: полки по уровням вещей (название — основной кейс уровня), найденное — цветом, остальное — силуэтом.
  function renderAlbum() {
    const n = Object.keys(state.found).length;
    setTitle('Коллекция', true);
    view.innerHTML = `<p class="sec">Найдено ${n} из ${ITEMS.length}. Соберите все вещи уровня, чтобы получить награду за полку.</p>` + [1, 2, 3, 4, 5, 6].map((tier) => {
      const c = caseOfTier(tier);
      const pool = ITEMS.filter((i) => i.tier === tier);
      const got = pool.filter((i) => state.found[i.id]).length;
      return `<section class="shelf"><div class="shelf-top"><b>${c.title}</b><span>${got} из ${pool.length}</span>
        <span class="tag ${state.shelves[tier] ? 't3' : 'c'}">${state.shelves[tier] ? 'награда получена' : `за полку ${money(shelfReward(tier))}`}</span></div>
        <div class="shelf-grid">${pool.map((i) => `<div class="slot${state.found[i.id] ? '' : ' no'}${i.full ? ' full' : ''}" title="${state.found[i.id] ? i.title : 'Ещё не найдено'}">
          <img src="img/${i.id}.webp" alt="" draggable="false" loading="lazy"><span>${state.found[i.id] ? i.title : '?'}</span></div>`).join('')}</div></section>`;
    }).join('');
  }

  // Рейтинг: три таблицы сайта и достижения.
  async function renderTop() {
    setTitle('Рейтинг', true);
    ui.board ||= 'rich';
    const seg = `<div class="seg">${BOARDS.map((b) => `<button type="button" data-b="${b.id}" class="${ui.board === b.id ? 'on' : ''}">${b.title}</button>`).join('')}
      <button type="button" data-b="ach" class="${ui.board === 'ach' ? 'on' : ''}">Достижения</button></div>`;
    view.onclick = (e) => { const b = e.target.closest('[data-b]'); if (b) { ui.board = b.dataset.b; renderTop(); } };
    if (ui.board === 'ach') {
      const done = ACHIEVEMENTS.filter((a) => state.ach[a.id]).length;
      view.innerHTML = seg + `<p class="sec">Получено ${done} из ${ACHIEVEMENTS.length}. Награда за каждое — половина цены кейса, до которого вы доросли.</p>
        <div class="achs">${ACHIEVEMENTS.map((a) => {
          const have = Math.min(a.of(state), a.n), ok = !!state.ach[a.id];
          return `<div class="ach${ok ? ' ok' : ''}"><i class="medal"></i><span><b>${a.title}</b><span>${a.text}</span>
            ${ok ? '' : a.n > 1 && a.n <= 1000 ? `<span class="bar-wait"><i style="width:${(have / a.n) * 100}%"></i></span>` : ''}</span></div>`;
        }).join('')}</div>`;
      return;
    }
    const b = BOARDS.find((x) => x.id === ui.board);
    view.innerHTML = seg + `<p class="sec">Ваш результат: ${b.fmt(b.of())}</p><div class="lb" id="lb"><p class="hint">Загружаем таблицу…</p></div>`;
    const box = $('lb');
    if (!sdk || !sdk.leaderboard) { box.innerHTML = '<p class="hint">Таблицы лидеров работают на сайте Gamely.</p>'; return; }
    if (sdk.player && sdk.player.anonymous) box.insertAdjacentHTML('beforebegin', '<p class="hint">Войдите в аккаунт Gamely, чтобы попасть в таблицу.</p>');
    // Свежий результат — сразу, не дожидаясь отложенной отправки.
    const v = b.of();
    if (v > 0 && !(sdk.player && sdk.player.anonymous)) { sentBoards[b.id] = v; await sdk.leaderboard.setScore(v, { board: b.id }).catch(() => {}); }
    let r = null;
    try { r = await sdk.leaderboard.getEntries({ board: b.id, top: 10, around: 1 }); } catch (e) { r = null; }
    if (ui.tab !== 'top' || ui.board !== b.id) return;
    const rows = r && r.entries ? r.entries : [];
    box.innerHTML = rows.length ? `<ol>${rows.map((e) => `<li class="${e.me ? 'me' : ''}"><span class="r">${e.rank}</span><span class="n">${esc(e.name)}</span><span class="s">${b.fmt(e.score)}</span></li>`).join('')}</ol>`
      + (r.me && !rows.some((e) => e.me) ? `<p class="sec">Вы на ${r.me.rank} месте</p>` : '')
      : '<p class="hint">В таблице пока никого. Ваш результат будет первым.</p>';
  }

  // Общие мелочи. Уведомление можно нажать: откроется то, о чём оно (переписка, задания, прокачка).
  let toastTimer = 0, toastTap = null;
  function toast(text, onTap) {
    const t = $('toast');
    t.textContent = text;
    toastTap = onTap || null;
    t.classList.toggle('tap', !!onTap);
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), onTap ? 3600 : 2600);
  }
  $('toast').onclick = () => {
    $('toast').classList.add('hidden');
    if (toastTap && !ui.spinning) { const f = toastTap; toastTap = null; f(); }
  };
  function updateDot() {
    const n = state.chats.filter((c) => c.unread && c.state === 'open').length;
    const d = $('chatDot');
    d.textContent = n;
    d.classList.toggle('hidden', !n);
    const q = state.quests && state.quests.day === dayKey(now()) ? state.quests : null;
    const questReady = q && (q.list.some((x) => !x.got && x.have >= x.n) || (q.list.every((x) => x.got) && !q.bonus));
    $('giftDot').classList.toggle('hidden', !giftState().ready && !questReady);
    if ($('marketDot')) $('marketDot').classList.toggle('hidden', !market.attention());
  }
  function markNav(tab) { for (const b of document.querySelectorAll('#nav [data-tab]')) b.classList.toggle('on', b.dataset.tab === tab); }
  $('nav').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b && !ui.spinning) go(b.dataset.tab); };
  $('back').onclick = () => {
    if (EXTRA.includes(ui.tab) && !ui.item && !ui.chat) return go(ui.prev || 'cases');
    ui.item = null; ui.chat = null; ui.ratio = null; render();
  };
  // Кнопки сверху (подарок, коллекция, рейтинг) и ссылки на экраны внутри вида: data-go / data-to.
  document.querySelector('.bar').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b && !ui.spinning) go(ui.tab === b.dataset.go ? ui.prev || 'cases' : b.dataset.go); });
  view.addEventListener('click', (e) => { const b = e.target.closest('[data-to]'); if (b && !b.disabled) go(b.dataset.to); });

  // Рынок (js/market.js) получает доступ к состоянию и общим помощникам.
  const G = {
    get state() { return state; }, get sdk() { return sdk; }, ui, view, $, rnd, pick, now, weighted, money, forms, esc, nice,
    BY_ID, ITEMS, E, makeThing, condOf, condTag, ph, cardHTML, setTitle, toast, addMoney, save, progress, quest, go,
    rewardedAd, skill, rank, updateDot, render,
  };
  const market = window.PerekupMarket(G);

  // Покупатели приходят по таймеру — и пока игрок в другой вкладке игры, и после возвращения в игру.
  setInterval(() => {
    for (const l of state.listings) if (!l.chat && l.buyerAt <= now()) arrive(l);
    if (ui.tab === 'sales') {
      if (state.listings.some((l) => l.chat && !view.querySelector(`[data-open="${l.chat}"]`))) renderSales(); else paintBars();
    }
    if (ui.tab === 'chats' && !ui.chat) renderChats();
    market.tick();
  }, 500);

  // ---------- старт ----------
  async function start() {
    try { sdk = await window.Gamely.init(); } catch (e) { sdk = null; }
    try {
      const saved = sdk && await sdk.data.get();
      if (saved && saved.v === 1) {
        const f0 = fresh();
        state = { ...f0, ...saved, stats: { ...f0.stats, ...saved.stats }, daily: { ...f0.daily, ...saved.daily },
          shop: { ...f0.shop, ...saved.shop }, market: { ...f0.market, ...saved.market } };
      }
    } catch (e) { /* без сохранения — новая игра */ }
    // Сохранения до коллекции: найденным считаем то, что лежит в инвентаре и в объявлениях.
    for (const t of [...state.inv, ...state.listings.map((l) => l.item)]) if (BY_ID[t.id]) state.found[t.id] = true;
    // Вещи, которых больше нет в игре (на случай правок списка), из инвентаря убираем.
    state.inv = state.inv.filter((t) => BY_ID[t.id]);
    state.listings = state.listings.filter((l) => BY_ID[l.item.id]);
    // Переписки, которые оборвались на «печатает…», при загрузке просто ждут ответа игрока.
    // Старые переписки (до вопросов и настроения) — сразу к торгу, с обычным настроением.
    for (const c of state.chats) {
      c.typing = false; c.waiting = false;
      if (!c.phase) { c.phase = c.type === 'troll' ? 'troll' : 'bargain'; c.mood ??= 50; c.max ??= c.maxPay; c.noise ??= 0; }
    }
    if (!CASES.some((c) => c.id === state.kase)) state.kase = 'junk';
    // Рекорд денег не меньше того, что на руках (в старых сохранениях стартовая тысяча в него не попадала).
    state.stats.best = Math.max(state.stats.best || 0, state.money);
    $('money').textContent = money(state.money);
    market.start();
    updateDot();
    go('cases');
    progress();
    if (giftState().ready) toast('Подарок дня ждёт: кнопка с подарком сверху', () => go('gift'));
    sdk && sdk.game.ready();
  }
  start();
})();
