// Кабинет разработчика: тестовый запуск с журналом и скачивание своей сборки и картинок.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { createApp } from '../server/app.js';
import { TEST_CONSOLE_TAG, injectHead, testRunHtml } from '../server/gamedev.js';
import { extractZip } from '../server/zip.js';
import { makeZip } from './make-zip.js';

const SECRET = 'test-secret';
let server, base, dataDir, publicDir, owner, dev, stranger, gameId;

function browser() {
  const jar = {};
  const call = async (method, url, body, type = 'application/json') => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method,
      headers: { ...(cookie && { cookie }), ...(body !== undefined && { 'content-type': type }) },
      body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      jar[kv.slice(0, kv.indexOf('='))] = kv.slice(kv.indexOf('=') + 1);
    }
    return res;
  };
  const json = async (...args) => {
    const res = await call(...args);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  json.raw = call;
  return json;
}
function png(w, h) {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
const GAME_HTML = '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<script src="js/main.js"></script>\n</head><body><canvas></canvas>v1</body></html>';
const build = (htmlText = GAME_HTML) => makeZip([
  { name: 'index.html', data: htmlText },
  { name: 'js/main.js', data: 'console.log("привет");\n'.repeat(50) },
  { name: 'img/hero.png', data: png(64, 64), method: 0 },
]);

async function download(who, part) {
  const res = await who.raw('GET', `/api/games/${gameId}/download${part ? `?part=${part}` : ''}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), buf };
}
// Архив картинок — без index.html, поэтому extractZip его не примет: читаем центральный каталог сами.
function names(zip) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = zip.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < zip.readUInt16LE(eocd + 10); i++) {
    const len = zip.readUInt16LE(p + 28);
    out.push(zip.subarray(p + 46, p + 46 + len).toString('utf8'));
    p += 46 + len + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return out.sort();
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-tr-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-trpub-'));
  server = createApp({ dataDir, publicDir, adminEmails: ['owner@test.ru'], previewSecret: SECRET });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  owner = browser();
  await owner('POST', '/api/register', { email: 'owner@test.ru', password: 'secret123', name: 'Владелец' });
  dev = browser();
  await dev('POST', '/api/register', { email: 'dev@test.ru', password: 'secret123', name: 'Сигна' });
  const devId = (await dev('GET', '/api/me')).data.user.id;
  await dev('POST', '/api/developer/application', { studio: 'Signa Inc', about: 'Делаем аркады для браузера и телефонов.', contact: '@signa' });
  await owner('POST', `/api/admin/developers/${devId}`, { action: 'approve' });
  stranger = browser();
  await stranger('POST', '/api/register', { email: 'other@test.ru', password: 'secret123', name: 'Чужой' });
  const up = await dev('POST', `/api/games?${new URLSearchParams({ title: 'Ракета', genre: 'Аркады' })}`, build(), 'application/zip');
  assert.equal(up.status, 201);
  gameId = up.data.game.id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

test('журнал вставляется первым в <head>, doctype остаётся первым', () => {
  const tag = '<script src="/x.js"></script>';
  const out = (s) => injectHead(Buffer.from(s, 'latin1'), tag).toString('latin1');
  assert.equal(out('<!doctype html><html><head lang="ru"><title>a</title></head></html>'),
    `<!doctype html><html><head lang="ru">${tag}<title>a</title></head></html>`);
  assert.equal(out('<!DOCTYPE html><html><body>x</body></html>'), `<!DOCTYPE html><html>${tag}<body>x</body></html>`);
  assert.equal(out('<!doctype html><canvas></canvas>'), `<!doctype html>${tag}<canvas></canvas>`);
  assert.equal(out('<canvas></canvas>'), `${tag}<canvas></canvas>`);
  assert.equal(out('<html><header>x</header></html>'), `<html>${tag}<header>x</header></html>`, '<header> — не <head>');
  // Байты не в UTF-8 не портятся.
  const cp1251 = Buffer.from([0x3c, 0x68, 0x65, 0x61, 0x64, 0x3e, 0xcf, 0xf0, 0xe8]);
  assert.deepEqual(injectHead(cp1251, tag).subarray(-3), Buffer.from([0xcf, 0xf0, 0xe8]));
});

test('скрипты игры из её папки получают crossorigin — иначе браузер прячет текст ошибок', () => {
  const html = `<head><script src="js/a.js"></script><script src="/sdk.js"></script><script src = 'b.js'></script>` +
    `<script data-src="x" src="https://cdn.test/x.js"></script><script crossorigin="use-credentials" src="c.js"></script>` +
    `<script type=module src=./m.js></script><script>var a = 1</script>`;
  assert.equal(testRunHtml(Buffer.from(html)).toString(), `<head>${TEST_CONSOLE_TAG}<script crossorigin src="js/a.js"></script>` +
    `<script src="/sdk.js"></script><script crossorigin src = 'b.js'></script><script data-src="x" src="https://cdn.test/x.js"></script>` +
    `<script crossorigin="use-credentials" src="c.js"></script><script crossorigin type=module src=./m.js></script><script>var a = 1</script>`);
});

test('тестовый запуск: подписанная ссылка, журнал только в тестовом режиме, доступ автору и модераторам', async () => {
  assert.equal((await browser()('GET', `/api/games/${gameId}/test-run`)).status, 401);
  assert.equal((await stranger('GET', `/api/games/${gameId}/test-run`)).status, 404, 'чужому игроку игра не видна');
  const r = await dev('GET', `/api/games/${gameId}/test-run`);
  assert.equal(r.status, 200);
  assert.equal(r.data.mine, true);
  assert.deepEqual(r.data.builds.map((b) => [b.build, b.title]), [['cur', 'Черновик']]);
  const url = r.data.builds[0].url;
  assert.match(url, new RegExp(`^/test-run/${gameId}\\.cur\\.\\d+\\.[0-9a-f]{32}/$`));
  const mod = await owner('GET', `/api/games/${gameId}/test-run`);
  assert.equal(mod.status, 200, 'владелец площадки тоже открывает');
  assert.equal(mod.data.mine, false);

  // HTML игры — с журналом первым в <head>, остальные файлы — байт в байт.
  const page = await fetch(base + url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /^sandbox allow-scripts/);
  const text = await page.text();
  assert.ok(text.startsWith(`<!doctype html>\n<html lang="ru">\n<head>${TEST_CONSOLE_TAG}\n<meta charset="utf-8">\n<script crossorigin src="js/main.js">`), text.slice(0, 160));
  const missing = await fetch(`${base}${url}data/levels.json`);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('access-control-allow-origin'), '*', 'игра в песочнице видит 404, а не сетевую ошибку');
  assert.equal(Number(page.headers.get('content-length')), Buffer.byteLength(text));
  const js = await fetch(`${base}${url}js/main.js`);
  assert.equal(await js.text(), 'console.log("привет");\n'.repeat(50));
  assert.equal((await fetch(`${base}${url.slice(0, -1)}`, { redirect: 'manual' })).status, 301, 'без слэша — на папку');

  // Обычная проверка и опубликованная игра журнала не получают.
  const mine = (await dev('GET', '/api/my/games')).data.games[0];
  const preview = await (await fetch(base + mine.preview_url)).text();
  assert.ok(!preview.includes('test-run-console'), 'в обычной проверке журнала нет');

  // Сам журнал отдаётся скриптом.
  const sc = await fetch(`${base}/test-run-console.js`);
  assert.equal(sc.status, 200);
  assert.match(sc.headers.get('content-type'), /javascript/);
  assert.match(await sc.text(), /gamely-console/);

  // Подделанная и просроченная подписи — отказ, хотя подпись проверки (preview) у той же игры есть.
  const [, exp, sig] = url.match(/\.(\d+)\.([0-9a-f]{32})\/$/);
  const bad = `${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`;
  assert.equal((await fetch(`${base}/test-run/${gameId}.cur.${exp}.${bad}/`)).status, 404);
  assert.equal((await fetch(`${base}/test-run/${gameId}.next.${exp}.${sig}/`)).status, 404, 'подпись привязана к сборке');
  const old = 1000;
  const oldSig = createHmac('sha256', SECRET).update(`${gameId}.test.cur.${old}`).digest('hex').slice(0, 32);
  assert.equal((await fetch(`${base}/test-run/${gameId}.cur.${old}.${oldSig}/`)).status, 404, 'просроченная ссылка');
  const previewSig = mine.preview_url.match(/\.(\d+)\.([0-9a-f]{32})\/$/);
  assert.equal((await fetch(`${base}/test-run/${gameId}.cur.${previewSig[1]}.${previewSig[2]}/`)).status, 404, 'подпись проверки не подходит');

  const robots = await (await fetch(`${base}/robots.txt`)).text();
  assert.match(robots, /Disallow: \/test-run\//);
  assert.match(robots, /Disallow: \/cabinet/, '/cabinet-test тоже закрыт');
});

test('тестовые запуски не считаются в статистике', async () => {
  assert.equal((await owner('POST', `/api/admin/games/${gameId}`, { action: 'approve' })).status, 200);
  const { builds } = (await dev('GET', `/api/games/${gameId}/test-run`)).data;
  assert.equal(builds[0].title, 'Опубликованная версия');
  for (let i = 0; i < 3; i++) {
    assert.equal((await fetch(base + builds[0].url)).status, 200);
    assert.equal((await fetch(`${base}${builds[0].url}js/main.js`)).status, 200);
  }
  const plays = async () => (await dev('GET', '/api/my/stats?days=7')).data.totals.plays;
  assert.equal(await plays(), 0, 'файлы тестового запуска запусков не добавляют');
  // Для сравнения: настоящий запуск со страницы игры считается.
  assert.equal((await browser()('POST', `/api/games/${gameId}/play`)).data.counted, true);
  assert.equal(await plays(), 1);
  // Опубликованная игра по /play/ — без журнала.
  assert.ok(!(await (await fetch(`${base}/play/${gameId}/`)).text()).includes('test-run-console'));
});

test('скачивание сборки, новой версии и картинок: только автору и модераторам', async () => {
  assert.equal((await download(browser(), 'build')).status, 401);
  assert.equal((await download(stranger, 'build')).status, 404);
  assert.equal((await download(dev, 'zip')).status, 400);

  const b = await download(dev, 'build');
  assert.equal(b.status, 200);
  assert.equal(b.type, 'application/zip');
  assert.match(b.disposition, /^attachment; filename="raketa-build\.zip"$/, 'имя файла — из адреса игры');
  const files = extractZip(b.buf);
  assert.deepEqual(files.map((f) => f.path).sort(), ['img/hero.png', 'index.html', 'js/main.js']);
  assert.equal(files.find((f) => f.path === 'index.html').data.toString(), GAME_HTML, 'журнал в скачанную сборку не попадает');
  assert.equal((await download(owner, 'build')).status, 200, 'модератор тоже скачивает');

  // Картинок ещё нет — 404; потом обложка, иконка и скриншоты под понятными именами. В архив сборки они не идут.
  assert.equal((await download(dev, 'media')).status, 404);
  await dev('POST', `/api/games/${gameId}/media/cover`, png(1280, 720), 'image/png');
  await dev('POST', `/api/games/${gameId}/media/icon`, png(512, 512), 'image/png');
  await dev('POST', `/api/games/${gameId}/media/shot`, png(1280, 720), 'image/png');
  await dev('POST', `/api/games/${gameId}/media/shot`, png(1280, 720), 'image/png');
  const m = await download(dev, 'media');
  assert.equal(m.status, 200);
  assert.match(m.disposition, /filename="raketa-images\.zip"/);
  assert.deepEqual(names(m.buf), ['cover.png', 'icon.png', 'screenshot-1.png', 'screenshot-2.png']);
  assert.ok(!extractZip((await download(dev, 'build')).buf).some((f) => f.path.startsWith('_media/')), 'картинки кабинета — отдельно');

  // Новая версия на проверке: своя сборка для тестового запуска и скачивания.
  assert.equal((await download(dev, 'next')).status, 404);
  const v2 = GAME_HTML.replace('v1', 'v2');
  assert.equal((await dev('POST', `/api/games/${gameId}/build`, build(v2), 'application/zip')).data.next_status, 'pending');
  const n = await download(dev, 'next');
  assert.equal(n.status, 200);
  assert.match(n.disposition, /filename="raketa-build-next\.zip"/);
  assert.equal(extractZip(n.buf).find((f) => f.path === 'index.html').data.toString(), v2);
  assert.equal(extractZip((await download(dev, 'build')).buf).find((f) => f.path === 'index.html').data.toString(), GAME_HTML);

  const { builds } = (await dev('GET', `/api/games/${gameId}/test-run`)).data;
  assert.deepEqual(builds.map((x) => x.build), ['cur', 'next']);
  const next = await (await fetch(base + builds[1].url)).text();
  assert.ok(next.includes(TEST_CONSOLE_TAG) && next.includes('v2'));
  assert.ok((await (await fetch(base + builds[0].url)).text()).includes('v1'));
});
