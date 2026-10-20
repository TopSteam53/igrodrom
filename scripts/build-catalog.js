// Собирает public/games/catalog.json из public/games/<slug>/meta.json.
// Этот файл нужен статической версии (GitHub Pages), где нет сервера и API.
// Запуск: npm run build:catalog
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'games');
const COVERS = ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp', 'cover.svg'];
const ICONS = ['icon.png', 'icon.jpg', 'icon.jpeg', 'icon.webp', 'icon.svg'];

export function buildCatalog() {
  const games = fs.readdirSync(root)
    .filter((slug) => fs.existsSync(path.join(root, slug, 'meta.json')) && fs.existsSync(path.join(root, slug, 'index.html')))
    .sort()
    .map((slug) => {
      const meta = JSON.parse(fs.readFileSync(path.join(root, slug, 'meta.json'), 'utf8'));
      return {
        id: slug,
        title: meta.title,
        genre: meta.category,
        age: meta.age || '0+',
        description: meta.description || '',
        how_to_play: meta.how_to_play || '',
        author: 'Игродром',
        cover: COVERS.find((f) => fs.existsSync(path.join(root, slug, f))) || null,
        icon: ICONS.find((f) => fs.existsSync(path.join(root, slug, f))) || null,
        featured: Number.isInteger(meta.featured) ? meta.featured : 0,
      };
    });
  return `${JSON.stringify({ games }, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(root, 'catalog.json'), buildCatalog());
  console.log('public/games/catalog.json обновлён');
}
