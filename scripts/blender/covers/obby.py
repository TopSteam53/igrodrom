# «Обби: Небесные башни»: свой кубический человечек в прыжке между тремя парящими платформами, внизу облака.
# Ярко-синий небесный фон, платформы тёплые (оранжевая, жёлтая), дальняя зелёная с флажком этапа, как в игре.
# Цвета человечка взяты из игры: кожа #ffd29a, рубашка #3d8bff, штаны #1c2140, волосы #5a3a22.
from common import *


def orbit(target, dist, elev, yaw):
    t = Vector(target)
    e, y = rad(elev), rad(yaw)
    return (t.x + dist * math.cos(e) * math.sin(y), t.y - dist * math.cos(e) * math.cos(y), t.z + dist * math.sin(e))


def limb(joint, size, m, rot, name):
    """Брусок, подвешенный за верхний край (плечо, бедро): поворот вокруг сустава."""
    b = box(size, (0, 0, -size[2] / 2), m, bevel=0.05, segments=4, name=name)
    return parent([b], loc=joint, rot=rot, name=name + 'J')


def hero():
    skin = toy('skin', '#FFD29A', 0.45)
    shirt = toy('shirt', '#3D8BFF', 0.4)
    pants = toy('pants', '#232A55', 0.45)
    hair = toy('hair', '#5A3A22', 0.5)
    eye = toy('eye', '#1C2140', 0.3)
    o = [box((0.76, 0.44, 0.76), (0, 0, 1.25), shirt, bevel=0.07, name='torso'),
         box((0.54, 0.54, 0.52), (0, 0, 1.9), skin, bevel=0.07, name='head'),
         box((0.58, 0.58, 0.14), (0, 0.01, 2.17), hair, bevel=0.05, name='hair'),
         box((0.58, 0.16, 0.2), (0, 0.22, 2.04), hair, bevel=0.05, name='hairB')]
    for sx in (-1, 1):
        o.append(box((0.09, 0.03, 0.13), (sx * 0.11, -0.27, 1.93), eye, bevel=0.012, name='eye'))
    # прыжок: правая рука вперёд-вверх, левая назад; ноги врозь
    o.append(limb((0.52, 0, 1.6), (0.26, 0.26, 0.74), skin, (-130, 0, 8), 'armR'))
    o.append(limb((-0.52, 0, 1.6), (0.26, 0.26, 0.74), skin, (40, 0, -10), 'armL'))
    o.append(limb((0.19, 0, 0.88), (0.34, 0.34, 0.86), pants, (-55, 0, 0), 'legR'))
    o.append(limb((-0.19, 0, 0.88), (0.34, 0.34, 0.86), pants, (30, 0, 0), 'legL'))
    return o


def platform(size, loc, top, side, rot=0, name='plat'):
    a = box((size[0], size[1], size[2] * 0.7), (0, 0, -size[2] * 0.35 - size[2] * 0.3), side, bevel=0.08, name=name + 'S')
    b = box((size[0], size[1], size[2] * 0.36), (0, 0, -size[2] * 0.18), top, bevel=0.08, name=name + 'T')
    return parent([a, b], loc=loc, rot=(0, 0, rot), name=name)


def scene():
    reset()
    bpy.context.scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.12
    bpy.context.scene.view_settings.exposure = -0.45
    backdrop('#9FD3FF', '#2E7FE0', floor='#5FA6F0', glow=0.12)

    org, orgS = toy('org', '#FF9A3C', 0.4), toy('orgS', '#D9682A', 0.45)
    yel, yelS = toy('yel', '#FFC531', 0.4), toy('yelS', '#D99A1E', 0.45)
    grn, grnS = toy('grn', '#36D46E', 0.4), toy('grnS', '#22A456', 0.45)
    platform((1.2, 1.2, 0.55), (1.0, -0.45, 1.0), org, orgS, rot=8, name='A')
    platform((1.15, 1.15, 0.55), (2.55, 0.5, 1.35), yel, yelS, rot=-6, name='B')
    platform((1.0, 1.0, 0.5), (0.9, 2.3, 2.1), grn, grnS, rot=14, name='C')
    # флажок этапа на дальней платформе: толстый, чтобы не пропал в карточке
    pole = toy('pole', '#F4F2EA', 0.4)
    flag = toy('flag', '#2FCF66', 0.4)
    cylinder(0.055, 0.9, (1.1, 2.5, 2.1 + 0.45), pole, bevel=0.02, name='pole')
    box((0.5, 0.09, 0.32), (1.37, 2.5, 2.1 + 0.74), flag, bevel=0.035, rot=(0, 0, 10), name='flag')

    # человечек в прыжке: над промежутком между A и B, корпус чуть вперёд
    h = parent(hero(), loc=(1.5, -0.55, 1.55), rot=(12, 0, 52), name='hero')
    h.scale = (0.9, 0.9, 0.9)

    # облака внизу: крупные мягкие шары на полу, под платформами, не под названием
    cloud = mat('cloud', '#FFFFFF', rough=0.9, sss=0.1)
    for (x, y, r) in ((1.7, 0.2, 0.6), (2.5, 0.8, 0.75), (3.3, 1.4, 0.62), (1.1, 1.3, 0.55)):
        sphere(r, (x, y, r * 0.2), cloud, scale=(1.3, 1.0, 0.6), name='cloud')

    lights(target=(0.9, 0.6, 1.5), key=950, fill=0.3, rim=1.0)
    backlight((1.8, 7.0, 3.0), power=700, size=7)
    t = (1.6, 0.6, 1.75)
    camera(loc=orbit(t, 19.5, 18, -24), target=t, lens=85, shift_x=0.1, dof=1.8)
