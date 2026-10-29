# «Слово дня»: пять толстых плиток уходят дугой вглубь, ближняя зелёная с буквой О, соседняя жёлтая
# переворачивается в воздухе (так игра открывает цвет буквы). Буквы только на двух плитках. Тёплая песочная студия.
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


T, D = 1.0, 0.34  # сторона плитки и толщина


def tile(m, letter=None, letter_m=None):
    """Плитка стоит лицом к −Y, низ на z = 0 (в своих координатах)."""
    parts = [box((T, D, T), (0, 0, T / 2), m, bevel=0.13, segments=6)]
    if letter:
        parts.append(text(letter, size=0.7, depth=0.08, loc=(0, -D / 2 - 0.005, T / 2 - 0.01), rot=(90, 0, 0), m=letter_m, bevel=0.014))
    return parts


def scene():
    sc = reset()
    sc.view_settings.exposure = -0.7
    backdrop('#F0D6A8', '#A57D4E', floor='#BC9462', glow=0.05)
    green = toy('green', '#0E9E48', 0.36)
    yellow = toy('yellow', '#F39A00', 0.36)
    gray = toy('gray', '#7E7A78', 0.45)
    white = toy('white', '#FBF6EC', 0.3)
    brown = toy('brown', '#4A2A06', 0.35)  # на жёлтой плитке буква тёмная, как в игре

    # дуга от дальней левой плитки к ближней правой; угол каждой плитки чуть другой — получается веер
    row = [(gray, None, 0), (yellow, None, 0), (green, None, 0), (yellow, 'В', 1), (green, 'О', 0)]
    step = 1.12
    for i, (m, ch, flip) in enumerate(row):
        k = 4 - i  # 0 — ближняя плитка
        # дуга: каждая следующая плитка левее и глубже, с небольшим загибом
        x, y = -k * 0.98 + 0.05 * k * k, k * 0.62 + 0.04 * k * k
        g = parent(tile(m, ch, brown if m is yellow else white), name=f'tile{i}')
        if flip:
            # переворот вокруг горизонтальной оси: плитка подброшена и наклонена к зрителю
            g.location = (x, y, 0.55)
            g.rotation_euler = (rad(-38), rad(-8), rad(20 - k * 7))
        else:
            g.location = (x, y, 0)
            g.rotation_euler = (0, 0, rad(20 - k * 7))

    backlight((-0.5, 7.0, 1.6), power=900, size=7.0, color=(1.0, 0.95, 0.88))
    rig((0.0, 0.0, 0.6), yaw=18, key=900, rim=0.45)
    cam3q((-1.15, 0.95, 0.68), 13.0, yaw=16, pitch=21, shift=0.11, fstop=5.6)
