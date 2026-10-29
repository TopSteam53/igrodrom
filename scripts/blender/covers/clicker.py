# «Печенье» (кликер): одно огромное карамельное печенье с крупными кусочками шоколада подпрыгнуло от нажатия
# и висит с наклоном над полом, вокруг отскакивают крошки. Бирюзовый фон, печенье тёплое.
from common import *

R, T = 1.0, 0.17  # радиус печенья и половина толщины


def lumpy(o, strength=0.035, size=0.45, seed=0, sub=1):
    """Крупные бугры, как у настоящего печенья: шум размером с ладонь, а не мелкая рябь."""
    if sub:
        s = o.modifiers.new('sub', 'SUBSURF')
        s.levels = s.render_levels = sub
    tex = bpy.data.textures.new(f'n{seed}', 'CLOUDS')
    tex.noise_scale = size
    tex.noise_depth = 1
    d = o.modifiers.new('disp', 'DISPLACE')
    d.texture = tex
    d.strength = strength
    d.mid_level = 0.5
    e = bpy.data.objects.new(f'tc{seed}', None)
    bpy.context.collection.objects.link(e)
    e.location = (seed * 1.7, seed * 0.9, seed * 0.4)
    d.texture_coords = 'OBJECT'
    d.texture_coords_object = e
    return o


def dough_mat():
    """Тесто: в середине светлая карамель, к краю подрумянено."""
    m = clay('dough', '#e09a45')
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Subsurface Radius'].default_value = (0.5, 0.3, 0.15)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mul = nt.nodes.new('ShaderNodeVectorMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = (1, 1, 0)
    ln = nt.nodes.new('ShaderNodeVectorMath')
    ln.operation = 'LENGTH'
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.55
    ramp.color_ramp.elements[0].color = (*hexc('#e8a24a'), 1)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (*hexc('#b0621f'), 1)
    nt.links.new(tc.outputs['Object'], mul.inputs[0])
    nt.links.new(mul.outputs['Vector'], ln.inputs[0])
    nt.links.new(ln.outputs['Value'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    return m


def pill(m):
    """Печенье-диск со скруглённым толстым краем: шар, у которого полюса сплющены в почти плоские стороны."""
    o = sphere(R, (0, 0, 0), m, name='cookie')
    for v in o.data.vertices:
        z = v.co.z
        v.co.z = math.copysign(T * math.tanh(4 * abs(z)) / math.tanh(4), z) + 0.05 * z
    return o


def chunk(s, loc, rot, m):
    """Кусочек шоколада: скруглённый неровный брусок."""
    o = box((s, s * 0.85, s * 0.7), loc, m, bevel=s * 0.33, segments=4, rot=rot, name='chunk')
    lumpy(o, s * 0.18, s * 0.6, seed=int(loc[0] * 100) % 97 + 40)
    return o


def scene():
    reset()
    backdrop('#4cc2b8', '#0f5f62', floor='#14686a', glow=0.06)
    dough = dough_mat()
    choc = mat('choc', '#4a220c', rough=0.3, coat=0.25)
    parts = []
    c = pill(dough)
    lumpy(c, 0.08, 0.32)
    parts.append(c)
    # Крупные кусочки шоколада на лицевой стороне (z > 0), немного утоплены в тесто.
    chips = [(0.02, 0.06, 0.3), (0.5, 0.36, 0.25), (-0.46, 0.42, 0.24), (-0.52, -0.28, 0.27), (0.4, -0.44, 0.25),
             (-0.04, -0.66, 0.2), (0.74, -0.02, 0.2), (-0.1, 0.74, 0.19)]
    for i, (x, y, s) in enumerate(chips):
        r = math.hypot(x, y)
        z = T + 0.05 * math.sqrt(max(0.0, 1 - r * r)) - s * 0.1
        parts.append(chunk(s * 1.2, (x, y, z), (12 * (i % 3) - 10, 9 * (i % 2) - 4, i * 41), choc))
    # Печенье на ребре, лицом к камере, наклонено назад и вбок: видно толщину края.
    parent(parts, loc=(0.2, 0.2, R * 1.12), rot=(64, 16, -22), name='cookie_g')
    # Крошки отскакивают вверх и в стороны, не заходя в нижний левый угол под название.
    for i, (loc, s) in enumerate([((-1.3, -0.5, 1.75), 0.2), ((1.5, -0.7, 2.15), 0.17), ((1.55, -0.9, 0.5), 0.15),
                                  ((-1.05, -0.2, 2.45), 0.14)]):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=s, location=loc)
        k = bpy.context.active_object
        k.name = 'crumb'
        k.scale = (1.0, 0.8, 0.6)
        k.rotation_euler = (rad(30 * i), rad(50 + 20 * i), rad(15 * i))
        k.data.materials.append(dough)
        for p in k.data.polygons:
            p.use_smooth = True
        lumpy(k, 0.07, 0.1, seed=i + 20)
    lights(target=(0.2, 0, 1.1), key=1000, fill=0.22, rim=1.3)
    backlight((0.8, 6.5, 2.4), power=1100, size=5.0, color=(0.92, 1.0, 1.0))
    camera(loc=(3.7, -11.4, 5.5), target=(0.15, 0, 1.2), lens=85, shift_x=0.12, dof=5.6)
