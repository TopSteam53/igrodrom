# «Звёздный патруль»: серебристый истребитель игры (форма из scripts/blender/starpatrol.py, укрупнена до игрушки)
# крупно, крыльями к камере, летит вверх-влево, две жёлтые очереди бьют в крупный астероид. Глубокий сине-фиолетовый
# космос, акцент — оранжевые полосы и яркое пламя двигателей.
import bmesh
from mathutils import Matrix
from common import *


def orbit(target, dist, elev, yaw):
    t = Vector(target)
    e, y = rad(elev), rad(yaw)
    return (t.x + dist * math.cos(e) * math.sin(y), t.y - dist * math.cos(e) * math.cos(y), t.z + dist * math.sin(e))


def prism(name, pts, z0, z1, m, mirror=False, bevel=0.03):
    """Плоская деталь: многоугольник pts в плоскости XY толщиной z0..z1 (крылья, полосы)."""
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
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(m)
    b = o.modifiers.new('bevel', 'BEVEL')
    b.width, b.segments, b.limit_method = bevel, 4, 'ANGLE'
    if mirror:
        o.modifiers.new('mirror', 'MIRROR').use_axis[0] = True
    for p in me.polygons:
        p.use_smooth = True
    return o


def ship():
    hull = mat('hull', '#E4EAF6', rough=0.3, metal=0.25, coat=0.5)
    dark = toy('dark', '#2B3150', 0.4)
    accent = toy('accent', '#FF8A1A', 0.32)
    glass = mat('glass', '#0E4C9A', rough=0.06, coat=1, emit=1.2, emit_color='#3FA8FF')
    engine = mat('engine', '#FFD080', emit=25, emit_color='#FFA040')
    flame = mat('flame', '#FFE2A0', emit=22, emit_color='#FF9A30', alpha=0.9)
    o = []
    # корпус: вытянутая капля, нос по +Y
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1)
    body = bpy.context.active_object
    for v in body.data.vertices:
        x, y, z = v.co
        k = max(0.0, y) ** 1.3
        x *= 0.42 * (1 - 0.7 * k) * (1 + 0.28 * max(0.0, -y))
        z *= 0.4 * (1 - 0.45 * k)
        v.co = (x, y * 1.75, z)
    for p in body.data.polygons:
        p.use_smooth = True
    body.data.materials.append(hull)
    o.append(body)
    o.append(sphere(1, (0, 0.5, 0.2), glass, scale=(0.17, 0.46, 0.15), name='cockpit'))
    o.append(prism('wing', [(0.2, 0.25), (0.2, -0.85), (1.6, -1.1), (1.66, -0.72)], -0.1, 0.1, hull, mirror=True, bevel=0.06))
    o.append(prism('stripe', [(0.36, 0.02), (0.36, -0.2), (1.55, -0.95), (1.6, -0.76)], 0.09, 0.13, accent, mirror=True, bevel=0.02))
    for sx in (1, -1):
        o.append(cylinder(0.11, 0.8, (1.64 * sx, -0.85, 0.02), dark, bevel=0.04, rot=(90, 0, 0), name='pod'))
        o.append(cylinder(0.2, 0.8, (0.34 * sx, -1.4, 0.02), dark, bevel=0.05, rot=(90, 0, 0), name='engine'))
        o.append(cylinder(0.215, 0.12, (0.34 * sx, -1.1, 0.02), accent, bevel=0.03, rot=(90, 0, 0), name='ring'))
        o.append(cylinder(0.14, 0.06, (0.34 * sx, -1.81, 0.02), engine, bevel=0.02, rot=(90, 0, 0), name='nozzle'))
        bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=0.19, radius2=0.0, depth=1.5,
                                        location=(0.34 * sx, -2.55, 0.02), rotation=(rad(90), 0, 0))
        f = bpy.context.active_object
        f.data.materials.append(flame)
        for p in f.data.polygons:
            p.use_smooth = True
        o.append(f)
    return o


def rock(r, loc, m, seed, name):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=r, location=loc)
    o = bpy.context.active_object
    o.name = name
    tex = bpy.data.textures.new(name + 'tex', 'CLOUDS')
    tex.noise_scale = 0.5 * r
    tex.noise_depth = 1
    d = o.modifiers.new('disp', 'DISPLACE')
    d.texture, d.strength, d.mid_level = tex, 0.4 * r, 0.5
    d.texture_coords = 'OBJECT'
    o.rotation_euler = (seed, seed * 1.7, seed * 0.6)
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(m)
    return o


def point(name, loc, power, color, radius=0.3):
    d = bpy.data.lights.new(name, 'POINT')
    d.energy, d.color, d.shadow_soft_size = power, color, radius
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    return o


def orient(o, forward, up):
    """Повернуть объект: его +Y смотрит по forward, +Z — примерно по up."""
    f = Vector(forward).normalized()
    u = (Vector(up) - f * Vector(up).dot(f)).normalized()
    x = f.cross(u)
    o.rotation_euler = Matrix((x, f, u)).transposed().to_euler()


def scene():
    reset()
    bpy.context.scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.08
    bpy.context.scene.view_settings.exposure = -0.35
    # глубокий космос: насыщенный сине-фиолетовый, светлее за героем
    backdrop('#5A4BE6', '#1A1462', floor='#211A70', glow=0.10)

    # истребитель: крупный, крылья развёрнуты к камере, нос вверх-влево на астероид
    s = parent(ship(), loc=(1.35, 0.0, 1.45), name='ship')
    orient(s, (-0.8, -0.1, 0.58), (0.1, -1.0, 0.3))
    S = 1.12
    s.scale = (S, S, S)
    bpy.context.view_layer.update()
    M = s.matrix_world
    # свет от пламени двигателей
    point('flameLight', tuple(M @ Vector((0, -2.6, 0))), 900, (1.0, 0.62, 0.25), radius=0.4)

    # очереди: длинные светящиеся капсулы от носа к астероиду
    laser = mat('laser', '#FFF0B0', emit=18, emit_color='#FFD460')
    for sx in (1, -1):
        for d in (1.6, 2.2):
            p = M @ Vector((0.32 * sx, d, 0.05))
            c = sphere(0.08, tuple(p), laser, scale=(0.8, 6.5, 0.8), name='laser')
            c.rotation_euler = s.rotation_euler

    # крупный астероид впереди, место попадания светится; два отколотых куска
    stone = mat('stone', '#8C7A72', rough=0.92)
    hit = M @ Vector((0, 2.75, 0))
    back = (M.to_3x3() @ Vector((0, -1, 0))).normalized()  # к кораблю
    rock(0.8, tuple(hit + back * -0.45), stone, 0.7, "rock")
    rock(0.3, tuple(hit + Vector((0.95, -0.2, 0.45))), stone, 1.9, 'chunk1')
    rock(0.22, tuple(hit + Vector((-0.55, -0.4, -0.75))), stone, 2.6, 'chunk2')
    flash = mat('flash', '#FFE09A', emit=16, emit_color='#FF9A30', alpha=0.85)
    sphere(0.34, tuple(hit + back * 0.32), flash, name='flash')
    point('hitLight', tuple(hit + back * 0.7), 500, (1.0, 0.7, 0.35), radius=0.3)

    lights(target=(1.0, 0.2, 2.0), key=1000, fill=0.22, rim=1.4)
    backlight((0.8, 7.0, 3.2), power=900, size=7, color=(0.85, 0.85, 1.0))
    t = tuple((Vector(s.location) * 1.25 + hit * 0.75) / 2 + Vector((0, 0, -0.38)))
    camera(loc=orbit(t, 28, 10, -16), target=t, lens=85, shift_x=0.07, dof=2.2)
