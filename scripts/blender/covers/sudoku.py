# «Судоку»: квадрат 3×3 из толстых кремовых плиток (как бумажное поле игры) на тёмно-синей подставке.
# Одна плитка выбрана (оранжевая, как выделение в игре) и поднята над полем, на ней синяя цифра игрока;
# ещё две цифры тёмные, как заданные. Остальные клетки пустые: так в карточке видно три крупные цифры, а не сетку.
from common import *

T, GAP = 1.15, 0.12


def look(target, dist, az, el):
    """Точка камеры: az — поворот вправо от оси −Y, el — высота над героем (градусы)."""
    t = Vector(target)
    return (t.x + dist * math.sin(rad(az)) * math.cos(rad(el)),
            t.y - dist * math.cos(rad(az)) * math.cos(rad(el)),
            t.z + dist * math.sin(rad(el)))


def cell(c, r):
    st = T + GAP
    return ((c - 1) * st, (1 - r) * st)


def tile(digit, color, ink, x, y, z, h=0.42):
    parts = [box((T, T, h), (x, y, z + h / 2), toy(f'tile{color}', color, 0.4), bevel=0.16, segments=8)]
    if digit:
        parts.append(text(digit, size=0.78, depth=0.1, loc=(x, y + 0.02, z + h + 0.01), rot=(0, 0, 0),
                          m=toy(f'ink{ink}', ink, 0.3), bevel=0.016))
    return parts


def scene():
    reset()
    backdrop('#4767C9', '#1F2F78', floor='#1D2C72', glow=0.12)
    side = 3 * T + 2 * GAP
    parts = [box((side + 0.42, side + 0.42, 0.32), (0, 0, 0.16), toy('base', '#2A2F6E', 0.5), bevel=0.18, segments=8)]
    given = {(0, 0): '5', (2, 1): '3'}
    pick = (1, 1)
    for r in range(3):
        for c in range(3):
            if (c, r) == pick:
                continue
            x, y = cell(c, r)
            parts += tile(given.get((c, r)), '#FFF0D2', '#2B1838', x, y, 0.3)
    block = parent(parts, name='block')
    # Выбранная клетка поднята и повёрнута: в неё только что поставили «7».
    x, y = cell(*pick)
    up = tile('7', '#FFB43C', '#2456CC', 0, 0, 0)
    parent(up, loc=(x - 0.25, y - 0.55, 1.5), rot=(26, -16, 10), name='pick').parent = block
    block.location = (0, 0, 1.25)
    block.rotation_euler = (rad(34), 0, rad(8))
    tgt = (0.1, 0, 1.45)
    lights(target=tgt, key=850, fill=0.33, rim=1.0)
    backlight((0.3, 6.8, 3.2), power=700, size=7, color=(0.85, 0.9, 1.0))
    camera(loc=look(tgt, 24.5, 26, 24), target=tgt, lens=85, shift_x=0.145, dof=2.8)
