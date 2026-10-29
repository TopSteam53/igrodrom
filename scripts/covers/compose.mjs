// Название поверх 3D-обложки: docs/covers/out/<slug>.png (рендер scripts/blender/covers) + заголовок шрифтом сайта
// Unbounded → docs/covers/final/<slug>.jpg. С --apply ещё и public/games/<slug>/cover.jpg (старые cover.svg/webp/png
// удаляются: сайт и «Коллаж» берут первую найденную обложку, svg иначе перебил бы новую).
//   node scripts/covers/compose.mjs [--apply] [slug…]      без slug — все, у кого есть рендер
// Заголовок слева снизу, белый с тёмной обводкой и мягкой тенью; длинное название переносится на две строки
// и уменьшается, пока не влезет в левые 46 % кадра. Подпись в meta.json можно сократить полем cover_title.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'docs/covers/out');
const FINAL = path.join(ROOT, 'docs/covers/final');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const only = args.filter((a) => !a.startsWith('--'));
const slugs = (only.length ? only : fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))).sort();
const url = (p) => pathToFileURL(p).href;
const font = (f) => url(path.join(ROOT, 'public/fonts', f));

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('Нужен Chrome или Edge');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'covers-'));
const port = 9300 + Math.floor(Math.random() * 400);
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${tmp}`, '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
fs.mkdirSync(FINAL, { recursive: true });
for (const slug of slugs) {
  const metaFile = path.join(ROOT, 'public/games', slug, 'meta.json');
  if (!fs.existsSync(metaFile)) { console.log(`${slug}: нет public/games/${slug}/meta.json, пропуск`); continue; }
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  // Короткие слова («в», «и») не остаются в конце строки: неразрывный пробел после них.
  const title = String(meta.cover_title || meta.title).replace(/(^|\s)(\S{1,2})\s/g, '$1$2\u00a0');
  const html = `<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:U;font-weight:500 800;src:url(${font('unbounded-cyrillic.woff2')});unicode-range:U+0400-045F}
    @font-face{font-family:U;font-weight:500 800;src:url(${font('unbounded-latin.woff2')});unicode-range:U+0000-00FF,U+2000-206F}
    *{margin:0}body{width:1280px;height:720px;overflow:hidden;position:relative;background:#000}
    img{position:absolute;inset:0;width:1280px;height:720px}
    /* затемнение снизу слева под названием и лёгкая виньетка — буквы читаются на любом фоне */
    .shade{position:absolute;inset:0;background:radial-gradient(70% 80% at 0% 100%,rgba(16,8,40,.42),transparent 70%),radial-gradient(130% 120% at 60% 40%,transparent 60%,rgba(10,6,30,.28))}
    h1{position:absolute;left:56px;bottom:52px;width:${Math.round(1280 * 0.46)}px;font:800 104px/1.02 U;color:#fff;letter-spacing:-1px;
      paint-order:stroke fill;-webkit-text-stroke:10px rgba(24,12,48,.55);text-shadow:0 8px 26px rgba(10,6,30,.45);overflow-wrap:normal;hyphens:manual}
  </style><img src="${url(path.join(OUT, `${slug}.png`))}"><div class="shade"></div><h1 id="t">${esc(title)}</h1>
  <script>
    // Подгоняем кегль: не шире зоны заголовка и не больше двух строк.
    document.fonts.ready.then(() => {
      const t = document.getElementById('t'); let s = 104;
      const lines = () => Math.round(t.getBoundingClientRect().height / (s * 1.02));
      while (s > 44 && (t.scrollWidth > t.clientWidth + 1 || lines() > 2)) { s -= 4; t.style.fontSize = s + 'px'; t.style.webkitTextStroke = Math.max(6, s / 10) + 'px rgba(24,12,48,.55)'; }
      document.title = 'ready';
    });
  </script>`;
  const file = path.join(tmp, `${slug}.html`);
  fs.writeFileSync(file, html);
  await send('Page.navigate', { url: url(file) });
  for (let i = 0; i < 50; i++) { await sleep(100); const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }); if (r.result?.result?.value === 'ready') break; }
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 } });
  const jpg = Buffer.from(shot.result.data, 'base64');
  fs.writeFileSync(path.join(FINAL, `${slug}.jpg`), jpg);
  if (apply) {
    const dir = path.join(ROOT, 'public/games', slug);
    for (const old of ['cover.svg', 'cover.webp', 'cover.png']) fs.rmSync(path.join(dir, old), { force: true });
    fs.writeFileSync(path.join(dir, 'cover.jpg'), jpg);
  }
  console.log(`${slug}: «${title}»${apply ? ' → public' : ''}`.replace(' → ', ', записано в '));
}
ws.close(); proc.kill();
