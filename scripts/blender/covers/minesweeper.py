# «Сапёр»: несколько выпуклых синих клеток (как в игре), одна открыта: в тёмной ямке круглая мультяшная мина
# с короткими толстыми шипами, чуть подпрыгнула. На соседней клетке воткнут красный флажок.
# Цифры не ставим: в карточке мелкая цифра на плоской клетке не читается. Фон стальной серо-синий, красный только у флажка.
from common import *
import bmesh

S, GAP = 1.2, 0.12


def look(target, dist, az, el):
    """Точка камеры: az — поворот вправо от оси −Y, el — высота над героем (градусы)."""
    t = Vector(target)
    return (t.x + dist * math.sin(rad(az)) * math.cos(rad(el)),
            t.y - dist * math.cos(rad(az)) * math.cos(rad(el)),
            t.z + dist * math.sin(rad(el)))


def at(c, r):
    return (c * (S + GAP), r * (S + GAP))


def mine(r=0.8):
    """Шар и десять коротких толстых конусов-шипов, как значок мины в игре, только объёмный."""
    m = mat('mine', '#252A50', rough=0.26, coat=0.7)
    parts = [sphere(r, (0, 0, 0), m)]
    k = 1 / math.sqrt(2)
    dirs = [(1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (k, 0, k), (-k, 0, k), (k, 0, -k), (-k, 0, -k),
            (0, -1, 0), (0, 1, 0)]
    for d in dirs:
        v = Vector(d)
        o = cone(0.2, 0.09, 0.42, tuple(v * (r + 0.1)), m)
        o.rotation_euler = v.to_track_quat('Z', 'Y').to_euler()
        parts.append(o)
    return parts


def prism(pts, depth, loc, m):
    """Плоская фигура из точек (x, z), выдавленная по y на depth, со скруглёнными рёбрами."""
    me = bpy.data.meshes.new('prism')
    bm = bmesh.new()
    a = [bm.verts.new((x, -depth / 2, z)) for x, z in pts]
    b = [bm.verts.new((x, depth / 2, z)) for x, z in pts]
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('prism', me)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.data.materials.append(m)
    bv = o.modifiers.new('bevel', 'BEVEL')
    bv.width, bv.segments, bv.limit_method = 0.06, 4, 'ANGLE'
    for p in me.polygons:
        p.use_smooth = True
    return o


def flag():
    pole_m = toy('pole', '#EDEFFB', 0.35)
    red = mat('flag', '#F0233F', rough=0.4, coat=0.3)
    return [cylinder(0.09, 2.2, (0, 0, 1.1), pole_m, bevel=0.04, verts=32),
            sphere(0.15, (0, 0, 2.22), pole_m),
            cylinder(0.32, 0.14, (0, 0, 0.07), pole_m, bevel=0.05, verts=48),
            prism([(0.05, 2.15), (1.15, 1.72), (0.05, 1.25)], 0.16, (0, 0, 0), red)]


def scene():
    reset()
    backdrop('#A9B8D2', '#5A6E92', floor='#56698C', glow=0.1)
    cellm = toy('cell', '#4E63E6', 0.36)
    openm = toy('open', '#1A2050', 0.55)
    parts = []
    closed = [(-1, 1), (0, 1), (1, 1), (-1, 0), (1, 0), (0, -1), (1, -1)]
    for c, r in closed:
        x, y = at(c, r)
        parts.append(box((S, S, 0.5), (x, y, 0.25), cellm, bevel=0.18, segments=8))
    # Открытая клетка: низкая тёмная плитка, в ней мина.
    for c, r in [(0, 0)]:
        x, y = at(c, r)
        parts.append(box((S, S, 0.14), (x, y, 0.07), openm, bevel=0.06, segments=4))
    field = parent(parts, name='field')
    field.rotation_euler = (0, 0, rad(-18))
    x, y = at(0, 0)
    mn = parent(mine(), loc=(x, y, 1.3), rot=(0, 18, 8), name='mine')
    mn.parent = field
    fx, fy = at(1, 1)
    fl = parent(flag(), loc=(fx, fy, 0.5), rot=(0, -6, 10), name='flag')
    fl.scale = (0.85, 0.85, 0.85)
    fl.parent = field
    tgt = (0.25, 0.3, 0.7)
    lights(target=tgt, key=900, fill=0.33, rim=1.0)
    backlight((0.3, 6.8, 2.8), power=650, size=7, color=(0.92, 0.95, 1.0))
    camera(loc=look(tgt, 20.5, 28, 27), target=tgt, lens=85, shift_x=0.12, dof=2.8)


def cone(r1, r2, h, loc, m):
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=r1, radius2=r2, depth=h, location=loc)
    o = bpy.context.active_object
    o.data.materials.append(m)
    bv = o.modifiers.new('bevel', 'BEVEL')
    bv.width, bv.segments, bv.limit_method = 0.05, 4, 'ANGLE'
    for p in o.data.polygons:
        p.use_smooth = True
    return o
