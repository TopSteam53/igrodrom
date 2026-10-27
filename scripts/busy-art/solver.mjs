// Правила «Бусинок» для проверки уровней (те же, что в public/games/busy/index.html):
// бусину можно взять, если она на краю картины или рядом с пустой клеткой. Касание забирает связную (по сторонам)
// группу её цвета по одной бусине; как только в лотке десять бусин одного цвета, они нанизываются на нитку и
// освобождают место — поэтому большая группа уходит целиком, а останавливается касание, только когда лоток полон.
// Лоток полон, а картина не пуста — проигрыш; картина пуста — победа.
export const STRING = 10;

export function makeState(pic, cap) {
  const cells = [...pic.px].map((ch) => (ch === '.' ? -1 : ch.charCodeAt(0) - 97));
  return { w: pic.w, h: pic.h, cells, left: cells.filter((c) => c >= 0).length, tray: new Array(pic.pal.length).fill(0), load: 0, cap };
}

const isOpen = (s, i) => {
  const x = i % s.w, y = (i / s.w) | 0;
  if (!x || !y || x === s.w - 1 || y === s.h - 1) return true;
  return s.cells[i - 1] < 0 || s.cells[i + 1] < 0 || s.cells[i - s.w] < 0 || s.cells[i + s.w] < 0;
};

export function group(s, i) {
  const c = s.cells[i], seen = new Set([i]), q = [i];
  for (let k = 0; k < q.length; k++) {
    const j = q[k], x = j % s.w;
    for (const n of [x > 0 ? j - 1 : -1, x < s.w - 1 ? j + 1 : -1, j - s.w, j + s.w]) {
      if (n >= 0 && n < s.cells.length && !seen.has(n) && s.cells[n] === c) { seen.add(n); q.push(n); }
    }
  }
  return q;
}

// Возвращает число взятых бусин (0 — ход невозможен).
export function tap(s, i) {
  if (s.cells[i] < 0 || !isOpen(s, i)) return 0;
  if (s.load >= s.cap) return 0;
  const c = s.cells[i];
  let n = 0;
  for (const j of group(s, i)) {
    if (s.load >= s.cap) break;
    s.cells[j] = -1; s.left--; s.tray[c]++; s.load++; n++;
    if (s.tray[c] === STRING) { s.tray[c] = 0; s.load -= STRING; }
  }
  return n;
}

export const lost = (s) => s.left > 0 && s.load >= s.cap;

// Доступные ходы: по одному представителю на каждую открытую группу.
export function moves(s) {
  const seen = new Set(), out = [];
  for (let i = 0; i < s.cells.length; i++) {
    if (s.cells[i] < 0 || seen.has(i) || !isOpen(s, i)) continue;
    const g = group(s, i);
    g.forEach((j) => seen.add(j));
    out.push({ i, c: s.cells[i], n: g.length });
  }
  return out;
}

const clone = (s) => ({ ...s, cells: s.cells.slice(), tray: s.tray.slice() });

// Жадный ход: после него в лотке меньше всего бусин; при равенстве — тот, что забрал больше.
export function bestMove(s) {
  let best = null, bl = Infinity, bn = -1;
  for (const m of moves(s)) {
    const t = clone(s), n = tap(t, m.i);
    if (!n) continue;
    const l = lost(t) ? Infinity : t.load;
    if (l < bl || (l === bl && n > bn)) { best = m; bl = l; bn = n; }
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

// Лоток картины: наименьший, с которым жадный игрок справляется, плюс запас (на первых уровнях больше),
// округлено до 5 — в ряду лотка 10 мест. Жадный игрок не всегда справляется с лотком побольше, поэтому итог
// перепроверяем. cap2 — для второго круга картин, запас там почти нулевой.
export function capFor(pic, level = 1) {
  let lo = STRING, hi = 400;
  while (!solvable(pic, hi)) hi *= 2;
  while (lo < hi) { const m = (lo + hi) >> 1; if (solvable(pic, m)) hi = m; else lo = m + 1; }
  const fit = (c) => { c = Math.ceil(Math.max(15, c) / 5) * 5; while (!solvable(pic, c)) c += 5; return c; };
  const spare = level <= 3 ? 12 : level <= 8 ? 8 : level <= 20 ? 5 : 3;
  return { cap: fit(hi + spare), cap2: fit(hi + 1) };
}
