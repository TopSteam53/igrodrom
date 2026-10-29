// «Перекуп: от хлама до клада». Кейс → вещь → объявление → покупатель в переписке → торг → деньги → кейс дороже.
// Не хватает денег — «Работа»: кликер по компьютеру. Сохранения и реклама за награду — через Gamely SDK.
'use strict';
(function () {
  const ITEMS = window.ITEMS;
  const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
  const T = window.TALK;
  const $ = (id) => document.getElementById(id);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const now = () => Date.now();

  const { WORK, workEnergyMax, workClickCost, CASES, weightOf, TIER_NAMES, CONDITIONS, BUYERS, QUICK, MAX_LISTINGS, START_MONEY, AVA, workIncome, workCost, waitFor, nice } = window.PEREKUP_ECON;

  function weighted(entries) {
    const total = entries.reduce((n, [, w]) => n + w, 0);
    let r = Math.random() * total;
    for (const [v, w] of entries) { if ((r -= w) <= 0) return v; }
    return entries[entries.length - 1][0];
  }
  function money(n) {
    const sp = (x) => Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const dec = (x) => (x < 10 ? x.toFixed(1).replace('.', ',').replace(',0', '') : sp(x));
    if (n >= 1e9) return `${dec(n / 1e9)} млрд ₽`;
    if (n >= 1e6) return `${dec(n / 1e6)} млн ₽`;
    return `${sp(n)} ₽`;
  }
  const forms = (n, [one, few, many]) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
  const say = (tpl, v) => tpl.replace(/\[([^|\]]*)\|([^\]]*)\]/g, (_, m, f) => (v.f ? f : m)).replace(/\{(\w+)\}/g, (_, k) => (k === 'item' ? `«${v.item}»` : money(v[k])));

  // Вещь из кейса: уровень по шансам, внутри уровня дешёвые выпадают чаще, состояние меняет цену.
  function rollItem(kase) {
    const tier = Number(weighted(Object.entries(kase.odds).map(([t, w]) => [t, w])));
    const pool = ITEMS.filter((i) => i.tier === tier);
    const it = weighted(pool.map((i) => [i, weightOf(i)]));
    const cond = weighted(CONDITIONS.map((c) => [c, c.w]));
    return { uid: state.seq++, id: it.id, cond: cond.id, value: nice(it.price * cond.k * rnd(0.92, 1.08)) };
  }
  const condOf = (thing) => CONDITIONS.find((c) => c.id === thing.cond);

  // ---------- сохранение ----------
  let sdk = null;
  let state = fresh();
  function fresh() {
    return { v: 1, money: START_MONEY, inv: [], listings: [], chats: [], work: { level: 1 }, seq: 1, kase: 'junk',
      stats: { opened: 0, sold: 0, earned: 0, best: 0 } };
  }
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

  // ---------- покупатели ----------
  function arrive(listing) {
    const type = weighted(Object.entries(BUYERS).map(([k, b]) => [k, b.w]));
    const b = BUYERS[type];
    const item = BY_ID[listing.item.id];
    const market = listing.item.value;
    const f = Math.random() < 0.5;
    const chat = {
      id: state.seq++, listing: listing.item.uid, name: pick(f ? T.women : T.men), f, type, color: pick(AVA), msgs: [], state: 'open',
      unread: true, at: now(), patience: b.patience || 0,
      maxPay: type === 'troll' ? 0 : nice(market * rnd(b.max[0], b.max[1])),
    };
    chat.offer = type === 'troll' ? nice(market * rnd(0.05, 0.2)) : Math.min(listing.ask, nice(chat.maxPay * rnd(b.first[0], b.first[1])));
    const v = { item: item.title, offer: chat.offer, ask: listing.ask, f };
    chat.msgs.push({ who: 'them', text: say(pick(T.types[type].hello), v) });
    chat.msgs.push({ who: 'them', text: say(pick(T.types[type].offer), v) });
    listing.chat = chat.id;
    state.chats.unshift(chat);
    state.chats = state.chats.slice(0, 40);
    if (!(ui.tab === 'chats' && ui.chat === chat.id)) toast(`${chat.name}, объявление «${item.title}»: предлагает ${money(chat.offer)}`);
    else chat.unread = false;
    updateDot();
    save();
    return chat;
  }
  const listingOf = (chat) => state.listings.find((l) => l.item.uid === chat.listing);

  function sell(listing, price, chat) {
    state.listings = state.listings.filter((l) => l !== listing);
    state.stats.sold += 1;
    addMoney(price);
    if (chat) {
      chat.state = 'done';
      chat.msgs.push({ who: 'sys', text: `Продано за ${money(price)}` });
    }
  }
  // Покупатель ушёл: объявление остаётся, следующий придёт позже.
  function buyerGone(chat, soon) {
    chat.state = 'gone';
    const l = listingOf(chat);
    if (l) { l.chat = null; l.buyerAt = now() + (soon ? 3000 : waitFor(l.ask / l.item.value)); }
  }

  // Ответ игрока и реакция покупателя (с задержкой «печатает…»).
  function answer(chat, action, price) {
    const l = listingOf(chat);
    if (!l || chat.state !== 'open') return;
    const t = T.types[chat.type];
    const b = BUYERS[chat.type];
    const v = { item: BY_ID[l.item.id].title, offer: chat.offer, ask: l.ask, price, f: chat.f ?? T.women.includes(chat.name) };
    if (action === 'yes') {
      chat.msgs.push({ who: 'mine', text: say(T.me.yes, v) });
      chat.msgs.push({ who: 'them', text: pick(t.deal) });
      sell(l, chat.offer, chat);
      return afterChat(chat);
    }
    if (action === 'no') {
      chat.msgs.push({ who: 'mine', text: T.me.no });
      chat.msgs.push({ who: 'them', text: pick(t.decline) });
      buyerGone(chat);
      return afterChat(chat);
    }
    if (action === 'block') {
      chat.msgs.push({ who: 'sys', text: t.blocked });
      buyerGone(chat, true);
      return afterChat(chat);
    }
    if (action === 'joke') {
      chat.msgs.push({ who: 'mine', text: T.me.joke });
      typing(chat, () => { chat.msgs.push({ who: 'them', text: pick(t.leave) }); buyerGone(chat, true); });
      return afterChat(chat);
    }
    // Торг: counter — середина между предложением и ценой, firm — цена объявления (покупатель уступит меньше).
    chat.msgs.push({ who: 'mine', text: say(action === 'firm' ? T.me.firm : T.me.counter, v) });
    chat.waiting = true;
    afterChat(chat);
    typing(chat, () => {
      chat.waiting = false;
      if (b.bolt && Math.random() < b.bolt) { chat.msgs.push({ who: 'them', text: pick(t.leave) }); return buyerGone(chat); }
      if (price <= chat.maxPay && Math.random() < b.accept) {
        chat.msgs.push({ who: 'them', text: pick(t.deal) });
        return sell(l, price, chat);
      }
      chat.patience -= action === 'firm' ? 2 : 1;
      const ceiling = Math.min(chat.maxPay, price);
      const next = nice(chat.offer + (ceiling - chat.offer) * rnd(0.5, 0.8));
      if (chat.patience < 0 || next <= chat.offer) { chat.msgs.push({ who: 'them', text: pick(t.leave) }); return buyerGone(chat); }
      chat.offer = next;
      chat.msgs.push({ who: 'them', text: say(pick(t.raise), { ...v, offer: next }) });
    });
  }
  function typing(chat, then) {
    chat.typing = true;
    rerenderChat(chat);
    setTimeout(() => { chat.typing = false; then(); chat.at = now(); save(); rerenderChat(chat); updateDot(); }, rnd(900, 1700));
  }
  function afterChat(chat) { chat.at = now(); save(); rerenderChat(chat); updateDot(); }

  // ---------- интерфейс ----------
  const ui = { tab: 'cases', item: null, chat: null, drop: null, spinning: false };
  const view = $('view');
  const isFull = (id) => BY_ID[id].full;
  const ph = (id, cls = 'ph') => `<div class="${cls}${isFull(id) ? ' full' : ''}"><img src="img/${id}.webp" alt="" draggable="false"></div>`;
  function cardHTML(thing, attrs = '') {
    const it = BY_ID[thing.id];
    return `<button class="card" type="button" ${attrs}>${ph(thing.id)}<div class="tx"><div class="pr">${money(thing.value)}</div>
      <div class="nm">${it.title}</div><div class="tags"><span class="tag t${it.tier}">${TIER_NAMES[it.tier]}</span>
      <span class="tag c">${condOf(thing).label}</span></div></div></button>`;
  }
  function setTitle(text, back) {
    $('title').textContent = text;
    $('back').classList.toggle('hidden', !back);
  }
  function go(tab) {
    ui.tab = tab; ui.item = null; ui.chat = null;
    for (const b of document.querySelectorAll('#nav [data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
    render();
  }
  function render() {
    view.scrollTop = 0;
    ({ cases: renderCases, inv: renderInv, sales: renderSales, chats: renderChats, work: renderWork })[ui.tab]();
  }

  // Вещь для ленты барабана: редкие попадаются чаще, чем выпадают на деле (корень из шанса), но не через одну.
  function teaser(k) {
    const tier = Number(weighted(Object.entries(k.odds).map(([t, p]) => [t, Math.sqrt(p)])));
    return pick(ITEMS.filter((i) => i.tier === tier));
  }

  // Кейсы
  function renderCases() {
    setTitle('Кейсы');
    if (ui.drop) return renderDrop();
    const k = CASES.find((c) => c.id === state.kase) || CASES[0];
    const sample = Array.from({ length: 3 }, () => teaser(k));
    view.innerHTML = `<div class="cases">
      <div class="reel-wrap"><div class="reel" id="reel">${sample.map((i) => `<div class="it${i.full ? ' full' : ''}"><img src="img/${i.id}.webp" alt=""></div>`).join('')}</div><div class="reel-line"></div></div>
      <div class="cases-side"><div class="case-list">${CASES.map((c) => `<button class="case${c.id === k.id ? ' sel' : ''}" type="button" data-case="${c.id}"><b>${money(c.price)}</b>${c.title}</button>`).join('')}</div>
      <div class="odds">${Object.entries(k.odds).map(([t, p]) => `<span class="tag t${t}">${TIER_NAMES[t]} ${String(p).replace(".", ",")} %</span>`).join('')}</div>
      <div class="case-actions"><button class="btn deal" id="open" type="button" ${state.money < k.price ? 'disabled' : ''}>Открыть за ${money(k.price)}</button>
      ${state.money < k.price ? `<p class="hint">Не хватает ${money(k.price - state.money)}. Продайте вещи или подработайте во вкладке «Работа».</p>` : ''}</div></div></div>`;
    view.querySelector('.case-list').onclick = (e) => {
      const b = e.target.closest('[data-case]');
      if (!b || ui.spinning) return;
      state.kase = b.dataset.case; save(); renderCases();
    };
    $('open').onclick = () => openCase(k);
  }
  function openCase(k) {
    if (ui.spinning || state.money < k.price) return;
    ui.spinning = true;
    addMoney(-k.price);
    state.stats.opened += 1;
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
      save();
      if (ui.tab === 'cases') renderDrop();
    }, 3600);
  }
  function renderDrop() {
    const d = ui.drop;
    const it = BY_ID[d.id];
    const quick = nice(d.value * QUICK);
    view.innerHTML = `<div class="drop"><h2>Выпало</h2>${cardHTML(d)}
      <div class="drop-side"><div class="row2" style="margin-top:14px"><button class="btn deal" id="take" type="button">Забрать</button>
      <button class="btn ghost" id="quick" type="button">Продать сразу<span class="sub">${money(quick)}</span></button></div>
      <p class="hint">Цена рынка ${money(d.value)}. Выставите вещь на продажу, и покупатели предложат больше, чем при продаже сразу.</p></div></div>`;
    const done = () => {
      ui.drop = null; save(); renderCases();
      // Полноэкранная реклама — изредка, в паузе между кейсами; частоту дополнительно держит площадка.
      if (sdk && state.stats.opened % 5 === 0) sdk.ads.fullscreen().catch(() => {});
    };
    $('take').onclick = () => { state.inv.unshift(d); toast(`«${it.title}» в инвентаре`); done(); };
    $('quick').onclick = () => { addMoney(quick); done(); };
  }

  // Инвентарь и продажа
  function renderInv() {
    if (ui.item) return renderItem();
    setTitle('Инвентарь');
    if (!state.inv.length) {
      view.innerHTML = `<div class="empty">Здесь будут ваши вещи. Откройте кейс, заберите находку и выставьте её на продажу.
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
    const full = state.listings.length >= MAX_LISTINGS;
    view.innerHTML = `<div class="item">
      <div class="item-head">${ph(thing.id)}<div><b>${it.title}</b><span>${condOf(thing).label}, цена рынка ${money(thing.value)}</span>
        <div class="tags"><span class="tag t${it.tier}">${TIER_NAMES[it.tier]}</span></div></div></div>
      <div class="item-side"><div class="sell">
        <div class="lbl">Ваша цена</div>
        <div class="ask" id="ask"></div>
        <div class="wait" id="wait"></div>
        <div class="range" id="range" style="--g:33.3%;--y:53.3%"><div class="track"></div><div class="knob" id="knob"></div></div>
        <div class="scale"><span>купят быстро</span><span>долго ждать</span></div>
        <button class="btn deal" id="list" type="button" style="margin-top:14px" ${full ? 'disabled' : ''}>Выставить на продажу</button>
        ${full ? `<p class="hint">Все ${MAX_LISTINGS} места для объявлений заняты. Продайте что-нибудь или снимите объявление.</p>` : ''}
      </div>
      <button class="btn ghost" id="quick" type="button" style="margin-top:10px">Продать сразу за ${money(nice(thing.value * QUICK))}</button></div></div>`;
    const MIN = 0.5, MAX = 2.0;
    const ask = () => nice(thing.value * ratio);
    const paint = () => {
      $('knob').style.left = `${((ratio - MIN) / (MAX - MIN)) * 100}%`;
      $('ask').textContent = money(ask());
      const pct = Math.round((ratio - 1) * 100);
      const w = Math.round(waitFor(ratio) / 1000);
      $('wait').textContent = `${pct === 0 ? 'по цене рынка' : pct > 0 ? `на ${pct}% дороже рынка` : `на ${-pct}% дешевле рынка`}, покупатель придёт примерно через ${w < 60 ? `${w} с` : `${Math.round(w / 60)} мин`}`;
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
      state.listings.push({ item: thing, ask: ask(), at: now(), buyerAt: now() + waitFor(ratio), chat: null });
      ui.item = null; ui.ratio = null; save();
      toast(`Объявление «${it.title}»: ${money(ask())}`);
      go('sales');
    };
    $('quick').onclick = () => {
      state.inv = state.inv.filter((t) => t !== thing);
      ui.item = null; addMoney(nice(thing.value * QUICK)); renderInv();
    };
  }

  // Мои продажи
  function renderSales() {
    setTitle('Мои продажи');
    if (!state.listings.length) {
      view.innerHTML = `<div class="empty">Объявлений пока нет. Выберите вещь в инвентаре и назначьте цену.
        <button class="btn me" type="button" id="toInv">В инвентарь</button></div>`;
      $('toInv').onclick = () => go('inv');
      return;
    }
    view.innerHTML = `<p class="sec">Объявлений ${state.listings.length} из ${MAX_LISTINGS}</p><div class="listings">` + state.listings.map((l) => {
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
      const r = sdk ? await sdk.ads.rewarded() : { rewarded: true };
      if (r.rewarded && !l.chat && state.listings.includes(l)) arrive(l);
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
        <span class="who"><b>${c.name}</b><span>${last.who === 'mine' ? 'Вы: ' : ''}${last.text}</span></span>${c.unread ? '<i class="new"></i>' : ''}</button>`;
    }).join('');
    view.onclick = (e) => {
      const t = e.target.closest('[data-chat]');
      if (t && ui.tab === 'chats') { ui.chat = Number(t.dataset.chat); renderChat(); }
    };
  }
  function renderChat() {
    const c = state.chats.find((x) => x.id === ui.chat);
    if (!c) { ui.chat = null; return renderChats(); }
    c.unread = false; updateDot();
    const l = listingOf(c);
    const thingId = l ? l.item.id : null;
    setTitle('Переписка', true);
    const goods = thingId ? `<span class="goods${isFull(thingId) ? ' full' : ''}"><img src="img/${thingId}.webp" alt=""><span>${money(l.ask)}</span></span>` : '';
    let replies = '';
    if (c.state === 'open' && !c.waiting && !c.typing && l) {
      if (c.type === 'troll') {
        replies = `<button class="btn white" data-a="joke">${T.me.joke}</button><button class="btn white" data-a="block">Заблокировать</button>`;
      } else {
        const mid = nice((c.offer + l.ask) / 2);
        replies = `<button class="btn deal" data-a="yes">Продать за ${money(c.offer)}</button>` +
          (c.offer < l.ask * 0.98 ? `${mid > c.offer && mid < l.ask ? `<button class="btn white" data-a="counter" data-p="${mid}">Давайте ${money(mid)}</button>` : ''}
          <button class="btn white" data-a="firm" data-p="${l.ask}">Только за ${money(l.ask)}</button>` : '') +
          '<button class="btn white" data-a="no">Отказаться</button>';
      }
    } else if (c.state !== 'open') {
      replies = `<button class="btn ghost" data-go="${c.state === 'done' ? 'cases' : 'sales'}">${c.state === 'done' ? 'К кейсам' : 'К продажам'}</button>`;
    }
    view.innerHTML = `<div class="chat"><div class="chat-head"><span class="ava" style="background:${c.color}">${c.name[0]}</span>
      <span class="who"><b>${c.name}</b><span>${T.types[c.type].label}</span></span>${goods}</div>
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

  // Работа: силы считаем лениво — сколько было и когда, остальное добирается по времени.
  function energy() {
    const w = state.work;
    if (w.energy == null) { w.energy = workEnergyMax(w.level); w.at = now(); }
    return Math.min(workEnergyMax(w.level), w.energy + (now() - w.at) / WORK.regenMs);
  }
  function spendEnergy() {
    const e = energy();
    const need = workClickCost(state.work.level);
    if (e < need) return false;
    state.work.energy = e - need; state.work.at = now();
    return true;
  }
  let workTimer = 0;
  function renderWork() {
    setTitle('Работа');
    clearInterval(workTimer);
    const l = state.work.level;
    const top = l >= WORK.maxLevel;
    view.innerHTML = `<div class="work"><p class="hint">Жмите по ноутбуку и зарабатывайте</p>
      <button class="pc" id="pc" type="button" aria-label="Работать"><div class="card" style="width:240px;height:200px;display:grid;place-items:center">
        <img src="img/laptop.webp" alt="" draggable="false" style="width:200px;height:180px;object-fit:contain"></div></button>
      <div class="work-side"><div class="inc">Доход за клик <em>${money(workIncome(l))}</em></div>
      <div class="lvl">Уровень ${l} из ${WORK.maxLevel}, клик тратит ${workClickCost(l)} ${forms(workClickCost(l), ["силу", "силы", "сил"])}</div>
      <div class="energy"><div class="energy-top"><span>Силы</span><b id="en"></b></div><div class="bar-wait"><i id="enBar"></i></div>
        <p class="hint" id="enHint"></p></div>
      ${top ? '<p class="hint">Работа прокачана до предела. Дальше растите на перепродаже.</p>'
        : `<button class="btn deal" id="up" type="button" ${state.money < workCost(l) ? 'disabled' : ''}>Прокачать за ${money(workCost(l))}<span class="sub">${money(workIncome(l + 1))} за клик, ${workClickCost(l + 1)} ${forms(workClickCost(l + 1), ["сила", "силы", "сил"])} на клик</span></button>`}
      <button class="btn ghost" id="coffee" type="button">Кофе: силы сразу на максимум<span class="sub">за рекламу</span></button></div></div>`;
    const paintEnergy = () => {
      const max = workEnergyMax(state.work.level), need = workClickCost(state.work.level);
      const e = Math.floor(energy());
      $('en').textContent = `${e} из ${max}`;
      $('enBar').style.width = `${(e / max) * 100}%`;
      $('enBar').style.background = e < need ? 'var(--warn)' : 'var(--deal)';
      const left = Math.ceil(((max - energy()) * WORK.regenMs) / 1000);
      $('enHint').textContent = e < need ? `Перерыв. Силы для следующего клика вернутся через ${Math.ceil(((need - energy()) * WORK.regenMs) / 1000)} с`
        : e < max ? `Полностью восстановятся через ${left < 60 ? `${left} с` : `${Math.ceil(left / 60)} мин`}` : '';
      $('coffee').disabled = e >= max;
      if ($('up')) $('up').disabled = state.money < workCost(state.work.level);
    };
    paintEnergy();
    workTimer = setInterval(() => (ui.tab === 'work' ? paintEnergy() : clearInterval(workTimer)), 500);
    const pc = $('pc');
    pc.onpointerdown = (e) => {
      if (!spendEnergy()) return paintEnergy();
      const n = workIncome(state.work.level);
      addMoney(n);
      const f = document.createElement('span');
      f.className = 'float';
      const r = pc.getBoundingClientRect();
      f.style.left = `${e.clientX - r.left - 20}px`; f.style.top = `${e.clientY - r.top - 20}px`;
      f.textContent = `+${money(n)}`;
      pc.append(f);
      setTimeout(() => f.remove(), 800);
      paintEnergy();
    };
    if ($('up')) $('up').onclick = () => {
      const cost = workCost(state.work.level);
      if (state.money < cost || state.work.level >= WORK.maxLevel) return;
      const e = energy();
      addMoney(-cost); state.work.level += 1;
      state.work.energy = e + 10; state.work.at = now();
      save(); renderWork();
    };
    $('coffee').onclick = async () => {
      $('coffee').disabled = true;
      const r = sdk ? await sdk.ads.rewarded() : { rewarded: true };
      if (r.rewarded) { state.work.energy = workEnergyMax(state.work.level); state.work.at = now(); save(); }
      if (ui.tab === 'work') renderWork();
    };
  }

  // Общие мелочи
  let toastTimer = 0;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  function updateDot() {
    const n = state.chats.filter((c) => c.unread && c.state === 'open').length;
    const d = $('chatDot');
    d.textContent = n;
    d.classList.toggle('hidden', !n);
  }
  function markNav(tab) { for (const b of document.querySelectorAll('#nav [data-tab]')) b.classList.toggle('on', b.dataset.tab === tab); }
  $('nav').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b && !ui.spinning) go(b.dataset.tab); };
  $('back').onclick = () => { ui.item = null; ui.chat = null; ui.ratio = null; render(); };

  // Покупатели приходят по таймеру — и пока игрок в другой вкладке игры, и после возвращения в игру.
  setInterval(() => {
    for (const l of state.listings) if (!l.chat && l.buyerAt <= now()) arrive(l);
    if (ui.tab === 'sales') {
      if (state.listings.some((l) => l.chat && !view.querySelector(`[data-open="${l.chat}"]`))) renderSales(); else paintBars();
    }
    if (ui.tab === 'chats' && !ui.chat) renderChats();
  }, 500);

  // ---------- старт ----------
  async function start() {
    try { sdk = await window.Gamely.init(); } catch (e) { sdk = null; }
    try {
      const saved = sdk && await sdk.data.get();
      if (saved && saved.v === 1) state = { ...fresh(), ...saved };
    } catch (e) { /* без сохранения — новая игра */ }
    // Переписки, которые оборвались на «печатает…», при загрузке просто ждут ответа игрока.
    for (const c of state.chats) { c.typing = false; c.waiting = false; }
    $('money').textContent = money(state.money);
    updateDot();
    go('cases');
    sdk && sdk.game.ready();
  }
  start();
})();
