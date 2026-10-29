# «2048»: три крупные плитки. Передняя «2048» (фиолетовая, как в игре) съезжает вперёд и чуть приподнята,
# за ней «1024» и «512» (цвета как в игре) не в фокусе. Фон золотисто-жёлтый.
from common import *

# Цвета плиток из public/games/2048/index.html (COLORS), чуть насыщеннее: AgX их приглушает.
C2048, C1024, C512 = '#7026E0', '#12B4B6', '#3FD866'


def look(target, dist, az, el):
    """Точка камеры: az — поворот вправо от оси −Y, el — высота над героем (градусы)."""
    t = Vector(target)
    return (t.x + dist * math.sin(rad(az)) * math.cos(rad(el)),
            t.y - dist * math.cos(rad(az)) * math.cos(rad(el)),
            t.z + dist * math.sin(rad(el)))


def tile(label, color, ink, s=1.6, d=0.5, fs=0.4):
    """Плитка стоит на ребре лицом к камере (−Y), число выпуклое на лицевой грани."""
    b = box((s, d, s), (0, 0, s / 2), toy(f'tile{label}', color, 0.34), bevel=0.2, segments=8)
    t = text(label, size=fs, depth=0.08, loc=(0, -d / 2 - 0.01, s / 2), rot=(90, 0, 0), m=toy(f'ink{label}', ink, 0.3),
             bevel=0.014)
    return [b, t]


def scene():
    reset()
    backdrop('#F7D774', '#D9A21F', floor='#D59A1C', glow=0.1)
    a = tile('512', C512, '#08391A', fs=0.62)
    parent(a, loc=(-2.3, 2.5, 0), rot=(0, 0, 18), name='t512')
    b = tile('1024', C1024, '#073A3C', fs=0.54)
    parent(b, loc=(2.05, 1.1, 0), rot=(0, 0, -8), name='t1024')
    # Главная плитка: крупнее, приподнята и наклонена, едет к камере.
    big = tile('2048', C2048, '#FFFFFF', s=2.1, d=0.62, fs=0.76)
    parent(big, loc=(0.45, -0.7, 0.22), rot=(-8, 9, -14), name='t2048')
    tgt = (0.75, 0, 1.15)
    lights(target=tgt, key=900, fill=0.35, rim=0.9)
    backlight((0.8, 6.8, 3.0), power=650, size=7)
    camera(loc=look(tgt, 19, 24, 22), target=tgt, lens=85, shift_x=0.11, dof=2.4)
    bpy.context.scene.camera.data.dof.focus_distance -= 0.9
