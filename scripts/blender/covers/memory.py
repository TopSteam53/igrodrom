# «Мемори»: две открытые карточки с одинаковой звездой (найденная пара, зелёная, как в игре) переворачиваются
# к камере, сзади третья карточка стоит на ребре рубашкой к нам (ромб, как на рубашке в игре). Лавандовый фон.
from common import *
import bmesh

S, D = 1.2, 0.13  # сторона и толщина карточки


def prism(pts, depth, m, bevel=0.05, name='prism'):
    """Призма из плоского контура pts (x, y) толщиной depth, центр по z в 0, со скруглёнными рёбрами."""
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
    bv.angle_limit = rad(30)
    o.modifiers.new('wn', 'WEIGHTED_NORMAL')
    for p in me.polygons:
        p.use_smooth = True
    return o


def rrect(w, h, r, n=8):
    """Контур прямоугольника со скруглёнными углами радиуса r."""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180),
                       (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            a = rad(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def star(R, r):
    return [((R if i % 2 == 0 else r) * math.cos(rad(90 + 36 * i)), (R if i % 2 == 0 else r) * math.sin(rad(90 + 36 * i)))
            for i in range(10)]


def card(face_m, picture, name):
    """Карточка: лицевая сторона +z. picture — объект, который кладётся на лицо."""
    c = prism(rrect(S, S, 0.2), D, face_m, bevel=0.045, name=name)
    picture.location = (0, 0, D / 2 + 0.02)
    picture.parent = c
    return c


def scene():
    reset()
    backdrop('#d6c8fb', '#7a62c8', floor='#8770d2', glow=0.1)
    green = mat('pair', '#1fb85a', rough=0.45)
    gold = mat('star', '#ffd000', rough=0.3, coat=0.2)
    back = mat('back', '#5234b4', rough=0.45)
    rhomb = mat('rhomb', '#b8a4ff', rough=0.4)
    # Пара: обе карточки открыты и наклонены к камере, правая чуть выше, будто только что перевернулась.
    a = card(green, prism(star(0.42, 0.19), 0.1, gold, bevel=0.035, name='starA'), 'cardA')
    a.location, a.rotation_euler = (0.0, -0.4, 0.64), (rad(64), rad(-4), rad(10))
    b = card(green, prism(star(0.42, 0.19), 0.1, gold, bevel=0.035, name='starB'), 'cardB')
    b.location, b.rotation_euler = (1.35, -0.2, 0.9), (rad(58), rad(10), rad(-8))
    # Закрытая карточка сзади слева: стоит на ребре рубашкой к камере.
    c = card(back, prism([(0, 0.42), (0.34, 0), (0, -0.42), (-0.34, 0)], 0.06, rhomb, bevel=0.03, name='rhomb'), 'cardC')
    c.location, c.rotation_euler = (-1.05, 0.7, S / 2 + 0.18), (rad(80), rad(-8), rad(22))
    lights(target=(0.3, 0, 0.7), key=1150, fill=0.25, rim=1.1)
    backlight((0.8, 6.5, 2.4), power=1200, size=5.5, color=(1.0, 0.97, 1.0))
    camera(loc=(3.65, -11.2, 5.45), target=(0.25, 0, 0.82), lens=85, shift_x=0.10, dof=5.6)
