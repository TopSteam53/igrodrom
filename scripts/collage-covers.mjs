// Обложки игр каталога как картины для «Коллажа»: 640×360 JPEG в public/games/collage/img и список covers.js.
// Игре нельзя ходить за файлами других игр (адреса на сайте у них разные), поэтому копии лежат у неё.
//   node scripts/collage-covers.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const games = path.join(root, 'public', 'games');
const out = path.join(games, 'collage');
// Тёмные обложки с пустым фоном («Огонёк», «Змейка») не берём: их кусочки не различить.
const SKIP = new Set(['collage', 'ogonek', 'snake', 'rubezh']);

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('Нужен Chrome или Edge');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 400);
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'collage-'))}`, 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };

const list = [];
fs.mkdirSync(path.join(out, 'img'), { recursive: true });
for (const slug of fs.readdirSync(games).sort()) {
  if (SKIP.has(slug) || !fs.existsSync(path.join(games, slug, 'meta.json'))) continue;
  const file = ['cover.svg', 'cover.jpg', 'cover.webp', 'cover.png'].find((f) => fs.existsSync(path.join(games, slug, f)));
  if (!file) continue;
  const mime = { svg: 'image/svg+xml', jpg: 'image/jpeg', webp: 'image/webp', png: 'image/png' }[file.split('.')[1]];
  const data = `data:${mime};base64,${fs.readFileSync(path.join(games, slug, file)).toString('base64')}`;
  const jpg = await js(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(data)}; await img.decode();
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d');
    const W = img.naturalWidth || 928, H = img.naturalHeight || 522, s = Math.max(640 / W, 360 / H);
    g.imageSmoothingQuality = 'high'; g.drawImage(img, (640 - W * s) / 2, (360 - H * s) / 2, W * s, H * s);
    return c.toDataURL('image/jpeg', 0.84);
  })()`);
  fs.writeFileSync(path.join(out, 'img', `${slug}.jpg`), Buffer.from(jpg.split(',')[1], 'base64'));
  list.push({ file: `img/${slug}.jpg`, name: JSON.parse(fs.readFileSync(path.join(games, slug, 'meta.json'), 'utf8')).title });
}
fs.writeFileSync(path.join(out, 'covers.js'), `// Собрано scripts/collage-covers.mjs — обложки игр каталога как картины коллажа (640×360).\nwindow.COLLAGE_COVERS = ${JSON.stringify(list, null, 1)};\n`);
console.log(list.length, 'обложек →', path.relative(root, out));
ws.close(); proc.kill();
