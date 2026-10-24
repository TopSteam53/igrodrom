// Звуки «Последнего рубежа»: синтез без зависимостей, 16 бит, моно, 22050 Гц.
//
//   node scripts/rubezh-sfx.mjs [имена…]      → godot/rubezh/assets/sfx/<имя>.wav
//
// Выстрелы и взрывы — шум через фильтры, стоны — пила с «дрожащим» тоном через форманты гласных,
// музыка — циклы по 24 с: хвост последних нот заворачивается в начало, поэтому стык не слышен.
// Пик каждого файла — −3 dBFS, у коротких звуков мягкие края по 5 мс, чтобы не щёлкало.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'godot', 'rubezh', 'assets', 'sfx');
const ONLY = new Set(process.argv.slice(2));
const SR = 22050;
const PEAK = 10 ** (-3 / 20);
const TAU = Math.PI * 2;

// ---------- основа ----------
let seed = 1;
const srand = s => { seed = s >>> 0; };
const rnd = () => { // mulberry32: одинаковый результат при каждом запуске
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rr = (a, b) => a + (b - a) * rnd();
const N = s => Math.round(s * SR);
const buf = s => new Float32Array(N(s));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const midi = n => 440 * 2 ** ((n - 69) / 12);

class Biquad {
  constructor(type) { this.type = type; this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  set(f, q = 0.707) {
    const w = TAU * clamp(f, 20, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0, b1, b2;
    if (this.type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (this.type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = a; b1 = 0; b2 = -a; } // полоса, 0 дБ на пике
    const a0 = 1 + a;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - a) / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// Фильтр с частотой, которая может меняться во времени: f — число или функция от t (с).
function filt(src, type, f, q = 0.707) {
  const bq = new Biquad(type), out = new Float32Array(src.length);
  const fn = typeof f === 'function' ? f : () => f;
  for (let i = 0; i < src.length; i++) {
    if (i % 16 === 0) bq.set(fn(i / SR), q);
    out[i] = bq.run(src[i]);
  }
  return out;
}

const noise = s => { const b = buf(s); for (let i = 0; i < b.length; i++) b[i] = rnd() * 2 - 1; return b; };
function brown(s) { const b = buf(s); let v = 0; for (let i = 0; i < b.length; i++) { v = (v + (rnd() * 2 - 1) * 0.06) * 0.996; b[i] = v * 3; } return b; }
// Плавный случайный сигнал −1…1 с заданной частотой изменений.
function wobble(s, rate) {
  const b = buf(s), step = Math.max(1, Math.round(SR / rate));
  let a = rr(-1, 1), c = rr(-1, 1);
  for (let i = 0; i < b.length; i++) {
    if (i % step === 0) { a = c; c = rr(-1, 1); }
    const t = (i % step) / step;
    b[i] = lerp(a, c, t * t * (3 - 2 * t));
  }
  return b;
}
const env = (src, fn) => { for (let i = 0; i < src.length; i++) src[i] *= fn(i / SR); return src; };
const dec = (t, tau) => Math.exp(-t / tau);
const att = (t, a) => (t < a ? t / a : 1);
function mix(dst, src, at = 0, g = 1) {
  const o = N(at);
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * g;
  return dst;
}
const sat = (src, drive) => { const k = Math.tanh(drive); for (let i = 0; i < src.length; i++) src[i] = Math.tanh(src[i] * drive) / k; return src; };

// Тон с огибающей частоты f(t): sine | tri | saw | square.
function tone(s, f, shape = 'sine', ph0 = 0) {
  const b = buf(s), fn = typeof f === 'function' ? f : () => f;
  let ph = ph0;
  for (let i = 0; i < b.length; i++) {
    ph += fn(i / SR) / SR;
    const p = ph % 1;
    b[i] = shape === 'sine' ? Math.sin(TAU * p)
      : shape === 'tri' ? 1 - 4 * Math.abs(p - 0.5)
        : shape === 'saw' ? 2 * p - 1
          : (p < 0.5 ? 1 : -1);
  }
  return b;
}
// Удар-«бум»: синус с падающей частотой.
const thump = (s, f0, f1, tau, glide = 0.04) => env(tone(s, t => f1 + (f0 - f1) * Math.exp(-t / glide)), t => dec(t, tau) * att(t, 0.002));

// Колокол/металл: негармонические обертоны.
function bell(s, f, partials, tau = 0.8) {
  const b = buf(s);
  for (const [ratio, g, k] of partials) mix(b, env(tone(s, f * ratio, 'sine', rnd()), t => dec(t, tau * k) * att(t, 0.002)), 0, g);
  return b;
}
const BELL = [[1, 1, 1], [2.0, 0.5, 0.6], [2.76, 0.35, 0.45], [5.4, 0.18, 0.25], [8.93, 0.08, 0.15]];

// Щипок струны (Карплус — Стронг).
function pluck(s, f, damp = 0.996, bright = 0.5) {
  const b = buf(s), L = Math.max(2, Math.round(SR / f)), line = new Float32Array(L);
  for (let i = 0; i < L; i++) line[i] = rnd() * 2 - 1;
  let prev = 0;
  for (let i = 0; i < L; i++) { prev = lerp(line[i], prev, 1 - bright); line[i] = prev; }
  let p = 0;
  for (let i = 0; i < b.length; i++) {
    const n = (p + 1) % L, v = (line[p] + line[n]) * 0.5 * damp;
    b[i] = line[p]; line[p] = v; p = n;
  }
  return b;
}

// Голос: пила с плавающим тоном через полосовые фильтры-форманты; fry — «хрип» (рваная амплитуда).
function voice({ dur, f0, formants, fry = 0, fryRate = 32, breath = 0.1, amp = () => 1, jitter = 0.03 }) {
  const n = N(dur), src = new Float32Array(n), wob = wobble(dur, 6), fr = wobble(dur, fryRate);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += f0(t) * (1 + jitter * wob[i]) / SR;
    const p = ph % 1;
    const glott = (2 * p - 1) * 0.6 + Math.sin(TAU * p) * 0.4;
    const creak = 1 - fry * (0.5 + 0.5 * fr[i]) * (p < 0.3 ? 1 : 0.6);
    src[i] = glott * creak + (rnd() * 2 - 1) * breath;
  }
  const out = new Float32Array(n);
  formants.forEach(([f, q, g], k) => {
    const y = filt(src, 'bp', typeof f === 'function' ? f : () => f, q);
    for (let i = 0; i < n; i++) out[i] += y[i] * g;
  });
  for (let i = 0; i < n; i++) out[i] *= amp(i / SR);
  return out;
}
// Гласные: [F1, F2, F3]
const V = { u: [350, 800, 2300], o: [450, 850, 2400], a: [700, 1150, 2500], e: [500, 1500, 2450], uh: [600, 1000, 2400] };
const vowel = (a, b, t) => V[a].map((f, i) => lerp(f, V[b][i], clamp(t, 0, 1)));
const formantsGlide = (a, b, dur, low = 1) => [0, 1, 2].map(k => [t => vowel(a, b, t / dur)[k] * low, k ? 9 : 5, [1, 0.6, 0.25][k]]);

// ---------- вывод ----------
function finish(b, { loop = false } = {}) {
  let dc = 0;
  for (const v of b) dc += v;
  dc /= b.length;
  const fi = N(0.001), fo = N(0.005); // вход 1 мс — атака не теряется, выход 5 мс
  for (let i = 0; i < b.length; i++) {
    let e = 1;
    if (!loop) { if (i < fi) e = i / fi; if (i > b.length - 1 - fo) e = (b.length - 1 - i) / fo; }
    b[i] = (b[i] - dc) * e;
  }
  let pk = 1e-9;
  for (const v of b) pk = Math.max(pk, Math.abs(v));
  for (let i = 0; i < b.length; i++) b[i] *= PEAK / pk;
  return b;
}

function wav(name, b) {
  const n = b.length, data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(clamp(b[i], -1, 1) * 32767), 44 + i * 2);
  fs.writeFileSync(path.join(OUT, name + '.wav'), data);
  let pk = 0;
  for (const v of b) pk = Math.max(pk, Math.abs(v));
  console.log(`${name.padEnd(16)} ${(n / SR).toFixed(2).padStart(6)} s  peak ${(20 * Math.log10(pk)).toFixed(1)} dBFS`);
}

// Цикл: рисуем с хвостом и складываем хвост в начало — конец переходит в начало без шва.
function looped(len, tail, draw) {
  const b = buf(len + tail);
  draw(b);
  const L = N(len);
  for (let i = L; i < b.length; i++) b[i - L] += b[i];
  return b.slice(0, L);
}

// ---------- звуки ----------
const S = {};

S.shot_pistol = () => {
  const d = 0.45, b = buf(d);
  mix(b, env(filt(noise(d), 'bp', t => 900 + 3200 * dec(t, 0.02), 0.9), t => dec(t, 0.035) * att(t, 0.001)), 0, 1.4);
  mix(b, env(filt(noise(d), 'lp', 1400), t => dec(t, 0.12) * att(t, 0.003)), 0, 0.5);
  mix(b, thump(d, 180, 55, 0.07), 0, 0.9);
  mix(b, env(filt(noise(d), 'hp', 3000), t => dec(t, 0.008)), 0, 0.5);
  return sat(b, 1.6);
};

S.shot_shotgun = () => {
  const d = 0.95, b = buf(d);
  mix(b, env(filt(noise(d), 'lp', t => 300 + 3500 * dec(t, 0.05)), t => dec(t, 0.14) * att(t, 0.001)), 0, 1.5);
  mix(b, env(filt(noise(d), 'bp', 1800, 0.7), t => dec(t, 0.03)), 0, 0.8);
  mix(b, thump(d, 140, 38, 0.16, 0.05), 0, 1.3);
  mix(b, env(filt(brown(d), 'lp', 400), t => dec(t, 0.3) * att(t, 0.01)), 0, 0.6);
  // передёргивание цевья: два металлических щелчка
  for (const [at, f] of [[0.5, 2600], [0.62, 2100]]) {
    mix(b, env(filt(noise(0.06), 'bp', f, 3), t => dec(t, 0.008)), at, 0.35);
    mix(b, env(tone(0.06, f * 0.31, 'square'), t => dec(t, 0.006)), at, 0.06);
  }
  return sat(b, 1.8);
};

S.shot_rifle = () => {
  const d = 0.4, b = buf(d);
  mix(b, env(filt(noise(d), 'hp', 2200), t => dec(t, 0.012) * att(t, 0.0005)), 0, 1.1);
  mix(b, env(filt(noise(d), 'bp', t => 700 + 2000 * dec(t, 0.03), 0.8), t => dec(t, 0.06)), 0, 1.0);
  mix(b, thump(d, 220, 70, 0.05, 0.02), 0, 0.8);
  mix(b, env(filt(noise(d), 'lp', 900), t => dec(t, 0.1) * att(t, 0.01)), 0.01, 0.35);
  return sat(b, 2.0);
};

S.turret_shot = () => {
  const d = 0.22, b = buf(d);
  mix(b, env(filt(noise(d), 'bp', 2400, 1.2), t => dec(t, 0.02) * att(t, 0.0005)), 0, 1.2);
  mix(b, env(tone(d, 320, 'square'), t => dec(t, 0.015)), 0, 0.12);
  mix(b, thump(d, 260, 90, 0.035, 0.015), 0, 0.7);
  mix(b, bell(d, 1900, [[1, 1, 1], [1.47, 0.6, 0.7], [2.3, 0.3, 0.5]], 0.04), 0, 0.12);
  return sat(b, 1.5);
};

S.hit = () => {
  const d = 0.3, b = buf(d);
  mix(b, thump(d, 140, 55, 0.07, 0.03), 0, 1.0);
  mix(b, env(filt(noise(d), 'lp', 700), t => dec(t, 0.06) * att(t, 0.002)), 0, 0.7);
  const sq = env(filt(noise(d), 'bp', t => 1600 * dec(t, 0.06) + 350, 4), t => dec(t, 0.09) * att(t, 0.008));
  const gr = wobble(d, 60);
  for (let i = 0; i < sq.length; i++) sq[i] *= 0.6 + 0.4 * gr[i];
  mix(b, sq, 0.01, 1.4);
  return b;
};

function groan(dur, f0, a, bv, fry, amp, low = 1) {
  return voice({ dur, f0, formants: formantsGlide(a, bv, dur, low), fry, breath: 0.12, amp, jitter: 0.04 });
}
S.zombie_groan1 = () => groan(1.5, t => 92 - 22 * t / 1.5, 'o', 'u', 0.55,
  t => clamp(t / 0.25, 0, 1) * clamp((1.5 - t) / 0.5, 0, 1) * (0.8 + 0.2 * Math.sin(t * 9)), 0.9);
S.zombie_groan2 = () => groan(1.7, t => 78 + 30 * Math.sin(Math.PI * t / 1.7), 'u', 'a', 0.45,
  t => clamp(t / 0.35, 0, 1) * clamp((1.7 - t) / 0.4, 0, 1));
S.zombie_groan3 = () => {
  const d = 1.2, b = groan(d, t => 105 - 40 * t / d, 'a', 'uh', 0.8, t => clamp(t / 0.08, 0, 1) * clamp((d - t) / 0.5, 0, 1), 0.85);
  for (let k = 0; k < 7; k++) mix(b, env(tone(0.05, rr(300, 520)), t => dec(t, 0.012)), rr(0.3, 1.0), 0.15); // бульканье
  return b;
};

S.zombie_die = () => {
  const d = 1.25, b = buf(d);
  mix(b, groan(1.0, t => 130 * Math.exp(-t * 1.3) + 40, 'a', 'u', 0.85, t => clamp(t / 0.05, 0, 1) * clamp((1.0 - t) / 0.6, 0, 1), 0.9), 0, 1);
  for (let k = 0; k < 10; k++) mix(b, env(tone(0.06, t => rr(250, 450) * (1 + t * 4)), t => dec(t, 0.015)), rr(0.35, 0.95), 0.12);
  mix(b, thump(0.3, 120, 45, 0.08), 0.95, 0.8);
  mix(b, env(filt(noise(0.3), 'lp', 500), t => dec(t, 0.05)), 0.95, 0.4);
  return b;
};

S.brute_roar = () => {
  const d = 1.7, b = buf(d);
  const amp = t => clamp(t / 0.12, 0, 1) * clamp((d - t) / 0.6, 0, 1);
  const v = voice({ dur: d, f0: t => 62 + 18 * Math.sin(Math.PI * clamp(t / 1.2, 0, 1)), formants: formantsGlide('a', 'o', d, 0.8), fry: 0.9, fryRate: 45, breath: 0.3, amp });
  mix(b, sat(v, 3), 0, 1);
  mix(b, env(filt(noise(d), 'bp', t => 500 + 300 * Math.sin(t * 3), 1.5), amp), 0, 0.35);
  mix(b, env(tone(d, 41, 'saw'), amp), 0, 0.12);
  return filt(b, 'lp', 3500);
};

S.spit = () => {
  const d = 0.55, b = buf(d);
  mix(b, env(filt(noise(d), 'bp', 2600, 1.5), t => dec(t, 0.025) * att(t, 0.003)), 0, 0.9); // «пт»
  const sq = env(filt(noise(d), 'bp', t => 1200 * dec(t, 0.1) + 300, 5), t => dec(t, 0.12) * att(t, 0.01));
  mix(b, sq, 0.03, 1.4);
  mix(b, env(tone(0.25, t => 700 * Math.exp(-t * 9) + 150), t => dec(t, 0.06)), 0.05, 0.5);
  return b;
};

S.explosion = () => {
  const d = 2.4, b = buf(d);
  mix(b, env(filt(noise(d), 'lp', t => 120 + 4000 * dec(t, 0.12), 0.8), t => dec(t, 0.5) * att(t, 0.002)), 0, 1.5);
  mix(b, env(filt(noise(d), 'hp', 1500), t => dec(t, 0.02)), 0, 0.7);
  mix(b, thump(d, 90, 28, 0.6, 0.12), 0, 1.6);
  mix(b, env(filt(brown(d), 'lp', 260), t => dec(t, 0.8) * att(t, 0.03)), 0, 1.4);
  for (let k = 0; k < 14; k++) { // осколки и комья земли
    const at = rr(0.15, 1.4);
    mix(b, env(filt(noise(0.08), 'bp', rr(900, 3000), 2), t => dec(t, 0.01)), at, 0.15 * dec(at, 0.8));
  }
  return sat(b, 1.4);
};

S.build = () => {
  const d = 0.5, b = buf(d);
  for (const [at, g] of [[0, 1], [0.2, 0.8]]) {
    mix(b, thump(0.25, 210, 95, 0.05, 0.02), at, g);
    mix(b, env(filt(noise(0.25), 'bp', 1300, 1.2), t => dec(t, 0.02)), at, 0.8 * g);
    mix(b, env(tone(0.25, 430, 'sine', rnd()), t => dec(t, 0.07)), at, 0.25 * g);
    mix(b, env(tone(0.25, 670, 'sine', rnd()), t => dec(t, 0.05)), at, 0.18 * g);
  }
  return b;
};

S.break = () => {
  const d = 0.8, b = buf(d);
  for (let k = 0; k < 16; k++) {
    const at = k < 3 ? k * 0.012 : rr(0.03, 0.35);
    mix(b, env(filt(noise(0.05), 'bp', rr(1200, 3500), 1.4), t => dec(t, rr(0.004, 0.012))), at, rr(0.4, 1.0) * dec(at, 0.25));
  }
  mix(b, thump(d, 160, 60, 0.08), 0, 0.9);
  mix(b, env(filt(noise(d), 'bp', t => 900 - 500 * t, 2), t => dec(t, 0.18) * att(t, 0.01)), 0.02, 0.6);
  mix(b, thump(0.3, 110, 50, 0.07), 0.38, 0.5); // доска падает
  return sat(b, 1.3);
};

S.sell = () => {
  const d = 0.6, b = buf(d);
  mix(b, bell(d, 1320, BELL, 0.25), 0, 0.5);
  mix(b, bell(d - 0.08, 1760, BELL, 0.3), 0.08, 0.6);
  mix(b, env(filt(noise(d), 'hp', 5000), t => dec(t, 0.01)), 0, 0.15);
  return b;
};

S.click = () => {
  const d = 0.07, b = buf(d);
  mix(b, env(filt(noise(d), 'bp', 3200, 2), t => dec(t, 0.004)), 0, 1);
  mix(b, env(tone(d, 1250), t => dec(t, 0.012)), 0, 0.5);
  return b;
};

S.scrap = () => {
  const d = 0.4, b = buf(d);
  for (const [at, f, g] of [[0, 2100, 1], [0.065, 2650, 0.7], [0.12, 1850, 0.45]]) {
    mix(b, bell(0.28, f, [[1, 1, 1], [1.59, 0.7, 0.7], [2.43, 0.45, 0.5], [3.7, 0.2, 0.35]], 0.07), at, g);
    mix(b, env(filt(noise(0.03), 'hp', 4000), t => dec(t, 0.003)), at, 0.4 * g);
  }
  return b;
};

S.hurt = () => {
  const d = 0.4, b = buf(d);
  mix(b, voice({ dur: 0.3, f0: t => 190 - 60 * t / 0.3, formants: formantsGlide('uh', 'uh', 0.3), fry: 0.2, breath: 0.15,
    amp: t => clamp(t / 0.02, 0, 1) * clamp((0.3 - t) / 0.18, 0, 1) }), 0, 1);
  mix(b, thump(d, 120, 60, 0.05), 0, 0.6);
  return b;
};

S.night = () => {
  const d = 2.4, b = buf(d);
  const f = t => 170 + 330 * (1 - Math.exp(-t * 1.4)) + 6 * Math.sin(t * 34);
  const amp = t => clamp(t / 0.25, 0, 1) * clamp((d - t) / 0.6, 0, 1);
  mix(b, env(filt(tone(d, f, 'saw'), 'lp', t => 900 + 900 * t / d), amp), 0, 0.6);
  mix(b, env(filt(tone(d, t => f(t) * 1.006, 'tri'), 'lp', 2000), amp), 0, 0.5);
  mix(b, env(filt(tone(d, t => f(t) * 0.5, 'saw'), 'lp', 600), amp), 0, 0.35);
  mix(b, env(filt(brown(d), 'lp', 200), amp), 0, 0.3);
  return b;
};

S.dawn = () => {
  const d = 3.0, b = buf(d);
  [[79, 0], [84, 0.32], [88, 0.64], [91, 0.96]].forEach(([n, at], i) => mix(b, bell(d - at, midi(n), BELL, 1.0), at, i === 3 ? 0.75 : 0.55));
  mix(b, env(filt(tone(d, midi(60), 'tri'), 'lp', 900), t => clamp(t / 0.6, 0, 1) * clamp((d - t) / 1.2, 0, 1)), 0, 0.18);
  return b;
};

S.win = () => {
  const d = 1.7, b = buf(d);
  [72, 76, 79, 84].forEach((n, i) => {
    mix(b, env(filt(tone(0.5, midi(n), 'square'), 'lp', 2600), t => dec(t, 0.12) * att(t, 0.004)), i * 0.11, 0.35);
    mix(b, pluck(0.7, midi(n), 0.995, 0.7), i * 0.11, 0.5);
  });
  for (const n of [72, 76, 79, 84]) mix(b, env(filt(tone(1.2, midi(n), 'tri'), 'lp', 3000), t => att(t, 0.01) * dec(t, 0.45)), 0.46, 0.22);
  return b;
};

S.lose = () => {
  const d = 2.4, b = buf(d);
  [[55, 0, 0.42], [53, 0.42, 0.42], [51, 0.84, 0.42], [50, 1.26, 1.1]].forEach(([n, at, len]) => {
    const amp = t => clamp(t / 0.05, 0, 1) * clamp((len - t) / 0.25, 0, 1);
    mix(b, env(filt(tone(len, midi(n), 'saw'), 'lp', 900), amp), at, 0.4);
    mix(b, env(filt(tone(len, midi(n) * 1.004, 'saw'), 'lp', 700), amp), at, 0.3);
    mix(b, env(tone(len, midi(n - 12), 'sine'), amp), at, 0.4);
  });
  return b;
};

// Днём: 80 уд/мин, 8 тактов по 3 с. Перебор «гитары», бас и тихая подложка: C – Am – F – G.
S.music_day = () => looped(24, 3, b => {
  const beat = 0.75, chords = [[48, 52, 55, 60], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]];
  const arp = [0, 2, 1, 3, 2, 1, 3, 2];
  for (let bar = 0; bar < 8; bar++) {
    const ch = chords[bar % 4], t0 = bar * 3;
    mix(b, env(filt(tone(2.9, midi(ch[0] - 12), 'tri'), 'lp', 400), t => att(t, 0.01) * dec(t, 1.4)), t0, 0.5);
    mix(b, env(filt(tone(1.4, midi(ch[0] - 5), 'tri'), 'lp', 400), t => att(t, 0.01) * dec(t, 0.6)), t0 + 2 * beat, 0.3);
    arp.forEach((k, i) => {
      srand(bar * 31 + i);
      mix(b, pluck(1.6, midi(ch[k] + 12), 0.997, 0.45), t0 + i * beat / 2, i % 2 ? 0.16 : 0.22);
    });
    for (const n of ch.slice(1)) {
      mix(b, env(filt(tone(3.4, midi(n), 'tri', 0.3), 'lp', 1200), t => Math.sin(Math.PI * clamp(t / 3.4, 0, 1)) ** 2), t0, 0.06);
    }
    if (bar % 2 === 1) mix(b, bell(2.5, midi(ch[3] + 24), BELL, 0.7), t0 + 2.25, 0.05);
  }
});

// Ночью: 100 уд/мин, 10 тактов по 2.4 с. Гул на ре, удары «сердца», тиканье и диссонансные вздохи.
S.music_night = () => looped(24, 3, b => {
  const L = 24, n = N(L + 3);
  const droneA = tone(L + 3, midi(38), 'saw'), droneB = tone(L + 3, midi(38) * 1.005, 'saw'), sub = tone(L + 3, midi(26), 'sine');
  const dr = new Float32Array(n);
  for (let i = 0; i < n; i++) dr[i] = droneA[i] + droneB[i];
  const lfo = t => 0.5 - 0.5 * Math.cos(TAU * t / 6); // период 6 с — делит 24 без остатка
  const drone = filt(dr, 'lp', t => 180 + 420 * lfo(t), 1.2);
  for (let i = 0; i < n; i++) b[i] += drone[i] * 0.22 + sub[i] * 0.25 * (0.7 + 0.3 * lfo(i / SR));
  const beat = 0.6;
  for (let k = 0; k < 40; k++) {
    const t0 = k * beat;
    mix(b, thump(0.4, 95, 42, 0.12, 0.03), t0, k % 2 ? 0.45 : 0.75);
    srand(1000 + k);
    mix(b, env(filt(noise(0.06), 'hp', 6000), t => dec(t, 0.01)), t0 + beat / 2, 0.08);
  }
  // вздохи: малая секунда, нарастает и гаснет
  for (const [at, notes] of [[2.4, [62, 63]], [9.6, [65, 66]], [14.4, [62, 63]], [21.6, [58, 59]]]) {
    for (const nn of notes) {
      mix(b, env(filt(tone(4.0, midi(nn), 'saw', rnd()), 'lp', 1100), t => Math.sin(Math.PI * clamp(t / 4, 0, 1)) ** 2), at, 0.07);
    }
  }
  // металлический скрежет вдалеке
  for (const at of [6.0, 18.0]) {
    srand(at * 7);
    mix(b, env(filt(noise(1.6), 'bp', t => 1400 + 400 * Math.sin(t * 5), 12), t => Math.sin(Math.PI * clamp(t / 1.6, 0, 1))), at, 0.25);
  }
});

// ---------- запуск ----------
fs.mkdirSync(OUT, { recursive: true });
let i = 0;
for (const [name, fn] of Object.entries(S)) {
  i++;
  if (ONLY.size && !ONLY.has(name)) continue;
  srand(i * 7919);
  const loop = name.startsWith('music_');
  wav(name, finish(fn(), { loop }));
}
