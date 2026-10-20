import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../scripts/build-catalog.js';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'games', 'catalog.json');

test('games/catalog.json совпадает с meta.json игр (иначе: npm run build:catalog)', () => {
  assert.equal(fs.readFileSync(file, 'utf8'), buildCatalog());
});
