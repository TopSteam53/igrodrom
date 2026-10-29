# «Шашки»: дамка (две кремовые шашки стопкой с золотой короной) на углу доски, рядом тёмная шашка соперника
# подлетает, будто её только что взяли. Винно-красная студия, шашки кремовые.
from common import *
from common import _finish


def cam3q(target, dist, yaw, pitch, lens=85, shift=0.12, fstop=4.0):
    """Камера три четверти: yaw — поворот вокруг героя (плюс — вправо), pitch — подъём над ним, в градусах."""
    t = Vector(target)
    d = Vector((math.sin(rad(yaw)) * math.cos(rad(pitch)), -math.cos(rad(yaw)) * math.cos(rad(pitch)), math.sin(rad(pitch))))
    return camera(loc=tuple(t + d * dist), target=target, lens=lens, shift_x=shift, dof=fstop)


def rig(target, yaw, key=800, fill=0.32, rim=1.0, dist=4.0):
    """Свет от направления камеры: ключ слева-сверху на 40 градусов от её оси, заполняющий справа у камеры,
    контровой сзади справа сверху."""
    t = Vector(target)

    def at(az, el, r):
        a, e = rad(az), rad(el)
        return tuple(t + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * r)
    area('key', at(yaw - 42, 42, dist), target, key, 1.8, (1.0, 0.93, 0.84))
    area('fill', at(yaw + 35, 15, dist * 1.1), target, key * fill, 3.0, (0.84, 0.9, 1.0))
    area('rim', at(yaw + 150, 45, dist * 0.9), target, key * rim, 0.8, (1.0, 0.95, 0.92))


def checker(m, ring_m, r=0.5, h=0.2, z=0.0):
    """Шашка: толстая таблетка с одним крупным валиком по верху (мельче — пропадёт на карточке)."""
    body = cylinder(r, h, (0, 0, z + h / 2), m, bevel=0.07)
    ring = torus(r * 0.62, 0.045, (0, 0, z + h - 0.005), ring_m)
    return [body, ring]


def crown(m, r=0.3, z=0.0):
    parts = [cylinder(r, 0.14, (0, 0, z + 0.07), m, bevel=0.04)]
    for i in range(5):
        a = i / 5 * math.tau + rad(90)
        x, y = math.cos(a) * r * 0.88, math.sin(a) * r * 0.88
        bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.11, radius2=0.025, depth=0.26, location=(x, y, z + 0.25))
        c = bpy.context.active_object
        _finish(c, m, 0, 0)
        parts.append(c)
        parts.append(sphere(0.055, (x * 1.02, y * 1.02, z + 0.39), m))
    return parts


YAW = 32  # камера
TURN = 8  # доска повёрнута меньше камеры: видны её передний и боковой край


def scene():
    sc = reset()
    sc.view_settings.exposure = -0.6  # иначе AgX выбеливает винный цвет до розового
    backdrop('#B02A48', '#4E0C1C', floor='#5E1224', glow=0.05)
    # угол доски: 2 клетки в ширину и 3 в глубину, края параллельны кадру; дамка на угловой тёмной клетке,
    # доска уходит вправо и назад и целиком помещается в кадр
    S = 1.02
    board_m = mat('board', '#33060F', rough=0.55)
    dark_sq = mat('sq_dark', '#3A0510', rough=0.55)  # глубокое вино: кремовая дамка на нём светится
    light_sq = mat('sq_light', '#A8243B', rough=0.6)
    parts = [box((S * 2 + 0.3, S * 3 + 0.3, 0.3), (S * 0.5, S * 1.0, 0.15), board_m, bevel=0.12)]
    for i in range(2):
        for j in range(3):
            m = dark_sq if (i + j) % 2 == 0 else light_sq
            parts.append(box((S - 0.05, S - 0.05, 0.08), (S * i, S * j, 0.32), m, bevel=0.03, segments=3))
    parent(parts, rot=(0, 0, TURN), name='board')

    cream = toy('cream', '#F4E7CF', 0.36)
    cream_ring = toy('cream_ring', '#E6D3B2', 0.4)
    gold = mat('gold', '#F2B23A', rough=0.28, metal=0.6, coat=0.3)
    k = checker(cream, cream_ring, z=0.0) + checker(cream, cream_ring, z=0.205) + crown(gold, z=0.4)
    parent(k, loc=(0, 0, 0.36), name='king')
    # шашка соперника подпрыгнула над соседней по диагонали тёмной клеткой: в воздухе, с наклоном,
    # под ней на доске её тень
    a = rad(TURN)
    x, y = S * math.cos(a) - S * math.sin(a), S * math.sin(a) + S * math.cos(a)
    dark = toy('dark', '#2E1218', 0.34)
    dark_ring = toy('dark_ring', '#47202A', 0.38)
    parent(checker(dark, dark_ring), loc=(x, y, 0.8), rot=(34, -14, 20), name='captured')

    backlight((0.8, 7.0, 1.6), power=1100, size=7.0, color=(1.0, 0.86, 0.86))
    rig((0.3, 0.3, 0.6), yaw=YAW, key=900)
    cam3q((0.35, 0.45, 0.72), 13.6, yaw=YAW, pitch=25, shift=0.12, fstop=5.6)
