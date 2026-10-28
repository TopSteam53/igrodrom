// Картины для «Бусинок»: свои рисунки (аватарки-звери, спрайты игр, сцены из scripts/busy-art) → сетка бусин
// в общей палитре → public/games/busy/pictures.js. Рисует и усредняет Chrome без окна (canvas), считает Node.
//   node scripts/busy-pictures.mjs            — пересобрать все картины
//   node scripts/busy-pictures.mjs --sheet    — ещё и лист-превью scratch/busy-sheet.png для проверки глазами
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PICTURES, BEAD_PALETTE } from './busy-art/list.mjs';
import { capFor, specials } from './busy-art/solver.mjs';
import { SCENES } from './busy-art/scenes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'games', 'busy', 'pictures.js');

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('Нужен Chrome или Edge');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'busy-'));
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

// Картинка → средние цвета клеток (RGBA). Рисуем в 8 раз крупнее сетки и усредняем блоки 8×8.
async function sample(src, gw, gh, crop) {
  // У SVG без width/height браузер берёт размер 300×150 и рисует картинку не целиком — задаём размер из viewBox.
  const scene = src.startsWith('scene:') && SCENES[src.slice(6)];
  let buf = scene ? Buffer.from(scene) : fs.readFileSync(path.join(root, src));
  if (scene || src.endsWith('.svg')) {
    const s = buf.toString('utf8'), vb = s.match(/viewBox="[\d.\s-]*?\s([\d.]+)\s+([\d.]+)"/);
    buf = Buffer.from(s.replace(/<svg\b(?![^>]*\swidth=)/, `<svg width="${vb ? vb[1] : 256}" height="${vb ? vb[2] : 256}"`));
  }
  const data = 'data:' + (scene || src.endsWith('.svg') ? 'image/svg+xml' : 'image/webp') + ';base64,' + buf.toString('base64');
  return js(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(data)}; await img.decode();
    const K = 8, c = document.createElement('canvas'); c.width = ${gw} * K; c.height = ${gh} * K;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    const cr = ${JSON.stringify(crop || [0, 0, 1, 1])}, W = img.naturalWidth || 256, H = img.naturalHeight || 256;
    g.drawImage(img, cr[0] * W, cr[1] * H, cr[2] * W, cr[3] * H, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data, cells = [];
    for (let y = 0; y < ${gh}; y++) for (let x = 0; x < ${gw}; x++) {
      let r = 0, gg = 0, b = 0, a = 0;
      for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
        const p = ((y * K + j) * c.width + x * K + i) * 4, al = d[p + 3] / 255;
        r += d[p] * al; gg += d[p + 1] * al; b += d[p + 2] * al; a += al;
      }
      cells.push(a ? [r / a, gg / a, b / a, a / (K * K)] : [0, 0, 0, 0]);
    }
    return cells;
  })()`);
}

// ---------- цвет ----------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function lab([r, g, b]) {
  const f = (c) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  X = t(X); Y = t(Y); Z = t(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const PAL_LAB = BEAD_PALETTE.map((h) => lab(hex(h)));
const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const nearest = (l, allowed) => { let best = -1, bd = Infinity; for (const i of allowed) { const d = dist(l, PAL_LAB[i]); if (d < bd) { bd = d; best = i; } } return best; };

function quantize(cells, gw, gh, maxColors, minCount) {
  const all = BEAD_PALETTE.map((_, i) => i);
  let grid = cells.map((c) => (c[3] < 0.5 ? -1 : nearest(lab(c), all)));
  // Сливаем редкие цвета в ближайший оставшийся, пока цветов не станет ≤ maxColors.
  for (;;) {
    const cnt = new Map(); grid.forEach((v) => v >= 0 && cnt.set(v, (cnt.get(v) || 0) + 1));
    const used = [...cnt.keys()].sort((a, b) => cnt.get(a) - cnt.get(b));
    if (used.length <= 1) break;
    const rare = used[0];
    if (used.length <= maxColors && cnt.get(rare) >= minCount) break;
    const rest = used.slice(1);
    grid = grid.map((v, i) => (v === rare ? nearest(lab(cells[i]), rest) : v));
  }
  // Одиночные бусины без соседа своего цвета (с диагоналями) перекрашиваем в цвет большинства соседей.
  const at = (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh ? -1 : grid[y * gw + x]);
  grid = grid.map((v, i) => {
    if (v < 0) return v;
    const x = i % gw, y = (i / gw) | 0, votes = new Map();
    let same = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const n = at(x + dx, y + dy);
      if (n === v) same++;
      else if (n >= 0 && (!dx || !dy)) votes.set(n, (votes.get(n) || 0) + 1);
    }
    if (same) return v;
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 2 ? top[0] : v;
  });
  return grid;
}

// Обрезаем пустые края (у спрайтов с прозрачностью).
function trim(grid, gw, gh) {
  let x0 = gw, y0 = gh, x1 = -1, y1 = -1;
  grid.forEach((v, i) => { if (v >= 0) { const x = i % gw, y = (i / gw) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
  const w = x1 - x0 + 1, h = y1 - y0 + 1, g = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.push(grid[y * gw + x]);
  return { grid: g, w, h };
}

const result = [];
await send('Page.navigate', { url: 'about:blank' });
for (const p of PICTURES) {
  const [gw, gh] = p.size;
  const cells = await sample(p.src, gw, gh, p.crop);
  const q = trim(quantize(cells, gw, gh, p.colors || 7, p.minCount || 4), gw, gh);
  // Палитра картины — только её цвета, в порядке частоты; клетка — буква (a — первый цвет), «.» — пусто.
  const cnt = new Map(); q.grid.forEach((v) => v >= 0 && cnt.set(v, (cnt.get(v) || 0) + 1));
  const used = [...cnt.keys()].sort((a, b) => cnt.get(b) - cnt.get(a));
  const px = q.grid.map((v) => (v < 0 ? '.' : String.fromCharCode(97 + used.indexOf(v)))).join('');
  const pic = { name: p.name, w: q.w, h: q.h, pal: used.map((i) => BEAD_PALETTE[i]), px };
  const sp = specials(pic, p.level);
  if (/[bis]/.test(sp)) pic.sp = sp;
  Object.assign(pic, capFor(pic, p.level));
  result.push(pic);
  console.log(`${p.name.padEnd(18)} ${q.w}×${q.h} цветов ${used.length} бусин ${q.grid.filter((v) => v >= 0).length} лоток ${pic.cap}/${pic.cap2} ${pic.sp ? ['b', 'i', 's'].map((k) => k + (pic.sp.split(k).length - 1)).join(' ') : ''}`);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `// Собрано scripts/busy-pictures.mjs — не править руками.\n// pal — цвета бусин, px — строки по w клеток: a — pal[0], b — pal[1]…, «.» — пустая клетка; cap — мест в лотке, cap2 — на втором круге картин; sp — особые клетки: b бомба, i лёд, s камень.\nwindow.BUSY_PICTURES = ${JSON.stringify(result).replace(/\},\{/g, '},\n{')};\n`);
console.log('→', path.relative(root, out), result.length, 'картин');

if (process.argv.includes('--sheet')) {
  const sheet = path.join(root, 'docs', 'busy-sheet.png');
  const cols = 6, cell = 200;
  await send('Emulation.setDeviceMetricsOverride', { width: cols * cell, height: Math.ceil(result.length / cols) * cell, deviceScaleFactor: 1, mobile: false });
  await js(`(() => {
    const P = ${JSON.stringify(result)}, cols = ${cols}, cell = ${cell};
    const c = document.createElement('canvas'); c.width = cols * cell; c.height = Math.ceil(P.length / cols) * cell;
    document.body.style.margin = 0; document.body.appendChild(c);
    const g = c.getContext('2d'); g.fillStyle = '#f3ead8'; g.fillRect(0, 0, c.width, c.height);
    P.forEach((p, k) => {
      const s = Math.min((cell - 30) / p.w, (cell - 30) / p.h), ox = (k % cols) * cell + (cell - s * p.w) / 2, oy = Math.floor(k / cols) * cell + 6;
      for (let i = 0; i < p.px.length; i++) { const ch = p.px[i]; if (ch === '.') continue;
        g.fillStyle = p.pal[ch.charCodeAt(0) - 97]; g.beginPath(); g.arc(ox + (i % p.w + .5) * s, oy + (Math.floor(i / p.w) + .5) * s, s * .45, 0, 7); g.fill(); }
      g.fillStyle = '#333'; g.font = '13px sans-serif'; g.fillText(p.name + ' ' + p.cap, (k % cols) * cell + 8, Math.floor(k / cols) * cell + cell - 6);
    });
  })()`);
  await sleep(300);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(sheet), { recursive: true });
  fs.writeFileSync(sheet, Buffer.from(s.result.data, 'base64'));
  console.log('лист →', path.relative(root, sheet));
}
ws.close(); proc.kill();
