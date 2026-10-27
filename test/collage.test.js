import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const dir = new URL('../public/games/collage/', import.meta.url);
const load = (file) => { const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(new URL(file, dir), 'utf8'), ctx); return ctx.window; };

test('«Коллаж»: у каждой обложки есть файл, у каждого пейзажа — название', () => {
  const { COLLAGE_COVERS } = load('covers.js');
  assert.ok(COLLAGE_COVERS.length >= 10, 'после новых игр — node scripts/collage-covers.mjs');
  for (const c of COLLAGE_COVERS) {
    assert.ok(fs.existsSync(new URL(c.file, dir)), c.file);
    assert.ok(c.name, c.file);
  }
  const { COLLAGE_SCENES } = load('scenes.js');
  assert.ok(COLLAGE_SCENES.list.length >= 8);
  COLLAGE_SCENES.list.forEach((s) => assert.ok(s.name, s.kind));
});
