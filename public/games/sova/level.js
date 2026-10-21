// Сборка уровня «Совёнка» из текстовой карты и правила победы — общие для игры и для решателя
// (scripts/sova-levels.mjs), поэтому уровень в игре ведёт себя ровно так, как его проверили.
//
// Карта: одна клетка = 0.5 м. Буква — блок (все клетки одной буквы образуют прямоугольник),
// «O» — совёнок (2×2), «=» — остров (его верх — уровень 0), пробел — пусто. Тип блока задаёт
// словарь t: w — дерево, i — лёд, b — ящик с порохом, s — камень, r — скала (неподвижна). По умолчанию дерево.
(function (root) {
  'use strict';
  const CELL = 0.5, HERO = 0.9, WATER = -1.0;
  // Самый сильный толчок, который совёнок выдерживает: скачок скорости за шаг, м/с.
  // Падение примерно с 1.3 м — уже удар. Так высокие башни приходится разбирать по шагам.
  const HARD = 5.2;
  const TYPES = {
    w: { name: 'wood', removable: true, density: 0.7, friction: 0.65 },
    i: { name: 'ice', removable: true, density: 0.9, friction: 0.03 },
    b: { name: 'bomb', removable: true, density: 0.8, friction: 0.6, bomb: true },
    s: { name: 'stone', removable: false, density: 2.4, friction: 0.75 },
    r: { name: 'rock', removable: false, fixed: true, friction: 0.8 },
  };
  const SIZES = new Set(['1x1', '2x1', '3x1', '4x1', '6x1', '8x1', '1x2', '1x3', '1x4', '1x6', '2x2', '4x2']);

  function parse(def) {
    const rows = def.map;
    const g = rows.findIndex((r) => r.includes('='));
    if (g < 0) throw new Error(`${def.name}: нет острова`);
    const width = Math.max(...rows.map((r) => r.length));
    const ox = width / 2;
    const rects = new Map(), order = [];
    rows.forEach((row, ri) => [...row].forEach((ch, ci) => {
      if (ch === ' ' || ch === '=' || ch === '.') return;
      let r = rects.get(ch);
      if (!r) { r = { ch, x0: ci, x1: ci, y0: ri, y1: ri, n: 0 }; rects.set(ch, r); order.push(r); }
      r.x0 = Math.min(r.x0, ci); r.x1 = Math.max(r.x1, ci); r.y0 = Math.min(r.y0, ri); r.y1 = Math.max(r.y1, ri); r.n++;
    }));
    const isl = [...rows[g]].map((c, i) => (c === '=' ? i : -1)).filter((i) => i >= 0);
    const island = { x0: (isl[0] - ox) * CELL, x1: (isl[isl.length - 1] + 1 - ox) * CELL };
    let hero = null;
    const blocks = [], rocks = [];
    for (const r of order) {
      const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
      if (r.n !== w * h) throw new Error(`${def.name}: буква ${r.ch} — не прямоугольник`);
      const box = { x: (r.x0 + w / 2 - ox) * CELL, y: (g - 1 - r.y1) * CELL + (h * CELL) / 2, w: w * CELL, h: h * CELL, cw: w, chh: h };
      if (r.ch === 'O') {
        if (w !== 2 || h !== 2) throw new Error(`${def.name}: совёнок должен занимать 2×2`);
        hero = { x: box.x, y: box.y - box.h / 2 + HERO / 2 + 0.005 };
        continue;
      }
      const type = (def.t && def.t[r.ch]) || 'w';
      if (!TYPES[type]) throw new Error(`${def.name}: неизвестный тип ${type}`);
      const size = `${w}x${h}`;
      if (!SIZES.has(size) || (type === 'b' && size !== '1x1' && size !== '2x2')) throw new Error(`${def.name}: блока ${size} (${type}) нет в наборе спрайтов`);
      (type === 'r' ? rocks : blocks).push({ ...box, type, size, ch: r.ch });
    }
    if (!hero) throw new Error(`${def.name}: нет совёнка`);
    const top = (g + 0) * CELL;
    return { island, hero, blocks, rocks, top, width: width * CELL };
  }

  // Мир уровня. Порядок добавления тел фиксирован — от него зависит детерминизм.
  function build(def, Phys) {
    const L = parse(def);
    Phys.resetIds();
    const world = new Phys.World(-10, 20);
    const ground = world.add(new Phys.Body(L.island.x1 - L.island.x0, 1.6, Infinity, (L.island.x0 + L.island.x1) / 2, -0.8));
    ground.friction = 0.9; ground.kind = 'ground';
    const rocks = L.rocks.map((r) => { const b = world.add(new Phys.Body(r.w, r.h, Infinity, r.x, r.y)); b.friction = TYPES.r.friction; b.kind = 'rock'; b.size = r.size; return b; });
    const blocks = L.blocks.map((d, idx) => {
      const T = TYPES[d.type];
      const b = world.add(new Phys.Body(d.w, d.h, T.density * d.w * d.h, d.x, d.y));
      b.friction = T.friction; b.kind = 'block'; b.type = d.type; b.size = d.size; b.idx = idx; b.removable = T.removable;
      return b;
    });
    const hero = world.add(new Phys.Body(HERO, HERO, 0.8 * HERO * HERO, L.hero.x, L.hero.y));
    hero.friction = 0.8; hero.kind = 'hero';
    return { L, world, ground, rocks, blocks, hero };
  }

  // Убрать блок; у ящика с порохом — взрыв.
  function removeBlock(lvl, b) {
    if (!b.removable || !lvl.world.bodies.includes(b)) return false;
    lvl.world.remove(b);
    if (b.type === 'b') lvl.world.explode(b.pos.x, b.pos.y, 2.2, 5.5);
    return true;
  }

  // Шаг мира с проверкой удара: резкое изменение скорости совёнка (без учёта тяжести).
  function step(lvl, dt) {
    const h = lvl.hero, vx = h.vel.x, vy = h.vel.y;
    lvl.world.step(dt);
    if (!lvl.world.bodies.includes(h)) return;
    const dv = Math.hypot(h.vel.x - vx, h.vel.y - vy - lvl.world.g * dt);
    if (dv > HARD && !lvl.hard) { lvl.hard = dv; }
  }
  const drowned = (lvl) => lvl.hero.pos.y < WATER - 0.1 || Math.abs(lvl.hero.pos.x) > 9;
  const lost = (lvl) => drowned(lvl) || !!lvl.hard;
  function onIsland(lvl) {
    return lvl.world.touching(lvl.hero).some((t) => t.other === lvl.ground && t.up > 0.6);
  }
  // На лапках: наклон не больше ~35°. Совёнок на боку или вверх ногами — не победа.
  const upright = (b) => Math.abs(Math.atan2(Math.sin(b.rot), Math.cos(b.rot))) < 0.6;
  const still = (b) => Math.abs(b.vel.x) < 0.04 && Math.abs(b.vel.y) < 0.04 && Math.abs(b.angVel) < 0.06;
  const settled = (lvl) => lvl.world.bodies.every((b) => b.invMass === 0 || still(b));

  // Прогон до успокоения (для решателя и подсказки): 'lost' | 'won' | 'stuck'.
  function settle(lvl, maxSteps = 900, dt = 1 / 120) {
    for (let i = 0; i < maxSteps; i++) {
      step(lvl, dt);
      if (lost(lvl)) return 'lost';
      if (i > 20 && i % 10 === 0 && settled(lvl)) break;
    }
    if (lost(lvl)) return 'lost';
    if (still(lvl.hero) && !upright(lvl.hero)) return 'lost';
    return onIsland(lvl) && still(lvl.hero) ? 'won' : 'stuck';
  }

  const api = { CELL, HERO, WATER, HARD, TYPES, parse, build, removeBlock, step, drowned, lost, onIsland, upright, still, settled, settle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SovaLevel = api;
})(typeof self !== 'undefined' ? self : this);
