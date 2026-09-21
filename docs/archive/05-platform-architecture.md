# 05 · 平台架构：模块化、可贡献、多形态

> 本文是**架构转向后的主文档**。
> 需求从"做一个音乐生成器"变更为"做一个**平台**"：让社区能补充音阶/调式、风格、节奏、可视化、游戏。
> 这带来一个根本性的设计约束：**内核只提供机制，贡献者只提供数据。**

---

## 0. 为什么原方案不够

原架构（`00-MASTER-DEBRIEF.md` §2）把内核设计成"自研的确定性事件流 + 约束算子"，这是对的；但它隐含了一个错误假设：**扩展方式是写代码**。

如果要"让大家都能参与补充音阶、调式、风格、节奏、可视化"，那么：

| 假设 | 问题 |
|---|---|
| 扩展 = 写 TypeScript + 提 PR | 门槛过高。懂巴厘岛甘美兰调音的音乐学者**不该被迫学 npm 和 AudioWorklet** |
| 扩展 = 往核心仓库加分支 | 无法规模化；核心会被数百个风格污染 |
| 游戏 = 核心的一个模式 | 会让核心被第一个游戏的交互需求绑死 |

**结论**：扩展的**主要形态必须是数据**，而不是代码。代码只用于少数"机制"级别的扩展。

---

## 1. 分层：机制 vs 数据 vs 形态

```
┌───────────────────────────────────────────────────────────────┐
│  L4 · 形态层 Forms        "怎么玩"                              │
│  随机生成器 │ 节奏游戏 │ 解谜 │ 协作画布 │ 教学 │ Live Coding    │
│  —— 每个形态都是一个独立应用，共用下面三层 ——                    │
└───────────────────────────┬───────────────────────────────────┘
                            │ 内核 API（生成 + 实时输入 + 事件流回放）
┌───────────────────────────▼───────────────────────────────────┐
│  L3 · 可视化层 Visualizers   纯函数 (乐谱, 环境) → 渲染          │
│  钢琴卷帘 │ 频谱 │ 音分偏差 │ 音高螺旋 │ Tonnetz │ 粒子 │ 自制    │
└───────────────────────────┬───────────────────────────────────┘
┌───────────────────────────▼───────────────────────────────────┐
│  L2 · 数据层 Content    ★ 社区贡献的主战场 ★                     │
│  律制 Tuning │ 音阶 Scale │ 框架 Framework │ 节奏 Rhythm         │
│  风格 Style Recipe │ 音色 Voice │ 视觉主题 Theme                 │
│  —— 全部是声明式数据文件，无需写代码 ——                          │
└───────────────────────────┬───────────────────────────────────┘
┌───────────────────────────▼───────────────────────────────────┐
│  L1 · 内核 Kernel       机制。稳定、极小、极少变动               │
│  PRNG(种子/子流) │ 事件流 │ 算子管道 │ 调度器 │ 注册表 │ 序列化   │
│  适配器接口: Audio │ Viz │ Export │ Input                       │
└───────────────────────────────────────────────────────────────┘
```

**不变式**：
- L1 的公共 API 一旦发布，遵循**严格语义化版本**；破坏性变更必须走 RFC
- L2 是数据，**不需要发版**，可以随时新增
- L4 的每个形态**独立发版**，互不阻塞
- L2 与 L4 之间无直接依赖，都只依赖 L1

> **这是整个架构最重要的一句话**：
> **贡献者写数据，不是写代码。** 一个懂爪哇甘美兰的人，应该只需要写一个 JSON/YAML 文件就能把斯连德罗调音贡献进来。

---

## 2. 六个扩展点，与各自的贡献门槛

按"贡献者需要什么背景"排布，形成从易到难的参与梯度：

| # | 扩展点 | 贡献形态 | 贡献者需要会 | 破坏风险 | 门槛 |
|---|---|---|---|---|---|
| 1 | **可视化 Visualizer** | 一个纯函数（+ 可选 shader） | JS 基础 | 低（沙箱隔离） | ★ |
| 2 | **调音 / 音阶** | 数据文件（比例/音分/实测频率） | 乐理 / 田野测量 | 无（纯数据） | ★ |
| 3 | **节奏型 Rhythm** | 数据（分层的步进模式） | 会数拍子 | 无 | ★ |
| 4 | **风格 Style Recipe** | **组合上述数据的声明式配方** | 会描述音乐规则 | 无 | ★★ |
| 5 | **音色 Voice** | 参数配方（声明式）；进阶可写 DSP | 会听 + 会调参 | 中 | ★★ |
| 6 | **形态 Form（游戏等）** | 独立应用，调用内核 API | 前端开发 | 无（隔离） | ★★★ |

**关键设计**：门槛 1–4 全部是**纯数据或纯函数**，没有副作用、没有音频线程、没有构建配置。这意味着：
- 可以在浏览器里**直接写、直接听、直接提交**（无需本地环境）
- 可以用**校验器**自动检查正确性（音阶是否单调、节奏是否对齐、配方引用的音色是否存在）
- 可以用**低门槛 Web 编辑器**，甚至表单式创建

> **建议**：把"在浏览器里创建并分享一个音阶/风格"作为**第一优先产品功能**。让贡献的摩擦低到"填个表就能提交"，是社区能否转起来的分水岭。

---

## 3. 数据契约（L2 的核心）

所有 L2 内容遵循同一套信封格式，便于工具化处理、校验、检索、署名。

### 3.1 通用信封

```jsonc
{
  "$schema": "https://riffle.dev/schema/v1/tuning.json",
  "id": "slendro-javanese-kraton-1983",     // 全局唯一，kebab-case
  "version": "1.0.0",
  "kind": "tuning",                          // tuning|scale|framework|rhythm|style|voice|theme
  "name": { "en": "Javanese Slendro (measured)", "zh": "爪哇斯连德罗（实测）" },
  "provenance": {                            // ★ 强制字段：这是学术诚信的载体
    "sources": [
      { "type": "measurement", "citation": "Surjodiningrat et al. 1972", "url": "..." }
    ],
    "accuracy": "measured",                  // measured|theoretical|approximation|simplified
    "limitations": ["仅代表某套特定合奏；其他合奏调音不同"],
    "culturalNote": "斯连德罗是活态传统，本数据仅为工具用途"
  },
  "license": "CC-BY-SA-4.0",                 // ★ 数据可独立于代码许可
  "contributors": ["@handle"],
  "tags": ["indonesia", "gamelan", "non-equal"],
  "data": { /* 按 kind 不同 */ }
}
```

**`provenance` 是必填项**，不是可选项。这是把上一轮讨论的"诚实标注"从**产品文案**升级为**数据结构**——由 schema 强制，由 CI 校验。任何没有出处的音阶都进不了库。

> 这个设计同时解决了三个问题：学术诚信、内容筛选（低质量贡献自动被 provenance 要求挡掉）、以及用户界面上必须显示的"来源与偏离说明"。

### 3.2 各 kind 的 data 形状

#### tuning（律制）

```jsonc
{
  "kind": "tuning",
  "data": {
    "periodCents": 1200,
    "type": "measured",           // edo | ratio-set | measured | formula
    "frequenciesHz": [221.5, 249.1, 291.8, 331.2, 372.6],   // measured
    "referenceHz": 221.5
    // type=edo 时:      { "divisions": 31 }
    // type=ratio-set 时: { "ratios": [[1,1],[9,8],[5,4]] }
    // type=formula 时:   { "sonicWeaveExpr": "tet(19)" }
  }
}
```

#### scale（音阶）

```jsonc
{
  "kind": "scale",
  "data": {
    "tuningId": "12-tet",              // 引用一个音阶所使用的律制
    "degrees": [0, 2, 4, 7, 9],        // 取哪些步进
    "degreeNames": { "0": "宫", "2": "商", "4": "角", "7": "徵", "9": "羽" }
  }
}
```

#### framework（调式—旋律框架）★ 最容易被低估的一层

```jsonc
{
  "kind": "framework",
  "data": {
    "scaleId": "bhairav-thaat",
    "ascending":  [0, 1, 4, 5, 7, 8, 11],   // aroha
    "descending": [11, 8, 7, 5, 4, 1, 0],   // avaroha（常与上行不同！）
    "emphasis":   { "0": 1.0, "4": 0.6, "7": 0.3 },  // vadi/samvadi/durak
    "phrases": [                              // pakad / 惯用乐句
      { "degrees": [0, 1, 4, 0], "weight": 0.5, "name": "pakad" }
    ],
    "direction": "ascending-first",
    "cadence": { "approach": [7, 4, 1, 0], "weight": 0.3 }
  }
}
```

> **这是本平台最有差异化的数据结构。** 绝大多数软件只有"音阶"；`framework` 让拉格/木卡姆/达斯特加赫这些**行为规则**第一次成为可贡献的一等数据。
> 且它足够简单——一个懂拉格的人能在半小时内填完。

#### rhythm（节奏型）

```jsonc
{
  "kind": "rhythm",
  "data": {
    "cycleSteps": 16,                          // 一个循环多少步
    "layers": [
      { "voice": "kick",  "steps": [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0] },
      { "voice": "snare", "steps": [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0] }
    ],
    "swing": 0.0,                              // 0 = 平直
    "accentPattern": [1.0, 0.6, 0.8, 0.6],
    "polyrhythm": { "against": 3, "mode": "cross" }   // 可选：交叉节奏
  }
}
```

#### style（风格配方）★ 社区贡献的"主角"

风格 = **把上面的数据组合成一套生成规则**。它是纯声明式的，这让"补充一个风格"变成"写一个 JSON"。

```jsonc
{
  "kind": "style",
  "data": {
    "defaults": { "bpm": 96, "tuningId": "12-tet", "meter": "4/4" },
    "voices": [
      { "id": "bass",    "midiBase": 36, "range": 12, "voice": "sub-bass",
        "rhythmRef": "rhythm:afrobeat-bass", "density": 0.35, "decay": 0.8 },
      { "id": "harmony", "midiBase": 48, "range": 12, "voice": "e-piano",
        "frameworkRef": "framework:dorian-modal", "density": 0.5 },
      { "id": "melody",  "midiBase": 60, "range": 15, "voice": "pluck",
        "frameworkRef": "framework:pentatonic", "density": 0.4 },
      { "id": "perc",    "midiBase": 72, "range": 12, "voice": "noise-perc",
        "rhythmRef": "rhythm:afrobeat-drums", "density": 0.9 }
    ],
    "structure": [                              // 结构层
      { "section": "intro",  "bars": 8,  "density": 0.4 },
      { "section": "main",   "bars": 32, "density": 1.0 },
      { "section": "break",  "bars": 8,  "density": 0.3 },
      { "section": "main",   "bars": 24, "density": 1.0 },
      { "section": "outro",  "bars": 8,  "density": 0.2 }
    ],
    "constraints": [                            // 组合内置算子
      { "op": "quantizeTime", "grid": "16n" },
      { "op": "limitVoices", "limits": { "bass": 3, "harmony": 5, "melody": 4, "perc": 8 } },
      { "op": "normalizeVelocity", "curve": "inverseSqrt" },
      { "op": "voiceLeading", "maxLeap": 5, "preferCommonTones": true }
    ]
  }
}
```

> **请注意 `style` 里没有一行是"算法"**——它只是引用其它数据和内置算子。
> 这就是"贡献者写数据不写代码"的具体体现。一个音乐制作人看完这个格式，能立刻想到怎么描述自己熟悉的风格。

### 3.3 数据必须与代码物理分离

| | 仓库 | 许可 | 发版节奏 |
|---|---|---|---|
| **源码** | `riffle` | Apache-2.0 | 语义化版本 |
| **内容** | `riffle-content` | **逐条独立许可**（CC0/CC-BY/CC-BY-SA） | 持续更新，无需发版 |

理由见 `04-licensing.md`：音阶数据、田野测量、社区贡献的许可各不相同，混进代码仓库会造成许可证污染。

---

## 4. 内核：为什么它必须小到能被读完

开源项目能否吸引贡献者，很大程度取决于**核心是否可理解**。

**设计目标：内核 < 3000 行 TypeScript，无第三方运行时依赖，一个新人能在半天内读完。**

### 4.1 内核 API 面（应当只有这些）

```ts
// ---------- 确定性生成 ----------
function createEngine(config: EngineConfig): Engine;

interface Engine {
  // 纯函数式：给定种子与配置，产出确定性事件流
  generate(range: TimeRange): NoteEvent[];
  // 实时演奏：外部输入（游戏/键盘/MIDI）注入事件
  inject(input: InputEvent): void;
  // 回放：完整输入日志可复现一次演奏
  getInputLog(): InputEvent[];
  // 可视化与导出的唯一数据源
  subscribe(fn: (events: readonly NoteEvent[]) => void): Unsubscribe;
  // 序列化：种子 + 配置 + 输入日志 = 作品
  serialize(): SerializedPiece;
  static deserialize(s: SerializedPiece): Engine;
}

// ---------- 扩展点注册 ----------
registerTuning(def: TuningDef): void;
registerScale(def: ScaleDef): void;
registerFramework(def: FrameworkDef): void;
registerRhythm(def: RhythmDef): void;
registerStyle(def: StyleDef): void;
registerVoice(def: VoiceDef): void;
registerVisualizer(def: VisualizerDef): void;
registerOperator(def: OperatorDef): void;   // 唯一"写代码"的扩展点

// ---------- 适配器接口（由外部实现） ----------
interface AudioAdapter  { play(events, at): void; stop(): void; }
interface VizAdapter    { mount(el, engine): void; }
interface InputAdapter  { on(cb: (e: InputEvent) => void): void; }
interface ExportAdapter { render(range, opts): Promise<Blob>; }
```

**8 个 `register*` = 8 个扩展点。** 这就是全部。新人打开 `index.ts` 能一眼看完。

### 4.2 注册表设计要点

- **运行时注册，非编译期**：允许从 URL 加载内容包（`?pack=afrobeat`），无需重新构建
- **命名空间与版本**：`id@version`，支持并存多个版本（旧分享链接不会因内容更新而失效）
- **冲突策略**：同 id 重复注册时，**核心内置内容不可被覆盖**，社区内容可被同 id 覆盖并警告
- **能力声明**：每个扩展声明它需要什么（能否离线渲染、是否需要 AudioWorklet），调度器据此选择路径

### 4.3 算子扩展（唯一的代码扩展点）

内置算子覆盖 80% 的约束需求（量化、限流、归一、和声进行）。若社区需要新算子：

```ts
registerOperator({
  id: 'voice-leading',
  version: '1.0.0',
  // 纯函数，无副作用，可序列化
  apply(events: readonly NoteEvent[], params: unknown, ctx: GenContext): NoteEvent[],
  // 可选：声明参数 schema，UI 自动生成控件
  paramsSchema: { maxLeap: { type: 'number', min: 0, max: 12, default: 5 } },
});
```

**关键**：`paramsSchema` 让 UI **自动**为任何新算子生成控件。贡献者不需要写任何前端代码。

### 4.4 沙箱与安全

社区可视化与算子就是"别人网站上的代码"。风险与控制：

| 风险 | 控制 |
|---|---|
| 恶意代码 | 可视化在 `<iframe sandbox>` 或 `Worker` 中运行；算子在纯函数环境（无 DOM 访问） |
| 性能拖垮页面 | 可视化声明性能预算；超时/掉帧自动降级或禁用 |
| 内容审核 | 内容包签名 + 精选列表（curated registry）；默认只加载精选源 |

> 建议：**内容包（纯数据）与代码包（可视化/算子）走两条不同的信任路径**。
> 数据几乎无风险，可以开放；代码包需要审核或沙箱。这又一次说明"让扩展以数据为主"是正确选择。

---

## 5. 形态层：为什么游戏是内核的一等消费者

这是本轮最重要的架构结论。

### 5.1 多形态带来的核心矛盾

| 需求 | 要求 |
|---|---|
| 随机生成器（原方案） | **确定性**：同种子 ⇒ 同作品，可分享、可离线重渲染 |
| 游戏（节奏游戏、解谜、协作） | **交互性**：用户输入在运行时改变音乐，无法预知 |

这两个需求**看起来冲突**：如果用户输入能被记录为随机性的一部分，就能统一。

### 5.2 统一方案：把"输入"也当作确定性的输入源

**核心洞察：用户的输入本身就是一种确定性输入——只要被记录下来。**

```
作品 = (种子, 配置, 输入日志)

随机生成器：输入日志为空
节奏游戏：  输入日志 = 每次按键的时间戳与判定
协作画布：  输入日志 = 每次拖拽的轨迹
Live Coding：输入日志 = 每次代码修改
```

于是：
- **游戏可以回放**（"重看我的最佳一局"）
- **游戏成绩可验证**（服务端重放判定，防作弊）
- **游戏可以分享**（分享码里包含输入日志，或只包含种子+成绩）
- **所有形态共用同一个导出/可视化/分享链路**——因为内核只看事件流

> **这是把"多形态"做到架构层，而不是做成 5 个互不相干的 demo 的关键。**

### 5.3 内核必须提供的实时能力

为了让游戏能"用音乐基础设施以不同方式生成音乐"，内核需要：

```ts
interface Engine {
  // 1. 前瞻调度：输入必须在未来某个音频时刻生效，不能"立刻"
  //    游戏按键的延迟容忍度极低，必须走 look-ahead 队列
  schedule(input: InputEvent, atTime: number): void;

  // 2. 查询当前音乐状态（游戏 UI 要显示"现在是什么和弦"）
  getState(atTime: number): MusicState;

  // 3. 实时约束重算：用户改了一个音，后续自动重新量化
  //    注意：必须是"局部重算"，否则每次输入都重跑整首，性能崩
  recomputeFrom(time: number): void;

  // 4. 事件流订阅：可视化与游戏渲染共用
  subscribe(fn: (events: readonly NoteEvent[]) => void): Unsubscribe;
}
```

**`recomputeFrom(t)` 是性能关键**：必须支持增量重算。这要求算子管道是**可分段**的——这反过来要求在设计算子时明确其**时间依赖范围**（有些算子只看当前事件，有些需要上下文窗口）。

> **设计约束（需在 M0 就定下）**：`OperatorDef` 必须声明 `lookback`/`lookahead` 窗口，调度器据此确定增量重算的边界。

### 5.4 形态清单（作为架构的验证用例）

架构好不好，看它能不能自然支持这些形态。每个形态都应只需写 L4，不碰 L1–L3：

| 形态 | 玩法 | 用到的内核能力 |
|---|---|---|
| **随机生成器**（原型形态） | 调参 + 生成 + 导出 | `generate` + 算子管道 |
| **节奏游戏** | 跟着律动打拍，判定准确度 | `schedule` + `getState` + 输入日志 |
| **和弦解谜** | 给出目标和声，玩家排列音级 | `getState` + `recomputeFrom` |
| **音阶画布** | 拖拽音符，自动量化到所选律制 | `recomputeFrom` + `inject` |
| **调音对比实验** | 同旋律在两种律制间即时 A/B | 内核 `Pitch` 抽象 + 音分偏差可视化 |
| **协作画布** | 多人（异步）在同一作品上叠加 | 输入日志合并 + 序列化 |
| **教学关卡** | 逐步解锁算子的教程 | 算子管道 + 内容包 |
| **氛围长流** | 无人值守永不停歇的生成 | 长时程结构 + 确定性流 |
| **Live Coding** | 写模式语言，实时听到 | `recomputeFrom` + 内置模式算子 |

**验收标准**：新增一个形态应当**不需要修改 L1–L3 的任何代码**。如果做不到，说明抽象漏了。

---

## 6. 让社区真正转起来：贡献链路设计

架构支持贡献 ≠ 社区会贡献。需要刻意设计飞轮。

### 6.1 贡献路径（按摩擦从低到高）

```
① 浏览器内创建        填表/拖拽 → 点"分享" → 得到一个链接
                      （无需 git、无需账号）
                          ↓
② 一键提交内容 PR      链接 → "提交到内容库" → 自动生成 PR
                      （带 schema 校验、provenance 检查）
                          ↓
③ 可视化/算子代码包    fork 模板仓库 → 实现纯函数 → 提 PR
                          ↓
④ 新形态（游戏）       独立仓库，引用内核作为 npm 依赖
```

**① 是最关键的一环**。如果贡献一个音阶需要 clone 仓库、装 pnpm、跑构建，那 99% 的潜在贡献者（尤其是音乐学者）会在第一步流失。

> **产品建议**：内置"内容编辑器"，让用户在浏览器里**以所见即所得的方式创建音阶/节奏/风格**，并能试听、能分享、能一键提交 PR。这个编辑器本身应该在第一期就做——它是飞轮的起点。

### 6.2 内容质量与治理

| 机制 | 作用 |
|---|---|
| **Schema 校验**（CI） | 格式错误自动拦截 |
| **Provenance 必填**（CI） | 无出处的音阶进不来 |
| **自动听感检查** | 音阶单调性、音程是否荒谬、节奏是否对齐拍子 |
| **策展列表 (curated)** | 官方精选；默认只加载精选内容 |
| **署名与引用** | 每个内容的 `contributors` 与 `provenance` 永久保留（贡献者动机） |
| **内容 Issue 模板** | 让不懂 PR 的人也能"提交"（维护者代劳） |

### 6.3 贡献者的动机设计（常被忽视但决定成败）

- **署名可见**：内容卡片上显示贡献者，作品分享页显示"使用 @xxx 的甘美兰调音"
- **被使用量可见**：让贡献者看到自己的音阶被多少人用过
- **明确的低门槛入门任务**：标注 `good-first-contribution` 的内容请求（如"缺一个冰岛民歌音阶"）
- **本地语言**：内容名称支持多语言（信封里的 `name.{en,zh,...}`）

---

## 7. 修订后的仓库结构

单体仓库（monorepo），但**内容与代码分离**：

```
riffle/                        # 代码仓库 (Apache-2.0)
├── packages/
│   ├── core/                      # L1 内核：零依赖，<3000 行
│   ├── content-schema/            # ★ JSON Schema 定义 + 校验器
│   ├── adapters-tone/             # Audio 适配器
│   ├── adapters-webaudio/         # 轻量 Audio 适配器
│   ├── adapters-export/           # WAV/MP3/MIDI 导出
│   ├── viz-primitives/            # 基础可视化（钢琴卷帘、频谱、音分偏差）
│   └── registry/                  # 注册表与内容包加载
├── apps/
│   ├── lab/                       # 形态①：随机生成实验室
│   ├── game-rhythm/               # 形态②：节奏游戏
│   ├── game-puzzle/               # 形态③：和弦解谜
│   ├── canvas/                    # 形态④：音阶画布
│   └── editor/                    # ★ 内容编辑器（贡献飞轮的起点）
└── templates/
    ├── viz-template/              # 可视化贡献模板
    └── operator-template/         # 算子贡献模板

riffle-content/                # 内容仓库 (逐条许可)
├── tunings/
├── scales/
├── frameworks/
├── rhythms/
├── styles/
├── voices/
└── themes/
```

---

## 8. 对原路线图的修订

原 `ROADMAP.md` 的 M0–M5 仍然成立，但需要插入**平台化**相关的工作，并调整优先级。

| 阶段 | 原计划 | 修订 |
|---|---|---|
| **M0** 内核抽离 | 确定性内核 + 调度器 | ➕ 定义**扩展点接口**与注册表；算子声明 `lookback/lookahead` |
| **M1** 约束算子化 | 约束可组合 | ➕ **内容 Schema + 校验器**；内容与代码仓库分离 |
| **M2** 律制层 | sonic-weave 接入 | ➕ **浏览器内音阶编辑器**（贡献飞轮起点，提升优先级） |
| **M3** 框架层 | 拉格/木卡姆样例 | ➕ 内容包加载机制（`?pack=`）；多语言内容名 |
| **M4** 导出与音源 | 离线渲染导出 | ➕ 可视化贡献模板 + 沙箱隔离 |
| **M5** 社区化 | 后端/分享 | ➕ **治理机制**：策展列表、署名体系、内容 Issue 模板 |
| **M6** 新形态 | —（新增） | ➕ **第二个形态（建议节奏游戏）**，用于验证架构的多形态能力 |

> **建议把"做出第二个形态"作为架构验收的硬指标**，而不是留到最后。
> 单形态的架构永远不知道自己哪里耦合了；第二个形态会立刻暴露所有抽象漏洞。
> 这也是为什么我把游戏从"后期功能"提到"架构验收手段"。

---

## 9. 需要重新拍板的问题

平台化引入了三个新的前置决策（与原 §6 的 5 个问题并列）：

1. **内容仓库是否独立？** 建议独立（许可与发版节奏不同）。若不愿维护两个仓库，至少要有严格的目录与许可分离。
2. **浏览器内内容编辑器是否进第一期？** 建议**是**——它是贡献飞轮的唯一入口。这会让 M2 变重，但回报最大。
3. **第二个形态选什么？** 建议**节奏游戏**：它与随机生成器的需求（交互输入 vs 确定性输出）差异最大，最能压力测试架构。
