import zlib from 'node:zlib';

// Minimal ZIP reader for game uploads: stored and deflate entries, no ZIP64,
// no encryption. Everything that looks like an attack is rejected outright.

export class ZipError extends Error {}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const IGNORED = /(^|\/)(__MACOSX\/.*|\.DS_Store|Thumbs\.db|desktop\.ini)$/i;
const cp866 = new TextDecoder('ibm866');

export const isZip = (buf) => buf.length >= 4 && buf.readUInt32LE(0) === LOC_SIG;

function findEocd(buf) {
  // EOCD is 22 bytes plus a comment of up to 65535 bytes at the very end.
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipError('Файл повреждён или это не ZIP-архив');
}

function decodeName(bytes, utf8Flag) {
  if (utf8Flag) return bytes.toString('utf8');
  const ascii = bytes.every((b) => b < 0x80);
  // Russian Windows archivers write names in CP866 without setting the UTF-8 flag.
  return ascii ? bytes.toString('latin1') : cp866.decode(bytes);
}

function cleanPath(raw) {
  const name = raw.replace(/\\/g, '/');
  if (name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name)) {
    throw new ZipError(`Недопустимый путь в архиве: ${raw}`);
  }
  const parts = name.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) throw new ZipError(`Недопустимый путь в архиве: ${raw}`);
  if (parts.length > 16 || name.length > 255) throw new ZipError(`Слишком длинный путь: ${raw}`);
  return parts.join('/');
}

/**
 * Returns [{ path, data }] with paths relative to the game root (the folder holding index.html).
 */
export function extractZip(buf, { maxFiles = 1000, maxTotalBytes = 50 * 1024 * 1024 } = {}) {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const cenSize = buf.readUInt32LE(eocd + 12);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cenOffset === 0xffffffff) throw new ZipError('ZIP64-архивы не поддерживаются');
  if (count > maxFiles) throw new ZipError(`В архиве больше ${maxFiles} файлов`);
  if (cenOffset + cenSize > eocd) throw new ZipError('Файл повреждён');

  const entries = [];
  let total = 0;
  let p = cenOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) throw new ZipError('Файл повреждён');
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    const rawName = decodeName(buf.subarray(p + 46, p + 46 + nameLen), flags & 0x800);
    p += 46 + nameLen + extraLen + commentLen;

    if (rawName.endsWith('/') || rawName.endsWith('\\')) continue; // directory
    if (IGNORED.test(rawName.replace(/\\/g, '/'))) continue;
    if (flags & 0x1) throw new ZipError('Архивы с паролем не поддерживаются');
    const unixMode = (madeBy >> 8) === 3 ? extAttr >>> 16 : 0;
    if ((unixMode & 0o170000) === 0o120000) throw new ZipError(`Симлинки не поддерживаются: ${rawName}`);
    if (method !== 0 && method !== 8) throw new ZipError(`Неподдерживаемое сжатие в файле ${rawName}`);

    total += size;
    if (total > maxTotalBytes) {
      throw new ZipError(`Распакованный архив больше ${Math.round(maxTotalBytes / 1048576)} МБ`);
    }
    entries.push({ rawName, path: cleanPath(rawName), method, crc, compSize, size, localOffset });
  }

  const seen = new Set();
  for (const e of entries) {
    const key = e.path.toLowerCase();
    if (seen.has(key)) throw new ZipError(`Файл встречается в архиве дважды: ${e.path}`);
    seen.add(key);
  }

  const root = findRoot(entries.map((e) => e.path));
  const files = [];
  for (const e of entries) {
    if (root && !e.path.startsWith(root)) continue;
    files.push({ path: e.path.slice(root.length), data: readEntry(buf, e) });
  }
  return files;
}

// index.html may sit at the top of the archive or inside a single wrapping folder.
function findRoot(paths) {
  if (paths.includes('index.html')) return '';
  const tops = new Set(paths.map((p) => p.split('/')[0]));
  if (tops.size === 1) {
    const [top] = tops;
    if (paths.includes(`${top}/index.html`)) return `${top}/`;
  }
  throw new ZipError('В архиве нет index.html (он должен лежать в корне архива или в единственной папке)');
}

function readEntry(buf, e) {
  const lo = e.localOffset;
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== LOC_SIG) throw new ZipError('Файл повреждён');
  const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
  const raw = buf.subarray(start, start + e.compSize);
  if (raw.length !== e.compSize) throw new ZipError('Файл повреждён');

  let data;
  if (e.method === 0) {
    data = raw;
  } else {
    try {
      // Caps output at the declared size, so a lying header cannot inflate a bomb.
      data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(e.size, 1) });
    } catch {
      throw new ZipError(`Не удалось распаковать ${e.rawName}`);
    }
  }
  if (data.length !== e.size || zlib.crc32(data) !== e.crc) {
    throw new ZipError(`Файл повреждён: ${e.rawName}`);
  }
  return data;
}

// ---------- запись ----------
// Минимальный ZIP для скачивания сборки и картинок из кабинета: stored или deflate, имена в UTF-8
// (флаг 11), без ZIP64. Каждый файл сжимается целиком в памяти, а архив можно отдавать по частям:
// add() возвращает куски для потока, finish() — центральный каталог и конец архива.

const MAX_ZIP_BYTES = 0xffffffff; // больше 4 ГБ без ZIP64 не записать
// Уже сжатые форматы deflate не уменьшит — кладём как есть и не тратим процессор.
const STORED_EXT = /\.(png|jpe?g|gif|webp|avif|mp3|ogg|oga|m4a|aac|mp4|webm|woff2?|zip|gz|br|7z|rar)$/i;
const deflateRaw = (data) => new Promise((resolve, reject) => zlib.deflateRaw(data, (err, out) => (err ? reject(err) : resolve(out))));

// Время в формате MS-DOS: точность 2 секунды, годы с 1980.
function dosTime(d) {
  const year = Math.max(d.getFullYear(), 1980);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  #central = [];
  #offset = 0;
  #names = new Set();

  #name(name) {
    if (typeof name !== 'string' || !name || name.startsWith('/') || name.includes('\\') || name.includes('\0') ||
      name.split('/').some((p) => p === '' || p === '.' || p === '..')) throw new ZipError(`Недопустимое имя файла: ${name}`);
    const nameBuf = Buffer.from(name, 'utf8');
    if (nameBuf.length > 0xffff) throw new ZipError(`Слишком длинное имя: ${name}`);
    if (this.#names.has(name)) throw new ZipError(`Файл встречается дважды: ${name}`);
    if (this.#names.size >= 0xffff) throw new ZipError('Больше 65535 файлов без ZIP64 не записать');
    return nameBuf;
  }

  #entry(name, nameBuf, data, body, method, mtime) {
    if (data.length > MAX_ZIP_BYTES || this.#offset + 30 + nameBuf.length + body.length > MAX_ZIP_BYTES) {
      throw new ZipError('Архив больше 4 ГБ');
    }
    const crc = zlib.crc32(data);
    const { time, date } = dosTime(mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOC_SIG, 0);
    local.writeUInt16LE(20, 4);       // нужна версия 2.0
    local.writeUInt16LE(0x800, 6);    // имя в UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(CEN_SIG, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(this.#offset, 42);
    this.#central.push(cen, nameBuf);
    this.#names.add(name);
    this.#offset += 30 + nameBuf.length + body.length;
    return [local, nameBuf, body];
  }

  // Сжатый вариант берём, только если он и правда меньше.
  #pack(name, data, compress, deflate) {
    if (!(compress ?? !STORED_EXT.test(name)) || data.length === 0) return { body: data, method: 0 };
    const pick = (packed) => (packed.length < data.length ? { body: packed, method: 8 } : { body: data, method: 0 });
    const packed = deflate(data);
    return packed instanceof Promise ? packed.then(pick) : pick(packed);
  }

  /** Добавить файл. Возвращает куски архива для записи. */
  add(name, data, { compress, mtime = new Date() } = {}) {
    const nameBuf = this.#name(name);
    const { body, method } = this.#pack(name, data, compress, zlib.deflateRawSync);
    return this.#entry(name, nameBuf, data, body, method, mtime);
  }

  /** То же, но сжатие не останавливает сервер на время большого файла. */
  async addAsync(name, data, { compress, mtime = new Date() } = {}) {
    const nameBuf = this.#name(name);
    const { body, method } = await this.#pack(name, data, compress, deflateRaw);
    return this.#entry(name, nameBuf, data, body, method, mtime);
  }

  /** Центральный каталог и конец архива — последний кусок. */
  finish() {
    const cen = Buffer.concat(this.#central);
    if (this.#offset + cen.length > MAX_ZIP_BYTES) throw new ZipError('Архив больше 4 ГБ');
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(this.#names.size, 8);
    eocd.writeUInt16LE(this.#names.size, 10);
    eocd.writeUInt32LE(cen.length, 12);
    eocd.writeUInt32LE(this.#offset, 16);
    return Buffer.concat([cen, eocd]);
  }
}

/** Архив целиком в памяти: [{ path, data, compress?, mtime? }] → Buffer. */
export function createZip(files) {
  const zip = new ZipWriter();
  const parts = [];
  for (const f of files) parts.push(...zip.add(f.path, Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data ?? '', 'utf8'), f));
  parts.push(zip.finish());
  return Buffer.concat(parts);
}
