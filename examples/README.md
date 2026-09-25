# 内容包样板与贡献指南

> 内容按表达需要选择类型化常量、代码模块或 JSON 兼容交换格式。
> 架构见 `../docs/ARCHITECTURE.md`，路线图见 `../docs/ROADMAP.md`。

当前 `content-pack/` 下的 JSON 文件是早期 schema / 互操作样板，`validate.py` 目前只校验这种格式。它们尚未接入运行时，也不代表未来内容包必须沿用这些分类。M4 将以 TypeScript 类型和代码扩展接口作为主要作者格式，同时保留 JSON 导入 / 导出能力；同一段生成代码可以共同处理旋律、节奏、装饰和奏法。

## 上手

```bash
python3 examples/validate.py examples/content-pack
```

校验器会告诉你：当前 JSON 样板的结构是否完整、`provenance`（出处）是否填写、跨文件引用能否解析、音阶/节奏的领域合理性。

**贡献前请先在本地跑一遍。** 没有这个工具，贡献者只能靠 CI 报错来试错——那会把 99% 的人劝退。

## 当前 JSON 兼容样板目录（历史分类）

以下目录只描述现有 JSON 样例的组织方式，不是未来内容类型的强制划分。未来的生成代码可以把需要协同的规则放在一起；只有需要独立复用的素材才单独拆分。

```
content-pack/
├── tunings/       律制：频率怎么来（等分/比例/实测/公式）
├── scales/        音阶：取哪些音级
├── frameworks/    框架：音级怎么用（上行下行/重点音/惯用乐句）★
├── rhythms/       节奏：分层步进模式
├── styles/        风格：把上面这些组合成生成规则 ★
├── voices/        旧格式的音色配方（不是声部或完整乐器定义）
└── themes/        视觉主题
```

| 样板文件 | 演示了什么 |
|---|---|
| `tunings/pythagorean-3limit-12.json` | **公式**型律制（写 sonic-weave 表达式，避免手录比例出错） |
| `tunings/slendro-javanese-measured-example.json` | **实测频率**型；如何在 `limitations` 说明"每套甘美兰都不同" |
| `scales/bhairav-thaat-12tet.json` | 音阶的 12-TET 近似，诚实标注丢失了什么 |
| `frameworks/raga-bhairav-simplified.json` | **框架层**：`ascending`/`descending`/`emphasis`/`phrases`/`cadence` |
| `rhythms/afrobeat-tresillo-16.json` | 分层节奏、3:2 交叉、为何 16 步栅格只能"逼近" |
| `styles/afrobeat-lab-example.json` | **风格配方**：纯声明式，**没有一行算法** |
| `voices/sub-bass.json` | 声明式合成音色配方，含渲染能力；不描述完整乐器 |

## 元数据 `provenance`（为什么是硬性要求）

```jsonc
"provenance": {
  "sources":     [ { "type": "...", "citation": "...", "url": "..." } ],
  "accuracy":    "measured | theoretical | approximation | simplified",
  "limitations": [ "本实现缺了什么、近似在哪里" ],
  "culturalNote": "可选：对该传统的说明与指路"
}
```

**无出处的内容进不了库**（校验器拦截）。`accuracy` 为 `simplified`/`approximation` 的内容，界面会自动显示偏离说明。

无论内容以 JSON 还是 TypeScript 编写，都要提供可检查的出处元数据。校验工具能检查字段是否齐全；出处真实性仍需人工核实。

## 组织内容时的建议

| 你想表达 | 放哪里 |
|---|---|
| "这个体系用这几个音高" | 可独立复用时，作为音阶或律制 |
| "这些音高、节奏、装饰和奏法互相影响" | 同一段生成代码共同表达 |
| "每套合奏的实际音高都不同" | 可独立复用的实测调音素材 |
| "用户想一键获得一套声部、乐器和默认参数" | 可选的风格预设，组合已信任的素材、乐器和生成代码 |

> 拉格和木卡姆包含超出音高集合的音乐行为。实现时不必把 `pakad`、节奏关系和演奏规则强行拆成互不相知的内容类型。

## 提交内容包检查清单

- [ ] `id` 全局唯一、kebab-case
- [ ] `name` 提供多语言（至少 `en`）
- [ ] `provenance.sources` 有**真实引用**（不是占位 URL）
- [ ] `accuracy` 如实选择（别把简化模型标成 `measured`）
- [ ] `limitations` 写清缺什么
- [ ] `license` 已选（内容许可独立于代码许可）
- [ ] JSON 兼容包运行 `python3 examples/validate.py <目录>`；TypeScript 内容包通过类型检查与运行时校验
- [ ] 代码扩展通过审核，遵守扩展接口和可复现约束
- [ ] **试听过**，确认不是"听起来很怪"（校验器管不了这个）

## 已知局限

样板中的**学术数据多为占位示例**（URL 指向 `example.org`），校验器会标为警告。
合入正式内容库前必须替换为可溯源的实测数据或权威文献。

风格样板中的 `voiceRef` 全部指向同一个音色配方，仅因样板只提供了一个 voice 文件。这里的 `voice` 是旧 schema 对音色配方的命名，不是乐曲声部，也不是完整乐器定义。

## 与 MVP 的关系

当前 MVP 的内置内容还是**代码里的声明式常量**（`src/core/model.mjs` 的 `SCALES`、
`src/core/generate.mjs` 的 `RHYTHM_PATTERNS`、`src/audio/engine.mjs` 的 `PATCHES`），
尚未接上这里的注册表。接入它们是 `docs/ROADMAP.md` 的 M4。

在那之前，这些 JSON 样板用于演示兼容数据格式，并让现有校验器可以独立运行。未来主要作者格式是类型化 TypeScript 内容包：静态素材用 `as const satisfies ...` 约束；需要动态音乐行为时，同一段生成代码可共同表达互相耦合的规则。外部 JSON 仍通过运行时校验后导入。
