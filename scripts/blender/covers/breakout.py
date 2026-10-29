# «Арканоид»: стена кирпичей в три ряда (цвета игры) в три четверти, в нижнем ряду дыра — мяч только что выбил кирпич,
# тот разлетается крупными кусками к камере. Яркий мяч сам светит на кирпичи, внизу спереди большая голубая платформа.
# Тёмно-фиолетовый фон, тёплые кирпичи.
from common import *

WALL = 16  # поворот стены: левый край ближе к камере, вид в три четверти


def orbit(target, dist, elev, yaw):
    t = Vector(target)
    e, y = rad(elev), rad(yaw)
    return (t.x + dist * math.cos(e) * math.sin(y), t.y - dist * math.cos(e) * math.cos(y), t.z + dist * math.sin(e))


def world(strength, exposure=-0.45):
    bpy.context.scene.view_settings.exposure = exposure
    bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = strength


def on_wall(x, y, z):
    """Координаты стены (x вдоль, y от стены к камере со знаком минус, z вверх) в мировые."""
    a = rad(WALL)
    return (x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a), z)


def brick(size, loc, m, rot=(0, 0, 0), name='brick'):
    return box(size, loc, m, bevel=0.07, segments=5, rot=rot, name=name)


def point(name, loc, power, color, radius=0.25):
    d = bpy.data.lights.new(name, 'POINT')
    d.energy, d.color, d.shadow_soft_size = power, color, radius
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    return o


def scene():
    reset()
    world(0.1)
    backdrop('#7A55D8', '#24165A', floor='#2C1C68', glow=0.07)

    rows = [toy('coral', '#FF3D62', 0.32), toy('orange', '#FF7A1F', 0.32), toy('yellow', '#FFC21F', 0.32)]
    BW, BH, BD = 0.82, 0.4, 0.38  # кирпич
    cols, gap = 5, 0.06
    z0 = 1.75  # низ стены
    hole = 2  # выбитый кирпич в нижнем ряду
    for r in range(3):
        for c in range(cols):
            if r == 2 and c == hole:
                continue
            x = (c - (cols - 1) / 2) * (BW + gap)
            z = z0 + (2 - r) * (BH + gap) + BH / 2  # верхний ряд — коралловый, нижний — жёлтый
            brick((BW, BD, BH), on_wall(x, 0, z), rows[r], rot=(0, 0, WALL), name=f'b{r}{c}')

    # выбитый кирпич: целиком вылетает к камере с поворотом, рядом крупные осколки
    hx = (hole - (cols - 1) / 2) * (BW + gap)
    hz = z0 + BH / 2
    y = rows[2]
    brick((BW * 0.6, BD, BH), on_wall(hx - 0.3, -1.3, hz - 0.1), y, rot=(18, -22, WALL + 25), name='k1')
    brick((BW * 0.48, BD, BH), on_wall(hx + 0.5, -1.0, hz + 0.12), y, rot=(-14, 30, WALL - 30), name='k2')
    brick((0.3, 0.3, 0.28), on_wall(hx + 0.05, -1.9, hz - 0.45), y, rot=(35, 20, 40), name='k3')

    # мяч: сильное свечение и тёплая лампа рядом — подсвечивает кирпичи и платформу
    ball = mat('ball', '#FFF2C4', rough=0.2, emit=30, emit_color='#FFE08A')
    bl = on_wall(hx + 0.4, -0.75, hz - 0.8)
    sphere(0.24, bl, ball, name='ball')
    point('ballLight', bl, 420, (1.0, 0.85, 0.55), radius=0.24)
    for i, (k, a, r) in enumerate(((0.38, 0.35, 0.18), (0.68, 0.16, 0.13))):
        g = mat(f'trail{i}', '#FFE08A', rough=0.4, emit=6, emit_color='#FFD060', alpha=a)
        sphere(r, on_wall(hx + 0.4 + 0.45 * k, -0.75 - 0.5 * k, hz - 0.8 - 0.8 * k), g, name=f'trail{i}')

    # платформа: большая пухлая капсула спереди внизу
    pad = toy('pad', '#22BFF5', 0.28)
    cap = toy('padcap', '#BDEFFF', 0.28)
    L, R = 1.9, 0.27
    body = cylinder(R, L, (0, 0, 0), pad, bevel=0.07, rot=(0, 90, 0), name='pad')
    ends = [sphere(R, (s * L / 2, 0, 0), cap, name='cap') for s in (-1, 1)]
    parent([body] + ends, loc=on_wall(hx + 0.75, -1.9, 0.45), rot=(0, 4, WALL + 6), name='paddle')

    lights(target=(0.4, 0, 1.6), key=900, fill=0.25, rim=1.1)
    backlight(on_wall(0.6, 6.5, 3.0), power=900, size=7, color=(0.92, 0.85, 1.0))
    t = on_wall(0.35, -0.6, 1.72)
    camera(loc=orbit(t, 21, 18, -14), target=t, lens=85, shift_x=0.15, dof=1.6)
