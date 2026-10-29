// Скачивает модели Poly Haven (CC0) для игры про перепродажу: glTF 1k со всеми текстурами.
// node scripts/perekup/fetch-polyhaven.mjs classic_laptop Camera_01 …
// Кладёт в docs/perekup/models/<id>/ (папка docs/ не в git) и дописывает docs/perekup/models/licenses.json:
// откуда модель, автор, лицензия — для страницы «Об игре» и на случай вопросов.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'docs/perekup/models');
const API = 'https://api.polyhaven.com';

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
async function download(url, file) {
  if (fs.existsSync(file)) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

const ids = process.argv.slice(2);
if (!ids.length) { console.error('укажите id моделей Poly Haven'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const licFile = path.join(OUT, 'licenses.json');
const lic = fs.existsSync(licFile) ? JSON.parse(fs.readFileSync(licFile, 'utf8')) : {};

for (const id of ids) {
  if (!/^[\w-]+$/.test(id)) throw new Error(`странный id: ${id}`);
  const [files, info] = await Promise.all([json(`${API}/files/${id}`), json(`${API}/info/${id}`)]);
  const g = files.gltf?.['1k']?.gltf;
  if (!g) { console.log(`${id}: нет glTF 1k — пропускаю`); continue; }
  const dir = path.join(OUT, id);
  await download(g.url, path.join(dir, path.basename(g.url)));
  for (const [rel, f] of Object.entries(g.include || {})) {
    const target = path.resolve(dir, rel);
    if (!target.startsWith(dir + path.sep)) throw new Error(`путь вне папки модели: ${rel}`);
    await download(f.url, target);
  }
  lic[id] = {
    source: `https://polyhaven.com/a/${id}`, license: 'CC0', name: info.name,
    authors: Object.keys(info.authors || {}), gltf: path.basename(g.url),
  };
  console.log(`${id}: готово (${Object.keys(g.include || {}).length + 1} файлов)`);
}
fs.writeFileSync(licFile, JSON.stringify(lic, null, 2) + '\n');
