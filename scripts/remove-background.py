"""
高质量去底/修复脚本 v3
自动检测：
- 全不透明图（白底）→ 亮度mask + 连通性分析去底
- 已有透明背景的图 → 只做修复（alpha归一化、透明区域RGB清零、边缘羽化、统一尺寸）

用法: python remove-background.py <输入目录> <输出目录> <前缀> [threshold]
"""
import sys
import os
from PIL import Image, ImageDraw, ImageFilter


def has_transparent_background(img):
    """检测是否已有透明背景（透明像素>20%）"""
    w, h = img.size
    pixels = img.load()
    transparent = 0
    total = 0
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            total += 1
            if pixels[x, y][3] == 0:
                transparent += 1
    return transparent / total > 0.2


def remove_bg_white(img, threshold=240):
    """白底图去底：亮度mask + 连通性分析"""
    w, h = img.size
    gray = img.convert("L")
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    gp = gray.load()
    for y in range(h):
        for x in range(w):
            if gp[x, y] > threshold:
                mp[x, y] = 255

    edge_points = [
        (0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
        (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2),
        (w // 4, 0), (3 * w // 4, 0), (w // 4, h - 1), (3 * w // 4, h - 1),
        (0, h // 4), (0, 3 * h // 4), (w - 1, h // 4), (w - 1, 3 * h // 4),
        (w // 3, 0), (2 * w // 3, 0), (w // 3, h - 1), (2 * w // 3, h - 1),
        (0, h // 3), (0, 2 * h // 3), (w - 1, h // 3), (w - 1, 2 * h // 3),
    ]
    for x, y in edge_points:
        try:
            ImageDraw.floodfill(mask, (x, y), 128, thresh=10)
        except Exception:
            pass

    result = img.copy()
    rp = result.load()
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            if mp[x, y] == 128:
                rp[x, y] = (0, 0, 0, 0)
    return result


def fix_transparent(img):
    """已有透明背景的图：修复alpha、清零RGB、羽化"""
    w, h = img.size
    result = img.copy()
    rp = result.load()

    # 1. alpha归一化：>=241 拉满到255（AI导出常卡在241-254）
    # 2. 透明区域RGB清零
    # 3. 修复角色内部的小透明洞（alpha在10-100之间且RGB非黑的像素，拉满alpha）
    for y in range(h):
        for x in range(w):
            r, g, b, a = rp[x, y]
            if a >= 241:
                rp[x, y] = (r, g, b, 255)
            elif a == 0:
                rp[x, y] = (0, 0, 0, 0)
            elif a < 100 and (r > 30 or g > 30 or b > 30):
                # 角色内部的半透明缺陷（如白色袜子中间的透明带），恢复为不透明
                rp[x, y] = (r, g, b, 255)

    # 4. 边缘羽化：alpha通道轻微高斯模糊
    alpha = result.split()[-1]
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=0.8))
    result.putalpha(alpha)

    # 5. 再次确保完全透明像素RGB为0
    rp = result.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = rp[x, y]
            if a < 15:
                rp[x, y] = (0, 0, 0, 0)
    return result


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


def process_image(input_path, output_path, threshold=240):
    img = Image.open(input_path).convert("RGBA")
    if has_transparent_background(img):
        result = fix_transparent(img)
        mode = "fix"
    else:
        result = remove_bg_white(img, threshold)
        # 去底后也做一次alpha归一化和羽化
        result = fix_transparent(result)
        mode = "remove"
    result = normalize_size(result, 1024)
    result.save(output_path, "PNG")

    alpha = result.split()[-1]
    data = alpha.get_flattened_data()
    transparent = sum(1 for p in data if p == 0)
    total = 1024 * 1024
    print("  %s: %s mode=%s transparent=%.1f%%" % (
        os.path.basename(input_path), result.size, mode, transparent / total * 100))


def process_directory(input_dir, output_dir, prefix, threshold=240):
    os.makedirs(output_dir, exist_ok=True)
    for action in ["wave", "heart"]:
        for i in range(1, 6):
            fname = "%s%s_0%d.png" % (prefix, action, i)
            in_path = os.path.join(input_dir, fname)
            out_path = os.path.join(output_dir, fname)
            if os.path.exists(in_path):
                process_image(in_path, out_path, threshold)
            else:
                print("  SKIP (not found): %s" % fname)


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python remove-background.py <input_dir> <output_dir> <prefix> [threshold]")
        sys.exit(1)
    input_dir = sys.argv[1]
    output_dir = sys.argv[2]
    prefix = sys.argv[3]
    threshold = int(sys.argv[4]) if len(sys.argv) > 4 else 240
    print("Processing %s* from %s -> %s (threshold=%d)" % (prefix, input_dir, output_dir, threshold))
    process_directory(input_dir, output_dir, prefix, threshold)
    print("Done.")
