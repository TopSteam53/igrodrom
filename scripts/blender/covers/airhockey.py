# «Аэрохоккей»: угол игрушечного стола с бортиком и воротами, шайба летит от красной биты, за ней светлый шлейф.
# Ледяной голубой фон, стол синий с белым полем, акцент — красная бита и жёлтый шлейф шайбы (как в игре).
from common import *


def orbit(target, dist, elev, yaw):
    """Точка камеры на сфере вокруг target: elev — высота в градусах, yaw — поворот (минус — камера слева)."""
    t = Vector(target)
    e, y = rad(elev), rad(yaw)
    return (t.x + dist * math.cos(e) * math.sin(y), t.y - dist * math.cos(e) * math.cos(y), t.z + dist * math.sin(e))


def world(strength, exposure=-0.45):
    bpy.context.scene.view_settings.exposure = exposure
    bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = strength


def scene():
    reset()
    world(0.12)
    backdrop('#A8DDF7', '#3F8BC4', floor='#4E97CC', glow=0.10)

    rail = toy('rail', '#1F4FD0', 0.36)
    field = toy('field', '#F2F7FB', 0.3)
    goal = toy('goal', '#14204A', 0.6)
    T = 0.3  # верх поля
    W, D = 2.05, 1.65
    parts = [box((W, D, 0.24), (0, 0, 0.12), rail, bevel=0.06, segments=5, name='base'),
             box((W - 0.12, D - 0.12, 0.1), (0, 0, T - 0.05), field, bevel=0.04, segments=4, name='field')]
    # бортик сзади (с воротами посередине) и справа; спереди и слева стол «продолжается»
    gw = 0.7
    seg = (W - gw) / 2
    for sx in (-1, 1):
        parts.append(box((seg, 0.24, 0.24), (sx * (gw / 2 + seg / 2), D / 2 - 0.12, T + 0.08), rail, bevel=0.07, name='railB'))
    parts.append(box((gw + 0.1, 0.2, 0.12), (0, D / 2 - 0.12, T + 0.0), goal, bevel=0.04, name='goal'))
    parts.append(box((0.24, D, 0.24), (W / 2 - 0.12, 0, T + 0.08), rail, bevel=0.07, name='railR'))
    parent(parts, loc=(0.45, 0.3, 0), rot=(0, 0, 14), name="table")

    # красная бита: широкая «юбка» и ручка с шариком; чуть наклонена после удара
    red = toy('mallet', '#FF1F4B', 0.32)
    redk = toy('knob', '#FF5C7A', 0.3)
    m = [cylinder(0.34, 0.14, (0, 0, 0.07), red, bevel=0.05),
         cylinder(0.21, 0.06, (0, 0, 0.16), redk, bevel=0.025),
         cylinder(0.12, 0.26, (0, 0, 0.29), red, bevel=0.04),
         sphere(0.17, (0, 0, 0.46), redk)]
    parent(m, loc=(0.85, 0.45, T), rot=(-6, -10, 0), name='mallet')

    # шайба в полёте: чуть над полем, наклонена по ходу, сзади три тающих следа
    puck_m = toy('puck', '#1E2442', 0.28)
    top_m = toy('pucktop', '#FFD23F', 0.35)
    p0 = Vector((0.02, -0.2, T + 0.09))
    p = [cylinder(0.27, 0.11, (0, 0, 0), puck_m, bevel=0.035), cylinder(0.15, 0.02, (0, 0, 0.056), top_m, bevel=0.008)]
    parent(p, loc=tuple(p0), rot=(8, -7, 0), name='puck')
    back = Vector((0.7, 0.35, T + 0.05)) - p0
    for i, (k, a) in enumerate(((0.27, 0.8), (0.48, 0.55), (0.67, 0.3))):
        g = mat(f'ghost{i}', '#FFE27A', rough=0.4, emit=2.5, emit_color="#FFD23F", alpha=a)
        c = cylinder(0.25 - i * 0.035, 0.05, tuple(p0 + back * k), g, bevel=0.02)
        c.rotation_euler = (rad(8), rad(-7), 0)

    lights(target=(0.25, 0.2, 0.4), key=950, fill=0.3, rim=1.0)
    backlight((1.4, 7.0, 2.0), power=700, size=7)
    t = (0.45, 0.2, 0.4)
    camera(loc=orbit(t, 10.8, 30, -26), target=t, lens=85, shift_x=0.16, dof=1.4)
