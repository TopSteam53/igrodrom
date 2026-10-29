# «Совёнок»: сонный совёнок (та же модель, что в игре, из scripts/blender/sova.py) спит на шаткой башне из
# доски, льда и камня; башня стоит на островке посреди моря, один деревянный брусок уже выбит и падает
# в воду. Небо голубое с персиковым низом, как на прежней обложке, которая нравится пользователю.
from common import *
import bmesh


def cam3q(target, dist, yaw, pitch, lens=85, shift=0.12, fstop=4.0):
    """Камера три четверти: yaw — поворот вокруг героя (плюс — вправо), pitch — подъём над ним, в градусах."""
    t = Vector(target)
    d = Vector((math.sin(rad(yaw)) * math.cos(rad(pitch)), -math.cos(rad(yaw)) * math.cos(rad(pitch)), math.sin(rad(pitch))))
    return camera(loc=tuple(t + d * dist), target=target, lens=lens, shift_x=shift, dof=fstop)


def rig(target, yaw, key=800, fill=0.32, rim=1.0, dist=4.0):
    """Ключ слева-сверху на 40 градусов от оси камеры, заполняющий справа у камеры, контровой сзади справа."""
    t = Vector(target)

    def at(az, el, r):
        a, e = rad(az), rad(el)
        return tuple(t + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * r)
    area('key', at(yaw - 42, 42, dist), target, key, 2.5, (1.0, 0.93, 0.84))
    area('fill', at(yaw + 35, 15, dist * 1.1), target, key * fill, 4.0, (0.84, 0.9, 1.0))
    area('rim', at(yaw + 150, 45, dist * 0.9), target, key * rim, 1.2, (1.0, 0.92, 0.85))


def node_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links, m.node_tree.nodes['Principled BSDF']


def ramp(nodes, links, fac_out, stops):
    r = nodes.new('ShaderNodeValToRGB')
    el = r.color_ramp.elements
    el[0].position, el[0].color = stops[0][0], (*hexc(stops[0][1]), 1)
    el[1].position, el[1].color = stops[-1][0], (*hexc(stops[-1][1]), 1)
    for pos, col in stops[1:-1]:
        el.new(pos).color = (*hexc(col), 1)
    links.new(fac_out, r.inputs['Fac'])
    return r


def mat_wood(seed, scale=1.4):
    """Дерево как в игре, но волокна крупнее: мелкие полосы на карточке превращаются в шум."""
    m, n, l, p = node_mat('wood')
    tc = n.new('ShaderNodeTexCoord')
    mp = n.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = (seed * 3.7, seed * 1.3, 0)
    l.new(tc.outputs['Object'], mp.inputs['Vector'])
    wave = n.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = scale
    wave.inputs['Distortion'].default_value = 4
    wave.inputs['Detail'].default_value = 1
    l.new(mp.outputs['Vector'], wave.inputs['Vector'])
    r = ramp(n, l, wave.outputs['Fac'], [(0.25, '#9A5E2A'), (0.6, '#C2803F'), (0.95, '#DDA25E')])
    l.new(r.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.6
    return m


def owl_body_mat():
    m, n, l, p = node_mat('owl')
    tc = n.new('ShaderNodeTexCoord')
    noise = n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 7
    noise.inputs['Detail'].default_value = 2
    l.new(tc.outputs['Object'], noise.inputs['Vector'])
    r = ramp(n, l, noise.outputs['Fac'], [(0.35, '#8A6646'), (0.7, '#A98058')])
    l.new(r.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.85
    p.inputs['Sheen Weight'].default_value = 0.6
    return m


def cone(r1, r2, depth, loc, m, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=[rad(a) for a in rot])
    o = bpy.context.active_object
    o.data.materials.append(m)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def owl():
    """Спящий совёнок из игры: тело-шар, светлое брюшко, ушки-пёрышки, крылья, лапки, клюв, закрытые глаза-дуги."""
    body_m = owl_body_mat()
    parts = [sphere(0.46, (0, 0, 0), body_m, scale=(1.0, 0.85, 1.02))]
    parts.append(sphere(0.3, (0, -0.2, -0.13), mat('belly', '#EFD9B5', rough=0.85), scale=(1.0, 0.6, 0.95)))
    wing = mat('wing', '#7A5A40', rough=0.8)
    orange = mat('beak', '#F0A43A', rough=0.45)
    for s in (-1, 1):
        parts.append(cone(0.09, 0.0, 0.24, (s * 0.27, -0.02, 0.45), body_m, rot=(0, s * 18, 0)))
        w = sphere(0.2, (s * 0.43, -0.02, -0.05), wing, scale=(0.45, 0.8, 1.15))
        w.rotation_euler = (0, rad(s * 12), 0)
        parts.append(w)
        parts.append(sphere(0.07, (s * 0.14, -0.15, -0.46), orange, scale=(1.3, 1.1, 0.6)))
    parts.append(cone(0.06, 0.0, 0.14, (0, -0.42, 0.02), orange, rot=(100, 0, 0)))
    disc = mat('disc', '#F6E7C8', rough=0.6)
    dark = mat('lid', '#1B1A22', rough=0.3)
    for s in (-1, 1):
        parts.append(sphere(0.15, (s * 0.17, -0.34, 0.14), disc, scale=(1, 0.35, 1)))
        # закрытый сонный глаз — нижняя половина тонкого кольца
        t = torus(0.075, 0.018, (s * 0.17, -0.4, 0.17), dark, rot=(90, 0, 0))
        bm = bmesh.new()
        bm.from_mesh(t.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y > -0.02], context='VERTS')
        bm.to_mesh(t.data)
        bm.free()
        parts.append(t)
    return parts


YAW = 18


def scene():
    sc = reset()
    sc.view_settings.exposure = -0.2
    # подложка — небо: снизу персиковая дымка у горизонта, вверху голубое
    bd = backdrop('#6E9DEA', '#FFC7A0', floor='#FFC7A0', z=-0.6, glow=0.35)
    bd.rotation_euler = (0, 0, rad(YAW))  # студия лицом к камере: горизонт ровный
    # переход к голубому ниже, чем у общей студии: над горизонтом сразу небо
    bd.active_material.node_tree.nodes['Map Range'].inputs['From Max'].default_value = 3.6
    # море: глянцевая гладь с крупной пологой волной, закрывает пол студии до самого изгиба
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -2, 0.0))
    sea = bpy.context.active_object
    sea.scale = (40, 13, 1)
    bpy.ops.object.transform_apply(scale=True)
    sub = sea.modifiers.new('s', 'SUBSURF')
    sub.subdivision_type = 'SIMPLE'
    sub.levels = sub.render_levels = 6
    tex = bpy.data.textures.new('waves', 'CLOUDS')
    tex.noise_scale = 1.6
    tex.noise_depth = 0
    d = sea.modifiers.new('d', 'DISPLACE')
    d.texture = tex
    d.strength = 0.08
    sea.rotation_euler = (0, 0, rad(YAW))
    sea.data.materials.append(mat('sea', '#2E8FC0', rough=0.18, coat=0.3))
    for p in sea.data.polygons:
        p.use_smooth = True

    U = 0.95  # клетка уровня
    earth = mat('earth', '#7A5034', rough=0.9)
    grass = toy('grass', '#5FB040', 0.6)
    stone = mat('stone', '#6C7280', rough=0.8)
    ice = mat('ice', '#6CCBF2', rough=0.08, coat=0.6, emit=0.12, emit_color='#9FE0FF', transmission=0.35)
    tower = []
    # островок: земляной ком с травяной шапкой, низ уходит в воду
    tower.append(box((U * 2.2, U * 1.6, 1.3), (0, 0, -0.25), earth, bevel=0.22))
    tower.append(box((U * 2.3, U * 1.7, 0.2), (0, 0, 0.42), grass, bevel=0.09))
    # камень и лёд рядом, на них поперёк длинная доска, на доске совёнок
    tower.append(box((U, U * 0.9, U), (-0.62, 0, 0.52 + U / 2), stone, bevel=0.08))
    ice_o = box((U, U * 0.9, U * 0.95), (0, 0, 0), ice, bevel=0.1)
    parent([ice_o], loc=(0.5, 0, 0.52 + U * 0.475), rot=(0, 4, 0), name='ice')
    top = 0.52 + U
    plank = box((U * 2.5, U * 0.9, U * 0.42), (0, 0, 0), mat_wood(1), bevel=0.07)
    parent([plank], loc=(-0.05, 0, top + U * 0.21 + 0.03), rot=(0, -4, 0), name='plank')
    parent(owl(), loc=(0.05, -0.05, top + U * 0.42 + 0.52), rot=(0, -4, 6), name='owl')
    # брусок, который только что убрали касанием: падает справа в воду
    parent([box((U * 0.9, U * 0.9, U * 0.9), (0, 0, 0), mat_wood(2), bevel=0.07)], loc=(1.6, -0.2, 1.0), rot=(8, 24, 10), name='falling')
    parent(tower, name='tower')

    backlight((0.3, 7.0, 3.0), power=700, size=8.0, color=(1.0, 0.95, 0.9))
    rig((0.0, 0.0, 1.4), yaw=YAW, key=1100, rim=0.7, dist=5.0)
    cam3q((0.15, 0.0, 1.4), 17.5, yaw=YAW, pitch=14, shift=0.15, fstop=8.0)
