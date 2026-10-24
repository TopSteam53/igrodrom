// Готовые аватарки: плоские звери в SVG (public/avatars/<n>.svg).
// 1–16 — бесплатные, 17–24 — открываются за монетки в «Витрине» (server/shop.js).
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
console.log(`${ANIMALS.length} аватарок → ${out}`);
