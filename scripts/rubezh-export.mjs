// Сборка «Последнего рубежа» (godot/rubezh) для сайта: экспорт Godot в Web и упаковка в public/games/rubezh.
// index.wasm и index.pck кладутся только сжатыми (.br): сервер отдаёт их как index.wasm с Content-Encoding: br,
// так в репозитории ~9 МБ вместо ~40. meta.json и картинки каталога в public/games/rubezh не трогаются.
//
//   node scripts/rubezh-export.mjs [путь к godot.exe]
// Путь можно задать и переменной GODOT.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.join(root, 'godot', 'rubezh');
const out = path.join(root, 'public', 'games', 'rubezh');
const godot = process.argv[2] || process.env.GODOT ||
  path.join(os.homedir(), 'Downloads', 'Godot_v4.7.2-stable_win64.exe', 'Godot_v4.7.2-stable_win64_console.exe');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rubezh-export-'));
const run = (args) => execFileSync(godot, args, { cwd: project, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString();

run(['--headless', '--path', project, '--import']);
const log = run(['--headless', '--path', project, '--export-release', 'Web', path.join(tmp, 'index.html')]);
if (!fs.existsSync(path.join(tmp, 'index.wasm'))) {
  console.error(log);
  throw new Error('Godot не собрал index.wasm');
}

fs.mkdirSync(out, { recursive: true });
// Старые файлы сборки убираем, а файлы каталога (meta.json, cover.jpg, icon.jpg, og.jpg) оставляем.
const keep = new Set(['meta.json', 'cover.jpg', 'icon.jpg', 'og.jpg']);
for (const f of fs.readdirSync(out)) if (!keep.has(f)) fs.rmSync(path.join(out, f), { recursive: true, force: true });

for (const f of fs.readdirSync(tmp)) {
  const src = path.join(tmp, f);
  if (f === 'index.wasm' || f === 'index.pck') {
    const br = zlib.brotliCompressSync(fs.readFileSync(src), {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: fs.statSync(src).size },
    });
    fs.writeFileSync(path.join(out, `${f}.br`), br);
    console.log(`${f}: ${(fs.statSync(src).size / 1e6).toFixed(1)} МБ → ${f}.br ${(br.length / 1e6).toFixed(1)} МБ`);
  } else if (/\.(png|ico)$/.test(f) && f !== 'index.png') {
    continue; // значки PWA не нужны: игра живёт в рамке на сайте
  } else {
    fs.copyFileSync(src, path.join(out, f));
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Готово: ${path.relative(root, out)}`);
