# -*- coding: utf-8 -*-
"""
一键换图工具：把一个文件夹里的图片，变成一套可以直接玩的主题。

用法：
    python tools/make_theme.py <图片文件夹> <主题id> [主题名] [--write]

例子：
    python tools/make_theme.py D:\\我的图\\动物 zoo 动物
    python tools/make_theme.py ./我的表情包 faces 表情包 --write

加 --write 会自动把主题写进 js/config.js（会先备份成 config.js.bak）。
不加的话，只在终端打印配置片段，你自己粘。

它做的事：
    1. 按文件名顺序读取文件夹里所有图片（png/jpg/webp/gif）
    2. 统一转成 512x512 透明背景 PNG，复制到 assets/<主题id>/
    3. 自动算好 radius（从小到大，等比递增）
    4. 在终端打印一段 config.js 片段，复制粘贴进去即可

加 --write 还会顺便把 spawnRange 按等级数调好
（等级少自动调小，保证合得动）。

图片要求：最好本身就是正方形、透明背景的 PNG。
    非正方形的会被居中裁成正方形；JPG 会被抠成圆形。
"""
import os
import re
import sys
import shutil

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    print("需要 Pillow：pip install Pillow")
    sys.exit(1)

# Windows 控制台默认不是 UTF-8，强制一下，避免中文输出乱码
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
GAME_ROOT = os.path.abspath(os.path.join(HERE, ".."))
ASSETS = os.path.join(GAME_ROOT, "assets")
SIZE = 512

EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")

# 默认半径曲线：第一个 24，最后一个 78，等比递增（4 级时约 24/38/56/78）
R_MIN, R_MAX = 24, 78


def circle_mask(size):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([2, 2, size - 3, size - 3], fill=255)
    # 边缘柔化 1px，避免锯齿
    m = m.filter(ImageFilter.GaussianBlur(0.6))
    return m


def load_square(path, size=SIZE):
    """读图 -> 居中裁成正方形 -> 缩放到 size。"""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    im = im.crop((left, top, left + side, top + side))
    return im.resize((size, size), Image.LANCZOS)


def normalize(path, out_path):
    """转成 512x512 透明 PNG；如果是没有透明通道的图（如 JPG），裁成圆形。"""
    im = load_square(path)

    has_alpha = False
    a = im.getchannel("A")
    lo, hi = a.getextrema()
    if lo < 250:  # 存在明显透明像素
        has_alpha = True

    if not has_alpha:
        # 不透明的图：套圆形遮罩，让它变成圆球
        mask = circle_mask(SIZE)
        out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        out.paste(im, (0, 0), mask)
    else:
        out = im

    out.save(out_path, "PNG", optimize=True)
    return out


def radii(n):
    """n 个等级 -> 从 R_MIN 等比递增到 R_MAX。"""
    if n <= 1:
        return [R_MAX]
    ratio = (R_MAX / R_MIN) ** (1.0 / (n - 1))
    return [round(R_MIN * (ratio ** i)) for i in range(n)]


def default_scores(n):
    """默认分数：越高级越贵，接近原版曲线。"""
    out = []
    s = 1
    for i in range(n):
        out.append(s)
        s = max(s + 1, round(s * 1.55))
    return out


def write_into_config(theme_id, block, spawn_range=None):
    """把主题块插进 js/config.js 的 themes 里，并可选地调整 spawnRange。"""
    cfg_path = os.path.join(GAME_ROOT, "js", "config.js")
    with open(cfg_path, "r", encoding="utf-8") as f:
        text = f.read()

    # 已经存在同名主题 -> 整体替换
    pattern = re.compile(r"\n\s{4}" + re.escape(theme_id) + r":\s*\{.*?\n\s{4}\},", re.S)
    if pattern.search(text):
        new_text = pattern.sub("\n" + block, text, count=1)
        action = "替换"
    else:
        # 在 "// ---------- 主题三" 注释之前插入；找不到就插在 themes 块结尾前
        marker = "    // ---------- 主题三"
        idx = text.find(marker)
        if idx != -1:
            new_text = text[:idx] + block + "\n\n" + text[idx:]
        else:
            # 兜底：找 themes 块结尾 "  },\n};"
            tail = text.rfind("  },\n};")
            if tail == -1:
                return False, "没找到插入位置，请手动粘贴"
            new_text = text[:tail] + block + "\n" + text[tail:]
        action = "新增"

    # 按等级数自动调 spawnRange（只出最小的 1~2 级才合得动）
    if spawn_range is not None:
        new_text2 = re.sub(
            r"(\n\s*spawnRange:\s*)\d+",
            lambda m: m.group(1) + str(spawn_range),
            new_text,
            count=1,
        )
        if new_text2 != new_text:
            new_text = new_text2

    # 备份
    shutil.copyfile(cfg_path, cfg_path + ".bak")
    with open(cfg_path, "w", encoding="utf-8") as f:
        f.write(new_text)
    return True, f"{action}成功，已备份原文件为 config.js.bak"


def suggest_spawn_range(n):
    """等级数 -> 合适的 spawnRange（只出最小的一两级）。"""
    if n <= 4:
        return 1
    if n <= 7:
        return 2
    return 3


def main():
    argv = [a for a in sys.argv[1:] if a != "--write"]
    auto_write = "--write" in sys.argv

    if len(argv) < 2:
        print(__doc__)
        sys.exit(1)

    src = os.path.abspath(argv[0])
    theme_id = argv[1]
    theme_name = argv[2] if len(argv) > 2 else theme_id

    if not re.fullmatch(r"[A-Za-z0-9_-]+", theme_id):
        print("主题 id 只能用英文字母、数字、下划线、短横线，例如 zoo / my-theme")
        sys.exit(1)

    if not os.path.isdir(src):
        print(f"找不到文件夹：{src}")
        sys.exit(1)

    files = sorted(
        f for f in os.listdir(src) if f.lower().endswith(EXTS) and os.path.isfile(os.path.join(src, f))
    )
    if len(files) < 2:
        print(f"文件夹里只有 {len(files)} 张图，至少要 2 张（4~12 张比较合适）")
        sys.exit(1)
    if len(files) > 20:
        print(f"警告：{len(files)} 张图有点多，游戏会很难，建议裁到 12 张以内")

    out_dir = os.path.join(ASSETS, theme_id)
    os.makedirs(out_dir, exist_ok=True)

    n = len(files)
    rs = radii(n)
    scores = default_scores(n)

    names = []
    for i, f in enumerate(files):
        stem = os.path.splitext(f)[0]
        # 去掉文件名开头的数字前缀，避免生成 01_01_xxx 这种重复
        stripped = re.sub(r"^[0-9]+[_\-\s]*", "", stem).strip()
        names.append(stripped or "")  # 空表示"纯数字文件名"，输出 01.png / 02.png
        fname = f"{i + 1:02d}_{stripped}.png" if stripped else f"{i + 1:02d}.png"
        dst = os.path.join(out_dir, fname)
        normalize(os.path.join(src, f), dst)
        print(f"  {f}  ->  assets/{theme_id}/{fname}")

    # 生成配置片段
    palette = [
        "#ce3448", "#e24660", "#7854ba", "#ee8c22", "#f48c76", "#c62e3a",
        "#96b83e", "#e2ac2c", "#78ba6a", "#3a9c58", "#ecba38", "#b9c4cf",
        "#d4633a", "#3f8fd0", "#4a3a6a", "#8a7f76", "#c9cdd2", "#d9b271",
        "#c98d5e", "#f2a33a",
    ]

    lines = []
    lines.append(f"    {theme_id}: {{")
    lines.append(f"      name: '{theme_name}',")
    lines.append("      levels: [")
    for i in range(n):
        fname = f"{i + 1:02d}_{names[i]}.png" if names[i] else f"{i + 1:02d}.png"
        disp = names[i][:6] if names[i] else f"{i + 1}级"
        lines.append(
            f"        {{ name: '{disp}', image: 'assets/{theme_id}/{fname}', "
            f"radius: {rs[i]}, score: {scores[i]}, color: '{palette[i % len(palette)]}' }},"
        )
    lines.append("      ],")
    lines.append("    },")

    print()
    print("=" * 64)
    print(f"成功！{n} 张图已转换到 assets/{theme_id}/")
    print("=" * 64)
    print()
    print("配置片段（复制粘贴到 js/config.js 的 themes: { ... } 里面）：")
    print()
    print("\n".join(lines))
    print()

    if auto_write:
        ok, msg = write_into_config(theme_id, "\n".join(lines), suggest_spawn_range(n))
        print(("[写入 config.js] " + msg) if ok else ("[写入失败] " + msg))
        if ok:
            print(f"刷新页面即可（spawnRange 已按 {n} 级自动设为 {suggest_spawn_range(n)}）。")
            return

    print(f"然后刷新页面，右上角下拉框选「{theme_name}」即可。")
    print("（想让它成为默认主题，就把 defaultTheme 改成 '%s'）" % theme_id)
    print()
    print("小提示：加 --write 参数可以让本脚本自动写进 config.js：")
    print(f"    python tools/make_theme.py <图片文件夹> {theme_id} {theme_name} --write")


if __name__ == "__main__":
    main()
