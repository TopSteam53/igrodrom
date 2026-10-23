import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractZip, isZip, ZipError, ZipWriter, createZip } from '../server/zip.js';
import { makeZip } from './make-zip.js';

const paths = (files) => files.map((f) => f.path).sort();
const rejects = (buf, re) => assert.throws(() => extractZip(buf), (e) => e instanceof ZipError && re.test(e.message));

test('обычный архив: файлы, подпапки, сжатие и без сжатия', () => {
  const zip = makeZip([
    { name: 'index.html', data: '<html>игра</html>' },
    { name: 'js/', data: '' },
    { name: 'js/game.js', data: 'console.log(1)'.repeat(100) },
    { name: 'img/hero.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), method: 0 },
  ]);
  assert.ok(isZip(zip));
  const files = extractZip(zip);
  assert.deepEqual(paths(files), ['img/hero.png', 'index.html', 'js/game.js']);
  assert.equal(files.find((f) => f.path === 'index.html').data.toString(), '<html>игра</html>');
});

test('единственная папка-обёртка снимается, мусор macOS пропускается', () => {
  const files = extractZip(makeZip([
    { name: 'my-game/index.html', data: '<html></html>' },
    { name: 'my-game/a.js', data: 'x' },
    { name: '__MACOSX/my-game/._a.js', data: 'junk' },
    { name: 'my-game/.DS_Store', data: 'junk' },
  ]));
  assert.deepEqual(paths(files), ['a.js', 'index.html']);
});

test('имена в CP866 (русский Windows) читаются', () => {
  // «звуки» в CP866, флаг UTF-8 не выставлен.
  const name = Buffer.concat([Buffer.from([0xa7, 0xa2, 0xe3, 0xaa, 0xa8]), Buffer.from('.mp3')]);
  const files = extractZip(makeZip([{ name: 'index.html', data: '<html>' }, { name, data: 'mp3' }]));
  assert.ok(paths(files).includes('звуки.mp3'));
});

test('без index.html — отказ', () => {
  rejects(makeZip([{ name: 'game.html', data: '<html>' }]), /нет index\.html/);
  rejects(makeZip([{ name: 'a/index.html', data: '<html>' }, { name: 'b/x.js', data: '1' }]), /нет index\.html/);
});

test('выход за пределы папки и абсолютные пути — отказ', () => {
  rejects(makeZip([{ name: 'index.html', data: '<html>' }, { name: '../../evil.js', data: 'x' }]), /Недопустимый путь/);
  rejects(makeZip([{ name: 'index.html', data: '<html>' }, { name: 'a/../../evil.js', data: 'x' }]), /Недопустимый путь/);
  rejects(makeZip([{ name: 'index.html', data: '<html>' }, { name: '/etc/passwd', data: 'x' }]), /Недопустимый путь/);
  rejects(makeZip([{ name: 'index.html', data: '<html>' }, { name: 'C:\\evil.js', data: 'x' }]), /Недопустимый путь/);
  rejects(makeZip([{ name: 'index.html', data: '<html>' }, { name: '..\\evil.js', data: 'x' }]), /Недопустимый путь/);
});

test('симлинки, пароль, дубликаты — отказ', () => {
  rejects(makeZip([
    { name: 'index.html', data: '<html>' },
    { name: 'link', data: '/etc/passwd', madeBy: 3 << 8, extAttr: (0o120777 << 16) >>> 0 },
  ]), /Симлинки/);
  rejects(makeZip([{ name: 'index.html', data: '<html>', flags: 0x801 }]), /паролем/);
  rejects(makeZip([{ name: 'index.html', data: '<html>' }, { name: 'INDEX.html', data: '<html>' }]), /дважды/);
});

test('zip-бомба и повреждения — отказ', () => {
  // Заголовок врёт: заявлено 10 байт, внутри 10 МБ нулей.
  const bomb = makeZip([{ name: 'index.html', data: Buffer.alloc(10 * 1024 * 1024), size: 10 }]);
  rejects(bomb, /Не удалось распаковать/);
  // Честно заявленный, но слишком большой распакованный размер.
  const big = makeZip([{ name: 'index.html', data: '<html>' }, { name: 'big.bin', data: Buffer.alloc(1024 * 1024) }]);
  assert.throws(() => extractZip(big, { maxTotalBytes: 512 * 1024 }), /больше/);
  rejects(makeZip([{ name: 'index.html', data: '<html>', crc: 12345 }]), /повреждён/);
  rejects(Buffer.from('PK\x03\x04 это не архив'), /повреждён|не ZIP/);
  assert.throws(() => extractZip(makeZip([{ name: 'index.html', data: '<html>' }, { name: 'b', data: '' }]), { maxFiles: 1 }), /больше 1 файлов/);
});

test('архив, собранный настоящей утилитой zip', (t) => {
  let hasZip = true;
  try { execFileSync('zip', ['-v'], { stdio: 'ignore' }); } catch { hasZip = false; }
  if (!hasZip) return t.skip('утилита zip не установлена');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-zip-'));
  try {
    fs.mkdirSync(path.join(dir, 'game/assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'game/index.html'), '<html><script src="assets/main.js"></script></html>');
    fs.writeFileSync(path.join(dir, 'game/assets/main.js'), 'console.log("ok");\n'.repeat(500));
    execFileSync('zip', ['-qr', 'out.zip', 'game'], { cwd: dir });
    const files = extractZip(fs.readFileSync(path.join(dir, 'out.zip')));
    assert.deepEqual(paths(files), ['assets/main.js', 'index.html']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- запись (скачивание сборки из кабинета) ----------

test('записанный архив читается обратно: сжатие, без сжатия, русские имена, пустой файл', async () => {
  const src = [
    { path: 'index.html', data: '<html>игра</html>' },
    { path: 'js/game.js', data: 'console.log("ok");\n'.repeat(2000) },
    { path: 'звуки/прыжок.ogg', data: Buffer.from([1, 2, 3, 4, 5]) },
    { path: 'img/hero.png', data: Buffer.alloc(5000, 7) }, // png кладётся без сжатия, даже если сжимается
    { path: 'empty.txt', data: '' },
  ];
  const zip = createZip(src);
  assert.ok(isZip(zip));
  const files = extractZip(zip);
  assert.deepEqual(paths(files), src.map((f) => f.path).sort());
  for (const f of src) assert.deepEqual(files.find((x) => x.path === f.path).data, Buffer.from(f.data), f.path);
  assert.ok(zip.length < 20000, 'текст сжат');
  // Метод сжатия — в локальном заголовке за 30 байт до имени: 8 у js, 0 у png. Флаг UTF-8 — у каждого имени.
  const header = (name) => zip.indexOf(Buffer.from(name)) - 30;
  assert.equal(zip.readUInt16LE(header('js/game.js') + 8), 8);
  assert.equal(zip.readUInt16LE(header('img/hero.png') + 8), 0);
  assert.equal(zip.readUInt16LE(header('звуки/прыжок.ogg') + 6) & 0x800, 0x800);

  // Потоковая запись даёт те же файлы.
  const w = new ZipWriter();
  const parts = [];
  for (const f of src) parts.push(...await w.addAsync(f.path, Buffer.from(f.data)));
  parts.push(w.finish());
  const again = extractZip(Buffer.concat(parts));
  for (const f of src) assert.deepEqual(again.find((x) => x.path === f.path).data, Buffer.from(f.data), f.path);
});

test('запись: недопустимые имена и повторы — отказ', () => {
  const w = new ZipWriter();
  for (const bad of ['../x.js', '/abs.js', 'a//b.js', 'a\\b.js', '', './a.js']) {
    assert.throws(() => w.add(bad, Buffer.from('x')), ZipError, bad);
  }
  w.add('a.js', Buffer.from('x'));
  assert.throws(() => w.add('a.js', Buffer.from('y')), /дважды/);
});

test('записанный архив проверяет настоящая утилита unzip', (t) => {
  let hasUnzip = true;
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { hasUnzip = false; }
  if (!hasUnzip) return t.skip('утилита unzip не установлена');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'igrodrom-unzip-'));
  try {
    const file = path.join(dir, 'out.zip');
    fs.writeFileSync(file, createZip([{ path: 'index.html', data: '<html></html>' }, { path: 'js/main.js', data: 'let a = 1;\n'.repeat(300) }]));
    assert.match(execFileSync('unzip', ['-t', file], { encoding: 'utf8' }), /No errors detected/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
