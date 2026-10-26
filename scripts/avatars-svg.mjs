// Готовые аватарки: плоские звери в SVG (public/avatars/<n>.svg).
// 1–16 — бесплатные, 17–32 — открываются за монетки в «Витрине» (server/shop.js), 25–32 — анимированные.
// Новых зверей добавляем только в конец: номер файла — это то, что хранится у игрока.
//   node scripts/avatars-svg.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/avatars');
fs.mkdirSync(out, { recursive: true });

const INK = '#1C2140';
const eyes = (y = 128, dx = 30, r = 13, white = false) =>
  (white ? `<circle cx="${128 - dx}" cy="${y}" r="${r + 7}" fill="#fff"/><circle cx="${128 + dx}" cy="${y}" r="${r + 7}" fill="#fff"/>` : '') +
  `<circle cx="${128 - dx}" cy="${y}" r="${r}" fill="${INK}"/><circle cx="${128 + dx}" cy="${y}" r="${r}" fill="${INK}"/>` +
  `<circle cx="${128 - dx + r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.35}" fill="#fff"/><circle cx="${128 + dx + r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.35}" fill="#fff"/>`;
const cheeks = (y = 160, dx = 58, c = '#FF8FA3') => `<ellipse cx="${128 - dx}" cy="${y}" rx="14" ry="9" fill="${c}" opacity=".7"/><ellipse cx="${128 + dx}" cy="${y}" rx="14" ry="9" fill="${c}" opacity=".7"/>`;
const smile = (y = 168, w = 16) => `<path d="M${128 - w} ${y} Q128 ${y + w} ${128 + w} ${y}" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
const catMouth = (y = 160) => `<path d="M112 ${y} Q120 ${y + 12} 128 ${y} Q136 ${y + 12} 144 ${y}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
const nose = (y = 150, w = 12, c = INK) => `<path d="M${128 - w} ${y - 6} Q128 ${y - 10} ${128 + w} ${y - 6} Q128 ${y + 10} ${128 - w} ${y - 6}Z" fill="${c}"/>`;

// Каждый зверь — фон и голова. Голова примерно в круге r≈80 с центром (128, 140).
const ANIMALS = [
  ['Кот', '#2E6BFF', () => `
    <path d="M58 118 L66 44 L112 84Z" fill="#F59E42"/><path d="M198 118 L190 44 L144 84Z" fill="#F59E42"/>
    <path d="M70 100 L74 62 L100 86Z" fill="#FFC9A8"/><path d="M186 100 L182 62 L156 86Z" fill="#FFC9A8"/>
    <ellipse cx="128" cy="142" rx="84" ry="74" fill="#F59E42"/>
    <path d="M104 74 Q110 96 100 108 M128 70 Q132 94 128 106 M152 74 Q146 96 156 108" stroke="#D9761E" stroke-width="7" fill="none" stroke-linecap="round"/>
    <ellipse cx="128" cy="162" rx="40" ry="28" fill="#FFE6D1"/>
    ${eyes(132, 32, 12)}${nose(152, 9, '#E5536D')}${catMouth(160)}
    <path d="M60 150 H28 M62 162 H32 M196 150 H228 M194 162 H224" stroke="${INK}" stroke-width="4" stroke-linecap="round" opacity=".6"/>`],
  ['Собака', '#17B26A', () => `
    <ellipse cx="128" cy="140" rx="78" ry="78" fill="#C98A4B"/>
    <path d="M58 92 Q30 100 34 168 Q48 186 70 160 Z" fill="#7A4A23"/><path d="M198 92 Q226 100 222 168 Q208 186 186 160 Z" fill="#7A4A23"/>
    <ellipse cx="160" cy="118" rx="26" ry="24" fill="#E8C7A0"/>
    <ellipse cx="128" cy="170" rx="44" ry="32" fill="#F2DCC2"/>
    ${eyes(124, 30, 12)}<ellipse cx="128" cy="154" rx="16" ry="11" fill="${INK}"/>
    <path d="M128 164 V176 M112 178 Q128 188 144 178" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M120 184 Q128 210 136 184Z" fill="#F2557A"/>`],
  ['Лиса', '#1C2140', () => `
    <path d="M56 120 L58 40 L112 86Z" fill="#F26B21"/><path d="M200 120 L198 40 L144 86Z" fill="#F26B21"/>
    <path d="M68 100 L68 60 L98 86Z" fill="${INK}" opacity=".85"/><path d="M188 100 L188 60 L158 86Z" fill="${INK}" opacity=".85"/>
    <path d="M128 216 L44 132 Q60 70 128 70 Q196 70 212 132 Z" fill="#F26B21"/>
    <path d="M128 216 L60 142 Q92 150 128 172 Q164 150 196 142 Z" fill="#FFF4E8"/>
    ${eyes(128, 34, 11)}${nose(196, 12)}`],
  ['Медведь', '#F2434F', () => `
    <circle cx="66" cy="76" r="30" fill="#8B5A2B"/><circle cx="190" cy="76" r="30" fill="#8B5A2B"/>
    <circle cx="66" cy="76" r="15" fill="#D9A877"/><circle cx="190" cy="76" r="15" fill="#D9A877"/>
    <circle cx="128" cy="140" r="84" fill="#8B5A2B"/>
    <ellipse cx="128" cy="166" rx="44" ry="34" fill="#D9A877"/>
    ${eyes(126, 34, 12)}${nose(156, 14)}${smile(172, 12)}`],
  ['Панда', '#8B5CF6', () => `
    <circle cx="64" cy="74" r="30" fill="${INK}"/><circle cx="192" cy="74" r="30" fill="${INK}"/>
    <circle cx="128" cy="140" r="86" fill="#fff"/>
    <ellipse cx="94" cy="132" rx="26" ry="32" fill="${INK}" transform="rotate(-25 94 132)"/><ellipse cx="162" cy="132" rx="26" ry="32" fill="${INK}" transform="rotate(25 162 132)"/>
    <circle cx="96" cy="130" r="10" fill="#fff"/><circle cx="160" cy="130" r="10" fill="#fff"/><circle cx="98" cy="128" r="5" fill="${INK}"/><circle cx="158" cy="128" r="5" fill="${INK}"/>
    ${nose(164, 12)}${smile(178, 12)}${cheeks(172, 62)}`],
  ['Зайка', '#FFC531', () => `
    <ellipse cx="96" cy="66" rx="22" ry="58" fill="#EEF1F7"/><ellipse cx="160" cy="66" rx="22" ry="58" fill="#EEF1F7"/>
    <ellipse cx="96" cy="70" rx="11" ry="42" fill="#FFB3C6"/><ellipse cx="160" cy="70" rx="11" ry="42" fill="#FFB3C6"/>
    <circle cx="128" cy="150" r="78" fill="#EEF1F7"/>
    ${eyes(140, 30, 12)}${nose(162, 9, '#F2557A')}
    <path d="M128 162 V172 M114 176 Q128 186 142 176" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <rect x="118" y="178" width="20" height="16" rx="4" fill="#fff" stroke="${INK}" stroke-width="3"/>${cheeks(172, 58)}`],
  ['Лягушка', '#2E6BFF', () => `
    <circle cx="88" cy="88" r="34" fill="#4ADE80"/><circle cx="168" cy="88" r="34" fill="#4ADE80"/>
    <ellipse cx="128" cy="152" rx="94" ry="70" fill="#4ADE80"/>
    ${eyes(86, 40, 15, true)}
    <path d="M70 160 Q128 214 186 160" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
    ${cheeks(150, 70, '#FF7AA2')}<circle cx="116" cy="130" r="4" fill="${INK}"/><circle cx="140" cy="130" r="4" fill="${INK}"/>`],
  ['Сова', '#0E9F9A', () => `
    <path d="M58 70 L84 104 L60 116Z" fill="#7A5230"/><path d="M198 70 L172 104 L196 116Z" fill="#7A5230"/>
    <ellipse cx="128" cy="146" rx="80" ry="82" fill="#A0703F"/>
    <path d="M70 170 Q128 120 186 170 Q186 226 128 226 Q70 226 70 170Z" fill="#E8C9A0"/>
    <circle cx="96" cy="124" r="30" fill="#FFF4D6"/><circle cx="160" cy="124" r="30" fill="#FFF4D6"/>
    ${eyes(124, 32, 15)}<path d="M116 150 L140 150 L128 172Z" fill="#F59E0B"/>
    <path d="M100 196 l8 -8 l8 8 M124 196 l8 -8 l8 8 M148 196 l8 -8 l8 8" stroke="#B58A5A" stroke-width="4" fill="none"/>`],
  ['Лев', '#F2434F', () => `
    <g fill="#C2410C">${Array.from({ length: 14 }, (_, i) => { const a = i * Math.PI / 7; return `<circle cx="${128 + Math.cos(a) * 82}" cy="${140 + Math.sin(a) * 82}" r="32"/>`; }).join('')}</g>
    <circle cx="70" cy="86" r="18" fill="#FBBF24"/><circle cx="186" cy="86" r="18" fill="#FBBF24"/>
    <circle cx="128" cy="142" r="72" fill="#FBBF24"/>
    <ellipse cx="128" cy="170" rx="36" ry="26" fill="#FFF1C9"/>
    ${eyes(130, 28, 11)}${nose(158, 12, '#7A3E12')}${catMouth(170)}`],
  ['Тигр', '#17B26A', () => `
    <circle cx="66" cy="78" r="26" fill="#F97316"/><circle cx="190" cy="78" r="26" fill="#F97316"/>
    <circle cx="66" cy="78" r="12" fill="#FFF4E8"/><circle cx="190" cy="78" r="12" fill="#FFF4E8"/>
    <ellipse cx="128" cy="142" rx="86" ry="80" fill="#F97316"/>
    <path d="M128 64 v26 M108 68 q4 18 -2 30 M148 68 q-4 18 2 30 M46 130 h30 M50 152 h24 M210 130 h-30 M206 152 h-24" stroke="${INK}" stroke-width="8" stroke-linecap="round" fill="none"/>
    <ellipse cx="128" cy="174" rx="48" ry="34" fill="#FFF4E8"/>
    ${eyes(130, 32, 12)}${nose(162, 12, '#E5536D')}${catMouth(174)}`],
  ['Пингвин', '#FFC531', () => `
    <ellipse cx="128" cy="142" rx="86" ry="84" fill="${INK}"/>
    <path d="M128 222 Q56 222 60 150 Q62 100 100 100 Q120 100 128 118 Q136 100 156 100 Q194 100 196 150 Q200 222 128 222Z" fill="#fff"/>
    ${eyes(132, 28, 12)}<path d="M108 156 Q128 146 148 156 Q128 178 108 156Z" fill="#F59E0B"/>${cheeks(170, 52)}`],
  ['Коала', '#8B5CF6', () => `
    <circle cx="56" cy="96" r="40" fill="#9CA3AF"/><circle cx="200" cy="96" r="40" fill="#9CA3AF"/>
    <circle cx="56" cy="96" r="24" fill="#F3F4F6"/><circle cx="200" cy="96" r="24" fill="#F3F4F6"/>
    <circle cx="128" cy="144" r="80" fill="#9CA3AF"/>
    ${eyes(128, 34, 11)}<ellipse cx="128" cy="160" rx="22" ry="28" fill="${INK}"/><ellipse cx="122" cy="150" rx="6" ry="8" fill="#fff" opacity=".4"/>
    ${smile(194, 10)}`],
  ['Поросёнок', '#0E9F9A', () => `
    <path d="M58 104 L60 52 L104 82Z" fill="#F9A8C0"/><path d="M198 104 L196 52 L152 82Z" fill="#F9A8C0"/>
    <circle cx="128" cy="144" r="84" fill="#FBB6CE"/>
    ${eyes(122, 34, 11)}<ellipse cx="128" cy="164" rx="32" ry="24" fill="#F472B6"/>
    <ellipse cx="118" cy="164" rx="6" ry="9" fill="#9D174D"/><ellipse cx="138" cy="164" rx="6" ry="9" fill="#9D174D"/>${smile(196, 12)}`],
  ['Обезьянка', '#2E6BFF', () => `
    <circle cx="48" cy="140" r="30" fill="#8B5A2B"/><circle cx="208" cy="140" r="30" fill="#8B5A2B"/>
    <circle cx="48" cy="140" r="16" fill="#E8C29A"/><circle cx="208" cy="140" r="16" fill="#E8C29A"/>
    <circle cx="128" cy="138" r="82" fill="#8B5A2B"/>
    <path d="M128 112 Q100 84 82 110 Q66 140 92 160 Q76 200 128 206 Q180 200 164 160 Q190 140 174 110 Q156 84 128 112Z" fill="#E8C29A"/>
    ${eyes(132, 24, 11)}<circle cx="120" cy="164" r="4" fill="${INK}"/><circle cx="136" cy="164" r="4" fill="${INK}"/>${smile(180, 14)}`],
  ['Единорог', '#F2434F', () => `
    <path d="M70 120 L78 58 L112 94Z" fill="#fff"/><path d="M186 120 L178 58 L144 94Z" fill="#fff"/>
    <path d="M128 18 L144 82 L112 82Z" fill="#FFC531"/><path d="M118 42 L138 50 M115 58 L141 66" stroke="#E09B00" stroke-width="5"/>
    <path d="M60 120 Q40 60 98 66 Q80 96 92 120Z" fill="#C084FC"/><path d="M196 120 Q216 60 158 66 Q176 96 164 120Z" fill="#F472B6"/>
    <ellipse cx="128" cy="148" rx="76" ry="74" fill="#fff"/>
    ${eyes(136, 30, 12)}${cheeks(164, 54)}${smile(176, 14)}`],
  ['Енот', '#FFC531', () => `
    <path d="M56 112 L60 48 L106 84Z" fill="#6B7280"/><path d="M200 112 L196 48 L150 84Z" fill="#6B7280"/>
    <path d="M70 96 L72 66 L96 84Z" fill="#F3F4F6"/><path d="M186 96 L184 66 L160 84Z" fill="#F3F4F6"/>
    <ellipse cx="128" cy="144" rx="88" ry="78" fill="#9CA3AF"/>
    <path d="M44 130 Q90 100 128 132 Q166 100 212 130 Q190 160 160 150 Q128 140 96 150 Q66 160 44 130Z" fill="${INK}"/>
    <path d="M128 132 Q108 170 128 214 Q148 170 128 132Z" fill="#F3F4F6"/>
    <circle cx="96" cy="134" r="12" fill="#fff"/><circle cx="160" cy="134" r="12" fill="#fff"/><circle cx="98" cy="134" r="6" fill="${INK}"/><circle cx="158" cy="134" r="6" fill="${INK}"/>
    ${nose(178, 11)}`],
  // ---------- 17–24: за монетки ----------
  ['Дракон', '#8B5CF6', () => `
    <path d="M86 84 L68 26 L110 70Z" fill="#FFC531"/><path d="M170 84 L188 26 L146 70Z" fill="#FFC531"/>
    <path d="M38 118 L64 98 L66 142Z" fill="#2FB872"/><path d="M218 118 L192 98 L190 142Z" fill="#2FB872"/>
    <path d="M108 72 L128 42 L148 72Z" fill="#F2434F"/>
    <ellipse cx="128" cy="142" rx="82" ry="76" fill="#3DCB81"/>
    <circle cx="86" cy="96" r="7" fill="#2FB872"/><circle cx="170" cy="96" r="7" fill="#2FB872"/><circle cx="128" cy="86" r="6" fill="#2FB872"/>
    <ellipse cx="128" cy="178" rx="52" ry="32" fill="#B8F5D2"/>
    ${eyes(128, 34, 11, true)}
    <ellipse cx="112" cy="168" rx="6" ry="4" fill="#0B7F4B"/><ellipse cx="144" cy="168" rx="6" ry="4" fill="#0B7F4B"/>
    ${smile(186, 16)}<path d="M104 190 L110 200 L116 192Z M140 192 L146 200 L152 190Z" fill="#fff"/>`],
  ['Ёжик', '#FFC531', () => `
    <g fill="#6B4423">${Array.from({ length: 12 }, (_, i) => {
      const a = (160 + i * 20) * Math.PI / 180, w = 0.2;
      const p = (ang, r) => `${(128 + Math.cos(ang) * r).toFixed(1)} ${(150 + Math.sin(ang) * r).toFixed(1)}`;
      return `<path d="M${p(a - w, 64)} L${p(a, 112)} L${p(a + w, 64)}Z"/>`;
    }).join('')}</g>
    <circle cx="128" cy="150" r="80" fill="#8B5A2B"/>
    <path d="M60 170 Q64 106 128 104 Q192 106 196 170 Q190 226 128 226 Q66 226 60 170Z" fill="#F2D3A8"/>
    ${eyes(150, 30, 11)}${cheeks(178, 50)}${nose(184, 14)}${smile(198, 10)}`],
  ['Кит', '#0E9F9A', () => `
    <path d="M128 74 V48 M128 54 Q110 28 92 42 M128 54 Q146 28 164 42" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round"/>
    <ellipse cx="128" cy="152" rx="94" ry="72" fill="#3B7BF5"/>
    <path d="M44 174 Q128 150 212 174 Q190 222 128 224 Q66 222 44 174Z" fill="#D6E4FF"/>
    <path d="M92 190 V210 M110 186 V214 M128 184 V216 M146 186 V214 M164 190 V210" stroke="#A9C3F7" stroke-width="5" stroke-linecap="round"/>
    ${eyes(138, 42, 11)}${cheeks(160, 66)}${smile(160, 14)}`],
  ['Осьминог', '#2E6BFF', () => `
    <g fill="none" stroke="#E84A6E" stroke-width="22" stroke-linecap="round">
      <path d="M78 160 Q46 196 66 222"/><path d="M104 170 Q92 210 110 230"/><path d="M128 172 V232"/>
      <path d="M152 170 Q164 210 146 230"/><path d="M178 160 Q210 196 190 222"/></g>
    <ellipse cx="128" cy="116" rx="82" ry="74" fill="#F2557A"/>
    <circle cx="92" cy="74" r="9" fill="#FF8FAB"/><circle cx="160" cy="70" r="12" fill="#FF8FAB"/><circle cx="134" cy="56" r="6" fill="#FF8FAB"/>
    ${eyes(120, 32, 12, true)}${cheeks(148, 60, '#C0264D')}${smile(150, 12)}`],
  ['Хомяк', '#F2434F', () => `
    <circle cx="70" cy="78" r="24" fill="#E8A15C"/><circle cx="186" cy="78" r="24" fill="#E8A15C"/>
    <circle cx="70" cy="78" r="12" fill="#FFB3C6"/><circle cx="186" cy="78" r="12" fill="#FFB3C6"/>
    <ellipse cx="128" cy="150" rx="94" ry="80" fill="#E8A15C"/>
    <ellipse cx="72" cy="176" rx="38" ry="32" fill="#FFF1DE"/><ellipse cx="184" cy="176" rx="38" ry="32" fill="#FFF1DE"/>
    <path d="M128 92 Q100 118 102 168 Q128 206 154 168 Q156 118 128 92Z" fill="#FFF1DE"/>
    ${eyes(134, 38, 11)}${nose(164, 9, '#E5536D')}
    <path d="M128 168 V178 M116 182 Q128 190 140 182" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <rect x="120" y="186" width="16" height="12" rx="3" fill="#fff" stroke="${INK}" stroke-width="3"/>`],
  ['Попугай', '#2E6BFF', () => `
    <path d="M124 66 Q106 24 82 30 Q106 46 108 70Z" fill="#FFC531"/><path d="M132 66 Q146 20 174 24 Q150 44 150 70Z" fill="#17B26A"/>
    <ellipse cx="128" cy="142" rx="80" ry="82" fill="#F2434F"/>
    <ellipse cx="94" cy="128" rx="28" ry="26" fill="#fff"/><ellipse cx="162" cy="128" rx="28" ry="26" fill="#fff"/>
    ${eyes(128, 34, 11)}
    <path d="M100 154 Q128 140 156 154 Q158 190 128 210 Q106 190 100 154Z" fill="#FFC531"/>
    <path d="M112 182 Q128 194 144 182 Q140 202 128 210 Q116 202 112 182Z" fill="#E09B00"/>`],
  ['Олень', '#17B26A', () => `
    <g fill="none" stroke="#7A4A23" stroke-width="10" stroke-linecap="round">
      <path d="M96 82 Q82 54 88 22 M88 50 Q70 46 60 30"/><path d="M160 82 Q174 54 168 22 M168 50 Q186 46 196 30"/></g>
    <ellipse cx="56" cy="114" rx="32" ry="15" fill="#B5733A" transform="rotate(-22 56 114)"/>
    <ellipse cx="200" cy="114" rx="32" ry="15" fill="#B5733A" transform="rotate(22 200 114)"/>
    <ellipse cx="128" cy="148" rx="70" ry="80" fill="#C98A4B"/>
    <circle cx="108" cy="92" r="6" fill="#F2DCC2"/><circle cx="148" cy="96" r="5" fill="#F2DCC2"/><circle cx="130" cy="82" r="4" fill="#F2DCC2"/>
    <ellipse cx="128" cy="190" rx="42" ry="32" fill="#F2DCC2"/>
    ${eyes(136, 30, 12)}<ellipse cx="128" cy="178" rx="16" ry="11" fill="${INK}"/>${smile(198, 10)}`],
  ['Акула', '#FFC531', () => `
    <path d="M128 16 Q152 50 164 76 L96 76 Q110 44 128 16Z" fill="#5E6E86"/>
    <ellipse cx="128" cy="146" rx="94" ry="78" fill="#7C8BA1"/>
    <path d="M42 160 Q128 132 214 160 Q202 218 128 224 Q54 218 42 160Z" fill="#F3F4F6"/>
    <path d="M50 120 q-8 12 0 24 M64 116 q-8 14 0 28 M206 120 q8 12 0 24 M192 116 q8 14 0 28" stroke="#56647A" stroke-width="5" fill="none" stroke-linecap="round"/>
    ${eyes(124, 40, 11)}
    <path d="M86 166 Q128 214 170 166Z" fill="#9D174D"/>
    <path d="M86 166 L95 177 L104 169 L113 180 L122 170 L131 180 L140 170 L149 179 L158 169 L166 175 L170 166Z" fill="#fff"/>`],
];

ANIMALS.forEach(([name, bg, head], i) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><title>${name}</title>` +
    `<rect width="256" height="256" fill="${bg}"/><circle cx="128" cy="256" r="150" fill="#fff" opacity=".08"/>${head().replace(/\s+\n\s*/g, '')}</svg>\n`;
  fs.writeFileSync(path.join(out, `${i + 1}.svg`), svg);
});

// ---------- 25–32: анимированные (дорогие в витрине) ----------
// Анимация — CSS внутри самого SVG: она идёт и в <img>, скриптов нет. Двигаются только transform и opacity,
// при «уменьшить движение» в системе всё стоит. Градиенты здесь можно: у каждого файла свой документ и свои id.
const BASE_CSS = `
.b{transform-box:fill-box;transform-origin:center;animation:blink 4.6s infinite}
@keyframes blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
.tw{transform-box:fill-box;transform-origin:center;animation:tw 2.4s ease-in-out infinite}
@keyframes tw{0%,100%{transform:scale(.3);opacity:.2}50%{transform:scale(1);opacity:1}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;
const blinkEyes = (...args) => `<g class="b">${eyes(...args)}</g>`;
// Искорка-звёздочка с четырьмя лучами; d — задержка анимации в секундах.
const sparkle = (x, y, r, d = 0, c = '#fff') =>
  `<path class="tw" style="animation-delay:-${d}s" fill="${c}" d="M${x} ${y - r}Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y}Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y}Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z"/>`;
const delay = (d) => `style="animation-delay:-${d}s"`;

const ANIMATED = [
  ['Феникс', `<radialGradient id="bg" cx="50%" cy="62%" r="70%"><stop offset="0" stop-color="#FF9A3D"/><stop offset=".45" stop-color="#C2183F"/><stop offset="1" stop-color="#3A0A2E"/></radialGradient>`, `
.wl{transform-origin:128px 176px;animation:wl 1.8s ease-in-out infinite}
.wr{transform-origin:128px 176px;animation:wr 1.8s ease-in-out infinite}
@keyframes wl{0%,100%{transform:rotate(0)}50%{transform:rotate(-7deg)}}
@keyframes wr{0%,100%{transform:rotate(0)}50%{transform:rotate(7deg)}}
.cr{transform-origin:128px 92px;animation:cr 2.6s ease-in-out infinite}
@keyframes cr{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
.gl{transform-origin:128px 142px;animation:gl 2.2s ease-in-out infinite}
@keyframes gl{0%,100%{transform:scale(.92);opacity:.35}50%{transform:scale(1.06);opacity:.6}}
.em{animation:em 3s linear infinite}
@keyframes em{0%{transform:translateY(0);opacity:0}15%{opacity:1}100%{transform:translateY(-150px);opacity:0}}`, () => `
    <circle class="gl" cx="128" cy="142" r="96" fill="#FFB13B"/>
    <g class="wl"><path d="M128 182 Q58 180 14 112 Q46 118 54 106 Q22 86 16 50 Q56 76 70 70 Q54 42 58 14 Q100 60 120 116Z" fill="#D61F45"/><path d="M128 176 Q70 170 30 118 Q58 122 66 112 Q38 96 28 66 Q62 86 78 82 Q62 60 64 34 Q96 70 118 120Z" fill="#FF6A2C"/>
      <path d="M124 172 Q80 160 56 122 Q76 124 84 118 Q66 102 62 82 Q86 98 98 98 Q90 80 92 64 Q110 96 124 136Z" fill="#FFC531"/></g>
    <g class="wr"><path d="M128 182 Q198 180 242 112 Q210 118 202 106 Q234 86 240 50 Q200 76 186 70 Q202 42 198 14 Q156 60 136 116Z" fill="#D61F45"/><path d="M128 176 Q186 170 226 118 Q198 122 190 112 Q218 96 228 66 Q194 86 178 82 Q194 60 192 34 Q160 70 138 120Z" fill="#FF6A2C"/>
      <path d="M132 172 Q176 160 200 122 Q180 124 172 118 Q190 102 194 82 Q170 98 158 98 Q166 80 164 64 Q146 96 132 136Z" fill="#FFC531"/></g>
    <g class="cr"><path d="M120 92 Q104 58 116 30 Q122 60 128 88Z" fill="#FFD23F"/><path d="M128 90 Q126 50 140 20 Q140 58 136 90Z" fill="#FF8C2B"/>
      <path d="M136 92 Q150 62 168 46 Q156 74 142 96Z" fill="#FFD23F"/></g>
    <circle cx="128" cy="146" r="58" fill="#FF8A2B"/><path d="M74 128 Q128 70 182 128 Q160 104 128 104 Q96 104 74 128Z" fill="#FF6A2C"/>
    <ellipse cx="128" cy="168" rx="40" ry="30" fill="#FFB15C"/>
    ${blinkEyes(130, 26, 11, true)}${cheeks(158, 46, '#FFD0A1')}
    <path d="M112 150 L144 150 L128 176Z" fill="#FFC531" stroke="#D97706" stroke-width="3" stroke-linejoin="round"/>
    ${[[92, 236, 0], [118, 246, 1.1], [150, 240, 2.1], [170, 248, .6], [134, 250, 1.7], [104, 252, 2.5]].map(([x, y, d]) =>
      `<circle class="em" ${delay(d)} cx="${x}" cy="${y}" r="${3 + (x % 3)}" fill="#FFE08A"/>`).join('')}`],

  ['Единорог', `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7C6CFF"/><stop offset="1" stop-color="#F0A6FF"/></linearGradient>`, `
.mn{transform-origin:150px 80px;animation:mn 3s ease-in-out infinite}
@keyframes mn{0%,100%{transform:rotate(0)}50%{transform:rotate(5deg)}}
.hn{animation:hn 2.4s ease-in-out infinite}
@keyframes hn{0%,60%,100%{opacity:0}75%{opacity:.9}}`, () => `
    <g class="mn" fill="none" stroke-width="16" stroke-linecap="round">
      ${['#F2434F', '#FF9F1C', '#FFD23F', '#3DCB81', '#2E9BFF', '#8B5CF6'].map((c, i) =>
        `<path d="M${140 + i * 4} ${78 + i * 2} Q${206 + i * 6} ${96 + i * 10} ${190 + i * 4} ${168 + i * 10} Q${182 + i * 3} ${200 + i * 6} ${200 + i * 4} ${224}" stroke="${c}"/>`).join('')}</g>
    <path d="M82 104 L74 52 L112 86Z" fill="#fff"/><path d="M174 104 L182 52 L144 86Z" fill="#fff"/>
    <path d="M84 96 L80 66 L102 86Z" fill="#FFB3D9"/><path d="M172 96 L176 66 L154 86Z" fill="#FFB3D9"/>
    <ellipse cx="128" cy="146" rx="64" ry="72" fill="#fff"/>
    <path d="M114 82 L128 14 L142 82Z" fill="#FFC531"/>
    <path d="M118 66 L138 60 M120 50 L136 46 M123 34 L133 31" stroke="#E5A400" stroke-width="4" stroke-linecap="round"/>
    <path class="hn" d="M124 80 L128 18 L131 80Z" fill="#fff"/>
    <path d="M104 90 Q118 70 132 86 Q140 72 158 84 Q146 98 128 96 Q114 100 104 90Z" fill="#FF8FC7"/>
    <ellipse cx="128" cy="188" rx="40" ry="28" fill="#FFD9EC"/>
    <ellipse cx="114" cy="186" rx="5" ry="7" fill="#E58DB8"/><ellipse cx="142" cy="186" rx="5" ry="7" fill="#E58DB8"/>
    ${blinkEyes(138, 28, 12, true)}${cheeks(166, 50)}
    <path d="M118 204 Q128 212 138 204" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    ${sparkle(40, 60, 12, 0)}${sparkle(214, 44, 9, 1.2)}${sparkle(34, 196, 8, .6)}${sparkle(226, 200, 11, 1.8, '#FFF6B3')}${sparkle(128, 12, 8, .3, '#FFF6B3')}`],

  ['Робот', `<radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#1BC5B4"/><stop offset="1" stop-color="#0B3B5C"/></radialGradient>`, `
.al{animation:al 1.4s steps(1) infinite}
@keyframes al{0%,100%{opacity:1}50%{opacity:.25}}
.sc{animation:sc 3.2s ease-in-out infinite}
@keyframes sc{0%,100%{transform:translateX(-9px)}50%{transform:translateX(9px)}}
.eq{transform-box:fill-box;transform-origin:center;animation:eq .9s ease-in-out infinite}
@keyframes eq{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}`, () => `
    <path d="M24 196 H70 V174 M232 196 H186 V174 M40 56 H80 V84 M216 56 H176 V84" stroke="#2FE0CC" stroke-width="4" fill="none" opacity=".35"/>
    <line x1="128" y1="62" x2="128" y2="34" stroke="#C9D3E3" stroke-width="8" stroke-linecap="round"/>
    <circle class="al" cx="128" cy="30" r="16" fill="#F2434F" opacity=".35"/><circle class="al" cx="128" cy="30" r="9" fill="#FF6B76"/>
    <rect x="32" y="112" width="28" height="48" rx="10" fill="#9AA8BF"/><rect x="196" y="112" width="28" height="48" rx="10" fill="#9AA8BF"/>
    <rect x="52" y="60" width="152" height="140" rx="36" fill="#C9D3E3"/>
    <rect x="62" y="68" width="132" height="22" rx="11" fill="#E3E9F2"/>
    <rect x="68" y="96" width="120" height="56" rx="28" fill="${INK}"/>
    <g class="sc"><g class="b"><rect x="92" y="110" width="20" height="28" rx="10" fill="#5EF0FF"/><rect x="144" y="110" width="20" height="28" rx="10" fill="#5EF0FF"/></g></g>
    <circle cx="72" cy="168" r="8" fill="#FF8FA3" opacity=".8"/><circle cx="184" cy="168" r="8" fill="#FF8FA3" opacity=".8"/>
    <rect x="94" y="160" width="68" height="28" rx="10" fill="#33405A"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect class="eq" ${delay(i * 0.17 + (i % 2) * 0.3)} x="${101 + i * 11}" y="164" width="7" height="20" rx="3" fill="${i % 2 ? '#3DCB81' : '#5EF0FF'}"/>`).join('')}
    <circle cx="66" cy="76" r="5" fill="#9AA8BF"/><circle cx="190" cy="76" r="5" fill="#9AA8BF"/><circle cx="66" cy="186" r="5" fill="#9AA8BF"/><circle cx="190" cy="186" r="5" fill="#9AA8BF"/>`],

  ['Привидение', `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#241656"/><stop offset="1" stop-color="#5B2E91"/></linearGradient>`, `
.fl{animation:fl 3s ease-in-out infinite}
@keyframes fl{0%,100%{transform:translateY(4px)}50%{transform:translateY(-10px)}}
.sh{transform-origin:128px 234px;animation:sh 3s ease-in-out infinite}
@keyframes sh{0%,100%{transform:scale(1);opacity:.3}50%{transform:scale(.72);opacity:.16}}`, () => `
    <circle cx="200" cy="58" r="26" fill="#FFF3C4"/><circle cx="192" cy="52" r="6" fill="#F1DE9A"/><circle cx="208" cy="66" r="4" fill="#F1DE9A"/>
    ${sparkle(46, 52, 8, 0)}${sparkle(80, 30, 5, 1)}${sparkle(30, 140, 6, 1.6)}${sparkle(228, 132, 7, .7)}
    <ellipse class="sh" cx="128" cy="234" rx="48" ry="8" fill="#000"/>
    <g class="fl">
      <path d="M62 204 V132 A66 66 0 0 1 194 132 V204 Q178 190 162 204 Q145 218 128 204 Q111 190 94 204 Q78 218 62 204Z" fill="#fff"/>
      <path d="M194 132 V204 Q178 190 162 204 Q170 172 168 132 A66 66 0 0 0 144 76 A66 66 0 0 1 194 132Z" fill="#E6E2F6"/>
      <ellipse cx="54" cy="156" rx="16" ry="11" fill="#fff" transform="rotate(-30 54 156)"/><ellipse cx="202" cy="156" rx="16" ry="11" fill="#E6E2F6" transform="rotate(30 202 156)"/>
      <g class="b"><ellipse cx="104" cy="130" rx="13" ry="18" fill="${INK}"/><ellipse cx="152" cy="130" rx="13" ry="18" fill="${INK}"/>
        <circle cx="108" cy="122" r="5" fill="#fff"/><circle cx="156" cy="122" r="5" fill="#fff"/></g>
      ${cheeks(156, 42)}<ellipse cx="128" cy="164" rx="9" ry="11" fill="${INK}"/></g>`],

  ['Кот-космонавт', `<radialGradient id="bg" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#2B2370"/><stop offset="1" stop-color="#070B24"/></radialGradient>
    <clipPath id="glass"><circle cx="128" cy="124" r="78"/></clipPath>
    <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`, `
.st{animation:st 14s linear infinite}
@keyframes st{from{transform:translateX(0)}to{transform:translateX(-256px)}}
.bob{animation:bob 4s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-6px) rotate(-2deg)}}
.sw{animation:sw 4.5s ease-in-out infinite}
@keyframes sw{0%,55%{transform:translateX(-200px)}100%{transform:translateX(220px)}}
.pl{transform-origin:46px 206px;animation:pl 9s linear infinite}
@keyframes pl{to{transform:rotate(360deg)}}`, () => {
    const stars = [[20, 30], [70, 70], [120, 20], [170, 54], [230, 26], [40, 120], [210, 110], [100, 210], [240, 180], [150, 236]]
      .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${1.5 + (i % 3)}" fill="#fff" opacity="${0.5 + (i % 2) * 0.4}"/>`).join('');
    return `
    <g class="st">${stars}<g transform="translate(256 0)">${stars}</g></g>
    <g class="pl"><circle cx="46" cy="206" r="22" fill="#8B5CF6"/><ellipse cx="46" cy="206" rx="36" ry="9" fill="none" stroke="#FFC531" stroke-width="5" transform="rotate(-20 46 206)"/></g>
    <g class="bob">
      <ellipse cx="128" cy="246" rx="92" ry="44" fill="#E5E7EB"/><path d="M60 230 Q128 250 196 230" stroke="#2E6BFF" stroke-width="8" fill="none"/>
      <circle cx="128" cy="124" r="84" fill="#E5E7EB"/>
      <circle cx="128" cy="124" r="74" fill="#7DD3FC" opacity=".35"/>
      <g clip-path="url(#glass)"><g transform="translate(128 132) scale(.74) translate(-128 -140)">
        <path d="M58 118 L66 44 L112 84Z" fill="#F59E42"/><path d="M198 118 L190 44 L144 84Z" fill="#F59E42"/>
        <path d="M70 100 L74 62 L100 86Z" fill="#FFC9A8"/><path d="M186 100 L182 62 L156 86Z" fill="#FFC9A8"/>
        <ellipse cx="128" cy="142" rx="84" ry="74" fill="#F59E42"/>
        <ellipse cx="128" cy="162" rx="40" ry="28" fill="#FFE6D1"/>
        ${blinkEyes(132, 32, 13)}${nose(152, 9, '#E5536D')}${catMouth(160)}${cheeks(164, 56)}</g>
        <rect class="sw" x="40" y="20" width="60" height="220" fill="url(#shine)" transform="rotate(20 128 124)"/></g>
      <path d="M78 84 Q100 62 132 58" stroke="#fff" stroke-width="8" fill="none" stroke-linecap="round" opacity=".7"/>
      <circle cx="128" cy="124" r="78" fill="none" stroke="#CBD5E1" stroke-width="6"/></g>`;
  }],

  ['Кицунэ', `<radialGradient id="bg" cx="50%" cy="55%" r="75%"><stop offset="0" stop-color="#3B1D7A"/><stop offset="1" stop-color="#0E0726"/></radialGradient>`, `
.tl{transform-origin:128px 210px;animation:tl 2.8s ease-in-out infinite}
@keyframes tl{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}
.wf{transform-box:fill-box;transform-origin:50% 100%;animation:wf 1.1s ease-in-out infinite}
@keyframes wf{0%,100%{transform:scale(1,1) translateY(0)}50%{transform:scale(.85,1.15) translateY(-6px)}}
.mk{animation:mk 2.6s ease-in-out infinite}
@keyframes mk{0%,100%{opacity:.75}50%{opacity:1}}`, () => {
    // Хвосты сиреневые с голубыми кончиками: белые сливались с мордой в одно пятно.
    const tail = (rot, d) => `<g class="tl" ${delay(d)}><g transform="rotate(${rot} 128 214)">
      <path d="M128 214 Q102 150 116 62 Q130 36 150 58 Q160 150 128 214Z" fill="#C4B5FD"/>
      <path d="M116 62 Q130 36 150 58 Q150 80 142 92 Q128 76 116 62Z" fill="#7DD3FC"/>
      <path d="M124 196 Q114 140 124 84" fill="none" stroke="#A78BFA" stroke-width="4" stroke-linecap="round"/></g></g>`;
    const wisp = (x, y, d) => `<g class="wf" ${delay(d)}><path d="M${x} ${y} q-10 -10 0 -30 q4 12 8 8 q4 14 -8 22Z" fill="#7DD3FC"/><path d="M${x} ${y - 4} q-4 -6 0 -14 q4 8 3 10Z" fill="#E0F2FE"/></g>`;
    return `
    ${tail(-58, 0)}${tail(-30, .5)}${tail(0, .25)}${tail(30, 1)}${tail(58, 1.5)}
    ${wisp(30, 128, 0)}${wisp(228, 100, .4)}${wisp(220, 226, .8)}
    <path d="M76 122 L70 46 L118 90Z" fill="#fff"/><path d="M180 122 L186 46 L138 90Z" fill="#fff"/>
    <path d="M82 106 L78 64 L106 90Z" fill="#E8405A"/><path d="M174 106 L178 64 L150 90Z" fill="#E8405A"/>
    <path d="M66 138 Q70 92 128 84 Q186 92 190 138 Q186 188 128 212 Q70 188 66 138Z" fill="#fff"/>
    <path d="M190 138 Q186 188 128 212 Q168 180 172 136 Q170 104 150 90 Q186 100 190 138Z" fill="#E9E4FB"/>
    <g class="mk" fill="#E8405A"><path d="M128 92 Q120 106 128 116 Q136 106 128 92Z"/>
      <path d="M70 148 Q84 142 92 150 Q82 154 70 148Z"/><path d="M186 148 Q172 142 164 150 Q174 154 186 148Z"/>
      <path d="M80 160 Q92 156 98 162 Q90 166 80 160Z"/><path d="M176 160 Q164 156 158 162 Q166 166 176 160Z"/></g>
    <g class="b"><path d="M92 132 Q106 120 120 132 Q106 138 92 132Z" fill="${INK}"/><path d="M136 132 Q150 120 164 132 Q150 138 136 132Z" fill="${INK}"/></g>
    <ellipse cx="128" cy="182" rx="10" ry="7" fill="${INK}"/>
    <path d="M116 194 Q128 202 140 194" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
  }],

  ['Пингвин-диджей', `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF3D9A"/><stop offset="1" stop-color="#6D28D9"/></linearGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`, `
.bm{transform-origin:128px -10px;animation:bm 3.4s ease-in-out infinite}
@keyframes bm{0%,100%{transform:rotate(-24deg)}50%{transform:rotate(24deg)}}
.hd{transform-origin:128px 214px;animation:hd .9s ease-in-out infinite}
@keyframes hd{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg) translateY(-3px)}}
.nt{animation:nt 2.7s ease-out infinite}
@keyframes nt{0%{transform:translate(0,0);opacity:0}15%{opacity:1}100%{transform:translate(14px,-90px);opacity:0}}`, () => {
    const note = (x, y, d, c) => `<g class="nt" ${delay(d)}><path d="M${x} ${y} v-26 l16 -5 v24" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round"/><circle cx="${x - 5}" cy="${y}" r="6" fill="${c}"/><circle cx="${x + 11}" cy="${y - 7}" r="6" fill="${c}"/></g>`;
    return `
    <path class="bm" d="M128 -10 L88 260 L168 260Z" fill="url(#beam)"/><path class="bm" ${delay(1.7)} d="M128 -10 L88 260 L168 260Z" fill="url(#beam)"/>
    ${note(30, 150, 0, '#fff')}${note(214, 130, .9, '#FFD23F')}${note(206, 230, 1.8, '#fff')}
    <g class="hd">
      <ellipse cx="128" cy="142" rx="78" ry="76" fill="#1F2440"/>
      <path d="M128 92 Q160 74 184 104 Q206 150 176 190 Q150 214 128 210 Q106 214 80 190 Q50 150 72 104 Q96 74 128 92Z" fill="#fff"/>
      ${blinkEyes(136, 26, 12)}${cheeks(166, 44)}
      <path d="M110 156 Q128 146 146 156 Q128 182 110 156Z" fill="#FF9F1C"/>
      <path d="M50 132 A78 78 0 0 1 206 132" fill="none" stroke="#F2434F" stroke-width="13" stroke-linecap="round"/>
      <rect x="30" y="118" width="34" height="54" rx="14" fill="#F2434F"/><rect x="38" y="128" width="18" height="34" rx="8" fill="#FFC531"/>
      <rect x="192" y="118" width="34" height="54" rx="14" fill="#F2434F"/><rect x="200" y="128" width="18" height="34" rx="8" fill="#FFC531"/></g>`;
  }],

  ['Золотой дракон', `<radialGradient id="bg" cx="50%" cy="55%" r="75%"><stop offset="0" stop-color="#0F766E"/><stop offset="1" stop-color="#042220"/></radialGradient>
    <clipPath id="head"><ellipse cx="128" cy="146" rx="74" ry="70"/></clipPath>
    <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`, `
.sm{transform-box:fill-box;transform-origin:center;animation:sm 2.6s ease-out infinite}
@keyframes sm{0%{transform:translateY(0) scale(.4);opacity:0}20%{opacity:.8}100%{transform:translateY(-70px) scale(1.6);opacity:0}}
.eg{transform-box:fill-box;transform-origin:center;animation:eg 1.8s ease-in-out infinite}
@keyframes eg{0%,100%{opacity:.25;transform:scale(.9)}50%{opacity:.7;transform:scale(1.15)}}
.sw{animation:sw 3.8s ease-in-out infinite}
@keyframes sw{0%,50%{transform:translateX(-190px)}100%{transform:translateX(200px)}}
.wk{transform-origin:128px 176px;animation:wk 3s ease-in-out infinite}
@keyframes wk{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}`, () => `
    ${sparkle(34, 60, 9, 0, '#FFE08A')}${sparkle(222, 70, 7, .8, '#FFE08A')}${sparkle(30, 200, 6, 1.4, '#FFE08A')}${sparkle(226, 196, 9, 2, '#FFE08A')}
    <path d="M92 92 Q70 44 32 30 Q60 58 64 98Z" fill="#FFC531"/><path d="M164 92 Q186 44 224 30 Q196 58 192 98Z" fill="#FFC531"/>
    <path d="M86 88 Q72 60 48 46 Q64 66 68 94Z" fill="#E5A400"/><path d="M170 88 Q184 60 208 46 Q192 66 188 94Z" fill="#E5A400"/>
    <path d="M56 120 L30 108 L50 136 L24 140 L54 154Z" fill="#14B8A6"/><path d="M200 120 L226 108 L206 136 L232 140 L202 154Z" fill="#14B8A6"/>
    <g class="wk" fill="none" stroke="#FFE08A" stroke-width="5" stroke-linecap="round">
      <path d="M96 186 Q60 196 46 228"/><path d="M160 186 Q196 196 210 228"/></g>
    <ellipse cx="128" cy="146" rx="74" ry="70" fill="#F5B82E"/>
    <g clip-path="url(#head)">
      <g fill="none" stroke="#D99A12" stroke-width="4" opacity=".7">
        <path d="M84 98 q10 10 20 0 q10 10 20 0 q10 10 20 0 q10 10 20 0"/><path d="M74 112 q10 10 20 0 q10 10 20 0 q10 10 20 0 q10 10 20 0 q10 10 20 0"/></g>
      <ellipse cx="128" cy="186" rx="50" ry="34" fill="#FFD97A"/>
      <rect class="sw" x="60" y="40" width="54" height="220" fill="url(#shine)" transform="rotate(18 128 146)"/></g>
    <circle class="eg" cx="98" cy="136" r="22" fill="#FF9A3D"/><circle class="eg" cx="158" cy="136" r="22" fill="#FF9A3D"/>
    <g class="b"><circle cx="98" cy="136" r="15" fill="#fff"/><circle cx="158" cy="136" r="15" fill="#fff"/>
      <circle cx="98" cy="136" r="11" fill="#FF6A2C"/><circle cx="158" cy="136" r="11" fill="#FF6A2C"/>
      <ellipse cx="98" cy="136" rx="3.5" ry="9" fill="${INK}"/><ellipse cx="158" cy="136" rx="3.5" ry="9" fill="${INK}"/>
      <circle cx="102" cy="131" r="3" fill="#fff"/><circle cx="162" cy="131" r="3" fill="#fff"/></g>
    <ellipse cx="112" cy="180" rx="7" ry="5" fill="#8A5A00"/><ellipse cx="144" cy="180" rx="7" ry="5" fill="#8A5A00"/>
    <path d="M108 200 Q128 212 148 200" fill="none" stroke="#8A5A00" stroke-width="5" stroke-linecap="round"/>
    <circle class="sm" cx="108" cy="170" r="9" fill="#E8EEF2"/><circle class="sm" ${delay(1.3)} cx="148" cy="170" r="9" fill="#E8EEF2"/>`],

  // 33 — не продаётся: за десять приглашённых друзей (server/shop.js, INVITE_ITEMS).
  ['Король вечеринки', `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C3AED"/><stop offset="1" stop-color="#EC4899"/></linearGradient>
    <clipPath id="lens"><path d="M70 120 h50 q4 0 4 4 v8 q0 22 -27 22 q-27 0 -27 -22 v-8 q0 -4 4 -4Z M136 120 h50 q4 0 4 4 v8 q0 22 -27 22 q-27 0 -27 -22 v-8 q0 -4 4 -4Z"/></clipPath>`, `
.cf{transform-box:fill-box;transform-origin:center;animation:cf 3.2s linear infinite}
@keyframes cf{0%{transform:translateY(-40px) rotate(0);opacity:0}10%{opacity:1}100%{transform:translateY(300px) rotate(540deg);opacity:1}}
.hd{transform-origin:128px 220px;animation:hd 1s ease-in-out infinite}
@keyframes hd{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
.gl{animation:gl 2.6s ease-in-out infinite}
@keyframes gl{0%,40%{transform:translateX(-80px)}100%{transform:translateX(150px)}}
.dc{transform-box:fill-box;transform-origin:center;animation:tw 1.6s ease-in-out infinite}`, () => {
    const conf = [[20, '#FFD23F', 0], [52, '#22D3EE', 1.1], [84, '#fff', 2.3], [176, '#FFD23F', .6], [206, '#3DCB81', 1.8], [236, '#22D3EE', 2.7], [120, '#FF8A3D', 1.5], [150, '#fff', .3]]
      .map(([x, c, d]) => `<g class="cf" ${delay(d)}><rect x="${x}" y="0" width="9" height="5" rx="1.5" fill="${c}" style="transform-box:fill-box;transform-origin:center"/></g>`).join('');
    return `
    ${[[30, 40], [226, 34], [40, 210], [222, 200], [128, 18]].map(([x, y], i) => `<circle class="dc" ${delay(i * 0.3)} cx="${x}" cy="${y}" r="5" fill="#fff" opacity=".7"/>`).join('')}
    ${conf}
    <g class="hd">
      <path d="M58 118 L66 44 L112 84Z" fill="#9CA3AF"/><path d="M198 118 L190 44 L144 84Z" fill="#9CA3AF"/>
      <path d="M70 100 L74 62 L100 86Z" fill="#F9A8D4"/><path d="M186 100 L182 62 L156 86Z" fill="#F9A8D4"/>
      <ellipse cx="128" cy="142" rx="84" ry="74" fill="#9CA3AF"/>
      <ellipse cx="128" cy="170" rx="42" ry="28" fill="#E5E7EB"/>
      <path d="M90 34 L84 4 L106 22 L128 0 L150 22 L172 4 L166 34Z" fill="#FFC531" stroke="#B37A00" stroke-width="4" stroke-linejoin="round"/>
      <circle cx="128" cy="22" r="6" fill="#F2434F"/><circle cx="104" cy="26" r="4" fill="#2E9BFF"/><circle cx="152" cy="26" r="4" fill="#2E9BFF"/>
      <path d="M62 124 H194" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
      <path d="M70 120 h50 q4 0 4 4 v8 q0 22 -27 22 q-27 0 -27 -22 v-8 q0 -4 4 -4Z M136 120 h50 q4 0 4 4 v8 q0 22 -27 22 q-27 0 -27 -22 v-8 q0 -4 4 -4Z" fill="${INK}"/>
      <g clip-path="url(#lens)"><rect class="gl" x="70" y="110" width="22" height="60" fill="#fff" opacity=".45" transform="rotate(25 128 135)"/></g>
      ${nose(166, 9, '#E5536D')}${catMouth(174)}${cheeks(168, 58)}
      <path d="M60 160 H28 M62 172 H32 M196 160 H228 M194 172 H224" stroke="${INK}" stroke-width="4" stroke-linecap="round" opacity=".6"/></g>`;
  }],
];

ANIMATED.forEach(([name, defs, css, head], i) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><title>${name}</title><defs>${defs}</defs>` +
    `<style>${(BASE_CSS + css).replace(/\s*\n\s*/g, '')}</style>` +
    `<rect width="256" height="256" fill="url(#bg)"/>${head().replace(/\s+\n\s*/g, '')}</svg>\n`;
  fs.writeFileSync(path.join(out, `${ANIMALS.length + i + 1}.svg`), svg);
});
console.log(`${ANIMALS.length + ANIMATED.length} аватарок (из них анимированных: ${ANIMATED.length}) → ${out}`);
