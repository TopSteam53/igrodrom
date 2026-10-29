# «Огонёк»: тёплый огонёк с глазками в центре ночной поляны, вокруг хоровод угольков, по краям из темноты
# подбираются две-три тени с жёлтыми глазами. Единственная тёмная обложка: светлое тёплое пятно в центре
# обязательно, иначе в тёмной теме сайта карточка потеряет края. Фон ночной сине-фиолетовый.
from common import *


def cam3q(target, dist, yaw, pitch, lens=85, shift=0.12, fstop=4.0):
    """Камера три четверти: yaw — поворот вокруг героя (плюс — вправо), pitch — подъём над ним, в градусах."""
    t = Vector(target)
    d = Vector((math.sin(rad(yaw)) * math.cos(rad(pitch)), -math.cos(rad(yaw)) * math.cos(rad(pitch)), math.sin(rad(pitch))))
    return camera(loc=tuple(t + d * dist), target=target, lens=lens, shift_x=shift, dof=fstop)


def point(name, loc, power, radius, color):
    d = bpy.data.lights.new(name, 'POINT')
    d.energy, d.shadow_soft_size, d.color = power, radius, color
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    return o


def blob(r, loc, m, seed, strength=0.12):
    """Мягкий комок с крупными буграми (тень): сфера, подразделение и смещение крупным шумом."""
    o = sphere(r, loc, m, scale=(1, 0.92, 0.88))
    tex = bpy.data.textures.new(f'n{seed}', 'CLOUDS')
    tex.noise_scale = 0.45
    tex.noise_depth = 1
    md = o.modifiers.new('d', 'DISPLACE')
    md.texture = tex
    md.strength = strength
    md.texture_coords = 'OBJECT'
    e = bpy.data.objects.new(f'e{seed}', None)
    bpy.context.collection.objects.link(e)
    e.location = (seed * 3.1, seed * 1.7, seed * 2.3)
    md.texture_coords_object = e
    return o


def flame(m, h=1.0, r=0.5, lean=0.18):
    """Капля огня: низ — полусфера, верх вытянут в язычок и чуть отклонён (огонёк бежит)."""
    o = sphere(r, (0, 0, 0), m)
    for v in o.data.vertices:
        z = v.co.z
        if z > 0:
            k = min(z / r, 1.0)
            s = (1 - k) ** 1.1
            v.co.x *= s
            v.co.y *= s
            v.co.z = z * h * 1.8
            v.co.x += lean * k * k
    return o


def fire_mat(zmin, zmax, edge=1.6, core=3.0, core_color='#FFE24A', stops=None):
    """Огонь: свечение без отражений. По высоте — от жёлто-оранжевого низа к красно-оранжевому кончику,
    а там, где поверхность смотрит на зрителя, — горячее жёлтое ядро и свечение сильнее."""
    m = bpy.data.materials.new('fire')
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    tc = N.new('ShaderNodeTexCoord')
    sep = N.new('ShaderNodeSeparateXYZ')
    mr = N.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = zmin
    mr.inputs['From Max'].default_value = zmax
    ramp = N.new('ShaderNodeValToRGB')
    el = ramp.color_ramp.elements
    stops = stops or [(0.1, '#FFA000'), (0.5, '#FF5E00'), (0.95, '#FF2A00')]
    el[0].position, el[0].color = stops[0][0], (*hexc(stops[0][1]), 1)
    el[1].position, el[1].color = stops[-1][0], (*hexc(stops[-1][1]), 1)
    for pos, col in stops[1:-1]:
        el.new(pos).color = (*hexc(col), 1)
    L.new(tc.outputs['Object'], sep.inputs['Vector'])
    L.new(sep.outputs['Z'], mr.inputs['Value'])
    L.new(mr.outputs['Result'], ramp.inputs['Fac'])
    lw = N.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.5
    one = N.new('ShaderNodeMath')
    one.operation = 'SUBTRACT'
    one.inputs[0].default_value = 1.0
    L.new(lw.outputs['Facing'], one.inputs[1])
    pw = N.new('ShaderNodeMath')
    pw.operation = 'POWER'
    pw.inputs[1].default_value = 2.5
    L.new(one.outputs[0], pw.inputs[0])
    mix = N.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    L.new(pw.outputs[0], mix.inputs['Factor'])
    L.new(ramp.outputs['Color'], mix.inputs['A'])
    mix.inputs['B'].default_value = (*hexc(core_color), 1)
    st = N.new('ShaderNodeMapRange')
    st.inputs['To Min'].default_value = edge
    st.inputs['To Max'].default_value = core
    L.new(pw.outputs[0], st.inputs['Value'])
    em = N.new('ShaderNodeEmission')
    L.new(mix.outputs['Result'], em.inputs['Color'])
    L.new(st.outputs['Result'], em.inputs['Strength'])
    L.new(em.outputs['Emission'], N['Material Output'].inputs['Surface'])
    return m


def halo(r, loc, color, strength=1.2, falloff=3.0):
    """Ореол вокруг огня: прозрачная сфера, светится тем сильнее, чем ближе к центру по взгляду.
    Видна только камере, свет и тени от неё не идут."""
    m = bpy.data.materials.new('halo')
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    N.remove(N['Principled BSDF'])
    lw = N.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.5
    one = N.new('ShaderNodeMath')
    one.operation = 'SUBTRACT'
    one.inputs[0].default_value = 1.0
    L.new(lw.outputs['Facing'], one.inputs[1])
    pw = N.new('ShaderNodeMath')
    pw.operation = 'POWER'
    pw.inputs[1].default_value = falloff
    L.new(one.outputs[0], pw.inputs[0])
    mul = N.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = strength
    L.new(pw.outputs[0], mul.inputs[0])
    em = N.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*hexc(color), 1)
    L.new(mul.outputs[0], em.inputs['Strength'])
    tr = N.new('ShaderNodeBsdfTransparent')
    add = N.new('ShaderNodeAddShader')
    L.new(tr.outputs[0], add.inputs[0])
    L.new(em.outputs[0], add.inputs[1])
    L.new(add.outputs[0], N['Material Output'].inputs['Surface'])
    o = sphere(r, loc, m)
    for attr in ('visible_shadow', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter'):
        setattr(o, attr, False)
    return o


def no_shadow(objs):
    """Огонь не загораживает лампу внутри себя: свет выходит наружу на землю, угольки и тени."""
    for o in objs:
        o.visible_shadow = False


def scene():
    sc = reset()
    # Standard вместо AgX: AgX гасит насыщенное яркое свечение до бледно-персикового, а огонь должен гореть
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (*hexc('#34347A'), 1)
    sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.1
    backdrop('#34308E', '#141240', floor='#17144A', glow=0.0)

    fire = fire_mat(-0.45, 0.95)
    eye = mat('eye', '#2A0E06', rough=0.4)
    # огонёк: большой язык и два меньших по бокам — силуэт пламени, а не капли
    f = flame(fire, h=1.0, r=0.48, lean=0.2)
    f2 = flame(fire, h=0.95, r=0.3, lean=-0.26)
    f2.location = (-0.24, 0.12, 0.08)
    f3 = flame(fire, h=0.8, r=0.26, lean=0.3)
    f3.location = (0.26, 0.14, 0.02)
    eyes = [sphere(0.075, (s * 0.15, -0.41, 0.1), eye, scale=(0.85, 0.5, 1.5)) for s in (-1, 1)]
    no_shadow([f, f2, f3] + eyes)
    parent([f, f2, f3] + eyes, loc=(0, 0, 0.62), name='flame')
    halo(1.0, (0, 0.05, 0.85), '#FF8A20', strength=0.3, falloff=3.5)
    # лампа внутри огонька: тёплый круг на земле, подсвеченные угольки, тёплый край у теней
    point('flame_light', (0, 0, 0.7), 300, 0.3, (1.0, 0.5, 0.15))
    point('flame_low', (0, -0.1, 0.25), 90, 0.2, (1.0, 0.45, 0.1))

    # хоровод угольков: наклонное кольцо вокруг огонька
    ember = fire_mat(5, 6, edge=1.5, core=2.5, core_color='#FFD23A', stops=[(0.1, '#FF8A00'), (0.9, '#FF6A00')])
    for i in range(6):
        a = i / 6 * math.tau + 0.3
        x, y = math.cos(a) * 1.1, math.sin(a) * 1.1
        e = sphere(0.085, (x, y, 0.75 + 0.22 * math.sin(a + 1.0)), ember)
        e.visible_shadow = False

    # тени из темноты: тёмно-фиолетовые комки с жёлтыми глазами, ниже по бокам
    shade = mat('shade', '#221A46', rough=0.7)
    glow_eye = mat('glow_eye', '#FFC040', rough=0.4, emit=2.2, emit_color='#FFB830')
    for i, (x, y, r, turn) in enumerate(((-1.95, 0.5, 0.52, -30), (1.25, 0.75, 0.48, 30))):
        b = blob(r, (0, 0, 0), shade, i + 1)
        es = [sphere(r * 0.13, (s * r * 0.32, -r * 0.86, r * 0.18), glow_eye, scale=(1, 0.6, 1.2)) for s in (-1, 1)]
        parent([b] + es, loc=(x, y, r * 0.8), rot=(0, 0, turn), name=f'shade{i}')

    # фон за огоньком светлее краёв, но холодный: тёплое здесь только от огня, холодный лунный свет сверху слева и сзади
    backlight((0.2, 7.0, 1.3), power=550, size=4.5, color=(0.62, 0.55, 1.0))
    area('moon', (-4.0, -2.5, 6.0), (0, 0, 0.5), 120, 3.0, (0.6, 0.65, 1.0))
    area('rim', (3.0, 5.0, 4.0), (0, 0, 0.6), 300, 1.5, (0.7, 0.7, 1.0))
    cam3q((0.0, 0.3, 0.8), 11.0, yaw=16, pitch=22, shift=0.12, fstop=4.0)
