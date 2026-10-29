# «Блок-пазл»: кусок поля 6×6 почти заполнен синими блоками, в нём осталась дырка в форме буквы «Т».
# Над ней висит крупная тёплая фигура из 4 блоков (жёлто-оранжевая, цвета из палитры игры) и вот-вот встанет,
# закрыв два ряда. Поле лежит на полу, фигура парит: её тень на поле даёт глубину. Фон кобальтовый синий.
from common import *
import random

C, GAP = 0.66, 0.06
N = 6
# Синие цвета из COL в public/games/blockpuzzle/index.html: занятые клетки одного холодного тона.
COOL = ['#3B7BFF', '#5A92FF', '#2F63E8']
PIECE = '#FFB21F'
# Дырка «Т»: три клетки в ряду 2 и одна под средней в ряду 3 (ряды сверху вниз, столбцы слева направо).
HOLE = {(2, 2), (3, 2), (4, 2), (3, 3)}


def look(target, dist, az, el):
    """Точка камеры: az — поворот вправо от оси −Y, el — высота над героем (градусы)."""
    t = Vector(target)
    return (t.x + dist * math.sin(rad(az)) * math.cos(rad(el)),
            t.y - dist * math.cos(rad(az)) * math.cos(rad(el)),
            t.z + dist * math.sin(rad(el)))


def cell(c, r):
    st = C + GAP
    return ((c - (N - 1) / 2) * st, ((N - 1) / 2 - r) * st)


def block(x, y, z, m, s=C, h=0.32):
    return box((s, s, h), (x, y, z + h / 2), m, bevel=0.13, segments=6)


def scene():
    reset()
    backdrop('#6F9BFF', '#2648C8', floor='#2A4CC6', glow=0.12)
    random.seed(7)
    mats = [toy(f'cool{i}', c, 0.36) for i, c in enumerate(COOL)]
    side = N * C + (N - 1) * GAP
    parts = [box((side + 0.4, side + 0.4, 0.3), (0, 0, 0.15), toy('board', '#1A2160', 0.5), bevel=0.18, segments=8),
             box((side + 0.04, side + 0.04, 0.06), (0, 0, 0.3), toy('bed', '#11164A', 0.6), bevel=0.02, segments=2)]
    for r in range(N):
        for c in range(N):
            if (c, r) in HOLE:
                continue
            x, y = cell(c, r)
            parts.append(block(x, y, 0.32, random.choice(mats)))
    board = parent(parts, name='board')
    board.rotation_euler = (rad(14), 0, rad(12))
    board.location = (0, 0, 0.6)
    # Фигура «Т» над дыркой: чуть больше клеток поля, наклонена, опускается.
    pm = mat('piece', PIECE, rough=0.32, coat=0.4)
    cx, cy = cell(3, 2)
    piece = []
    for (c, r) in HOLE:
        x, y = cell(c, r)
        piece.append(block((x - cx) * 1.2, (y - cy) * 1.2, 0, pm, s=C * 1.2, h=0.38))
    p = parent(piece, loc=(cx + 0.75, cy - 0.15, 1.45), rot=(10, -16, -4), name='piece')
    p.parent = board
    tgt = (0.25, -0.1, 1.15)
    lights(target=tgt, key=850, fill=0.33, rim=1.0)
    backlight((0.3, 6.8, 2.8), power=650, size=7, color=(0.9, 0.94, 1.0))
    camera(loc=look(tgt, 24, 28, 28), target=tgt, lens=85, shift_x=0.17, dof=2.8)
