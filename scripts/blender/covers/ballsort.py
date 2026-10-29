# «Сортировка шариков»: три стеклянные пробирки веером в общей подставке, в средней зелёные шарики,
# последний зелёный падает сверху. Фиолетовый фон, цвета шариков из палитры игры (PAL в index.html).
from common import *
import bmesh

# Цвета из палитры игры, чуть насыщеннее: AgX их приглушает.
BALL = {'red': '#ff2a45', 'orange': '#ff8c00', 'green': '#14d65c', 'cyan': '#0cc2f2'}
R_IN, WALL, H = 0.245, 0.05, 1.95  # внутренний радиус, толщина стенки, высота пробирки
BR = 0.215                         # радиус шарика


def tube(m, name='tube'):
    """Пробирка: профиль (дно-полусфера, стенка, скруглённый край) вращается модификатором Screw."""
    ro = R_IN + WALL
    pts = []
    for k in range(9):  # внутреннее дно от оси вверх
        a = math.pi / 2 * k / 8
        pts.append((R_IN * math.sin(a), R_IN + WALL - R_IN * math.cos(a)))
    pts.append((R_IN, H))
    for k in range(1, 8):  # край
        a = math.pi * k / 8
        pts.append((R_IN + WALL / 2 - WALL / 2 * math.cos(a), H + WALL / 2 * math.sin(a)))
    pts.append((ro, H))
    pts.append((ro, ro))
    for k in range(1, 9):  # наружное дно к оси
        a = math.pi / 2 * k / 8
        pts.append((ro * math.cos(a), ro - ro * math.sin(a)))
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((x, 0, z)) for x, z in pts]
    for a, b in zip(vs, vs[1:]):
        bm.edges.new((a, b))
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    s = o.modifiers.new('screw', 'SCREW')
    s.axis = 'Z'
    s.steps = s.render_steps = 96
    s.use_merge_vertices = True
    s.use_smooth_shade = True
    s.use_normal_calculate = True
    me.materials.append(m)
    return o


def ball(color, loc, alpha=1.0):
    m = mat(f'b_{color}_{alpha}', BALL[color], rough=0.2, coat=0.45, alpha=alpha)
    return sphere(BR, loc, m, name=f'ball_{color}')


def scene():
    reset()
    backdrop('#b39af0', '#4f3399', floor='#5a3caa', glow=0.08)
    glass = mat('glass', '#f6f2ff', rough=0.05, transmission=1)
    stand = toy('stand', '#e9e2fb', 0.4)
    # Содержимое пробирок снизу вверх: средняя почти собрана, по краям ещё перемешано.
    fill = [['orange', 'orange', 'red', 'cyan'], ['green', 'green', 'green'], ['cyan', 'red', 'red', 'orange']]
    tilt = [-11, 0, 11]
    xs = [-0.62, 0, 0.62]
    box((2.05, 0.78, 0.26), (0, 0, 0.13), stand, bevel=0.12, segments=6, name='stand')
    for i in range(3):
        grp = [tube(glass, f'tube{i}')]
        for k, c in enumerate(fill[i]):
            grp.append(ball(c, (0, 0, WALL + BR + 0.03 + k * (2 * BR + 0.02))))
        parent(grp, loc=(xs[i], 0, 0.12), rot=(0, tilt[i], 0), name=f'g{i}')
    # Падающий шарик над средней пробиркой и след падения: два прозрачных повтора выше.
    top = 0.12 + H + 0.42
    ball('green', (0, 0, top))
    ball('green', (0, 0, top + 0.26), alpha=0.3)
    ball('green', (0, 0, top + 0.46), alpha=0.12)
    # Весь набор чуть развёрнут к камере.
    root = bpy.data.objects.new('root', None)
    bpy.context.collection.objects.link(root)
    for o in list(bpy.data.objects):
        if o.parent is None and o.type in ('MESH', 'EMPTY') and o.name not in ('backdrop', 'root'):
            o.parent = root
    root.location = (0.15, 0, 0)
    root.rotation_euler = (0, 0, rad(-18))
    lights(target=(0.2, 0, 1.2), key=950, fill=0.3, rim=1.5)
    backlight((0.8, 6.8, 2.6), power=1500, size=5, color=(1.0, 0.95, 1.0))
    camera(loc=(5.0, -15.2, 7.6), target=(0.15, 0, 1.38), lens=85, shift_x=0.14, dof=5.6)
