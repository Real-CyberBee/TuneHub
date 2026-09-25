# 内容包与可移植导出


`@tunehub/ambient@1.0.0` 是第一个内置 content-pack。它作为经过 PR 审核的静态 ESM 模块随应用发布；不从 URL 下载或执行第三方代码。

一个包必须声明 `id`、`version`、`coreCompatibility`、许可证和 provenance。registry 只解析精确的 `packId@version`，禁止跨包引用；注册时会校验 manifest、资源 id、场景到 Generator/Strategy 的本地引用，以及兼容范围。

包内职责：

- `AmbientScene`：场景策展与默认配置。
- `AmbientScene.config.arrangement`：场景专属的编配方案（音色角色、节奏格、旋律跳进与时值、混响空间）；它是内容数据，Generator 只读取声明，不按场景 id 写分支。
- `Part`：音乐能力与默认渲染提示；生成器读取能力，事件不携带合成器私有字段。
- `SessionStrategy`：确定性地编排片段、种子、候选 take；不写音符、不接触 Audio。
- `Generator`：声明 `lookback`/`lookahead`，纯函数地按窗口写出 Score。

作品以 `PieceSnapshot` 复现，保存精确包版本、场景/策略/生成器 id、种子、用户配置覆盖、声部覆盖和 finite/endless 模式；不记录 Action 日志。缺少指定包版本时明确停止并提示，不会偷偷换成另一种音乐。

音色名如 `feltPiano`、`pulseBass` 是语义化渲染提示，不是 Score 的私有字段：事件仍只记录 `Part`、Pitch、时间与 articulation。Web Audio Adapter 将提示映射为合成配方；未知提示安全回退到该 Part 的默认音色，保证旧作品和新包可兼容播放。

## Score 与导出

规范 Score 使用分数 Beat、TempoMap、MeterMap 与 `Pitch` 联合类型；事件为 `note`、`control`、`marker`。秒与 MIDI 是 Adapter 的投影。

| 文件                 | 用途               | 保真度                                                     |
| -------------------- | ------------------ | ---------------------------------------------------------- |
| `mix.wav`            | 直接播放的完整混音 | 当前 Audio Adapter 的完整声音                              |
| `stems/*.wav`        | DAW 分轨再创作     | 计划中的按 Part 离线渲染；不改变音乐语义                   |
| `arrangement.mid`    | DAW 可编辑编曲     | MIDI 1.0；微分音以 pitch bend 投影，复杂重叠可能受格式限制 |
| `tunehub-score.json` | 无损回导/审计      | 完整 Pitch、分数 Beat、内容引用与 Snapshot                 |

MIDI 与 WAV 的局限不会反写进规范 Score。Audio 和导出 Adapter 读取同一份 Score，因此新增音源或格式不需要修改内容包生成器。
