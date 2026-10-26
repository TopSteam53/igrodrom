// Награды игрокам: серия входов, достижения, турнир недели, приглашения друзей.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { STREAK_COINS, MAX_INVITES, INVITE_COINS, INVITED_COINS, INVITE_WEEK_PRIZES } from '../server/rewards.js';

let server, base, dataDir, publicDir, gameId, otherId, gameTitle;
const mail = [];
let clock = Date.parse('2026-03-02T09:00:00Z'); // понедельник, 12:00 по Москве
const DAY = 864e5;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-rew-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-rewpub-'));
  for (const slug of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(publicDir, 'games', slug), { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(publicDir, 'games', slug, 'meta.json'), JSON.stringify({ title: slug, category: 'Аркады' }));
  }
  server = createApp({
    dataDir, publicDir, adminEmails: ['owner@test.ru'], seedDemoGames: true, siteUrl: 'https://igry.test',
    mailer: { enabled: true, send: async (m) => { mail.push(m); } },
    now: () => clock, trustProxy: true, statsTz: 'Europe/Moscow',
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const { games } = await (await fetch(`${base}/api/games`)).json();
  [gameId, otherId] = games.map((g) => g.id).sort();
  gameTitle = games.find((g) => g.id === gameId).title;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

// Браузер со своими cookie и адресом (адрес приходит в X-Forwarded-For: сервер стоит за «прокси»).
function browser(ip = '10.0.0.1', jar = {}) {
  const b = async (method, url, json) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method,
      headers: { 'x-forwarded-for': ip, ...(cookie && { cookie }), ...(json && { 'content-type': 'application/json' }) },
      body: json ? JSON.stringify(json) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      jar[kv.slice(0, kv.indexOf('='))] = kv.slice(kv.indexOf('=') + 1);
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  b.jar = jar;
  return b;
}
async function player(email, name = 'Игрок', ip = '10.0.0.1', jar = {}) {
  const b = browser(ip, jar);
  const r = await b('POST', '/api/register', { email, password: 'secret123', name });
  assert.equal(r.status, 201, r.data?.error);
  return b;
}
const verifyToken = (to) => [...mail].reverse().find((x) => x.to === to).text.match(/verify\.html\?token=([\w-]+)/)[1];
const verify = (b, email) => b('POST', '/api/email/verify', { token: verifyToken(email) });
const coins = async (b) => (await b('GET', '/api/me')).data.user.coins;
const history = async (b) => (await b('GET', '/api/me/coins')).data.history;

test('серия входов: растёт день за днём, круг из семи дней, пропуск дня — заново', async () => {
  clock = Date.parse('2026-03-02T09:00:00Z');
  const p = await player('streak@test.ru', 'Серия');
  let info = (await p('GET', '/api/me/coins')).data.daily;
  assert.deepEqual([info.available, info.streak, info.day, info.amount], [true, 0, 1, 5]);
  assert.deepEqual(info.days, STREAK_COINS);

  const expected = [5, 6, 7, 8, 10, 12, 20, 5, 6];
  for (let i = 0; i < expected.length; i++) {
    const d = (await p('POST', '/api/me/coins/daily')).data;
    assert.equal(d.claimed, expected[i], `день ${i + 1}`);
    assert.equal(d.streak.streak, i + 1);
    assert.equal(d.streak.day, (i % 7) + 1, 'после седьмого дня круг начинается снова');
    assert.equal((await p('POST', '/api/me/coins/daily')).data.claimed, 0, 'второй раз за день — ничего');
    clock += DAY;
  }
  // «Три дня подряд» и «Неделя подряд» — уведомлением через /api/me/news, один раз.
  assert.deepEqual((await p('POST', '/api/me/news')).data.achievements.map((a) => a.key), ['streak3', 'streak7']);
  assert.deepEqual((await p('POST', '/api/me/news')).data.achievements, []);
  // Поздно вечером и рано утром по Москве — разные дни, хотя по UTC это одни сутки.
  clock = Date.parse('2026-03-11T20:59:00Z'); // 23:59 МСК 11 марта — десятый день подряд
  assert.equal((await p('POST', '/api/me/coins/daily')).data.claimed, 7);
  clock = Date.parse('2026-03-11T21:01:00Z'); // 00:01 МСК 12 марта
  assert.equal((await p('POST', '/api/me/coins/daily')).data.claimed, 8);

  // Пропустили 13 марта — серия сначала.
  clock = Date.parse('2026-03-14T09:00:00Z');
  info = (await p('GET', '/api/me/coins')).data.daily;
  assert.deepEqual([info.available, info.streak, info.amount], [true, 0, 5]);
  const d = (await p('POST', '/api/me/coins/daily')).data;
  assert.deepEqual([d.claimed, d.streak.streak, d.streak.tomorrow], [5, 1, 6]);

  const daily = (await history(p)).filter((h) => h.kind === 'daily');
  assert.equal(daily.length, 12);
  assert.equal(daily.reduce((n, h) => n + h.delta, 0), 5 + 6 + 7 + 8 + 10 + 12 + 20 + 5 + 6 + 7 + 8 + 5);
  assert.equal(await coins(p), 50 + 99 + 5 + 20, 'подарок, бонусы и награды за «Три дня» и «Неделю подряд»');
  assert.equal((await browser()('POST', '/api/me/coins/daily')).status, 401);
});

test('достижения: условия по данным сайта, награда выдаётся один раз', async () => {
  clock = Date.parse('2026-03-16T09:00:00Z');
  const p = await player('ach@test.ru', 'Ачивка');
  let r = (await p('GET', '/api/me/rewards')).data;
  assert.equal(r.achievements.length >= 10, true);
  assert.ok(r.achievements.every((a) => a.title && a.cond && a.coins >= 5 && a.coins <= 100 && a.earned_at === null));
  assert.ok(r.achievements.every((a) => r.cats[a.cat] && ['bronze', 'silver', 'gold'].includes(a.tier) && a.icon), 'раздел, уровень, значок');
  const news = async () => (await p('POST', '/api/me/news')).data.achievements.map((a) => a.key).sort();
  assert.deepEqual(await news(), []);

  // Аватарка — достижение при следующей загрузке профиля.
  await p('PUT', '/api/me/avatar', { preset: 3 });
  r = (await p('GET', '/api/me/rewards')).data;
  assert.equal(r.coins, 60);
  assert.equal((await p('GET', '/api/me')).data.user.news, true, 'есть новость — шапка спросит /api/me/news');
  assert.deepEqual(await news(), ['avatar']);
  assert.equal((await p('GET', '/api/me')).data.user.news, false);
  r = (await p('GET', '/api/me/rewards')).data;
  assert.deepEqual(await news(), [], 'второй раз не показывается и не выдаётся');
  assert.equal(r.coins, 60);
  // Убрал аватарку — достижение остаётся, повторно не начисляется.
  await p('PUT', '/api/me/avatar', { preset: null });
  await p('PUT', '/api/me/avatar', { preset: 5 });
  assert.equal((await p('GET', '/api/me/rewards')).data.coins, 60);

  // Рекорд — сразу после отправки результата.
  await p('POST', `/api/games/${gameId}/leaderboard`, { score: 10 });
  await p('POST', `/api/games/${gameId}/leaderboard`, { score: 20 });
  r = (await p('GET', '/api/me/rewards')).data;
  const by = Object.fromEntries(r.achievements.map((a) => [a.key, a]));
  assert.ok(by.record.earned_at);
  assert.deepEqual([by.records5.value, by.records5.goal, by.records5.earned_at], [1, 5, null], 'прогресс «1 из 5»');
  assert.equal(r.coins, 70);

  // Почта подтверждена — «Настоящая почта». Потом отзыв (только с подтверждённой почтой) и покупка в игре.
  assert.equal((await verify(p, 'ach@test.ru')).status, 200);
  assert.equal(await coins(p), 80);
  assert.equal((await p('PUT', `/api/games/${gameId}/reviews`, { text: 'Хорошая игра' })).status, 200);
  assert.equal((await p('POST', `/api/games/${gameId}/coins/spend`, { amount: 5, title: 'Щит' })).status, 200);
  r = (await p('GET', '/api/me/rewards')).data;
  assert.deepEqual(await news(), ['email', 'record', 'review', 'spend']);
  assert.equal(r.coins, 80 - 5 + 10 + 10);

  const ach = (await history(p)).filter((h) => h.kind === 'achievement');
  assert.deepEqual(ach.map((h) => h.title).sort(),
    ['Достижение «Настоящая почта»', 'Достижение «Первая покупка»', 'Достижение «Первый отзыв»', 'Достижение «Первый рекорд»', 'Достижение «Своё лицо»']);
  assert.equal((await browser()('GET', '/api/me/rewards')).status, 401);
});

test('турнир недели: зачёт только по выбранной игре и неделе, призы трём лучшим один раз', async () => {
  clock = Date.parse('2026-04-06T09:00:00Z'); // понедельник
  const owner = await player('owner@test.ru', 'Владелец');
  const [a, b, c, d, x] = await Promise.all(['a', 'b', 'c', 'd', 'x'].map((n) => player(`t-${n}@test.ru`, `Игрок ${n.toUpperCase()}`)));
  const start = { a: await coins(a), b: await coins(b), c: await coins(c) };

  // Турнира нет — ничего не показываем.
  assert.equal((await a('GET', '/api/tournament')).data.tournament, null);

  // Рекорд, поставленный с понедельника до объявления турнира, тоже в зачёте.
  clock += 3600e3;
  await x('POST', `/api/games/${gameId}/leaderboard`, { score: 70 });

  assert.equal((await a('POST', '/api/admin/tournaments', { when: 'current', game_id: gameId, board: 'main' })).status, 403);
  assert.equal((await owner('POST', '/api/admin/tournaments', { when: 'вчера', game_id: gameId })).status, 400);
  assert.equal((await owner('POST', '/api/admin/tournaments', { when: 'current', game_id: '0000000000000000' })).status, 404);
  assert.equal((await owner('POST', '/api/admin/tournaments', { when: 'current', game_id: gameId, board: 'не так' })).status, 400);
  const set = await owner('POST', '/api/admin/tournaments', { when: 'current', game_id: gameId, board: 'main' });
  assert.equal(set.status, 200);
  assert.equal(set.data.tournament.week, '2026-04-06');

  const score = (p, s, extra = {}) => { clock += 60e3; return p('POST', `/api/games/${extra.game || gameId}/leaderboard`, { score: s, board: extra.board }); };
  await score(a, 100);
  await score(b, 50);
  await score(c, 120);
  await score(d, 10);
  await score(b, 110);
  await score(a, 90); // хуже своего — не меняет
  await score(d, 500, { board: 'hard' }); // другая таблица
  await score(d, 900, { game: otherId }); // другая игра

  let t = (await a('GET', '/api/tournament')).data.tournament;
  assert.equal(t.game.id, gameId);
  assert.equal(t.ends_at, Date.parse('2026-04-12T21:00:00Z'), 'конец — полночь понедельника по Москве');
  assert.equal(t.starts_at, Date.parse('2026-04-05T21:00:00Z'));
  assert.deepEqual(t.top.map((e) => [e.name, e.score]), [['Игрок C', 120], ['Игрок B', 110], ['Игрок A', 100], ['Игрок X', 70], ['Игрок D', 10]]);
  assert.deepEqual(t.me, { rank: 3, score: 100 });
  assert.equal(t.top[2].me, true);
  assert.equal(t.total, 5);
  assert.equal((await browser()('GET', '/api/tournament')).data.tournament.me, null, 'гостю — без своего места');

  // Владелец видит план; прошедшую неделю отменить нельзя, следующую — можно.
  assert.equal((await owner('POST', '/api/admin/tournaments', { when: 'next', game_id: otherId })).status, 200);
  let adm = (await owner('GET', '/api/admin/tournaments')).data;
  assert.equal(adm.current.tournament.game.id, gameId);
  assert.equal(adm.next.week, '2026-04-13');
  assert.equal(adm.next.tournament.game.id, otherId);
  assert.equal((await owner('DELETE', '/api/admin/tournaments/2026-04-13')).status, 200);
  assert.equal((await owner('GET', '/api/admin/tournaments')).data.next.tournament, null);
  assert.equal((await a('GET', '/api/admin/tournaments')).status, 403);

  // Воскресенье 23:59 по Москве — ещё в зачёте; через две минуты неделя закончилась.
  clock = Date.parse('2026-04-12T20:59:00Z');
  await d('POST', `/api/games/${gameId}/leaderboard`, { score: 115 });
  clock = Date.parse('2026-04-12T21:01:00Z');
  await a('POST', `/api/games/${gameId}/leaderboard`, { score: 1000 }); // уже после конца — в турнир не идёт

  const now = (await a('GET', '/api/tournament')).data;
  assert.equal(now.tournament, null);
  assert.deepEqual(now.last.winners.map((w) => [w.place, w.name, w.score]), [[1, 'Игрок C', 120], [2, 'Игрок D', 115], [3, 'Игрок B', 110]]);
  await a('GET', '/api/tournament');
  await owner('GET', '/api/admin/tournaments');

  const prize = async (p) => (await history(p)).filter((h) => h.kind === 'tournament').map((h) => h.delta);
  assert.deepEqual(await prize(c), [150]);
  assert.deepEqual(await prize(d), [100]);
  assert.deepEqual(await prize(b), [50]);
  assert.deepEqual(await prize(a), [], 'четвёртое место без приза');
  assert.equal((await history(c)).find((h) => h.kind === 'tournament').title, `Турнир недели: 1-е место, ${gameTitle}`);

  // Достижения призёров.
  const keys = async (p) => (await p('GET', '/api/me/rewards')).data.achievements.filter((x) => x.earned_at).map((x) => x.key);
  assert.ok((await keys(c)).includes('champion'));
  assert.ok((await keys(b)).includes('podium'));
  assert.ok(!(await keys(b)).includes('champion'));
  assert.equal(await coins(c), start.c + 150 + 10 + 10 + 30 + 50, 'приз, «Первый рекорд», «Участник турнира», «Призёр», «Чемпион»');

  adm = (await owner('GET', '/api/admin/tournaments')).data;
  assert.deepEqual(adm.past.map((p) => p.week), ['2026-04-06']);
  assert.equal((await owner('DELETE', '/api/admin/tournaments/2026-04-06')).status, 409, 'итоги не отменяются');
});

test('приглашения: подтверждение почты засчитывает сразу, без себя, не больше лимита', async () => {
  clock = Date.parse('2026-05-04T09:00:00Z');
  const host = await player('host@test.ru', 'Хозяин', '10.1.0.1');
  let inv = (await host('GET', '/api/me/rewards')).data.invite;
  const code = inv.url.match(/^https:\/\/igry\.test\/\?invite=([\w-]{8})$/)[1];
  assert.equal(inv.code, code);
  assert.equal((await host('GET', '/api/me/rewards')).data.invite.code, code, 'ссылка постоянная');
  assert.deepEqual([inv.invited, inv.confirmed, inv.coins], [0, 0, 0]);
  const hostId = (await host('GET', '/api/me')).data.user.id;
  assert.notEqual(code, String(hostId));
  await verify(host, 'host@test.ru');
  const hostStart = await coins(host);

  // Друг пришёл по ссылке: страница поставила cookie invite.
  const friend = await player('friend@test.ru', 'Друг', '10.1.0.2', { invite: code });
  assert.equal(await coins(friend), 50, 'до подтверждения почты — только подарок за регистрацию');
  inv = (await host('GET', '/api/me/rewards')).data.invite;
  assert.deepEqual([inv.invited, inv.confirmed, inv.coins], [1, 0, 0]);
  assert.equal(await coins(host), hostStart);

  await verify(friend, 'friend@test.ru');
  assert.equal(await coins(friend), 50 + INVITED_COINS + 10, 'подарок, награда за приглашение, «Настоящая почта»');
  inv = (await host('GET', '/api/me/rewards')).data.invite;
  assert.deepEqual([inv.invited, inv.confirmed, inv.coins], [1, 1, INVITE_COINS]);
  assert.equal(await coins(host), hostStart + INVITE_COINS + 20, 'награда и достижение «Позвал друга»');
  const ref = (await history(host)).filter((h) => h.kind === 'referral');
  assert.deepEqual(ref.map((h) => [h.delta, h.title]), [[INVITE_COINS, 'Друг принял приглашение: Друг']]);

  // Сброс пароля тоже подтверждает почту — награда второй раз не приходит.
  await friend('POST', '/api/password/forgot', { email: 'friend@test.ru' });
  const reset = [...mail].reverse().find((m) => m.to === 'friend@test.ru').text.match(/reset\.html\?token=([\w-]+)/)[1];
  assert.equal((await friend('POST', '/api/password/reset', { token: reset, password: 'newsecret1' })).status, 200);
  assert.equal(await coins(friend), 50 + INVITED_COINS + 10);
  assert.equal((await host('GET', '/api/me/rewards')).data.invite.coins, INVITE_COINS);

  // Себя пригласить нельзя: с того же адреса, что при регистрации пригласившего…
  const same = await player('same-ip@test.ru', 'Тот же адрес', '10.1.0.1', { invite: code });
  await verify(same, 'same-ip@test.ru');
  // …и из браузера, где пригласивший вошёл в аккаунт.
  host.jar.invite = code;
  const twin = browser('10.1.0.3', { ...host.jar });
  assert.equal((await twin('POST', '/api/register', { email: 'twin@test.ru', password: 'secret123', name: 'Двойник' })).status, 201);
  await verify(twin, 'twin@test.ru');
  // Неизвестный код — просто регистрация.
  const stranger = await player('stranger@test.ru', 'Незнакомец', '10.1.0.4', { invite: 'AAAAAAAA' });
  await verify(stranger, 'stranger@test.ru');
  for (const p of [same, twin, stranger]) assert.equal(await coins(p), 60, 'подарок и «Настоящая почта», без награды за приглашение');
  inv = (await host('GET', '/api/me/rewards')).data.invite;
  assert.deepEqual([inv.invited, inv.confirmed, inv.coins], [1, 1, INVITE_COINS]);

  // Лимит: наградных приглашений не больше MAX_INVITES. Добавляем «старые» прямо в базу.
  const db = new DatabaseSync(path.join(dataDir, 'igrodrom.db'), { enableForeignKeyConstraints: false });
  const add = db.prepare("INSERT INTO invites (user_id, inviter_id, status, created_at) VALUES (?, ?, 'rewarded', ?)");
  for (let i = 0; i < MAX_INVITES - 2; i++) add.run(900000 + i, hostId, clock);
  db.close();
  const last = await player('last@test.ru', 'Последний', '10.1.0.5', { invite: code });
  const over = await player('over@test.ru', 'Сверх лимита', '10.1.0.6', { invite: code });
  await verify(last, 'last@test.ru');
  await verify(over, 'over@test.ru');
  assert.equal(await coins(last), 50 + INVITED_COINS + 10, 'последнее в лимите приглашение ещё с наградой');
  assert.equal(await coins(over), 60, 'сверх лимита — без');
  inv = (await host('GET', '/api/me/rewards')).data.invite;
  assert.deepEqual([inv.confirmed, inv.coins, inv.limit], [MAX_INVITES, 2 * INVITE_COINS, MAX_INVITES]);
});

test('приглашения без почты: друг засчитан за две разные игры, предметы за друзей, уведомление, неделя', async () => {
  clock = Date.parse('2026-06-01T09:00:00Z'); // понедельник
  const boss = await player('boss@test.ru', 'Заводила', '10.2.0.1');
  const { code, reward, play_games: games } = (await boss('GET', '/api/me/invite')).data;
  assert.deepEqual([reward, games], [INVITE_COINS, 2]);
  const guest = browser('10.2.0.99');
  assert.equal((await guest('GET', `/api/invite/${code}`)).data.name, 'Заводила', 'кто бросил вызов — видно без входа');
  assert.equal((await guest('GET', '/api/invite/ZZZZZZZZ')).status, 404);

  const play = (b, id = gameId) => b('POST', `/api/games/${id}/play`);
  const friends = [];
  for (let i = 1; i <= 3; i++) friends.push(await player(`f${i}@test.ru`, `Друг ${i}`, `10.2.0.${10 + i}`, { invite: code }));
  const bossStart = await coins(boss);
  for (const f of friends) { await play(f); await play(f); } // одна и та же игра дважды — всё равно одна игра
  let inv = (await boss('GET', '/api/me/rewards')).data.invite;
  assert.deepEqual([inv.invited, inv.confirmed], [3, 0]);
  assert.deepEqual(inv.pending.map((p) => p.games), [1, 1, 1]);
  assert.equal(await coins(friends[0]), 50);

  for (const f of friends) await play(f, otherId); // вторая игра — в тот же день, дни не важны
  inv = (await boss('GET', '/api/me/rewards')).data.invite;
  assert.deepEqual([inv.confirmed, inv.coins, inv.pending.length], [3, 3 * INVITE_COINS, 0]);
  assert.equal(await coins(friends[0]), 50 + INVITED_COINS + 10, 'подарок, награда за приглашение, «Первые шаги»');
  assert.equal(await coins(boss), bossStart + 3 * INVITE_COINS + 20 + 30, 'награды, «Позвал друга», «Компания»');

  // Рамка за трёх друзей открыта и надевается; значок за пятерых — нет, и не продаётся.
  const shop = (await boss('GET', '/api/shop')).data;
  assert.equal(shop.friends, 3);
  assert.equal(shop.items.find((i) => i.id === 'frame:soul').owned, true);
  assert.equal(shop.items.find((i) => i.id === 'icon:leader').owned, false);
  assert.equal((await boss('POST', '/api/shop/buy', { item: 'icon:leader' })).status, 403);
  assert.equal((await boss('POST', '/api/shop/equip', { slot: 'frame', item: 'frame:soul' })).status, 200);
  assert.equal((await boss('GET', '/api/me')).data.user.frame, 'soul');

  // Уведомление: один раз, через новости аккаунта — вместе с достижениями.
  assert.equal((await boss('GET', '/api/me')).data.user.news, true);
  const news = (await boss('POST', '/api/me/news')).data;
  assert.deepEqual([news.friends.names.length, news.friends.coins, news.friends.unlocked.map((u) => u.id)], [3, 3 * INVITE_COINS, ['frame:soul']]);
  assert.deepEqual(news.achievements.map((a) => a.key), ['invite', 'invite3']);
  assert.equal((await boss('POST', '/api/me/news')).data.friends, null);
  assert.equal((await boss('GET', '/api/me')).data.user.news, false);

  // Кто привёл больше всех: неделя и всё время; итоги недели — приз первому, один раз.
  let top = (await guest('GET', '/api/invites/top')).data;
  assert.deepEqual([top.week.top[0].name, top.week.top[0].friends], ['Заводила', 3]);
  assert.ok(top.all.some((r) => r.name === 'Заводила' && r.friends === 3));
  const before = await coins(boss);
  clock = Date.parse('2026-06-08T09:00:00Z');
  top = (await guest('GET', '/api/invites/top')).data;
  assert.deepEqual(top.last.winners.map((w) => [w.place, w.name, w.friends]), [[1, 'Заводила', 3]]);
  assert.equal(top.week.top.length, 0, 'новая неделя — с нуля');
  assert.equal(await coins(boss), before + INVITE_WEEK_PRIZES[0]);
  await guest('GET', '/api/invites/top');
  assert.equal(await coins(boss), before + INVITE_WEEK_PRIZES[0], 'приз один раз');
});
