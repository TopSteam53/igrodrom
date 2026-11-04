import fs from 'node:fs';
import path from 'node:path';

// В рабочей папке могут лежать пробные экспорты. Выпуск задаётся отдельно от наличия index.html.
export function demoGames(root) {
  if (!fs.existsSync(root)) return [];
  const manifest = path.join(root, 'releases.json');
  let released = null;
  if (fs.existsSync(manifest)) {
    const slugs = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (!Array.isArray(slugs) || slugs.some((s) => typeof s !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(s))) {
      throw new Error('games/releases.json: нужен список адресов готовых игр');
    }
    released = new Set(slugs);
  }
  return fs.readdirSync(root).sort().flatMap((slug) => {
    if (released && !released.has(slug)) return [];
    const src = path.join(root, slug);
    if (!fs.existsSync(path.join(src, 'meta.json')) || !fs.existsSync(path.join(src, 'index.html'))) return [];
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(src, 'meta.json'), 'utf8')); } catch { return []; }
    return meta.published === false ? [] : [{ slug, src, meta }];
  });
}
