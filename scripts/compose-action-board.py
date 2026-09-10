"""
将动作序列帧拼接为 2行×5列 合并动作板。
用法: python compose-action-board.py <角色目录> <输出路径> <角色名>
示例: python compose-action-board.py docs/assets/action-boards/tao docs/assets/action-boards/tao_action_board.png tao
"""
import sys
import os
from PIL import Image, ImageDraw, ImageFont

def compose_board(src_dir, out_path, role_name):
    cell_size = 1024
    gap = 40
    margin = 60
    label_h = 70
    bg_color = (245, 245, 245, 255)
    text_color = (60, 60, 60, 255)

    actions = ["wave", "heart"]
    frames = ["01", "02", "03", "04", "05"]
    prefix = "tao_" if role_name == "tao" else "girl_"

    cols = 5
    rows = 2
    board_w = margin * 2 + cols * cell_size + (cols - 1) * gap
    board_h = margin * 2 + rows * (cell_size + label_h) + (rows - 1) * gap

    board = Image.new("RGBA", (board_w, board_h), bg_color)
    draw = ImageDraw.Draw(board)

    # 尝试加载字体
    try:
        font = ImageFont.truetype("arial.ttf", 36)
    except Exception:
        font = ImageFont.load_default()

    for row, action in enumerate(actions):
        for col, frame in enumerate(frames):
            fname = f"{prefix}{action}_{frame}.png"
            fpath = os.path.join(src_dir, fname)
            if not os.path.exists(fpath):
                print(f"WARNING: {fpath} not found, skipping")
                continue

            img = Image.open(fpath).convert("RGBA")
            if img.size != (cell_size, cell_size):
                img = img.resize((cell_size, cell_size), Image.LANCZOS)

            x = margin + col * (cell_size + gap)
            y = margin + row * (cell_size + label_h + gap)

            # 粘贴图片（带透明通道）
            board.paste(img, (x, y), img)

            # 绘制帧名标签
            label = fname.replace(".png", "")
            bbox = draw.textbbox((0, 0), label, font=font)
            tw = bbox[2] - bbox[0]
            tx = x + (cell_size - tw) // 2
            ty = y + cell_size + 15
            draw.text((tx, ty), label, fill=text_color, font=font)

    board.save(out_path, "PNG")
    print(f"Saved: {out_path} ({board_w}x{board_h})")

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python compose-action-board.py <src_dir> <out_path> <role_name>")
        sys.exit(1)
    compose_board(sys.argv[1], sys.argv[2], sys.argv[3])
