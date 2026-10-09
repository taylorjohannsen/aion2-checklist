"""Shrinks the PNGs `npm run build:icons` downloads into 128px WebP, plus a 64px favicon.

    pip install pillow
    python scripts/shrink-icons.py
"""
import glob
import os

from PIL import Image

ICON_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')

for png in glob.glob(os.path.join(ICON_DIR, '*.png')):
    if os.path.basename(png) == 'favicon.png':
        continue
    im = Image.open(png).convert('RGBA')
    if im.width > 128:
        im = im.resize((128, 128 * im.height // im.width), Image.LANCZOS)
    key = os.path.splitext(png)[0]
    im.save(key + '.webp', quality=88, method=6)
    if os.path.basename(key) == 'odyle':
        im.resize((64, 64), Image.LANCZOS).save(os.path.join(ICON_DIR, 'favicon.png'), optimize=True)
    os.remove(png)
    print(os.path.basename(key) + '.webp', os.path.getsize(key + '.webp'))
