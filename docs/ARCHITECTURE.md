# Riffle · 架构

> 三条主线：**内核薄而深**、**贡献写数据**、**所有形态走同一条 Action 通道**。

---

## 1. 分层

```
┌──────────────────────────────────────────────────────────┐
│ L4 形态 Forms       随机生成 │ 游戏 │ AI │ 画布 │ 教学      │
│    —— 各自独立发版，共用下面三层 ——                        │
└──────────────────────────┬───────────────────────────────┘
                           │ Action 协议
┌──────────────────────────▼───────────────────────────────┐
│ L3 可视化 Visualizers   纯函数 (乐谱, 环境) → 渲染          │
└──────────────────────────┬───────────────────────────────┘
┌──────────────────────────▼───────────────────────────────┐
│ L2 数据 Content   ★ 社区贡献主战场（声明式，无需写代码）     │
│    律制 │ 音阶 │ 框架 │ 节奏 │ 风格 │ 音色 │ 主题           │
└──────────────────────────┬───────────────────────────────┘
┌──────────────────────────▼───────────────────────────────┐
│ L1 内核 Kernel   机制。稳定、极小、<3000 行、零运行时依赖    │
│    PRNG(种子/子流) │ 事件流 │ 算子管道 │ 调度器 │ 注册表     │
│    适配器接口: Audio │ Viz │ Input │ Export                │
└──────────────────────────────────────────────────────────┘
```

**不变式**
- L1 公共 API 遵循严格语义化版本，破坏性变更走 RFC
- L2 是数据，**不发版**
- L4 每个形态独立发版，互不阻塞
- L2 与 L4 之间无直接依赖，都只依赖 L1

---

## 2. 核心数据模型

### 2.1 音高不是 MIDI 整数

```ts
type Pitch =
  | { kind: 'ratio';    num: number; den: number; ref: number }  // 纯律 3/2
  | { kind: 'cents';    cents: number; ref: number }             // 任意微分音
  | { kind: 'edo';      step: number; divisions: number; ref: number }
  | { kind: 'absolute'; hz: number };                            // 甘美兰实测频率
```

> **一旦把音高退化成正整数，就永久失去了表达中立三度、纯律比例、甘美兰的能力。**
> UI 可以显示成音符号，内核不能。

### 2.2 三个正交层：律制 / 音阶 / 框架

```
律制 Tuning     频率如何生成    （等分 / 比例 / 实测）
  ↓
音阶 Scale      取哪些音级
  ↓
框架 Framework  这些音级怎么用   （上行下行 / 重点音 / 惯用乐句）
```

**为什么必须拆**：拉格和木卡姆规定的是**行为**，不是音高集合。
把 `pakad`（特征乐句）塞进"音阶"数组里，就永远做不出能听的生成器。

| 框架层字段（示例） | 含义 |
|---|---|
| `ascending` / `descending` | aroha / avaroha（拉格两者常不同） |
| `emphasis` | vadi/samvadi/durak（重点音权重） |
| `phrases` | pakad / 惯用乐句 |
| `direction` | seyir（旋律行进性格） |
| `cadence` | 终止式倾向 |

> **定位提醒**：这三层是**架构能力**，不是产品卖点。M6 才做，且放在高级模式。

### 2.3 作品 = 种子 + 配置 + 输入日志

```ts
type Piece = { seed: number; config: Config; inputLog: Action[] };
```

**这是统一所有形态的关键**。用户的输入（游戏按键、AI 动作）都只是**确定性输入**，被记录下来即可：

- **可复现**：同种子 + 同日志 ⇒ 同作品
- **可撤销**：日志逐条回滚
- **可审计**：AI 做了什么一目了然
- **可分享**：`(种子, 配置)` 编码进 URL，8–64 字符
- **可离线重渲染**：区间导出不需要实时录制

### 2.4 确定性内核的三条硬要求（M0 必须满足）

| 要求 | 原因 |
|---|---|
| **禁止裸 `Math.random()`**，全部经注入的 PRNG | demo 的随机内联使"保存种子"无法实现 |
| **所有调度基于音频时钟**，禁止 `setTimeout` 参与发声 | demo 的 `setTimeout` 会让离线渲染彻底失效 |
| **算子声明 `lookback`/`lookahead` 窗口** | 支撑增量重算（游戏/AI 实时改参数不能重跑整首） |

**PRNG 设计**：`mulberry32` 主序列 + `splitmix32` 派生**每声部/每算子独立子流**。
> 若共用一条序列，用户调 A 参数会让 B 声部也变——这是玩具生成器的通病。

---

## 3. 扩展点：8 个 `register*`

```ts
registerTuning / registerScale / registerFramework / registerRhythm
registerStyle  / registerVoice / registerVisualizer / registerOperator
```

- **前 7 个接受纯数据**（无需写代码），第 8 个是唯一的代码扩展点
- **运行时注册**：支持从 URL 加载内容包（`?pack=`），无需重新构建
- **命名空间与版本**：`id@version`，允许多版本并存（旧分享链接不失效）
- **`paramsSchema`**：算子声明参数 schema 后，**UI 自动生成控件**——贡献者不写前端代码

### 3.1 贡献门槛梯度

| 扩展点 | 贡献形态 | 门槛 |
|---|---|---|
| 可视化 / 调音 / 音阶 / 节奏 | 纯数据 / 纯函数 | ★ |
| **风格 Style Recipe** | **声明式配方** | ★★ |
| 音色 | 参数配方 | ★★ |
| 形态（游戏/AI） | 独立应用 | ★★★ |

**风格配方里一行算法都没有**——只引用其它数据和内置算子：

```jsonc
{ "kind": "style", "data": {
  "defaults": { "bpm": 108, "tuningId": "12-tet" },
  "voices": [
    { "id": "bass", "voiceRef": "sub-bass", "rhythmRef": "afrobeat-tresillo-16", "density": 0.35 },
    { "id": "perc", "voiceRef": "noise-perc", "rhythmRef": "afrobeat-tresillo-16", "density": 0.9 }
  ],
  "structure": [ {"section":"intro","bars":8,"density":0.4}, {"section":"main","bars":24,"density":1.0} ],
  "constraints": [ {"op":"quantizeTime","params":{"grid":"16n"}},
                   {"op":"normalizeVelocity","params":{"curve":"inverseSqrt"}} ]
}}
```

### 3.2 `provenance` 必填

每个内容必须带出处、精确度、局限说明：

```jsonc
"provenance": {
  "sources": [ { "type": "measurement", "citation": "...", "url": "..." } ],
  "accuracy": "measured | theoretical | approximation | simplified",
  "limitations": ["仅代表某套特定合奏；其他合奏调音不同"]
}
```

> 把"学术诚信"从**产品文案**升级为**数据结构**——由 schema 强制、CI 拦截。
> 无出处的音阶进不了库。同时自动满足界面上必须显示的"来源与偏离说明"。

### 3.3 沙箱

| 风险 | 控制 |
|---|---|
| 恶意代码 | 可视化跑在 `<iframe sandbox>` / Worker；算子是纯函数（无 DOM） |
| 性能拖垮页面 | 可视化声明性能预算，掉帧自动降级 |
| 内容审核 | 数据包几乎无风险可开放；**代码包需审核或沙箱**（两条信任路径） |

---

## 4. Action 协议（AI / 游戏 / UI 的唯一入口）

### 4.1 封闭动词集合（v0.1）

```
generate  reroll  lock  unlock  setParam  setVoice  setStructure
applyStyle  setTuning  play  stop  renderRange  export
```

**这不是一门编程语言，是一个动词表**——不允许嵌套、条件、循环、变量。这是安全边界的基础。

### 4.2 文本格式（人类可读、可 diff）

```
piece v1 seed=7f3a91c2
tuning=12-tet  bpm=108  key=D  mood=0.35  energy=0.72
structure: intro(8) main(24) break(8) main(16) outro(8)
voices:
  bass    [locked] style=sub-bass    density=0.35
  harmony          style=e-piano-fm  density=0.45 framework=dorian-modal
  melody           style=pluck       density=0.40 framework=pentatonic
  perc             style=noise-perc  density=0.90 rhythm=tresillo-16
```

```
@action setParam key=energy value=0.72
@action reroll targets=voice:melody
@action applyStyle styleRef=afrobeat-lab-example
```

**为什么不用 JSON**：冗长（token 贵）、易错（缺个括号要重写）、**用户无法审查 AI 做了什么**。

### 4.3 校验层次

| 层 | 检查 | 失败处理 |
|---|---|---|
| 语法 | 动词合法、参数个数 | 报错 |
| 引用 | `styleRef` 等存在 | 报错 + **列出可用值** |
| 范围 | 数值在区间 | 报错 + 给出区间 |
| 语义 | 组合是否矛盾（如 break 段提高密度） | **警告**（不阻断，创作上的矛盾有时是故意的） |
| 安全 | 是否含代码/注入 | 拒绝 |

### 4.4 版本纪律

DSL 头部带 `v1`；Action **只增不改**；未知 Action **必须拒绝并报错**（不可静默忽略，否则 AI 会以为成功了）。
> 分享码与日志是长期资产：**用户三年前分享的链接必须还能打开。**

---

## 5. 技术选型

| 层 | 选型 | 许可（已核实） |
|---|---|---|
| 音频底座 | **Tone.js** `15.1.22` | MIT |
| 律制计算 | **sonic-weave** `0.14.1` | MIT |
| 西方乐理 | **Tonal.js** `4.10.0` | MIT |
| 采样乐器 | **smplr** `1.0.0` | MIT |
| 音频特征 | **meyda** `5.6.3` | MIT |
| 音阶格式 | Scala `.scl`/`.kbm` | 格式标准 |
| 记谱 | VexFlow / abcjs | 预期 MIT（待复核） |
| 3D/WebGL | three.js / regl | 预期 MIT（待复核） |
| **生成层** | 自研（Tidal 模式代数思想） | — |

**必须隔离或放弃**（传染性许可）：Essentia.js（**AGPL**，会上线网站时逼全站开源）、SuperCollider / Sonic Pi / Surge XT（GPL）、butterchurn（GPL）、Csound / p5.js（LGPL）。

> Essentia.js 的 AGPL **可完全规避**——我们是**生成**音乐，音符在生成时已知，不需要从音频反推。

**CI 卡口**：扫描生产依赖树，出现 GPL/AGPL 即构建失败。

---

## 6. 数据层与代码层物理分离

| | 仓库 | 许可 | 发版 |
|---|---|---|---|
| 源码 | `riffle` | Apache-2.0（建议） | 语义化版本 |
| 内容 | `riffle-content` | **逐条独立**（CC0/CC-BY/CC-BY-SA） | 持续更新 |

理由：音阶数据、田野测量、社区贡献的许可各不相同，混进代码仓库会造成许可证污染。

**数据来源注意**：Huygens-Fokker Scala 归档（只做解析器，**不打包文件**）；Xenharmonic Wiki（内容许可有传染性，与代码严格分离）；CompMusic / Saraga / Dunya（**研究用途，禁止再分发**，只引用测量数值并注明出处）。

> **内容几乎无风险可开放，代码包需审核**——这正是"让扩展以数据为主"的另一个回报。

---

## 7. 目录结构（monorepo）

```
packages/
  core/                 L1 内核：零依赖，<3000 行
  content-schema/       JSON Schema 定义 + 校验器
  adapters-tone/        Audio 适配器
  adapters-export/      WAV/MP3/MIDI 导出
  viz-primitives/       基础可视化
  registry/             注册表与内容包加载
  mcp-server/           ★ MCP Server（AI 入口）
apps/
  lab/                  形态①：随机生成实验室
  game-rhythm/          形态②：节奏游戏
  editor/               内容编辑器（贡献飞轮起点）
skills/                 ★ Riffle Skill（Markdown，社区可贡献）
templates/              可视化/算子贡献模板
```

---

## 8. 架构验收的硬指标

> **新增一个形态（游戏 / AI / 画布 / 教学）应当不需要修改 L1–L3 的任何代码。**

做不到就说明抽象漏了——**要回头修架构，而不是打补丁**。

这也是把"第二个形态"和"AI 层"排在早期的原因：单形态的架构永远不知道自己哪里耦合了。
