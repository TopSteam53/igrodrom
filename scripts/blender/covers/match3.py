# «Три в ряд»: кусок поля 3×3 с камнями из игры (шар, квадрат, звезда, шестигранник, ромб, треугольник),
# средний ряд из трёх зелёных шестигранников собран и выпрыгивает из поля, поворачиваясь к камере. Фон фуксия.
from common import *
import bmesh

# Цвета камней из COL в index.html, чуть насыщеннее под AgX.
GEM = {'red': '#f0103e', 'orange': '#ff7a00', 'yellow': '#ffc400', 'green': '#00c45a', 'blue': '#1a86ff',
       'purple': '#8f30ff'}
CELL = 0.95


def prism(pts, depth, m, bevel=0.07, name='prism'):
    """Призма из плоского контура pts (x, y) толщиной depth, центр по z в 0, со скруглёнными рёбрами."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, -depth / 2)) for x, y in pts]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    top = [v for v in r['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, depth), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(m)
    bv = o.modifiers.new('bevel', 'BEVEL')
    bv.width, bv.segments, bv.limit_method = bevel, 5, 'ANGLE'
    bv.angle_limit = rad(30)
    o.modifiers.new('wn', 'WEIGHTED_NORMAL')
    for p in me.polygons:
        p.use_smooth = True
    return o


def ngon(n, r, start=90, sy=1.0):
    return [(r * math.cos(rad(start + 360 * i / n)), sy * r * math.sin(rad(start + 360 * i / n))) for i in range(n)]


def star(R, r):
    return [((R if i % 2 == 0 else r) * math.cos(rad(90 + 36 * i)), (R if i % 2 == 0 else r) * math.sin(rad(90 + 36 * i)))
            for i in range(10)]


def star4(R, r):
    """Четырёхлучевая искра."""
    return [((R if i % 2 == 0 else r) * math.cos(rad(90 + 45 * i)), (R if i % 2 == 0 else r) * math.sin(rad(90 + 45 * i)))
            for i in range(8)]


def gem(kind, color, s=1.0):
    """Камень-конфета размером около 0.8 клетки: плоская фигура с толстой фаской. Лежит в плоскости XY."""
    m = mat(f'g_{kind}_{color}', GEM[color], rough=0.26, coat=0.4, sss=0.05)
    m.node_tree.nodes['Principled BSDF'].inputs['Coat Roughness'].default_value = 0.14
    d = 0.34 * s
    if kind == 'ball':
        return sphere(0.38 * s, m=m, scale=(1, 1, 0.75), name='ball')
    if kind == 'square':
        return box((0.64 * s, 0.64 * s, d), m=m, bevel=0.12 * s, segments=6, name='square')
    if kind == 'star':
        return prism(star(0.44 * s, 0.21 * s), d, m, bevel=0.06 * s, name='star')
    if kind == 'hex':
        o = prism(ngon(6, 0.4 * s, 0), d, m, bevel=0.09 * s, name='hex')
        # Площадка огранки: вторая, меньшая ступень шестигранника, светлее основной.
        t = prism(ngon(6, 0.25 * s, 0), d * 0.4, mat('hex_top', '#3df08e', rough=0.22, coat=0.4), bevel=0.05 * s, name='hex_top')
        t.location = (0, 0, d * 0.5)
        t.parent = o
        return o
    if kind == 'diamond':
        return prism(ngon(4, 0.42 * s, 90, 1.0), d, m, bevel=0.07 * s, name='diamond')
    return prism(ngon(3, 0.44 * s, 90), d, m, bevel=0.08 * s, name='tri')


def scene():
    reset()
    backdrop('#ef8cc6', '#9c2a72', floor='#a8327c', glow=0.08)
    board_m = toy('board', '#5a1848', 0.5)
    cell_m = toy('cell', '#45103a', 0.6)
    items = [box((3 * CELL + 0.3, 3 * CELL + 0.3, 0.3), (0, 0, 0.15), board_m, bevel=0.14, segments=6, name='board')]
    # Ряды сверху (дальний) вниз (ближний); средний ряд собран и вынут из поля.
    rows = [[('star', 'yellow'), ('ball', 'red'), ('diamond', 'blue')],
            None,
            [('square', 'orange'), ('tri', 'purple'), ('star', 'yellow')]]
    for r in range(3):
        for c in range(3):
            x, y = (c - 1) * CELL, (1 - r) * CELL
            items.append(box((CELL - 0.08, CELL - 0.08, 0.05), (x, y, 0.31), cell_m, bevel=0.1, segments=5, name='cell'))
            if rows[r]:
                g = gem(*rows[r][c])
                g.location = (x, y, 0.31 + 0.2)
                items.append(g)
    board = parent(items, name='board_g')
    # Три зелёных шестигранника выпрыгивают из поля дугой, чуть повёрнутые к камере.
    for c, (lift, turn, spin) in enumerate([(0.62, 30, 7), (0.85, 36, -5), (0.7, 42, 10)]):
        g = gem('hex', 'green', 1.1)
        g.location = ((c - 1) * CELL * 1.06, -0.1, 0.5 + lift)
        g.rotation_euler = (rad(turn), 0, rad(spin))
        g.parent = board
    board.rotation_euler = (0, 0, rad(-4))
    board.location = (0.1, 0, 0)
    lights(target=(0, 0, 0.6), key=950, fill=0.3, rim=1.1)
    backlight((0.6, 6.5, 2.4), power=1300, size=5, color=(1.0, 0.95, 0.98))
    camera(loc=(4.8, -13.4, 7.4), target=(0.1, 0, 0.55), lens=85, shift_x=0.15, dof=5.6)
    # Вспышка совпадения: одна крупная четырёхлучевая искра над рядом.
    sp = prism(star4(0.36, 0.1), 0.08, toy('spark', '#fff6cc', 0.3), bevel=0.03, name='spark')
    sp.location = (0.55, -0.45, 2.0)
    sp.rotation_euler = (rad(68), 0, rad(14))
