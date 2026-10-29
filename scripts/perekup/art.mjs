// Обложка и иконка «Перекупа» из готовых рендеров вещей (games-src/perekup/img): лесенка от ложки до сундука,
// ценники как в игре. Снимает headless Chrome → games-src/perekup/cover.jpg (1280×720) и icon.jpg (512×512);
// сайт берёт их из корня сборки сам.
//   node scripts/perekup/art.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../..');
const GAME = path.join(ROOT, 'games-src/perekup');
const url = (p) => pathToFileURL(p).href;
const img = (id) => url(path.join(GAME, 'img', `${id}.webp`));
const font = (f) => url(path.join(ROOT, 'public/fonts', f));

const css = `
@font-face{font-family:U;font-weight:500 800;src:url(${font('unbounded-cyrillic.woff2')})}
@font-face{font-family:O;font-weight:400 700;src:url(${font('onest-cyrillic.woff2')});unicode-range:U+0400-045F}
@font-face{font-family:O;font-weight:400 700;src:url(${font('onest-latin.woff2')});unicode-range:U+0000-00FF,U+20BD}
*{margin:0;box-sizing:border-box}
body{width:var(--w);height:var(--h);overflow:hidden;position:relative;font-family:O,sans-serif;
  background:#FFFFFF}
.it{position:absolute;object-fit:contain;mix-blend-mode:multiply;
  /* у рендера вещь занимает середину, а по краям — серый край пола: гасим рамку 8 %, вещь не задевает */
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent),linear-gradient(transparent,#000 8%,#000 92%,transparent);
  -webkit-mask-composite:source-in;mask-composite:intersect} /* белый фон рендера и тень ложатся на фон */
.tag{position:absolute;padding:6px 14px 7px;border-radius:12px;font:700 26px O;color:#fff;white-space:nowrap;
  box-shadow:0 6px 14px rgba(0,0,0,.18)}
.low{background:#6B7280}.high{background:#22C36A}
h1{position:absolute;left:56px;bottom:112px;font:800 104px/1 U;color:#1D1F24;letter-spacing:-2px}
p{position:absolute;left:60px;bottom:58px;font:600 38px/1 O;color:#4B5160}
`;

// Вещи по ступеням цены: дешёвое слева внизу, клад справа и крупнее.
const cover = `<style>${css}</style>
<img class="it" src="${img('spoon')}" style="left:8px;top:150px;width:200px;height:200px;transform:rotate(-8deg)">
<img class="it" src="${img('duck')}" style="left:150px;top:118px;width:200px;height:200px">
<img class="it" src="${img('boombox')}" style="left:330px;top:40px;width:270px;height:270px">
<img class="it" src="${img('tv')}" style="left:560px;top:40px;width:250px;height:250px">
<img class="it" src="${img('ship')}" style="left:930px;top:-40px;width:380px;height:380px">
<img class="it" src="${img('chest')}" style="left:720px;top:210px;width:520px;height:520px">
<div class="tag low" style="left:196px;top:300px">120 ₽</div>
<div class="tag high" style="left:960px;top:296px">150 млн ₽</div>
<h1>Перекуп</h1><p>от хлама до клада</p>`;

const icon = `<style>${css}</style>
<img class="it" src="${img('chest')}" style="left:6px;top:56px;width:500px;height:500px">
<div class="tag high" style="left:50%;top:44px;transform:translateX(-50%);font-size:52px;padding:10px 26px 12px;border-radius:20px">150 млн ₽</div>`;

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('Нужен Chrome или Edge');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perekup-art-'));
const port = 9300 + Math.floor(Math.random() * 400);
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${tmp}`, '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

async function shot(name, html, w, h) {
  const file = path.join(tmp, `${name}.html`);
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><body style="--w:${w}px;--h:${h}px">${html}`);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: url(file) });
  await sleep(300);
  await send('Runtime.evaluate', { expression: 'Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode())])', awaitPromise: true });
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
  fs.writeFileSync(path.join(GAME, `${name}.jpg`), Buffer.from(r.result.data, 'base64'));
  console.log(`${name}.jpg ${w}×${h}`);
}
await send('Page.enable');
await shot('cover', cover, 1280, 720);
await shot('icon', icon, 512, 512);
ws.close(); proc.kill();
