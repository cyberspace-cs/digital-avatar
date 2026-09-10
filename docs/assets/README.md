# 数字分身资产文档索引

> 本目录存放 Jing/Tao 数字分身的资产设计文档、描述词和生成规范。
> 上级契约：`../superpowers/specs/2026-09-09-jing-tao-digital-avatar-contract.md`

## 文档结构

```
docs/assets/
├── README.md                          ← 本文件（索引）
├── prompts/                           ← AI 生成描述词
│   ├── jing-character-base.md         ← Jing 基准立绘描述词
│   ├── jing-parts.md                  ← Jing 部件素材描述词（发型/上衣/下装）
│   ├── tao-parts.md                   ← Tao 部件素材描述词（发型/上衣/领带/下装/外套）
│   └── action-sequences.md            ← 动作序列帧描述词（wave/heart 各5帧）
├── specs/
│   └── asset-production-spec.md       ← 资产生成规范与验收标准
├── reference/                         ← 基准立绘（生成后放入）
├── parts/                             ← 部件素材（生成后放入）
└── action-boards/                     ← 动作序列帧（生成后放入）
    ├── jing/
    └── tao/
```

## 相关文档

| 文档 | 路径 |
|------|------|
| 产品与技术契约 | `docs/superpowers/specs/2026-09-09-jing-tao-digital-avatar-contract.md` |
| 实施计划 | `docs/superpowers/plans/2026-09-09-jing-tao-digital-avatar.md` |
| 产品需求文档 | `docs/prd/digital-avatar-prd.md` |
| 运行时模型 | `client/public/models/`（仅旧模型，Jing/Tao 正式包后续放入） |

## 资产生成流程

1. **确认描述词** → 查阅 `prompts/` 下各文件，确认角色造型和动作规范
2. **生成基准立绘** → 用 `jing-character-base.md` 生成 Jing/Tao 基准立绘，人工确认身份一致
3. **生成部件素材** → 用 `jing-parts.md` / `tao-parts.md` 生成分层部件，叠加测试
4. **生成动作帧** → 用 `action-sequences.md` 生成 wave/heart 各5帧，检查节拍和一致性
5. **合并动作板** → 2行×5列合并图，用于设计沟通和验收
6. **归档** → 按目录结构放入 `reference/`、`parts/`、`action-boards/`

## 重要约束

- AI 生成的 PNG 是**设计参考**，不是运行时资产
- 正式运行时必须使用 Live2D Cubism 5（moc3、motion3、physics3 等）
- 禁止将 PNG 序列帧直接当作动画播放
- 禁止删除旧模型（Hiyori/Haru/Natori/Chitose）
- 禁止恢复等级/任务/火花系统
- 禁止用 TapBody 下标取模实现动作语义
