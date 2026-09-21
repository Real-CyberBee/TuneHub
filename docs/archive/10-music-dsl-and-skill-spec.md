# 10 · 音乐 DSL 与 Action 协议规范（草案 v0.1）

> 这是 **AI 层、游戏层、UI 层共用的唯一入口协议**。
> 设计目标：**紧凑**（token 便宜）、**人类可读**（用户能看懂 AI 在做什么）、**可 diff**（改动可逐行审查）、**声明式**（绝不含可执行代码）。
> 论证见 `09-ai-integration.md`。

---

## 1. 为什么需要专门设计一个 DSL

直接用 JSON 有三个问题：

| 问题 | 后果 |
|---|---|
| 冗长 | 一个作品状态几百行 JSON，模型注意力被稀释，token 成本高 |
| 易错 | 嵌套结构里缺一个括号，模型就得重写一大段 |
| 不可读 | **用户无法审查 AI 做了什么**——这违反透明性原则 |

因此设计一个**面向行（line-oriented）的紧凑文本格式**。

---

## 2. 状态表示（`get_piece_state` 的输出）

```
piece v1 seed=7f3a91c2
tuning=12-tet  bpm=108  key=D  mood=0.35  energy=0.72
structure: intro(8) main(24) break(8) main(16) outro(8)
voices:
  bass    [locked] style=sub-bass    density=0.35
  harmony          style=e-piano     density=0.45 framework=dorian-modal
  melody           style=pluck       density=0.40 framework=pentatonic
  perc             style=noise-perc  density=0.90 rhythm=tresillo-16
```

### 2.1 语法规则

| 元素 | 规则 |
|---|---|
| 头部 | `piece v<版本> seed=<8位hex>` —— **必填**，版本用于兼容旧分享码 |
| 全局参数行 | `键=值` 对，双空格分隔。键：`tuning` `bpm` `key` `mood` `energy` |
| 结构行 | `structure: <段名>(<小节数>) ...` |
| 声部块 | 以 `voices:` 开始，每个声部一行，**两空格缩进** |
| 声部字段 | `[locked]` 可选锁定标记 + `键=值` 对 |
| 归一化数值 | `mood` / `energy` / `density` 均为 `0.0`–`1.0` |

### 2.2 为什么这个格式对 AI 友好

- **每行自包含**：模型改一行不会破坏整体结构
- **diff 直观**：`density=0.45` → `density=0.62` 一眼看出改了什么
- **用户可读**：这也是 UI 的"高级模式"可以直接展示的文本
- **`mood`/`energy` 就是三旋钮**：AI 与人类操作同一套参数，不引入第二套概念

---

## 3. Action 协议

### 3.1 Action 清单（封闭集合，v0.1）

**这是模型能做的全部事情。没有第 12 种。**

| Action | 参数 | 语义 |
|---|---|---|
| `generate` | `seed?` | 用给定或新种子生成 |
| `reroll` | `targets` | 重掷指定对象（`all` / `voice:<id>` / `structure`） |
| `lock` / `unlock` | `targets` | 锁定/解锁（锁定项不被 reroll 影响） |
| `setParam` | `key`, `value` | 设置全局参数（`bpm`/`key`/`mood`/`energy`/`tuning`） |
| `setVoice` | `voice`, `key`, `value` | 设置声部参数（`style`/`density`/`rhythm`/`framework`/`mix`） |
| `setStructure` | `sections[]` | 设置段落结构 |
| `applyStyle` | `styleRef` | 应用一个风格配方（覆盖多个声部） |
| `setTuning` | `tuningRef` 或 `expr` | 设置律制（可传 sonic-weave 表达式） |
| `play` / `stop` | — | 播放控制 |
| `renderRange` | `start`, `duration` | 渲染区间音频 |
| `export` | `format`, `start?`, `duration?` | 导出 WAV/MP3/MIDI |

### 3.2 序列化格式

```
@action reroll targets=voice:melody
@action setParam key=energy value=0.72
@action setVoice voice=perc key=density value=0.9
@action setTuning expr="tet(19)"
@action lock targets=voice:bass,voice:perc
@action applyStyle styleRef=afrobeat-lab-example
```

**规则**：
- 每行一个 Action，以 `@action` 开头（便于与状态文本区分）
- 参数为 `键=值`，值含空格或特殊字符时用双引号
- `targets` 支持逗号分隔与通配
- **不允许嵌套、不允许条件、不允许循环、不允许变量**
  → 这不是一门编程语言，**是一个动词表**。这是安全边界的基础。

### 3.3 `propose_actions` 的返回

```
ok: false
errors:
  line 3: styleRef 'e-piano' 不存在。可用：sub-bass(超低音), pluck(拨弦), e-piano-fm(电钢), noise-perc(噪声打击)
  line 5: value 1.4 超出 density 范围 0.0–1.0
warnings:
  line 2: energy 从 0.72 提到 0.95 会与当前 structure 的 break 段冲突（预期密度下降）
preview:
  应用后：更热闹、加入拨弦声部、bpm 不变
```

**关键**：错误信息**要给出可用的替代值**（如上面列出可用 styleRef）。
这让模型能**一次修正成功**，而不是反复试错。

### 3.4 校验层次

| 层 | 检查 | 失败处理 |
|---|---|---|
| 语法 | Action 名合法、参数个数正确 | 报错 |
| 引用 | `styleRef`/`rhythmRef`/`tuningRef` 存在 | 报错 + **列出可用值** |
| 范围 | 数值在允许区间 | 报错 + 给出区间 |
| 语义 | 组合是否矛盾（如 break 段却提高密度） | **警告**（不阻断） |
| 安全 | 是否含代码/注入/危险操作 | 拒绝 |

> **语义层只警告不阻断**——因为创作上的"矛盾"有时是故意的。

---

## 4. Skill 规范

### 4.1 Skill 与 MCP 工具的分工

| | MCP 工具 | Skill |
|---|---|---|
| 是什么 | **手**（能力） | **脑**（判断） |
| 形式 | 代码接口 | Markdown 文档 |
| 长度 | 短（描述 + 参数） | 长（可数千字） |
| 谁写 | 核心开发者 | **社区可写** |
| 更新频率 | 随内核发版 | 随时可改 |
| 内容 | "能做什么" | "什么时候做、怎么做、别做什么" |

### 4.2 Skill 文件格式（草案）

```markdown
---
name: riffle-genre-ambient
description: 用 Riffle 制作氛围/环境音乐（ambient）。当用户提到"雨夜""安静""氛围""睡眠""背景音乐"时使用。
---

# 氛围音乐配方

## 何时使用
用户想要放松、安静、无人声的背景音乐；或明确提到 ambient / 氛围 / 环境。

## 参数起点
- energy 0.15–0.30（**关键：氛围音乐的核心是低能量**）
- mood 0.30–0.45（偏幽暗，但不悲伤）
- bpm 60–76（越慢越好，不要超过 80）
- structure 用长段：intro(16) main(48) outro(24)，避免频繁切换

## 声部建议
- bass：低密度（0.15–0.25），长衰减，给空间留白
- harmony：用 pad 类音色，density 0.3 左右，**不要抢旋律位置**
- melody：稀疏（0.1–0.2），允许长音符与静默
- perc：**通常关闭**，或极低密度（<0.1）的柔和打击

## 常见错误
- ❌ energy 超过 0.5 → 立刻不像氛围音乐
- ❌ perc 密度过高 → 破坏沉浸感
- ❌ 结构切换太快 → 氛围音乐需要长段落
- ❌ 一开始就全部声部齐响 → 应逐层进入

## 工作流
1. `applyStyle` 一个氛围预设做起点
2. `setParam` 调 energy/mood 到用户描述的方向
3. `render_preview(30s)` + `evaluate_piece()` 检查
4. 若 verdict 不佳，优先降 energy 与 perc 密度
5. 落地前先 `propose_actions` 给用户看会变成什么样

## 边界
- 不要承诺"专业级成品"
- 若用户要"正宗 XX 传统音乐"，诚实说明限制（见 riffle-tuning-explorer）
```

### 4.3 Skill 清单（v0.1 建议 6 个）

| Skill | 触发场景 | 核心内容 |
|---|---|---|
| `riffle-getting-started` | 用户第一次使用 | 平台能力、基本工作流 |
| `riffle-music-for-beginners` | 用户说"我不懂音乐" | 如何把情绪/场景描述翻译成参数 |
| `riffle-genre-recipes` | 用户提到具体风格 | 各风格的参数配方（可无限扩展 → **社区贡献点**） |
| `riffle-tuning-explorer` | 用户想探索不同调音 | 引导方式 + **诚实边界**（衔接 `02`） |
| `riffle-safe-creation` | 始终加载 | 提示注入防护、不执行代码、不覆盖用户作品 |
| `riffle-export-and-share` | 用户要保存/分享 | 区间导出、分享码、种子复现 |

> **`riffle-genre-recipes` 是社区贡献的主战场**——写一个风格配方就是写一段 Markdown。
> 这让"教 AI 做新风格"变成和"贡献一个音阶"同级别的低门槛贡献，**直接接入 `05` 的贡献飞轮**。

---

## 5. 完整交互示例

```
用户：我想要雨夜城市的孤独感，但结尾要有一点希望

AI:   [describe_capabilities]
AI:   [find_similar "雨夜 氛围 孤独"]  → 找到 3 个相近预设
AI:   [applyStyle ambient-rainy-night]  ← 提议
     [propose_actions]
       @action applyStyle styleRef=ambient-rainy-night
       @action setParam key=energy value=0.22
       @action setParam key=bpm value=68
       @action setVoice voice=perc key=density value=0.0
       @action setStructure sections=intro(16),main(40),lift(16),outro(24)
     → ok: true
       preview: 低能量氛围、无打击、结尾有一段情绪上扬
AI:   [render_preview 30s]
AI:   [evaluate_piece]
     → { pleasantness: 0.81, muddiness: 0.34, verdict: "fair",
         hint: "低频偏浊，建议和声声部高通 +30Hz 或降密度" }
AI:   自行修正（1 轮）：
       @action setVoice voice=harmony key=density value=0.35
AI:   [apply_actions] → applied, undo=u-7f3a
AI:   "做好了。低能量的雨夜氛围，perc 关闭，结尾有一段上扬。
      低频有点浊，我已经调整过。要听一下吗？"

用户：太吵了
AI:   [propose_actions] @action setParam key=energy value=0.12
     [apply_actions]
     "降低到很安静了。"
```

**注意最后一步**：用户只说"太吵了"——**AI 需要把它翻译成 `energy` 降低**。这正是 Skill（`riffle-music-for-beginners`）该教的映射。

---

## 6. 版本与兼容

| 规则 | 说明 |
|---|---|
| DSL 头部带 `v1` | 旧分享码必须永久可解析 |
| Action 只增不改 | 已发布的 Action 语义不可变更（同 `05` 的扩展点纪律） |
| 废弃流程 | 标记 deprecated → 警告 → 至少两个大版本后才移除 |
| 未知 Action | **必须拒绝并报错**，不可静默忽略（否则 AI 会以为成功了） |

> **关键**：分享码与 Action 日志都是**长期资产**。用户三年前分享的链接必须还能打开——这要求协议从第一天就有版本纪律。
