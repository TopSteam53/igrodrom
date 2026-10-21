// Решатель уровней «Совёнка»: для каждого уровня ищет минимальное число касаний (par) и решение,
// проверяет, что уровень устойчив на старте и не решается сам, и что решение повторяется при прогоне с нуля.
// Результат — public/games/sova/solutions.js (его читает игра: звёзды и подсказка).
//
//   node scripts/sova-levels.mjs            — все уровни
//   node scripts/sova-levels.mjs 3 7        — только уровни 3 и 7 (с единицы), файл не переписывается
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'games', 'sova');
export function loadSova() {
  const ctx = { self: {} };
  vm.createContext(ctx);
  for (const f of ['physics.js', 'level.js', 'levels.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  return { Phys: ctx.self.Phys, SL: ctx.self.SovaLevel, LEVELS: ctx.self.SOVA_LEVELS };
}

export function solve(def, { Phys, SL }, maxDepth = 6) {
  const lvl = SL.build(def, Phys);
  // старт: уровень должен стоять сам и не быть пройденным без касаний
  const start = lvl.world.bodies.map((b) => ({ b, x: b.pos.x, y: b.pos.y }));
  const s0 = SL.settle(lvl, 360);
  const drift = Math.max(...start.map((p) => Math.hypot(p.b.pos.x - p.x, p.b.pos.y - p.y)));
  const problems = [];
  if (s0 === 'lost') problems.push('совёнок падает в воду без касаний');
  if (s0 === 'won') problems.push('уровень решается без касаний');
  if (drift > 0.08) problems.push(`на старте блоки сдвигаются на ${drift.toFixed(2)} м`);
  const removable = lvl.blocks.filter((b) => b.removable);
  let frontier = [{ snap: lvl.world.snapshot(), mask: 0, seq: [] }];
  const seen = new Set([0]);
  let par = null, sol = null, wins = 0, losses = 0, states = 0;
  for (let d = 1; d <= maxDepth && par === null; d++) {
    const next = [];
    for (const st of frontier) {
      for (const b of removable) {
        const bit = 1 << b.idx;
        if (st.mask & bit) continue;
        lvl.world.restore(st.snap); lvl.hard = 0;
        SL.removeBlock(lvl, b);
        const r = SL.settle(lvl);
        states++;
        const seq = [...st.seq, b.idx];
        if (r === 'won') { wins++; if (!sol) { sol = seq; par = d; } continue; }
        if (r === 'lost') { losses++; continue; }
        const mask = st.mask | bit;
        if (seen.has(mask)) continue;
        seen.add(mask);
        next.push({ snap: lvl.world.snapshot(), mask, seq });
      }
    }
    frontier = next;
  }
  // Решение должно работать при любом поведении игрока: он может подождать перед первым касанием
  // и нажимать следующий блок как сразу после остановки, так и через фиксированное время.
  // Уровни «на грани», где исход решают доли миллиметра, отсюда не выходят.
  if (sol) {
    outer: for (const pre of [0, 30, 200, 500]) {
      for (const gap of ['settle', 'settle+150', 150, 300]) {
        const again = SL.build(def, Phys);
        SL.settle(again, 360);
        let r = null;
        for (let k = 0; k < pre; k++) SL.step(again, 1 / 120);
        for (const i of sol) {
          SL.removeBlock(again, again.blocks[i]);
          if (typeof gap === 'number') { for (let k = 0; k < gap && r !== 'lost'; k++) { SL.step(again, 1 / 120); if (SL.lost(again)) r = 'lost'; } }
          else { r = SL.settle(again); if (gap === 'settle+150') for (let k = 0; k < 150 && r !== 'lost'; k++) { SL.step(again, 1 / 120); if (SL.lost(again)) r = 'lost'; } }
          if (r === 'lost') break;
        }
        if (r !== 'lost') r = SL.settle(again);
        if (r !== 'won') { problems.push(`решение неустойчиво: пауза ${pre}, касания ${gap} — ${r}`); break outer; }
      }
    }
  } else problems.push('решения нет');
  return { par, sol, wins, losses, states, removable: removable.length, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const S = loadSova();
  const only = process.argv.slice(2).map(Number).filter(Boolean);
  const out = [];
  let bad = 0;
  S.LEVELS.forEach((def, i) => {
    if (only.length && !only.includes(i + 1)) return;
    const t = Date.now();
    let r;
    try { r = solve(def, S); } catch (e) { r = { problems: [e.message] }; }
    out[i] = r;
    if (r.problems.length) bad++;
    console.log(`${String(i + 1).padStart(2)} ${def.name.padEnd(24)} par ${r.par ?? '-'}  решение ${JSON.stringify(r.sol)}  выигрышей ${r.wins ?? 0}, падений ${r.losses ?? 0}, состояний ${r.states ?? 0}, убираемых ${r.removable ?? 0}  ${((Date.now() - t) / 1000).toFixed(1)} с${r.problems.length ? '  !! ' + r.problems.join('; ') : ''}`);
  });
  if (!only.length) {
    const data = out.map((r) => ({ par: r.par, sol: r.sol }));
    fs.writeFileSync(path.join(dir, 'solutions.js'), `// Создано scripts/sova-levels.mjs — не править руками.\nself.SOVA_SOLUTIONS = ${JSON.stringify(data)};\n`);
    console.log(bad ? `\nПроблемных уровней: ${bad}` : '\nВсе уровни проходимы, solutions.js обновлён');
  }
  process.exitCode = bad ? 1 : 0;
}
