# Рендер 3D-обложек: для каждого slug загружает scripts/blender/covers/<slug>.py и вызывает его scene().
#   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup \
#     --python scripts/blender/covers/render.py -- 2048 snake …
# Готовые кадры — docs/covers/out/<slug>.png; название поверх кладёт node scripts/covers/compose.mjs.
import importlib.util, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

slugs = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
for slug in slugs:
    spec = importlib.util.spec_from_file_location(f'cover_{slug}', os.path.join(HERE, f'{slug}.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.scene()
    common.render(slug)
