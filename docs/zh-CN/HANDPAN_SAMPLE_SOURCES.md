# 真实手碟单音参照来源

本清单用于比较发音规律。分析文件均放在 `/tmp`，不进入 TuneHub 的发音资源。网页音频的名称不能单独证明乐器种类；优先采用来源明确、一次击奏可分辨、许可清楚的录音。对照时应先对齐起音与响度，再分别看各音区的起音包络、模态比例和衰减；不同琴、麦克风和房间的差异不应被当作统一的合成参数。

| 优先级 | 来源及乐器 | 单音覆盖与本机路径 | 许可、录音条件与限制 |
| --- | --- | --- | --- |
| 主要参照 | [FreePats D 小调 Hang](https://freepats.zenvoid.org/ChromaticPercussion/hang.html)，[原始仓库及 README](https://github.com/freepats/hang-D-minor) | 多次击奏的 A3、D4、E4 等；此前下载的 `/tmp/real-hang-A3_*.wav`、`/tmp/real-hang-E4_*.wav`。仓库样本列表没有 D3。 | CC0。2017 年使用 Zoom H1 在马德里 Medialab-Prado 礼堂录制，经裁切、编辑和处理。房间与处理可能改变尾音；D 小调音列不能直接代替项目的 D 大调音列。 |
| 跨音区辅助参照，实物来源待核实 | Freesound 作者 GAMEDRIX974 的 [HandPan 1st model 单音包](https://freesound.org/people/GAMEDRIX974/packs/33041/) | 共 12 个分开的音频文件。公开高品质 MP3 预览及本地 WAV 解码在 `/tmp/tunehub-handpan-sources/freesound/gamedrix/`；`3-preview.wav` 约为 A3（219.4 Hz）、`14-preview.wav` 约为 D4（293.1 Hz）、`17-preview.wav` 约为 E4（327.8 Hz）。各文件前段为一次明显击奏及其余音。 | [3.wav](https://freesound.org/people/GAMEDRIX974/sounds/587411/)、[14.wav](https://freesound.org/people/GAMEDRIX974/sounds/587407/)、[17.wav](https://freesound.org/people/GAMEDRIX974/sounds/587410/) 页面均标 CC0；原件标称 44.1 kHz、16 bit、立体声 WAV，但网页提示“Login to download”，本轮实际取得的是经 MP3 转码的公开预览。作者只写“HandPan 1st model / handpan tones”，未提供实物照片、制造者、麦克风、空间或后期信息；不能独立证实为真手碟而非合成/样本重制。文件名是编号，不是原始音高标签；括号内音高来自频谱估计。 |
| 独立制作者的定性参照，实物来源较明确 | [HaganeNote 官方虚拟手碟](https://www.haganenote.com/vst/handpan-virtual-instrument.html)；页面称使用其手工制作手碟的真实采样 | 页面列出 C3–G5 的 32 个 MP3 文件。本地例子：`/tmp/tunehub-handpan-sources/haganenote/D3.mp3`、`A3.mp3`、`D4.mp3`、`E4.mp3`，以及同目录解码后的 WAV。 | 网站[法律说明](https://www.haganenote.com/legal-advice/)标注保留全部权利；这里只作本机定性分析，不随产品分发。文件是 44.1 kHz、320 kbps MP3；没有每音重复击奏、具体乐器/麦克风/空间信息，音高扩展可能涉及变调。因此不适合高频细节或击打间方差的严格统计。 |

## 排除或仅作辅助的来源

- [GeorgeNaimeh 的 Shaktipan C# 录音](https://freesound.org/people/GeorgeNaimeh/sounds/493864/)标 CC0，作者说明是 Andrea Tonella 制作、氮化钢材质、调音后在意大利 Biella 录制。公开 MP3 预览保存在 `/tmp/tunehub-handpan-sources/freesound/shaktipan-csharp-preview.mp3`，解码副本为 `/tmp/tunehub-shaktipan-csharp-preview.wav`。约 4 秒内有连续不同音高的击奏；只用最初约 100 ms 作第一击的粗略起音辅助，不把整段当孤立单音或用于尾音统计。
- [E Akebono 手碟的 dry 录音](https://freesound.org/people/deleted_user_4087401/sounds/520472/)标 CC0，16 秒公开预览在 `/tmp/tunehub-handpan-sources/freesound/e-akebono-dry-preview.mp3`。约每秒有新击奏，前音余振重叠；作者未披露录音条件，且该音阶与项目不同，不用于孤立音统计。
- [GAMEDRIX974 的 5.wav](https://freesound.org/people/GAMEDRIX974/sounds/587418/)属上述单音包，约为 D3；公开预览在 `/tmp/tunehub-handpan-sources/freesound/gamedrix/5-preview.wav`。可用于同琴低音交叉检查，但只有单次击奏。
- [`jdrea1587/Handpan-Sample`](https://github.com/jdrea1587/Handpan-Sample) 的 README 显示 Ayasa Guana Kurd 9 的交互页面，但未交代 MP3 录音者及音频许可，故不列为核心测量集。`/tmp/spen-handpan-reference/` 的 [仓库 README](https://github.com/spen/Handpan)也未说明 WAV 来源与真伪，先排除。
- [`audioset-io/Audioset-website`](https://github.com/audioset-io/Audioset-website)的 README 宣称 255 个手碟音频及三档力度，但仓库目前只有文字和元数据，没有所称 WAV；不能作为本轮实测来源。
- [Pianobook Handpan](https://www.pianobook.co.uk/packs/handpan/)的作者说明原素材实际是钢舌鼓，不符合真实手碟参照要求。

## 下一轮分析边界

FreePats 同一音高有多次击奏，可估计**同琴、同音的变化范围**；HaganeNote 给出来源较明确的独立实物定性参照；Shaktipan 可辅助观察另一只来源明确的实体琴的第一击；GAMEDRIX 的 A3/D4/E4 仅用于低权重交叉检查，实物身份未核实，每个音高也只有一条录音。不能将某个统一的“首峰毫秒数”断言为手碟的普遍特性。尤其 FreePats 是礼堂处理过的 WAV，而其他本轮取得的文件是 MP3；**不要用这些 MP3 预览与原始 WAV 比较精细高频结构、编码前几毫秒或很低电平的尾音**。定量结果和跨来源结论见[比较记录](HANDPAN_SAMPLE_COMPARISON.md)。
