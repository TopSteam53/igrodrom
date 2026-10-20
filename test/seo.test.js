// Поисковики и превью ссылок (robots.txt, sitemap.xml, og-теги), страница 404, защита регистрации от ботов.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

let server, base, dataDir, publicDir, rasterId, svgId;
let clock = Date.parse('2026-03-10T12:00:00Z');
const page = (title, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${extra}</head><body></body></html>`;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-seo-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-seopub-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), page('Главная', '<meta name="description" content="Все игры">'));
  fs.writeFileSync(path.join(publicDir, 'game.html'), page('Игра'));
  fs.writeFileSync(path.join(publicDir, '404.html'), page('Страница не найдена'));
  const games = {
    raster: { title: 'Ракета', description: 'Летите <выше> всех & не падайте. '.repeat(10), extra: { 'og.jpg': 'jpg' } },
    vector: { title: 'Квадрат', description: '', extra: {} },
  };
  for (const [slug, g] of Object.entries(games)) {
    const dir = path.join(publicDir, 'games', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(dir, 'cover.svg'), '<svg/>');
    for (const [f, body] of Object.entries(g.extra)) fs.writeFileSync(path.join(dir, f), body);
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ title: g.title, category: 'Аркады', description: g.description }));
  }
  server = createApp({
    dataDir, publicDir, seedDemoGames: true, siteUrl: 'https://igry.test/', now: () => clock,
    registerGuard: true, registerPerHour: 2,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const list = (await (await fetch(`${base}/api/games`)).json()).games;
  rasterId = list.find((g) => g.title === 'Ракета').id;
  svgId = list.find((g) => g.title === 'Квадрат').id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

const text = async (url) => { const r = await fetch(base + url); return { status: r.status, type: r.headers.get('content-type'), body: await r.text() }; };
const og = (html, prop) => (html.match(new RegExp(`<meta property="og:${prop}" content="([^"]*)">`)) || [])[1];

test('robots.txt закрывает служебные страницы и указывает карту сайта', async () => {
  const r = await text('/robots.txt');
  assert.equal(r.status, 200);
  assert.match(r.body, /Disallow: \/api\//);
  assert.match(r.body, /Disallow: \/preview\//);
  assert.match(r.body, /Sitemap: https:\/\/igry\.test\/sitemap\.xml/);
});

test('sitemap.xml: главная и страницы всех одобренных игр', async () => {
  const r = await text('/sitemap.xml');
  assert.equal(r.status, 200);
  assert.match(r.type, /xml/);
  assert.ok(r.body.includes('<loc>https://igry.test/</loc>'));
  assert.ok(r.body.includes(`<loc>https://igry.test/game.html?id=${rasterId}</loc>`));
  assert.ok(r.body.includes(`<loc>https://igry.test/game.html?id=${svgId}</loc>`));
});

test('страница игры: свой заголовок, описание и картинка для превью ссылки', async () => {
  const { body } = await text(`/game.html?id=${rasterId}`);
  assert.match(body, /<title>Ракета — играть онлайн бесплатно<\/title>/);
  assert.equal(og(body, 'title'), 'Ракета — играть онлайн бесплатно');
  assert.equal(og(body, 'image'), `https://igry.test/play/${rasterId}/og.jpg`);
  assert.equal(og(body, 'url'), `https://igry.test/game.html?id=${rasterId}`);
  const description = og(body, 'description');
  assert.ok(description.replace(/&\w+;/g, '_').length <= 200 && description.endsWith('…'));
  assert.ok(description.includes('&lt;выше&gt;') && description.includes('&amp;'), 'текст игры экранируется');
  assert.match(body, /<meta name="description" content="Летите/);

  // SVG-обложку мессенджеры не показывают — у такой игры общая картинка сайта.
  const vector = (await text(`/game.html?id=${svgId}`)).body;
  assert.equal(og(vector, 'image'), 'https://igry.test/og.jpg');
  assert.match(og(vector, 'description'), /Аркады/);

  // Неизвестная игра — превью как у обычной страницы.
  assert.equal(og((await text('/game.html?id=0000000000000000')).body, 'title'), 'Игра');
});

test('главная: превью из своего заголовка и описания', async () => {
  const { body } = await text('/');
  assert.equal(og(body, 'title'), 'Главная');
  assert.equal(og(body, 'description'), 'Все игры');
  assert.equal(og(body, 'image'), 'https://igry.test/og.jpg');
  assert.match(body, /<link rel="canonical" href="https:\/\/igry\.test\/">/);
});

test('несуществующая страница — 404 сайта, а не голый текст', async () => {
  for (const url of ['/net-takoy', '/a/b/c.html', '/404.html']) {
    const r = await text(url);
    assert.equal(r.status, 404, url);
    assert.match(r.type, /text\/html/);
    assert.match(r.body, /Страница не найдена/);
    assert.match(r.body, /<base href="\/">/);
    assert.match(r.body, /noindex/);
  }
  // API по-прежнему отвечает JSON.
  const api = await fetch(`${base}/api/net-takogo`);
  assert.equal(api.status, 404);
  assert.ok((await api.json()).error);
});

async function register(body) {
  const r = await fetch(`${base}/api/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
const ticket = async () => (await (await fetch(`${base}/api/register/ticket`)).json()).ticket;
const form = (email, extra = {}) => ({ email, password: 'secret123', name: 'Игрок', ...extra });

test('регистрация: билет формы, ловушка, ссылки в имени и лимит с одного адреса', async () => {
  // Без билета или с поддельным — отказ.
  assert.equal((await register(form('a@test.ru'))).status, 400);
  assert.equal((await register(form('a@test.ru', { ticket: `${clock}.${'0'.repeat(32)}` }))).status, 400);

  // Сразу после открытия формы — слишком быстро для человека.
  let t = await ticket();
  assert.equal((await register(form('a@test.ru', { ticket: t }))).status, 429);

  clock += 5000;
  // Поле-ловушка заполнено — это бот.
  assert.equal((await register(form('a@test.ru', { ticket: t, website: 'http://spam' }))).status, 400);
  // Ссылка в имени.
  const spam = await register(form('a@test.ru', { ticket: t, name: 'Казино top-win.ru' }));
  assert.equal(spam.status, 400);
  assert.match(spam.data.error, /ссылок/);

  assert.equal((await register(form('a@test.ru', { ticket: t }))).status, 201);
  assert.equal((await register(form('b@test.ru', { ticket: t }))).status, 201);
  // Лимит в тесте — 2 аккаунта в час с одного адреса.
  const third = await register(form('c@test.ru', { ticket: t }));
  assert.equal(third.status, 429);
  assert.match(third.data.error, /много аккаунтов/);

  // Билет живёт несколько часов, потом нужен новый.
  clock += 7 * 3600 * 1000;
  assert.equal((await register(form('d@test.ru', { ticket: t }))).status, 400);
  t = await ticket();
  clock += 5000;
  assert.notEqual((await register(form('d@test.ru', { ticket: t }))).status, 400);
});
