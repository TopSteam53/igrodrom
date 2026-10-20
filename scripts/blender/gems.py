# Камни для игры «Три в ряд»: шесть гранёных самоцветов разной формы и цвета.
# Каждый — «огранка»: контур формы, площадка сверху и грани от неё к краю.
#
#   blender --background --factory-startup --python scripts/blender/gems.py -- public/games/match3/img
#
# Результат: gem0.webp … gem5.webp, 256×256 с прозрачным фоном.
import bpy, bmesh, math, os, sys, time
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else '.')
os.makedirs(OUT, exist_ok=True)


def hexc(h):
    h = h.lstrip('#')
    s = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in s)


def outline(kind, n=64):
    """Контур камня в плоскости XY, радиус ~1."""
    pts = []
    if kind == 'round':
        pts = [(math.cos(a), math.sin(a)) for a in (i * 2 * math.pi / 32 for i in range(32))]
    elif kind == 'square':
        r, k = 0.86, 0.22
        for cx, cy, a0 in ((r - k, r - k, 0), (-(r - k), r - k, 90), (-(r - k), -(r - k), 180), (r - k, -(r - k), 270)):
            for j in range(5):
                a = math.radians(a0 + j * 22.5)
                pts.append((cx + k * math.cos(a), cy + k * math.sin(a)))
    elif kind == 'star':
        for i in range(10):
            a = math.pi / 2 + i * math.pi / 5
            r = 1.0 if i % 2 == 0 else 0.5
            pts.append((r * math.cos(a), r * math.sin(a) - 0.06))
    elif kind == 'emerald':
        w, h, c = 0.74, 0.98, 0.3
        pts = [(w - c, h), (-(w - c), h), (-w, h - c), (-w, -(h - c)), (-(w - c), -h), (w - c, -h), (w, -(h - c)), (w, h - c)]
    elif kind == 'drop':
        for i in range(40):
            t = i * 2 * math.pi / 40
            x = math.sin(t) * (0.82 - 0.36 * math.cos(t) * 0)
            y = -math.cos(t)
            # Капля: снизу круг, сверху острый кончик.
            if y > 0.2:
                x *= (1 - (y - 0.2) / 0.8) ** 0.85
            pts.append((x * 0.95, y * 1.0))
    elif kind == 'tri':
        for i in range(3):
            a = math.pi / 2 + i * 2 * math.pi / 3
            pts.append((1.05 * math.cos(a), 1.05 * math.sin(a) - 0.12))
        # Скруглённые углы: добавим промежуточные точки по рёбрам.
        tri = pts
        pts = []
        for i in range(3):
            a, b = Vector(tri[i]), Vector(tri[(i + 1) % 3])
            for t in (0.12, 0.5, 0.88):
                p = a.lerp(b, t)
                pts.append((p.x, p.y))
    return pts


def gem_mesh(name, kind, height=0.5, table=0.5):
    pts = outline(kind)
    bm = bmesh.new()
    outer = [bm.verts.new((x, y, 0)) for x, y in pts]
    crown = [bm.verts.new((x * 0.82, y * 0.82, height * 0.55)) for x, y in pts]
    top = [bm.verts.new((x * table, y * table, height)) for x, y in pts]
    bottom = bm.verts.new((0, 0, -height * 0.6))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((outer[i], outer[j], crown[j], crown[i]))
        bm.faces.new((crown[i], crown[j], top[j], top[i]))
        bm.faces.new((outer[j], outer[i], bottom))
    bm.faces.new(top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def material(color, glow):
    m = bpy.data.materials.new('gem')
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = 0.22
    for k in ('Coat Weight', 'Clearcoat'):
        if k in p.inputs:
            p.inputs[k].default_value = 1.0
            break
    p.inputs['Emission Color'].default_value = (*glow, 1)
    p.inputs['Emission Strength'].default_value = 0.45
    return m


def light(loc, energy, size, color=(1, 1, 1)):
    l = bpy.data.lights.new('l', 'AREA')
    l.energy, l.size, l.color = energy, size, color
    ob = bpy.data.objects.new('l', l)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = Vector((0, 0, 0)) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


GEMS = [
    ('round', '#FF2E4D', '#ff6078'),
    ('square', '#FF5E00', '#ff8a3d'),
    ('star', '#FFC800', '#ffd84a'),
    ('emerald', '#18C964', '#52e08e'),
    ('drop', '#2F8BFF', '#6aaeff'),
    ('tri', '#A64DFF', '#c58aff'),
]

for i, (kind, col, glow) in enumerate(GEMS):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = 256
    sc.view_settings.view_transform = 'Standard'
    s = sc.render.image_settings
    s.file_format, s.color_mode, s.quality = 'WEBP', 'RGBA', 92
    world = bpy.data.worlds.new('w')
    sc.world = world
    try:
        world.use_nodes = True
    except AttributeError:
        pass
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.4, 0.4, 0.5, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.25

    ob = gem_mesh('gem', kind)
    ob.data.materials.append(material(hexc(col), hexc(glow)))
    # Тёмная обводка: чуть больший силуэт под камнем — камень читается на любом фоне.
    rim = gem_mesh('rim', kind, height=0.05, table=0.9)
    rim.scale = (1.07, 1.07, 1)
    rim.location.z = -0.2
    rm = bpy.data.materials.new('rim')
    try:
        rm.use_nodes = True
    except AttributeError:
        pass
    rm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*[c * 0.25 for c in hexc(col)], 1)
    rm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
    rim.data.materials.append(rm)

    light((-4, 4, 3.2), 700, 2.5, (1, 0.97, 0.92))
    light((4, -3, 2.5), 260, 3, (0.85, 0.9, 1))
    light((3, 4, 1.5), 180, 2, (1, 1, 1))

    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = 2.35
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    co.location = (0, 0, 10)
    sc.camera = co

    sc.render.filepath = os.path.join(OUT, f'gem{i}')
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'[gems] gem{i}.webp {time.time() - t:.1f} c', flush=True)
