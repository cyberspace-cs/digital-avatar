# -*- coding: utf-8 -*-
"""一次性更新验收文档状态（Loop Engineering 验证结果回填）"""
p = 'docs/ACCEPTANCE.md'
s = open(p, encoding='utf-8').read()

rows = {
    'A1': '本地+线上均验证，Hiyori/Natori 渲染成功（22:40 / 23:25）',
    'A2': '邀请弹窗+API 绑定+双标签页互见（22:45）',
    'A3': '双标签页实测：小美戳阿泰，阿泰记录同步（22:48）',
    'A5': '记录面板实测（修复 Invalid Date 后）',
    'B2': '线上实测气泡“早点睡哦”（23:00）',
    'C2': '事件落库 + 打开页面拉取历史',
    'D1': 'gitee.com/buleboy8065/digital-avatar + github.com/cyberspace-cs/digital-avatar，tag v1.0.0（22:58）',
    'D2': 'https://taoxie.vip/digital-avatar/ 全资源 200，tmux davatar:8090，nginx WS 升级（23:25）',
    'D3': 'docs/versions 不可变存档机制运行',
}
warn = {
    'A4': '菜单逻辑已实现；自动化工具不支持右键，待人工复核',
    'A6': 'API+滤镜已实现；表情仅 Natori 生效（Hiyori 无表情文件）',
    'A7': '三种模式逻辑+state_snapshot 已实现，待人工复核',
    'B1': '拖拽+边缘倾斜已实现，待人工复核',
    'C1': '走近+粒子+归位序列已实现；服务端回环已验证，视觉待人工复核',
}
lines = s.split('\n')
out = []
for ln in lines:
    parts = ln.split('|')
    if len(parts) >= 5 and parts[1].strip() in (rows | warn):
        key = parts[1].strip()
        parts[4] = ' ✅ ' if key in rows else ' ⚠️ '
        parts[5] = f' {rows.get(key) or warn[key]} |'
        ln = '|'.join(parts)
    out.append(ln)
open(p, 'w', encoding='utf-8').write('\n'.join(out))
print('ACCEPTANCE updated')
