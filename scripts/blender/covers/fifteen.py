# «Пятнашки»: лоток 4×4 приподнят к камере, ряды плиток в цветах игры (красный, оранжевый, зелёный, синий).
# Плитка «15» съезжает в пустую клетку справа внизу и чуть приподнята. Числа только на трёх плитках у пустого места,
# иначе в карточке это мелкая каша. Фон абрикосовый.
from common import *

# Цвета рядов из public/games/fifteen/index.html (PAL): строка 0, 1, 2, 3 берёт PAL[0], PAL[1], PAL[3], PAL[4].
ROWS = ['#F0505E', '#FF9A2E', '#22C47C', '#2E86F5']
T, GAP = 1.0, 0.1


def look(target, dist, az, el):
    """Точка камеры: az — поворот вправо от оси −Y, el — высота над героем (градусы)."""
    t = Vector(target)
    return (t.x + dist * math.sin(rad(az)) * math.cos(rad(el)),
            t.y - dist * math.cos(rad(az)) * math.cos(rad(el)),
            t.z + dist * math.sin(rad(el)))


def cell(c, r):
    """Центр клетки (столбец c, строка r сверху) в координатах лотка."""
    st = T + GAP
    return ((c - 1.5) * st, (1.5 - r) * st)


def tile(n, r, x, y, z, ink='#FFFFFF'):
    h = 0.42
    parts = [box((T, T, h), (x, y, z + h / 2), toy(f'row{r}', ROWS[r], 0.36), bevel=0.16, segments=8)]
    if n:
        parts.append(text(str(n), size=0.62, depth=0.1, loc=(x, y, z + h + 0.01), rot=(0, 0, 0),
                          m=toy('ink', ink, 0.3), bevel=0.015))
    return parts


def scene():
    reset()
    backdrop('#FFCB8E', '#E88C3E', floor='#E2843A', glow=0.1)
    frame = toy('frame', '#FFF1E2', 0.45)
    inner = toy('bed', '#7A3518', 0.6)
    side = 4 * T + 3 * GAP
    parts = [box((side + 0.5, side + 0.5, 0.3), (0, 0, 0.15), frame, bevel=0.2, segments=8),
             box((side + 0.06, side + 0.06, 0.1), (0, 0, 0.28), inner, bevel=0.04, segments=3)]
    n = 1
    for r in range(4):
        for c in range(4):
            if (r, c) in ((3, 3), (3, 2)):
                n += 1
                continue
            x, y = cell(c, r)
            parts += tile(n if n in (11, 12, 14) else 0, r, x, y, 0.32)
            n += 1
    tray = parent(parts, loc=(0, 0, 0), name='tray')
    # «15» едет вправо в пустую клетку: уже на полпути и приподнята над лотком.
    x, y = cell(2, 3)
    fifteen = tile(15, 3, 0, 0, 0)
    parent(fifteen, loc=(x + 0.32, y - 0.06, 0.7), rot=(5, -10, 6), name='t15').parent = tray
    tray.location = (0, 0, 1.55)
    tray.rotation_euler = (rad(36), 0, rad(8))
    tgt = (0, 0, 1.6)
    lights(target=tgt, key=850, fill=0.35, rim=0.8)
    backlight((0.3, 6.8, 3.2), power=600, size=7)
    camera(loc=look(tgt, 31, 26, 24), target=tgt, lens=85, shift_x=0.19, dof=2.8)
