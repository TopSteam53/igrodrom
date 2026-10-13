// Собирает public/sdk.js — Игродром SDK (sdk/v1.js) и совместимость с Яндекс Игры SDK (sdk/yandex.js)
// одним скриптом. По адресу /sdk.js его ищут игры с Яндекс Игр; при загрузке архива сервер
// направляет туда и ссылки на https://yandex.ru/games/sdk/v2.
// Запуск: npm run build:sdk
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const SDK_BUNDLE = path.join(pub, 'sdk.js');

export function buildSdk() {
  const part = (f) => fs.readFileSync(path.join(pub, 'sdk', f), 'utf8').trimEnd();
  return `// Собрано из public/sdk/v1.js и public/sdk/yandex.js командой npm run build:sdk. Не редактируйте вручную.\n${part('v1.js')}\n\n${part('yandex.js')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(SDK_BUNDLE, buildSdk());
  console.log(`Записан ${path.relative(process.cwd(), SDK_BUNDLE)}`);
}
