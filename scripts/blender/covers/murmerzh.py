# «Мурмерж»: два одинаковых серых котёнка (первый котик в игре) сталкиваются лбами, над ними искра и кот
# побольше, рыжий (следующий котик после слияния). Свои круглые игрушечные коты. Персиково-розовый фон.
from common import *
import bmesh


def prism(pts, depth, m, bevel=0.03, name='prism'):
    """Плоская фигура из контура pts (x, y) толщиной depth со скруглёнными рёбрами."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, -depth / 2)) for x, y in pts]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    top = [v for v in r['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, depth), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(m)
    bv = o.modifiers.new('bevel', 'BEVEL')
    bv.width, bv.segments, bv.limit_method = bevel, 4, 'ANGLE'
    for p in me.polygons:
        p.use_smooth = True
    return o


def cone(r1, r2, h, loc, m, rot=(0, 0, 0), name='cone'):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=h, vertices=32, location=loc, end_fill_type='TRIFAN',
                                    rotation=[rad(a) for a in rot])
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(m)
    sub = o.modifiers.new('sub', 'SUBSURF')
    sub.levels = sub.render_levels = 2
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def cat(body_m, R, name):
    """Круглый котик-моти: одно яйцо-тело, уши, крупные глаза, нос, щёки, без хвоста (дуга-хвост читалась как ручка чашки). Смотрит в −Y."""
    SX, SY, SZ = 1.0, 0.92, 0.88
    eye = mat('eye', '#2a1c22', rough=0.25, coat=0.6)
    pink = mat('pink', '#ff8fa0', rough=0.5)
    inner = mat('inner', '#ffb3bd', rough=0.55)

    def surf(x, z, out=0.0):
        """Точка на передней поверхности тела по x, z (доли R) с выносом out наружу."""
        k = max(0.0, 1 - x * x - z * z)
        return (x * R * SX, -(math.sqrt(k) * R * SY + out), z * R * SZ)

    parts = [sphere(R, (0, 0, 0), body_m, scale=(SX, SY, SZ), name=f'{name}_body')]
    for s in (-1, 1):
        parts.append(cone(0.34 * R, 0.06 * R, 0.62 * R, (s * 0.52 * R, -0.02 * R, 0.86 * R), body_m, rot=(0, s * 26, 0),
                          name='ear'))
        e = sphere(0.2 * R, (s * 0.55 * R, -0.15 * R, 0.9 * R), inner, scale=(0.7, 0.3, 1.0), name='ear_in')
        e.rotation_euler = (0, rad(s * 26), 0)
        parts.append(e)
        x, y, z = surf(s * 0.33, 0.12, -0.02 * R)
        parts.append(sphere(0.14 * R, (x, y, z), eye, scale=(0.9, 0.6, 1.2), name='eye'))
        x, y, z = surf(s * 0.52, -0.16, -0.03 * R)
        parts.append(sphere(0.11 * R, (x, y, z), pink, scale=(1.1, 0.35, 0.75), name='cheek'))
    x, y, z = surf(0, -0.04, -0.01 * R)
    parts.append(sphere(0.07 * R, (x, y, z), pink, scale=(1.2, 0.7, 0.8), name='nose'))
    return parent(parts, name=name)


def scene():
    reset()
    backdrop('#ffc6b6', '#d2706a', floor='#dc7d72', glow=0.08)
    grey = mat('grey', '#8e98ad', rough=0.55, sss=0.08)
    ginger = mat('ginger', '#ff8a1c', rough=0.5, sss=0.08)
    # Котята внизу сталкиваются, наклонившись друг к другу.
    a = cat(grey, 0.42, 'kitA')
    a.location, a.rotation_euler = (-0.42, 0, 0.38), (0, rad(10), rad(30))
    b = cat(grey, 0.42, 'kitB')
    b.location, b.rotation_euler = (0.42, 0.05, 0.38), (0, rad(-10), rad(-30))
    # Кот побольше над ними: результат слияния.
    c = cat(ginger, 0.62, 'big')
    c.location, c.rotation_euler = (0.05, 0.2, 1.75), (rad(-6), rad(-4), rad(-8))
    # Искра между котятами и большим котом.
    spark = toy('spark', '#ffe46a', 0.3)
    pts = [((0.3 if i % 2 == 0 else 0.08) * math.cos(rad(90 + 45 * i)), (0.3 if i % 2 == 0 else 0.08) * math.sin(rad(90 + 45 * i)))
           for i in range(8)]
    s = prism(pts, 0.07, spark, name='spark')
    s.location, s.rotation_euler = (0.0, -0.45, 0.98), (rad(78), 0, rad(14))
    lights(target=(0, 0, 1.0), key=950, fill=0.3, rim=1.1)
    backlight((0.6, 6.5, 2.4), power=1200, size=5.5, color=(1.0, 0.96, 0.95))
    camera(loc=(3.55, -13.2, 5.9), target=(0.0, 0, 1.15), lens=85, shift_x=0.12, dof=5.6)
