import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;

const server = createApp({
  dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
  publicDir: path.join(root, 'public'),
  adminEmails: (process.env.ADMIN_EMAILS || '').split(','),
  secureCookies: process.env.COOKIE_SECURE === '1',
});

server.listen(port, () => console.log(`Игродром: http://localhost:${port}`));
