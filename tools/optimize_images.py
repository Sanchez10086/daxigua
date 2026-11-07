# -*- coding: utf-8 -*-
"""把主题图片优化成适合游戏的尺寸（512x512、方形、去元数据）。

用法：
    python tools/optimize_images.py            # 优化 assets/theme/*.png
    python tools/optimize_images.py assets/x   # 优化指定目录

原图会备份到同目录下的 original/ 里（只备份一次，不会覆盖已有备份）。
"""
import os
import sys
import shutil

from PIL import Image

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
GAME_ROOT = os.path.abspath(os.path.join(HERE, ".."))

SIZE = 512          # 目标边长。游戏里最大球半径 78，2 倍屏也就 312px，512 足够
EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")


def cover_square(im, size):
    """居中裁成正方形，再缩放到 size（不变形）。"""
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    im = im.crop((left, top, left + side, top + side))
    return im.resize((size, size), Image.LANCZOS)


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(GAME_ROOT, "assets", "theme")
    target = os.path.abspath(target)
    if not os.path.isdir(target):
        print("找不到目录：" + target)
        return

    backup = os.path.join(target, "original")
    files = sorted(f for f in os.listdir(target) if f.lower().endswith(EXTS) and os.path.isfile(os.path.join(target, f)))
    if not files:
        print("目录里没有图片：" + target)
        return

    os.makedirs(backup, exist_ok=True)
    total_before = total_after = 0

    for f in files:
        p = os.path.join(target, f)
        before = os.path.getsize(p)
        total_before += before

        bkp = os.path.join(backup, f)
        if not os.path.exists(bkp):
            shutil.copyfile(p, bkp)

        im = Image.open(p)
        im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
        im = cover_square(im, SIZE)

        out_name = os.path.splitext(f)[0] + ".png"
        out_path = os.path.join(target, out_name)
        im.save(out_path, "PNG", optimize=True)
        after = os.path.getsize(out_path)
        total_after += after

        # 原文件是 jpg 的话，png 存好后把 jpg 删掉避免重复
        if out_name != f and os.path.exists(p):
            os.remove(p)

        print(f"  {f}  {before/1024:8.1f} KB -> {out_name}  {after/1024:7.1f} KB")

    print()
    print(f"完成：{total_before/1024/1024:.2f} MB -> {total_after/1024/1024:.2f} MB")
    print(f"原图已备份到：{backup}")


if __name__ == "__main__":
    main()
