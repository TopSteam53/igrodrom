// Локальный просмотр «Перекупа»: games-src/perekup по адресу /, SDK площадки — /sdk/v1.js из public/sdk.
// Вне площадки SDK сохраняет в localStorage, реклама за награду выдаётся сразу.
//   node scripts/perekup/dev.mjs [порт]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const GAME = path.join(ROOT, 'games-src/perekup');
const PORT = Number(process.argv[2] || process.env.PORT || 3030);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const base = url.startsWith('/sdk/') ? path.join(ROOT, 'public') : GAME;
  const file = path.resolve(base, `.${url === '/' ? '/index.html' : url}`);
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('нет'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Перекуп: http://localhost:${PORT}`));
