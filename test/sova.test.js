// «Совёнок»: каждый уровень разбирается, решение из solutions.js проходит его, а solutions.js не устарел.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'games', 'sova');
const ctx = { self: {} };
vm.createContext(ctx);
for (const f of ['physics.js', 'level.js', 'levels.js', 'solutions.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
const { Phys, SovaLevel: SL, SOVA_LEVELS: LEVELS, SOVA_SOLUTIONS: SOL } = ctx.self;

test('у каждого уровня есть решение, и оно проходит уровень', () => {
  assert.equal(SOL.length, LEVELS.length, 'solutions.js устарел: запустите node scripts/sova-levels.mjs');
  LEVELS.forEach((def, i) => {
    const s = SOL[i];
    assert.ok(s && s.par >= 1 && s.sol.length === s.par, `${i + 1} ${def.name}: нет решения`);
    const lvl = SL.build(def, Phys);
    assert.equal(SL.settle(lvl, 360), 'stuck', `${i + 1} ${def.name}: уровень не устойчив на старте`);
    let r;
    for (const idx of s.sol) { assert.ok(SL.removeBlock(lvl, lvl.blocks[idx]), `${i + 1}: блок ${idx} не убирается`); r = SL.settle(lvl); }
    assert.equal(r, 'won', `${i + 1} ${def.name}: решение не проходит (${r})`);
  });
});

test('спрайт есть для каждого блока', () => {
  const files = new Set(fs.readdirSync(path.join(dir, 'img')));
  const names = { w: 'wood', i: 'ice', b: 'bomb', s: 'stone', r: 'rock' };
  for (const def of LEVELS) {
    const L = SL.parse(def);
    for (const b of [...L.blocks, ...L.rocks]) assert.ok(files.has(`${names[b.type]}_${b.size}.webp`), `${def.name}: нет ${names[b.type]}_${b.size}.webp`);
  }
});
