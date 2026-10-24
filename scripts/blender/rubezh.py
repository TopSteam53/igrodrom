# «Последний рубеж»: 3D-модели (glb для Godot), текстуры земли и пятен, значки интерфейса,
# контрольный лист и картинки для каталога. Всё собирается из примитивов bmesh, без модификаторов:
# сколько треугольников видно в отчёте, столько и попадёт в игру.
#
#   blender --background --factory-startup --python scripts/blender/rubezh.py -- [имена…]
#
# Имена: models chars guns builds props textures icons sheet cover catalog_icon
#        или конкретный файл без расширения (survivor, house, ground_grass, icon_turret …).
# Без имён делается всё. Пути берутся от корня репозитория.
#
# Правила моделей (на них опирается код игры):
#   корень — пустышка с именем файла, начало координат на земле в центре клетки, перёд смотрит в −Y;
#   у персонажей части Body/Head/ArmL/ArmR/LegL/LegR с началом в суставе (+ пустышка Hand у игрока),
#   у турели Base/Head/Muzzle, у оружия — Muzzle на конце ствола. Поворотов у частей нет: поза
#   запечена в сетку, у объектов только смещения.
import bpy, bmesh, math, os, sys, time, random, tempfile
import numpy as np
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ONLY = set(argv)
HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
ASSETS = os.path.join(ROOT, 'godot', 'rubezh', 'assets')
MODELS = os.path.join(ASSETS, 'models')
TEX = os.path.join(ASSETS, 'textures')
UI = os.path.join(ASSETS, 'ui')
CATALOG = os.path.join(ROOT, 'public', 'games', 'rubezh')
TMP = os.path.join(tempfile.gettempdir(), 'rubezh-render')  # промежуточные кадры, в репозиторий не попадают
for d in (MODELS, TEX, UI, CATALOG):
    os.makedirs(d, exist_ok=True)
rad = math.radians

CHARS = ['survivor', 'zombie_walker', 'zombie_runner', 'zombie_brute', 'zombie_spitter', 'zombie_boss']
GUNS = ['gun_pistol', 'gun_shotgun', 'gun_rifle']
BUILDS = ['barricade', 'wall', 'spikes', 'turret', 'mine', 'house', 'lamp_post']
PROPS = ['tree_pine', 'tree_dead', 'rock_a', 'rock_b', 'car_wreck', 'hay_bale', 'crate', 'fence', 'barrel_rusty', 'tires']
GROUP = {**{n: 'chars' for n in CHARS}, **{n: 'guns' for n in GUNS}, **{n: 'builds' for n in BUILDS}, **{n: 'props' for n in PROPS}}


def want(task, name=None):
    if not ONLY or task in ONLY:
        return True
    if name and (name in ONLY or GROUP.get(name) in ONLY):
        return True
    return False


def log(*a):
    print('[rubezh]', *a, flush=True)


def hexc(h):
    h = h.lstrip('#')
    s = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in s)


# ---------- материалы ----------
MATS = {}


def M(h, rough=0.8, metal=0.0, emit=0.0, name=None):
    key = (h, rough, metal, emit)
    if key in MATS and MATS[key].name in bpy.data.materials:
        return MATS[key]
    m = bpy.data.materials.new(name or h.lstrip('#'))
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*hexc(h), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emit:
        p.inputs['Emission Color'].default_value = (*hexc(h), 1)
        p.inputs['Emission Strength'].default_value = emit
    MATS[key] = m
    return m


# ---------- геометрия ----------
def T(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    if not hasattr(scale, '__len__'):
        scale = (scale, scale, scale)
    return Matrix.LocRotScale(Vector(loc), Euler([rad(a) for a in rot]).to_quaternion(), Vector(scale))


def P(M_, p):
    return tuple(M_ @ Vector(p))


class G:
    """Сетка одной части. Координаты — от сустава части."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def mark(self):
        return len(self.bm.verts)

    def since(self, start):
        self.bm.verts.ensure_lookup_table()
        return [self.bm.verts[i] for i in range(start, len(self.bm.verts))]

    def xform(self, Mx, start=0):
        bmesh.ops.transform(self.bm, matrix=Mx, verts=self.since(start))

    def _paint(self, verts, m, smooth):
        if m not in self.mats:
            self.mats.append(m)
        i = self.mats.index(m)
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = i
            f.smooth = smooth
        return verts

    def box(self, size, loc=(0, 0, 0), m=None, rot=(0, 0, 0), taper=(1, 1), shift=(0, 0)):
        s = self.mark()
        bmesh.ops.create_cube(self.bm, size=1.0)
        v = self.since(s)
        for x in v:
            if x.co.z > 0:
                x.co.x = x.co.x * taper[0] + shift[0]
                x.co.y = x.co.y * taper[1] + shift[1]
        bmesh.ops.transform(self.bm, matrix=T(loc, rot, size), verts=v)
        return self._paint(v, m, False)

    def lathe(self, prof, seg=8, m=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), smooth=False, caps=True, phase=0.5):
        bm = self.bm
        s = self.mark()
        rings = []
        for r, z in prof:
            if r <= 1e-6:
                rings.append([bm.verts.new((0, 0, z))])
            else:
                rings.append([bm.verts.new((r * math.cos(2 * math.pi * (i + phase) / seg), r * math.sin(2 * math.pi * (i + phase) / seg), z)) for i in range(seg)])
        for a, b in zip(rings, rings[1:]):
            if len(a) == 1 and len(b) == 1:
                continue
            for i in range(seg):
                j = (i + 1) % seg
                if len(a) == 1:
                    bm.faces.new((a[0], b[i], b[j]))
                elif len(b) == 1:
                    bm.faces.new((a[i], a[j], b[0]))
                else:
                    bm.faces.new((a[i], a[j], b[j], b[i]))
        if caps:
            if len(rings[0]) > 1:
                bm.faces.new(rings[0])
            if len(rings[-1]) > 1:
                bm.faces.new(rings[-1])
        v = self.since(s)
        bmesh.ops.transform(bm, matrix=T(loc, rot, scale), verts=v)
        return self._paint(v, m, smooth)

    def cyl(self, r, h, loc=(0, 0, 0), m=None, seg=8, r2=None, rot=(0, 0, 0), scale=(1, 1, 1), smooth=False):
        # основание в loc, ось — локальная +Z (rot=(90,0,0) направляет её в −Y)
        return self.lathe([(r, 0), (r if r2 is None else r2, h)], seg, m, loc, rot, scale, smooth)

    def cone(self, r, h, loc=(0, 0, 0), m=None, seg=6, rot=(0, 0, 0), scale=(1, 1, 1)):
        return self.lathe([(r, 0), (0, h)], seg, m, loc, rot, scale)

    def sph(self, r, loc=(0, 0, 0), m=None, scale=(1, 1, 1), seg=8, rings=6, rot=(0, 0, 0), smooth=True):
        prof = [(0, -r)] + [(r * math.sin(math.pi * i / rings), -r * math.cos(math.pi * i / rings)) for i in range(1, rings)] + [(0, r)]
        return self.lathe(prof, seg, m, loc, rot, scale, smooth, caps=False)

    def ico(self, r, loc=(0, 0, 0), m=None, scale=(1, 1, 1), sub=1, jitter=0.0, seed=0, rot=(0, 0, 0), smooth=False):
        s = self.mark()
        bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=r)
        v = self.since(s)
        rng = random.Random(seed)
        for x in v:
            x.co *= 1 + rng.uniform(-jitter, jitter)
        bmesh.ops.transform(self.bm, matrix=T(loc, rot, scale), verts=v)
        return self._paint(v, m, smooth)

    def torus(self, R, r, loc=(0, 0, 0), m=None, seg=10, sides=5, rot=(0, 0, 0), scale=(1, 1, 1), matrix=None, smooth=False):
        bm = self.bm
        s = self.mark()
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring.append([bm.verts.new(((R + r * math.cos(2 * math.pi * k / sides)) * math.cos(a),
                                        (R + r * math.cos(2 * math.pi * k / sides)) * math.sin(a),
                                        r * math.sin(2 * math.pi * k / sides))) for k in range(sides)])
        for i in range(seg):
            a, b = ring[i], ring[(i + 1) % seg]
            for k in range(sides):
                kk = (k + 1) % sides
                bm.faces.new((a[k], b[k], b[kk], a[kk]))
        v = self.since(s)
        bmesh.ops.transform(bm, matrix=matrix if matrix is not None else T(loc, rot, scale), verts=v)
        return self._paint(v, m, smooth)

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)

    def obj(self, name, parent=None, loc=(0, 0, 0)):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = loc
        if parent is not None:
            ob.parent = parent
        return ob


def empty(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.15
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    if parent is not None:
        e.parent = parent
    return e


# ================= ПЕРСОНАЖИ =================
def legs(root, hip_x, hip_z, build):
    for side, nm in ((1, 'LegL'), (-1, 'LegR')):
        g = G()
        build(g, side)
        g.obj(nm, root, (side * hip_x, 0, hip_z))


def arm_pair(body, shoulders, build):
    """shoulders: {'ArmL': (loc, rot), 'ArmR': (loc, rot)}; build(g, side) строит руку вниз."""
    out = {}
    for nm, (loc, rot) in shoulders.items():
        side = 1 if nm == 'ArmL' else -1
        g = G()
        build(g, side)
        R = T((0, 0, 0), rot)
        g.xform(R)
        out[nm] = (g.obj(nm, body, loc), R)
    return out


def survivor():
    root = empty('survivor')
    jacket, jacket_d = M('#f2771f', 0.75, name='jacket'), M('#c45a12', 0.8, name='jacket_trim')
    pants, boots = M('#2d3242', 0.85, name='pants'), M('#3a2b20', 0.8, name='boots')
    skin, cap = M('#e2a47c', 0.7, name='skin'), M('#24375a', 0.75, name='cap')
    pack, roll, dark = M('#7d6a42', 0.85, name='backpack'), M('#4b5a38', 0.85, name='bedroll'), M('#1c1f27', 0.6, name='dark')

    def leg(g, side):
        g.box((0.17, 0.19, 0.5), (0, 0, -0.25), pants, taper=(1.08, 1.05))
        g.box((0.15, 0.17, 0.33), (0, 0, -0.64), pants)
        g.box((0.17, 0.28, 0.13), (0, -0.04, -0.815), boots, taper=(1, 0.9))
    legs(root, 0.11, 0.88, leg)

    b = G()
    b.box((0.38, 0.24, 0.2), (0, 0, 0.02), pants)
    b.box((0.46, 0.28, 0.5), (0, 0, 0.36), jacket, taper=(1.06, 1.0))
    b.box((0.48, 0.3, 0.07), (0, 0, 0.13), jacket_d)
    b.box((0.27, 0.22, 0.07), (0, -0.01, 0.63), jacket_d)
    b.box((0.03, 0.01, 0.42), (0.0, -0.142, 0.36), jacket_d)  # молния
    b.box((0.36, 0.17, 0.42), (0, 0.22, 0.36), pack, taper=(0.95, 0.9))
    b.box((0.26, 0.06, 0.18), (0, 0.32, 0.26), pack)
    b.cyl(0.08, 0.42, (-0.21, 0.22, 0.63), roll, seg=7, rot=(0, 90, 0))
    for x in (-0.13, 0.13):
        b.box((0.05, 0.02, 0.44), (x, -0.145, 0.38), pack)
    body = b.obj('Body', root, (0, 0, 0.92))

    h = G()
    h.cyl(0.06, 0.08, (0, 0, -0.01), skin, seg=6)
    h.sph(0.16, (0, 0, 0.17), skin, scale=(1, 0.95, 1.04), seg=10, rings=7)
    h.sph(0.172, (0, 0.012, 0.235), cap, scale=(1, 1.0, 0.62), seg=10, rings=6)
    h.box((0.22, 0.15, 0.025), (0, -0.19, 0.215), cap, rot=(10, 0, 0), taper=(1, 1))
    for x in (-0.055, 0.055):
        h.sph(0.022, (x, -0.147, 0.155), dark, seg=6, rings=4)
    h.box((0.04, 0.04, 0.05), (0, -0.16, 0.115), skin)
    h.obj('Head', body, (0, 0, 0.62))

    def arm(g, side):
        g.sph(0.088, (0, 0, -0.01), jacket, seg=8, rings=5)
        g.lathe([(0.072, 0), (0.066, -0.28), (0.06, -0.46)], 7, jacket)
        g.cyl(0.066, 0.05, (0, 0, -0.5), jacket_d, seg=7)
        g.sph(0.06, (0, 0, -0.55), skin, scale=(0.9, 1, 1.1), seg=7, rings=5)
    # прицельная поза: обе руки вперёд, левая поддерживает оружие
    arms = arm_pair(body, {'ArmL': ((0.29, 0, 0.55), (-82, 0, -36)), 'ArmR': ((-0.29, 0, 0.55), (-84, 0, 10))}, arm)
    armR, R = arms['ArmR']
    empty('Hand', armR, P(R, (0, 0, -0.55)))
    return root


def zombie_walker():
    root = empty('zombie_walker')
    skin, skin_d = M('#8ea178', 0.8, name='skin_walker'), M('#6c7d5b', 0.85, name='skin_walker_dark')
    shirt, shirt_d = M('#3c66a8', 0.85, name='shirt'), M('#2c4a7a', 0.85, name='shirt_dark')
    pants, shoes, goo = M('#5b4a3a', 0.9, name='pants_brown'), M('#2b2622', 0.8, name='shoes'), M('#3a3b1c', 0.4, name='goo')
    eye, dark = M('#ece4a2', 0.4, name='eye_yellow'), M('#1d1a16', 0.7, name='mouth')
    lean = 16

    def leg(g, side):
        g.box((0.17, 0.19, 0.48), (0, 0, -0.24), pants, taper=(1.06, 1.04))
        g.box((0.15, 0.17, 0.18), (0, 0, -0.54), pants, taper=(1, 1))
        g.box((0.11, 0.12, 0.14), (0, 0, -0.68), skin)  # рваная штанина
        g.box((0.16, 0.26, 0.11), (0, -0.04, -0.765), shoes)
    legs(root, 0.11, 0.82, leg)

    b = G()
    b.box((0.37, 0.23, 0.2), (0, 0, 0.02), pants)
    b.box((0.44, 0.27, 0.47), (0, 0, 0.35), shirt, taper=(1.05, 1.0))
    for i, x in enumerate((-0.17, -0.06, 0.05, 0.16)):  # рваный подол
        b.cone(0.05, 0.1, (x, -0.13 if i % 2 else 0.13, 0.13), shirt, seg=3, rot=(180, 0, 0))
    b.box((0.13, 0.02, 0.11), (0.1, -0.137, 0.4), skin_d)
    b.box((0.1, 0.02, 0.09), (-0.12, -0.137, 0.22), skin_d)
    b.box((0.16, 0.02, 0.12), (-0.05, 0.137, 0.32), skin_d)
    b.box((0.12, 0.02, 0.1), (-0.06, -0.138, 0.5), goo)
    b.box((0.25, 0.22, 0.06), (0, 0, 0.6), shirt_d)
    b.xform(T((0, 0, 0), (lean, 0, 0)))
    R = T((0, 0, 0), (lean, 0, 0))
    body = b.obj('Body', root, (0, 0, 0.86))

    h = G()
    h.cyl(0.06, 0.07, (0, 0, -0.01), skin, seg=6)
    h.sph(0.155, (0, -0.02, 0.15), skin, scale=(1, 1, 1.06), seg=9, rings=6)
    h.box((0.24, 0.06, 0.045), (0, -0.15, 0.2), skin_d)
    for x in (-0.055, 0.058):
        h.sph(0.03, (x, -0.15, 0.165), eye, seg=6, rings=4)
    h.box((0.1, 0.03, 0.05), (0.01, -0.165, 0.075), dark, rot=(0, 8, 0))
    for x, y in ((-0.06, 0.05), (0.07, 0.02), (0.0, 0.1)):
        h.box((0.06, 0.06, 0.04), (x, y, 0.3), skin_d)
    h.xform(T((0, 0, 0), (8, 12, 0)))
    h.obj('Head', body, P(R, (0, 0, 0.6)))

    def arm(g, side):
        g.sph(0.08, (0, 0, -0.01), shirt, seg=7, rings=5)
        g.lathe([(0.07, 0), (0.066, -0.18)], 7, shirt)
        g.lathe([(0.055, -0.17), (0.05, -0.47)], 6, skin)
        g.sph(0.06, (0, 0, -0.52), skin, scale=(0.9, 1, 1.15), seg=7, rings=5)
    arm_pair(body, {'ArmL': (P(R, (0.27, 0, 0.52)), (-72, 0, 6)), 'ArmR': (P(R, (-0.27, 0, 0.52)), (-96, 0, -4))}, arm)
    return root


def zombie_runner():
    root = empty('zombie_runner')
    skin, hood, hood_d = M('#cdd1bb', 0.75, name='skin_pale'), M('#b8323d', 0.85, name='hoodie'), M('#8e2230', 0.85, name='hoodie_dark')
    jeans, shoe, dark = M('#363a46', 0.85, name='jeans'), M('#dcdcd2', 0.7, name='sneakers'), M('#1b1517', 0.7, name='socket')
    eye = M('#f2e6a0', 0.4, name='eye_pale')
    lean = 26

    def leg(g, side):
        g.box((0.13, 0.15, 0.5), (0, 0, -0.25), jeans, taper=(1.08, 1.05))
        g.box((0.11, 0.13, 0.32), (0, 0, -0.66), jeans)
        g.box((0.13, 0.25, 0.1), (0, -0.05, -0.81), shoe, taper=(1, 0.85))
    legs(root, 0.09, 0.86, leg)

    b = G()
    b.box((0.3, 0.2, 0.18), (0, 0, 0.02), jeans)
    b.box((0.36, 0.22, 0.48), (0, 0, 0.35), hood, taper=(1.05, 1.0))
    b.box((0.22, 0.03, 0.12), (0, -0.115, 0.24), hood_d)
    b.box((0.3, 0.12, 0.1), (0, 0.11, 0.56), hood_d, rot=(-20, 0, 0))  # капюшон на спине
    b.xform(T((0, 0, 0), (lean, 0, 0)))
    R = T((0, 0, 0), (lean, 0, 0))
    body = b.obj('Body', root, (0, 0, 0.89))

    h = G()
    h.cyl(0.05, 0.07, (0, 0, -0.01), skin, seg=6)
    h.sph(0.185, (0, 0.03, 0.16), hood, scale=(1, 1, 1.05), seg=9, rings=6)
    h.sph(0.145, (0, -0.035, 0.145), skin, scale=(0.95, 1, 1.05), seg=9, rings=6)
    for x in (-0.05, 0.05):
        h.box((0.06, 0.03, 0.045), (x, -0.165, 0.16), dark)
        h.sph(0.016, (x, -0.18, 0.16), eye, seg=5, rings=3)
    h.box((0.07, 0.03, 0.05), (0, -0.172, 0.07), dark)
    h.xform(T((0, 0, 0), (-12, 0, 0)))  # голова поднята — смотрит вперёд, а не в землю
    h.obj('Head', body, P(R, (0, 0, 0.61)))

    def arm(g, side):
        g.sph(0.07, (0, 0, -0.01), hood, seg=7, rings=5)
        g.lathe([(0.058, 0), (0.05, -0.44)], 6, hood)
        g.sph(0.05, (0, 0, -0.49), skin, scale=(0.9, 1, 1.15), seg=6, rings=4)
    # руки отведены назад — бег
    arm_pair(body, {'ArmL': (P(R, (0.22, 0, 0.53)), (40, 0, -8)), 'ArmR': (P(R, (-0.22, 0, 0.53)), (28, 0, 8))}, arm)
    return root


def zombie_brute():
    root = empty('zombie_brute')
    skin, skin_d = M('#7d6d8e', 0.8, name='skin_brute'), M('#5f5170', 0.85, name='skin_brute_dark')
    ov, ov_d = M('#c0652a', 0.85, name='overalls'), M('#93491c', 0.85, name='overalls_dark')
    boots, metal, eye = M('#2e2724', 0.8, name='boots_brute'), M('#d9c060', 0.5, 0.2, name='buttons'), M('#ece4a2', 0.4, name='eye_yellow')
    tooth, dark = M('#e8e0c4', 0.5, name='teeth'), M('#1d1418', 0.7, name='mouth_dark')
    lean = 12

    def leg(g, side):
        g.box((0.32, 0.34, 0.55), (0, 0, -0.27), ov, taper=(1.1, 1.05))
        g.box((0.28, 0.3, 0.33), (0, 0, -0.7), ov_d)
        g.box((0.3, 0.42, 0.16), (0, -0.06, -0.92), boots, taper=(0.95, 0.85))
    legs(root, 0.25, 1.0, leg)

    b = G()
    b.box((0.82, 0.5, 0.36), (0, 0, 0.06), ov, taper=(1.04, 1.04))
    b.sph(0.5, (0, 0, 0.6), skin, scale=(1.18, 0.78, 1.0), seg=10, rings=7)
    b.sph(0.3, (0, 0.17, 0.92), skin_d, scale=(1.3, 0.9, 0.8), seg=8, rings=5)  # горб
    b.box((0.52, 0.1, 0.44), (0, -0.33, 0.36), ov, taper=(1, 1))
    for x in (-0.2, 0.2):
        b.box((0.08, 0.05, 0.52), (x, -0.22, 0.79), ov_d, rot=(-35, 0, 0))
        b.box((0.06, 0.03, 0.06), (x, -0.385, 0.54), metal)
    b.box((0.2, 0.03, 0.12), (0.0, -0.385, 0.3), ov_d)
    b.xform(T((0, 0, 0), (lean, 0, 0)))
    R = T((0, 0, 0), (lean, 0, 0))
    body = b.obj('Body', root, (0, 0, 1.03))

    h = G()
    h.sph(0.18, (0, -0.03, 0.12), skin, scale=(1.12, 1, 0.95), seg=9, rings=6)
    h.box((0.27, 0.16, 0.11), (0, -0.09, 0.02), skin_d, taper=(1.1, 1))
    h.box((0.18, 0.03, 0.04), (0, -0.172, 0.05), dark)
    for x in (-0.06, 0.06):
        h.box((0.035, 0.03, 0.06), (x, -0.175, 0.09), tooth)
        h.sph(0.022, (x, -0.19, 0.15), eye, seg=5, rings=3)
    h.box((0.28, 0.07, 0.055), (0, -0.18, 0.19), skin_d)
    h.obj('Head', body, P(R, (0, -0.08, 0.98)))

    def arm(g, side):
        g.sph(0.18, (0, 0, -0.02), skin, seg=8, rings=5)
        g.lathe([(0.15, 0), (0.13, -0.48)], 7, skin)
        g.lathe([(0.14, -0.46), (0.12, -0.86)], 7, skin_d)
        g.sph(0.23, (0, -0.02, -1.0), skin, scale=(1, 1.1, 0.95), seg=8, rings=6)
        for x in (-0.09, 0.0, 0.09):
            g.box((0.07, 0.07, 0.07), (x, -0.22, -0.98), skin_d)
    arm_pair(body, {'ArmL': (P(R, (0.6, 0, 0.82)), (-14, -12, 0)), 'ArmR': (P(R, (-0.6, 0, 0.82)), (-14, 12, 0))}, arm)
    return root


def zombie_spitter():
    root = empty('zombie_spitter')
    skin, skin_d = M('#b4c04c', 0.75, name='skin_spitter'), M('#8c9a34', 0.8, name='skin_spitter_dark')
    rags, rags_d = M('#6a5d46', 0.9, name='rags'), M('#4e4434', 0.9, name='rags_dark')
    sack = M('#a8ff3c', 0.35, emit=1.4, name='toxic_glow')
    dark, eye = M('#2a1e12', 0.6, name='mouth_spitter'), M('#f4f0c0', 0.4, name='eye_white')
    lean = 40

    def leg(g, side):
        g.box((0.15, 0.17, 0.42), (0, 0, -0.21), rags, taper=(1.08, 1.04))
        g.box((0.12, 0.14, 0.27), (0, 0, -0.55), skin_d)
        g.box((0.15, 0.24, 0.09), (0, -0.04, -0.695), rags_d)
    legs(root, 0.11, 0.74, leg)

    b = G()
    b.box((0.34, 0.22, 0.18), (0, 0, 0.02), rags)
    b.box((0.4, 0.3, 0.46), (0, 0, 0.33), rags, taper=(1.08, 1.05))
    b.box((0.2, 0.02, 0.18), (0.06, -0.151, 0.36), skin)
    for loc, r in (((0.11, 0.22, 0.42), 0.15), ((-0.12, 0.2, 0.32), 0.13), ((0.0, 0.24, 0.17), 0.1), ((-0.04, 0.19, 0.55), 0.09)):
        b.sph(r, loc, sack, scale=(1, 0.85, 1), seg=8, rings=5)
    b.box((0.36, 0.06, 0.04), (0, 0.17, 0.25), rags_d)  # ремень, держит мешки
    b.xform(T((0, 0, 0), (lean, 0, 0)))
    R = T((0, 0, 0), (lean, 0, 0))
    body = b.obj('Body', root, (0, 0, 0.77))

    h = G()
    h.cyl(0.055, 0.07, (0, 0, -0.01), skin, seg=6)
    h.sph(0.15, (0, -0.04, 0.12), skin, scale=(1, 1, 1), seg=9, rings=6)
    h.sph(0.12, (0, -0.07, 0.03), sack, scale=(1.15, 0.9, 0.75), seg=8, rings=5)  # раздутое горло
    h.sph(0.05, (0, -0.18, 0.08), dark, scale=(1.2, 0.6, 1), seg=6, rings=4)
    for x in (-0.055, 0.055):
        h.sph(0.032, (x, -0.165, 0.17), eye, seg=6, rings=4)
    h.box((0.06, 0.06, 0.05), (0.05, 0.02, 0.26), skin_d)
    h.xform(T((0, 0, 0), (-30, 0, 0)))  # голова задрана: сутулый, но смотрит вперёд
    h.obj('Head', body, P(R, (0, -0.02, 0.58)))

    def arm(g, side):
        g.sph(0.07, (0, 0, -0.01), rags, seg=7, rings=4)
        g.lathe([(0.055, 0), (0.045, -0.56)], 6, skin)
        g.sph(0.055, (0, 0, -0.6), skin_d, scale=(0.9, 1, 1.2), seg=6, rings=4)
    arm_pair(body, {'ArmL': (P(R, (0.24, 0, 0.5)), (-30, -6, 0)), 'ArmR': (P(R, (-0.24, 0, 0.5)), (-40, 6, 0))}, arm)
    return root


def chain(g, a, b, n, m, R=0.06, r=0.016):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    n1 = d.cross(Vector((0, 0, 1)))
    if n1.length < 1e-4:
        n1 = Vector((1, 0, 0))
    n1.normalize()
    for i in range(n):
        p = a.lerp(b, (i + 0.5) / n)
        z = n1 if i % 2 else d.cross(n1).normalized()
        y = z.cross(d)
        Mx = Matrix((
            (d.x, y.x, z.x, p.x),
            (d.y, y.y, z.y, p.y),
            (d.z, y.z, z.z, p.z),
            (0, 0, 0, 1)))
        g.torus(R, r, m=m, seg=6, sides=3, matrix=Mx @ T((0, 0, 0), (0, 0, 0), (1.5, 1, 1)))


def zombie_boss():
    root = empty('zombie_boss')
    skin, skin_d = M('#7a3b2d', 0.8, name='skin_boss'), M('#5b2a21', 0.85, name='skin_boss_dark')
    metal, metal_d = M('#7f8a93', 0.55, 0.3, name='scrap_metal'), M('#5a636c', 0.6, 0.3, name='scrap_metal_dark')
    rust, cloth = M('#9b5a32', 0.8, 0.1, name='rust'), M('#3a302c', 0.9, name='cloth_boss')
    chainm, eye = M('#4b5157', 0.5, 0.3, name='chain'), M('#ffd25a', 0.4, name='eye_boss')
    tooth, dark = M('#e6dcbc', 0.5, name='teeth_boss'), M('#1a1012', 0.7, name='mouth_boss')
    lean = 8

    def leg(g, side):
        g.lathe([(0.24, 0), (0.21, -0.6)], 8, cloth)
        g.lathe([(0.2, -0.58), (0.18, -1.08)], 8, skin_d)
        g.box((0.3, 0.12, 0.3), (0, -0.2, -0.62), metal, rot=(-8, 0, 0))
        g.box((0.38, 0.5, 0.2), (0, -0.07, -1.15), metal_d, taper=(0.9, 0.8))
    legs(root, 0.38, 1.25, leg)

    b = G()
    b.box((1.05, 0.7, 0.24), (0, 0, 0.02), metal_d, taper=(1.02, 1.02))
    b.box((0.5, 0.06, 0.42), (0, -0.37, -0.24), rust, taper=(1.15, 1))
    b.sph(0.62, (0, 0, 0.75), skin, scale=(1.3, 0.86, 1.06), seg=10, rings=7)
    b.box((0.86, 0.12, 0.5), (0, -0.5, 0.85), metal, rot=(-14, 0, 0), taper=(1.08, 1))
    b.box((0.38, 0.06, 0.28), (0.22, -0.585, 0.66), rust, rot=(-10, 0, 12))
    for x, z in ((-0.33, 1.02), (0.33, 1.02), (-0.33, 0.68), (0.33, 0.68)):
        b.box((0.05, 0.05, 0.05), (x, -0.57, z), metal_d)
    b.box((0.7, 0.14, 0.36), (0, 0.5, 0.95), metal_d, rot=(18, 0, -6))
    chain(b, (0.62, -0.5, 1.2), (-0.62, -0.55, 0.2), 8, chainm)
    b.xform(T((0, 0, 0), (lean, 0, 0)))
    R = T((0, 0, 0), (lean, 0, 0))
    body = b.obj('Body', root, (0, 0, 1.3))

    h = G()
    h.sph(0.23, (0, -0.04, 0.14), skin, scale=(1.05, 1, 0.95), seg=9, rings=6)
    h.lathe([(0.245, 0.14), (0.225, 0.42)], 8, metal)  # ведро-шлем
    h.box((0.36, 0.08, 0.03), (0, -0.24, 0.14), metal_d)
    for x in (-0.15, 0.15):
        h.cone(0.05, 0.18, (x, 0, 0.4), rust, seg=4, rot=(0, -x * 120, 0))
    for x in (-0.085, 0.085):
        h.sph(0.03, (x, -0.235, 0.1), eye, seg=6, rings=4)
    h.box((0.24, 0.06, 0.06), (0, -0.24, 0.0), dark)
    for x in (-0.08, -0.025, 0.03, 0.085):
        h.box((0.04, 0.03, 0.05), (x, -0.255, 0.01 + (0.015 if x > 0 else 0)), tooth)
    h.obj('Head', body, P(R, (0, -0.12, 1.37)))

    def arm(g, side):
        g.sph(0.31, (0, 0, 0.06), metal, scale=(1.15, 1, 0.62), seg=8, rings=5)
        g.cone(0.06, 0.24, (side * 0.12, 0, 0.2), rust, seg=4, rot=(0, side * 25, 0))
        g.cone(0.05, 0.18, (side * -0.06, 0.08, 0.22), rust, seg=4, rot=(0, side * 10, 0))
        g.lathe([(0.22, 0), (0.19, -0.62)], 8, skin)
        g.lathe([(0.21, -0.62), (0.2, -0.98)], 8, metal_d)
        g.sph(0.3, (0, -0.02, -1.2), skin, scale=(1, 1.05, 0.95), seg=8, rings=6)
        if side < 0:
            g.torus(0.23, 0.028, (0, 0, -1.02), chainm, seg=8, sides=3)
            g.torus(0.21, 0.028, (0, 0, -0.9), chainm, seg=8, sides=3)
    arm_pair(body, {'ArmL': (P(R, (0.88, 0, 1.12)), (-12, -10, 0)), 'ArmR': (P(R, (-0.88, 0, 1.12)), (-16, 10, 0))}, arm)
    return root


# ================= ОРУЖИЕ =================
def gun_pistol():
    root = empty('gun_pistol')
    steel, grip = M('#30343b', 0.5, 0.3, name='gun_steel'), M('#1f2126', 0.7, name='gun_grip')
    g = G()
    g.box((0.036, 0.055, 0.12), (0, 0.015, -0.035), grip, rot=(-14, 0, 0))
    g.box((0.04, 0.21, 0.052), (0, -0.045, 0.05), steel)
    g.box((0.03, 0.06, 0.012), (0, -0.02, 0.0), grip)
    g.cyl(0.011, 0.02, (0, -0.15, 0.045), grip, seg=6, rot=(90, 0, 0))
    g.box((0.012, 0.02, 0.012), (0, -0.13, 0.082), steel)
    g.obj('Mesh', root)
    empty('Muzzle', root, (0, -0.17, 0.045))
    return root


def gun_shotgun():
    root = empty('gun_shotgun')
    steel, wood = M('#30343b', 0.5, 0.3, name='gun_steel'), M('#8b5a33', 0.75, name='gun_wood')
    g = G()
    g.box((0.046, 0.3, 0.09), (0, 0.27, -0.03), wood, taper=(1, 1), rot=(-6, 0, 0))
    g.box((0.04, 0.09, 0.09), (0, 0.08, -0.03), wood, rot=(-20, 0, 0))
    g.box((0.052, 0.22, 0.085), (0, -0.04, 0.025), steel)
    g.cyl(0.022, 0.62, (0, -0.14, 0.045), steel, seg=7, rot=(90, 0, 0))
    g.cyl(0.016, 0.5, (0, -0.14, 0.0), steel, seg=6, rot=(90, 0, 0))
    g.box((0.054, 0.2, 0.052), (0, -0.37, 0.002), wood)
    g.obj('Mesh', root)
    empty('Muzzle', root, (0, -0.77, 0.045))
    return root


def gun_rifle():
    root = empty('gun_rifle')
    steel, olive, grip = M('#30343b', 0.5, 0.3, name='gun_steel'), M('#5e6741', 0.75, name='gun_olive'), M('#1f2126', 0.7, name='gun_grip')
    g = G()
    g.box((0.045, 0.24, 0.1), (0, 0.27, -0.0), olive, taper=(1, 1))
    g.box((0.03, 0.12, 0.05), (0, 0.13, 0.03), grip)
    g.box((0.036, 0.05, 0.11), (0, 0.03, -0.055), grip, rot=(-16, 0, 0))
    g.box((0.05, 0.32, 0.09), (0, -0.07, 0.025), steel)
    g.box((0.036, 0.075, 0.16), (0, -0.1, -0.09), grip, rot=(14, 0, 0))
    g.box((0.056, 0.22, 0.07), (0, -0.33, 0.02), olive)
    g.cyl(0.013, 0.2, (0, -0.43, 0.025), steel, seg=6, rot=(90, 0, 0))
    g.box((0.02, 0.14, 0.035), (0, -0.04, 0.085), grip)
    g.obj('Mesh', root)
    empty('Muzzle', root, (0, -0.64, 0.025))
    return root


# ================= ПОСТРОЙКИ =================
def sandbag(g, loc, m, rot=0, s=1.0):
    g.sph(0.2 * s, loc, m, scale=(1.0, 0.62, 0.42), seg=8, rings=4, rot=(0, 0, rot))


def barricade():
    root = empty('barricade')
    wood, wood_d, wood_l = M('#a77a4b', 0.85, name='plank'), M('#7a5634', 0.85, name='plank_dark'), M('#bf9563', 0.85, name='plank_light')
    bag, nail = M('#c2ae84', 0.9, name='sandbag'), M('#55595e', 0.5, 0.3, name='nails')
    g = G()
    for x in (-0.4, 0.4):
        g.box((0.11, 0.11, 1.02), (x, 0.08, 0.51), wood_d, rot=(0, x * 6, 0))
    rng = random.Random(3)
    for i, z in enumerate((0.36, 0.6, 0.84)):
        g.box((1.0, 0.05, 0.17), (rng.uniform(-0.04, 0.04), 0.01, z), (wood, wood_l)[i % 2], rot=(0, rng.uniform(-5, 5), 0))
    g.box((1.08, 0.05, 0.14), (0, -0.03, 0.6), wood_d, rot=(0, 34, 0))
    for x in (-0.4, 0.4):
        for z in (0.36, 0.6, 0.84):
            g.box((0.025, 0.02, 0.025), (x, -0.025, z), nail)
    for x in (-0.3, 0.0, 0.3):
        sandbag(g, (x, -0.25, 0.09), bag, rot=rng.uniform(-8, 8))
    for x in (-0.15, 0.16):
        sandbag(g, (x, -0.25, 0.25), bag, rot=rng.uniform(-8, 8))
    g.obj('Mesh', root)
    return root


def wall():
    root = empty('wall')
    conc, conc_d = M('#9c9b93', 0.9, name='concrete'), M('#7d7c75', 0.9, name='concrete_dark')
    sheet, rust, rivet = M('#6b7d88', 0.6, 0.25, name='metal_sheet'), M('#9a5a33', 0.85, name='rust'), M('#3f454b', 0.5, 0.3, name='rivets')
    g = G()
    g.box((1.0, 0.66, 0.16), (0, 0, 0.08), conc_d)
    g.box((0.96, 0.58, 1.02), (0, 0, 0.67), conc)
    g.box((0.98, 0.6, 0.06), (0, 0, 1.2), conc_d)
    g.box((0.88, 0.04, 0.78), (0, -0.31, 0.62), sheet, rot=(0, 2, 0))
    g.box((0.26, 0.012, 0.2), (0.22, -0.333, 0.38), rust, rot=(0, 2, 0))
    g.box((0.16, 0.012, 0.12), (-0.25, -0.333, 0.85), rust)
    for x in (-0.38, 0.38):
        for z in (0.3, 0.62, 0.95):
            g.box((0.035, 0.03, 0.035), (x, -0.335, z), rivet)
    for x, y in ((-0.3, 0.1), (0.25, -0.05), (0.05, 0.18)):
        g.cyl(0.012, 0.16, (x, y, 1.22), rust, seg=4, rot=(rng_tilt(x), 0, 0))
    g.obj('Mesh', root)
    return root


def rng_tilt(x):
    return 12 * math.sin(x * 9)


def spikes():
    root = empty('spikes')
    log_m, stake, tip = M('#7a5634', 0.85, name='log'), M('#b48653', 0.85, name='stake'), M('#e3cfa2', 0.8, name='stake_tip')
    g = G()
    for i, (loc, rot) in enumerate((((0, -0.42, 0.06), (0, 90, 0)), ((0, 0.42, 0.06), (0, 90, 0)),
                                   ((-0.42, 0, 0.06), (90, 0, 0)), ((0.42, 0, 0.06), (90, 0, 0)))):
        x, y, z = loc
        if rot[1]:
            g.cyl(0.06, 0.96, (x - 0.48, y, z), log_m, seg=6, rot=rot)
        else:
            g.cyl(0.06, 0.96, (x, y + 0.48, z), log_m, seg=6, rot=rot)
    rng = random.Random(7)
    for ix in (-0.25, 0.0, 0.25):
        for iy in (-0.25, 0.0, 0.25):
            x, y = ix + rng.uniform(-0.04, 0.04), iy + rng.uniform(-0.04, 0.04)
            tilt = (rng.uniform(-14, 14), rng.uniform(-14, 14), 0)
            h = rng.uniform(0.34, 0.46)
            Rm = T((x, y, 0.0), tilt)
            g.lathe([(0.045, 0), (0.045, h * 0.62)], 5, stake, loc=(x, y, 0), rot=tilt)
            g.lathe([(0.045, h * 0.62), (0, h)], 5, tip, loc=(x, y, 0), rot=tilt)
    g.obj('Mesh', root)
    return root


def turret():
    root = empty('turret')
    crate, crate_d = M('#5f6a3a', 0.85, name='ammo_crate'), M('#454d2a', 0.85, name='ammo_crate_dark')
    steel, steel_d = M('#3d444c', 0.55, 0.3, name='turret_steel'), M('#2a2f35', 0.6, 0.3, name='turret_steel_dark')
    stripe, lens = M('#e9b42c', 0.6, name='hazard_yellow'), M('#7fd8ff', 0.3, name='sensor')
    g = G()
    g.box((0.66, 0.66, 0.32), (0, 0, 0.16), crate)
    g.box((0.68, 0.68, 0.05), (0, 0, 0.31), crate_d)
    for x in (-0.25, 0.25):
        g.box((0.07, 0.69, 0.33), (x, 0, 0.16), crate_d)
    g.box((0.3, 0.02, 0.06), (0, -0.34, 0.2), stripe)
    g.cyl(0.07, 0.22, (0, 0, 0.32), steel_d, seg=8)
    g.cyl(0.14, 0.05, (0, 0, 0.52), steel, seg=8)
    g.obj('Base', root)
    hz = 0.6
    h = G()
    h.box((0.3, 0.38, 0.2), (0, 0.02, 0.04), steel, taper=(0.9, 0.9))
    h.box((0.31, 0.06, 0.05), (0, 0.15, 0.13), stripe)
    h.box((0.12, 0.22, 0.16), (0.21, 0.04, 0.02), crate)  # короб с лентой
    h.cyl(0.045, 0.5, (0, -0.17, 0.05), steel_d, seg=8, rot=(90, 0, 0))
    h.cyl(0.06, 0.09, (0, -0.6, 0.05), steel_d, seg=8, rot=(90, 0, 0))
    h.box((0.08, 0.05, 0.06), (-0.12, -0.17, 0.12), lens)
    head = h.obj('Head', root, (0, 0, hz))
    empty('Muzzle', head, (0, -0.7, 0.05))
    return root


def mine():
    root = empty('mine')
    red, red_d = M('#c7362c', 0.6, name='barrel_red'), M('#9a261f', 0.65, name='barrel_red_dark')
    yel, blk = M('#f2c230', 0.6, name='hazard_yellow'), M('#232326', 0.6, name='hazard_black')
    box_m, led = M('#4a4f55', 0.5, 0.3, name='detonator'), M('#ff5a3c', 0.4, emit=1.2, name='detonator_led')
    g = G()
    seg = 12
    g.cyl(0.24, 0.6, (0, 0, 0), red, seg=seg)
    for z in (0.12, 0.47):
        g.cyl(0.25, 0.035, (0, 0, z), red_d, seg=seg)
    # полосатая лента: чередуем грани
    s = g.mark()
    v = g.lathe([(0.247, 0.22), (0.247, 0.38)], seg, yel, caps=False)
    ring_faces = sorted({f for x in v for f in x.link_faces}, key=lambda f: math.atan2(f.calc_center_median().y, f.calc_center_median().x))
    if blk not in g.mats:
        g.mats.append(blk)
    for i, f in enumerate(ring_faces):
        if i % 2:
            f.material_index = g.mats.index(blk)
    g.box((0.16, 0.12, 0.08), (0.04, 0, 0.64), box_m)
    g.box((0.035, 0.035, 0.03), (0.08, -0.03, 0.69), led)
    g.cyl(0.006, 0.18, (-0.02, 0.03, 0.66), box_m, seg=4, rot=(0, -20, 0))
    g.obj('Mesh', root)
    return root


def house():
    root = empty('house')
    conc, wood, wood_d = M('#8f8d86', 0.9, name='foundation'), M('#a06c45', 0.85, name='siding'), M('#6a4529', 0.85, name='siding_dark')
    roof, roof_d = M('#8c3b2d', 0.75, 0.1, name='roof_tin'), M('#5f2820', 0.8, name='roof_ridge')
    glass, lit = M('#1f2733', 0.4, name='window_dark'), M('#ffb35a', 0.5, emit=1.6, name='window_lit')
    sheet, bag = M('#6b7d88', 0.6, 0.25, name='metal_sheet'), M('#c2ae84', 0.9, name='sandbag')
    gen, gen_d, pole = M('#e0a72a', 0.6, name='generator'), M('#3a3d42', 0.6, 0.2, name='generator_dark'), M('#9aa0a6', 0.5, 0.3, name='pole')
    flag, brick, door_m = M('#f2771f', 0.8, name='flag'), M('#8a4a3a', 0.9, name='brick'), M('#5a3a24', 0.85, name='door')
    g = G()
    cx, cy = -0.15, 0.25
    g.box((2.55, 2.25, 0.2), (cx, cy, 0.1), conc)
    g.box((2.3, 2.0, 1.7), (cx, cy, 1.05), wood)
    for z in (0.62, 1.05, 1.48):  # доски обшивки
        g.box((2.32, 0.02, 0.03), (cx, cy - 1.005, z), wood_d)
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.box((0.13, 0.13, 1.72), (cx + sx * 1.15, cy + sy * 1.0, 1.05), wood_d)
    # крыша
    ridge = 2.55
    for sy in (-1, 1):
        g.box((2.62, 1.34, 0.08), (cx, cy + sy * 0.575, ridge - 0.33), roof, rot=(-sy * 30, 0, 0))
    g.box((2.66, 0.14, 0.08), (cx, cy, ridge + 0.02), roof_d)
    g.box((2.3, 2.0, 0.65), (cx, cy, 1.9 + 0.325), wood, taper=(1, 0.02))
    g.box((0.3, 0.3, 0.75), (cx - 0.75, cy + 0.45, 2.45), brick)
    # фасад: дверь, горящее окно, заколоченное окно
    g.box((0.52, 0.07, 0.98), (0.45, cy - 1.0, 0.69), door_m)
    g.box((0.06, 0.02, 0.06), (0.65, cy - 1.04, 0.7), pole)
    g.box((0.74, 0.32, 0.1), (0.45, cy - 1.15, 0.05), conc)
    g.box((0.6, 0.06, 0.5), (-0.65, cy - 1.0, 1.18), wood_d)
    g.box((0.48, 0.04, 0.38), (-0.65, cy - 1.025, 1.18), lit)
    g.box((0.04, 0.03, 0.38), (-0.65, cy - 1.045, 1.18), wood_d)
    g.box((0.48, 0.03, 0.04), (-0.65, cy - 1.045, 1.18), wood_d)
    g.box((0.62, 0.035, 0.09), (-0.62, cy - 1.06, 1.05), wood, rot=(0, -14, 0))  # одна доска поперёк
    g.box((0.62, 0.03, 0.5), (-0.65, cy - 1.02, 0.5), sheet, rot=(0, 3, 0))
    for sx in (-1, 1):
        x = cx + sx * 1.0
        g.box((0.06, 0.5, 0.42), (cx + sx * 1.16, cy - 0.2, 1.2), glass)
        g.box((0.04, 0.62, 0.09), (cx + sx * 1.19, cy - 0.2, 1.2), wood, rot=(28, 0, 0))
        g.box((0.04, 0.62, 0.09), (cx + sx * 1.19, cy - 0.2, 1.2), wood, rot=(-28, 0, 0))
    for i, x in enumerate((-1.15, -0.8, -0.45)):
        sandbag(g, (x, cy - 1.18, 0.29), bag, rot=(-5, 6, -3)[i], s=0.9)
    for x in (-0.98, -0.62):
        sandbag(g, (x, cy - 1.18, 0.43), bag, s=0.85)
    # генератор справа спереди
    g.box((0.62, 0.42, 0.06), (1.05, -1.0, 0.03), gen_d)
    g.box((0.56, 0.38, 0.42), (1.05, -1.0, 0.27), gen)
    g.box((0.4, 0.02, 0.22), (1.05, -1.195, 0.27), gen_d)
    g.cyl(0.035, 0.32, (1.25, -0.9, 0.48), gen_d, seg=6)
    g.box((0.04, 0.5, 0.04), (0.9, -0.62, 0.12), gen_d)
    # антенна на крыше
    g.cyl(0.028, 1.75, (0.55, cy, ridge - 0.02), pole, seg=6)
    g.box((0.56, 0.03, 0.03), (0.55, cy, ridge + 1.15), pole)
    g.box((0.38, 0.03, 0.03), (0.55, cy, ridge + 1.45), pole)
    g.sph(0.04, (0.55, cy, ridge + 1.75), lit, seg=6, rings=4)
    # флаг у левого переднего угла
    fx, fy = -1.35, -1.28
    g.cyl(0.03, 3.15, (fx, fy, 0), pole, seg=6)
    for i in range(3):
        g.box((0.22, 0.025, 0.38 - i * 0.03), (fx + 0.13 + i * 0.21, fy - (0.03 if i == 1 else 0), 2.92 - i * 0.02), flag, rot=(0, 0, (14, -10, 12)[i]))
    g.obj('Mesh', root)
    return root


def lamp_post():
    root = empty('lamp_post')
    conc, iron, bulb = M('#8f8d86', 0.9, name='lamp_base'), M('#2f3a36', 0.55, 0.25, name='lamp_iron'), M('#ffe3a8', 0.4, emit=2.4, name='lamp_bulb')
    g = G()
    g.box((0.3, 0.3, 0.16), (0, 0, 0.08), conc, taper=(0.85, 0.85))
    g.cyl(0.065, 2.8, (0, 0, 0.15), iron, seg=8, r2=0.045)
    g.box((0.05, 0.52, 0.05), (0, -0.24, 2.9), iron)
    g.box((0.04, 0.3, 0.04), (0, -0.12, 2.75), iron, rot=(45, 0, 0))
    g.lathe([(0.21, 2.74), (0.09, 2.86), (0.03, 2.9)], 8, iron, loc=(0, -0.48, 0))
    g.sph(0.075, (0, -0.48, 2.73), bulb, seg=8, rings=5)
    g.obj('Mesh', root)
    return root


# ================= ОКРУЖЕНИЕ =================
def tree_pine():
    root = empty('tree_pine')
    bark = M('#5a4030', 0.9, name='bark')
    greens = [M('#3d5a3a', 0.85, name='pine_dark'), M('#4a6b43', 0.85, name='pine'), M('#56794b', 0.85, name='pine_light')]
    g = G()
    g.cyl(0.14, 1.0, (0, 0, 0), bark, seg=6, r2=0.1)
    for i, (z, r, h) in enumerate(((0.7, 1.15, 1.6), (1.55, 0.92, 1.4), (2.35, 0.66, 1.3))):
        v = g.lathe([(r, z), (r * 0.82, z + 0.12), (0, z + h)], 7, greens[i], phase=i * 0.33)
    g.ico(0.01, (0, 0, 3.65), greens[2])
    rng = random.Random(11)
    for x in g.since(0):
        if x.co.z > 0.8:
            x.co.x += rng.uniform(-0.05, 0.05)
            x.co.y += rng.uniform(-0.05, 0.05)
    g.obj('Mesh', root)
    return root


def tree_dead():
    root = empty('tree_dead')
    bark, bark_d = M('#6e6052', 0.9, name='dead_bark'), M('#544a40', 0.9, name='dead_bark_dark')
    g = G()
    g.lathe([(0.2, 0), (0.14, 0.4), (0.11, 1.6), (0.05, 2.9)], 6, bark)
    for (z, rot, ln, r) in ((1.0, (0, 55, 20), 1.0, 0.06), (1.5, (0, -50, -30), 0.9, 0.055), (2.0, (0, 40, 120), 0.7, 0.045),
                            (2.3, (0, -35, 200), 0.6, 0.035), (0.7, (0, -62, 150), 0.6, 0.05)):
        g.cyl(r, ln, (0, 0, z), bark_d, seg=5, r2=0.012, rot=rot)
    for a in range(5):
        ang = a * 72 + 20
        g.cone(0.09, 0.4, (math.cos(rad(ang)) * 0.12, math.sin(rad(ang)) * 0.12, 0), bark_d, seg=4, rot=(0, 70, ang), scale=(1, 1, 1))
    g.obj('Mesh', root)
    return root


def rock_a():
    root = empty('rock_a')
    g = G()
    g.ico(0.5, (0, 0, 0.18), M('#8b8a83', 0.9, name='rock'), scale=(1.1, 0.85, 0.62), sub=1, jitter=0.18, seed=4)
    g.ico(0.18, (0.38, -0.25, 0.08), M('#77776f', 0.9, name='rock_dark'), scale=(1, 0.9, 0.7), sub=1, jitter=0.2, seed=5)
    g.box((0.4, 0.25, 0.04), (-0.05, 0.05, 0.47), M('#6f7f4a', 0.95, name='moss'), rot=(4, -6, 20), taper=(0.7, 0.6))
    g.obj('Mesh', root)
    return root


def rock_b():
    root = empty('rock_b')
    a, b = M('#7c8084', 0.9, name='rock_grey'), M('#93958f', 0.9, name='rock')
    g = G()
    g.ico(0.42, (-0.22, 0.05, 0.25), a, scale=(0.9, 0.8, 1.05), sub=1, jitter=0.2, seed=8)
    g.ico(0.3, (0.3, -0.05, 0.14), b, scale=(1.1, 0.9, 0.75), sub=1, jitter=0.2, seed=9)
    g.ico(0.15, (0.1, -0.35, 0.06), a, sub=0, jitter=0.15, seed=10)
    g.obj('Mesh', root)
    return root


def car_wreck():
    root = empty('car_wreck')
    paint, paint_d = M('#5d8584', 0.7, name='car_paint'), M('#476968', 0.75, name='car_paint_dark')
    rust, glass, tire = M('#8c5532', 0.9, name='car_rust'), M('#1f2a33', 0.35, name='car_glass'), M('#26272b', 0.9, name='tire')
    chrome, light = M('#9aa0a4', 0.5, 0.3, name='car_chrome'), M('#d8d2b8', 0.5, name='car_lamp')
    g = G()
    # кузов вдоль X, перёд машины в −X
    g.box((3.0, 1.5, 0.55), (0, 0, 0.6), paint, taper=(1, 0.97))
    g.box((1.55, 1.36, 0.5), (0.25, 0, 1.12), paint, taper=(0.78, 0.86))
    g.box((1.4, 1.38, 0.34), (0.25, 0, 1.1), glass, taper=(0.8, 0.88))
    g.box((0.06, 1.2, 0.3), (-0.42, 0, 1.08), glass, rot=(0, -35, 0))
    g.box((1.62, 1.4, 0.07), (0.25, 0, 1.38), paint_d, taper=(0.75, 0.86))
    g.box((0.9, 1.2, 0.06), (-1.05, 0.05, 0.92), paint_d, rot=(0, 18, 4))  # капот приоткрыт
    for x, y, s in ((-0.4, -0.76, (0.6, 0.02, 0.28)), (0.9, 0.76, (0.5, 0.02, 0.3)), (1.2, -0.76, (0.4, 0.02, 0.2))):
        g.box(s, (x, y, 0.62), rust)
    g.box((0.6, 0.5, 0.03), (0.9, 0.2, 0.89), rust)
    g.box((0.06, 1.52, 0.12), (-1.52, 0, 0.42), chrome)
    g.box((0.06, 1.52, 0.12), (1.52, 0, 0.42), chrome)
    for y in (-0.5, 0.5):
        g.box((0.04, 0.22, 0.12), (-1.52, y, 0.68), light)
    for x, y, z in ((-1.0, -0.72, 0.33), (-1.0, 0.72, 0.33), (1.0, -0.72, 0.3), (1.0, 0.72, 0.22)):
        g.cyl(0.33, 0.24, (x, y - 0.12 * (1 if y < 0 else -1) * 0 , z), tire, seg=8, rot=(90, 0, 0), scale=(1, 1, 1))
    g.xform(T((0, 0, 0), (2, 0, 0)))
    g.obj('Mesh', root)
    return root


def hay_bale():
    root = empty('hay_bale')
    hay, hay_l, twine = M('#d4b25c', 0.95, name='hay'), M('#e3c77a', 0.95, name='hay_light'), M('#8a6a3a', 0.9, name='twine')
    g = G()
    g.cyl(0.55, 1.1, (-0.55, 0, 0.55), hay, seg=10, rot=(0, 90, 0))
    for x in (-0.25, 0.25):
        g.cyl(0.555, 0.04, (x, 0, 0.55), twine, seg=10, rot=(0, 90, 0))
    for sx in (-1, 1):
        g.cyl(0.36, 0.02, (sx * 0.55 + (0 if sx > 0 else -0.02), 0, 0.55), hay_l, seg=8, rot=(0, 90, 0))
    g.obj('Mesh', root)
    return root


def crate():
    root = empty('crate')
    wood, frame = M('#a8794a', 0.85, name='crate_wood'), M('#7a5432', 0.85, name='crate_frame')
    g = G()
    s = 0.8
    g.box((s, s, s), (0, 0, s / 2), wood)
    e, w = 0.07, s + 0.02
    for a in (-1, 1):
        for b in (-1, 1):
            g.box((e, e, w), (a * s / 2, b * s / 2, s / 2), frame)
            g.box((w, e, e), (0, a * s / 2, s / 2 + b * s / 2), frame)
            g.box((e, w, e), (a * s / 2, 0, s / 2 + b * s / 2), frame)
    g.box((0.06, 0.02, 1.05), (0, -s / 2 - 0.01, s / 2), frame, rot=(0, 45, 0))
    g.box((0.02, 0.06, 1.05), (s / 2 + 0.01, 0, s / 2), frame, rot=(45, 0, 0))
    g.obj('Mesh', root)
    return root


def fence():
    root = empty('fence')
    post, rail, rail_l = M('#7c6146', 0.9, name='fence_post'), M('#937554', 0.9, name='fence_rail'), M('#a5876a', 0.9, name='fence_rail_light')
    g = G()
    for x, t in ((-0.95, 3), (0.0, -2), (0.95, 4)):
        g.box((0.1, 0.1, 1.15), (x, 0, 0.55), post, rot=(0, t, 0))
    g.box((2.05, 0.05, 0.12), (0, -0.07, 0.85), rail, rot=(0, 1.5, 0))
    g.box((1.0, 0.05, 0.12), (-0.48, -0.07, 0.45), rail_l, rot=(0, -2, 0))
    g.box((0.9, 0.05, 0.12), (0.5, -0.07, 0.3), rail_l, rot=(0, 18, 0))  # сломанная доска
    g.obj('Mesh', root)
    return root


def barrel_rusty():
    root = empty('barrel_rusty')
    rust, rust_d, top = M('#8a4f2d', 0.85, 0.1, name='barrel_rust'), M('#6a3a22', 0.85, 0.1, name='barrel_rust_dark'), M('#4e4a44', 0.7, 0.2, name='barrel_lid')
    g = G()
    g.cyl(0.28, 0.86, (0, 0, 0), rust, seg=10)
    for z in (0.2, 0.62):
        g.cyl(0.29, 0.04, (0, 0, z), rust_d, seg=10)
    g.cyl(0.24, 0.015, (0, 0, 0.86), top, seg=10)
    g.cyl(0.04, 0.03, (0.13, 0.05, 0.87), top, seg=6)
    rng = random.Random(2)
    for x in g.since(0):
        if 0.3 < x.co.z < 0.6:
            x.co.x *= 1 + rng.uniform(-0.05, 0.03)
            x.co.y *= 1 + rng.uniform(-0.05, 0.03)
    g.xform(T((0, 0, 0), (2, -3, 0)))
    g.obj('Mesh', root)
    return root


def tires():
    root = empty('tires')
    tire, rim = M('#26272b', 0.9, name='tire'), M('#5b5f63', 0.6, 0.2, name='tire_rim')
    g = G()
    for i, (x, y, rz) in enumerate(((0, 0, 0), (0.05, -0.04, 10), (-0.03, 0.04, 25))):
        g.torus(0.3, 0.12, (x, y, 0.12 + i * 0.235), tire, seg=10, sides=5, rot=(0, (3, -4, 5)[i], rz), scale=(1, 1, 0.95))
    g.torus(0.32, 0.12, (0.65, 0.1, 0.3), tire, seg=10, sides=5, rot=(80, 0, 30))  # одна прислонена
    g.obj('Mesh', root)
    return root


BUILDERS = {n: globals()[n] for n in CHARS + GUNS + BUILDS + PROPS}


# ================= ЭКСПОРТ =================
def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()


def tri_count(root):
    t = 0
    for o in [root] + list(root.children_recursive):
        if o.type == 'MESH':
            t += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return t


def export_glb(name):
    fresh()
    root = BUILDERS[name]()
    objs = [root] + list(root.children_recursive)
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = root
    path = os.path.join(MODELS, name + '.glb')
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
              export_cameras=False, export_lights=False, export_animations=False, export_extras=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        for k in ('export_animations', 'export_extras'):
            kw.pop(k)
        bpy.ops.export_scene.gltf(**kw)
    t = tri_count(root)
    parts = ', '.join(f'{o.name}' + (f'<{o.parent.name}' if o.parent and o.parent != root else '') for o in root.children_recursive)
    log(f'model {name}: {t} tris | {parts}')
    return t


# ================= ТЕКСТУРЫ =================
def pnoise(n, freq, seed):
    rng = np.random.default_rng(seed)
    F = np.fft.fft2(rng.standard_normal((n, n)))
    f = np.fft.fftfreq(n) * n
    k = np.sqrt(f[:, None] ** 2 + f[None, :] ** 2)
    filt = np.exp(-(k / freq) ** 2)
    filt[0, 0] = 0
    out = np.real(np.fft.ifft2(F * filt))
    return (out - out.mean()) / (out.std() + 1e-9)


def srgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def save_img(arr, path, fmt):
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1), np.float32)], axis=2)
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=(fmt == 'PNG'))
    img.pixels.foreach_set(np.ascontiguousarray(np.flipud(np.clip(arr, 0, 1))).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = fmt
    try:
        img.save(quality=90) if fmt == 'JPEG' else img.save()
    except TypeError:
        img.save()
    bpy.data.images.remove(img)
    log('image', os.path.relpath(path, ROOT))


def stamp_strokes(acc, wsum, n, xs, ys, angles, lengths, colors, alpha):
    """Короткие штрихи (травинки), с заворотом за край — плитка остаётся бесшовной."""
    for t in np.linspace(0, 1, 7):
        px = (xs + np.sin(angles) * lengths * t).astype(int) % n
        py = (ys - np.cos(angles) * lengths * t).astype(int) % n
        a = alpha * (1 - 0.5 * t)
        np.add.at(acc, (py, px), colors * a[:, None])
        np.add.at(wsum, (py, px), a)


def tex_grass():
    n = 1024
    big, mid, fine = pnoise(n, 3.5, 1), pnoise(n, 14, 2), pnoise(n, 90, 3)
    v = 0.6 * big + 0.3 * mid + 0.12 * fine
    t = smoothstep(-1.6, 1.6, v)[..., None]
    img = srgb('#647d45') * (1 - t) + srgb('#7f9a55') * t
    dry = smoothstep(0.9, 1.8, pnoise(n, 5, 4))[..., None] * 0.55
    img = img * (1 - dry) + srgb('#93965a') * dry
    rng = np.random.default_rng(5)
    acc = np.zeros((n, n, 3), np.float32)
    ws = np.zeros((n, n), np.float32)
    cnt = 9000
    xs, ys = rng.uniform(0, n, cnt), rng.uniform(0, n, cnt)
    base = img[ys.astype(int), xs.astype(int)]
    light = rng.random(cnt) < 0.5
    cols = np.where(light[:, None], base * 1.18 + 0.02, base * 0.78)
    for k in range(3):
        stamp_strokes(acc, ws, n, xs + rng.uniform(-3, 3, cnt), ys, rng.uniform(-0.6, 0.6, cnt), rng.uniform(6, 13, cnt), cols, np.full(cnt, 0.55, np.float32))
    a = np.clip(ws, 0, 1)[..., None]
    img = img * (1 - a) + (acc / np.maximum(ws, 1e-6)[..., None]) * a
    for col, cnt in (('#e6e2c8', 140), ('#e8c75a', 110)):
        xs, ys = rng.integers(0, n, cnt), rng.integers(0, n, cnt)
        for dx in (0, 1):
            for dy in (0, 1):
                img[(ys + dy) % n, (xs + dx) % n] = img[(ys + dy) % n, (xs + dx) % n] * 0.35 + srgb(col) * 0.65
    save_img(img, os.path.join(TEX, 'ground_grass.jpg'), 'JPEG')


def tex_dirt():
    n = 1024
    big, mid, fine = pnoise(n, 3, 11), pnoise(n, 16, 12), pnoise(n, 140, 13)
    v = 0.55 * big + 0.3 * mid + 0.15 * fine
    t = smoothstep(-1.7, 1.7, v)[..., None]
    img = srgb('#76593d') * (1 - t) + srgb('#957554') * t
    wet = smoothstep(0.8, 1.8, pnoise(n, 6, 14))[..., None] * 0.4
    img = img * (1 - wet) + srgb('#5e4630') * wet
    rng = np.random.default_rng(15)
    yy, xx = np.mgrid[-7:8, -7:8]
    for i in range(650):
        cx, cy = rng.integers(0, n), rng.integers(0, n)
        r = rng.uniform(1.5, 4.5)
        e = rng.uniform(0.6, 1.0)
        d = np.sqrt((xx / r) ** 2 + (yy / (r * e)) ** 2)
        body = smoothstep(1.05, 0.8, d)
        shade = smoothstep(1.3, 0.9, np.sqrt((xx / r) ** 2 + ((yy - r * 0.45) / (r * e)) ** 2)) * (1 - body)
        hi = smoothstep(0.7, 0.1, np.sqrt(((xx + r * 0.25) / r) ** 2 + ((yy + r * 0.3) / (r * e)) ** 2)) * body
        col = srgb(('#937b5c', '#86735e', '#9c8566')[i % 3]) * rng.uniform(0.92, 1.03)
        ix, iy = (xx + cx) % n, (yy + cy) % n
        patch = img[iy, ix]
        patch = patch * (1 - shade[..., None] * 0.22)
        patch = patch * (1 - body[..., None]) + col * body[..., None]
        patch = patch + hi[..., None] * 0.06
        img[iy, ix] = patch
    save_img(img, os.path.join(TEX, 'ground_dirt.jpg'), 'JPEG')


def ang_noise(theta, seed, harmonics, falloff=1.0):
    rng = np.random.default_rng(seed)
    out = np.zeros_like(theta)
    for k in range(1, harmonics + 1):
        out += rng.standard_normal() * np.cos(k * theta + rng.uniform(0, 6.28)) / k ** falloff
    return out


def tex_goo():
    n = 256
    yy, xx = (np.mgrid[0:n, 0:n] + 0.5) / n - 0.5
    r, th = np.sqrt(xx ** 2 + yy ** 2), np.arctan2(yy, xx)
    R = 0.27 + 0.035 * ang_noise(th, 21, 9, 0.8)
    mask = smoothstep(R + 0.012, R - 0.012, r)
    rng = np.random.default_rng(22)
    for i in range(16):
        a, d, s = rng.uniform(0, 6.28), rng.uniform(0.3, 0.45), rng.uniform(0.012, 0.035)
        cx, cy = math.cos(a) * d, math.sin(a) * d
        e = np.sqrt(((xx - cx) * math.cos(a) + (yy - cy) * math.sin(a)) ** 2 / 2.2 + (-(xx - cx) * math.sin(a) + (yy - cy) * math.cos(a)) ** 2)
        mask = np.maximum(mask, smoothstep(s + 0.008, s - 0.006, e))
    for i in range(0):
        a = rng.uniform(0, 6.28)
        along = xx * math.cos(a) + yy * math.sin(a)
        across = -xx * math.sin(a) + yy * math.cos(a)
        w = 0.025 * (1 - smoothstep(0.15, 0.4, along))
        mask = np.maximum(mask, smoothstep(w + 0.006, w - 0.004, np.abs(across)) * (along > 0) * smoothstep(0.42, 0.36, along))
    nz = pnoise(n, 12, 23)
    base = srgb('#3d3f1c') * (1 - smoothstep(-1, 1, nz)[..., None] * 0.3)
    center = smoothstep(0.25, 0.0, r)[..., None]
    col = base * (1 - center * 0.35) + srgb('#2a2b12') * center * 0.35
    gloss = smoothstep(1.2, 2.0, pnoise(n, 20, 24))[..., None] * mask[..., None]
    col = col + gloss * (srgb('#6c6e33') - col) * 0.7
    alpha = mask * (0.82 + 0.1 * smoothstep(-1, 1, nz))
    save_img(np.concatenate([col, alpha[..., None]], axis=2), os.path.join(TEX, 'goo.png'), 'PNG')


def tex_scorch():
    n = 256
    yy, xx = (np.mgrid[0:n, 0:n] + 0.5) / n - 0.5
    r, th = np.sqrt(xx ** 2 + yy ** 2), np.arctan2(yy, xx)
    R = 0.33 + 0.035 * ang_noise(th, 31, 10, 0.9) + 0.012 * np.clip(ang_noise(th, 33, 30, 0.5), -2, 2)
    core = 1 - smoothstep(0.0, R, r)
    nz = smoothstep(-1.5, 1.5, pnoise(n, 10, 32))
    alpha = np.clip(smoothstep(0.0, 0.45, core) * (0.84 + 0.12 * nz), 0, 0.93) * smoothstep(0.5, 0.42, r)
    edge = smoothstep(0.05, 1.0, r / R)[..., None]
    col = srgb('#120f0c') * (1 - edge) + srgb('#3a2a1c') * edge
    col = col * (0.85 + 0.3 * nz[..., None])
    save_img(np.concatenate([col, alpha[..., None]], axis=2), os.path.join(TEX, 'scorch.png'), 'PNG')


# ================= СЦЕНЫ ДЛЯ КАРТИНОК =================
def setup_render(w, h, samples, transparent=False, view='Standard', look=None):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.use_adaptive_sampling = True
    except AttributeError:
        pass
    sc.render.film_transparent = transparent
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = view
    if look:
        try:
            sc.view_settings.look = look
        except TypeError:
            pass
    return sc


def world(color, strength):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('w')
    sc.world = w
    try:
        w.use_nodes = True
    except AttributeError:
        pass
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*hexc(color), 1)
    bg.inputs['Strength'].default_value = strength
    return w


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def camera(loc, target, lens=50, ortho=None):
    cam = bpy.data.cameras.new('cam')
    if ortho:
        cam.type = 'ORTHO'
        cam.ortho_scale = ortho
    else:
        cam.lens = lens
    cam.clip_end = 500
    co = bpy.data.objects.new('cam', cam)
    bpy.context.scene.collection.objects.link(co)
    co.location = loc
    look_at(co, target)
    bpy.context.scene.camera = co
    return co


def sun(name, energy, color, direction, angle=6, shadow=True, coll=None):
    L = bpy.data.lights.new(name, 'SUN')
    L.energy, L.color, L.angle = energy, hexc(color), rad(angle)
    L.use_shadow = shadow
    o = bpy.data.objects.new(name, L)
    (coll or bpy.context.scene.collection).objects.link(o)
    o.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()  # −Z солнца — куда идёт свет
    return o


def point(name, loc, power, color, radius=0.1, coll=None, kind='POINT'):
    L = bpy.data.lights.new(name, kind)
    L.energy, L.color = power, hexc(color)
    L.shadow_soft_size = radius
    o = bpy.data.objects.new(name, L)
    (coll or bpy.context.scene.collection).objects.link(o)
    o.location = loc
    return o


def ground_mat(dirt_center=None, dirt_radius=4.0):
    m = bpy.data.materials.new('ground')
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    n, l = nt.nodes, nt.links
    p = n['Principled BSDF']
    p.inputs['Roughness'].default_value = 1.0
    tc = n.new('ShaderNodeTexCoord')
    mp = n.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (0.125, 0.125, 1)
    l.new(tc.outputs['Object'], mp.inputs['Vector'])

    def img(name):
        t = n.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(TEX, name), check_existing=True)
        l.new(mp.outputs['Vector'], t.inputs['Vector'])
        return t
    grass = img('ground_grass.jpg')
    if dirt_center is None:
        l.new(grass.outputs['Color'], p.inputs['Base Color'])
        return m
    dirt = img('ground_dirt.jpg')
    mp2 = n.new('ShaderNodeMapping')
    mp2.inputs['Location'].default_value = (-dirt_center[0] / dirt_radius, -dirt_center[1] / dirt_radius, 0)
    mp2.inputs['Scale'].default_value = (1 / dirt_radius, 1 / dirt_radius, 1)
    l.new(tc.outputs['Object'], mp2.inputs['Vector'])
    grad = n.new('ShaderNodeTexGradient')
    grad.gradient_type = 'SPHERICAL'
    l.new(mp2.outputs['Vector'], grad.inputs['Vector'])
    noise = n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 0.6
    l.new(tc.outputs['Object'], noise.inputs['Vector'])
    add = n.new('ShaderNodeMath')
    add.operation = 'MULTIPLY_ADD'
    add.inputs[1].default_value = 0.35
    l.new(noise.outputs['Fac'], add.inputs[0])
    l.new(grad.outputs['Fac'], add.inputs[2])
    ramp = n.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.42
    ramp.color_ramp.elements[1].position = 0.55
    l.new(add.outputs[0], ramp.inputs['Fac'])
    mix = n.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    l.new(ramp.outputs['Color'], mix.inputs['Factor'])
    l.new(grass.outputs['Color'], mix.inputs['A'])
    l.new(dirt.outputs['Color'], mix.inputs['B'])
    l.new(mix.outputs['Result'], p.inputs['Base Color'])
    return m


def ground(size=80, center=(0, 0), **kw):
    me = bpy.data.meshes.new('ground')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('ground', me)
    bpy.context.scene.collection.objects.link(o)
    o.location = (center[0], center[1], 0)
    me.materials.append(ground_mat(**kw))
    return o


def decal(texname, loc, size, rot=0):
    me = bpy.data.meshes.new('decal')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2, calc_uvs=True)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('decal', me)
    bpy.context.scene.collection.objects.link(o)
    o.location = (loc[0], loc[1], 0.01)
    o.rotation_euler = (0, 0, rad(rot))
    m = bpy.data.materials.new('decal_' + texname)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    n, l = m.node_tree.nodes, m.node_tree.links
    p = n['Principled BSDF']
    t = n.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(os.path.join(TEX, texname), check_existing=True)
    l.new(t.outputs['Color'], p.inputs['Base Color'])
    l.new(t.outputs['Alpha'], p.inputs['Alpha'])
    p.inputs['Roughness'].default_value = 0.4
    me.materials.append(m)
    return o


def place(name, loc=(0, 0, 0), rz=0, scale=1.0):
    root = BUILDERS[name]()
    root.location = loc
    root.rotation_euler = (0, 0, rad(rz))
    root.scale = (scale,) * 3
    return root


def part(root, name):
    for o in root.children_recursive:
        if o.name.split('.')[0] == name:
            return o


def flash(loc, size=0.25, power=60, color='#ffb347'):
    g = G()
    m = M('#ffd27a', 0.5, emit=40, name='muzzle_flash')
    for rot in ((0, 0, 0), (90, 0, 0), (0, 90, 0)):
        g.sph(size, (0, 0, 0), m, scale=(1, 0.25, 0.25), seg=6, rings=4, rot=rot)
    o = g.obj('flash', None, loc)
    point('flash_light', loc, power, color, 0.05)
    return o


def tracer(a, b, width=0.018):
    a, b = Vector(a), Vector(b)
    d = b - a
    g = G()
    g.cyl(width, d.length, (0, 0, 0), M('#ffe6a0', 0.5, emit=25, name='tracer'), seg=4)
    o = g.obj('tracer', None, a)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return o


def render_to(path, fmt='PNG', color='RGBA', quality=92):
    sc = bpy.context.scene
    st = sc.render.image_settings
    st.file_format = fmt
    st.color_mode = color
    if fmt == 'JPEG':
        st.quality = quality
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    log(f'render {os.path.relpath(path, ROOT)} {time.time() - t:.0f} s')


def mesh_bounds_cam(objs, cam):
    """Границы сеток в осях камеры (x, y — в плоскости кадра)."""
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            pts.append(inv @ (mw @ v.co))
    xs, ys = [p.x for p in pts], [p.y for p in pts]
    return min(xs), max(xs), min(ys), max(ys)


def fit_ortho(cam, objs, margin=1.12):
    x0, x1, y0, y1 = mesh_bounds_cam(objs, cam)
    cam.data.ortho_scale = max(x1 - x0, y1 - y0) * margin
    cam.data.shift_x = (x0 + x1) / 2 / cam.data.ortho_scale
    cam.data.shift_y = (y0 + y1) / 2 / cam.data.ortho_scale


def studio_lights():
    world('#5a6070', 0.55)
    sun('key', 3.4, '#fff1dc', (-0.5, -0.8, -0.9), angle=10)
    sun('fill', 0.9, '#c8d8ff', (0.8, -0.3, -0.4), angle=20, shadow=False)
    sun('rim', 1.6, '#ffe2c0', (0.3, 1.0, -0.5), angle=10, shadow=False)


# ---------- значки интерфейса ----------
ICONS = {'icon_barricade': 'barricade', 'icon_wall': 'wall', 'icon_spikes': 'spikes', 'icon_turret': 'turret',
         'icon_mine': 'mine', 'icon_pistol': 'gun_pistol', 'icon_shotgun': 'gun_shotgun', 'icon_rifle': 'gun_rifle',
         'icon_house': 'house'}


def render_icon(icon, model):
    fresh()
    setup_render(256, 256, 64, transparent=True)
    studio_lights()
    gun = model.startswith('gun_')
    root = place(model, rz=90 if gun else 0)  # ствол вправо
    objs = list(root.children_recursive)
    d = Vector((-0.25, -1, 0.42)) if gun else Vector((-0.75, -1, 0.95))
    cam = camera(d.normalized() * 30, (0, 0, 0), ortho=3)
    fit_ortho(cam, objs, 1.08 if gun else 1.1)
    render_to(os.path.join(UI, icon + '.png'))


# ---------- контрольный лист ----------
def sheet_layout():
    rows = [
        (0.0, ['survivor', 'zombie_walker', 'zombie_runner', 'zombie_brute', 'zombie_spitter', 'zombie_boss', 'gun_pistol', 'gun_shotgun', 'gun_rifle']),
        (4.2, ['barricade', 'wall', 'spikes', 'turret', 'mine', 'house', 'lamp_post']),
        (9.0, ['tree_pine', 'tree_dead', 'rock_a', 'rock_b', 'car_wreck', 'hay_bale', 'crate', 'fence', 'barrel_rusty', 'tires'])]
    width = {'survivor': 0.9, 'zombie_walker': 0.9, 'zombie_runner': 0.9, 'zombie_brute': 1.6, 'zombie_spitter': 1.0,
             'zombie_boss': 2.3, 'gun_pistol': 0.7, 'gun_shotgun': 2.4, 'gun_rifle': 2.0, 'barricade': 1, 'wall': 1,
             'spikes': 1, 'turret': 1, 'mine': 1, 'house': 3, 'lamp_post': 1, 'tree_pine': 2.4, 'tree_dead': 2,
             'rock_a': 1.3, 'rock_b': 1.4, 'car_wreck': 3.1, 'hay_bale': 1.2, 'crate': 0.9, 'fence': 2.1,
             'barrel_rusty': 0.7, 'tires': 1.2}
    out = []
    for y, names in rows:
        gap = 0.7
        total = sum(width[n] for n in names) + gap * (len(names) - 1)
        x = -total / 2
        for nm in names:
            out.append((nm, x + width[nm] / 2, y))
            x += width[nm] + gap
    return out


def render_sheet():
    fresh()
    os.makedirs(TMP, exist_ok=True)
    W, H = 1800, 900
    sc = setup_render(W, H, 48)
    ground(80, center=(0, 5))
    lamps = []
    for nm, x, y in sheet_layout():
        if nm.startswith('gun_'):
            place(nm, (x, y, 0.55), rz=90, scale=3)
        else:
            place(nm, (x, y, 0))
    # камера игры: 50° вниз, узкий угол
    tgt = Vector((0, 4.8, 0.6))
    pitch = rad(50)
    dist = 44
    cam = camera(tgt + Vector((0, -math.cos(pitch), math.sin(pitch))) * dist, tgt, lens=62)
    day = bpy.data.collections.new('day')
    night = bpy.data.collections.new('night')
    sc.collection.children.link(day)
    sc.collection.children.link(night)
    sun('sun', 3.6, '#ffd6a0', (0.55, 0.75, -0.55), angle=4, coll=day)
    sun('sky', 0.6, '#b9cce8', (-0.4, -0.2, -1), angle=40, shadow=False, coll=day)
    sun('moon', 0.7, '#7d98ff', (-0.4, 0.6, -0.7), angle=3, coll=night)
    for x, y in ((-6, 1.5), (0, 1.5), (6, 1.5), (-5, 6.5), (2, 6.5), (-8, 11), (0, 11), (8, 11)):
        point('lamp', (x, y, 3.0), 160, '#ffc580', 0.15, coll=night)
    res = {}
    for phase, wc, ws in (('day', '#c9c4b8', 0.55), ('night', '#1b2440', 0.25)):
        world(wc, ws)
        day.hide_render = phase != 'day'
        night.hide_render = phase != 'night'
        path = os.path.join(TMP, f'sheet_{phase}.png')
        render_to(path, color='RGB')
        res[phase] = path
    imgs = []
    for k in ('day', 'night'):
        im = bpy.data.images.load(res[k])
        a = np.array(im.pixels[:], dtype=np.float32).reshape(im.size[1], im.size[0], 4)
        imgs.append(np.flipud(a)[..., :3])
    sep = np.ones((6, W, 3), np.float32) * 0.1
    save_img(np.concatenate([imgs[0], sep, imgs[1]], axis=0), os.path.join(UI, 'contact_sheet.png'), 'PNG')


# ---------- обложка ----------
def night_scene(survivor_pose=True):
    """Ночная сцена для обложки: дом, барикады, турель, игрок стреляет, толпа слева."""
    world('#141c36', 0.32)
    ground(90, center=(0, 2), dirt_center=(0.5, 3.5), dirt_radius=5.5)
    place('house', (0.5, 4.2, 0))
    place('lamp_post', (3.4, 1.4, 0), rz=-120)
    point('lamp', (3.4 - 0.48 * math.sin(rad(-120)) * -1, 1.4 - 0.48 * math.cos(rad(-120)), 2.6), 650, '#ffbe73', 0.2)
    point('window', (-0.2, 2.6, 1.2), 90, '#ffa84a', 0.4)
    for x, y, rz in ((-2.6, 2.6, 75), (-2.9, 1.5, 85), (-2.9, 0.4, 95), (-2.6, -0.7, 110), (-1.9, -1.6, 135)):
        place('barricade', (x, y, 0), rz=rz)
    place('wall', (-2.4, 3.7, 0), rz=70)
    place('spikes', (-4.0, 1.0, 0))
    place('spikes', (-4.0, -0.1, 0))
    tur = place('turret', (-1.5, 3.0, 0), rz=-90 + 15)
    place('mine', (-5.2, 2.6, 0))
    place('crate', (2.4, 2.0, 0), rz=12)
    place('hay_bale', (-0.6, 6.6, 0), rz=10)
    place('fence', (3.5, 5.6, 0), rz=80)
    place('fence', (3.7, 7.6, 0), rz=95)
    place('car_wreck', (6.5, 4.6, 0), rz=-25)
    place('barrel_rusty', (5.0, 2.4, 0))
    place('tires', (4.6, 3.4, 0))
    for x, y, s in ((-3.5, 9.0, 1.1), (-1.0, 10.0, 1.25), (2.5, 9.6, 1.0), (5.0, 9.2, 1.2), (8.5, 8.0, 1.1), (-6.5, 8.0, 1.0), (10, 3, 1.2)):
        place('tree_pine', (x, y, 0), rz=x * 40, scale=s)
    place('tree_dead', (-8.5, 3.5, 0), rz=30, scale=1.2)
    place('rock_a', (-7.0, 0.0, 0), rz=40)
    place('rock_b', (2.0, -3.5, 0), rz=10)
    # игрок за баррикадами, целится влево
    sv = place('survivor', (-1.1, 0.6, 0), rz=-90 + 8)
    gun = BUILDERS['gun_rifle']()
    hand = part(sv, 'Hand')
    gun.parent = hand
    bpy.context.view_layer.update()
    mz = part(gun, 'Muzzle').matrix_world.translation.copy()
    flash(mz, 0.28, 140)
    tracer(mz + Vector((-0.4, 0.05, 0)), mz + Vector((-2.4, 0.3, -0.25)))
    tmz = part(tur, 'Muzzle').matrix_world.translation.copy()
    flash(tmz, 0.24, 110)
    tracer(tmz + Vector((-0.4, -0.05, 0)), tmz + Vector((-2.6, -0.9, -0.2)))
    # фонарик игрока
    fl = point('flashlight', sv.location + Vector((-0.4, 0.0, 1.4)), 900, '#e8f0ff', 0.05, kind='SPOT')
    fl.data.spot_size = rad(38)
    fl.data.spot_blend = 0.6
    look_at(fl, (-6.5, 0.8, 0.4))
    # толпа
    rng = random.Random(42)
    crowd = [('zombie_walker', -5.0, 0.4), ('zombie_runner', -4.6, -1.4), ('zombie_walker', -5.6, 2.0), ('zombie_spitter', -6.3, -0.6),
             ('zombie_brute', -7.1, 1.4), ('zombie_walker', -6.6, -2.4), ('zombie_runner', -7.6, -0.9), ('zombie_walker', -8.0, 3.0),
             ('zombie_boss', -9.4, 0.6), ('zombie_walker', -8.6, -2.6), ('zombie_spitter', -9.0, 2.9), ('zombie_walker', -10.5, -1.6),
             ('zombie_runner', -10.8, 2.2), ('zombie_walker', -11.6, 0.0), ('zombie_brute', -12.0, -3.0), ('zombie_walker', -12.5, 3.5)]
    for nm, x, y in crowd:
        z = place(nm, (x, y, 0), rz=90 + rng.uniform(-25, 25))
        for an in ('ArmL', 'ArmR'):
            a = part(z, an)
            a.rotation_euler = (rad(rng.uniform(-18, 18)), 0, 0)
        hd = part(z, 'Head')
        hd.rotation_euler = (0, rad(rng.uniform(-10, 10)), rad(rng.uniform(-15, 15)))
        for ln, sgn in (('LegL', 1), ('LegR', -1)):
            part(z, ln).rotation_euler = (rad(sgn * rng.uniform(8, 22)), 0, 0)
    decal('goo.png', (-4.4, 0.2), 1.3, 30)
    decal('goo.png', (-4.9, -1.2), 0.9, 120)
    decal('scorch.png', (-5.5, 3.2), 2.0, 0)
    sun('moon', 0.6, '#7d98ff', (0.6, -0.5, -0.6), angle=3)
    sun('moon_rim', 0.5, '#9db4ff', (0.3, 0.9, -0.4), angle=3, shadow=False)


def render_cover():
    fresh()
    os.makedirs(TMP, exist_ok=True)
    setup_render(1280, 720, 160, view='AgX', look='AgX - Medium High Contrast')
    night_scene()
    camera((3.2, -9.6, 7.2), (-3.0, 1.6, 0.9), lens=38)
    raw = os.path.join(TMP, 'cover.png')
    render_to(raw, color='RGB')
    im = bpy.data.images.load(raw)
    a = np.flipud(np.array(im.pixels[:], dtype=np.float32).reshape(720, 1280, 4))[..., :3]
    save_img(a, os.path.join(CATALOG, 'cover.jpg'), 'JPEG')
    # og: та же картинка, обрезка до 1200:630
    h = round(1280 * 630 / 1200)
    y0 = (720 - h) // 2 + 6
    crop = a[y0:y0 + h]
    img = bpy.data.images.new('og', 1280, h)
    img.pixels.foreach_set(np.ascontiguousarray(np.flipud(np.concatenate([crop, np.ones((h, 1280, 1), np.float32)], axis=2))).ravel())
    img.scale(1200, 630)
    b = np.flipud(np.array(img.pixels[:], dtype=np.float32).reshape(630, 1200, 4))[..., :3]
    save_img(b, os.path.join(CATALOG, 'og.jpg'), 'JPEG')


def render_catalog_icon():
    """Иконка 512: громила под фонарём, крупно, читается в 64 px."""
    fresh()
    setup_render(512, 512, 160, view='AgX', look='AgX - Medium High Contrast')
    world('#0f1630', 0.35)
    ground(30, center=(0, 0))
    br = place('zombie_brute', (0, 0, 0), rz=-12)
    for an, r in (('ArmL', -55), ('ArmR', -70)):
        part(br, an).rotation_euler = (rad(r), 0, 0)
    part(br, 'Head').rotation_euler = (rad(-8), 0, 0)
    place('barricade', (0.2, -1.1, 0), rz=4)
    place('zombie_walker', (1.5, 0.9, 0), rz=-30)
    place('zombie_runner', (-1.4, 1.3, 0), rz=20)
    point('lamp', (-1.3, -1.6, 2.9), 500, '#ffb860', 0.15)
    point('fill', (1.8, -1.2, 1.6), 60, '#88a8ff', 0.4)
    sun('moon', 0.8, '#8aa2ff', (0.4, 0.8, -0.5), angle=3, shadow=False)
    camera((0.25, -3.6, 2.0), (0.1, 0, 1.7), lens=42)
    raw = os.path.join(TMP, 'icon.png')
    os.makedirs(TMP, exist_ok=True)
    render_to(raw, color='RGB')
    im = bpy.data.images.load(raw)
    a = np.flipud(np.array(im.pixels[:], dtype=np.float32).reshape(512, 512, 4))[..., :3]
    save_img(a, os.path.join(CATALOG, 'icon.jpg'), 'JPEG')


# ================= ЗАПУСК =================
counts = {}
for nm in CHARS + GUNS + BUILDS + PROPS:
    if want('models', nm):
        counts[nm] = export_glb(nm)
if counts:
    log('triangles:', ', '.join(f'{k}={v}' for k, v in counts.items()))

for nm, fn in (('ground_grass', tex_grass), ('ground_dirt', tex_dirt), ('goo', tex_goo), ('scorch', tex_scorch)):
    if want('textures', nm):
        fresh()
        fn()

for icon, model in ICONS.items():
    if want('icons', icon):
        render_icon(icon, model)

if want('sheet'):
    render_sheet()
if want('cover'):
    render_cover()
if want('catalog_icon'):
    render_catalog_icon()
log('done')
