# «Змейка»: толстая змейка из круглых бусин изгибается буквой S и тянется головой к красному яблоку.
# Травяной зелёный фон, змейка насыщенно-зелёная (бусины в два тона), яблоко красное.
from common import *

HEAD = Vector((0.55, -0.55, 0))
TAIL = Vector((-0.1, 3.0, 0))
APPLE = Vector((1.3, -0.75, 0))


def orbit(target, dist, elev, yaw):
    t = Vector(target)
    e, y = rad(elev), rad(yaw)
    return (t.x + dist * math.cos(e) * math.sin(y), t.y - dist * math.cos(e) * math.cos(y), t.z + dist * math.sin(e))


def world(strength, exposure=-0.45):
    bpy.context.scene.view_settings.exposure = exposure
    bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = strength


def path(t):
    """Ось змейки: t=0 голова, t=1 хвост. S-изгиб поперёк линии голова-хвост."""
    d = TAIL - HEAD
    n = Vector((-d.y, d.x, 0)).normalized()
    return HEAD + d * t + n * (0.75 * math.sin(t * 2 * math.pi) * (1 - 0.3 * t))  # амплитуда изгиба


def radius(i, n):
    return 0.34 - 0.17 * (i / n) ** 1.2


def scene():
    reset()
    world(0.12)
    backdrop('#BEE6A0', '#4F8F46', floor='#5FA352', glow=0.10)

    g1 = toy('g1', '#18C24E', 0.32)
    g2 = toy('g2', '#0B9A3B', 0.34)
    N = 13
    # бусины по длине кривой: шаг чуть меньше диаметра, чтобы тело читалось одним жгутом
    pts = [path(i / 600) for i in range(601)]
    beads = [pts[0]]
    s = 0.0
    for p, q in zip(pts, pts[1:]):
        s += (q - p).length
        if s >= radius(len(beads), N) * 1.45:
            beads.append(q)
            s = 0.0
        if len(beads) > N:
            break
    for i, p in enumerate(beads[1:], start=1):
        r = radius(i, N)
        lift = max(0.0, 0.18 * (1 - (i - 1) / 2.5))  # шея чуть приподнята к голове
        sphere(r, (p.x, p.y, r + lift), g1 if i % 2 else g2, name=f'bead{i}')

    # голова: вытянутая вперёд капля, приподнята и смотрит на яблоко
    head = toy('head', '#2BD660', 0.3)
    white = toy('eye', '#F6F6EE', 0.25)
    black = toy('pupil', '#10261A', 0.2)
    h = beads[0]
    hz = 0.5
    look = APPLE - h
    look.z = 0
    look.normalize()
    side = Vector((-look.y, look.x, 0))
    hd = sphere(0.4, (h.x, h.y, hz), head, scale=(1.25, 1.0, 0.82), name='head')
    hd.rotation_euler = (0, rad(10), math.atan2(look.y, look.x))
    for sd in (-1, 1):
        e = h + look * 0.2 + side * sd * 0.2
        sphere(0.1, (e.x, e.y, hz + 0.27), white, name='eye')
        e2 = h + look * 0.27 + side * sd * 0.215
        sphere(0.052, (e2.x, e2.y, hz + 0.3), black, name='pupil')

    # яблоко
    red = toy('apple', '#E8243A', 0.28)
    stem = toy('stem', '#6B3B1E', 0.6)
    leaf = toy('leaf', '#57CF3E', 0.4)
    ax, ay = APPLE.x, APPLE.y
    sphere(0.38, (ax, ay, 0.35), red, scale=(1.05, 1.05, 0.92), name='apple')
    cylinder(0.04, 0.24, (ax + 0.02, ay, 0.76), stem, bevel=0.012, rot=(0, 12, 0), name='stem')
    lf = sphere(0.15, (ax + 0.16, ay, 0.8), leaf, scale=(1.4, 0.5, 0.25), name='leaf')
    lf.rotation_euler = (0, rad(-25), rad(20))

    lights(target=(0.6, 0.2, 0.3), key=950, fill=0.3, rim=1.0)
    backlight((1.8, 7.0, 2.2), power=650, size=7, color=(0.97, 1.0, 0.9))
    t = (0.55, 0.7, 0.35)
    camera(loc=orbit(t, 13, 30, -18), target=t, lens=85, shift_x=0.1, dof=1.4)
