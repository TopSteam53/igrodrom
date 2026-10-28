// Правила «Бусинок» для проверки уровней (те же, что в public/games/busy/index.html):
// бусину можно взять, если она на краю картины или рядом с пустой клеткой. Касание забирает связную (по сторонам)
// группу её цвета по одной бусине; как только в лотке десять бусин одного цвета, они нанизываются на нитку и
// освобождают место — поэтому большая группа уходит целиком, а останавливается касание, только когда лоток полон.
// Лоток полон, а картина не пуста — проигрыш; картина пуста — победа.
// Особые клетки (строка pic.sp той же длины, что px): b — бомба, i — лёд, s — камень.
//   Бомба: открытую можно нажать — она исчезает и забирает в лоток бусины вокруг себя (3×3) всех цветов; лёд в этом
//   квадрате тает, но бусина остаётся. Лёд: замёрзшую бусину не взять и в группу она не входит; оттаивает, когда
//   рядом (по сторонам) освобождается клетка. Камень: не уходит никогда и не открывает соседей.
export const STRING = 10;
export const STONE = -2, BOMB = -3;

export function makeState(pic, cap) {
  const sp = pic.sp || '';
  const cells = [...pic.px].map((ch, i) => (ch === '.' ? -1 : sp[i] === 's' ? STONE : sp[i] === 'b' ? BOMB : ch.charCodeAt(0) - 97));
  const ice = [...pic.px].map((_, i) => sp[i] === 'i');
  return { w: pic.w, h: pic.h, cells, ice, left: cells.filter((c) => c >= 0).length, tray: new Array(pic.pal.length).fill(0), load: 0, cap };
}

export const isOpen = (s, i) => {
  const x = i % s.w, y = (i / s.w) | 0;
  if (!x || !y || x === s.w - 1 || y === s.h - 1) return true;
  return s.cells[i - 1] === -1 || s.cells[i + 1] === -1 || s.cells[i - s.w] === -1 || s.cells[i + s.w] === -1;
};
const sides = (s, j) => { const x = j % s.w; return [x > 0 ? j - 1 : -1, x < s.w - 1 ? j + 1 : -1, j - s.w, j + s.w].filter((n) => n >= 0 && n < s.cells.length); };

export function group(s, i) {
  const c = s.cells[i], seen = new Set([i]), q = [i];
  for (let k = 0; k < q.length; k++) {
    for (const n of sides(s, q[k])) if (!seen.has(n) && s.cells[n] === c && !s.ice[n]) { seen.add(n); q.push(n); }
  }
  return q;
}

// Одна бусина в лоток; десятая одного цвета сразу уходит ниткой.
function take(s, j, removed) {
  const c = s.cells[j];
  s.cells[j] = -1; s.left--; s.tray[c]++; s.load++; removed.push(j);
  if (s.tray[c] === STRING) { s.tray[c] = 0; s.load -= STRING; }
}
// Лёд тает рядом с освободившимися клетками; возвращает растаявшие клетки.
function thaw(s, removed) {
  const out = [];
  for (const j of removed) for (const n of sides(s, j)) if (s.ice[n]) { s.ice[n] = false; out.push(n); }
  return out;
}

// Ход. Возвращает { n — бусин в лоток, removed — освободившиеся клетки, thawed } или null, если ход невозможен.
export function tap(s, i) {
  const v = s.cells[i];
  if (v === -1 || v === STONE || !isOpen(s, i) || s.ice[i]) return null;
  if (s.load >= s.cap) return null;
  const removed = [];
  let n = 0;
  if (v === BOMB) {
    s.cells[i] = -1; removed.push(i);
    const x0 = i % s.w, y0 = (i / s.w) | 0, melted = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if ((!dx && !dy) || x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
      const j = y * s.w + x;
      if (s.cells[j] < 0) continue;
      if (s.ice[j]) { s.ice[j] = false; melted.push(j); continue; }
      if (s.load >= s.cap) continue;
      take(s, j, removed); n++;
    }
    return { n, removed, thawed: melted.concat(thaw(s, removed)) };
  }
  for (const j of group(s, i)) {
    if (s.load >= s.cap) break;
    take(s, j, removed); n++;
  }
  return { n, removed, thawed: thaw(s, removed) };
}

export const lost = (s) => s.left > 0 && s.load >= s.cap;

// Доступные ходы: по одному на каждую открытую группу и каждую открытую бомбу.
export function moves(s) {
  const seen = new Set(), out = [];
  for (let i = 0; i < s.cells.length; i++) {
    const v = s.cells[i];
    if (v === -1 || v === STONE || seen.has(i) || s.ice[i] || !isOpen(s, i)) continue;
    if (v === BOMB) { out.push({ i, c: BOMB, n: 1 }); continue; }
    const g = group(s, i);
    g.forEach((j) => seen.add(j));
    out.push({ i, c: v, n: g.length });
  }
  return out;
}

const clone = (s) => ({ ...s, cells: s.cells.slice(), ice: s.ice.slice(), tray: s.tray.slice() });

// Жадный ход: после него в лотке меньше всего бусин; при равенстве — тот, что забрал больше.
export function bestMove(s) {
  let best = null, bl = Infinity, bn = -1;
  for (const m of moves(s)) {
    const t = clone(s), r = tap(t, m.i);
    if (!r) continue;
    const l = lost(t) ? Infinity : t.load;
    if (l < bl || (l === bl && r.n > bn)) { best = m; bl = l; bn = r.n; }
  }
  return best;
}

export function solvable(pic, cap) {
  const s = makeState(pic, cap);
  for (let guard = 0; guard < 10000; guard++) {
    if (!s.left) return true;
    const m = bestMove(s);
    if (!m) return false;
    tap(s, m.i);
    if (lost(s)) return false;
  }
  return false;
}

// Лоток картины: наименьший, с которым жадный игрок справляется, плюс небольшой запас на первых картинах,
// округлено до 5 — в ряду лотка 10 мест. Жадный игрок не всегда справляется с лотком побольше, поэтому итог
// перепроверяем. cap2 — для второго круга картин.
export function capFor(pic, level = 1) {
  let lo = STRING, hi = 400;
  while (!solvable(pic, hi)) { hi *= 2; if (hi > 5000) throw new Error(`${pic.name}: картина не решается`); }
  while (lo < hi) { const m = (lo + hi) >> 1; if (solvable(pic, m)) hi = m; else lo = m + 1; }
  const fit = (c) => { c = Math.ceil(Math.max(15, c) / 5) * 5; while (!solvable(pic, c)) c += 5; return c; };
  // Запас над минимумом маленький (решение пользователя 28.10.2026: «нитки лёгкие»), игроку придётся думать.
  const spare = level <= 2 ? 6 : level <= 6 ? 3 : 0;
  return { cap: fit(hi + spare), cap2: fit(hi) };
}

// Особые клетки для уровня (детерминированно по номеру): бомбы с 5-й картины, лёд с 8-й, камни с 14-й.
export function specials(pic, level) {
  let seed = level * 9973 + 17;
  const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const n = pic.px.length, sp = new Array(n).fill('.');
  const beads = [];
  for (let i = 0; i < n; i++) if (pic.px[i] !== '.') beads.push(i);
  const pick = (k, ok) => { for (let tries = 0; k > 0 && tries < k * 40; tries++) { const i = beads[Math.floor(r() * beads.length)]; if (sp[i] === '.' && ok(i)) { sp[i] = cur; k--; } } };
  const interior = (i) => { const x = i % pic.w, y = (i / pic.w) | 0; return x > 1 && y > 1 && x < pic.w - 2 && y < pic.h - 2; };
  // Набор особых клеток меняется от картины к картине, чтобы не было одного и того же:
  // на 5-й знакомим с бомбой, на 8-й — со льдом, на 14-й — с камнями, дальше набор случайный.
  const intro = { 5: 'b', 8: 'i', 14: 's' }[level];
  let set = '';
  if (intro) set = intro;
  else if (level > 5) {
    const pool = ['', 'b', 'b'];
    if (level > 8) pool.push('i', 'i', 'bi');
    if (level > 14) pool.push('s', 's', 'bs', 'is', 'bis');
    set = pool[Math.floor(r() * pool.length)];
  }
  let cur = 'b';
  if (set.includes('b')) pick(1 + (level >= 12) + (level >= 25), interior);
  cur = 'i';
  if (set.includes('i')) pick(Math.round(beads.length * Math.min(0.16, 0.07 + (level - 8) * 0.003)), () => true);
  if (set.includes('s')) {
    // камни — так, чтобы до каждой бусины можно было добраться в обход
    for (let attempt = 0; attempt < 20; attempt++) {
      const save = sp.slice();
      cur = 's';
      pick(Math.round(beads.length * Math.min(0.08, 0.04 + (level - 14) * 0.002)), (i) => pic.px[i] !== '.');
      if (reachable(pic, sp)) break;
      sp.splice(0, n, ...save);
    }
  }
  return sp.join('');
}
function reachable(pic, sp) {
  const { w, h } = pic, seen = new Uint8Array(w * h), q = [];
  for (let i = 0; i < w * h; i++) { const x = i % w, y = (i / w) | 0; if ((!x || !y || x === w - 1 || y === h - 1) && sp[i] !== 's') { seen[i] = 1; q.push(i); } }
  for (let k = 0; k < q.length; k++) { const j = q[k], x = j % w; for (const nb of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) if (nb >= 0 && nb < w * h && !seen[nb] && sp[nb] !== 's') { seen[nb] = 1; q.push(nb); } }
  for (let i = 0; i < w * h; i++) if (pic.px[i] !== '.' && sp[i] !== 's' && !seen[i]) return false;
  return true;
}
