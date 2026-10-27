// Плоские картинки для «Бусинок», нарисованы для игры (128×128, крупные формы — их видно и в сетке 16–30 бусин).
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${body}</svg>`;

export const SCENES = {
  strawberry: svg(`<rect width="128" height="128" fill="#ffb3c6"/>
<path d="M64 112C34 96 22 70 26 52c3-14 18-20 38-14 20-6 35 0 38 14 4 18-8 44-38 60z" fill="#e63946"/>
<g fill="#ffe066"><ellipse cx="46" cy="58" rx="3" ry="4"/><ellipse cx="64" cy="54" rx="3" ry="4"/><ellipse cx="82" cy="58" rx="3" ry="4"/><ellipse cx="54" cy="74" rx="3" ry="4"/><ellipse cx="74" cy="74" rx="3" ry="4"/><ellipse cx="40" cy="74" rx="3" ry="4"/><ellipse cx="88" cy="74" rx="3" ry="4"/><ellipse cx="64" cy="90" rx="3" ry="4"/><ellipse cx="50" cy="90" rx="3" ry="4"/><ellipse cx="78" cy="90" rx="3" ry="4"/></g>
<path d="M64 42 40 30l14-2-8-12 18 10 18-10-8 12 14 2z" fill="#2ea043"/><rect x="61" y="12" width="6" height="18" rx="3" fill="#1b6b3a"/>`),

  watermelon: svg(`<rect width="128" height="128" fill="#8fd3ff"/>
<path d="M10 44h108a54 54 0 0 1-108 0z" fill="#2ea043"/><path d="M18 44h92a46 46 0 0 1-92 0z" fill="#f4e4c1"/><path d="M24 44h80a40 40 0 0 1-80 0z" fill="#e63946"/>
<g fill="#1c2140"><ellipse cx="44" cy="56" rx="3" ry="5"/><ellipse cx="64" cy="62" rx="3" ry="5"/><ellipse cx="84" cy="56" rx="3" ry="5"/><ellipse cx="54" cy="74" rx="3" ry="5"/><ellipse cx="74" cy="74" rx="3" ry="5"/></g>`),

  icecream: svg(`<rect width="128" height="128" fill="#7ee081"/>
<path d="M38 62h52L64 122z" fill="#c68b59"/><path d="M44 70l30 30M56 66l24 24M40 82l14-14M48 94l26-26M58 106l20-20" stroke="#8b5a2b" stroke-width="4"/>
<circle cx="64" cy="48" r="28" fill="#ffb3c6"/><path d="M36 54c6 10 12 4 16 12 4-8 10-2 14 6 4-8 10-2 14-8 4 6 8 2 10-4z" fill="#ffffff"/>
<circle cx="64" cy="18" r="8" fill="#e63946"/><path d="M64 12q4-8 12-10" stroke="#1b6b3a" stroke-width="3" fill="none"/>`),

  house: svg(`<rect width="128" height="128" fill="#8fd3ff"/><circle cx="104" cy="22" r="12" fill="#ffc531"/>
<rect y="98" width="128" height="30" fill="#2ea043"/><rect x="30" y="58" width="68" height="46" fill="#f4e4c1"/>
<path d="M22 60 64 26l42 34z" fill="#e63946"/><rect x="56" y="76" width="16" height="28" fill="#8b5a2b"/><rect x="36" y="68" width="14" height="14" fill="#ffe066"/><rect x="78" y="68" width="14" height="14" fill="#ffe066"/>
<path d="M14 24h22a7 7 0 0 0-6-10 9 9 0 0 0-16 4 6 6 0 0 0 0 6z" fill="#ffffff"/>`),

  boat: svg(`<rect width="128" height="128" fill="#ffe066"/><circle cx="96" cy="30" r="14" fill="#ff9f1a"/>
<rect y="88" width="128" height="40" fill="#3d8bff"/><path d="M0 92q8-8 16 0t16 0 16 0 16 0 16 0 16 0 16 0 16 0v8H0z" fill="#8fd3ff"/>
<path d="M24 78h80l-12 18H36z" fill="#e63946"/><rect x="62" y="20" width="4" height="58" fill="#8b5a2b"/><path d="M66 24v48h30z" fill="#ffffff"/><path d="M62 30v42H38z" fill="#ffffff"/>`),

  rainbow: svg(`<rect width="128" height="128" fill="#c9b8ff"/>
<g fill="none" stroke-width="10"><path d="M14 100a50 50 0 0 1 100 0" stroke="#e63946"/><path d="M24 100a40 40 0 0 1 80 0" stroke="#ff9f1a"/><path d="M34 100a30 30 0 0 1 60 0" stroke="#ffe066"/><path d="M44 100a20 20 0 0 1 40 0" stroke="#2ea043"/><path d="M54 100a10 10 0 0 1 20 0" stroke="#3d8bff"/></g>
<path d="M2 108h32a10 10 0 0 0-8-16 12 12 0 0 0-22 4 8 8 0 0 0-2 12z" fill="#ffffff"/><path d="M94 108h32a10 10 0 0 0-8-16 12 12 0 0 0-22 4 8 8 0 0 0-2 12z" fill="#ffffff"/>`),

  tree: svg(`<rect width="128" height="128" fill="#1f4fbf"/><rect y="106" width="128" height="22" fill="#ffffff"/>
<rect x="56" y="94" width="16" height="16" fill="#8b5a2b"/><path d="M64 24 30 70h68z" fill="#2ea043"/><path d="M64 44 22 98h84z" fill="#2ea043"/><path d="M64 24 40 58h48z" fill="#1b6b3a"/>
<path d="M64 6l4 9 10 1-8 6 3 10-9-5-9 5 3-10-8-6 10-1z" fill="#ffc531"/>
<g fill="#e63946"><circle cx="50" cy="70" r="5"/><circle cx="80" cy="84" r="5"/><circle cx="60" cy="90" r="5"/></g><g fill="#ffe066"><circle cx="74" cy="60" r="4"/><circle cx="42" cy="88" r="4"/></g>
<g fill="#ffffff"><circle cx="16" cy="20" r="3"/><circle cx="106" cy="36" r="3"/><circle cx="20" cy="64" r="3"/><circle cx="110" cy="76" r="3"/></g>`),

  mushroom: svg(`<rect width="128" height="128" fill="#7ee081"/><rect y="104" width="128" height="24" fill="#2ea043"/>
<path d="M50 66h28l4 44H46z" fill="#f4e4c1"/><path d="M14 70a50 46 0 0 1 100 0z" fill="#e63946"/>
<g fill="#ffffff"><circle cx="40" cy="48" r="7"/><circle cx="66" cy="36" r="8"/><circle cx="90" cy="52" r="6"/><circle cx="58" cy="60" r="5"/><circle cx="26" cy="64" r="4"/><circle cx="102" cy="66" r="4"/></g>`),

  fish: svg(`<rect width="128" height="128" fill="#3d8bff"/>
<path d="M92 64 120 40v48z" fill="#ff9f1a"/><ellipse cx="60" cy="64" rx="42" ry="30" fill="#ff9f1a"/>
<path d="M54 36q-10 28 0 56" stroke="#ffffff" stroke-width="9" fill="none"/><path d="M78 40q-8 24 0 48" stroke="#ffffff" stroke-width="8" fill="none"/>
<circle cx="36" cy="58" r="7" fill="#ffffff"/><circle cx="35" cy="58" r="4" fill="#1c2140"/>
<g fill="#8fd3ff"><circle cx="18" cy="28" r="6"/><circle cx="30" cy="14" r="4"/><circle cx="100" cy="104" r="5"/></g>`),

  butterfly: svg(`<rect width="128" height="128" fill="#ffe066"/>
<path d="M64 60C40 20 10 22 14 50c3 18 26 20 50 14z" fill="#a55eea"/><path d="M64 60C88 20 118 22 114 50c-3 18-26 20-50 14z" fill="#a55eea"/>
<path d="M64 66C40 70 26 90 38 104c10 10 22 0 26-30z" fill="#ff6bcb"/><path d="M64 66C88 70 102 90 90 104c-10 10-22 0-26-30z" fill="#ff6bcb"/>
<g fill="#ffffff"><circle cx="34" cy="44" r="7"/><circle cx="94" cy="44" r="7"/></g>
<rect x="60" y="40" width="8" height="58" rx="4" fill="#1c2140"/><path d="M62 42 50 22M66 42l12-20" stroke="#1c2140" stroke-width="3"/>`),

  flower: svg(`<rect width="128" height="128" fill="#8fd3ff"/><rect y="110" width="128" height="18" fill="#2ea043"/>
<rect x="60" y="62" width="8" height="52" fill="#2ea043"/><path d="M64 96c-14-16-32-12-34-4 12 6 24 8 34 4zM64 86c14-16 32-12 34-4-12 6-24 8-34 4z" fill="#1b6b3a"/>
<g fill="#ff6bcb"><circle cx="64" cy="22" r="16"/><circle cx="64" cy="62" r="16"/><circle cx="44" cy="42" r="16"/><circle cx="84" cy="42" r="16"/><circle cx="50" cy="28" r="14"/><circle cx="78" cy="28" r="14"/><circle cx="50" cy="56" r="14"/><circle cx="78" cy="56" r="14"/></g>
<circle cx="64" cy="42" r="13" fill="#ffc531"/>`),

  cupcake: svg(`<rect width="128" height="128" fill="#c9b8ff"/>
<path d="M30 70h68l-10 46H40z" fill="#8b5a2b"/><path d="M44 72l4 44M58 72v44M70 72v44M84 72l-4 44" stroke="#c68b59" stroke-width="5"/>
<path d="M24 74c-6-18 10-24 16-22 0-16 20-22 28-14 10-8 30-2 26 14 10-2 18 8 10 22z" fill="#ffb3c6"/>
<circle cx="64" cy="26" r="9" fill="#e63946"/>
<g stroke-width="4" stroke-linecap="round"><path d="M42 58l5-3" stroke="#3d8bff"/><path d="M60 50l5 2" stroke="#ffe066"/><path d="M80 60l4-4" stroke="#2ec4b6"/><path d="M52 66l5 1" stroke="#a55eea"/><path d="M74 46l3 4" stroke="#3d8bff"/></g>`),

  rocket: svg(`<rect width="128" height="128" fill="#1c2140"/>
<g fill="#ffe066"><circle cx="20" cy="22" r="3"/><circle cx="104" cy="16" r="3"/><circle cx="16" cy="90" r="3"/><circle cx="110" cy="70" r="3"/><circle cx="96" cy="110" r="3"/></g>
<path d="M54 96h20l-10 26z" fill="#ff9f1a"/><path d="M58 96h12l-6 16z" fill="#ffe066"/>
<path d="M48 80 30 100l2-26 16-10zM80 80l18 20-2-26-16-10z" fill="#e63946"/>
<path d="M64 8c18 18 20 50 16 88H48C44 58 46 26 64 8z" fill="#ffffff"/><path d="M64 8c8 8 12 16 14 26H50c2-10 6-18 14-26z" fill="#e63946"/>
<circle cx="64" cy="54" r="10" fill="#3d8bff"/><circle cx="64" cy="54" r="10" fill="none" stroke="#9aa5b1" stroke-width="4"/>`),

  sunset: svg(`<rect width="128" height="128" fill="#ff6b35"/><rect width="128" height="30" fill="#c2185b"/><rect y="30" width="128" height="24" fill="#e63946"/>
<circle cx="64" cy="80" r="26" fill="#ffe066"/><rect y="80" width="128" height="48" fill="#1f4fbf"/>
<g fill="#ffc531"><rect x="44" y="88" width="40" height="4"/><rect x="50" y="98" width="28" height="4"/><rect x="56" y="108" width="16" height="4"/></g>
<path d="M20 30q6-6 12 0 6-6 12 0" stroke="#1c2140" stroke-width="3" fill="none"/><path d="M92 18q5-5 10 0 5-5 10 0" stroke="#1c2140" stroke-width="3" fill="none"/>`),

  apple: svg(`<rect width="128" height="128" fill="#f4e4c1"/>
<path d="M64 38c-26-14-50 4-44 36 4 26 22 46 44 40 22 6 40-14 44-40 6-32-18-50-44-36z" fill="#2ea043"/>
<path d="M36 52c-6 6-8 16-6 24" stroke="#7ee081" stroke-width="6" fill="none" stroke-linecap="round"/>
<rect x="61" y="14" width="6" height="26" rx="3" fill="#8b5a2b"/><path d="M68 28c8-14 24-14 30-8-8 10-22 12-30 8z" fill="#7ee081"/>`),

  cherry: svg(`<rect width="128" height="128" fill="#ffffff"/>
<path d="M44 84Q50 44 76 16M86 88Q80 50 76 16" stroke="#1b6b3a" stroke-width="5" fill="none"/><path d="M76 18c10-10 30-8 34 0-10 10-26 10-34 0z" fill="#2ea043"/>
<circle cx="42" cy="92" r="22" fill="#a8152a"/><circle cx="88" cy="96" r="22" fill="#e63946"/><circle cx="34" cy="84" r="5" fill="#ffb3c6"/><circle cx="80" cy="88" r="5" fill="#ffb3c6"/>`),

  snowman: svg(`<rect width="128" height="128" fill="#8fd3ff"/><rect y="108" width="128" height="20" fill="#ffffff"/>
<circle cx="64" cy="92" r="26" fill="#ffffff"/><circle cx="64" cy="50" r="20" fill="#ffffff"/>
<rect x="44" y="20" width="40" height="8" fill="#1c2140"/><rect x="50" y="2" width="28" height="22" fill="#1c2140"/><rect x="50" y="18" width="28" height="4" fill="#e63946"/>
<path d="M64 52l18 4-18 4z" fill="#ff9f1a"/><circle cx="57" cy="44" r="3" fill="#1c2140"/><circle cx="71" cy="44" r="3" fill="#1c2140"/>
<rect x="40" y="64" width="48" height="8" fill="#e63946"/><rect x="72" y="64" width="8" height="22" fill="#e63946"/>
<g fill="#1c2140"><circle cx="64" cy="84" r="3"/><circle cx="64" cy="98" r="3"/></g><path d="M40 88 14 70M88 88l26-18" stroke="#8b5a2b" stroke-width="4"/>`),
};
