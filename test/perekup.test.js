// «Перекуп» (games-src/perekup): у каждой вещи есть картинка, кейсы идут лесенкой, а игрок, который
// просто открывает кейсы и продаёт с торгом, доходит до последнего кейса за разумное время.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const GAME = path.resolve(import.meta.dirname, '../games-src/perekup');
const ctx = {};
vm.createContext(ctx);
for (const f of ['js/items.js', 'js/economy.js']) vm.runInContext(fs.readFileSync(path.join(GAME, f), 'utf8').replace('window.ITEMS', 'globalThis.ITEMS'), ctx);
const { ITEMS } = ctx;
const E = ctx.PEREKUP_ECON;

test('js/items.js собран из scripts/perekup/items.json, у каждой вещи есть картинка', () => {
  const src = JSON.parse(fs.readFileSync(path.resolve(GAME, '../../scripts/perekup/items.json'), 'utf8')).items;
  assert.equal(JSON.stringify(ITEMS.map((i) => i.id)), JSON.stringify(src.map((i) => i.id)), 'иначе: node scripts/perekup/build.mjs');
  for (const i of ITEMS) assert.ok(fs.existsSync(path.join(GAME, 'img', `${i.id}.webp`)), `нет картинки img/${i.id}.webp`);
  for (let t = 1; t <= 6; t++) assert.ok(ITEMS.some((i) => i.tier === t), `пустой уровень ${t}`);
});

test('кейсы: шансы в сумме 100 %, цена — 81–94 % от средней выпавшей, каждый следующий дороже в 2–5 раз', () => {
  let prev = 0;
  for (const c of E.CASES) {
    const sum = c.pool.reduce((a, [, p]) => a + p, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${c.title}: шансы ${sum}`);
    // В среднем каждое открытие в плюс: дешёвые кейсы на 18 %, дорогие на 7–10 % (economy.js, edgeOf).
    assert.ok(c.ev / c.price > 1.06 && c.ev / c.price < 1.23, `${c.title}: ${c.ev / c.price}`);
    // Решение пользователя 30.10.2026: шаги по 12–29 раз («33 тысячи не накопить») заменены промежуточными кейсами.
    if (prev) assert.ok(c.price / prev >= 2 && c.price / prev <= 5, `${c.title}: шаг ×${(c.price / prev).toFixed(1)}`);
    prev = c.price;
  }
  assert.ok(E.CASES[0].price <= E.START_MONEY, 'на старте хватает на первый кейс');
  // Полка коллекции на каждый уровень вещей — по своему основному кейсу; старые id кейсов в сохранениях остались.
  for (let t = 1; t <= 6; t++) assert.ok(E.caseOfTier(t), `нет основного кейса уровня ${t}`);
  for (const id of ['junk', 'home', 'tech', 'antique', 'lux', 'legend']) assert.ok(E.CASES.some((c) => c.id === id), id);
});

// Простой игрок: открывает самый дорогой кейс, на который хватает (с запасом на следующий), продаёт всё с торгом
// в среднем по цене рынка ×1.12, между кейсами подрабатывает кликами и прокачивает работу, когда это окупается быстро.
// С upgrades ещё и покупает улучшения продавца (места, щедрость), как только они дешевле 10 % денег и открыты уровнем.
function simulate(seed, upgrades = false) {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pickW = (entries) => { let r = rand() * entries.reduce((n, [, w]) => n + w, 0); for (const [v, w] of entries) if ((r -= w) <= 0) return v; return entries.at(-1)[0]; };
  let money = E.START_MONEY, level = 1, t = 0, sold = 0;
  const up = {};
  const reached = {};
  while (t < 10 * 3600 && !reached.legend) {
    const can = E.CASES.filter((c) => c.price <= money);
    for (const c of can) reached[c.id] ??= t;
    if (level < E.WORK.maxLevel && E.workCost(level) < money * 0.1) { money -= E.workCost(level); level += 1; continue; }
    if (upgrades) {
      const id = ['slots', 'offer', 'speed'].find((k) => { const l = up[k] || 0, cost = E.UPGRADES[k].cost[l]; return cost != null && E.rankOf(sold) > l && cost < money * 0.1; });
      if (id) { money -= E.UPGRADES[id].cost[up[id] || 0]; up[id] = (up[id] || 0) + 1; continue; }
    }
    const c = can.at(-1);
    const perSec = 1000 / E.WORK.regenMs / E.workClickCost(level); // силы: в долгую — кликов в секунду
    if (!c) { money += E.workIncome(level) * perSec * 10; t += 10; continue; }
    // Цикл ~25 с: открыть кейсы и выставить вещи на все места для объявлений, дождаться покупателей, поторговаться.
    const n = Math.min(E.slotsOf(up), Math.floor(money / c.price));
    for (let k = 0; k < n; k++) {
      money -= c.price;
      const it = pickW(c.pool);
      const cond = pickW(E.CONDITIONS.map((x) => [x, x.w]));
      money += it.price * cond.k * 1.12 * E.offerOf(up);
      sold += 1;
    }
    t += 25;
    money += E.workIncome(level) * perSec * 15;  // пока ждёт покупателей, подрабатывает
  }
  return reached;
}

for (const upgrades of [false, true]) test(`темп${upgrades ? ' с прокачкой продавца' : ''}: до «Техники» — минуты, до «Клада» — больше часа, а не дни`, () => {
  const runs = Array.from({ length: 40 }, (_, i) => simulate(i * 7919 + 1, upgrades));
  const median = (id) => {
    const v = runs.map((r) => r[id] ?? Infinity).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const m = Object.fromEntries(E.CASES.map((c) => [c.id, Math.round(median(c.id) / 60)]));
  console.log('медиана, минут игры до кейса:', JSON.stringify(m));
  assert.ok(m.tech <= 20, `до «Техники» ${m.tech} мин`);
  assert.ok(m.antique <= 90, `до «Антиквариата» ${m.antique} мин`);
  assert.ok(m.legend <= 8 * 60, `до «Клада» ${m.legend} мин`);
  assert.ok(m.legend >= 60, `до «Клада» слишком быстро: ${m.legend} мин`);
});

test('работа не «имба»: прокачка почти не ускоряет заработок в час, на максимуме — не больше 30 тыс. ₽ в час', () => {
  const perHour = (l) => (E.workIncome(l) / E.workClickCost(l)) * (3600 * 1000 / E.WORK.regenMs);
  assert.ok(perHour(E.WORK.maxLevel) <= 30000, `${Math.round(perHour(E.WORK.maxLevel))} ₽ в час`);
  assert.ok(perHour(E.WORK.maxLevel) / perHour(1) <= 2, 'прокачка даёт не больше двукратной отдачи от сил');
  for (let l = 1; l <= E.WORK.maxLevel; l++) {
    assert.ok(E.workEnergyMax(l) / E.workClickCost(l) >= 25, `уровень ${l}: подряд меньше 25 кликов`);
  }
});

test('покупатели: женщины и мужчины пишут о себе в своём роде', () => {
  const t = {};
  vm.createContext(t);
  vm.runInContext(fs.readFileSync(path.join(GAME, 'js/talk.js'), 'utf8').replace('window.TALK', 'globalThis.TALK'), t);
  const T = t.TALK;
  assert.ok(T.men.length >= 10 && T.women.length >= 10);
  // Реплики покупателей: характеры, вопросы и реакции на ответы. Ответы игрока (answers, me) — от лица игрока, их не проверяем.
  const phrases = [...Object.values(T.types), ...Object.values(T.questions).map((q) => q.ask), T.react]
    .flatMap((x) => (Array.isArray(x) ? x : Object.values(x)).flat()).filter((x) => typeof x === 'string');
  for (const k of ['reseller', 'collector', 'regular', 'scammer']) assert.ok(T.types[k], `нет реплик для ${k}`);
  for (const s of phrases) {
    assert.ok(!/\[[^|\]]*\]/.test(s), `нет пары «муж.|жен.»: ${s}`);
    // Глагол прошедшего времени или краткое прилагательное вне [..|..] — значит, род забыт.
    const bare = s.replace(/\[[^\]]*\]/g, '');
    const left = (bare.match(/[а-яё]+(?:ил|ел|ял|ал|ул|ыл|лся|ов|ен)(?![а-яё])/gi) || []).filter((w) => !['уместен', 'дефектов', 'предел'].includes(w));
    assert.deepEqual(left, [], s);
  }
});

test('ремонт в плюс, но немного; подарки растут к 7-му дню; у достижений есть проверка', () => {
  for (const c of E.CONDITIONS.slice(0, -1)) {
    const thing = { cond: c.id, value: 10000 };
    const fix = E.repairOf(thing);
    const gain = fix.value - thing.value;
    assert.ok(fix.cost < gain, 'ремонт окупается');
    // Из «сломано» цена растёт в 2,5 раза, поэтому и прибыль больше; потолок для неё — 25 %.
    const cap = c.id === 'broken' ? 0.25 : 0.15;
    assert.ok(gain - fix.cost <= thing.value * cap, `${c.id}: прибыль ремонта ${gain - fix.cost} — не больше ${cap * 100} % цены`);
    // Без навыка ремонт с риском поломки в среднем не выгоден, с навыком — выгоден: навык что-то значит.
    const ev = (s) => { const f = E.repairOf(thing, s); return (1 - f.chance) * (f.value - thing.value) + f.chance * (f.fail.value - thing.value) - f.cost; };
    if (c.id !== 'broken') assert.ok(ev(4) > 0 && ev(4) > ev(0), `${c.id}: навык «Починка» не окупает ремонт`);
  }
  assert.equal(E.repairOf({ cond: 'mint', value: 100 }), null, '«как новое» не чинится');
  assert.equal(E.repairOf({ cond: 'worn', value: 100, fake: true }), null, 'подделку не чинят');
  assert.ok(E.CONDITIONS.every((c) => c.id !== 'broken' || c.w === 0), '«сломано» из кейса не выпадает');
  for (const best of [1000, 1e5, 1e8]) {
    const days = [1, 2, 3, 4, 5, 6, 7].map((d) => E.dailyGift(d, best));
    for (let i = 1; i < 7; i++) assert.ok(days[i] >= days[i - 1], 'подарок не уменьшается к концу серии');
  }
  const ids = new Set();
  for (const a of E.ACHIEVEMENTS) {
    assert.ok(!ids.has(a.id), `повтор ${a.id}`); ids.add(a.id);
    assert.equal(typeof a.of({ stats: { sold: 0, opened: 0, best: 0 }, found: {}, shelves: {} }), 'number', a.id);
  }
  for (const u of Object.values(E.UPGRADES)) for (let i = 1; i < u.cost.length; i++) assert.ok(u.cost[i] > u.cost[i - 1] * 5, 'улучшение дорожает');
});
