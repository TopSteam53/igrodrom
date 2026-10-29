# Общая «игрушечная» студия для 3D-обложек каталога (решение пользователя 29.10.2026: обложки в 3D, как «Совёнок»).
# Каждая игра — свой файл scripts/blender/covers/<slug>.py с функцией scene(); здесь только то, что одинаково у всех:
# кадр 1280×720, фон-циклорама с мягким градиентом, три софтбокса, материалы «пластик и глина» с фаской, камера.
# Название игры в кадр не рендерится: его накладывает scripts/covers/compose.mjs шрифтом сайта (Unbounded),
# поэтому левая треть кадра (TITLE_ZONE) остаётся спокойной — там будет текст.
#
#   blender --background --factory-startup --python scripts/blender/covers/render.py -- <slug>…
#   COVERS_DRAFT=1 — черновик: половина размера, 24 сэмпла (для подгонки сцены).
import bpy, math, os
from mathutils import Vector

rad = math.radians
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'docs', 'covers', 'out')
FONT = os.path.join(ROOT, 'docs', 'covers', 'fonts', 'Unbounded.ttf')
DRAFT = bool(os.environ.get('COVERS_DRAFT'))
W, H = 1280, 720
# Где будет название: левая часть кадра до 42 % ширины. Главный предмет ставим правее.
TITLE_ZONE = 0.42


def hexc(h):
    """sRGB-цвет #rrggbb в линейный для материалов Blender."""
    h = h.lstrip('#')
    s = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in s)


def reset(samples=160):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24 if DRAFT else samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 50 if DRAFT else 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - Punchy'  # сочнее цвета: обложка читается и в маленькой карточке
    except TypeError:
        pass
    st = sc.render.image_settings
    st.file_format, st.color_mode, st.compression = 'PNG', 'RGB', 15
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.25
    return sc


# ---------- материалы ----------
def mat(name, color, rough=0.38, metal=0.0, coat=0.0, sss=0.0, emit=0.0, emit_color=None, alpha=1.0, transmission=0.0):
    """Principled BSDF. color — '#hex' или линейный кортеж. Для «игрушки»: rough 0.3–0.5, немного coat."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    c = hexc(color) if isinstance(color, str) else color
    b.inputs['Base Color'].default_value = (*c, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Coat Weight'].default_value = coat
    if sss:
        b.inputs['Subsurface Weight'].default_value = sss
        b.inputs['Subsurface Radius'].default_value = (0.4, 0.25, 0.15)
        b.inputs['Subsurface Scale'].default_value = 0.05
    if emit:
        e = hexc(emit_color) if isinstance(emit_color, str) else (emit_color or c)
        b.inputs['Emission Color'].default_value = (*e, 1)
        b.inputs['Emission Strength'].default_value = emit
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
    return m


def toy(name, color, rough=0.42):
    """Матовый пластик игрушки: мягкий блик, лёгкий лак."""
    return mat(name, color, rough=rough, coat=0.25)


def clay(name, color):
    """Глина: шершаво и тепло, свет немного «проходит» внутрь."""
    return mat(name, color, rough=0.62, sss=0.15)


# ---------- формы ----------
def _finish(o, m, bevel, segments, smooth=True):
    if m is not None:
        o.data.materials.append(m)
    if bevel:
        bv = o.modifiers.new('bevel', 'BEVEL')
        bv.width = bevel
        bv.segments = segments
        bv.limit_method = 'ANGLE'
        bv.harden_normals = False
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    return o


def box(size, loc=(0, 0, 0), m=None, bevel=0.06, segments=5, rot=(0, 0, 0), name='box'):
    """Прямоугольник со скруглёнными рёбрами — основа «игрушечного» вида. size — полные размеры (x, y, z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=[rad(a) for a in rot])
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return _finish(o, m, min(bevel, min(size) / 2 - 1e-4), segments)


def cylinder(r, h, loc=(0, 0, 0), m=None, bevel=0.03, rot=(0, 0, 0), verts=64, name='cyl'):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=loc, rotation=[rad(a) for a in rot])
    o = bpy.context.active_object
    o.name = name
    return _finish(o, m, min(bevel, h / 2 - 1e-4, r - 1e-4), 4)


def sphere(r, loc=(0, 0, 0), m=None, scale=(1, 1, 1), name='sphere'):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=64, ring_count=32)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    return _finish(o, m, 0, 0)


def torus(r, thick, loc=(0, 0, 0), m=None, rot=(0, 0, 0), name='torus'):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=thick, location=loc, rotation=[rad(a) for a in rot],
                                     major_segments=96, minor_segments=32)
    o = bpy.context.active_object
    o.name = name
    return _finish(o, m, 0, 0)


def text(body, size=0.5, depth=0.08, loc=(0, 0, 0), rot=(90, 0, 0), m=None, align='CENTER', bevel=0.012, name='text'):
    """Объёмный текст шрифтом Unbounded (цифры на плитках, буквы). rot (90, 0, 0) — лицом к камере по −Y."""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.font = bpy.data.fonts.load(FONT, check_existing=True)
    cu.size = size
    cu.extrude = depth / 2
    cu.bevel_depth = bevel
    cu.bevel_resolution = 3
    cu.align_x = align
    cu.align_y = 'CENTER'
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = [rad(a) for a in rot]
    if m is not None:
        cu.materials.append(m)
    return o


def parent(children, loc=(0, 0, 0), rot=(0, 0, 0), name='group'):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    for c in children:
        c.parent = e
    e.location = loc
    e.rotation_euler = [rad(a) for a in rot]
    return e


# ---------- студия ----------
def backdrop(top, bottom, floor=None, z=0.0, depth=40, glow=0.0):
    """Циклорама: пол плавно уходит в стену, без горизонта. Цвет — градиент снизу (bottom) вверх (top).
    floor — свой цвет пола, иначе bottom. glow — лёгкое свечение фона, чтобы он не проваливался в тень."""
    bpy.ops.mesh.primitive_plane_add(size=1)
    o = bpy.context.active_object
    o.name = 'backdrop'
    me = o.data
    import bmesh
    bm = bmesh.new()
    # профиль: пол от камеры к стене, дуга радиусом 3, стена вверх
    prof = []
    for i in range(12):
        prof.append((-depth / 2 + i * (depth / 2) / 11, z))
    R = 3.0
    for k in range(1, 16):
        a = (k / 15) * math.pi / 2
        prof.append((R * math.sin(a), z + R - R * math.cos(a)))
    for k in range(1, 10):
        prof.append((R, z + R + k * 1.2))
    wide = 40
    rows = []
    for (y, zz) in prof:
        rows.append([bm.verts.new((x, y + 4, zz)) for x in (-wide / 2, wide / 2)])
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], a[1], b[1], b[0]))
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    m = bpy.data.materials.new('backdrop')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.85
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = z
    mr.inputs['From Max'].default_value = z + 9
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*hexc(floor or bottom), 1)
    ramp.color_ramp.elements[1].color = (*hexc(top), 1)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.interpolation = 'EASE'
    nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    if glow:
        nt.links.new(ramp.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = glow
    me.materials.append(m)
    return o


def area(name, loc, target, power, size, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy, d.size, d.color = power, size, color
    d.shape = 'DISK'
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


def lights(target=(0, 0, 0.5), key=900, fill=0.35, rim=0.8, warm=True):
    """Три софтбокса: ключ сверху-слева-спереди (тёплый), заполняющий справа (холодный, fill от ключа),
    контровой сзади-сверху (rim от ключа) — отделяет предмет от фона."""
    kc = (1.0, 0.94, 0.86) if warm else (1, 1, 1)
    area('key', (-3.5, -4.5, 5.5), target, key, 4.0, kc)
    area('fill', (5.0, -3.5, 2.5), target, key * fill, 5.0, (0.86, 0.92, 1.0))
    area('rim', (1.5, 5.0, 5.0), target, key * rim, 3.0, (1.0, 0.97, 0.92))


def backlight(target, power=500, size=6.0, color=(1, 1, 1)):
    """Светлое пятно на фоне за героем (правила docs/covers/style-guide.md): герой на светлом, название на тёмном.
    target — точка подложки за героем, лампа смотрит на неё спереди-сверху."""
    t = Vector(target)
    return area('backlight', (t.x, t.y - 3.0, t.z + 2.5), target, power, size, color)


def camera(loc=(0, -9, 3.2), target=(0, 0, 0.6), lens=85, shift_x=0.0, dof=None):
    """Длиннофокусная камера (70–100 мм, основа 85): игрушечные пропорции без искажений.
    shift_x > 0 сдвигает предмет вправо от центра — освобождает место под название слева."""
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cd.shift_x = -shift_x
    if dof:
        cd.dof.use_dof = True
        cd.dof.focus_distance = (Vector(target) - Vector(loc)).length
        cd.dof.aperture_fstop = dof
    co = bpy.data.objects.new('cam', cd)
    bpy.context.collection.objects.link(co)
    co.location = loc
    co.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = co
    return co


def render(slug):
    os.makedirs(OUT, exist_ok=True)
    sc = bpy.context.scene
    sc.render.filepath = os.path.join(OUT, f'{slug}.png')
    bpy.ops.render.render(write_still=True)
    print(f'[covers] {slug}: {sc.render.filepath}', flush=True)
