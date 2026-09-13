"""
用 rembg (U2Net) 做 AI 智能去底，替代简单的亮度阈值法。
rembg 基于深度学习模型，能更好地处理头发、衣物边缘，减少白边和彩色噪点。
用法: python scripts/remove-background-rembg.py <输入目录> <输出目录> <文件名前缀>
"""
import os
import sys
from PIL import Image
import numpy as np
from rembg import remove, new_session


def remove_bg_rembg(input_path, output_path, session):
    """用 rembg 去底，然后做边缘腐蚀+去边+羽化后处理"""
    img = Image.open(input_path).convert("RGBA")

    # rembg 去底
    result = remove(img, session=session)

    # 后处理：边缘腐蚀 + 去边 + 羽化（与 remove-background.py 一致）
    w, h = result.size
    rp = result.load()

    # alpha 归一化
    for y in range(h):
        for x in range(w):
            r, g, b, a = rp[x, y]
            if a >= 241:
                rp[x, y] = (r, g, b, 255)
            elif a == 0:
                rp[x, y] = (0, 0, 0, 0)
            elif a < 100 and (r > 30 or g > 30 or b > 30):
                rp[x, y] = (r, g, b, 255)

    # 边缘腐蚀
    from PIL import ImageFilter
    alpha = result.split()[-1]
    alpha = alpha.filter(ImageFilter.MinFilter(size=3))
    result.putalpha(alpha)

    # 去边
    rp = result.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = rp[x, y]
            if 0 < a < 255:
                factor = a / 255.0
                rp[x, y] = (int(r * factor), int(g * factor), int(b * factor), a)

    # 羽化
    alpha = result.split()[-1]
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=0.4))
    result.putalpha(alpha)

    # 透明区域RGB清零
    rp = result.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = rp[x, y]
            if a < 15:
                rp[x, y] = (0, 0, 0, 0)

    # 统一尺寸 1024x1024 底部对齐
    result = normalize_size(result, 1024)
    result.save(output_path, "PNG")

    alpha = result.split()[-1]
    data = alpha.get_flattened_data()
    transparent = sum(1 for p in data if p == 0)
    total = 1024 * 1024
    print("  %s: %s transparent=%.1f%%" % (
        os.path.basename(input_path), result.size, transparent / total * 100))


def normalize_size(img, target_size=1024):
    """统一尺寸：保持比例，底部对齐到正方形画布"""
    w, h = img.size
    new_w = target_size
    new_h = int(h * target_size / w)
    if new_h > target_size:
        new_h = target_size
        new_w = int(w * target_size / h)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    offset_x = (target_size - new_w) // 2
    offset_y = target_size - new_h
    canvas.paste(img, (offset_x, offset_y), img)
    return canvas


def main():
    if len(sys.argv) < 4:
        print("用法: python remove-background-rembg.py <输入目录> <输出目录> <文件名前缀>")
        sys.exit(1)

    input_dir = sys.argv[1]
    output_dir = sys.argv[2]
    prefix = sys.argv[3]

    os.makedirs(output_dir, exist_ok=True)

    print("加载 rembg U2Net 模型（首次需下载）...")
    session = new_session("u2net")

    files = sorted([f for f in os.listdir(input_dir) if f.startswith(prefix) and f.endswith('.png')])
    print("处理 %d 张图: %s -> %s" % (len(files), input_dir, output_dir))

    for f in files:
        input_path = os.path.join(input_dir, f)
        output_path = os.path.join(output_dir, f)
        remove_bg_rembg(input_path, output_path, session)

    print("Done.")


if __name__ == "__main__":
    main()
