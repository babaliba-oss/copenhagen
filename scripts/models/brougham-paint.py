"""Repaints the 1760 coach texture so it reads from the chase camera: the flat black lacquer panels become a dark
bottle-green, and each large panel gets a thin brass border. Run once on the albedo brougham.py writes:

  python3 scripts/models/brougham-paint.py public/models/carriage/brougham.jpg public/models/carriage/brougham.jpg
"""
import sys, numpy as np
from PIL import Image
from scipy import ndimage
src, out = sys.argv[1:3]
a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
v = a.max(2)
dark = ndimage.median_filter(v, 5)
w = np.clip((26 - dark) / 12, 0, 1)[..., None]    # the lacquer, eased in: the oxblood seats, brown wheels and grey background stay
panel = ndimage.binary_opening(ndimage.binary_fill_holes(ndimage.binary_closing(dark < 16, iterations=4)), iterations=6)
lab, n = ndimage.label(panel); size = ndimage.sum(panel, lab, range(1, n + 1))
panel = np.isin(lab, 1 + np.nonzero(size > 4000)[0])         # broad painted panels only, not rods, straps or wheel grain
inner = ndimage.binary_erosion(panel, iterations=5)
trim = panel & ~inner                                          # a band just inside each panel's edge
a = a * (1 + .4 * w) + w * np.array([34, 46, 40], np.float32)  # dark bottle-green, keeping the texture's grain
a[trim] = np.array([176, 138, 62], np.float32)                 # brass
Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(out, quality=86)
print('trim px', int(trim.sum()))
