# Готовые аватарки игроков: 16 круглых персонажей с разными ушами, шапками и аксессуарами.
# Всё строится процедурно из примитивов — файлов .blend нет.
#
#   blender --background --factory-startup --python scripts/blender/avatars.py -- public/avatars [номера…]
#
# Без номеров рендерятся все (1–16). Результат — public/avatars/<n>.webp, 256×256.
import bpy, math, os, sys, time

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else '.')
ONLY = {int(a) for a in argv[1:]}
os.makedirs(OUT, exist_ok=True)
rad = math.radians


def hexc(h):
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 40
    sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = 256
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    s = sc.render.image_settings
    s.file_format = 'WEBP'
    s.color_mode = 'RGB'
    s.quality = 90
    world = bpy.data.worlds.new('world')
    sc.world = world
    try:
        world.use_nodes = True
    except AttributeError:
        pass
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
    return sc


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def add(op, **kw):
    getattr(bpy.ops.mesh, op)(**kw)
    ob = bpy.context.active_object
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def mat(color, rough=0.45, emit=0.0, coat=0.0):
    m = bpy.data.materials.new('m')
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    for name in ('Coat Weight', 'Clearcoat'):
        if name in p.inputs:
            p.inputs[name].default_value = coat
            break
    if emit:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emit
    return m


def give(ob, m):
    ob.data.materials.clear()
    ob.data.materials.append(m)
    return ob


def sphere(r, loc, m, scale=(1, 1, 1)):
    ob = add('primitive_uv_sphere_add', segments=48, ring_count=24, radius=r, location=loc)
    ob.scale = scale
    return give(ob, m)


def cone(r1, r2, depth, loc, rot, m):
    ob = add('primitive_cone_add', vertices=32, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    b = ob.modifiers.new('b', 'BEVEL')
    b.width, b.segments = 0.04, 3
    return give(ob, m)


def cyl(r, depth, loc, rot, m):
    ob = add('primitive_cylinder_add', vertices=40, radius=r, depth=depth, location=loc, rotation=rot)
    b = ob.modifiers.new('b', 'BEVEL')
    b.width, b.segments = 0.03, 3
    return give(ob, m)


def torus(R, r, loc, rot, m):
    ob = add('primitive_torus_add', major_radius=R, minor_radius=r, major_segments=48, minor_segments=16, location=loc, rotation=rot)
    return give(ob, m)


def sun(rot, energy, color=(1, 1, 1)):
    l = bpy.data.lights.new('sun', 'SUN')
    l.energy, l.color, l.angle = energy, color, rad(12)
    ob = link(bpy.data.objects.new('sun', l))
    ob.rotation_euler = rot


def camera():
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('cam')
    cam.lens = 85
    ob = link(bpy.data.objects.new('cam', cam))
    ob.location = (0, -8.2, 0.25)
    ob.rotation_euler = (rad(90), 0, 0)
    sc.camera = ob


# Персонаж — шар-тело с лицом. Камера смотрит вдоль +Y, лицо — на стороне −Y.
def body(color):
    return sphere(1.15, (0, 0, -0.35), mat(color, 0.5, coat=0.3), (1, 0.92, 1.0))


def face(eye_y=0.05, cyclops=False, mood='smile'):
    white, dark = mat(hexc('#FFFFFF'), 0.25), mat(hexc('#1C2140'), 0.2, coat=1)
    glint = mat((1, 1, 1), 0.1, emit=4)
    eyes = [(0, 0.34)] if cyclops else [(-0.38, 0.22), (0.38, 0.22)]
    for x, r in eyes:
        sphere(r, (x, -1.0, eye_y), white, (1, 0.55, 1))
        sphere(r * 0.55, (x + r * 0.08, -1.12, eye_y - r * 0.05), dark, (1, 0.5, 1))
        sphere(r * 0.16, (x + r * 0.3, -1.2, eye_y + r * 0.22), glint)
    blush = mat(hexc('#FF7A8A'), 0.6)
    for x in (-0.62, 0.62):
        sphere(0.13, (x, -0.95, -0.28), blush, (1.3, 0.4, 0.7))
    if mood == 'smile':
        t = torus(0.17, 0.045, (0, -1.07, -0.33), (rad(90), 0, 0), dark)
        # Нижняя половина тора — улыбка: верх прячем за телом.
        t.location.y = -1.05
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.object.mode_set(mode='OBJECT')
        for v in t.data.vertices:
            v.select = v.co.y > 0.02  # ось Y меша после поворота смотрит вверх
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.delete(type='VERT')
        bpy.ops.object.mode_set(mode='OBJECT')
    else:
        sphere(0.11, (0, -1.08, -0.33), dark, (1.1, 0.4, 0.8))


ACC = {}


def acc(fn):
    ACC[fn.__name__] = fn
    return fn


@acc
def cat(c):
    m = mat(c, 0.5)
    for s in (-1, 1):
        cone(0.36, 0.04, 0.7, (0.62 * s, 0, 0.78), (0, rad(-22 * s), 0), m)


@acc
def bunny(c):
    m, inner = mat(c, 0.5), mat(hexc('#FFB3C1'), 0.6)
    for s in (-1, 1):
        sphere(0.22, (0.36 * s, 0, 1.2), m, (1, 0.6, 2.6)).rotation_euler = (0, rad(-10 * s), 0)
        sphere(0.12, (0.36 * s, -0.1, 1.2), inner, (1, 0.4, 2.2)).rotation_euler = (0, rad(-10 * s), 0)


@acc
def horns(c):
    m = mat(hexc('#FFF4D6'), 0.35)
    for s in (-1, 1):
        cone(0.17, 0.02, 0.5, (0.5 * s, -0.1, 0.75), (rad(-10), rad(-28 * s), 0), m)


@acc
def antenna(c):
    m, tip = mat(hexc('#1C2140'), 0.3), mat(hexc('#F2434F'), 0.2, emit=1.5)
    cyl(0.045, 0.7, (0, 0, 1.0), (0, 0, 0), m)
    sphere(0.16, (0, 0, 1.4), tip)


@acc
def crown(c):
    gold, gem = mat(hexc('#FFC531'), 0.25, coat=1), mat(hexc('#F2434F'), 0.1, coat=1)
    cyl(0.5, 0.28, (0, 0, 0.82), (0, 0, 0), gold)
    for i in range(5):
        a = rad(-90 + (i - 2) * 34)
        cone(0.12, 0.0, 0.32, (0.5 * math.cos(a), 0.5 * math.sin(a) + 0.05, 1.1), (0, 0, 0), gold)
    sphere(0.09, (0, -0.5, 0.82), gem)


@acc
def cyclops(c):
    pass


@acc
def glasses(c):
    m = mat(hexc('#1C2140'), 0.25, coat=1)
    for x in (-0.38, 0.38):
        torus(0.27, 0.05, (x, -1.13, 0.05), (rad(90), 0, 0), m)
    cyl(0.04, 0.3, (0, -1.15, 0.1), (0, rad(90), 0), m)


@acc
def bear(c):
    m, inner = mat(c, 0.5), mat(hexc('#FFE0B8'), 0.6)
    for s in (-1, 1):
        sphere(0.3, (0.72 * s, 0.05, 0.62), m, (1, 0.7, 1))
        sphere(0.16, (0.72 * s, -0.12, 0.6), inner, (1, 0.4, 1))


@acc
def wizard(c):
    hat, star = mat(hexc('#3B2F8F'), 0.5), mat(hexc('#FFC531'), 0.2, emit=1.2)
    cone(0.78, 0.04, 1.3, (0, 0.05, 1.15), (rad(-8), 0, rad(8)), hat)
    torus(0.78, 0.08, (0, 0.05, 0.55), (rad(-8), 0, 0), hat)
    sphere(0.09, (0.18, -0.55, 1.05), star)
    sphere(0.06, (-0.2, -0.45, 1.35), star)


@acc
def headphones(c):
    band, cup = mat(hexc('#1C2140'), 0.3, coat=1), mat(hexc('#F2434F'), 0.35, coat=1)
    # Дужка — над головой от уха до уха (плоскость XZ), чуть за лицом.
    torus(1.22, 0.08, (0, 0.2, -0.3), (rad(90), 0, 0), band)
    for s in (-1, 1):
        cyl(0.34, 0.24, (1.16 * s, 0.05, -0.3), (0, rad(90), 0), cup)


@acc
def cap(c):
    m, visor = mat(hexc('#2E6BFF'), 0.45), mat(hexc('#1C2140'), 0.45)
    sphere(0.98, (0, 0.05, 0.25), m, (1, 1, 0.75))
    cyl(0.62, 0.06, (0, -0.95, 0.5), (rad(12), 0, 0), visor).scale = (1, 0.7, 1)


@acc
def sprout(c):
    stem, leaf = mat(hexc('#0B7F4B'), 0.5), mat(hexc('#17B26A'), 0.4, coat=0.5)
    cyl(0.04, 0.4, (0, 0, 0.92), (0, 0, 0), stem)
    for s in (-1, 1):
        sphere(0.18, (0.2 * s, 0, 1.15), leaf, (1.6, 0.4, 0.7)).rotation_euler = (0, rad(-25 * s), 0)


@acc
def frog(c):
    m = mat(c, 0.5)
    for s in (-1, 1):
        sphere(0.34, (0.42 * s, -0.25, 0.68), m)


@acc
def alien(c):
    m, tip = mat(c, 0.5), mat(hexc('#FFC531'), 0.2, emit=1.2)
    for s in (-1, 1):
        cyl(0.04, 0.6, (0.35 * s, 0, 1.05), (0, rad(-22 * s), 0), m)
        sphere(0.12, (0.47 * s, 0, 1.33), tip)


@acc
def tuft(c):
    m = mat(c, 0.5)
    for i, a in enumerate((-30, 0, 30)):
        cone(0.12, 0.0, 0.5, (0.12 * (i - 1), 0, 0.98), (0, rad(a), 0), m)


@acc
def ninja(c):
    band, knot = mat(hexc('#F2434F'), 0.4), mat(hexc('#F2434F'), 0.4)
    t = torus(1.02, 0.1, (0, 0.0, 0.42), (rad(4), 0, 0), band)
    t.scale = (1.07, 0.98, 1.6)
    sphere(0.14, (0.75, 0.75, 0.42), knot)


# Номер: (цвет тела, фон, аксессуар, циклоп, рот)
AVATARS = {
    1: ('#FF9F43', '#2E6BFF', 'cat', False, 'smile'),
    2: ('#FFD1DC', '#8B5CF6', 'bunny', False, 'smile'),
    3: ('#17B26A', '#1C2140', 'horns', False, 'o'),
    4: ('#9FB4FF', '#F2434F', 'antenna', False, 'smile'),
    5: ('#FFE08A', '#3B2F8F', 'crown', False, 'smile'),
    6: ('#2DD4BF', '#7C2D12', 'cyclops', True, 'o'),
    7: ('#F2434F', '#FFC531', 'glasses', False, 'smile'),
    8: ('#B07B4F', '#17B26A', 'bear', False, 'smile'),
    9: ('#C4B5FD', '#134E4A', 'wizard', False, 'o'),
    10: ('#86EFAC', '#701A75', 'headphones', False, 'smile'),
    11: ('#FDE68A', '#F2434F', 'cap', False, 'smile'),
    12: ('#A3E635', '#1E3A8A', 'sprout', False, 'o'),
    13: ('#4ADE80', '#FFC531', 'frog', False, 'smile'),
    14: ('#D8B4FE', '#14532D', 'alien', False, 'o'),
    15: ('#F8FAFC', '#2E6BFF', 'tuft', False, 'smile'),
    16: ('#475569', '#FFC531', 'ninja', False, 'smile'),
}


def build(n):
    col, bg, kind, cyclops, mood = AVATARS[n]
    sc = reset()
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (*hexc(bg), 1)
    camera()
    # Солнце светит вдоль своей −Z: поворот по X на +55° направляет его на лицо (к +Y) сверху.
    sun((rad(52), 0, rad(-28)), 3.4, (1, 0.97, 0.92))
    sun((rad(75), 0, rad(45)), 1.1, (0.85, 0.9, 1))
    sun((rad(-55), 0, rad(160)), 2.2, (1, 1, 1))  # контровой: светлый край по силуэту
    # Фон — плоскость цвета bg, светится сама: ровный цвет без теней.
    back = add('primitive_plane_add', size=30, location=(0, 6, 0), rotation=(rad(90), 0, 0))
    give(back, mat(hexc(bg), 1.0, emit=1.0))
    body(hexc(col))
    if kind == 'cap':
        face(eye_y=-0.05, mood=mood)
    else:
        face(cyclops=cyclops, mood=mood)
    ACC[kind](hexc(col))
    path = os.path.join(OUT, f'{n}')
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'[avatars] {n}.webp: {time.time() - t:.1f} c', flush=True)


for n in sorted(AVATARS):
    if not ONLY or n in ONLY:
        build(n)
