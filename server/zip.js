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
