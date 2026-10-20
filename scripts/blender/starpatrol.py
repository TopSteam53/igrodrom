# Ассеты игры «Звёздный патруль»: спрайты, фон, обложка и иконка.
# Всё строится процедурно — модели из примитивов и модификаторов, материалы из шейдерных узлов.
#
#   blender --background --factory-startup --python scripts/blender/starpatrol.py -- public/games/starpatrol [имена…]
#
# Без имён рендерится всё. Имена: ship enemy_wasp enemy_cruiser mine rock1 rock2 rock3 crystal planet nebula cover icon
import bpy, bmesh, math, os, sys, time
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else '.')
ONLY = set(argv[1:])
IMG = os.path.join(OUT, 'img')
os.makedirs(IMG, exist_ok=True)

rad = math.radians


# ---------- сцена ----------
def reset(samples=48, transparent=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.render.film_transparent = transparent
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - Punchy'
    except TypeError:
        pass
    s = sc.render.image_settings
    s.file_format = 'WEBP'
    s.color_mode = 'RGBA' if transparent else 'RGB'
    s.quality = 90
    world = bpy.data.worlds.new('world')
    sc.world = world
    try:
        world.use_nodes = True
    except AttributeError:
        pass
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.012, 0.016, 0.045, 1)
    bg.inputs['Strength'].default_value = 1.0
    return sc


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def empty(name):
    return link(bpy.data.objects.new(name, None))


def parent(ob, root):
    ob.parent = root
    return ob


def smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def add(op, **kw):
    getattr(bpy.ops.mesh, op)(**kw)
    return bpy.context.active_object


def setin(node, names, value):
    for n in names if isinstance(names, (list, tuple)) else [names]:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return


def mat(name, color, metal=0.0, rough=0.4, emit=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    p = m.node_tree.nodes.get('Principled BSDF')
    setin(p, 'Base Color', (*color, 1))
    setin(p, 'Metallic', metal)
    setin(p, 'Roughness', rough)
    setin(p, ['Coat Weight', 'Clearcoat'], coat)
    if emit:
        setin(p, ['Emission Color', 'Emission'], (*emit, 1))
        setin(p, 'Emission Strength', strength)
    return m


def give(ob, material):
    ob.data.materials.clear()
    ob.data.materials.append(material)
    return ob


def prism(name, pts, z0, z1, material, mirror=False, bevel=0.02):
    """Плоская деталь: многоугольник pts в плоскости XY толщиной z0..z1."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z0)) for x, y in pts]
    hi = [bm.verts.new((x, y, z1)) for x, y in pts]
    bm.faces.new(lo[::-1])
    bm.faces.new(hi)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    give(ob, material)
    if bevel:
        b = ob.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = 3
        b.limit_method = 'ANGLE'
    if mirror:
        mm = ob.modifiers.new('mirror', 'MIRROR')
        mm.use_axis[0] = True
    return ob


def blob(name, scale, loc, material, segments=32, rings=16):
    ob = add('primitive_uv_sphere_add', segments=segments, ring_count=rings, radius=1, location=loc)
    ob.name = name
    ob.scale = scale
    return give(smooth(ob), material)


def tube(name, r, depth, loc, material, axis='Y', verts=24):
    rot = {'Y': (rad(90), 0, 0), 'X': (0, rad(90), 0), 'Z': (0, 0, 0)}[axis]
    ob = add('primitive_cylinder_add', vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    ob.name = name
    b = ob.modifiers.new('bevel', 'BEVEL')
    b.width = min(r * 0.25, 0.03)
    b.segments = 2
    b.limit_method = 'ANGLE'
    return give(smooth(ob), material)


def sun(rot, energy, color=(1, 1, 1), angle=8):
    l = bpy.data.lights.new('sun', 'SUN')
    l.energy = energy
    l.color = color
    l.angle = rad(angle)
    ob = link(bpy.data.objects.new('sun', l))
    ob.rotation_euler = rot
    return ob


def sprite_lights():
    # Свет одинаковый для всех спрайтов: ключевой сверху-слева, холодный заполняющий снизу-справа.
    sun((rad(-38), rad(-32), 0), 4.2, (1.0, 0.96, 0.9))
    sun((rad(45), rad(40), 0), 0.9, (0.45, 0.6, 1.0))
    sun((rad(-80), 0, 0), 0.6, (1, 1, 1))


def ortho(scale, w, h=None):
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = scale
    ob = link(bpy.data.objects.new('cam', cam))
    ob.location = (0, 0, 20)
    cam.clip_end = 100
    sc.camera = ob
    sc.render.resolution_x = w
    sc.render.resolution_y = h or w
    return ob


def look_cam(loc, target, lens=40, w=1280, h=720):
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('cam')
    cam.lens = lens
    cam.clip_end = 500
    ob = link(bpy.data.objects.new('cam', cam))
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = ob
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    return ob


def render(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    sc.render.use_file_extension = True
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'[starpatrol] {os.path.basename(path)}: {time.time() - t:.1f} c', flush=True)


def glare(strength=0.6):
    """Свечение ярких мест (двигатели, выстрелы) для обложки. Если API компоновщика другое — без него."""
    sc = bpy.context.scene
    try:
        ng = bpy.data.node_groups.new('comp', 'CompositorNodeTree')
        ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        rl = ng.nodes.new('CompositorNodeRLayers')
        gl = ng.nodes.new('CompositorNodeGlare')
        out = ng.nodes.new('NodeGroupOutput')
        for key, val in (('Type', 'Bloom'), ('Quality', 'High'), ('Threshold', 1.0), ('Strength', strength), ('Size', 0.6)):
            if key in gl.inputs:
                try:
                    gl.inputs[key].default_value = val
                except (TypeError, ValueError):
                    pass
        if hasattr(gl, 'glare_type'):
            gl.glare_type = 'BLOOM'
        ng.links.new(rl.outputs['Image'], gl.inputs['Image'])
        ng.links.new(gl.outputs['Image'], out.inputs[0])
        sc.compositing_node_group = ng
    except Exception as e:  # noqa: BLE001
        print('[starpatrol] glare skipped:', e)


# ---------- материалы с узлами ----------
def rock_mat(name, a, b, seed):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    p = nt.nodes.get('Principled BSDF')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 3.0
    noise.inputs['Detail'].default_value = 10
    noise.inputs['Roughness'].default_value = 0.62
    if 'W' in noise.inputs:
        noise.noise_dimensions = '4D'
        noise.inputs['W'].default_value = seed
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (*a, 1)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = (*b, 1)
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.55
    fine = nt.nodes.new('ShaderNodeTexNoise')
    fine.inputs['Scale'].default_value = 14
    fine.inputs['Detail'].default_value = 8
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    nt.links.new(tc.outputs['Object'], fine.inputs['Vector'])
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    nt.links.new(fine.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    setin(p, 'Roughness', 0.92)
    return m


def nebula_mat(tile=True, brightness=1.0):
    """Туманность со звёздами. tile=True — бесшовная по вертикали (плитка для прокрутки)."""
    m = bpy.data.materials.new('nebula')
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    nt.nodes.remove(nt.nodes.get('Principled BSDF'))
    out = nt.nodes.get('Material Output')
    N = nt.nodes.new
    L = nt.links.new
    tc = N('ShaderNodeTexCoord')
    if tile:
        # (x, y) на плоскости 1×2 → (x·k, R·cos 2πy, R·sin 2πy): шум на цилиндре, низ и верх совпадают.
        sep = N('ShaderNodeSeparateXYZ')
        L(tc.outputs['Generated'], sep.inputs[0])
        k = 2.0
        ang = N('ShaderNodeMath'); ang.operation = 'MULTIPLY'; ang.inputs[1].default_value = 2 * math.pi
        L(sep.outputs['Y'], ang.inputs[0])
        cos = N('ShaderNodeMath'); cos.operation = 'COSINE'; L(ang.outputs[0], cos.inputs[0])
        sin = N('ShaderNodeMath'); sin.operation = 'SINE'; L(ang.outputs[0], sin.inputs[0])
        R = 2 * k / (2 * math.pi)
        cr = N('ShaderNodeMath'); cr.operation = 'MULTIPLY'; cr.inputs[1].default_value = R; L(cos.outputs[0], cr.inputs[0])
        sr = N('ShaderNodeMath'); sr.operation = 'MULTIPLY'; sr.inputs[1].default_value = R; L(sin.outputs[0], sr.inputs[0])
        xr = N('ShaderNodeMath'); xr.operation = 'MULTIPLY'; xr.inputs[1].default_value = k; L(sep.outputs['X'], xr.inputs[0])
        comb = N('ShaderNodeCombineXYZ')
        L(xr.outputs[0], comb.inputs[0]); L(cr.outputs[0], comb.inputs[1]); L(sr.outputs[0], comb.inputs[2])
        vec = comb.outputs[0]
    else:
        vec = tc.outputs['Object']
    big = N('ShaderNodeTexNoise')
    big.inputs['Scale'].default_value = 1.3
    big.inputs['Detail'].default_value = 9
    big.inputs['Roughness'].default_value = 0.62
    if 'Distortion' in big.inputs:
        big.inputs['Distortion'].default_value = 0.4
    L(vec, big.inputs['Vector'])
    hue = N('ShaderNodeTexNoise')
    hue.inputs['Scale'].default_value = 0.6
    hue.inputs['Detail'].default_value = 3
    L(vec, hue.inputs['Vector'])
    ramp = N('ShaderNodeValToRGB')
    cr_ = ramp.color_ramp
    cr_.elements[0].position = 0.38
    cr_.elements[0].color = (0.0015, 0.002, 0.008, 1)
    cr_.elements[1].position = 0.78
    cr_.elements[1].color = (0.42, 0.12, 0.42, 1)
    e = cr_.elements.new(0.55); e.color = (0.02, 0.035, 0.14, 1)
    e = cr_.elements.new(0.67); e.color = (0.14, 0.05, 0.3, 1)
    L(big.outputs['Fac'], ramp.inputs['Fac'])
    teal = N('ShaderNodeValToRGB')
    teal.color_ramp.elements[0].position = 0.45
    teal.color_ramp.elements[0].color = (1, 1, 1, 1)
    teal.color_ramp.elements[1].position = 0.7
    teal.color_ramp.elements[1].color = (0.25, 1.4, 1.6, 1)
    L(hue.outputs['Fac'], teal.inputs['Fac'])
    tint = N('ShaderNodeMix'); tint.data_type = 'RGBA'; tint.blend_type = 'MULTIPLY'
    tint.inputs['Factor'].default_value = 1.0
    L(ramp.outputs['Color'], tint.inputs['A']); L(teal.outputs['Color'], tint.inputs['B'])
    # Звёзды: мелкие клетки Вороного, яркость — от случайного цвета клетки.
    vor = N('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = 70
    L(vec, vor.inputs['Vector'])
    lt = N('ShaderNodeMath'); lt.operation = 'LESS_THAN'; lt.inputs[1].default_value = 0.045
    L(vor.outputs['Distance'], lt.inputs[0])
    sepc = N('ShaderNodeSeparateColor'); L(vor.outputs['Color'], sepc.inputs[0])
    pw = N('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 6
    L(sepc.outputs[0], pw.inputs[0])
    star = N('ShaderNodeMath'); star.operation = 'MULTIPLY'
    L(lt.outputs[0], star.inputs[0]); L(pw.outputs[0], star.inputs[1])
    star2 = N('ShaderNodeMath'); star2.operation = 'MULTIPLY'; star2.inputs[1].default_value = 3.0
    L(star.outputs[0], star2.inputs[0])
    add_ = N('ShaderNodeMix'); add_.data_type = 'RGBA'; add_.blend_type = 'ADD'
    add_.inputs['Factor'].default_value = 1.0
    L(tint.outputs['Result'], add_.inputs['A'])
    L(star2.outputs[0], add_.inputs['B'])
    em = N('ShaderNodeEmission')
    em.inputs['Strength'].default_value = brightness
    L(add_.outputs['Result'], em.inputs['Color'])
    L(em.outputs[0], out.inputs['Surface'])
    return m


def planet_mats():
    m = bpy.data.materials.new('gas')
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    p = nt.nodes.get('Principled BSDF')
    N = nt.nodes.new
    L = nt.links.new
    tc = N('ShaderNodeTexCoord')
    wave = N('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 1.6
    wave.inputs['Distortion'].default_value = 7
    wave.inputs['Detail'].default_value = 6
    wave.inputs['Detail Scale'].default_value = 1.5
    L(tc.outputs['Object'], wave.inputs['Vector'])
    ramp = N('ShaderNodeValToRGB')
    c = ramp.color_ramp
    c.elements[0].position = 0.0; c.elements[0].color = (0.09, 0.03, 0.2, 1)
    c.elements[1].position = 1.0; c.elements[1].color = (0.95, 0.72, 0.45, 1)
    e = c.elements.new(0.35); e.color = (0.45, 0.08, 0.28, 1)
    e = c.elements.new(0.62); e.color = (0.95, 0.35, 0.12, 1)
    L(wave.outputs['Fac'], ramp.inputs['Fac'])
    L(ramp.outputs['Color'], p.inputs['Base Color'])
    setin(p, 'Roughness', 0.7)

    atm = bpy.data.materials.new('atmo')
    try:
        atm.use_nodes = True
    except AttributeError:
        pass
    nt = atm.node_tree
    nt.nodes.remove(nt.nodes.get('Principled BSDF'))
    out = nt.nodes.get('Material Output')
    N = nt.nodes.new
    L = nt.links.new
    lw = N('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.35
    pw = N('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 2.2
    L(lw.outputs['Facing'], pw.inputs[0])
    em = N('ShaderNodeEmission'); em.inputs['Color'].default_value = (1.0, 0.45, 0.35, 1); em.inputs['Strength'].default_value = 3
    tr = N('ShaderNodeBsdfTransparent')
    mix = N('ShaderNodeMixShader')
    L(pw.outputs[0], mix.inputs['Fac'])
    L(tr.outputs[0], mix.inputs[1]); L(em.outputs[0], mix.inputs[2])
    L(mix.outputs[0], out.inputs['Surface'])

    ring = bpy.data.materials.new('ring')
    try:
        ring.use_nodes = True
    except AttributeError:
        pass
    nt = ring.node_tree
    p = nt.nodes.get('Principled BSDF')
    out = nt.nodes.get('Material Output')
    N = nt.nodes.new
    L = nt.links.new
    tc = N('ShaderNodeTexCoord')
    ln = N('ShaderNodeVectorMath'); ln.operation = 'LENGTH'
    L(tc.outputs['Object'], ln.inputs[0])
    bands = N('ShaderNodeTexNoise'); bands.inputs['Scale'].default_value = 22; bands.inputs['Detail'].default_value = 2
    # Шум от радиуса: кольца с полосами.
    comb = N('ShaderNodeCombineXYZ'); L(ln.outputs['Value'], comb.inputs[0])
    L(comb.outputs[0], bands.inputs['Vector'])
    ramp = N('ShaderNodeValToRGB')
    c = ramp.color_ramp
    c.elements[0].position = 0.35; c.elements[0].color = (0, 0, 0, 1)
    c.elements[1].position = 0.65; c.elements[1].color = (1, 1, 1, 1)
    L(bands.outputs['Fac'], ramp.inputs['Fac'])
    setin(p, 'Base Color', (0.95, 0.75, 0.55, 1))
    setin(p, 'Roughness', 0.8)
    tr = N('ShaderNodeBsdfTransparent')
    mix = N('ShaderNodeMixShader')
    L(ramp.outputs['Color'], mix.inputs['Fac'])
    L(tr.outputs[0], mix.inputs[1]); L(p.outputs[0], mix.inputs[2])
    L(mix.outputs[0], out.inputs['Surface'])
    return m, atm, ring


# ---------- модели ----------
PAL = {}


def palette():
    PAL.update(
        hull=mat('hull', (0.78, 0.82, 0.9), metal=0.45, rough=0.28, coat=0.6),
        dark=mat('dark', (0.035, 0.04, 0.09), metal=0.6, rough=0.35),
        accent=mat('accent', (1.0, 0.55, 0.03), metal=0.2, rough=0.3, coat=0.5),
        glass=mat('glass', (0.02, 0.25, 0.6), metal=0.1, rough=0.04, emit=(0.15, 0.65, 1.0), strength=1.4, coat=1),
        engine=mat('engine', (1, 0.5, 0.1), emit=(1.0, 0.42, 0.06), strength=14),
        flame=mat('flame', (1, 0.7, 0.3), emit=(1.0, 0.62, 0.2), strength=22),
        navR=mat('navR', (1, 0.1, 0.1), emit=(1, 0.08, 0.05), strength=10),
        navG=mat('navG', (0.1, 1, 0.3), emit=(0.1, 1, 0.35), strength=10),
        red=mat('red', (0.5, 0.035, 0.05), metal=0.55, rough=0.3, coat=0.4),
        redDark=mat('redDark', (0.06, 0.02, 0.03), metal=0.6, rough=0.4),
        eye=mat('eye', (1, 0.2, 0.05), emit=(1, 0.18, 0.04), strength=12),
        violet=mat('violet', (0.2, 0.06, 0.45), metal=0.6, rough=0.28, coat=0.5),
        window=mat('window', (0.2, 1, 0.5), emit=(0.25, 1, 0.45), strength=8),
        pink=mat('pink', (1, 0.3, 0.6), emit=(1, 0.25, 0.65), strength=14),
        laser=mat('laser', (1, 0.85, 0.3), emit=(1, 0.8, 0.25), strength=30),
        crystal=mat('crystal', (0.02, 0.75, 0.55), metal=0.2, rough=0.06, emit=(0.05, 1.0, 0.7), strength=3.5, coat=1),
        steel=mat('steel', (0.18, 0.19, 0.22), metal=0.8, rough=0.35),
    )


def build_ship(flames=False):
    P = PAL
    root = empty('ship')
    body = add('primitive_uv_sphere_add', segments=48, ring_count=24, radius=1)
    for v in body.data.vertices:
        x, y, z = v.co
        k = max(0.0, y) ** 1.3
        x *= 0.34 * (1 - 0.72 * k) * (1 + 0.28 * max(0.0, -y))
        z *= 0.3 * (1 - 0.45 * k)
        v.co = (x, y * 1.75, z)
    parent(give(smooth(body), P['hull']), root)
    parent(prism('spine', [(-0.1, -1.35), (0.1, -1.35), (0.07, 0.15), (-0.07, 0.15)], 0.18, 0.3, P['dark']), root)
    parent(blob('cockpit', (0.15, 0.42, 0.14), (0, 0.48, 0.18), P['glass']), root)
    parent(prism('wing', [(0.2, 0.25), (0.2, -0.85), (1.55, -1.05), (1.6, -0.7)], -0.05, 0.05, P['hull'], mirror=True), root)
    parent(prism('stripe', [(0.35, 0.05), (0.35, -0.12), (1.5, -0.9), (1.55, -0.75)], 0.05, 0.075, P['accent'], mirror=True, bevel=0.008), root)
    parent(prism('flap', [(0.3, -0.6), (0.3, -0.85), (1.1, -0.98), (1.15, -0.82)], 0.05, 0.07, P['dark'], mirror=True, bevel=0.008), root)
    for sx, nav in ((1, 'navG'), (-1, 'navR')):
        parent(tube('pod', 0.07, 0.7, (1.6 * sx, -0.82, 0.03), P['dark']), root)
        parent(blob('nav', (0.06, 0.06, 0.06), (1.6 * sx, -0.45, 0.04), P[nav], 16, 8), root)
        parent(tube('engine', 0.17, 0.75, (0.33 * sx, -1.42, 0.02), P['dark']), root)
        parent(tube('ring', 0.18, 0.08, (0.33 * sx, -1.15, 0.02), P['accent']), root)
        parent(tube('nozzle', 0.12, 0.06, (0.33 * sx, -1.8, 0.02), P['engine']), root)
        if flames:
            f = add('primitive_cone_add', vertices=24, radius1=0.12, radius2=0.0, depth=0.9,
                    location=(0.33 * sx, -2.25, 0.02), rotation=(rad(90), 0, 0))
            parent(give(smooth(f), P['flame']), root)
    return root


def build_wasp():
    P = PAL
    root = empty('wasp')
    parent(blob('body', (0.58, 0.72, 0.3), (0, 0, 0), P['red']), root)
    parent(blob('shell', (0.4, 0.5, 0.17), (0, 0.12, 0.17), P['redDark']), root)
    parent(prism('claw', [(0.22, -0.45), (0.55, -0.35), (0.48, -1.15), (0.36, -1.08), (0.33, -0.7)], -0.05, 0.07, P['red'], mirror=True), root)
    parent(prism('clawtip', [(0.36, -1.08), (0.48, -1.15), (0.45, -1.3)], -0.03, 0.05, P['steel'], mirror=True, bevel=0.01), root)
    parent(prism('wing', [(0.45, 0.25), (1.25, 0.6), (1.18, 0.1), (0.5, -0.25)], -0.02, 0.04, P['redDark'], mirror=True), root)
    parent(prism('vein', [(0.55, 0.12), (1.15, 0.45), (1.12, 0.36), (0.55, 0.02)], 0.04, 0.055, P['eye'], mirror=True, bevel=0.005), root)
    parent(blob('eye', (0.16, 0.13, 0.12), (0, -0.56, 0.12), P['eye'], 24, 12), root)
    parent(blob('thrust', (0.13, 0.1, 0.1), (0, 0.74, 0.02), P['engine'], 16, 8), root)
    return root


def build_cruiser():
    P = PAL
    root = empty('cruiser')
    parent(prism('hull', [(0, -1.35), (0.45, -0.7), (0.6, 0.6), (0.35, 1.05), (-0.35, 1.05), (-0.6, 0.6), (-0.45, -0.7)],
                 -0.15, 0.2, P['violet'], bevel=0.05), root)
    parent(prism('deck', [(0, -0.8), (0.28, -0.3), (0.32, 0.65), (-0.32, 0.65), (-0.28, -0.3)], 0.2, 0.36, P['dark'], bevel=0.03), root)
    for sx in (1, -1):
        parent(tube('pod', 0.2, 1.4, (0.82 * sx, 0.1, 0), P['violet']), root)
        parent(tube('podcap', 0.21, 0.1, (0.82 * sx, -0.45, 0), P['steel']), root)
        parent(tube('podglow', 0.14, 0.05, (0.82 * sx, 0.82, 0), P['pink']), root)
        b = add('primitive_cube_add', size=1, location=(0.3 * sx, 0.1, 0.33))
        b.scale = (0.04, 0.5, 0.04)
        parent(give(b, P['window']), root)
    for x in (-0.22, 0, 0.22):
        parent(tube('thruster', 0.09, 0.12, (x, 1.08, 0.02), P['pink']), root)
    parent(blob('turret', (0.17, 0.17, 0.12), (0, 0.15, 0.4), P['steel'], 24, 12), root)
    parent(tube('barrel', 0.045, 0.6, (0, -0.2, 0.44), P['steel'], verts=12), root)
    return root


def build_mine():
    P = PAL
    root = empty('mine')
    core = add('primitive_ico_sphere_add', subdivisions=3, radius=0.5)
    parent(give(smooth(core), P['steel']), root)
    ico = add('primitive_ico_sphere_add', subdivisions=1, radius=1)
    dirs = [v.co.normalized() for v in ico.data.vertices][:12]
    bpy.data.objects.remove(ico)
    for d in dirs:
        s = add('primitive_cone_add', vertices=10, radius1=0.09, radius2=0.0, depth=0.36, location=d * 0.62)
        s.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        parent(give(smooth(s), P['dark']), root)
    parent(blob('lamp', (0.13, 0.13, 0.13), (0, 0, 0.47), P['eye'], 16, 8), root)
    band = add('primitive_torus_add', major_radius=0.5, minor_radius=0.04)
    parent(give(smooth(band), P['eye']), root)
    return root


def build_rock(seed, tone):
    ob = add('primitive_ico_sphere_add', subdivisions=5, radius=1)
    smooth(ob)
    off = empty('off')
    off.location = (seed * 3.1, seed * -1.7, seed * 2.3)
    t1 = bpy.data.textures.new(f'clouds{seed}', 'CLOUDS')
    t1.noise_scale = 0.7
    t1.noise_depth = 4
    t1.noise_type = 'HARD_NOISE'  # острые грани, а не «картофелина»
    d1 = ob.modifiers.new('shape', 'DISPLACE')
    d1.texture = t1
    d1.strength = 0.62
    d1.mid_level = 0.5
    d1.texture_coords = 'OBJECT'
    d1.texture_coords_object = off
    t2 = bpy.data.textures.new(f'cells{seed}', 'VORONOI')
    t2.noise_scale = 0.45
    d2 = ob.modifiers.new('craters', 'DISPLACE')
    d2.texture = t2
    d2.strength = 0.18
    d2.texture_coords = 'OBJECT'
    d2.texture_coords_object = off
    ob.scale = (1.0, 0.82 + 0.06 * seed, 0.75)
    give(ob, rock_mat(f'rock{seed}', *tone, seed))
    return ob


def build_crystal():
    bm = bmesh.new()
    ring = [bm.verts.new((0.32 * math.cos(a), 0.0, 0.32 * math.sin(a))) for a in (i * math.pi / 3 for i in range(6))]
    top = bm.verts.new((0, 0.7, 0))
    bot = bm.verts.new((0, -0.45, 0))
    for i in range(6):
        j = (i + 1) % 6
        bm.faces.new((ring[i], ring[j], top))
        bm.faces.new((ring[j], ring[i], bot))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('crystal')
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new('crystal', me))
    give(ob, PAL['crystal'])
    return ob


def build_planet(loc=(0, 0, 0), scale=1.0, tilt=(rad(72), rad(-14), 0), ring=True):
    gas, atmo, ringm = planet_mats()
    root = empty('planet')
    root.location = loc
    root.scale = (scale,) * 3
    root.rotation_euler = tilt
    p = add('primitive_uv_sphere_add', segments=96, ring_count=48, radius=1)
    parent(give(smooth(p), gas), root)
    a = add('primitive_uv_sphere_add', segments=96, ring_count=48, radius=1.05)
    parent(give(smooth(a), atmo), root)
    if not ring:
        return root
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, segments=128, radius=2.2)
    inner = bmesh.ops.create_circle(bm, segments=128, radius=1.45)['verts']
    outer = [v for v in bm.verts if v not in inner]
    outer.sort(key=lambda v: math.atan2(v.co.y, v.co.x))
    inner.sort(key=lambda v: math.atan2(v.co.y, v.co.x))
    for i in range(128):
        j = (i + 1) % 128
        bm.faces.new((inner[i], inner[j], outer[j], outer[i]))
    me = bpy.data.meshes.new('ring')
    bm.to_mesh(me)
    bm.free()
    r = link(bpy.data.objects.new('ring', me))
    parent(give(r, ringm), root)
    return root


def nebula_plane(w, h, loc=(0, 0, 0), rot=(0, 0, 0), tile=True, brightness=1.0):
    ob = add('primitive_plane_add', size=1, location=loc, rotation=rot)
    ob.scale = (w, h, 1)
    give(ob, nebula_mat(tile, brightness))
    return ob


# ---------- ассеты ----------
def sprite(name, builder, scale, res, rot=(0, 0, 0)):
    reset(samples=64)
    palette()
    sprite_lights()
    ob = builder()
    ob.rotation_euler = rot
    ortho(scale, res)
    render(os.path.join(IMG, name))


def asset_rock(n, tone):
    reset(samples=48)
    palette()
    sprite_lights()
    build_rock(n, tone)
    ortho(2.9, 256)
    render(os.path.join(IMG, f'rock{n}'))


def asset_planet():
    reset(samples=64)
    sun((rad(-10), rad(-70), 0), 5.0, (1, 0.95, 0.9))
    build_planet()
    ortho(5.6, 1024, 640)
    render(os.path.join(IMG, 'planet'))


def asset_nebula():
    reset(samples=24, transparent=False)
    sc = bpy.context.scene
    sc.render.image_settings.quality = 82
    nebula_plane(1, 2)
    ortho(2.0, 720, 1440)
    render(os.path.join(IMG, 'nebula'))


def scene_common():
    palette()
    sun((rad(-50), rad(-35), rad(10)), 3.2, (1.0, 0.95, 0.88))
    sun((rad(115), rad(20), 0), 2.0, (1.0, 0.5, 0.35))  # контровой от планеты
    sun((rad(60), rad(-60), 0), 0.5, (0.4, 0.55, 1.0))


def asset_cover():
    reset(samples=128, transparent=False)
    scene_common()
    look_cam((0, -10.5, 4.2), (0.6, 3.5, 0.6), lens=35)
    ship = build_ship(flames=True)
    ship.location = (-1.2, -1.7, 0.7)
    ship.rotation_euler = (rad(10), rad(-22), rad(-12))
    for x in (-0.33, 0.33):
        for y in (2.0, 3.9):
            b = tube('laser', 0.035, 0.7, (0, 0, 0), PAL['laser'], verts=10)
            b.parent = ship
            b.location = (x, y, 0.1)
    for loc, rot in (((1.8, 4.5, 1.2), (rad(25), rad(15), rad(-15))), ((-1.6, 6.5, 1.8), (rad(20), rad(-20), rad(20))),
                     ((0.9, 9.0, 2.6), (rad(30), 0, rad(5)))):
        w = build_wasp()
        w.location = loc
        w.rotation_euler = rot
    c = build_cruiser()
    c.location = (4.4, 12.0, 3.4)
    c.rotation_euler = (rad(28), rad(10), rad(-25))
    c.scale = (1.2,) * 3
    for n, (loc, s) in enumerate((((-4.4, 1.0, -0.4), 1.0), ((3.8, -1.4, -0.2), 0.7),
                                  ((-3.0, 11.0, 1.0), 1.6), ((6.5, 6.5, 0.6), 1.2)), start=1):
        r = build_rock(n, TONES[(n - 1) % 3 + 1])
        r.location = loc
        r.scale = (s, s * 0.85, s * 0.8)
        r.rotation_euler = (n, n * 2, n * 0.5)
    for loc in ((0.9, -0.6, 0.3), (1.5, 0.3, 0.5), (0.5, 1.1, 0.7)):
        cr = build_crystal()
        cr.location = loc
        cr.scale = (0.4,) * 3
        cr.rotation_euler = (rad(30), rad(40), rad(15))
    build_planet(loc=(17, 50, 0), scale=6, tilt=(rad(14), rad(-20), 0))
    nebula_plane(300, 170, loc=(0, 90, 10), rot=(rad(90), 0, 0), tile=False, brightness=2.2)
    glare(0.5)
    render(os.path.join(OUT, 'cover'))


def asset_icon():
    reset(samples=128, transparent=False)
    scene_common()
    look_cam((2.3, -3.6, 4.6), (0.05, -0.15, 0), lens=42, w=512, h=512)
    ship = build_ship(flames=True)
    ship.rotation_euler = (0, rad(-14), rad(-28))
    nebula_plane(160, 160, loc=(0, 0, -8), tile=False, brightness=1.8)
    build_planet(loc=(-1.5, 6.5, -4), scale=1.8, ring=False)
    glare(0.4)
    render(os.path.join(OUT, 'icon'))

TONES = {
    1: ((0.12, 0.1, 0.09), (0.42, 0.36, 0.3)),
    2: ((0.1, 0.1, 0.11), (0.38, 0.38, 0.42)),
    3: ((0.14, 0.09, 0.07), (0.5, 0.34, 0.24)),
}
JOBS = {
    'ship': lambda: sprite('ship', build_ship, 4.0, 256),
    'enemy_wasp': lambda: sprite('enemy_wasp', build_wasp, 2.9, 192),
    'enemy_cruiser': lambda: sprite('enemy_cruiser', build_cruiser, 3.0, 224),
    'mine': lambda: sprite('mine', build_mine, 1.7, 128, rot=(rad(20), rad(10), 0)),
    'rock1': lambda: asset_rock(1, TONES[1]),
    'rock2': lambda: asset_rock(2, TONES[2]),
    'rock3': lambda: asset_rock(3, TONES[3]),
    'crystal': lambda: sprite('crystal', build_crystal, 1.6, 128, rot=(rad(25), rad(30), 0)),
    'planet': asset_planet,
    'nebula': asset_nebula,
    'cover': asset_cover,
    'icon': asset_icon,
}

for name, job in JOBS.items():
    if not ONLY or name in ONLY:
        job()
print('[starpatrol] готово', flush=True)
