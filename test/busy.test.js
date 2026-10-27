import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { solvable } from '../scripts/busy-art/solver.mjs';
import { PICTURES } from '../scripts/busy-art/list.mjs';

const src = fs.readFileSync(new URL('../public/games/busy/pictures.js', import.meta.url), 'utf8');
const pics = JSON.parse(src.slice(src.indexOf('= [') + 2, src.lastIndexOf(']') + 1));

test('«Бусинки»: картины собраны из списка и в правильном формате', () => {
  assert.equal(pics.length, PICTURES.length, 'после правки scripts/busy-art — node scripts/busy-pictures.mjs');
  pics.forEach((p, i) => {
    assert.equal(p.name, PICTURES[i].name);
    assert.equal(p.px.length, p.w * p.h, p.name);
    assert.match(p.px, /^[a-g.]+$/, p.name);
    const used = new Set(p.px.replace(/\./g, ''));
    assert.equal(used.size, p.pal.length, `${p.name}: каждый цвет палитры есть на картине`);
    assert.ok(p.cap >= p.cap2 && p.cap2 >= 15 && p.cap % 5 === 0, p.name);
  });
});

test('«Бусинки»: с выданным лотком картина проходима (первые 12 и второй круг первых 4)', () => {
  pics.slice(0, 12).forEach((p) => assert.ok(solvable(p, p.cap), `${p.name}: лоток ${p.cap}`));
  pics.slice(0, 4).forEach((p) => assert.ok(solvable(p, p.cap2), `${p.name}: второй круг, лоток ${p.cap2}`));
});
