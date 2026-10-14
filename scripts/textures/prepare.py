"""Prepare the ambientCG (CC0) ground textures for the game: crop the clean asphalt between Road007's baked
lane markings, keep PavingStones150 (cobbles) and Grass005, and write web-sized JPEGs to public/materials/.
Usage: python3 scripts/textures/prepare.py <folder with the *_1K-JPG packs>"""
import sys, os
from PIL import Image
SRC = sys.argv[1]; OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'materials')
def save(img, name, q=82):
    img.save(os.path.join(OUT, name), quality=q, optimize=True, progressive=True); print(name, img.size)
for kind, suffix in [('color', 'Color'), ('normal', 'NormalGL'), ('rough', 'Roughness')]:
    im = Image.open(f'{SRC}/Road007_1K-JPG/Road007_1K-JPG_{suffix}.jpg')
    if kind == 'color': im = im.convert('RGB')
    save(im.crop((100, 0, 492, 392)).resize((512, 512), Image.LANCZOS), f'asphalt-{kind}.jpg')   # between the edge line and the dashes
    im = Image.open(f'{SRC}/PavingStones150_1K-JPG/PavingStones150_1K-JPG_{suffix}.jpg')
    save(im.convert('RGB') if kind == 'color' else im, f'setts-{kind}.jpg')
for kind, suffix in [('color', 'Color'), ('normal', 'NormalGL'), ('rough', 'Roughness')]:   # pavement slab surface (concrete-like plaster)
    im = Image.open(f'{SRC}/PaintedPlaster017_1K-JPG/PaintedPlaster017_1K-JPG_{suffix}.jpg')
    save((im.convert('RGB') if kind == 'color' else im).crop((0, 0, 512, 512)), f'slab-{kind}.jpg')
for kind, suffix in [('color', 'Color'), ('normal', 'NormalGL')]:
    im = Image.open(f'{SRC}/Grass005_1K-JPG/Grass005_1K-JPG_{suffix}.jpg')
    save(im.convert('RGB').resize((512, 512), Image.LANCZOS), f'grass-{kind}.jpg')
for kind, suffix in [('color', 'Color'), ('normal', 'NormalGL')]:   # facades and roofs (src/facade-grain.js)
    save(Image.open(f'{SRC}/Bricks104_1K-JPG/Bricks104_1K-JPG_{suffix}.jpg').convert('RGB'), f'brick-{kind}.jpg', 80)
    save(Image.open(f'{SRC}/RoofingTiles014A_1K-JPG/RoofingTiles014A_1K-JPG_{suffix}.jpg').convert('RGB').resize((512, 512), Image.LANCZOS), f'rooftile-{kind}.jpg', 80)
