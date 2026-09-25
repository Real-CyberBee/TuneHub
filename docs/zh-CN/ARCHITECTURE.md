# TuneHub · 架构

> 三条主线：**内核薄而深**、**内容按需用数据或代码表达**、**所有形态走同一条 Action 通道**。

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
│ L2 内容包 Content ★ 社区扩展主战场（素材 + 代码生成器）    │
│    律制 │ 音阶 │ 框架/节奏 │ 风格 │ 乐器 │ 音色 │ 主题      │
└──────────────────────────┬───────────────────────────────┘
┌──────────────────────────▼───────────────────────────────┐
│ L1 内核 Kernel   机制。稳定、极小、<3000 行、零运行时依赖    │
│    PRNG(种子/子流) │ 事件流 │ 算子管道 │ 调度器 │ 注册表     │
│    适配器接口: Audio │ Viz │ Input │ Export                │
└──────────────────────────────────────────────────────────┘
```

**不变式**
- L1 公共 API 遵循严格语义化版本，破坏性变更走 RFC
- L2 内容包可独立于 L1 发布；稳定 ID 与版本用于兼容和复现
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

### 2.2 律制、音阶、框架与节奏

```
律制 Tuning       音高如何映射为频率       （等分 / 比例 / 实测）
音阶 Scale        可供使用的音高集合
框架 Framework    音高如何用于旋律与乐句   （上行下行 / 重点音 / 特征乐句）
节奏 Rhythm       声音如何安排在时间中     （拍点 / 循环 / 重音）
```

这些名称用于讨论不同的音乐问题，不代表它们彼此正交，也不要求注册接口一一对应。律制和音阶常可独立复用；框架、节奏、装饰和奏法则可能互相影响。拉格、木卡姆等生成器可以在同一段代码里共同处理这些关系。

只有当某份音阶、节奏型、乐句或音色确实能被多个生成器独立复用时，才需要将它抽成单独素材。框架和节奏仍是有用的音乐术语，但不预设为独立扩展接口。

> **定位提醒**：这些是理解音乐的常用分类，不是每种传统都必须遵循的固定分层。

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

## 3. 内容包与扩展接口

内容包可以包含律制、音阶、框架、节奏、风格、音色、主题等既有概念，但扩展接口不必与这些概念一一对应。具体接口数量与名称不预先冻结；代码生成器可以联合实现框架、节奏、装饰与奏法。

- 静态内容优先用 TypeScript 类型约束的常量表达；需要动态音乐行为时，扩展点可接受实现约定接口的代码模块
- TypeScript 是作者侧的类型约束，不是运行时安全沙箱；内容模块需编译并通过审核。未经信任的代码不从任意 URL 自动执行
- JSON 作为兼容的导入 / 导出格式保留；导入内容需运行时校验。它不限制内容包的权威源格式
- 注册表按命名空间与 `id@version` 管理内容，允许多版本并存，避免同一作品在内容更新后悄然改变含义
- 可选的风格预设可引用静态素材或代码生成器，为用户提供组合入口；它不是所有内容都必须经过的一层

### 3.1 贡献门槛梯度

| 既有术语 | 可选表达方式 | 门槛 |
|---|---|---|
| 律制 / 音阶 / 乐器能力 / 音色 | 类型化常量；乐器关联声音实现 | ★ |
| **框架 / 节奏 / 奏法** | 可由同一个代码生成器共同表达；只有需要复用时才分别抽出 | ★★ |
| 风格预设（可选） | 类型化常量，引用素材与生成器 | ★ |
| 可视化 / 算子 | 实现扩展接口的代码模块 | ★★ |
| 形态（游戏/AI） | 独立应用 | ★★★ |

代码生成器的接口应保持稳定和精简，同时允许实现把相关音乐维度放在一起决策：

```ts
export function generateBhairav(context: GeneratorContext, rng: SeededRandom): NoteEvent[] {
  // 可在同一处协调上/下行、节拍位置、特征乐句与装饰音。
  return generateBhairavPhrase(context, rng);
}

// 需要给用户一键选择时，再用轻量风格预设绑定生成器、音色与参数。
export const afrobeatPreset = {
  id: 'afrobeat-lab',
  generator: 'afrobeat-generator',
  parts: [
    { id: 'bass', instrument: 'synth-bass', timbre: 'warm-sine' },
    { id: 'perc', instrument: 'drum-machine', timbre: 'afro-kit' },
  ],
  bpm: 108,
} as const satisfies StylePreset;
```

以上类型名和签名仅用于说明设计方向，尚未冻结。当前 MVP 的 `NoteEvent` 主要表达时间、音高、时值、力度与音色；扩展到具体传统时，还需用真实样例确认事件模型是否能表达所需的装饰和奏法。

### 3.2 声部、乐器与音色

| 概念 | 含义 | 例子 |
|---|---|---|
| 声部（Part） | 编曲中的角色或音乐线 | 低音、旋律、打击乐 |
| 乐器（Instrument） | 可演奏能力，以及关联的发声实现 | 音域、复音能力、是否支持连续滑音；连接采样器或合成器 |
| 音色（Timbre） | 乐器或发声实现采用的具体音质与配方 | 钢琴的柔和音色、合成低音的振荡器配方 |

风格预设可把声部分配给乐器，并选择音色。生成代码可以读取乐器能力来决定写什么演奏事件；音频层再由对应的发声实现渲染这些事件。演奏规则和乐器能力会相互影响，但不必因此拆成固定的音乐学分类。

当前 MVP 还没有完整的乐器定义：`NoteEvent.voice` 表示声部，`timbre` 字段表示音色标识，但有音高的事件目前仍按声部名查找 `PATCHES`。因此现有代码还把声部和音色选择耦合在一起。

### 3.3 `provenance` 必填

每个内容必须带出处、精确度、局限说明：

```jsonc
"provenance": {
  "sources": [ { "type": "measurement", "citation": "...", "url": "..." } ],
  "accuracy": "measured | theoretical | approximation | simplified",
  "limitations": ["仅代表某套特定合奏；其他合奏调音不同"]
}
```

> 把"学术诚信"升级为**可检查的元数据**——类型辅助作者填写，运行时校验与 CI 拦截缺失项。
> TypeScript 类型不能证明来源真实；引用和许可仍需人工核实。界面据此显示来源与偏离说明。

### 3.4 沙箱

| 风险 | 控制 |
|---|---|
| 第三方代码 | 代码扩展需审核；执行时通过受限接口调用，适用时放入 Worker / iframe；纯函数约定本身不构成安全沙箱 |
| 性能拖垮页面 | 可视化声明性能预算，掉帧自动降级 |
| 内容审核 | 静态常量易于静态检查；代码包需审核、依赖检查和性能验证 |

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
  bass    [locked] instrument=synth-bass   timbre=warm-sine   density=0.35
  harmony          instrument=keyboard    timbre=e-piano-fm  density=0.45
  melody           instrument=plucked-synth timbre=pluck      density=0.40
  perc             instrument=drum-machine timbre=afro-kit   density=0.90
generator=bhairav-afrobeat
```

`generator` 指向一个代码生成器；它可以在内部协调框架、节奏、装饰和奏法。若用户希望一键套用完整预设，Action 可另用 `applyStyle` 选择可选的风格预设。

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

## 6. 内容包与内核独立发布，许可按内容类型声明

| | 仓库 | 许可 | 发版 |
|---|---|---|---|
| 源码 | `tunehub` | Apache-2.0 | 语义化版本 |
| 内容包 | `tunehub-content` | 静态素材可逐条许可（CC0/CC-BY 等）；可执行模块使用明确的软件许可 | 独立版本，与内核解耦 |

理由：音阶数据、田野测量与社区贡献的许可可能不同，内容包可以独立发布和审查。类型化常量本身不决定许可；可执行模块必须标注软件许可，并纳入依赖与许可证检查。

**数据来源注意**：Huygens-Fokker Scala 归档（只做解析器，**不打包文件**）；Xenharmonic Wiki（内容许可有传染性，与代码严格分离）；CompMusic / Saraga / Dunya（**研究用途，禁止再分发**，只引用测量数值并注明出处）。

> 静态素材便于审查和分发；可执行模块需额外审核。两种贡献都走内容包发布流程，但信任与许可要求不同。

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
skills/                 ★ TuneHub Skill（Markdown，社区可贡献）
templates/              可视化/算子贡献模板
```

---

## 8. 架构验收的硬指标

> **新增一个形态（游戏 / AI / 画布 / 教学）应当不需要修改 L1–L3 的任何代码。**

做不到就说明抽象漏了——**要回头修架构，而不是打补丁**。

这也是把"第二个形态"和"AI 层"排在早期的原因：单形态的架构永远不知道自己哪里耦合了。
