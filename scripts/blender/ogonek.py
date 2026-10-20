# Спрайты игры «Огонёк» в 2.5D. Всё снято одной ортографической камерой под углом 45° от вертикали,
# под каждым предметом — ловец теней, поэтому в игре фигуры стоят на земле и отбрасывают мягкие тени.
# Точка опоры (x=0, y=0, z=0) в кадре всегда в одном месте: по центру и на 0.5 + 0.28·sin45° высоты сверху.
# Огонёк, снаряды и свет рисуются в самой игре — их не рендерим.
#
#   blender --background --factory-startup --python scripts/blender/ogonek.py -- public/games/ogonek/img [имена…]
#
# Имена: shade_* bat_* ghost golem boss tree_* stump rock shroom lantern chest gem gemb coal ground
import bpy, bmesh, math, os, sys, time, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else '.')
ONLY = set(argv[1:])
os.makedirs(OUT, exist_ok=True)
rad = math.radians
TILT = 45  # угол камеры от вертикали; в игре TILT = cos(45°)


def hexc(h):
    h = h.lstrip('#')
    s = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in s)


def reset(px, scale, catcher=True, samples=48):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = px
    sc.view_settings.view_transform = 'Standard'
    st = sc.render.image_settings
    st.file_format, st.color_mode, st.quality = 'WEBP', 'RGBA', 92
    w = bpy.data.worlds.new('w')
    sc.world = w
    try:
        w.use_nodes = True
    except AttributeError:
        pass
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.38, 0.5, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = scale
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    a = rad(TILT)
    target = Vector((0, 0, scale * 0.28))
    co.location = target + Vector((0, -math.sin(a), math.cos(a))) * 30
    co.rotation_euler = (a, 0, 0)
    sc.camera = co
    # «Луна» почти сверху и слева: тени короткие, падают вправо и помещаются в кадр.
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy, sun.angle = 3.2, rad(25)
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (rad(-10), rad(-24), 0)
    rim = bpy.data.lights.new('rim', 'SUN')
    rim.energy, rim.color = 1.4, (1.0, 0.75, 0.45)
    rim.use_shadow = False  # контровой свет не должен давать вторую тень
    ro = bpy.data.objects.new('rim', rim)
    sc.collection.objects.link(ro)
    ro.rotation_euler = (rad(-60), 0, rad(180))
    if catcher:
        bpy.ops.mesh.primitive_plane_add(size=scale * 3, location=(0, 0, 0))
        bpy.context.active_object.is_shadow_catcher = True
    return sc


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def add(op, **kw):
    getattr(bpy.ops.mesh, op)(**kw)
    return smooth(bpy.context.active_object)


def mat(color, rough=0.6, emit=None, strength=0.0, alpha=1.0, metal=0.0):
    m = bpy.data.materials.new('m')
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1)
        p.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
    return m


def give(ob, m):
    ob.data.materials.clear()
    ob.data.materials.append(m)
    return ob


def sphere(r, loc, m, scale=(1, 1, 1), seg=32):
    ob = add('primitive_uv_sphere_add', segments=seg, ring_count=seg // 2, radius=r, location=loc)
    ob.scale = scale
    return give(ob, m)


def cone(r1, r2, d, loc, m, rot=(0, 0, 0), verts=24):
    ob = add('primitive_cone_add', vertices=verts, radius1=r1, radius2=r2, depth=d, location=loc, rotation=rot)
    return give(ob, m)


def cyl(r, d, loc, m, rot=(0, 0, 0), verts=24):
    ob = add('primitive_cylinder_add', vertices=verts, radius=r, depth=d, location=loc, rotation=rot)
    return give(ob, m)


def box(size, loc, m, bevel=0.03):
    ob = add('primitive_cube_add', size=1, location=loc)
    ob.scale = size
    if bevel:
        b = ob.modifiers.new('b', 'BEVEL')
        b.width, b.segments = bevel, 2
        b.use_clamp_overlap = True
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return give(ob, m)


def displace(ob, strength, size, seed=0):
    tex = bpy.data.textures.new('n', 'CLOUDS')
    tex.noise_scale = size
    tex.noise_depth = 2
    md = ob.modifiers.new('d', 'DISPLACE')
    md.texture = tex
    md.strength = strength
    md.texture_coords = 'OBJECT'
    empty = bpy.data.objects.new('e', None)
    link(empty)
    empty.location = (seed * 3.1, seed * 1.7, seed * 2.3)
    md.texture_coords_object = empty
    return ob


def eyes(z, y, dx, r, color=(1, 0.78, 0.4), strength=2.5):
    m = mat(color, 0.3, emit=color, strength=strength)
    for s in (-1, 1):
        sphere(r, (s * dx, y, z), m)


def render(name):
    sc = bpy.context.scene
    sc.render.filepath = os.path.join(OUT, name)
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'[ogonek] {name}: {time.time() - t:.1f} c', flush=True)


def want(name):
    return not ONLY or name in ONLY or name.split('_')[0] in ONLY


# ---------- враги ----------
def shade(frame):
    m = mat(hexc('#3a2a5e'), 0.8)
    ob = sphere(0.5, (0, 0, 0.42), m, (1, 0.9, 0.9 + 0.08 * frame))
    sub = ob.modifiers.new('s', 'SUBSURF')
    sub.levels = 1
    displace(ob, 0.14, 0.3, seed=frame)
    for i in range(6):
        a = i / 6 * math.pi * 2 + frame * 0.4
        sphere(0.14, (math.cos(a) * 0.42, math.sin(a) * 0.42, 0.08), m, (1, 1, 0.6))
    eyes(0.6 + 0.03 * frame, -0.42, 0.16, 0.07)


for f in range(2):
    if want(f'shade_{f}'):
        reset(128, 1.9)
        shade(f)
        render(f'shade_{f}')

# Летучая мышь и призрак летают: тень под ними рисует игра.
for f in range(2):
    n = f'bat_{f}'
    if not want(n):
        continue
    reset(128, 2.0, catcher=False)
    body = mat(hexc('#4a2f6e'), 0.7)
    wing = mat(hexc('#2c1b45'), 0.8)
    sphere(0.22, (0, 0, 0.75), body, (1, 0.9, 1.1))
    for s in (-1, 1):
        cone(0.08, 0.0, 0.18, (s * 0.12, 0, 1.0), body, rot=(0, rad(-s * 15), 0))
        bm = bmesh.new()
        lift = 0.35 if f == 0 else -0.15
        pts = [(0.12, 0, 0.8), (0.75, 0.1, 0.8 + lift + 0.25), (0.95, 0.0, 0.8 + lift - 0.05), (0.7, 0.0, 0.62 + lift * 0.5), (0.45, 0, 0.66), (0.2, 0, 0.6)]
        vs = [bm.verts.new((s * x, y, z)) for x, y, z in pts]
        bm.faces.new(vs if s > 0 else vs[::-1])
        me = bpy.data.meshes.new('w')
        bm.to_mesh(me)
        w = link(bpy.data.objects.new('w', me))
        give(w, wing)
        sol = w.modifiers.new('t', 'SOLIDIFY')
        sol.thickness = 0.03
    eyes(0.8, -0.2, 0.08, 0.04)
    render(n)

if want('ghost'):
    reset(128, 2.0, catcher=False)
    m = mat(hexc('#9fb2e6'), 0.3, emit=hexc('#7d93d6'), strength=0.5, alpha=0.85)
    sphere(0.42, (0, 0, 0.95), m, (1, 0.9, 1.0))
    tail = cone(0.42, 0.12, 0.8, (0, 0, 0.45), m, rot=(rad(180), 0, 0))
    displace(tail, 0.1, 0.25, seed=3)
    dark = mat((0.05, 0.05, 0.12), 0.4)
    for s in (-1, 1):
        sphere(0.08, (s * 0.15, -0.36, 1.0), dark, (1, 0.6, 1.4))
    sphere(0.07, (0, -0.38, 0.82), dark, (1.2, 0.6, 0.9))
    render('ghost')

if want('golem'):
    reset(160, 2.6)
    stone = mat(hexc('#4b4459'), 0.9)
    moss = mat(hexc('#2f4a33'), 0.9)
    body = sphere(0.62, (0, 0, 0.85), stone, (1.1, 0.9, 1.0), seg=20)
    displace(body, 0.12, 0.5, seed=5)
    head = sphere(0.32, (0, -0.1, 1.55), stone, seg=16)
    displace(head, 0.08, 0.4, seed=6)
    for s in (-1, 1):
        arm = sphere(0.24, (s * 0.78, -0.05, 0.75), stone, (0.9, 0.9, 1.5), seg=14)
        displace(arm, 0.08, 0.4, seed=7 + s)
        sphere(0.2, (s * 0.32, 0, 0.18), stone, (1, 1, 0.8), seg=12)
    sphere(0.3, (0.2, 0.1, 1.25), moss, (1.3, 1, 0.4), seg=12)
    eyes(1.58, -0.38, 0.12, 0.06, color=(1, 0.55, 0.25), strength=4)
    render('golem')

if want('boss'):
    reset(320, 4.0)
    dark = mat(hexc('#1d1230'), 0.7)
    cloak = cone(1.0, 0.35, 2.0, (0, 0, 1.0), dark, verts=40)
    displace(cloak, 0.12, 0.4, seed=11)
    sphere(0.45, (0, 0, 2.15), dark, seg=24)
    horn = mat(hexc('#d9c8b0'), 0.5)
    for s in (-1, 1):
        cone(0.12, 0.0, 0.8, (s * 0.38, 0, 2.6), horn, rot=(0, rad(s * 30), 0))
        cyl(0.11, 1.2, (s * 0.95, -0.1, 1.35), dark, rot=(0, rad(s * 35), 0))
    crown = mat(hexc('#ff4d4d'), 0.3, emit=hexc('#ff2a2a'), strength=4)
    for i in range(5):
        a = math.pi * (0.25 + 0.5 * i / 4)
        cone(0.06, 0.0, 0.3, (math.cos(a) * 0.38, -math.sin(a) * 0.1, 2.55), crown)
    eyes(2.2, -0.4, 0.17, 0.08, color=(1, 0.2, 0.2), strength=8)
    render('boss')

# ---------- лес ----------
def pine(seed, h):
    random.seed(seed)
    bark = mat(hexc('#2b1d14'), 0.9)
    cyl(0.14, h * 0.35, (0, 0, h * 0.17), bark, verts=12)
    greens = ['#1a3a24', '#21452c', '#285233']
    for i in range(4):
        z = h * (0.25 + i * 0.17)
        r = h * (0.36 - i * 0.07)
        c = cone(r, 0.0, h * 0.34, (0, 0, z + h * 0.17), mat(hexc(greens[i % 3]), 0.85), verts=10)
        c.rotation_euler = (0, 0, random.uniform(0, 6.28))
        displace(c, 0.08, 0.3, seed=seed * 10 + i)


def bush(seed):
    random.seed(seed)
    greens = [mat(hexc(c), 0.85) for c in ('#1d3d26', '#24492d', '#2b5634')]
    for i in range(9):
        a = random.uniform(0, 6.28)
        d = random.uniform(0, 0.55)
        r = random.uniform(0.35, 0.55)
        b = sphere(r, (math.cos(a) * d, math.sin(a) * d, r * 0.8 + random.uniform(0, 0.25)), random.choice(greens), seg=16)
        displace(b, 0.1, 0.25, seed=seed * 5 + i)
    berry = mat(hexc('#c23a4a'), 0.4)
    for i in range(7):
        a = random.uniform(0, 6.28)
        sphere(0.05, (math.cos(a) * 0.6, math.sin(a) * 0.5 - 0.15, random.uniform(0.4, 0.9)), berry, seg=8)

for i, (kind, h) in enumerate([('pine', 3.0), ('pine', 3.6), ('bush', 0)]):
    n = f'tree_{i}'
    if not want(n):
        continue
    reset(256, 4.4)
    if kind == 'pine':
        pine(i + 1, h)
    else:
        bush(i)
    render(n)

if want('stump'):
    reset(128, 1.6)
    bark = mat(hexc('#3b2a1e'), 0.9)
    wood = mat(hexc('#9a7346'), 0.7)
    cyl(0.4, 0.4, (0, 0, 0.2), bark, verts=16)
    cyl(0.36, 0.02, (0, 0, 0.41), wood, verts=16)
    render('stump')

if want('rock'):
    reset(128, 1.6)
    r = sphere(0.45, (0, 0, 0.22), mat(hexc('#55556a'), 0.85), (1.2, 1, 0.65), seg=14)
    displace(r, 0.12, 0.4, seed=9)
    sphere(0.22, (0.3, -0.2, 0.25), mat(hexc('#2f4a33'), 0.9), (1.2, 1, 0.3), seg=10)
    render('rock')

if want('shroom'):
    reset(96, 1.2)
    stem = mat(hexc('#e8dcc8'), 0.6)
    cap = mat(hexc('#3fd0b5'), 0.4, emit=hexc('#3fd0b5'), strength=1.6)
    for x, y, s in [(0, 0, 1.0), (0.22, 0.1, 0.65), (-0.18, 0.14, 0.5)]:
        cyl(0.07 * s, 0.3 * s, (x, y, 0.15 * s), stem, verts=10)
        sphere(0.22 * s, (x, y, 0.3 * s), cap, (1, 1, 0.55))
    render('shroom')

for n, lit in (('lantern', False), ('lanternon', True)):
    if not want(n):
        continue
    reset(128, 1.9)
    iron = mat(hexc('#3a3444'), 0.5, metal=0.6)
    cyl(0.05, 1.1, (0, 0, 0.55), iron, verts=10)
    cyl(0.2, 0.06, (0, 0, 1.12), iron, verts=12)
    glass = mat(hexc('#ffd27a'), 0.2, emit=hexc('#ffb347'), strength=10) if lit else mat(hexc('#5a5566'), 0.2, alpha=0.6)
    sphere(0.17, (0, 0, 1.28), glass, (1, 1, 1.2))
    cone(0.22, 0.05, 0.16, (0, 0, 1.5), iron, verts=12)
    render(n)

if want('chest'):
    reset(128, 1.7)
    wood = mat(hexc('#7a4a22'), 0.7)
    gold = mat(hexc('#ffcf4a'), 0.3, metal=0.8)
    box((0.9, 0.6, 0.4), (0, 0, 0.2), wood)
    lid = cyl(0.3, 0.9, (0, 0, 0.4), wood, rot=(0, rad(90), 0), verts=20)
    lid.scale = (0.6, 1, 1)  # по локальной оси X — это мировая высота крышки
    for x in (-0.3, 0.3):
        box((0.08, 0.64, 0.42), (x, 0, 0.21), gold, bevel=0.01)
        b = cyl(0.31, 0.08, (x, 0, 0.4), gold, rot=(0, rad(90), 0), verts=20)
        b.scale = (0.62, 1, 1)
    box((0.14, 0.06, 0.16), (0, -0.31, 0.38), gold, bevel=0.01)
    render('chest')

for n, col, r in [('gem', '#7af0a0', 0.18), ('gemb', '#7fd3ff', 0.26)]:
    if not want(n):
        continue
    reset(64, 0.8, catcher=False)
    g = add('primitive_ico_sphere_add', subdivisions=1, radius=r, location=(0, 0, r + 0.02))
    g.scale = (0.8, 0.8, 1.3)
    for p in g.data.polygons:
        p.use_smooth = False
    give(g, mat(hexc(col), 0.15, emit=hexc(col), strength=0.7))
    render(n)

if want('coal'):
    reset(64, 0.8, catcher=False)
    c = sphere(0.2, (0, 0, 0.18), mat(hexc('#2a1a12'), 0.8, emit=hexc('#ff6a1a'), strength=0.5), (1.1, 1, 0.8), seg=12)
    displace(c, 0.05, 0.15, seed=2)
    render('coal')

# ---------- земля: бесшовная плитка 512×512, вид строго сверху ----------
# Всё, что лежит на плитке, повторено со сдвигом ±8 по обеим осям — края сходятся.
if want('ground'):
    sc = reset(512, 8.0, catcher=False, samples=32)
    sc.render.film_transparent = False
    st = sc.render.image_settings
    st.color_mode = 'RGB'
    sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
    sc.camera.location = (0, 0, 30)
    sc.camera.rotation_euler = (0, 0, 0)
    for o in [o for o in sc.objects if o.type == 'LIGHT']:
        o.data.energy = 2.5
        o.rotation_euler = (rad(20), rad(10), 0)
    plane = add('primitive_plane_add', size=8.2, location=(0, 0, 0))
    give(plane, mat(hexc('#17241a'), 0.95))
    random.seed(4)

    def wrapped(x, y, fn, reach):
        for dx in (0, -8, 8):
            for dy in (0, -8, 8):
                if abs(x + dx) < 4 + reach and abs(y + dy) < 4 + reach:
                    fn(x + dx, y + dy)

    patches = [mat(hexc(c), 0.95) for c in ('#1c2c1e', '#132017', '#20321f', '#1a2418')]
    for i in range(60):
        x, y, r, m = random.uniform(-4, 4), random.uniform(-4, 4), random.uniform(0.3, 0.9), random.choice(patches)
        wrapped(x, y, lambda a, b: sphere(r, (a, b, -r * 0.97), m, (1.4, 1, 1), seg=16), r * 1.4)
    leaf = [mat(hexc(c), 0.9) for c in ('#3b2f1c', '#4a3a1e', '#24361f', '#2c4024')]
    for i in range(120):
        x, y, s, m = random.uniform(-4, 4), random.uniform(-4, 4), random.uniform(0.04, 0.1), random.choice(leaf)
        wrapped(x, y, lambda a, b: sphere(s, (a, b, 0.0), m, (1.6, 1, 0.2), seg=8), 0.2)
    grass = mat(hexc('#2a4428'), 0.9)
    for i in range(70):
        x, y = random.uniform(-4, 4), random.uniform(-4, 4)

        def tuft(a, b):
            for k in range(4):
                cone(0.025, 0.0, 0.25, (a + random.uniform(-0.06, 0.06), b + random.uniform(-0.06, 0.06), 0.1), grass, rot=(random.uniform(-0.5, 0.5), random.uniform(-0.5, 0.5), 0), verts=4)
        wrapped(x, y, tuft, 0.2)
    render('ground')
