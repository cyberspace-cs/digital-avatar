"""
从合并动作板中裁剪出单独帧。
用法: python extract-action-frames.py <合并板路径> <输出目录> <角色前缀>
示例: python extract-action-frames.py docs/assets/action-boards/jing/jing_action_board.png docs/assets/action-boards/jing girl
"""
import sys
import os
from PIL import Image

def extract_frames(board_path, out_dir, prefix):
    img = Image.open(board_path).convert("RGBA")
    w, h = img.size
    cols = 5
    rows = 2
    cell_w = w / cols
    cell_h = h / rows
    # 去掉底部标注区域（约占每格高度的8%，保留角色全身）
    label_h = int(cell_h * 0.08)
    crop_h = int(cell_h - label_h)

    actions = ["wave", "heart"]
    frames = ["01", "02", "03", "04", "05"]

    for row, action in enumerate(actions):
        for col, frame in enumerate(frames):
            x = int(col * cell_w)
            y = int(row * cell_h)
            # 裁剪角色区域（去掉底部标注）
            box = (x, y, x + int(cell_w), y + crop_h)
            frame_img = img.crop(box)

            # 保持原始比例，缩放到宽度1024，高度按比例
            fw, fh = frame_img.size
            new_w = 1024
            new_h = int(fh * new_w / fw)
            frame_img = frame_img.resize((new_w, new_h), Image.LANCZOS)

            fname = f"{prefix}_{action}_{frame}.png"
            fpath = os.path.join(out_dir, fname)
            frame_img.save(fpath, "PNG")
            print(f"Extracted: {fname} ({frame_img.size})")

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python extract-action-frames.py <board_path> <out_dir> <prefix>")
        sys.exit(1)
    extract_frames(sys.argv[1], sys.argv[2], sys.argv[3])
