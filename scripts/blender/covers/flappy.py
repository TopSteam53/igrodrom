# «Летучая птичка»: своя круглая жёлтая птичка во взмахе влетает в проход между двумя зелёными трубами.
# Небесно-голубой фон, птичка жёлтая (хвост розовый, как в игре), трубы зелёные со светлыми «шапками».
from common import *


def orbit(target, dist, elev, yaw):
    t = Vector(target)
    e, y = rad(elev), rad(yaw)
    return (t.x + dist * math.cos(e) * math.sin(y), t.y - dist * math.cos(e) * math.cos(y), t.z + dist * math.sin(e))


def world(strength, exposure=-0.45):
    bpy.context.scene.view_settings.exposure = exposure
    bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = strength


def pipe(x, y, z0, z1, up, m, lip_m, hole_m):
    """Труба от z0 до z1. up=True — нижняя труба, «шапка» сверху; иначе верхняя, «шапка» снизу."""
    if up:
        body = cylinder(0.34, z1 - z0 - 0.1, (x, y, (z0 + z1 - 0.1) / 2), m, bevel=0.05, name='pipe')
        lip = cylinder(0.44, 0.28, (x, y, z1 - 0.14), lip_m, bevel=0.08, name='lip')
        hole = cylinder(0.3, 0.04, (x, y, z1 - 0.01), hole_m, bevel=0.015, name='hole')
        return [body, lip, hole]
    body = cylinder(0.34, z1 - z0 - 0.1, (x, y, (z0 + 0.1 + z1) / 2), m, bevel=0.05, name='pipe')
    lip = cylinder(0.44, 0.28, (x, y, z0 + 0.14), lip_m, bevel=0.08, name='lip')
    return [body, lip]


def bird():
    yel = toy('bird', '#FFC000', 0.32)
    belly = toy('belly', '#FFE38A', 0.4)
    white = toy('eye', '#F6F6F0', 0.25)
    black = toy('pupil', '#1E1A2E', 0.2)
    beak = toy('beak', '#FF6A10', 0.3)
    tail = toy('tail', '#F2479F', 0.34)
    wing = toy('wing', '#FF9400', 0.34)
    o = []
    o.append(sphere(0.5, (0, 0, 0), yel, scale=(1.06, 1.0, 0.96), name='body'))
    o.append(sphere(0.36, (0.18, -0.06, -0.19), belly, scale=(1.0, 1.1, 0.78), name='belly'))
    # глаз крупный, смотрит вперёд и чуть на камеру
    o.append(sphere(0.17, (0.3, -0.31, 0.17), white, name='eyeW'))
    o.append(sphere(0.085, (0.41, -0.38, 0.18), black, name='pupil'))
    # клюв: две приплюснутые капли
    o.append(sphere(0.17, (0.53, -0.06, -0.02), beak, scale=(1.3, 0.85, 0.5), name='beakU'))
    o.append(sphere(0.12, (0.48, -0.06, -0.12), beak, scale=(1.2, 0.8, 0.45), name='beakL'))
    # крыло сбоку за глазом, поднято вверх-назад во взмахе
    w = sphere(0.24, (-0.22, -0.43, 0.12), wing, scale=(1.3, 0.32, 0.75), name='wing')
    w.rotation_euler = (rad(-20), rad(-40), 0)
    o.append(w)
    for i, (dz, ry) in enumerate(((0.08, -22), (-0.08, 12))):
        t = sphere(0.16, (-0.53, 0, dz), tail, scale=(1.3, 0.45, 0.55), name=f'tail{i}')
        t.rotation_euler = (0, rad(ry), 0)
        o.append(t)
    return o


def scene():
    reset()
    world(0.12)
    backdrop('#A6DBFF', '#3C8ED8', floor='#4A9BE0', glow=0.12)

    green = toy('pipe', '#2DB843', 0.34)
    lipg = toy('lip', '#62D94E', 0.32)
    hole = toy('hole', '#1C6E2A', 0.6)
    gx, gy = 0.95, 0.45
    lo, hi = 0.85, 2.25  # проход между трубами
    pipe(gx, gy, 0, lo, True, green, lipg, hole)
    pipe(gx, gy, hi, 9, False, green, lipg, hole)

    parent(bird(), loc=(-0.15, -0.4, 1.6), rot=(0, -16, -24), name='bird')
    # две светлые капли за птичкой — след взмаха
    puff = mat('puff', '#FFFFFF', rough=0.5, alpha=0.6)
    for i, (dx, dz, s) in enumerate(((-0.95, -0.12, 0.13), (-1.3, -0.3, 0.09))):
        sphere(s, (-0.15 + dx, -0.25, 1.6 + dz), puff, name=f'puff{i}')

    lights(target=(0.4, 0, 1.5), key=900, fill=0.3, rim=0.8)
    backlight((1.0, 7.0, 2.6), power=700, size=7)
    t = (0.45, 0.0, 1.5)
    camera(loc=orbit(t, 12.5, 12, -22), target=t, lens=85, shift_x=0.12, dof=1.6)
