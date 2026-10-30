// Рынок «Перекупа» (решение пользователя 30.10.2026: «экономику побольше, людей, торги, аукционы»):
// барахолка — купить вещь у людей (бывают находки дешевле рынка и подделки), заказы — покупатель ищет
// конкретную вещь и платит сверху, аукцион — лот на время со ставками соперников, лавка — доход, пока игрока нет,
// работа — кликер, когда сидишь без денег. Состояние — state.market и state.shop, помощники игры — G (js/game.js).
'use strict';
window.PerekupMarket = function (G) {
  const { $, rnd, pick, now, weighted, money, forms, nice, BY_ID, ITEMS, E, makeThing, condOf, condTag, ph, cardHTML, setTitle, toast,
    addMoney, save, progress, quest, go, rewardedAd, skill, rank, ui, view } = G;
  const { FLEA, AUCTION, ORDERS, SHOP, MARKET_RANK, TIER_NAMES, CONDITIONS, appraiseErr, weightOf, WORK, workEnergyMax, workClickCost,
    workIncome, workCost } = E;
  const T = window.TALK;
  const S = () => G.state;
  const M = () => S().market;
  const SEGS = [['flea', 'Барахолка'], ['orders', 'Заказы'], ['auction', 'Аукцион'], ['shop', 'Лавка'], ['work', 'Работа']];
  const open = (seg) => !MARKET_RANK[seg] || rank() >= MARKET_RANK[seg];

  // Вещь для рынка: обычно своего уровня, иногда уровнем ниже или выше (на аукционе — чаще выше).
  function itemNear(up = 0.05, down = 0.25) {
    const t0 = E.tierNow(S().stats.best);
    const r = Math.random();
    const tier = Math.max(1, Math.min(6, r < up ? t0 + 1 : r < up + down ? t0 - 1 : t0));
    return weighted(ITEMS.filter((i) => i.tier === tier).map((i) => [i, weightOf(i)]));
  }
  const name = () => { const f = Math.random() < 0.5; return { name: pick(f ? T.women : T.men), f }; };
  // Что игрок знает о цене: без «Оценщика» — только обычную цену вещей из своей коллекции; с навыком — оценку.
  function priceHint(lot) {
    const err = appraiseErr(skill('appraise'));
    const it = BY_ID[lot.id];
    if (err === 0) return `точная цена ${money(lot.fake ? lot.real : lot.value)}${lot.fake ? ', это подделка' : ''}`;
    if (err) {
      const c = lot.value * (1 + (lot.noise || 0) * err * 0.5);
      return `оценка ${money(nice(c * (1 - err)))}–${money(nice(c * (1 + err)))}`;
    }
    return S().found[it.id] ? `обычная цена такой вещи ${money(it.price)}` : 'цена неизвестна: такой вещи нет в коллекции';
  }

  // ---------- барахолка ----------
  function flea() {
    const m = M();
    if (!m.flea || now() - m.flea.at > FLEA.refreshMs) refreshFlea();
    return m.flea;
  }
  function refreshFlea() {
    const lots = Array.from({ length: FLEA.lots }, () => {
      const thing = makeThing(itemNear());
      const fake = BY_ID[thing.id].tier >= 2 && Math.random() < FLEA.fake;
      return { ...thing, ask: nice(thing.value * rnd(FLEA.ask[0], FLEA.ask[1])), fake, real: fake ? nice(thing.value * 0.12) : 0, noise: rnd(-1, 1), seller: name().name };
    });
    M().flea = { at: now(), lots };
    save();
  }
  function renderFlea(box) {
    const f = flea();
    const left = Math.max(0, Math.ceil((FLEA.refreshMs - (now() - f.at)) / 60e3));
    box.innerHTML = `<p class="hint">Люди продают вещи. Бывают находки дешевле рынка, бывают подделки. Цену можно сбить один раз.</p>
      <div class="lots">${f.lots.length ? f.lots.map((l, i) => {
        const it = BY_ID[l.id];
        const fakeSeen = l.fake && appraiseErr(skill('appraise')) === 0;
        return `<div class="lot">${ph(l.id)}<div class="info"><b>${it.title}</b>
          <div class="tags"><span class="tag t${it.tier}">${TIER_NAMES[it.tier]}</span>${condTag({ cond: l.cond, fake: fakeSeen })}</div>
          <span>${l.seller} просит <b class="price">${money(l.ask)}</b></span><span class="est">${priceHint(l)}</span></div>
          <div class="acts"><button class="btn deal" type="button" data-buy="${i}" ${S().money < l.ask ? 'disabled' : ''}>Купить</button>
          ${l.haggled ? '' : `<button class="btn ghost" type="button" data-haggle="${i}">Сбить 15 %</button>`}</div></div>`;
      }).join('') : '<p class="empty">Всё раскупили. Новые объявления скоро.</p>'}</div>
      <p class="hint">Новые объявления через ${left} мин.</p>
      <button class="btn ghost" id="fleaNew" type="button">Новые объявления сейчас<span class="sub">за рекламу</span></button>`;
    box.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'fleaNew') { b.disabled = true; if (await rewardedAd()) refreshFlea(); return rerender(); }
      const lots = flea().lots;
      if (b.dataset.haggle) {
        const l = lots[Number(b.dataset.haggle)];
        l.haggled = true;
        // Завысил цену — скорее уступит; цена и так честная — скорее откажет.
        if (Math.random() < (l.ask > l.value * 0.95 ? 0.7 : 0.25)) { l.ask = nice(l.ask * 0.85); toast(`${l.seller}: «Ладно, ${money(l.ask)}»`); }
        else toast(`${l.seller}: «Нет, цена нормальная»`);
        save(); return rerender();
      }
      if (b.dataset.buy) {
        const i = Number(b.dataset.buy), l = lots[i];
        if (!l || S().money < l.ask) return;
        addMoney(-l.ask);
        lots.splice(i, 1);
        const thing = { uid: S().seq++, id: l.id, cond: l.cond, value: l.fake ? l.real : l.value, ...(l.fake && { fake: true }) };
        S().inv.unshift(thing);
        S().found[l.id] = true;
        S().stats.bought = (S().stats.bought || 0) + 1;
        quest('flea');
        if (l.fake) toast(`Подделка! «${BY_ID[l.id].title}» на деле стоит ${money(l.real)}. «Оценщик» видит такое заранее.`, () => go('seller'));
        else toast(`«${BY_ID[l.id].title}» в инвентаре. Цена рынка ${money(l.value)}`, () => go('inv'));
        progress(); save(); rerender();
      }
    };
  }

  // ---------- заказы ----------
  function orders() {
    const m = M();
    m.orders = (m.orders || []).filter((o) => o.until > now());
    while (m.orders.length < ORDERS.n) m.orders.push(newOrder());
    return m.orders;
  }
  function newOrder() {
    const it = itemNear(0, 0.4);
    const cond = weighted([['worn', 50], ['good', 40], ['mint', 10]]);
    const k = CONDITIONS.find((c) => c.id === cond).k;
    const who = name();
    return { uid: S().seq++, id: it.id, cond, pay: nice(it.price * k * rnd(ORDERS.pay[0], ORDERS.pay[1])), until: now() + rnd(ORDERS.ttl[0], ORDERS.ttl[1]) * 60e3, name: who.name };
  }
  const condIdx = (id) => CONDITIONS.findIndex((c) => c.id === id);
  const fits = (o) => S().inv.find((t) => t.id === o.id && !t.fake && condIdx(t.cond) >= condIdx(o.cond));
  function renderOrders(box) {
    const list = orders();
    save();
    box.innerHTML = `<p class="hint">Покупатели ищут конкретные вещи и платят сверху. Подойдёт вещь в нужном состоянии или лучше из инвентаря.</p>
      <div class="lots">${list.map((o, i) => {
        const it = BY_ID[o.id], have = fits(o);
        const min = Math.max(1, Math.round((o.until - now()) / 60e3));
        return `<div class="lot${have ? ' ready' : ''}">${ph(o.id)}<div class="info"><b>${o.name} ищет «${it.title}»</b>
          <span>состояние не хуже «${condOf({ cond: o.cond }).label}»</span><span>платит <b class="price">${money(o.pay)}</b>, ещё ${min} мин</span></div>
          <div class="acts">${have ? `<button class="btn deal" type="button" data-give="${i}">Отдать</button>` : '<span class="mut">нет в инвентаре</span>'}</div></div>`;
      }).join('')}</div>
      <button class="btn ghost" id="ordNew" type="button">Другие заказы<span class="sub">за рекламу</span></button>`;
    box.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'ordNew') { b.disabled = true; if (await rewardedAd()) M().orders = []; return rerender(); }
      if (b.dataset.give) {
        const o = orders()[Number(b.dataset.give)], t = o && fits(o);
        if (!t) return rerender();
        S().inv = S().inv.filter((x) => x !== t);
        M().orders = M().orders.filter((x) => x !== o);
        addMoney(o.pay);
        S().stats.orders = (S().stats.orders || 0) + 1;
        quest('order');
        toast(`${o.name} забирает «${BY_ID[o.id].title}»: +${money(o.pay)}`);
        progress(); save(); rerender();
      }
    };
  }

  // ---------- аукцион ----------
  // Лот на время; соперники ставят шаг за шагом до своего потолка, ставка в последние секунды продлевает торги.
  function auction() {
    const m = M();
    if (!m.auction || (m.auction.done && now() >= m.auction.next)) newAuction();
    return m.auction;
  }
  function newAuction() {
    const thing = makeThing(itemNear(0.25, 0.15));
    const rivals = Array.from({ length: 2 + Math.floor(Math.random() * 2) }, () => ({ ...name(), max: nice(thing.value * rnd(AUCTION.rivals[0], AUCTION.rivals[1])), noise: rnd(-1, 1) }));
    M().auction = { thing, rivals, bid: nice(thing.value * AUCTION.start), step: nice(thing.value * AUCTION.step), leader: null,
      ends: now() + AUCTION.durMs, done: false, next: 0, result: '' };
    save();
  }
  function tickAuction() {
    const a = M().auction;
    if (!a || a.done || !open('auction')) return;
    if (now() >= a.ends) return finishAuction(a);
    a.rivals.forEach((r, i) => {
      if (a.leader === i || r.max < a.bid + a.step) return;
      // Без ставок игрока соперники торгуются лениво, перебивают его — быстро.
      if (Math.random() < (a.leader === 'me' ? 0.25 : 0.06)) {
        const wasMe = a.leader === 'me';
        a.bid = a.leader == null ? a.bid : a.bid + a.step;
        a.leader = i;
        if (a.ends - now() < AUCTION.extendMs) a.ends = now() + AUCTION.extendMs;
        if (wasMe && !(ui.tab === 'market' && ui.market === 'auction')) toast(`${r.name} ${r.f ? 'перебила' : 'перебил'} вашу ставку: ${money(a.bid)}`, () => go('market', 'auction'));
      }
    });
  }
  function finishAuction(a) {
    a.done = true;
    a.next = now() + AUCTION.pauseMs;
    const it = BY_ID[a.thing.id];
    if (a.leader === 'me') {
      if (S().money >= a.bid) {
        addMoney(-a.bid);
        S().inv.unshift(a.thing);
        S().found[a.thing.id] = true;
        S().stats.auctions = (S().stats.auctions || 0) + 1;
        quest('auction');
        a.result = `Лот ваш: «${it.title}» за ${money(a.bid)}. Цена рынка ${money(a.thing.value)}.`;
        toast(a.result, () => go('inv'));
        progress();
      } else a.result = 'Лот ушёл другому: денег на ставку не хватило.';
    } else a.result = a.leader == null ? 'Ставок не было, лот снят.' : `Лот ушёл: ${a.rivals[a.leader].name}, ${money(a.bid)}.`;
    save();
  }
  function renderAuction(box) {
    const a = auction();
    const it = BY_ID[a.thing.id];
    const sec = Math.max(0, Math.ceil((a.ends - now()) / 1000));
    const lead = a.leader === 'me' ? 'ваша ставка' : a.leader == null ? 'ставок нет' : a.rivals[a.leader].name;
    const next = a.leader == null ? a.bid : a.bid + a.step;
    const sense = skill('sense') >= 3 && typeof a.leader === 'number' ? `<span class="est">Чутьё: ${a.rivals[a.leader].name} готов дойти примерно до ${money(nice(a.rivals[a.leader].max * (1 + a.rivals[a.leader].noise * 0.1)))}</span>` : '';
    box.innerHTML = `<p class="hint">Лот уходит тому, чья ставка последняя, когда кончится время. Ставка в последние секунды продлевает торги.</p>
      <div class="auction">${ph(a.thing.id)}<div class="info"><b>${it.title}</b>
        <div class="tags"><span class="tag t${it.tier}">${TIER_NAMES[it.tier]}</span>${condTag(a.thing)}</div>
        <span class="est">${priceHint({ ...a.thing, fake: false, noise: a.rivals[0].noise })}</span></div></div>
      ${a.done ? `<p class="result">${a.result}</p><p class="hint">Следующий лот через ${Math.max(1, Math.ceil((a.next - now()) / 1000))} с.</p>`
        : `<div class="bid"><div><span>Ставка</span><b>${money(a.bid)}</b><small>${lead}</small></div><div><span>Осталось</span><b class="t${sec <= 10 ? ' hot' : ''}">${sec} с</b><small>соперников ${a.rivals.length}</small></div></div>
        ${sense}
        <div class="row2"><button class="btn deal" type="button" data-bid="${next}" ${a.leader === 'me' || S().money < next ? 'disabled' : ''}>Ставка ${money(next)}</button>
        <button class="btn ghost" type="button" data-bid="${next + 2 * a.step}" ${a.leader === 'me' || S().money < next + 2 * a.step ? 'disabled' : ''}>Сразу ${money(next + 2 * a.step)}</button></div>
        ${S().money < next ? '<p class="hint">Не хватает денег на ставку.</p>' : ''}`}`;
    box.onclick = (e) => {
      const b = e.target.closest('[data-bid]');
      if (!b) return;
      const x = auction(), v = Number(b.dataset.bid);
      if (x.done || x.leader === 'me' || S().money < v || v < x.bid) return;
      x.bid = v; x.leader = 'me';
      if (x.ends - now() < AUCTION.extendMs) x.ends = now() + AUCTION.extendMs;
      save(); rerender();
    };
  }

  // ---------- лавка ----------
  // Копит выручку, пока игрока нет, но не больше SHOP.capH часов: повод заглядывать.
  const income = () => SHOP.income[S().shop.level] || 0;
  const bank = () => (S().shop.level ? Math.floor(Math.min(SHOP.capH, (now() - S().shop.at) / 3.6e6) * income()) : 0);
  function collect(k = 1) {
    const v = bank() * k;
    S().shop.at = now();
    if (v > 0) { addMoney(v); quest('shop'); toast(`Выручка лавки: +${money(v)}`); }
    save();
  }
  function renderShop(box) {
    const s = S().shop, lvl = s.level, cost = SHOP.cost[lvl];
    if (!lvl) {
      box.innerHTML = `<div class="shop"><b>Своя лавка</b><p class="hint">Торгует сама, даже когда вас нет в игре: ${money(SHOP.income[1])} в час на первом уровне,
        выручка копится до ${SHOP.capH} часов. Заходите собирать.</p>
        <button class="btn deal" id="shopUp" type="button" ${S().money < cost ? 'disabled' : ''}>Открыть за ${money(cost)}</button></div>`;
    } else {
      const full = bank() >= income() * SHOP.capH;
      box.innerHTML = `<div class="shop"><b>Лавка, уровень ${lvl}</b><p class="hint">${money(income())} в час, копит до ${SHOP.capH} часов${full ? '. Касса полна, лавка больше не копит.' : '.'}</p>
        <div class="cash"><span>В кассе</span><b>${money(bank())}</b></div>
        <div class="row2"><button class="btn deal" id="shopTake" type="button" ${bank() <= 0 ? 'disabled' : ''}>Забрать</button>
        <button class="btn ghost" id="shopDouble" type="button" ${bank() <= 0 ? 'disabled' : ''}>Забрать вдвое<span class="sub">за рекламу</span></button></div>
        ${cost != null ? `<button class="btn ghost" id="shopUp" type="button" style="margin-top:10px" ${S().money < cost ? 'disabled' : ''}>Улучшить за ${money(cost)}<span class="sub">${money(SHOP.income[lvl + 1])} в час</span></button>`
          : '<p class="hint" style="color:var(--deal)">Лавка прокачана до предела</p>'}</div>`;
    }
    box.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'shopTake') collect(1);
      if (b.id === 'shopDouble') { b.disabled = true; collect((await rewardedAd()) ? 2 : 1); }
      if (b.id === 'shopUp') {
        const c = SHOP.cost[S().shop.level];
        if (c == null || S().money < c) return;
        if (S().shop.level) collect(1);
        addMoney(-c);
        S().shop.level += 1; S().shop.at = now();
        toast(S().shop.level === 1 ? 'Лавка открыта. Заходите за выручкой.' : `Лавка: уровень ${S().shop.level}`);
        progress(); save();
      }
      rerender();
    };
  }

  // ---------- работа: силы считаем лениво — сколько было и когда, остальное добирается по времени ----------
  function energy() {
    const w = S().work;
    if (w.energy == null) { w.energy = workEnergyMax(w.level); w.at = now(); }
    return Math.min(workEnergyMax(w.level), w.energy + (now() - w.at) / WORK.regenMs);
  }
  function spendEnergy() {
    const e = energy();
    const need = workClickCost(S().work.level);
    if (e < need) return false;
    S().work.energy = e - need; S().work.at = now();
    return true;
  }
  function renderWork(box) {
    const l = S().work.level;
    const top = l >= WORK.maxLevel;
    box.innerHTML = `<div class="work"><p class="hint">Жмите по ноутбуку и зарабатывайте</p>
      <button class="pc" id="pc" type="button" aria-label="Работать"><div class="card" style="width:240px;height:200px;display:grid;place-items:center">
        <img src="img/laptop.webp" alt="" draggable="false" style="width:200px;height:180px;object-fit:contain"></div></button>
      <div class="work-side"><div class="inc">Доход за клик <em>${money(workIncome(l))}</em></div>
      <div class="lvl">Уровень ${l} из ${WORK.maxLevel}, клик тратит ${workClickCost(l)} ${forms(workClickCost(l), ['силу', 'силы', 'сил'])}</div>
      <div class="energy"><div class="energy-top"><span>Силы</span><b id="en"></b></div><div class="bar-wait"><i id="enBar"></i></div>
        <p class="hint" id="enHint"></p></div>
      ${top ? '<p class="hint">Работа прокачана до предела. Дальше растите на перепродаже.</p>'
        : `<button class="btn deal" id="up" type="button" ${S().money < workCost(l) ? 'disabled' : ''}>Прокачать за ${money(workCost(l))}<span class="sub">${money(workIncome(l + 1))} за клик, ${workClickCost(l + 1)} ${forms(workClickCost(l + 1), ['сила', 'силы', 'сил'])} на клик</span></button>`}
      <button class="btn ghost" id="coffee" type="button">Кофе: силы сразу на максимум<span class="sub">за рекламу</span></button></div></div>`;
    paintEnergy();
    const pc = $('pc');
    pc.onpointerdown = (e) => {
      if (!spendEnergy()) return paintEnergy();
      const n = workIncome(S().work.level);
      addMoney(n);
      quest('work');
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
      const cost = workCost(S().work.level);
      if (S().money < cost || S().work.level >= WORK.maxLevel) return;
      const e = energy();
      addMoney(-cost); S().work.level += 1;
      S().work.energy = e + 10; S().work.at = now();
      save(); rerender();
    };
    $('coffee').onclick = async () => {
      $('coffee').disabled = true;
      if (await rewardedAd()) { S().work.energy = workEnergyMax(S().work.level); S().work.at = now(); save(); }
      rerender();
    };
  }
  function paintEnergy() {
    if (!$('en')) return;
    const max = workEnergyMax(S().work.level), need = workClickCost(S().work.level);
    const e = Math.floor(energy());
    $('en').textContent = `${e} из ${max}`;
    $('enBar').style.width = `${(e / max) * 100}%`;
    $('enBar').style.background = e < need ? 'var(--warn)' : 'var(--deal)';
    const left = Math.ceil(((max - energy()) * WORK.regenMs) / 1000);
    $('enHint').textContent = e < need ? `Перерыв. Силы для следующего клика вернутся через ${Math.ceil(((need - energy()) * WORK.regenMs) / 1000)} с`
      : e < max ? `Полностью восстановятся через ${left < 60 ? `${left} с` : `${Math.ceil(left / 60)} мин`}` : '';
    $('coffee').disabled = e >= max;
    if ($('up')) $('up').disabled = S().money < workCost(S().work.level);
  }

  // ---------- экран рынка ----------
  function render() {
    setTitle('Рынок');
    if (!ui.market || !SEGS.some(([id]) => id === ui.market)) ui.market = 'flea';
    const seg = `<div class="seg">${SEGS.map(([id, title]) => `<button type="button" data-seg="${id}" class="${ui.market === id ? 'on' : ''}${open(id) ? '' : ' locked'}">${title}</button>`).join('')}</div>`;
    view.innerHTML = seg + '<div id="mkt"></div>';
    view.querySelector('.seg').onclick = (e) => { const b = e.target.closest('[data-seg]'); if (b) { ui.market = b.dataset.seg; render(); } };
    const box = $('mkt');
    if (!open(ui.market)) {
      box.innerHTML = `<div class="empty">Откроется на ${MARKET_RANK[ui.market]}-м уровне продавца. Уровень растёт от сделок с покупателями.
        <button class="btn me" type="button" data-to="seller">Уровень продавца</button></div>`;
      return;
    }
    ({ flea: renderFlea, orders: renderOrders, auction: renderAuction, shop: renderShop, work: renderWork })[ui.market](box);
  }
  function rerender() { if (ui.tab === 'market') render(); G.updateDot(); }

  let lastSig = '';
  return {
    render,
    start() {
      if (S().shop.level && bank() >= income() * 0.5) toast(`Лавка накопила ${money(bank())}`, () => go('market', 'shop'));
    },
    tick() {
      tickAuction();
      if (ui.tab !== 'market') return;
      if (ui.market === 'auction' && open('auction') && $('mkt')) {
        // Целиком экран перерисовываем, только когда сменились ставка, лидер или лот: иначе кнопка под пальцем
        // пропадала бы дважды в секунду. Таймер обновляем на месте.
        const a = auction();
        const sig = [a.bid, a.leader, a.done, a.thing.uid, S().money >= a.bid + a.step].join();
        if (sig !== lastSig) { lastSig = sig; renderAuction($('mkt')); }
        const t = view.querySelector('.bid .t');
        if (t) { const s = Math.max(0, Math.ceil((a.ends - now()) / 1000)); t.textContent = `${s} с`; t.classList.toggle('hot', s <= 10); }
        const n = view.querySelector('.result + .hint');
        if (n && a.done) n.textContent = `Следующий лот через ${Math.max(1, Math.ceil((a.next - now()) / 1000))} с.`;
      } else if (ui.market === 'work') paintEnergy();
      else if (ui.market === 'shop' && $('mkt') && S().shop.level && !document.activeElement?.closest?.('#mkt')) {
        const c = view.querySelector('.cash b');
        if (c) c.textContent = money(bank());
      }
    },
    // Красная точка у «Рынка»: касса лавки заполнена наполовину или есть чем выполнить заказ.
    attention() {
      if (S().shop.level && bank() >= income() * SHOP.capH * 0.5) return true;
      return open('orders') && (M().orders || []).some((o) => o.until > now() && fits(o));
    },
  };
};
