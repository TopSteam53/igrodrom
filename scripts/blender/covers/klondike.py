# «Косынка»: веер из трёх толстых игрушечных карт над зелёным сукном, верхний туз червей выезжает из веера.
# Масти крупные и объёмные, буква только одна (A на тузе). Своя простая колода, без чужих рисунков. Изумрудная студия.
from common import *


def cam3q(target, dist, yaw, pitch, lens=85, shift=0.12, fstop=4.0):
    """Камера три четверти: yaw — поворот вокруг героя (плюс — вправо), pitch — подъём над ним, в градусах."""
    t = Vector(target)
    d = Vector((math.sin(rad(yaw)) * math.cos(rad(pitch)), -math.cos(rad(yaw)) * math.cos(rad(pitch)), math.sin(rad(pitch))))
    return camera(loc=tuple(t + d * dist), target=target, lens=lens, shift_x=shift, dof=fstop)


def rig(target, yaw, key=800, fill=0.32, rim=1.0, dist=4.0):
    """Ключ слева-сверху на 40 градусов от оси камеры, заполняющий справа у камеры, контровой сзади справа."""
    t = Vector(target)

    def at(az, el, r):
        a, e = rad(az), rad(el)
        return tuple(t + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * r)
    area('key', at(yaw - 42, 42, dist), target, key, 1.8, (1.0, 0.93, 0.84))
    area('fill', at(yaw + 35, 15, dist * 1.1), target, key * fill, 3.0, (0.84, 0.9, 1.0))
    area('rim', at(yaw + 150, 45, dist * 0.9), target, key * rim, 0.8, (1.0, 0.95, 0.92))


def shape(pts, depth, m, bevel=0.01, loc=(0, 0, 0), name='shape'):
    """Плоская фигура по контуру pts (x, y) в плоскости XY, выдавленная на depth по Z, с мягкой кромкой."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '2D'
    cu.fill_mode = 'BOTH'
    cu.extrude = depth / 2
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, (x, y) in zip(sp.points, pts):
        p.co = (x, y, 0, 1)
    sp.use_cyclic_u = True
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    if m is not None:
        cu.materials.append(m)
    # кромку делаем фаской по сетке: фаска кривой на острых углах (кончик сердца) даёт иглы
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.active_object
    o.location = loc
    bv = o.modifiers.new('bevel', 'BEVEL')
    bv.width = bevel
    bv.segments = 3
    bv.limit_method = 'ANGLE'
    bv.use_clamp_overlap = True
    bpy.ops.object.shade_smooth_by_angle(angle=rad(35))
    return o


def rounded_rect(w, h, r, n=8):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            a = rad(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def heart(s, n=72, flip=False):
    pts = []
    for k in range(n):
        t = k / n * math.tau
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((x / 32 * s, (y + 2.5) / 32 * s * (-1 if flip else 1)))
    return pts


def diamond(s, n=64, p=1.75):
    pts = []
    for k in range(n):
        t = k / n * math.tau
        c, si = math.cos(t), math.sin(t)
        pts.append((s * 0.38 * math.copysign(abs(c) ** p, c), s * 0.5 * math.copysign(abs(si) ** p, si)))
    return pts


CW, CH, CT = 1.0, 1.42, 0.05


def card(face_m, edge_m, pips):
    """Карта лицом вверх по +Z, верх карты по +Y. pips — список (функция-построитель, x, y)."""
    parts = [shape(rounded_rect(CW, CH, 0.1), CT, edge_m, bevel=0.012, name='card')]
    parts.append(shape(rounded_rect(CW - 0.06, CH - 0.06, 0.08), 0.01, face_m, bevel=0.004, loc=(0, 0, CT / 2 + 0.008), name='face'))
    for build in pips:
        parts += build()
    return parts


def scene():
    sc = reset()
    sc.view_settings.exposure = -0.35
    backdrop('#22B27A', '#08452E', floor='#0C5638', glow=0.06)
    face = mat('face', '#F7EFDD', rough=0.45)
    edge = mat('edge', '#E8DCC2', rough=0.5)
    red = mat('red', '#C40F2C', rough=0.3, coat=0.4)
    black = toy('black', '#232838', 0.32)
    top = CT / 2 + 0.035

    def pip_at(pts, m, x, y, d=0.06):
        return lambda: [shape(pts, d, m, bevel=0.015, loc=(x, y, top), name='pip')]

    def spade_at(s, x, y):
        # пика одним контуром: перевёрнутое сердце, в его выемку снизу вставлена ножка
        pts = heart(s, flip=True)
        cy = pts[0][1]
        pts = [(-0.05 * s, cy), (-0.2 * s, -0.66 * s), (0.2 * s, -0.66 * s), (0.05 * s, cy)] + pts[1:]
        return lambda: [shape(pts, 0.06, black, bevel=0.015, loc=(x, y + s * 0.1, top), name='spade')]

    def letter_at(ch, m, x, y, size):
        return lambda: [text(ch, size=size, depth=0.05, loc=(x, y, top - 0.01), rot=(0, 0, 0), m=m, bevel=0.01)]

    # углы крупные: видна в основном левая верхняя часть нижних карт
    c1 = card(face, edge, [spade_at(0.3, -0.3, 0.5)])
    c2 = card(face, edge, [pip_at(diamond(0.34), red, -0.31, 0.47)])
    ace = card(face, edge, [pip_at(heart(0.7), red, 0.04, -0.12, d=0.08), letter_at('A', red, -0.24, 0.41, 0.5)])

    fan = []
    for i, (parts, ang) in enumerate(((c1, 28), (c2, 8))):
        g = parent(parts, name=f'card{i}')
        # поворот вокруг нижнего края веера
        piv = parent([g], name=f'piv{i}')
        g.location = (0, CH * 0.42, i * 0.09)
        piv.rotation_euler = (0, 0, rad(ang))
        fan.append(piv)
    # туз выехал из веера вверх и чуть повернулся к зрителю
    g = parent(ace, name='ace')
    piv = parent([g], name='piv_ace')
    g.location = (0.05, CH * 0.42 + 0.32, 0.3)
    g.rotation_euler = (rad(-8), rad(10), 0)
    piv.rotation_euler = (0, 0, rad(-18))
    fan.append(piv)
    # весь веер поднят почти вертикально, нижний край над сукном
    parent(fan, loc=(0, 0, 0.32), rot=(68, 0, 0), name='fan')

    backlight((0.4, 7.0, 1.8), power=1000, size=7.0, color=(0.92, 1.0, 0.95))
    rig((0.0, 0.0, 0.9), yaw=-24, key=850, rim=0.9)
    cam3q((0.0, 0.0, 1.12), 11.2, yaw=-24, pitch=22, shift=0.1, fstop=5.6)
