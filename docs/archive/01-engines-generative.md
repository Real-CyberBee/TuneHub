# 01 · 合成 / 生成 / 作曲引擎生态

> 调研范围：浏览器音频引擎、算法作曲库、生成式音乐项目、先例作品、可复现随机性。
> 许可证以 `04-licensing.md` 为准；置信度说明见 `99-verification-notes.md`。

---

## 1. 浏览器音频引擎

### 1.1 三巨头的定位差异

| 引擎 | 抽象层次 | 许可 | 适合 Riffle 的地方 |
|---|---|---|---|
| **Tone.js** | 高（"DAW in a browser"） | MIT | 乐器、效果器、`Transport` 调度、`Tone.Offline` 离线渲染 |
| **Elementary Audio** | 中（函数式信号图） | 见 04 | 需要声明式 DSP 图时；编译到 AudioWorklet |
| **Signals** | 低（轻量信号图） | 见 04 | 想要 Tone 的便利但不要其体积时 |

**建议：Tone.js 作为默认适配器。**
已核实 `tone@15.1.22`，MIT，依赖 `standardized-audio-context`（跨浏览器差异抹平）与 `tslib`。它的 `Transport` 处理了前瞻调度，`Tone.Offline` 封装了 `OfflineAudioContext`——正好覆盖我们 §1 的两个核心痛点。

但**不要让它进入内核**。内核只产出 `NoteEvent[]`，由适配器翻译成 Tone 调用。这样将来换引擎（或加 WebAssembly DSP 后端）不动内核。

### 1.2 Web Audio 原生能力边界

Web Audio 是 W3C 规范，MN 有完整文档。关键节点与用途：

| 节点 | 用途 |
|---|---|
| `OscillatorNode` | 基础波形；`PeriodicWave`（傅里叶系数）实现任意波表 |
| `GainNode` | 包络、混音（`AudioParam` 自动化） |
| `BiquadFilterNode` | 滤波（低通/高通/带通/peaking…） |
| `ConvolverNode` | 卷积混响，需 IR |
| `WaveShaperNode` | 失真/波形整形 |
| `DelayNode` | 延迟、梳状滤波、Karplus-Strong 的音符长度控制 |
| `DynamicsCompressorNode` | 总线保护（demo 已用） |
| `PannerNode`（HRTF）/ `StereoPannerNode` | 空间化 |
| `AnalyserNode` | 可视化的时域/频域数据源 |
| `AudioWorkletNode` | 自定义 DSP，跑在音频线程 |
| `AudioBufferSourceNode` | 采样播放、粒度合成的原料 |

**`AudioParam` 自动化**是表达力的核心：`setValueAtTime`、`linearRampToValueAtTime`、`exponentialRampToValueAtTime`、`setTargetAtTime`、`setValueCurveAtTime`、`cancelAndHoldAtTime`。
> demo 里 `exponentialRampToValueAtTime(0.001, ...)` 就是标准包络写法——注意**指数斜坡不能到 0**（数学上不成立），必须用极小值如 0.001。

**离线 vs 实时**：`OfflineAudioContext` 用于渲染；关键差异是**它不与墙钟同步，跑得比实时快**，因此任何基于 `setTimeout`/`requestAnimationFrame` 的调度都会失效。这是 Riffle 内核必须时钟无关的根本原因。

### 1.3 AudioWorklet 与 WASM DSP

AudioWorklet 是当前自定义 DSP 的正路（`ScriptProcessorNode` 已废弃）。但它**运行在独立线程**，不能访问 DOM，且需要通过 URL 加载处理器模块（对打包器有讲究）。

想用重型 DSP 时可借 WASM：
- **Faust → `faustwasm`**：函数式 DSP 语言编译到 WASM，适合批量生成音色
- **Csound / WebCsound**、**SuperCollider (scsynth) WASM**：强大但体积大、许可证需谨慎
- **RNBO (Cycling '74)**：商业工具导出 WebAudio，非开源

**建议**：Milestone 0–3 完全不碰 AudioWorklet/WASM。等到需要物理建模音色时（Milestone 4）再引入，且只写几个手写处理器（Karplus-Strong 最简单：延迟线 + 反馈 + 阻尼滤波）。

---

## 2. 算法作曲 / 现场编码引擎

这些是"约束即乐谱"的思想源头，也是 Riffle 生成层的参考。

| 项目 | 语言/栈 | 许可 | 值得借鉴 |
|---|---|---|---|
| **TidalCycles** | Haskell | GPL | **模式（Pattern）代数**：`fast`、`slow`、`every`、`rev`、`sometimes` 等把音乐操作做成可组合函数。这是"约束算子"设计的最佳范本 |
| **Strudel** | JS（Tidal 的浏览器移植） | MIT | 把 Tidal 的模式代数带到浏览器；`Mini notation` 语法微小但表达力强 |
| **Sonic Pi** | Ruby + SuperCollider | GPL | 教学友好的 API 设计（`play`、`sleep`、`live_loop`） |
| **Orca** | JS | MIT | **网格即程序**：每个字符是一个算子，二维排列后互相作用。非音乐人的交互范式范本 |
| **Gibber** | JS | 见 04 | 极简 live-coding 语法，浏览器内合成 |
| **FoxDot / Extempore / Overtone / Improviz** | Python/Scheme/Clojure | 各自不同 | 参考其"把时间结构显式化"的做法 |
| **Csound** | C + 多前端 | LGPL | 老牌、庞大；作为可选后端 |
| **ChucK / WebChucK** | C++/WASM | 见 04 | 强时序（strongly-timed）语言，适合精确节奏 |
| **Pure Data / libpd / pd4web** | C | BSD | 补丁式数据流编程，可跑在 WASM |

### 对 Riffle 的核心启发：**约束应该像 Tidal 的 Pattern 一样可代数组合**

demo 的 `if (mode === 'music')` 是"模式开关"；Tidal 的做法是 `n("0 2 4 7 9").fast(2).every(4, rev)`——**每个操作返回新的模式**，可无限叠加。我们的 `Constraint` 应当是同一哲学：

```ts
// 目标 API 形态（示意）
const piece = generate(seed)
  .pipe(quantizePitch(pentatonic))
  .pipe(quantizeTime(grid('16n')))
  .pipe(limitVoices({ bass: 3, harmony: 5, melody: 4, perc: 8 }))
  .pipe(normalizeVelocity({ curve: 'inverseSqrt' }))
  .pipe(shapeDensity(envelope.arch(0.2, 0.8)));
```

**注意**：Strudel 在 npm 上存在同名包 `strudel@1.0.5`（一个无关的"前端框架"，2019 年发布），**不是** TidalCycles 的移植。真正的项目在 GitHub。这是**明确的供应链风险**，接入前必须核对仓库来源。

---

## 3. 生成式 / ML 音乐

| 项目 | 许可 | 状态与判断 |
|---|---|---|
| **Magenta.js / `@magenta/music`** | Apache-2.0 | 已核实 `1.23.1`（2021 年发布）；依赖 `@tensorflow/tfjs@^2`（很旧）。**实质已停更**。可作参考，不宜作核心依赖 |
| **MusicVAE / MusicRNN** | Apache-2.0 | 逐音符生成的经典；模型小、可在浏览器跑。但风格局限于其训练数据（主要是西方流行/古典） |
| **MusicGen (Meta)** | 权重许可需单独确认 | 音频级生成，效果惊艳但**非 12-TET 友好**、浏览器端需 ONNX 转换，成本高 |
| **Stable Audio Open** | 权重许可需确认 | 同上 |
| **Riffusion** | 见 04 | 频谱图扩散；实验性强 |

> **判断（重要）**：ML 生成与 Riffle 的核心命题（**律制与音乐体系的多样性**）存在方向性冲突。
> 这些模型几乎全部在 12-TET 西方音乐上训练，它们会**抹平**而不是**展现**不同律制的差异。要"让用户听见世界的差异"，确定性算法 + 真实律制数据是更合适的技术路线。
> 建议：**ML 作为后期可选插件，不做核心**。

---

## 4. 先例作品（Prior Art）

| 作品 | 是否开源 | 借鉴点 |
|---|---|---|
| **Google Chrome Music Lab** | 部分开源 | 极佳的音乐教育交互：把抽象概念（和弦、节奏、频谱）变成可玩控件 |
| **Blob Opera** | 否（Web Demo） | 用"生物"隐喻降低音乐操作门槛，趣味性范本 |
| **Experiments with Google 音乐类** | 部分 | 概念验证的密度极高，适合找灵感 |
| **Ableton Learning Synths** | 否 | **合成器教学的最佳实践**：边玩边解释每个参数的作用 |
| **Infinite Drum Machine** | 否 | 用 ML 特征排列音色，交互极简 |
| **Generative.fm** | 部分 | 无人值守的生成音乐流；参考其"永不停歇"的体验设计 |
| **Benn Jordan / 各类 ambient generator** | 多为闭源 | 长时程氛围生成的结构处理 |

**最重要的借鉴**：**Chrome Music Lab 和 Ableton Learning Synths 证明了"零基础可用性"和"技术深度"不矛盾**——方法是把深度藏在可玩的操作背后，而不是藏在设置菜单里。这直接支撑我们"深度渐进暴露"的设计公理。

---

## 5. 可复现随机性

这是 Riffle 的地基，必须一次做对。

### 5.1 PRNG 选择

| 方案 | 特点 |
|---|---|
| **mulberry32** | 32-bit，极短（~10 行），质量足够，**推荐** |
| **xorshift128** | 128-bit 状态，周期长，速度极快 |
| **splitmix32** | 用于把单一种子扩展成多个独立子流（**关键**） |
| **seedrandom** | npm 库，成熟但体积偏大；支持字符串种子 |
| **pure-rand** | 纯函数式、可序列化状态，TypeScript 友好 |

**推荐组合**：`mulberry32` 作主 PRNG + `splitmix32` 派生**每个声部/每个算子独立的子流**。

> **为什么需要子流？** 如果所有算子共用一条随机序列，那么"多开一个算子"会**改变后续所有随机数**，导致用户调 A 参数却听到 B 声部变了。为每个声部/算子分配独立子流后，**局部修改只影响局部**——这是可用性的关键，也是很多玩具生成器的通病。

### 5.2 可序列化状态

要让"从任意时间点离线重渲染"成立，PRNG 必须能**跳转到时间 t 的状态**。两条路：
1. **快进法**：从头快速跑一遍到 t（事件生成很便宜，通常可接受）
2. **可寻址 PRNG**：状态 = 哈希(种子, 计数器)，可 O(1) 跳到任意步（如基于计数器分组的方案）

**建议先用快进法**（简单、够快），把接口留成 `prng.stateAt(t)`，将来可换实现。

### 5.3 分享编码

`(种子, 配置)` → 紧凑分享码。建议：
- 种子：8 位十六进制（32-bit）
- 配置：与默认值的差分 + 变长整数编码 → Base64URL
- 全部塞进 URL fragment（不进服务端日志，且无后端也能分享）

```
https://riffle.example/#v1.7f3a91c2.<base64url-config>
```

**必须带版本号 `v1`**——否则将来算子语义变更会让旧链接失效。旧版本配置需要用**保留的旧算子实现**回放，因此算子实现要有版本化意识。

---

## 6. 选型结论

```
内核：      自研（TypeScript，无音频依赖，纯事件流）
音频适配器：Tone.js（MIT，默认）+ 原生 WebAudio（轻量备选）
律制适配器：sonic-weave（MIT）+ .scl 解析
随机：      mulberry32 + splitmix32 子流派生（自研 ~30 行，避免依赖）
参考范式：  TidalCycles/Strudel（约束代数）、Orca（交互）、Chrome Music Lab（教学）
暂不引入：  ML 模型、WASM DSP、AudioWorklet（均为后期可选插件）
```
