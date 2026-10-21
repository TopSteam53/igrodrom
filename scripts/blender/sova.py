# Спрайты игры «Совёнок» в 2.5D: блоки, остров, совёнок и фон с морем.
# Блоки сняты ортокамерой строго спереди с фаской и боковым светом — при повороте в игре свет не «ездит» по граням.
#
#   blender --background --factory-startup --python scripts/blender/sova.py -- public/games/sova/img [имена…]
#
# Имена: wood stone ice rock bomb ground owl bg (или конкретный файл без расширения, например wood_2x1)
import bpy, math, os, sys, time, random

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else '.')
ONLY = set(argv[1:])
os.makedirs(OUT, exist_ok=True)
rad = math.radians
PPM = 128           # пикселей на метр
PAD = 8 / PPM       # поля вокруг спрайта
U = 0.5             # шаг сетки уровней, м
SIZES = [(1, 1), (2, 1), (3, 1), (4, 1), (6, 1), (8, 1), (1, 2), (1, 3), (1, 4), (1, 6), (2, 2), (4, 2)]


def hexc(h):
    h = h.lstrip('#')
    s = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in s)


def want(name):
    return not ONLY or name in ONLY or name.split('_')[0] in ONLY


def reset(wm, hm, samples=48, transparent=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.film_transparent = transparent
    sc.render.resolution_x = round((wm + 2 * PAD) * PPM)
    sc.render.resolution_y = round((hm + 2 * PAD) * PPM)
    sc.view_settings.view_transform = 'Standard'
    st = sc.render.image_settings
    st.file_format, st.color_mode, st.quality = 'WEBP', 'RGBA' if transparent else 'RGB', 92
    w = bpy.data.worlds.new('w')
    sc.world = w
    try:
        w.use_nodes = True
    except AttributeError:
        pass
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (*hexc('#9fc4ff'), 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.55
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = max(wm, hm) + 2 * PAD
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    co.location = (0, -20, 0)
    co.rotation_euler = (rad(90), 0, 0)
    sc.camera = co
    # ключевой свет сверху-слева-спереди, мягкий контровой справа
    for name, energy, rotation, color in [('key', 3.4, (rad(52), rad(-38), rad(-18)), (1, 0.97, 0.9)),
                                          ('fill', 0.9, (rad(70), rad(40), rad(25)), (0.8, 0.88, 1)),
                                          ('rim', 1.2, (rad(-40), rad(20), 0), (1, 0.9, 0.75))]:
        L = bpy.data.lights.new(name, 'SUN')
        L.energy, L.color, L.angle = energy, color, rad(12)
        o = bpy.data.objects.new(name, L)
        sc.collection.objects.link(o)
        o.rotation_euler = rotation
    return sc


def render(name):
    sc = bpy.context.scene
    sc.render.filepath = os.path.join(OUT, name)
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'[sova] {name}: {time.time() - t:.1f} c', flush=True)


def node_mat(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    return m, m.node_tree.nodes, m.node_tree.links, m.node_tree.nodes['Principled BSDF']


def ramp(nodes, links, fac_out, stops):
    r = nodes.new('ShaderNodeValToRGB')
    el = r.color_ramp.elements
    el[0].position, el[0].color = stops[0][0], (*hexc(stops[0][1]), 1)
    el[1].position, el[1].color = stops[-1][0], (*hexc(stops[-1][1]), 1)
    for pos, col in stops[1:-1]:
        e = el.new(pos)
        e.color = (*hexc(col), 1)
    links.new(fac_out, r.inputs['Fac'])
    return r


def bump(nodes, links, height_out, p, strength=0.3, distance=0.02):
    b = nodes.new('ShaderNodeBump')
    b.inputs['Strength'].default_value = strength
    b.inputs['Distance'].default_value = distance
    links.new(height_out, b.inputs['Height'])
    links.new(b.outputs['Normal'], p.inputs['Normal'])


def mat_wood(seed, vertical=False):
    m, n, l, p = node_mat('wood')
    tc = n.new('ShaderNodeTexCoord')
    mp = n.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = (seed * 3.7, seed * 1.3, 0)
    l.new(tc.outputs['Object'], mp.inputs['Vector'])
    wave = n.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'X' if vertical else 'Z'  # волокна идут вдоль доски
    wave.inputs['Scale'].default_value = 2.2
    wave.inputs['Distortion'].default_value = 7
    wave.inputs['Detail'].default_value = 4
    l.new(mp.outputs['Vector'], wave.inputs['Vector'])
    noise = n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 9
    l.new(mp.outputs['Vector'], noise.inputs['Vector'])
    mix = n.new('ShaderNodeMath')
    mix.operation = 'MULTIPLY_ADD'
    mix.inputs[1].default_value = 0.75
    l.new(wave.outputs['Fac'], mix.inputs[0])
    l.new(noise.outputs['Fac'], mix.inputs[2])
    r = ramp(n, l, mix.outputs[0], [(0.2, '#7a4b22'), (0.55, '#a8703a'), (0.95, '#d39a57')])
    l.new(r.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.72
    bump(n, l, wave.outputs['Fac'], p, 0.25)
    return m


def mat_stone(seed):
    m, n, l, p = node_mat('stone')
    tc = n.new('ShaderNodeTexCoord')
    mp = n.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = (seed * 2.1, seed * 5.3, seed)
    l.new(tc.outputs['Object'], mp.inputs['Vector'])
    noise = n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 4
    noise.inputs['Detail'].default_value = 9
    l.new(mp.outputs['Vector'], noise.inputs['Vector'])
    vor = n.new('ShaderNodeTexVoronoi')
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 3.5
    l.new(mp.outputs['Vector'], vor.inputs['Vector'])
    cracks = n.new('ShaderNodeMath')
    cracks.operation = 'GREATER_THAN'
    cracks.inputs[1].default_value = 0.035
    l.new(vor.outputs['Distance'], cracks.inputs[0])
    mul = n.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    l.new(noise.outputs['Fac'], mul.inputs[0])
    l.new(cracks.outputs[0], mul.inputs[1])
    r = ramp(n, l, mul.outputs[0], [(0.0, '#4c515c'), (0.35, '#7d838f'), (0.7, '#aab0bb')])
    l.new(r.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.85
    bump(n, l, mul.outputs[0], p, 0.45)
    return m


def mat_ice():
    m, n, l, p = node_mat('ice')
    tc = n.new('ShaderNodeTexCoord')
    noise = n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 6
    noise.inputs['Detail'].default_value = 6
    l.new(tc.outputs['Object'], noise.inputs['Vector'])
    r = ramp(n, l, noise.outputs['Fac'], [(0.3, '#8fd3f5'), (0.7, '#dff4ff')])
    l.new(r.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.08
    p.inputs['Alpha'].default_value = 0.88
    try:
        p.inputs['Coat Weight'].default_value = 0.6
        p.inputs['Emission Color'].default_value = (*hexc('#bfe9ff'), 1)
        p.inputs['Emission Strength'].default_value = 0.12
    except KeyError:
        pass
    bump(n, l, noise.outputs['Fac'], p, 0.15)
    return m


def mat_rock(seed):
    m, n, l, p = node_mat('rock')
    tc = n.new('ShaderNodeTexCoord')
    mp = n.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = (seed * 4.4, 0, seed * 1.9)
    l.new(tc.outputs['Object'], mp.inputs['Vector'])
    noise = n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 3
    noise.inputs['Detail'].default_value = 10
    l.new(mp.outputs['Vector'], noise.inputs['Vector'])
    base = ramp(n, l, noise.outputs['Fac'], [(0.25, '#2f3340'), (0.6, '#4d5363'), (0.85, '#6a7080')])
    # мох по верхнему краю
    sep = n.new('ShaderNodeSeparateXYZ')
    l.new(tc.outputs['Generated'], sep.inputs['Vector'])
    moss_f = n.new('ShaderNodeMapRange')
    moss_f.inputs['From Min'].default_value = 0.8
    moss_f.inputs['From Max'].default_value = 0.97
    l.new(sep.outputs['Z'], moss_f.inputs['Value'])
    mix = n.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    l.new(moss_f.outputs['Result'], mix.inputs['Factor'])
    l.new(base.outputs['Color'], mix.inputs['A'])
    mix.inputs['B'].default_value = (*hexc('#4f7a3a'), 1)
    l.new(mix.outputs['Result'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.92
    bump(n, l, noise.outputs['Fac'], p, 0.6)
    return m


def flat(col, rough=0.6, emit=0.0):
    m, n, l, p = node_mat('flat')
    p.inputs['Base Color'].default_value = (*hexc(col), 1)
    p.inputs['Roughness'].default_value = rough
    if emit:
        p.inputs['Emission Color'].default_value = (*hexc(col), 1)
        p.inputs['Emission Strength'].default_value = emit
    return m


def block(wm, hm, mat, bevel=0.035, depth=0.5):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.active_object
    o.scale = (wm, depth, hm)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    b = o.modifiers.new('b', 'BEVEL')
    b.width, b.segments, b.limit_method = bevel, 4, 'ANGLE'
    o.data.materials.append(mat)
    for poly in o.data.polygons:
        poly.use_smooth = True
    return o


# ---------- блоки ----------
for mname in ('wood', 'stone', 'ice', 'rock'):
    for i, (w, h) in enumerate(SIZES):
        name = f'{mname}_{w}x{h}'
        if not want(name):
            continue
        wm, hm = w * U, h * U
        reset(wm, hm)
        seed = i + 1
        mat = {'wood': lambda: mat_wood(seed, h > w), 'stone': lambda: mat_stone(seed), 'ice': mat_ice, 'rock': lambda: mat_rock(seed)}[mname]()
        block(wm, hm, mat, bevel=0.05 if mname == 'ice' else 0.035)
        if mname == 'wood' and max(w, h) >= 3:
            # шляпки гвоздей на длинных досках
            nail = flat('#3a3530', 0.4)
            for k in (-1, 1):
                bpy.ops.mesh.primitive_cylinder_add(radius=0.028, depth=0.02, location=(k * (wm / 2 - 0.12) if w >= h else 0, -0.255, 0 if w >= h else k * (hm / 2 - 0.12)), rotation=(rad(90), 0, 0))
                bpy.context.active_object.data.materials.append(nail)
        render(name)

for w, h in [(1, 1), (2, 2)]:
    name = f'bomb_{w}x{h}'
    if not want(name):
        continue
    wm, hm = w * U, h * U
    reset(wm, hm + 0.2)
    red = flat('#c23b2c', 0.55)
    block(wm, hm, red, bevel=0.04)
    stripe = flat('#ffc531', 0.45)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.02, 0))
    s = bpy.context.active_object
    s.scale = (wm + 0.01, 0.5, hm * 0.22)
    s.data.materials.append(stripe)
    dark = flat('#1d1d24', 0.4)
    bpy.ops.mesh.primitive_cylinder_add(radius=hm * 0.16, depth=0.05, location=(0, -0.27, 0), rotation=(rad(90), 0, 0))
    bpy.context.active_object.data.materials.append(dark)
    # фитиль сверху
    bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=0.16, location=(0, 0, hm / 2 + 0.07))
    bpy.context.active_object.data.materials.append(dark)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.045, location=(0, 0, hm / 2 + 0.16))
    bpy.context.active_object.data.materials.append(flat('#ffb547', 0.3, emit=6))
    render(name)

# ---------- остров: левый край, середина, правый край (по 1 м, высота 1.6 м, трава сверху) ----------
for part in ('l', 'm', 'r'):
    name = f'ground_{part}'
    if not want(name):
        continue
    reset(1.0, 1.6)
    random.seed({'l': 1, 'm': 2, 'r': 3}[part])
    earth_m, en, el, ep = node_mat('earth')
    tc = en.new('ShaderNodeTexCoord')
    noise = en.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 5
    noise.inputs['Detail'].default_value = 8
    el.new(tc.outputs['Object'], noise.inputs['Vector'])
    r = ramp(en, el, noise.outputs['Fac'], [(0.3, '#5a3a24'), (0.7, '#8a5c38')])
    el.new(r.outputs['Color'], ep.inputs['Base Color'])
    ep.inputs['Roughness'].default_value = 0.95
    bump(en, el, noise.outputs['Fac'], ep, 0.5)
    # середина повторяется без шва: тело шире кадра; у краёв — скругление
    width = 1.6 if part == 'm' else 1.0
    x0 = 0 if part == 'm' else (0.0 if part == 'l' else 0.0)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x0 + (0.5 if part == 'l' else -0.5 if part == 'r' else 0), 0, -0.1))
    e = bpy.context.active_object
    e.scale = (width if part == 'm' else 2.0, 0.6, 1.3)
    bpy.ops.object.transform_apply(scale=True)
    bev = e.modifiers.new('b', 'BEVEL')
    bev.width, bev.segments = (0.0 if part == 'm' else 0.18), 6
    e.data.materials.append(earth_m)
    grass = flat('#5fa83e', 0.7)
    grass_dark = flat('#3f7f2c', 0.8)
    gx = (0.5 if part == 'l' else -0.5 if part == 'r' else 0)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(gx, 0, 0.6))
    g = bpy.context.active_object
    g.scale = (width if part == 'm' else 2.0, 0.64, 0.18)
    bpy.ops.object.transform_apply(scale=True)
    gb = g.modifiers.new('b', 'BEVEL')
    gb.width, gb.segments = 0.07, 4
    g.data.materials.append(grass)
    for k in range(26):
        x = random.uniform(-0.55, 0.55)
        if part == 'l' and x < -0.42:
            continue
        if part == 'r' and x > 0.42:
            continue
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.035, radius2=0.0, depth=random.uniform(0.12, 0.22), location=(x, random.uniform(-0.33, -0.2), 0.74), rotation=(random.uniform(-0.3, 0.3), random.uniform(-0.4, 0.4), 0))
        bpy.context.active_object.data.materials.append(random.choice([grass, grass_dark]))
    # кадр по вертикали: верх травы на 0.70, ниже — земля до -0.9
    sc = bpy.context.scene
    sc.camera.location = (0, -20, -0.1)
    render(name)

# ---------- совёнок: спит, испугался, рад ----------
def owl(state):
    reset(1.1, 1.2, samples=64)
    sc = bpy.context.scene
    sc.camera.location = (0, -20, 0.05)
    body_m = mat_owl_body()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=0.46, location=(0, 0, 0))
    b = bpy.context.active_object
    b.scale = (1.0, 0.85, 1.02)
    for poly in b.data.polygons:
        poly.use_smooth = True
    b.data.materials.append(body_m)
    belly = flat('#efd9b5', 0.85)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.3, location=(0, -0.2, -0.13))
    bl = bpy.context.active_object
    bl.scale = (1.0, 0.6, 0.95)
    bl.data.materials.append(belly)
    for poly in bl.data.polygons:
        poly.use_smooth = True
    # ушки-пёрышки
    for s in (-1, 1):
        bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.09, radius2=0.0, depth=0.24, location=(s * 0.27, -0.02, 0.45), rotation=(0, rad(s * (28 if state == 'scared' else 18)), 0))
        bpy.context.active_object.data.materials.append(body_m)
        # крылья
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.2, location=(s * 0.43, -0.02, -0.05))
        w = bpy.context.active_object
        w.scale = (0.45, 0.8, 1.15)
        w.rotation_euler = (0, rad(s * (-35 if state == 'scared' else 12)), 0)
        w.data.materials.append(flat('#7a5a40', 0.8))
        # лапки
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.07, location=(s * 0.14, -0.15, -0.46))
        f = bpy.context.active_object
        f.scale = (1.3, 1.1, 0.6)
        f.data.materials.append(flat('#f0a43a', 0.5))
    # клюв
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.06, radius2=0.0, depth=0.14, location=(0, -0.42, 0.02), rotation=(rad(100), 0, 0))
    bpy.context.active_object.data.materials.append(flat('#f0a43a', 0.45))
    # глаза
    white = flat('#ffffff', 0.25)
    dark = flat('#1b1a22', 0.3)
    disc = flat('#f6e7c8', 0.6)
    for s in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.15, location=(s * 0.17, -0.34, 0.14))
        d = bpy.context.active_object
        d.scale = (1, 0.35, 1)
        d.data.materials.append(disc)
        if state == 'sleep':
            bpy.ops.mesh.primitive_torus_add(major_radius=0.075, minor_radius=0.014, location=(s * 0.17, -0.4, 0.17), rotation=(rad(90), 0, 0))
            t = bpy.context.active_object
            t.data.materials.append(dark)
            # оставляем нижнюю дугу — закрытый сонный глаз
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='DESELECT')
            bpy.ops.object.mode_set(mode='OBJECT')
            for v in t.data.vertices:
                v.select = v.co.y > -0.02  # локальная ось y тора после поворота — вертикаль
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.delete(type='VERT')
            bpy.ops.object.mode_set(mode='OBJECT')
        elif state == 'happy':
            bpy.ops.mesh.primitive_torus_add(major_radius=0.075, minor_radius=0.016, location=(s * 0.17, -0.4, 0.1), rotation=(rad(90), 0, 0))
            t = bpy.context.active_object
            t.data.materials.append(dark)
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='DESELECT')
            bpy.ops.object.mode_set(mode='OBJECT')
            for v in t.data.vertices:
                v.select = v.co.y < 0.02
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.delete(type='VERT')
            bpy.ops.object.mode_set(mode='OBJECT')
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.05, location=(s * 0.27, -0.33, -0.03))
            c = bpy.context.active_object
            c.scale = (1.3, 0.4, 0.8)
            c.data.materials.append(flat('#ff8f8f', 0.7))
        else:
            r = 0.1 if state == 'scared' else 0.08
            bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=r, location=(s * 0.17, -0.4, 0.15))
            e = bpy.context.active_object
            e.scale = (1, 0.4, 1.05)
            e.data.materials.append(white)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.035, location=(s * 0.16, -0.445, 0.15))
            bpy.context.active_object.data.materials.append(dark)
    render(f'owl_{state}')


def mat_owl_body():
    m, n, l, p = node_mat('owl')
    tc = n.new('ShaderNodeTexCoord')
    noise = n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 18
    noise.inputs['Detail'].default_value = 6
    l.new(tc.outputs['Object'], noise.inputs['Vector'])
    r = ramp(n, l, noise.outputs['Fac'], [(0.35, '#8a6646'), (0.7, '#a98058')])
    l.new(r.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.9
    try:
        p.inputs['Sheen Weight'].default_value = 0.6
    except KeyError:
        pass
    bump(n, l, noise.outputs['Fac'], p, 0.35)
    return m


for state in ('sleep', 'scared', 'happy'):
    if want(f'owl_{state}'):
        owl(state)

# ---------- фон: небо на рассвете, море, далёкие острова ----------
if want('bg'):
    sc = reset(1, 1, samples=64, transparent=False)
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1600
    cam = sc.camera
    cam.data.type = 'PERSP'
    cam.data.lens = 30
    cam.location = (0, -40, 4)
    cam.rotation_euler = (rad(92), 0, 0)
    # небо: градиент по высоте взгляда
    wt = sc.world.node_tree
    wn, wl = wt.nodes, wt.links
    tc = wn.new('ShaderNodeTexCoord')
    sep = wn.new('ShaderNodeSeparateXYZ')
    wl.new(tc.outputs['Generated'], sep.inputs['Vector'])
    sky = ramp(wn, wl, sep.outputs['Z'], [(0.0, '#ffd6a6'), (0.08, '#ffc9b0'), (0.25, '#b9c9f2'), (0.6, '#7fa3e6')])
    wl.new(sky.outputs['Color'], wn['Background'].inputs['Color'])
    wn['Background'].inputs['Strength'].default_value = 1.0
    for o in [o for o in sc.objects if o.type == 'LIGHT']:
        o.data.energy *= 0.8
    # море
    sea_m, n, l, p = node_mat('sea')
    p.inputs['Base Color'].default_value = (*hexc('#2f7fa8'), 1)
    p.inputs['Roughness'].default_value = 0.08
    wave = n.new('ShaderNodeTexWave')
    wave.inputs['Scale'].default_value = 0.6
    wave.inputs['Distortion'].default_value = 6
    wave.inputs['Detail'].default_value = 6
    bump(n, l, wave.outputs['Fac'], p, 0.25, 0.1)
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 120, 0))
    bpy.context.active_object.data.materials.append(sea_m)
    # далёкие острова в дымке
    random.seed(7)
    for i in range(7):
        x, y = random.uniform(-60, 60), random.uniform(60, 150)
        r = random.uniform(5, 14)
        haze = min(1, (y - 60) / 90)
        col = tuple(a * (1 - haze * 0.7) + b * haze * 0.7 for a, b in zip(hexc('#3f6e57'), hexc('#a9bfe3')))
        mt = flat('#3f6e57', 0.9)
        mt.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*col, 1)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, y, -r * 0.55))
        isl = bpy.context.active_object
        isl.scale = (1.4, 1, random.uniform(0.45, 0.7))
        isl.data.materials.append(mt)
    # облака
    cloud = flat('#ffffff', 1.0, emit=0.35)
    for i in range(9):
        cx, cy, cz = random.uniform(-70, 70), random.uniform(110, 170), random.uniform(18, 48)
        for k in range(6):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=random.uniform(3, 6), location=(cx + random.uniform(-8, 8), cy, cz + random.uniform(-1.5, 2)))
            c = bpy.context.active_object
            c.scale = (1.6, 1, 0.7)
            c.data.materials.append(cloud)
    st = sc.render.image_settings
    st.file_format, st.quality = 'JPEG', 88
    render('bg')
