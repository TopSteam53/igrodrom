# «Устный счёт»: крупная мягкая зелёная цифра «5» стоит на полу, вокруг неё кремовые кубики со знаками
# плюс, минус и умножить (знаки — объёмные палочки, а не шрифт). Кубик с плюсом подброшен и вращается.
# Фон салатовый, знаки на кубиках оранжевые: как «+очки» в игре.
from common import *


def look(target, dist, az, el):
    """Точка камеры: az — поворот вправо от оси −Y, el — высота над героем (градусы)."""
    t = Vector(target)
    return (t.x + dist * math.sin(rad(az)) * math.cos(rad(el)),
            t.y - dist * math.cos(rad(az)) * math.cos(rad(el)),
            t.z + dist * math.sin(rad(el)))


def sign_cube(kind, s, cm, sm):
    """Кубик s×s×s, на передней грани (−Y) знак из пухлых палочек: plus, minus или times."""
    parts = [box((s, s, s), (0, 0, 0), cm, bevel=s * 0.2, segments=8)]
    L, t = s * 0.7, s * 0.2
    y = -s / 2 - t * 0.15
    if kind in ('plus', 'minus'):
        parts.append(box((L, t, t), (0, y, 0), sm, bevel=t / 2 - 0.005, segments=6))
    if kind == 'plus':
        parts.append(box((t, t, L), (0, y, 0), sm, bevel=t / 2 - 0.005, segments=6))
    if kind == 'times':
        parts.append(box((L, t, t), (0, y, 0), sm, bevel=t / 2 - 0.005, segments=6, rot=(0, 45, 0)))
        parts.append(box((L, t, t), (0, y, 0), sm, bevel=t / 2 - 0.005, segments=6, rot=(0, -45, 0)))
    return parts


def scene():
    reset()
    backdrop('#D4F08C', '#8CC43A', floor='#86BE36', glow=0.1)
    digit = mat('digit', '#2FAE3A', rough=0.55, coat=0.15, sss=0.08)
    d = text('5', size=3.8, depth=0.9, loc=(0, 0, 0), rot=(90, 0, 0), m=digit, bevel=0.07)
    d.data.bevel_resolution = 6
    dp = parent([d], loc=(0.2, 0.3, 1.3), rot=(0, 0, -16), name='five')
    cm = toy('cube', '#FFF6E2', 0.42)
    sm = mat('sign', '#FF7A14', rough=0.36, coat=0.3)
    parent(sign_cube('plus', 1.1, cm, sm), loc=(-1.45, -0.2, 2.15), rot=(-14, 18, 22), name='plus')
    parent(sign_cube('times', 1.0, cm, sm), loc=(1.75, -0.8, 0.5), rot=(0, 0, -20), name='times')
    parent(sign_cube('minus', 0.9, cm, sm), loc=(2.05, 1.35, 0.45), rot=(0, 0, -34), name='minus')
    tgt = (0.35, 0, 1.15)
    lights(target=tgt, key=900, fill=0.33, rim=0.9)
    backlight((0.3, 6.8, 3.0), power=600, size=7)
    camera(loc=look(tgt, 20.5, 24, 22), target=tgt, lens=85, shift_x=0.13, dof=2.8)
