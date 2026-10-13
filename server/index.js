import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(dataDir, { recursive: true });

// Preview links must survive restarts, so the secret is kept next to the data unless set explicitly.
function loadPreviewSecret() {
  if (process.env.PREVIEW_SECRET) return process.env.PREVIEW_SECRET;
  const file = path.join(dataDir, 'preview-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

const server = createApp({
  dataDir,
  publicDir: path.join(root, 'public'),
  adminEmails: (process.env.ADMIN_EMAILS || '').split(','),
  secureCookies: process.env.COOKIE_SECURE === '1',
  trustProxy: process.env.TRUST_PROXY === '1',
  previewSecret: loadPreviewSecret(),
});

server.listen(port, () => console.log(`Игродром: http://localhost:${port}`));

// Docker and systemd stop the process with SIGTERM: finish requests and close the database cleanly.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
