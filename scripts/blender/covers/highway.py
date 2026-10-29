# «Шоссе»: пухлая игрушечная машинка перестраивается в соседнюю полосу к монете, шоссе с разметкой уходит назад.
# Закатный оранжевый фон, машинка синяя «Комета» из гаража игры, монета золотая.
from common import *

ROAD = -22  # поворот шоссе: почти вдоль взгляда камеры, ближний конец обрывается до зоны названия


def orbit(target, dist, elev, yaw):
    t = Vector(target)
    e, y = rad(elev), rad(yaw)
    return (t.x + dist * math.cos(e) * math.sin(y), t.y - dist * math.cos(e) * math.cos(y), t.z + dist * math.sin(e))


def world(strength, exposure=-0.45):
    bpy.context.scene.view_settings.exposure = exposure
    bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = strength


def on_road(x, y, z=0.0):
    """Координаты на шоссе (x поперёк, y вдоль, +y — вдаль) в мировые."""
    a = rad(ROAD)
    return (x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a), z)


def road():
    asph = mat('asphalt', '#3A3D4E', rough=0.85)
    paint = mat('paint', '#F4F1EA', rough=0.7)
    o = [box((2.5, 8.8, 0.14), (0, 2.6, 0.07), asph, bevel=0.06, name='road')]
    for s in (-1, 1):
        o.append(box((0.14, 8.6, 0.02), (s * 1.08, 2.6, 0.145), paint, bevel=0.01, name='edge'))
    for k in range(0, 4):
        o.append(box((0.16, 0.95, 0.02), (0, k * 1.9 + 0.2, 0.145), paint, bevel=0.01, name='dash'))
    return o


def car():
    body = toy('car', '#2A72FF', 0.3)
    roof = toy('roof', '#6AA6FF', 0.3)
    glass = mat('glass', '#17213F', rough=0.12, coat=0.6)
    tyre = mat('tyre', '#23252E', rough=0.7)
    hub = toy('hub', '#DDE2EC', 0.3)
    lamp = mat('lamp', '#FFF4D6', rough=0.2, emit=5, emit_color='#FFEFC2')
    dark = toy('bumper', '#1C2A5A', 0.45)
    o = [box((1.25, 2.05, 0.5), (0, 0, 0.5), body, bevel=0.22, segments=6, name='chassis'),
         box((1.0, 1.05, 0.42), (0, 0.18, 0.92), glass, bevel=0.16, segments=6, name='cabin'),
         box((1.02, 0.86, 0.12), (0, 0.22, 1.12), roof, bevel=0.06, segments=5, name='roof'),
         box((1.1, 0.16, 0.16), (0, -1.0, 0.34), dark, bevel=0.07, name='bumper')]
    for sx in (-1, 1):
        for sy in (-1, 1):
            o.append(cylinder(0.3, 0.26, (sx * 0.58, sy * 0.66, 0.3), tyre, bevel=0.08, rot=(0, 90, 0), name='tyre'))
            o.append(cylinder(0.14, 0.04, (sx * 0.72, sy * 0.66, 0.3), hub, bevel=0.015, rot=(0, 90, 0), name='hub'))
        o.append(sphere(0.13, (sx * 0.38, -1.0, 0.56), lamp, scale=(1.2, 0.5, 0.85), name='lamp'))
    return o


def scene():
    reset()
    world(0.12)
    backdrop('#FFC08A', '#D0602E', floor='#DB7240', glow=0.10)

    parent(road(), rot=(0, 0, ROAD), name='road')
    # машинка в правой полосе, нос повёрнут влево (перестроение), кузов чуть кренится
    parent(car(), loc=on_road(0.5, 0.5, 0.14), rot=(0, 4, ROAD - 18), name='car')
    # монета в левой полосе впереди машинки
    gold = mat('gold', '#FFBE14', rough=0.25, metal=0.5, coat=0.4)
    gold2 = mat('gold2', '#FFE070', rough=0.25, metal=0.35, coat=0.4)
    coin = [cylinder(0.32, 0.1, (0, 0, 0), gold, bevel=0.035, rot=(90, 0, 0)),
            cylinder(0.21, 0.11, (0, 0, 0), gold2, bevel=0.02, rot=(90, 0, 0))]
    parent(coin, loc=on_road(-0.75, -1.95, 0.8), rot=(0, 15, ROAD + 35), name='coin')

    lights(target=(0.3, 0, 0.6), key=900, fill=0.3, rim=1.0)
    backlight((0.6, 7.0, 2.2), power=700, size=7, color=(1.0, 0.95, 0.88))
    t = on_road(0.0, 0.2, 0.8)
    camera(loc=orbit(t, 14, 20, -30), target=t, lens=85, shift_x=0.13, dof=1.3)
