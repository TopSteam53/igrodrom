# «Крестики-нолики»: мягкая кремовая сетка 3×3 лежит на полу, в клетке пухлый красный крестик,
# а бирюзовый нолик катится на ребре к соседней клетке, слегка наклонившись. Цвета знаков как в игре
# (--x и --o в public/games/tictactoe/index.html), фон коралловый.
from common import *

CELL = 1.45
X_COL, O_COL = '#D0123E', '#0896CC'


def look(target, dist, az, el):
    """Точка камеры: az — поворот вправо от оси −Y, el — высота над героем (градусы)."""
    t = Vector(target)
    return (t.x + dist * math.sin(rad(az)) * math.cos(rad(el)),
            t.y - dist * math.cos(rad(az)) * math.cos(rad(el)),
            t.z + dist * math.sin(rad(el)))


def bar(length, thick, loc, rot_z, m):
    """Пухлая палочка: брусок с фаской почти в половину толщины."""
    return box((length, thick, thick), loc, m, bevel=thick / 2 - 0.03, segments=8, rot=(0, 0, rot_z))


def cross(m, size=1.25, thick=0.4):
    # Вторая палочка чуть выше первой: совпавшие верхние грани дают чёрные точки в рендере.
    return [bar(size, thick, (0, 0, 0), 45, m), bar(size, thick * 1.03, (0, 0, 0.02), -45, m)]


def scene():
    reset()
    backdrop('#FFB8A3', '#EE7A64', floor='#EA735E', glow=0.1)
    gm = toy('grid', '#FFF1E8', 0.45)
    L = CELL * 3 + 0.3
    th = 0.3
    parts = [bar(L, th, (0, -CELL / 2, th / 2), 0, gm), bar(L, th, (0, CELL / 2, th / 2), 0, gm),
             bar(L, th * 1.03, (-CELL / 2, 0, th / 2 + 0.02), 90, gm), bar(L, th * 1.03, (CELL / 2, 0, th / 2 + 0.02), 90, gm)]
    grid = parent(parts, name='grid')
    grid.rotation_euler = (0, 0, rad(-8))
    xm = mat('x', X_COL, rough=0.36, coat=0.35)
    om = mat('o', O_COL, rough=0.34, coat=0.35)
    # Крестик лежит в левой нижней клетке, приподнят на толщину.
    x = parent(cross(xm), loc=(-CELL, -CELL, 0.2), rot=(0, 0, 8), name='x')
    x.parent = grid
    # Второй крестик в центре — партия в разгаре.
    x2 = parent(cross(xm), loc=(0, 0, 0.2), rot=(0, 0, -4), name='x2')
    x2.parent = grid
    # Нолик стоит на ребре и катится вправо, чуть завален на камеру.
    o = torus(0.62, 0.27, (0, 0, 0), om, rot=(90, 0, 0), name='o')
    op = parent([o], loc=(CELL * 0.95, -CELL * 0.4, 0.92), rot=(-8, 12, 22), name='opart')
    op.parent = grid
    tgt = (0.3, 0, 0.25)
    lights(target=tgt, key=900, fill=0.33, rim=0.9)
    backlight((0.3, 6.8, 2.8), power=600, size=7)
    camera(loc=look(tgt, 17.5, 26, 30), target=tgt, lens=85, shift_x=0.175, dof=2.8)
