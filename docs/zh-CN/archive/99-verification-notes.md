# 99 · 来源与置信度说明

> 本文是**诚实交代**：哪些结论是亲自核实的，哪些来自既有知识，哪些需要实施前复核。
> 目的是让后续开发者知道**该信什么、该验证什么**。

---

## 1. 本轮调研的实际情况（重要）

诚实说明本次调研的执行过程与局限：

1. **最初派出 3 个研究子代理，均未产出文件。** 它们（及其自行派生的子代理，共 13 个）只创建了 `research/_parts/` 空目录便结束，**没有把任何发现写入磁盘**。因此本目录下的文档**不是**子代理的产出，而是由主代理（我）独立撰写。
2. 子代理派生失控（13 个）与 `web_search` 后端报错，是本次调研的主要干扰。**如果重跑，应在委派提示中明确禁止子代理继续派生，并要求每个子代理必须落盘写文件。**
3. **网络访问不稳定**：`web_search` 与 `web_fetch` 间歇性失败（`fetch failed`）。`registry.npmjs.org` 是唯一稳定可用的来源，因此**只有 npm 包的许可信息得到了一手核实**。
4. 因此本文档的**核心价值在于架构判断与设计推理**（那部分不依赖网络），而**具体第三方项目的许可证、版本、URL 必须由实施者自行复核**。

---

## 2. 已一手核实的事实（高置信）

来源：`https://registry.npmjs.org/<包名>/latest` 的实时响应（HTTP 200），字段为响应中的 `license` 与 `version`。

| 包 | 核实到的版本 | 核实到的许可 |
|---|---|---|
| `tone` | 15.1.22 | MIT |
| `sonic-weave` | 0.14.1 | MIT |
| `@tonaljs/tonal` | 4.10.0 | MIT |
| `smplr` | 1.0.0 | MIT |
| `meyda` | 5.6.3 | MIT |
| `@magenta/music` | 1.23.1 | Apache-2.0 |

**附加核实到的细节**：
- `tone@15.1.22` 依赖 `standardized-audio-context@^25.3.70` 与 `tslib@^2.3.1`
- `sonic-weave@0.14.1` 依赖 `xen-dev-utils`、`moment-of-symmetry`；导出子模块包含 `temper`、`warts`、`monzo`、`pythagorean`、`diamond-mos`、`fjs`、`scale-workshop-2-parser`；README 确认支持 `tet(n)`、`8::16`、`sort(3^[-1..5] rdc 2)` 等语法，并支持音级名称与颜色
- `smplr@1.0.0` 的 devDependencies 含 `@types/audioworklet`，**提示其内部使用 AudioWorklet**（对离线渲染兼容性有影响）
- `@magenta/music@1.23.1` 依赖 `@tensorflow/tfjs@^2` 与 `tone@^14`（**与 tone@15 冲突**），最后发布时间约 2021-11

**已通过一手来源确认存在、但未逐字读 LICENSE 文件的项目**：
- `strudel`（npm 上的 `strudel@1.0.5` 是**无关同名包**——一个 2019 年的"前端框架"，作者与仓库均与 TidalCycles 无关。真正的 Strudel 在 GitHub `tidalcycles/strudel`。**这是明确的供应链风险**）
- `scale-workshop`（xenharmonic-devs，已确认存在；其语言内核即 sonic-weave）
- `awesome-webaudio`（notthetup，精选列表，可用于扩充调研）
- **Scale Workshop** 与 **SonicWeave** 均属 xenharmonic-devs 组织，且 SonicWeave 为 MIT——**同一组织其余项目很可能同为宽松许可，但需逐个确认**
- **Apotome & Leimanti**（Khyam Allami / Counterpoint）用户指南可公开访问，用于阿拉伯/中立音体系交互参考
- **OpenAIR** IR 数据集可公开访问（用于卷积混响）

---

## 3. 基于既有知识、需复核的结论（中置信）

以下内容我基于训练知识写入，**未能在本轮网络条件下核实**。标注为 ⚠️ 的条目在 `04-licensing.md` 中已明确要求实施前复核。

### 许可证类（高风险，必须复核）
- Strudel / TidalCycles / Orca / Gibber / VexFlow / abcjs / three.js / pixi.js / regl / d3 / @tonejs/midi / midi-writer-js 的许可
- SuperCollider = GPL、Sonic Pi = GPL、Essentia.js = AGPL、butterchurn = GPL、Csound = LGPL、p5.js = LGPL
- Hydra（疑 AGPL）、libflacjs、lamejs 系、spessasynth、js-synthesizer、soundfont-player
- SoundFont 音源（GeneralUser GS、FluidR3）的再分发条款
- Xenharmonic Wiki 的内容许可（疑 CC BY-SA）

### 事实类（中风险，建议复核）
- 各世界音乐语料库（CompMusic / Saraga / Dunya）的具体许可条款——**我确信其为研究用途限制，但具体措辞需核对**
- Scala `.scl`/`.kbm` 格式的字段级细节（本文只写了用途，未写字段规范）
- Wilsonic / MTS-ESP / Surge XT 的许可
- 各可视化/记谱库的最新版本与维护状态

---

## 4. 无需外部核实的部分（本文档的主要价值）

以下内容是**设计推理与架构判断**，其正确性不依赖于网络查证，而是基于对 demo 源码的直接阅读与工程推理：

| 结论 | 依据 |
|---|---|
| demo 的 `Math.random()` 使"保存种子"无法实现 | 直接阅读 `prototype/original-demo.html` 第 317–321、332 行 |
| demo 的 `setTimeout` 调度会使离线渲染失效 | 直接阅读第 255–258 行 |
| 必须拆分"律制/音阶/框架"三层 | 对拉格 `aroha/avaraka/pakad`、木卡姆 `jins/seyir`、甘美兰实测调音的领域分析 |
| `Pitch` 必须是标签联合而非 MIDI 整数 | 若退化为整数则永久丧失表达微分音/实测频率的能力 |
| PRNG 需按声部/算子派生子流 | 否则局部参数修改会污染全局随机序列（可用性通病） |
| 离线重渲染优于实时捕获 | `MediaRecorder` 受后台标签页节流影响且无法预知区间 |
| AGPL 对 Web 项目风险最高 | AGPL 网络条款使"提供服务"视同分发 |
| ML 模型与"展现律制多样性"目标方向冲突 | 主流音乐生成模型均在 12-TET 西方音乐上训练 |

---

## 5. 给实施者的复核清单

在开始编码前，花半天做以下核实（约 20 个 curl 请求即可完成）：

```bash
# 批量核实 npm 包许可（本轮唯一稳定可用的链路）
for p in tone sonic-weave tonal smplr meyda strudel-or-its-actual-name \
         @tonejs/midi lamejs @breezystack/lamejs midi-writer-js \
         vexflow abcjs three pixi.js regl d3 seedrandom pure-rand \
         web-audio-beat-detector; do
  echo -n "$p: "
  curl -s "https://registry.npmjs.org/$(echo $p | sed 's|/|%2f|')/latest" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('license'), d.get('version'))" 2>/dev/null || echo "FAILED"
done
```

**但注意**：npm 的 `license` 字段**可能不准确或缺失**。对进入生产依赖的包，
**必须打开其 GitHub 仓库读 `LICENSE` 文件原文**，而不是相信包元数据。

**必须在 CI 中加的卡口**：扫描生产依赖树，出现 `GPL`/`AGPL` 即构建失败。
（可用 `license-checker`、`licensee` 或 npm 自带 `npm query` 实现。）

---

## 6. 本次调研的教训（供后续改进）

1. **委派子代理时必须显式禁止其派生孙代理**，否则会指数扩散（本次 3 → 13），既消耗配额又难以收敛。
2. **要求子代理必须写文件**，并在提示中给出确切的输出路径与"完成标准"；否则可能"读完就忘"，产出为零。
3. **网络不稳时优先用 API 端点而非网页抓取**：`registry.npmjs.org` 全程可用，而 `raw.githubusercontent.com` 与随机网页大量失败。
4. **架构推理不一定依赖联网调研**。本次文档中价值最高的判断（三层抽象、`Pitch` 数据模型、PRNG 子流、离线渲染约束）全部来自阅读源码与工程推理，不来自资料搜集。
