// Генератор кандидатов в уровни «Совёнка»: случайные башни из модулей → решатель → отбор интересных.
// Уровни в игру попадают только после ручного отбора (в levels.js), генератор лишь предлагает.
//
//   node scripts/sova-generate.mjs <сколько> <seed> <out.json>
import fs from 'node:fs';
import { loadSova, solve } from './sova-levels.mjs';

const [count = '200', seedArg = '1', outFile = 'sova-candidates.json'] = process.argv.slice(2);
let seed = Number(seedArg) * 9301 + 49297;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const COLS = 12, ROWS = 18;
const SIZES = new Set(['1x1', '2x1', '3x1', '4x1', '6x1', '8x1', '1x2', '1x3', '1x4', '1x6', '2x2', '4x2']);

function generate() {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null)); // [y][x], y=0 — первый ряд над островом
  const blocks = [];
  const islandW = ri(4, 9), ix0 = ri(0, COLS - islandW), ix1 = ix0 + islandW - 1;
  const free = (x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (xx < 0 || xx >= COLS || yy < 0 || yy >= ROWS || grid[yy][xx]) return false; return true; };
  const put = (x, y, w, h, type) => {
    if (!SIZES.has(`${w}x${h}`) || !free(x, y, w, h)) return false;
    if (type === 'b' && !(w === h && (w === 1 || w === 2))) type = 'w';
    const id = blocks.length; blocks.push({ x, y, w, h, type });
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) grid[yy][xx] = id;
    return true;
  };
  const mat = (kind) => {
    const r = rnd();
    if (kind === 'plank') return r < 0.22 ? 'i' : r < 0.32 ? 's' : 'w';
    if (kind === 'pillar') return r < 0.15 ? 's' : 'w';
    return r < 0.14 ? 's' : r < 0.26 ? 'b' : r < 0.36 ? 'i' : 'w';
  };
  // опорная поверхность: [x0, x1] на высоте y; начинаем с куска острова
  let sx0 = ri(ix0, Math.max(ix0, ix1 - 3)), sx1 = Math.min(ix1, sx0 + ri(3, 6)), sy = 0;
  const modules = ri(2, 4);
  for (let m = 0; m < modules; m++) {
    const sw = sx1 - sx0 + 1, kind = pick(['block', 'slab', 'bridge', 'bridge', 'pair']);
    if (kind === 'block' && sw >= 2) {
      const x = ri(sx0 - 1, sx1 - 0); if (!put(x, sy, 2, 2, mat('block'))) continue;
      [sx0, sx1, sy] = [x, x + 1, sy + 2];
    } else if (kind === 'slab') {
      const w = pick([2, 3, 4]), x = ri(sx0 - 1, sx1 - w + 2); if (!put(x, sy, w, 1, mat('plank'))) continue;
      [sx0, sx1, sy] = [x, x + w - 1, sy + 1];
    } else if (kind === 'pair' && sw >= 3) {
      const h = pick([1, 2]), t1 = mat('block'), t2 = mat('block');
      if (!put(sx0, sy, 1, h, t1) || !put(sx1, sy, 1, h, t2)) continue;
      const L = pick([4, 6]), x = ri(sx0 - 1, sx1 - L + 2);
      if (!put(x, sy + h, L, 1, mat('plank'))) continue;
      [sx0, sx1, sy] = [x, x + L - 1, sy + h + 1];
    } else {
      const h = pick([1, 2, 2, 3]), gap = ri(2, Math.min(6, Math.max(2, sw + 1)));
      const p1 = ri(sx0 - 1, Math.max(sx0 - 1, sx1 - gap)), p2 = p1 + gap;
      // столбик должен на что-то опираться
      const supported = (x) => (sy === 0 ? x >= ix0 && x <= ix1 : grid[sy - 1][x] !== null);
      if (!supported(p1) || !supported(p2)) continue;
      if (!put(p1, sy, 1, h, mat('pillar')) || !put(p2, sy, 1, h, mat('pillar'))) continue;
      const L = pick([4, 6, 8].filter((l) => l >= gap + 1)); const x = ri(p2 - L + 1, p1);
      if (!put(x, sy + h, L, 1, mat('plank'))) continue;
      [sx0, sx1, sy] = [x, x + L - 1, sy + h + 1];
    }
  }
  if (sy < 2) return null;
  // совёнок наверху, иногда со свесом
  const hx = ri(sx0 - 1, sx1 - 0);
  if (!free(hx, sy, 2, 2)) return null;
  const hero = { x: hx, y: sy };
  // скала-уступ сбоку от башни
  if (rnd() < 0.35) {
    const w = pick([2, 4]), y = ri(1, Math.max(1, sy - 2)), side = rnd() < 0.5 ? -1 : 1;
    const x = side < 0 ? ri(0, Math.max(0, ix0 - 1)) : ri(Math.min(COLS - w, ix1 + 1), COLS - w);
    if (free(x, y, w, 1) && y > 0) blocks.push({ x, y, w, h: 1, type: 'r', rock: true }), grid[y][x] = 'r';
  }
  // в карту: буквы по порядку
  const letters = 'abcdefghijklmnpqrstuvwxyz';
  const rows = Array.from({ length: sy + 3 }, () => Array(COLS).fill(' '));
  const top = rows.length - 1;
  const t = {};
  blocks.forEach((b, i) => {
    const ch = letters[i];
    if (b.type !== 'w') t[ch] = b.type;
    for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) rows[top - yy][xx] = ch;
  });
  for (let yy = hero.y; yy < hero.y + 2; yy++) for (let xx = hero.x; xx < hero.x + 2; xx++) rows[top - yy][xx] = 'O';
  const ground = Array(COLS).fill(' '); for (let x = ix0; x <= ix1; x++) ground[x] = '=';
  const map = [...rows.map((r) => r.join('')), ground.join('')];
  while (map[0].trim() === '') map.shift();
  return { map, t };
}

const S = loadSova();
const out = [];
let tried = 0;
while (out.length < Number(count) && tried < Number(count) * 40) {
  tried++;
  const g = generate();
  if (!g) continue;
  const def = { name: `g${tried}`, ...g };
  let r;
  try { r = solve(def, S, 5); } catch (e) { continue; }
  if (r.problems.length || !r.par || r.par < 2) continue;
  const lossRate = r.losses / Math.max(1, r.states);
  out.push({ ...def, par: r.par, sol: r.sol, wins: r.wins, losses: r.losses, states: r.states, removable: r.removable, lossRate: +lossRate.toFixed(2) });
  console.log(`${out.length}/${count} (попыток ${tried}) par ${r.par} выигрышей ${r.wins} падений ${r.losses}/${r.states}`);
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`готово: ${out.length} уровней из ${tried} попыток → ${outFile}`);
