# «Бусинки»: доска-картина из бусин стоит с наклоном, на ней красное сердце на белом. Угол картины уже
# разобран (видны пустые штырьки), а десять красных бусин собрались в нитку и висят дугой перед доской. Мятный фон.
from common import *

P = 0.3            # шаг сетки
N = 7              # бусин в ряду
HEART = ['.......',
         '.XX.XX.',
         'XXXXXXX',
         'XXXXXXX',
         '.XXXXX.',
         '..XXX..',
         '...X...']
# Уже забранные клетки: правый верхний угол и кусок сердца рядом с ним.
TAKEN = {(0, 4), (0, 5), (0, 6), (1, 5), (1, 6), (2, 6), (1, 4), (2, 5)}


def bead(m, loc=(0, 0, 0), rot=(0, 0, 0), name='bead'):
    """Бусина: почти шар с ямкой-дырочкой посередине, как в игре (бублик, у которого трубка толще дырки)."""
    return torus(0.05, 0.1, loc, m, rot=rot, name=name)


def scene():
    reset()
    backdrop('#a6ecd2', '#2f9a7a', floor='#3aa383', glow=0.08)
    red = mat('red', '#f2183c', rough=0.22, coat=0.45)
    white = mat('white', '#f4f6f2', rough=0.3, coat=0.35)
    board_m = toy('board', '#2b7f86', 0.5)
    peg_m = toy('peg', '#3d9aa0', 0.5)
    side = N * P + 0.24
    items = [box((side, side, 0.12), (0, 0, -0.06), board_m, bevel=0.08, segments=5, name='board')]
    for r in range(N):
        for c in range(N):
            x, y = (c - (N - 1) / 2) * P, ((N - 1) / 2 - r) * P
            if (r, c) in TAKEN:
                items.append(cylinder(0.035, 0.14, (x, y, 0.07), peg_m, bevel=0.015, verts=24, name='peg'))
                continue
            m = red if HEART[r][c] == 'X' else white
            items.append(bead(m, (x, y, 0.1)))
    # Доска стоит, откинувшись назад, и чуть повёрнута к камере.
    parent(items, loc=(0.1, 0.5, side / 2 * 0.81 + 0.03), rot=(54, 0, -18), name='board_g')
    # Готовая нитка: десять красных бусин, замкнутых в кольцо, лежит перед доской справа, приподнята к камере.
    RR = 0.37
    thread = mat('thread', '#f7f0e0', rough=0.5)
    ring = [torus(RR, 0.014, (0, 0, 0), thread, name='thread')]
    for i in range(10):
        a = 2 * math.pi * i / 10
        p = (RR * math.cos(a), RR * math.sin(a), 0)
        # ось дырочки по касательной к кольцу
        ring.append(bead(red, p, rot=(90, 0, math.degrees(a)), name='sbead'))
    parent(ring, loc=(1.6, -0.95, 0.3), rot=(34, 8, 20), name='ring')
    lights(target=(0.6, 0, 0.9), key=950, fill=0.3, rim=1.1)
    backlight((0.8, 6.5, 2.4), power=1200, size=5.5, color=(0.97, 1.0, 0.98))
    camera(loc=(4.75, -15.0, 7.3), target=(0.55, 0, 0.82), lens=85, shift_x=0.12, dof=5.6)
