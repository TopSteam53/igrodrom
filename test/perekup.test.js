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

test('кейсы: шансы в сумме 100 %, цена — 85 % от средней выпавшей, каждый следующий дороже в 5–40 раз', () => {
  let prev = 0;
  for (const c of E.CASES) {
    const sum = Object.values(c.odds).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) < 1e-9, `${c.title}: шансы ${sum}`);
    assert.ok(c.ev / c.price > 1.12 && c.ev / c.price < 1.23, `${c.title}: ${c.ev / c.price}`);
    if (prev) assert.ok(c.price / prev >= 5 && c.price / prev <= 40, `${c.title}: шаг ×${(c.price / prev).toFixed(1)}`);
    prev = c.price;
  }
  assert.ok(E.CASES[0].price <= E.START_MONEY, 'на старте хватает на первый кейс');
});

// Простой игрок: открывает самый дорогой кейс, на который хватает (с запасом на следующий), продаёт всё с торгом
// в среднем по цене рынка ×1.12, между кейсами подрабатывает кликами и прокачивает работу, когда это окупается быстро.
function simulate(seed) {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pickW = (entries) => { let r = rand() * entries.reduce((n, [, w]) => n + w, 0); for (const [v, w] of entries) if ((r -= w) <= 0) return v; return entries.at(-1)[0]; };
  let money = E.START_MONEY, level = 1, t = 0;
  const reached = {};
  while (t < 10 * 3600 && !reached.legend) {
    const can = E.CASES.filter((c) => c.price <= money);
    for (const c of can) reached[c.id] ??= t;
    if (level < E.WORK.maxLevel && E.workCost(level) < money * 0.1) { money -= E.workCost(level); level += 1; continue; }
    const c = can.at(-1);
    const perSec = 1000 / E.WORK.regenMs / E.workClickCost(level); // силы: в долгую — кликов в секунду
    if (!c) { money += E.workIncome(level) * perSec * 10; t += 10; continue; }
    // Цикл ~25 с: открыть кейсы и выставить вещи на все места для объявлений, дождаться покупателей, поторговаться.
    const n = Math.min(E.MAX_LISTINGS, Math.floor(money / c.price));
    for (let k = 0; k < n; k++) {
      money -= c.price;
      const tier = Number(pickW(Object.entries(c.odds)));
      const pool = ITEMS.filter((i) => i.tier === tier);
      const it = pickW(pool.map((i) => [i, E.weightOf(i)]));
      const cond = pickW(E.CONDITIONS.map((x) => [x, x.w]));
      money += it.price * cond.k * 1.12;
    }
    t += 25;
    money += E.workIncome(level) * perSec * 15;  // пока ждёт покупателей, подрабатывает
  }
  return reached;
}

test('темп: до «Техники» — минуты, до «Клада» — несколько часов, а не дни', () => {
  const runs = Array.from({ length: 40 }, (_, i) => simulate(i * 7919 + 1));
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
  const phrases = Object.values(T.types).flatMap((x) => Object.values(x).flat()).filter((x) => typeof x === 'string');
  for (const s of phrases) {
    assert.ok(!/\[[^|\]]*\]/.test(s), `нет пары «муж.|жен.»: ${s}`);
    // Глагол прошедшего времени или краткое прилагательное вне [..|..] — значит, род забыт.
    const bare = s.replace(/\[[^\]]*\]/g, '');
    const left = (bare.match(/[а-яё]+(?:ил|ел|ял|ал|ул|ыл|лся|ов|ен)(?![а-яё])/gi) || []).filter((w) => !['уместен', 'дефектов'].includes(w));
    assert.deepEqual(left, [], s);
  }
});
