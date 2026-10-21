// Физика прямоугольников для «Совёнка»: порт Box2D-Lite (Erin Catto, MIT).
// Последовательные импульсы с тёплым стартом и накоплением, контакты коробка–коробка через отсечение рёбер.
// Детерминирована: одинаковые действия дают одинаковый результат — на этом держится проверка уровней.
(function (root) {
  'use strict';
  const NO_EDGE = 0, EDGE1 = 1, EDGE2 = 2, EDGE3 = 3, EDGE4 = 4;

  // ---------- вектора и матрицы поворота ----------
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const crossVV = (a, b) => a.x * b.y - a.y * b.x;
  const crossVS = (v, s) => ({ x: s * v.y, y: -s * v.x });
  const crossSV = (s, v) => ({ x: -s * v.y, y: s * v.x });
  const rot = (a) => { const c = Math.cos(a), s = Math.sin(a); return { c1: { x: c, y: s }, c2: { x: -s, y: c } }; };
  const mulMV = (m, v) => ({ x: m.c1.x * v.x + m.c2.x * v.y, y: m.c1.y * v.x + m.c2.y * v.y });
  const transpose = (m) => ({ c1: { x: m.c1.x, y: m.c2.x }, c2: { x: m.c1.y, y: m.c2.y } });
  const mulMM = (a, b) => ({ c1: mulMV(a, b.c1), c2: mulMV(a, b.c2) });
  const absM = (m) => ({ c1: { x: Math.abs(m.c1.x), y: Math.abs(m.c1.y) }, c2: { x: Math.abs(m.c2.x), y: Math.abs(m.c2.y) } });
  const neg = (v) => ({ x: -v.x, y: -v.y });

  let nextId = 1;
  class Body {
    constructor(w, h, mass, x = 0, y = 0, angle = 0) {
      this.id = nextId++;
      this.w = w; this.h = h;
      this.pos = { x, y }; this.rot = angle;
      this.vel = { x: 0, y: 0 }; this.angVel = 0;
      this.friction = 0.6;
      this.setMass(mass);
    }
    setMass(mass) {
      this.mass = mass;
      if (mass < Infinity) {
        this.invMass = 1 / mass;
        this.I = mass * (this.w * this.w + this.h * this.h) / 12;
        this.invI = 1 / this.I;
      } else { this.invMass = 0; this.I = Infinity; this.invI = 0; }
    }
    // Углы прямоугольника в мировых координатах (против часовой стрелки).
    corners() {
      const m = rot(this.rot), hx = this.w / 2, hy = this.h / 2;
      return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => { const p = mulMV(m, { x, y }); return { x: p.x + this.pos.x, y: p.y + this.pos.y }; });
    }
    contains(px, py) {
      const m = rot(-this.rot), p = mulMV(m, { x: px - this.pos.x, y: py - this.pos.y });
      return Math.abs(p.x) <= this.w / 2 && Math.abs(p.y) <= this.h / 2;
    }
  }

  // ---------- столкновение коробок ----------
  const featKey = (f) => f.in1 | (f.out1 << 4) | (f.in2 << 8) | (f.out2 << 12);
  const flip = (f) => ({ in1: f.in2, out1: f.out2, in2: f.in1, out2: f.out1 });

  function clipSegmentToLine(vIn, normal, offset, clipEdge) {
    const out = [];
    const d0 = dot(normal, vIn[0].v) - offset, d1 = dot(normal, vIn[1].v) - offset;
    if (d0 <= 0) out.push(vIn[0]);
    if (d1 <= 0) out.push(vIn[1]);
    if (d0 * d1 < 0) {
      const t = d0 / (d0 - d1);
      const v = { x: vIn[0].v.x + t * (vIn[1].v.x - vIn[0].v.x), y: vIn[0].v.y + t * (vIn[1].v.y - vIn[0].v.y) };
      let fp;
      if (d0 > 0) { fp = { ...vIn[0].fp, in1: clipEdge, in2: NO_EDGE }; } else { fp = { ...vIn[1].fp, out1: clipEdge, out2: NO_EDGE }; }
      out.push({ v, fp });
    }
    return out;
  }

  function incidentEdge(h, pos, R, normal) {
    const n = neg(mulMV(transpose(R), normal));
    const ax = Math.abs(n.x), ay = Math.abs(n.y);
    let c;
    const fp = (in2, out2) => ({ in1: NO_EDGE, out1: NO_EDGE, in2, out2 });
    if (ax > ay) {
      if (n.x > 0) c = [{ v: { x: h.x, y: -h.y }, fp: fp(EDGE3, EDGE4) }, { v: { x: h.x, y: h.y }, fp: fp(EDGE4, EDGE1) }];
      else c = [{ v: { x: -h.x, y: h.y }, fp: fp(EDGE1, EDGE2) }, { v: { x: -h.x, y: -h.y }, fp: fp(EDGE2, EDGE3) }];
    } else if (n.y > 0) c = [{ v: { x: h.x, y: h.y }, fp: fp(EDGE4, EDGE1) }, { v: { x: -h.x, y: h.y }, fp: fp(EDGE1, EDGE2) }];
    else c = [{ v: { x: -h.x, y: -h.y }, fp: fp(EDGE2, EDGE3) }, { v: { x: h.x, y: -h.y }, fp: fp(EDGE3, EDGE4) }];
    for (const e of c) { const p = mulMV(R, e.v); e.v = { x: p.x + pos.x, y: p.y + pos.y }; }
    return c;
  }

  function collide(A, B) {
    const hA = { x: A.w / 2, y: A.h / 2 }, hB = { x: B.w / 2, y: B.h / 2 };
    const RA = rot(A.rot), RB = rot(B.rot), RAT = transpose(RA), RBT = transpose(RB);
    const dp = { x: B.pos.x - A.pos.x, y: B.pos.y - A.pos.y };
    const dA = mulMV(RAT, dp), dB = mulMV(RBT, dp);
    const C = mulMM(RAT, RB), absC = absM(C), absCT = transpose(absC);
    const ahB = mulMV(absC, hB), ahA = mulMV(absCT, hA);
    const faceA = { x: Math.abs(dA.x) - hA.x - ahB.x, y: Math.abs(dA.y) - hA.y - ahB.y };
    if (faceA.x > 0 || faceA.y > 0) return [];
    const faceB = { x: Math.abs(dB.x) - ahA.x - hB.x, y: Math.abs(dB.y) - ahA.y - hB.y };
    if (faceB.x > 0 || faceB.y > 0) return [];

    const relTol = 0.95, absTol = 0.01;
    let axis = 0, sep = faceA.x, normal = dA.x > 0 ? RA.c1 : neg(RA.c1);
    if (faceA.y > relTol * sep + absTol * hA.y) { axis = 1; sep = faceA.y; normal = dA.y > 0 ? RA.c2 : neg(RA.c2); }
    if (faceB.x > relTol * sep + absTol * hB.x) { axis = 2; sep = faceB.x; normal = dB.x > 0 ? RB.c1 : neg(RB.c1); }
    if (faceB.y > relTol * sep + absTol * hB.y) { axis = 3; sep = faceB.y; normal = dB.y > 0 ? RB.c2 : neg(RB.c2); }

    let frontN, sideN, front, negSide, posSide, negEdge, posEdge, inc;
    if (axis === 0) {
      frontN = normal; front = dot(A.pos, frontN) + hA.x; sideN = RA.c2; const side = dot(A.pos, sideN);
      negSide = -side + hA.y; posSide = side + hA.y; negEdge = EDGE3; posEdge = EDGE1; inc = incidentEdge(hB, B.pos, RB, frontN);
    } else if (axis === 1) {
      frontN = normal; front = dot(A.pos, frontN) + hA.y; sideN = RA.c1; const side = dot(A.pos, sideN);
      negSide = -side + hA.x; posSide = side + hA.x; negEdge = EDGE2; posEdge = EDGE4; inc = incidentEdge(hB, B.pos, RB, frontN);
    } else if (axis === 2) {
      frontN = neg(normal); front = dot(B.pos, frontN) + hB.x; sideN = RB.c2; const side = dot(B.pos, sideN);
      negSide = -side + hB.y; posSide = side + hB.y; negEdge = EDGE3; posEdge = EDGE1; inc = incidentEdge(hA, A.pos, RA, frontN);
    } else {
      frontN = neg(normal); front = dot(B.pos, frontN) + hB.y; sideN = RB.c1; const side = dot(B.pos, sideN);
      negSide = -side + hB.x; posSide = side + hB.x; negEdge = EDGE2; posEdge = EDGE4; inc = incidentEdge(hA, A.pos, RA, frontN);
    }
    const c1 = clipSegmentToLine(inc, neg(sideN), negSide, negEdge);
    if (c1.length < 2) return [];
    const c2 = clipSegmentToLine(c1, sideN, posSide, posEdge);
    if (c2.length < 2) return [];
    const contacts = [];
    for (const cp of c2) {
      const s = dot(frontN, cp.v) - front;
      if (s <= 0) {
        contacts.push({
          sep: s, normal, pos: { x: cp.v.x - s * frontN.x, y: cp.v.y - s * frontN.y },
          feature: featKey(axis >= 2 ? flip(cp.fp) : cp.fp), Pn: 0, Pt: 0,
        });
      }
    }
    return contacts;
  }

  // ---------- арбитр пары тел ----------
  class Arbiter {
    constructor(a, b) {
      if (a.id < b.id) { this.b1 = a; this.b2 = b; } else { this.b1 = b; this.b2 = a; }
      this.contacts = collide(this.b1, this.b2);
      this.friction = Math.sqrt(this.b1.friction * this.b2.friction);
    }
    update(fresh) {
      const merged = fresh.map((cNew) => {
        const old = this.contacts.find((c) => c.feature === cNew.feature);
        if (old) { cNew.Pn = old.Pn; cNew.Pt = old.Pt; }
        return cNew;
      });
      this.contacts = merged;
    }
    preStep(invDt) {
      const b1 = this.b1, b2 = this.b2;
      for (const c of this.contacts) {
        const r1 = { x: c.pos.x - b1.pos.x, y: c.pos.y - b1.pos.y }, r2 = { x: c.pos.x - b2.pos.x, y: c.pos.y - b2.pos.y };
        const rn1 = dot(r1, c.normal), rn2 = dot(r2, c.normal);
        let kN = b1.invMass + b2.invMass + b1.invI * (dot(r1, r1) - rn1 * rn1) + b2.invI * (dot(r2, r2) - rn2 * rn2);
        c.massNormal = 1 / kN;
        const t = crossVS(c.normal, 1);
        const rt1 = dot(r1, t), rt2 = dot(r2, t);
        let kT = b1.invMass + b2.invMass + b1.invI * (dot(r1, r1) - rt1 * rt1) + b2.invI * (dot(r2, r2) - rt2 * rt2);
        c.massTangent = 1 / kT;
        c.bias = -0.2 * invDt * Math.min(0, c.sep + 0.01);
        // тёплый старт: прикладываем накопленный в прошлом шаге импульс
        const P = { x: c.Pn * c.normal.x + c.Pt * t.x, y: c.Pn * c.normal.y + c.Pt * t.y };
        b1.vel.x -= b1.invMass * P.x; b1.vel.y -= b1.invMass * P.y; b1.angVel -= b1.invI * crossVV(r1, P);
        b2.vel.x += b2.invMass * P.x; b2.vel.y += b2.invMass * P.y; b2.angVel += b2.invI * crossVV(r2, P);
        c.r1 = r1; c.r2 = r2;
      }
    }
    applyImpulse() {
      const b1 = this.b1, b2 = this.b2;
      for (const c of this.contacts) {
        const r1 = c.r1, r2 = c.r2;
        let w2 = crossSV(b2.angVel, r2), w1 = crossSV(b1.angVel, r1);
        let dv = { x: b2.vel.x + w2.x - b1.vel.x - w1.x, y: b2.vel.y + w2.y - b1.vel.y - w1.y };
        const vn = dot(dv, c.normal);
        let dPn = c.massNormal * (-vn + c.bias);
        const Pn0 = c.Pn; c.Pn = Math.max(Pn0 + dPn, 0); dPn = c.Pn - Pn0;
        const Pn = { x: dPn * c.normal.x, y: dPn * c.normal.y };
        b1.vel.x -= b1.invMass * Pn.x; b1.vel.y -= b1.invMass * Pn.y; b1.angVel -= b1.invI * crossVV(r1, Pn);
        b2.vel.x += b2.invMass * Pn.x; b2.vel.y += b2.invMass * Pn.y; b2.angVel += b2.invI * crossVV(r2, Pn);

        w2 = crossSV(b2.angVel, r2); w1 = crossSV(b1.angVel, r1);
        dv = { x: b2.vel.x + w2.x - b1.vel.x - w1.x, y: b2.vel.y + w2.y - b1.vel.y - w1.y };
        const t = crossVS(c.normal, 1);
        const vt = dot(dv, t);
        let dPt = c.massTangent * (-vt);
        const maxPt = this.friction * c.Pn, Pt0 = c.Pt;
        c.Pt = Math.max(-maxPt, Math.min(maxPt, Pt0 + dPt)); dPt = c.Pt - Pt0;
        const Pt = { x: dPt * t.x, y: dPt * t.y };
        b1.vel.x -= b1.invMass * Pt.x; b1.vel.y -= b1.invMass * Pt.y; b1.angVel -= b1.invI * crossVV(r1, Pt);
        b2.vel.x += b2.invMass * Pt.x; b2.vel.y += b2.invMass * Pt.y; b2.angVel += b2.invI * crossVV(r2, Pt);
        c.lastImpulse = Math.max(c.lastImpulse || 0, dPn);
      }
    }
  }

  // ---------- мир ----------
  class World {
    constructor(gravity = -10, iterations = 20) {
      this.g = gravity; this.iterations = iterations;
      this.bodies = []; this.arbiters = new Map();
    }
    add(b) { this.bodies.push(b); return b; }
    remove(b) {
      this.bodies = this.bodies.filter((x) => x !== b);
      for (const [k, a] of this.arbiters) if (a.b1 === b || a.b2 === b) this.arbiters.delete(k);
    }
    // Радиус описанной окружности — быстрый отсев далёких пар.
    broadPhase() {
      const bs = this.bodies;
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i], ra = Math.hypot(a.w, a.h) / 2;
        for (let j = i + 1; j < bs.length; j++) {
          const b = bs[j];
          if (a.invMass === 0 && b.invMass === 0) continue;
          const key = a.id < b.id ? a.id * 65536 + b.id : b.id * 65536 + a.id;
          const rb = Math.hypot(b.w, b.h) / 2, dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y;
          if (dx * dx + dy * dy > (ra + rb) * (ra + rb)) { this.arbiters.delete(key); continue; }
          const arb = new Arbiter(a, b);
          if (arb.contacts.length) {
            const old = this.arbiters.get(key);
            if (old) old.update(arb.contacts); else this.arbiters.set(key, arb);
          } else this.arbiters.delete(key);
        }
      }
    }
    step(dt) {
      const invDt = dt > 0 ? 1 / dt : 0;
      this.broadPhase();
      for (const b of this.bodies) {
        if (b.invMass === 0) continue;
        b.vel.y += dt * this.g;
        // лёгкое сопротивление воздуха гасит бесконечное покачивание
        b.vel.x *= 0.9995; b.vel.y *= 0.9995; b.angVel *= 0.998;
      }
      for (const a of this.arbiters.values()) { for (const c of a.contacts) c.lastImpulse = 0; a.preStep(invDt); }
      for (let i = 0; i < this.iterations; i++) for (const a of this.arbiters.values()) a.applyImpulse();
      for (const b of this.bodies) {
        if (b.invMass === 0) continue;
        b.pos.x += dt * b.vel.x; b.pos.y += dt * b.vel.y; b.rot += dt * b.angVel;
      }
    }
    // Тела, касающиеся данного: [{ other, impulse }] — для победы «совёнок стоит на острове» и мягкости посадки.
    touching(b) {
      const out = [];
      for (const a of this.arbiters.values()) {
        if (a.b1 !== b && a.b2 !== b) continue;
        const other = a.b1 === b ? a.b2 : a.b1;
        let imp = 0, normalY = 0;
        for (const c of a.contacts) { imp += c.Pn; normalY += a.b1 === b ? -c.normal.y : c.normal.y; }
        if (a.contacts.length) out.push({ other, impulse: imp, up: normalY / a.contacts.length });
      }
      return out;
    }
    // Точный снимок состояния (вместе с накопленными импульсами контактов) и откат к нему — для перебора в решателе.
    snapshot() {
      return {
        bodies: this.bodies.slice(),
        state: this.bodies.map((b) => [b.pos.x, b.pos.y, b.rot, b.vel.x, b.vel.y, b.angVel]),
        arbiters: [...this.arbiters].map(([k, a]) => [k, a.b1, a.b2, a.friction, a.contacts.map((c) => ({ ...c }))]),
      };
    }
    restore(s) {
      this.bodies = s.bodies.slice();
      s.bodies.forEach((b, i) => { const v = s.state[i]; b.pos.x = v[0]; b.pos.y = v[1]; b.rot = v[2]; b.vel.x = v[3]; b.vel.y = v[4]; b.angVel = v[5]; });
      this.arbiters = new Map(s.arbiters.map(([k, b1, b2, f, cs]) => {
        const a = Object.create(Arbiter.prototype);
        a.b1 = b1; a.b2 = b2; a.friction = f; a.contacts = cs.map((c) => ({ ...c }));
        return [k, a];
      }));
    }
    // Взрыв: импульс от центра, слабеет к краю радиуса.
    explode(x, y, radius, strength) {
      for (const b of this.bodies) {
        if (b.invMass === 0) continue;
        const dx = b.pos.x - x, dy = b.pos.y - y, d = Math.hypot(dx, dy);
        if (d > radius || d < 1e-6) continue;
        const k = strength * (1 - d / radius);
        b.vel.x += (dx / d) * k * b.invMass; b.vel.y += (dy / d) * k * b.invMass + 0.3 * k * b.invMass;
        b.angVel += (dx > 0 ? -1 : 1) * k * 0.6 * b.invI * 0.1;
      }
    }
  }

  const api = { Body, World, collide, resetIds() { nextId = 1; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Phys = api;
})(typeof self !== 'undefined' ? self : this);
