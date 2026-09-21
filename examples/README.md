# 内容包样板与贡献指南

> **"贡献者写数据，不写代码"具体长什么样。**
> 架构见 `../docs/ARCHITECTURE.md`，路线图见 `../docs/ROADMAP.md`。

## 上手

```bash
python3 examples/validate.py examples/content-pack
```

校验器会告诉你：结构是否完整、`provenance`（出处）是否填写、跨文件引用能否解析、音阶/节奏的领域合理性。

**贡献前请先在本地跑一遍。** 没有这个工具，贡献者只能靠 CI 报错来试错——那会把 99% 的人劝退。

## 内容包结构

```
content-pack/
├── tunings/       律制：频率怎么来（等分/比例/实测/公式）
├── scales/        音阶：取哪些音级
├── frameworks/    框架：音级怎么用（上行下行/重点音/惯用乐句）★
├── rhythms/       节奏：分层步进模式
├── styles/        风格：把上面这些组合成生成规则 ★
├── voices/        音色：合成配方
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
| `voices/sub-bass.json` | 声明式合成配方，含 `capabilities.offlineRenderable` |

## 必填的 `provenance`（为什么是硬性要求）

```jsonc
"provenance": {
  "sources":     [ { "type": "...", "citation": "...", "url": "..." } ],
  "accuracy":    "measured | theoretical | approximation | simplified",
  "limitations": [ "本实现缺了什么、近似在哪里" ],
  "culturalNote": "可选：对该传统的说明与指路"
}
```

**无出处的内容进不了库**（校验器拦截）。`accuracy` 为 `simplified`/`approximation` 的内容，界面会自动显示偏离说明。

这把"学术诚信"从**产品文案**升级为**数据结构**——由机器强制，不靠自觉。

## 判断内容属于哪一层

| 你想表达 | 放哪里 |
|---|---|
| "这个体系用这几个音高" | `scale` |
| "这几个音高**怎么被使用**"（上行下行不同、某音要强调、有惯用乐句） | `framework` |
| "每套合奏的实际音高都不同" | `tuning`（type: `measured`） |
| "这个风格各声部分工与结构" | `style` |

> **拉格和木卡姆不属于"音阶"。** 它们规定的是行为。
> 把 `pakad`（特征乐句）塞进 `degrees` 数组里，就永远做不出能听的生成器。

## 提交 PR 检查清单

- [ ] `id` 全局唯一、kebab-case
- [ ] `name` 提供多语言（至少 `en`）
- [ ] `provenance.sources` 有**真实引用**（不是占位 URL）
- [ ] `accuracy` 如实选择（别把简化模型标成 `measured`）
- [ ] `limitations` 写清缺什么
- [ ] `license` 已选（内容许可独立于代码许可）
- [ ] `python3 examples/validate.py examples/content-pack` 通过
- [ ] **试听过**，确认不是"听起来很怪"（校验器管不了这个）

## 已知局限

样板中的**学术数据多为占位示例**（URL 指向 `example.org`），校验器会标为警告。
合入正式内容库前必须替换为可溯源的实测数据或权威文献。

风格样板中的 `voiceRef` 全部指向同一个音色，仅因样板只提供了一个 voice 文件。

## 与 MVP 的关系

当前 MVP 的内置内容还是**代码里的声明式常量**（`src/core/model.mjs` 的 `SCALES`、
`src/core/generate.mjs` 的 `RHYTHM_PATTERNS`、`src/audio/engine.mjs` 的 `PATCHES`），
尚未接上这里的注册表。接入它们是 `docs/ROADMAP.md` 的 M4。

在那之前，这些样板的作用是：**把数据格式先定下来**，并让校验器可以独立运行。
