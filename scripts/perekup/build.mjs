// Сборка «Перекупа» (games-src/perekup): список предметов из scripts/perekup/items.json → js/items.js, шрифты сайта,
// файл лицензий моделей. С --zip ещё и архив dist/perekup.zip для загрузки через кабинет разработчика.
//   node scripts/perekup/build.mjs [--zip]
import fs from 'node:fs';
import path from 'node:path';
import { createZip } from '../../server/zip.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const GAME = path.join(ROOT, 'games-src/perekup');
const { items } = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/perekup/items.json'), 'utf8'));

// Интерьеры (квартиры) сняты целиком, без белого фона — в карточке растягиваются на всю площадь.
const FULL = new Set(['own:studio', 'own:penthouse']);
const list = items.map(({ id, title, price, tier, model }) => ({ id, title, price, tier, ...(FULL.has(model) && { full: true }) }));
const missing = list.filter((i) => !fs.existsSync(path.join(GAME, 'img', `${i.id}.webp`))).map((i) => i.id);
fs.writeFileSync(path.join(GAME, 'js/items.js'),
  `// Сгенерировано scripts/perekup/build.mjs из scripts/perekup/items.json — правьте там.\n'use strict';\nwindow.ITEMS = ${JSON.stringify(list, null, 1)};\n`);

fs.mkdirSync(path.join(GAME, 'fonts'), { recursive: true });
for (const f of ['onest-cyrillic.woff2', 'onest-latin.woff2', 'OFL-Onest.txt']) {
  fs.copyFileSync(path.join(ROOT, 'public/fonts', f), path.join(GAME, 'fonts', f));
}

// Лицензии моделей — только тех, что вошли в игру (CC0, Poly Haven), для честности перед авторами.
const lic = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/perekup/models/licenses.json'), 'utf8'));
const used = new Set(items.map((i) => i.model));
const lines = ['Модели и HDRI — Poly Haven (polyhaven.com), лицензия CC0. Шрифт Onest — SIL OFL 1.1.', ''];
for (const [id, l] of Object.entries(lic)) if (used.has(id) || id.startsWith('hdri:')) lines.push(`${l.name} — ${l.source} (${(l.authors || []).join(', ') || 'Poly Haven'})`);
fs.writeFileSync(path.join(GAME, 'CREDITS.txt'), `${lines.join('\n')}\n`);

console.log(`предметов ${list.length}, без картинки: ${missing.length ? missing.join(', ') : 'нет'}`);

if (process.argv.includes('--zip')) {
  const files = [];
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else files.push({ path: r, data: fs.readFileSync(path.join(dir, e.name)), compress: !/\.(webp|woff2)$/.test(e.name) });
    }
  };
  walk(GAME);
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const zip = createZip(files);
  fs.writeFileSync(path.join(ROOT, 'dist/perekup.zip'), zip);
  console.log(`dist/perekup.zip: ${files.length} файлов, ${(zip.length / 1048576).toFixed(1)} МБ`);
}
