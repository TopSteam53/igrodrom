# «Коллаж»: картина «горы на закате», разрезанная на шесть толстых квадратов в лотке; кусочек с солнцем
# вынут и висит перед лотком с поворотом, видно пустое место. Картина рисуется здесь же крупными цветовыми
# зонами (как пейзажи игры), без чужих картинок. Тёплая кремово-охристая студия.
from common import *
import numpy as np


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
    area('key', at(yaw - 42, 42, dist), target, key, 1.8, (1.0, 0.93, 0.84))
    area('fill', at(yaw + 35, 15, dist * 1.1), target, key * fill, 3.0, (0.84, 0.9, 1.0))
    area('rim', at(yaw + 150, 45, dist * 0.9), target, key * rim, 0.8, (1.0, 0.95, 0.92))


COLS, ROWS = 3, 2


def picture(w=900, h=600):
    """Горы на закате: небо, солнце, две гряды гор и озеро. Только крупные зоны цвета."""
    def c(hx):
        return np.array([int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    u = (np.arange(w) + 0.5) / w
    v = (np.arange(h) + 0.5) / h
    U, V = np.meshgrid(u, v)
    sky_t = np.clip((V - 0.4) / 0.6, 0, 1)[..., None]
    img = c('#F59A1E') * (1 - sky_t) + c('#C81E58') * sky_t
    # солнце круглое на самой картине: у неё стороны 3 к 2
    sun = ((U - 0.8) * 3) ** 2 + ((V - 0.7) * 2) ** 2 < 0.36 ** 2
    img[sun] = c('#FFEB8A')
    far = np.interp(u, [0, 0.2, 0.38, 0.52, 0.68, 0.88, 1], [0.5, 0.74, 0.52, 0.64, 0.5, 0.6, 0.48])
    img[V < far[None, :]] = c('#8A1F68')
    near = np.interp(u, [0, 0.14, 0.32, 0.48, 0.64, 0.82, 1], [0.32, 0.54, 0.36, 0.3, 0.5, 0.32, 0.4])
    img[V < near[None, :]] = c('#3A1258')
    img[V < 0.16] = c('#22123F')
    im = bpy.data.images.new('picture', w, h)
    rgba = np.concatenate([img, np.ones((h, w, 1))], axis=2).astype(np.float32)
    im.pixels.foreach_set(rgba.ravel())
    im.pack()
    return im


def pic_mat(im):
    m = bpy.data.materials.new('pic')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = im
    t.interpolation = 'Closest'
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.6
    # картинка чуть светится сама, чтобы тени на ней не серели; цвета взяты гуще, AgX их осветляет
    nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 0.12
    return m


def piece(col, row, P, gap, side_m, pm, th=0.16):
    """Квадрат картины: верхняя грань с куском рисунка (UV по исходному месту), бока кремовые."""
    x = (col - (COLS - 1) / 2) * (P + gap)
    y = (row - (ROWS - 1) / 2) * (P + gap)
    o = box((P, P, th), (0, 0, 0), side_m, bevel=0.05, segments=4, name=f'p{col}{row}')
    o.data.materials.append(pm)
    W, H = COLS * (P + gap), ROWS * (P + gap)
    uv = o.data.uv_layers.active.data
    for poly in o.data.polygons:
        top = poly.normal.z > 0.5
        poly.material_index = 1 if top else 0
        for li in poly.loop_indices:
            co = o.data.vertices[o.data.loops[li].vertex_index].co
            uv[li].uv = ((co.x + x + W / 2) / W, (co.y + y + H / 2) / H)
    return o, (x, y, th / 2)


def scene():
    sc = reset()
    sc.view_settings.exposure = -0.4
    backdrop('#EED29A', '#A97C3E', floor='#B98C4C', glow=0.05)
    P, gap = 0.86, 0.035
    im = picture()
    pm = pic_mat(im)
    side = toy('side', '#F4E6C8', 0.5)
    tray_m = toy('tray', '#7A4A24', 0.5)
    W, H = COLS * (P + gap) + 0.22, ROWS * (P + gap) + 0.22
    parts = [box((W, H, 0.12), (0, 0, -0.06), tray_m, bevel=0.05)]
    # бортик лотка
    for sx in (-1, 1):
        parts.append(box((0.1, H, 0.2), (sx * (W / 2 - 0.05), 0, 0.04), tray_m, bevel=0.04))
    for sy in (-1, 1):
        parts.append(box((W, 0.1, 0.2), (0, sy * (H / 2 - 0.05), 0.04), tray_m, bevel=0.04))
    loose = None
    for col in range(COLS):
        for row in range(ROWS):
            o, loc = piece(col, row, P, gap, side, pm)
            if (col, row) == (2, 1):
                # кусочек с солнцем вынут: вперёд к зрителю и вбок, с поворотом
                o.location = (loc[0] + 0.15, loc[1] - 0.3, 1.1)
                o.rotation_euler = (rad(-16), rad(-14), rad(14))
                loose = o
            else:
                o.location = loc
            parts.append(o)
    # лоток стоит почти вертикально, чуть откинут назад
    parent(parts, loc=(0, 0, 1.15), rot=(66, 0, 0), name='tray')

    backlight((0.5, 7.0, 1.8), power=900, size=7.0, color=(1.0, 0.95, 0.88))
    rig((0.0, 0.0, 1.0), yaw=-22, key=900, rim=0.5)
    cam3q((0.25, 0.0, 1.0), 14.5, yaw=-22, pitch=20, shift=0.14, fstop=5.6)
