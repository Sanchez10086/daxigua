# -*- coding: utf-8 -*-
"""生成 4 张默认占位图（assets/theme/01~04.png）。

用法：python tools/make_theme_assets.py
依赖：Pillow

这只是一个占位素材生成器。你把自己的 4 张图覆盖掉
assets/theme/01.png ~ 04.png 之后，这个脚本就可以删了。
"""
import os
import math

from PIL import Image, ImageDraw, ImageFilter

try:
    sys_out = __import__("sys").stdout
    sys_out.reconfigure(encoding="utf-8")
except Exception:
    pass

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "theme")
os.makedirs(OUT, exist_ok=True)
SIZE = 512

# (文件名, 主色, 高光色)
LEVELS = [
    ("01.png", (74, 144, 217), (168, 210, 245)),
    ("02.png", (92, 184, 92), (176, 226, 176)),
    ("03.png", (240, 160, 48), (255, 214, 148)),
    ("04.png", (217, 83, 79), (255, 168, 164)),
]


def disc(size, inner, outer):
    """带左上高光、边缘柔化的圆盘。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    cx = cy = size / 2.0
    r = size / 2.0 - 3
    for y in range(size):
        for x in range(size):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = math.hypot(dx, dy)
            if d > r:
                continue
            t = d / r
            k = 1.0 - 0.38 * (t ** 2)
            hx, hy = cx - r * 0.32, cy - r * 0.34
            hd = math.hypot(x - hx, y - hy) / (r * 1.45)
            hi = max(0.0, 1.0 - hd) ** 2 * 0.6
            col = []
            for i in range(3):
                base = inner[i] * k
                col.append(int(min(255, base * (1 - hi) + 255 * hi * 0.9 + outer[i] * hi * 0.1)))
            a = 255 if d < r - 2 else int(255 * max(0.0, (r - d) / 2.0))
            px[x, y] = (col[0], col[1], col[2], a)
    return img


for i, (fname, inner, outer) in enumerate(LEVELS):
    img = disc(SIZE, inner, outer)

    # 每级画不同数量的白点，方便一眼区分等级
    d = ImageDraw.Draw(img)
    cx = cy = SIZE / 2
    n = i + 1
    dot_r = 26 - i * 3
    for k in range(n):
        ang = -math.pi / 2 + k * (2 * math.pi / max(1, n))
        px_ = cx + math.cos(ang) * 92
        py_ = cy + math.sin(ang) * 92
        d.ellipse([px_ - dot_r, py_ - dot_r, px_ + dot_r, py_ + dot_r], fill=(255, 255, 255, 200))

    img = img.filter(ImageFilter.SMOOTH)
    img.save(os.path.join(OUT, fname))
    print("wrote", fname)

print("done ->", OUT)
