# Товары для игры про перепродажу: «студийная съёмка» CC0-моделей — один свет, один ракурс, мягкая тень,
# прозрачный фон (в игре карточка белая). Модели качает scripts/perekup/fetch-polyhaven.mjs в docs/perekup/models.
#
#   blender --background --factory-startup --python scripts/blender/perekup.py -- <папка вывода> <id[:азимут[:наклон]]>…
#   blender … -- <папка вывода> scripts/perekup/items.json [id…]      — по списку игры (только указанные id)
#
# id — папка модели в docs/perekup/models. Азимут и наклон камеры в градусах (по умолчанию 35 и 22): у некоторых
# вещей «лицо» смотрит в другую сторону. Вывод: <папка>/<id>.webp, 768×768. Модели own:… — свои сцены ниже.
import bpy, json, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0])
ITEMS = argv[1:]
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS = os.path.join(ROOT, 'docs', 'perekup', 'models')
HDRI = os.path.join(ROOT, 'docs', 'perekup', 'hdri', 'studio_small_09_1k.hdr')
SIZE = 768
DRAFT = bool(os.environ.get('PEREKUP_DRAFT'))  # черновик для подгонки сцен: мало сэмплов, половина размера
os.makedirs(OUT, exist_ok=True)
rad = math.radians


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = SIZE
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - Base Contrast'
    except TypeError:
        pass
    s = sc.render.image_settings
    s.file_format = 'WEBP'
    s.color_mode = 'RGBA'
    s.quality = 92
    # Свет: студийная HDRI (Poly Haven, CC0) даёт честные блики на пластике и металле.
    world = bpy.data.worlds.new('studio')
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(HDRI)
    bg = nt.nodes['Background']
    bg.inputs['Strength'].default_value = 1.0
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    return sc


def light(name, loc, power, size):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = power
    d.size = size
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    direction = Vector((0, 0, 0.4)) - o.location
    o.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def import_model(model):
    """Импорт glTF модели под пустышку; низ модели по центру — в начале координат. Масштаб настоящий (метры)."""
    sc = bpy.context.scene
    before = set(sc.objects)
    folder = os.path.join(MODELS, model)
    gltf = next(f for f in os.listdir(folder) if f.endswith('.gltf'))
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, gltf))
    new = [o for o in sc.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    inner = bpy.data.objects.new(f'{model}_in', None)
    sc.collection.objects.link(inner)
    for o in new:
        if o.parent is None:
            o.parent = inner
    inner.location = (-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)
    root = bpy.data.objects.new(model, None)
    sc.collection.objects.link(root)
    inner.parent = root
    bpy.context.view_layer.update()
    return root, meshes, hi - lo


def studio(meshes, item, az, el):
    """Предметная съёмка: пол-ловец теней, три софтбокса, камера по реальным краям предмета, рендер."""
    sc = bpy.context.scene
    # Пол-ловец теней: на прозрачном фоне остаётся только мягкая тень под предметом.
    bpy.ops.mesh.primitive_plane_add(size=20)
    bpy.context.active_object.is_shadow_catcher = True

    light('key', (2.2, -2.0, 3.0), 260, 2.5)
    light('fill', (-2.6, -1.2, 1.6), 90, 3.0)
    light('rim', (-0.6, 2.8, 2.4), 160, 2.0)

    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 70
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    # Подгонка по реальным краям: вершины сетки в координатах камеры; камера отъезжает, пока самая дальняя
    # точка не займёт FILL от половины кадра, и сдвигается вбок, чтобы предмет стоял по центру.
    bpy.context.view_layer.update()
    verts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    step = max(1, len(verts) // 20000)
    verts = verts[::step]
    center = sum(verts, Vector()) / len(verts)
    half = cam_data.sensor_width / 2 / cam_data.lens  # тангенс половины угла обзора
    FILL = 0.82
    dirv = Vector((math.sin(rad(az)) * math.cos(rad(el)), -math.cos(rad(az)) * math.cos(rad(el)), math.sin(rad(el))))
    rot = (-dirv).to_track_quat('-Z', 'Y')
    right, up = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0))
    target = center.copy()
    dist = 3.0
    for _ in range(6):
        eye = target + dirv * dist
        xs, ys = [], []
        for p in verts:
            d = p - eye
            depth = d.dot(-dirv)  # расстояние вдоль взгляда
            xs.append(d.dot(right) / depth)
            ys.append(d.dot(up) / depth)
        cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        extent = max(max(xs) - min(xs), max(ys) - min(ys)) / 2
        target += (right * cx + up * cy) * dist
        dist *= extent / (half * FILL)
    cam.location = target + dirv * dist
    cam.rotation_euler = rot.to_euler()

    sc.render.filepath = os.path.join(OUT, f'{item}.webp')
    bpy.ops.render.render(write_still=True)
    print(f'[perekup] {item}: {sc.render.filepath}')


def shoot(item, model, az=35.0, el=22.0, lay=0.0):
    reset()
    root, meshes, size = import_model(model)
    if lay:  # вещь, которая в модели стоит (катана), кладём на пол
        root.rotation_euler = (rad(lay), 0, 0)
        bpy.context.view_layer.update()
        pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
        root.location.z -= min(p.z for p in pts)
        size = Vector((max(p.x for p in pts) - min(p.x for p in pts), max(p.y for p in pts) - min(p.y for p in pts), max(p.z for p in pts) - min(p.z for p in pts)))
    root.scale = [1.0 / max(size)] * 3  # вписываем в куб 1×1×1
    studio(meshes, item, az, el)


# ---------- материалы ----------
def mat(name, color, rough=0.5, metal=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if coat:
        b.inputs['Coat Weight'].default_value = coat
    return m


def box(name, loc, size, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    o.data.materials.append(material)
    return o


# ---------- свои предметы ----------
def own_phone(item):
    """Смартфон без марки: стекло, графитовая рамка, обои-градиент на экране. Стоит вертикально лицом к камере."""
    reset()
    W, T, H = 0.0715, 0.0080, 0.147
    frame = mat('frame', (0.18, 0.19, 0.21), rough=0.22, metal=1.0)
    body = box('body', (0, 0, H / 2), (W, T, H), frame)
    bev = body.modifiers.new('round', 'BEVEL')
    bev.width = 0.0095
    bev.segments = 16
    bpy.ops.object.shade_smooth()
    # Экран: скруглённая пластина чуть перед корпусом, градиент от глубокого синего к закату.
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -T / 2 - 0.0002, H / 2), rotation=(rad(90), 0, 0))
    scr = bpy.context.active_object
    scr.scale = (W - 0.0045, H - 0.0045, 1)
    sb = scr.modifiers.new('round', 'BEVEL')
    sb.affect = 'VERTICES'
    sb.width = 0.0075
    sb.segments = 12
    m = bpy.data.materials.new('screen')
    m.use_nodes = True
    nt = m.node_tree
    out = nt.nodes['Material Output']
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (0.95, 0.42, 0.18, 1)
    els[1].position, els[1].color = 1.0, (0.06, 0.08, 0.32, 1)
    mid = els.new(0.45)
    mid.color = (0.42, 0.12, 0.55, 1)
    emit = nt.nodes.new('ShaderNodeEmission')
    emit.inputs['Strength'].default_value = 1.6
    gloss = nt.nodes.new('ShaderNodeBsdfGlossy')
    gloss.inputs['Roughness'].default_value = 0.05
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.inputs['Fac'].default_value = 0.12
    nt.links.new(tc.outputs['UV'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Y'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], emit.inputs['Color'])
    nt.links.new(emit.outputs['Emission'], mix.inputs[1])
    nt.links.new(gloss.outputs['BSDF'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    scr.data.materials.append(m)
    # Фронтальная камера-точка и кнопки сбоку.
    dark = mat('dark', (0.01, 0.01, 0.012), rough=0.1)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0028, depth=0.0006, location=(0, -T / 2 - 0.0004, H - 0.011), rotation=(rad(90), 0, 0))
    bpy.context.active_object.data.materials.append(dark)
    for z, h in ((0.112, 0.022), (0.084, 0.013)):
        b = box('btn', (W / 2 + 0.0004, 0, z), (0.0014, 0.0032, h), frame)
        b.modifiers.new('r', 'BEVEL').width = 0.0006
    studio([o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.is_shadow_catcher], item, 28, 10)


# ---------- интерьеры ----------
def put(model, x, y, rz=0.0, z=0.0, height=None):
    root, meshes, size = import_model(model)
    k = height / size.z if height else 1.0
    root.scale = (k, k, k)
    root.rotation_euler = (0, 0, rad(rz))
    root.location = (x, y, z)
    return root


def plank_floor(tone, gloss):
    """Паркет: доски 1,2 × 0,16 м через Brick Texture (тонкие швы), два оттенка дерева."""
    m = bpy.data.materials.new('floor')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = gloss
    tc = nt.nodes.new('ShaderNodeTexCoord')
    brick = nt.nodes.new('ShaderNodeTexBrick')
    brick.offset = 0.37
    brick.inputs['Color1'].default_value = (*tone, 1)
    brick.inputs['Color2'].default_value = (*[c * 0.86 for c in tone], 1)
    brick.inputs['Mortar'].default_value = (*[c * 0.55 for c in tone], 1)
    brick.inputs['Scale'].default_value = 1.0
    brick.inputs['Mortar Size'].default_value = 0.003
    brick.inputs['Brick Width'].default_value = 1.2
    brick.inputs['Row Height'].default_value = 0.16
    nt.links.new(tc.outputs['Object'], brick.inputs['Vector'])  # пол с применённым масштабом: координаты в метрах
    nt.links.new(brick.outputs['Color'], b.inputs['Base Color'])
    return m


def room(w, d, h, win, floor_mat, wall_color=(0.86, 0.84, 0.80)):
    """Закрытая комната: пол, потолок, четыре стены, в задней — окно win=(x0, x1, z0, z1). Камера стоит внутри."""
    wall = mat('wall', wall_color, rough=0.85)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
    f = bpy.context.active_object
    f.scale = (w, d, 1)
    bpy.ops.object.transform_apply(scale=True)
    f.data.materials.append(floor_mat)
    box('ceiling', (0, 0, h + 0.05), (w, d, 0.1), wall)
    y = d / 2
    x0, x1, z0, z1 = win
    t = 0.15
    box('wall_l', ((-w / 2 + x0) / 2, y + t / 2, h / 2), (x0 + w / 2, t, h), wall)
    box('wall_r', ((x1 + w / 2) / 2, y + t / 2, h / 2), (w / 2 - x1, t, h), wall)
    box('wall_b', ((x0 + x1) / 2, y + t / 2, z0 / 2), (x1 - x0, t, z0), wall)
    box('wall_t', ((x0 + x1) / 2, y + t / 2, (z1 + h) / 2), (x1 - x0, t, h - z1), wall)
    box('side_l', (-w / 2 - t / 2, 0, h / 2), (t, d, h), wall)
    box('side_r', (w / 2 + t / 2, 0, h / 2), (t, d, h), wall)
    box('front', (0, -d / 2 - t / 2, h / 2), (w, t, h), wall)
    return y


def rug(x, y, w, d, color):
    m = mat('rug', color, rough=0.95)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(x, y, 0.006))
    r = bpy.context.active_object
    r.scale = (w, d, 1)
    r.data.materials.append(m)


def warm_light(loc, power, size=0.6, color=(1.0, 0.78, 0.55)):
    d = bpy.data.lights.new('lamp', 'AREA')
    d.energy = power
    d.size = size
    d.color = color
    o = bpy.data.objects.new('lamp', d)
    bpy.context.collection.objects.link(o)
    o.location = loc


def window_frame(x0, x1, z0, z1, y, posts):
    metal = mat('mullion', (0.05, 0.05, 0.055), rough=0.35, metal=0.8)
    for i in range(posts + 1):
        x = x0 + (x1 - x0) * i / posts
        box('post', (x, y + 0.02, (z0 + z1) / 2), (0.05, 0.06, z1 - z0), metal)
    for z in (z0, z1):
        box('rail', ((x0 + x1) / 2, y + 0.02, z), (x1 - x0, 0.06, 0.05), metal)


def interior(item, hdri, hdri_rot, cam_loc, look, lens, sun=None, world=1.0, exposure=0.0):
    """Фото интерьера: окно на город из HDRI (крыша, а не улица), свет из окна, камера внутри комнаты."""
    sc = bpy.context.scene
    sc.render.film_transparent = False
    sc.render.image_settings.color_mode = 'RGB'
    sc.cycles.samples = 24 if DRAFT else 192
    sc.render.resolution_percentage = 50 if DRAFT else 100
    sc.view_settings.exposure = exposure
    nt = sc.world.node_tree
    env = next(n for n in nt.nodes if n.type == 'TEX_ENVIRONMENT')
    env.image = bpy.data.images.load(os.path.join(ROOT, 'docs', 'perekup', 'hdri', f'{hdri}_2k.hdr'))
    mp = nt.nodes.new('ShaderNodeMapping')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp.inputs['Rotation'].default_value = (0, 0, rad(hdri_rot))
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    nt.nodes['Background'].inputs['Strength'].default_value = world
    if sun:
        s = bpy.data.lights.new('sun', 'SUN')
        s.energy = sun[2]
        s.angle = rad(3)
        so = bpy.data.objects.new('sun', s)
        sc.collection.objects.link(so)
        so.rotation_euler = (rad(sun[0]), 0, rad(sun[1]))
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = lens
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.location = cam_loc
    cam.rotation_euler = (Vector(look) - Vector(cam_loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, f'{item}.webp')
    bpy.ops.render.render(write_still=True)
    print(f'[perekup] {item}: {sc.render.filepath}')


def own_studio(item):
    """Квартира-студия днём: светлый паркет, диван и кресло вокруг ковра, окно на крыши города."""
    reset()
    W, D = 4.4, 4.0
    y = room(W, D, 2.8, (0.2, 1.9, 0.75, 2.45), plank_floor((0.66, 0.48, 0.31), 0.5))
    window_frame(0.2, 1.9, 0.75, 2.45, y, 2)
    rug(-0.55, 0.75, 2.3, 1.7, (0.62, 0.58, 0.52))
    put('sofa_02', -0.6, y - 0.5)
    put('throw_pillows_01', -0.6, y - 0.55, z=0.45)
    put('modern_coffee_table_01', -0.6, 0.75)
    put('modern_arm_chair_01', 1.05, 0.55, rz=-70)
    put('side_table_01', 1.75, 1.35)
    put('planter_pot_clay', -1.85, y - 0.35)
    put('wooden_display_shelves_01', -W / 2 + 0.22, -0.35, rz=90)
    put('hanging_picture_frame_01', -0.6, y - 0.03, z=1.3)
    put('modern_ceiling_lamp_01', -0.6, 0.75, z=1.95)
    warm_light((0, 0, 2.7), 120, 2.5, (1.0, 0.92, 0.82))
    interior(item, 'rooftop_day', 90, cam_loc=(1.85, -1.7, 1.35), look=(-0.7, 1.4, 0.8), lens=23,
             sun=(50, 160, 3.0), world=1.2)


def own_penthouse(item):
    """Пентхаус ночью: стена-окно на огни города, тёмный пол, люстра над обеденным столом, тёплый свет."""
    reset()
    W, D = 6.6, 5.2
    y = room(W, D, 3.2, (-3.1, 3.1, 0.12, 3.05), plank_floor((0.17, 0.11, 0.075), 0.38), wall_color=(0.80, 0.77, 0.72))
    window_frame(-3.1, 3.1, 0.12, 3.05, y, 5)
    rug(-1.3, 0.55, 2.6, 2.0, (0.30, 0.27, 0.25))
    put('sofa_03', -1.3, 1.35)
    put('coffee_table_round_01', -1.3, 0.35)
    put('modern_arm_chair_01', 0.3, -0.2, rz=-60)
    put('dining_table', 1.9, 1.3)
    for dx in (-0.55, 0.55):
        put('dining_chair_02', 1.9 + dx, 0.62, rz=180)
        put('dining_chair_02', 1.9 + dx, 1.98)
    put('Chandelier_02', 1.9, 1.3, z=2.0)
    put('modern_wooden_cabinet', -W / 2 + 0.3, -0.7, rz=90)
    put('planter_pot_clay', 2.9, y - 0.4)
    warm_light((1.9, 1.3, 2.2), 180, 0.8)
    warm_light((-1.3, 0.4, 3.0), 260, 2.2, (1.0, 0.85, 0.7))
    warm_light((0.5, -1.5, 3.0), 160, 2.0, (1.0, 0.85, 0.7))
    interior(item, 'rooftop_night', float(os.environ.get('PEREKUP_ROT', 240)), cam_loc=(2.75, -2.15, 1.5), look=(-0.6, 1.9, 0.95), lens=22, world=1.6, exposure=0.3)


OWN = {'phone': own_phone, 'studio': own_studio, 'penthouse': own_penthouse}


def view(v):
    a, e = (v or '35:22').split(':')
    return float(a), float(e)


if ITEMS and ITEMS[0].endswith('.json'):
    with open(os.path.join(ROOT, ITEMS[0]) if not os.path.isabs(ITEMS[0]) else ITEMS[0], encoding='utf-8') as fh:
        listed = json.load(fh)['items']
    only = set(ITEMS[1:])
    for it in listed:
        if only and it['id'] not in only:
            continue
        # Без явного списка уже готовые не перерисовываем: так прерванный прогон можно продолжить.
        if not only and os.path.exists(os.path.join(OUT, f"{it['id']}.webp")):
            continue
        if it['model'].startswith('own:'):
            build = OWN.get(it['model'][4:])
            if build:
                build(it['id'])
            else:
                print(f"[perekup] {it['id']}: своей сцены {it['model']} пока нет — пропускаю")
        else:
            shoot(it['id'], it['model'], *view(it.get('view')), lay=it.get('lay', 0))
else:
    for spec in ITEMS:
        name, *rest = spec.split(':')
        shoot(name, name, *view(':'.join(rest) if len(rest) == 2 else None))
