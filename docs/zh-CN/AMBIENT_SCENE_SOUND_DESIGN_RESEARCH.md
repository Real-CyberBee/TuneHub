# 氛围场景声学设计调研与首版配器方向


> 目的：为 `@tunehub/ambient` 的八个场景建立**可追溯的设计起点**，解决当前仅改变 BPM / energy / mood 后听感仍相近的问题。
>
> 结论边界：这些研究大多在受控、短时、特定人群中完成；它们可以排除明显不合适的做法，却不能推出某一个“最佳 BPM”或保证真实世界的表现。因此文中的 BPM、音色和生成规则均标为产品起点，必须接受实际试听和 A/B 测试修正。不要把它们写成健康、安全或效率承诺。

## 1. 证据如何使用

| 标记     | 含义                                 | 在本项目中的用法                                 |
| -------- | ------------------------------------ | ------------------------------------------------ |
| **直接** | 研究任务与场景相同或非常接近         | 作为默认值和明确的反向约束。                     |
| **邻接** | 研究任务相近，但人群、环境或任务不同 | 作为可调范围的依据，不作强主张。                 |
| **策展** | 研究没有规定具体声部/音色            | 基于产品目标提出的可试听假设，必须保留用户控制。 |

音乐的速度、调式与主观唤醒/心情确有可测关联，但方向和强度并不只由速度决定；Husain、Thompson 与 Schellenberg 的实验正是把 tempo 与 mode 分开操纵来观察这种关系。[来源 1] 因而场景不能只是一组 `bpm + energy`：至少还要独立表达节奏规则、事件密度、动态包络、音色/空间、旋律信息量和段落行为。

所有“人声”建议均指**不使用可辨识歌词**，而非把人声本身当成问题。阅读等语言任务中，背景音乐的干扰会受任务和听者差异影响；直接研究并未支持“因为喜欢就一定不干扰阅读”的简单假设。[来源 2][来源 3] Zhang 等的阅读 ERP 实验还发现，高、低唤醒音乐都会改变语义整合指标（N400）；音乐不能被默认当作无成本背景。[来源 10]

## 2. 场景设计卡

### 阅读

- **证据与约束（直接）**：Perham 与 Currie 的实验没有发现偏好背景音乐能改善阅读理解；认知任务中的背景音乐研究也发现任务、人格与音乐特征会改变结果。[来源 2][来源 3] 首版应把“文字优先、可随时静音”当作产品原则，而不是承诺音乐提高专注。
- **起始参数（策展）**：`54–72 BPM`、近似自由拍或极弱的 4/4 脉冲；每 8–16 小节保留 1–2 小节无旋律的空白。低事件密度、低动态范围，不做突发升调、fill 或明显高潮。
- **配器与音效（策展）**：暖 pad + 低频柔和 drone + 很稀疏的电钢/拨片单音；高频打击只作为极轻的颗粒纹理。低通、长但不浑的混响，避免明亮 closed hat、clap、强 kick 与可辨识采样。
- **旋律生成（策展）**：限制为 3–5 个音的短动机；相邻音优先、长时值优先，旋律的入场概率低；和声缓慢移动，禁止连续的高音重复型。加入 `silenceBudget` 与 `melodyIntrusion` 两个显式参数。

### 做家务

- **证据与约束（邻接）**：工作情境研究报告了音乐、情绪与自评表现的关联；同步音乐在跑步机步行实验中也改变了耐力与心理生理指标。[来源 11][来源 7] 家务不是这两种实验，不能把结果外推为“提高效率”的承诺。
- **起始参数（策展）**：`100–116 BPM`、清晰 4/4，2 或 4 小节一个稳定循环；每 16 小节只做一次小变化，保持可预期的工作节拍。
- **配器与音效（策展）**：圆润 kick、手拍/木块、短的 shaker、弹性 bass、明亮但不刺耳的 pluck；可以少量使用擦拭/水滴式的合成 foley，但绝不伪装成真实环境录音。压缩短、混响短，保证节拍轮廓。
- **旋律生成（策展）**：上行或回归主音的两小节问答；bass 在根音与五度间稳定运动；每个循环只改变一个层（例如 shaker 的密度），避免同时换和声、节奏和音色。

### 吃饭

- **证据与约束（直接）**：Milliman 在餐厅环境的实证研究发现，背景音乐速度会显著影响停留时长、消费等行为变量。[来源 4] 这并不导出某个“促消费速度”；TuneHub 的目标应是让交谈与用餐优先，避免操纵性设计。
- **起始参数（策展）**：`68–84 BPM`，弱拍或无 kick；动态保持平缓，段落不做剧烈 build-up。默认响度较阅读略高但仍留出对话空间，并让用户一键切到“更安静”。
- **配器与音效（策展）**：尼龙吉他/柔和 electric piano、upright bass、brush、木质轻打击、短 room reverb；不使用人声、尖锐高帽、重低音或会被误听为餐具碰撞的硬瞬态。
- **旋律生成（策展）**：以和声内音和短回答为主，四到八小节才出现一次完整句；优先中音区，避免高音区主旋律抢占说话注意力。可采用 I–vi–IV–V 一类平缓功能进行，但不把特定文化音阶当作“餐饮”标签。

### 开车

- **证据与约束（直接）**：Brodsky 的模拟驾驶实验直接检验了音乐速度与车辆控制的关系。[来源 5] 后续人因研究继续检验“音乐速度是否影响驾驶行为”这一问题，说明它不能被产品简化成单一的安全或性能旋钮。[来源 12] 因此不能宣称音乐会提高驾驶安全性；默认设计应降低显著、突然或会诱发跟拍的刺激，并始终把驾驶者对道路的注意力置于音乐之前。
- **起始参数（策展）**：`88–106 BPM` 的稳定巡航脉冲；避免首版的高能量 `112 BPM` 作为唯一默认。禁止突发 silence、突然加速、尖锐 riser、强烈左右声像扫动和密集的低频 drop；音量变化慢（至少跨 4 小节）。
- **配器与音效（策展）**：圆形电子 bass、柔和 kick、低饱和 arpeggio、宽但不极端的 pad；可有极轻的 road-like noise texture，但不模拟警报、喇叭、转向灯、刹车或导航提示等安全相关声音。
- **旋律生成（策展）**：用持续 ostinato 和每 8 小节一次的和声色彩替代高辨识 hook；旋律控制在中音区，避免突发大跳和高频重复。为长途模式提供缓慢的 32 小节能量波，但不改变速度。

### 休息

- **证据与约束（直接）**：Harmat 等对睡眠质量不佳学生的音乐干预研究，以及其关于交感神经活动、焦虑和生理指标的研究背景，支持把音乐作为可能有助于放松的非医疗性体验；它不构成治疗或助眠保证。[来源 6] Bernardi 等的小样本生理实验中，较快 tempo 与较简单的 rhythm 相对基线提高心率、血压和通气，而静音段让多项指标降至基线以下。[来源 13] 这支持把安静窗口作为可选结构，不证明某个固定 BPM 能“助眠”。
- **起始参数（策展）**：`40–60 BPM` 或不显式量化的缓慢呼吸脉冲；几乎没有节拍器式打击。事件密度随时间下降，末段能自然淡出而非结束时突然静音。
- **配器与音效（策展）**：低通 pad、缓慢的 sine/sub drone、非常柔和的 bell/玻璃泛音、长尾混响；弱化 2–5 kHz 的刺耳成分，完全移除 kick/snare/clap。环境纹理必须可关闭。
- **旋律生成（策展）**：长音、下行或围绕主音的小范围摆动；提高重复概率，降低新材料概率；使用 `releaseWindow` 逐段减少音符和声部，禁止尾段的调性反转或最终强终止。

### 派对

- **证据与约束（直接）**：McElrea 与 Standing 的实验发现快音乐会缩短饮用完成时间。[来源 8] 这说明速度会影响行为节奏，也提示产品不应借“派对”场景以高速度或提示来鼓励饮酒。更直接的舞动设计依据是 Witek 等对 funk 鼓组的实验：想动与愉悦对切分呈倒 U 型，中等切分最高。[来源 14] 默认应是可跳舞、可社交的能量，而不是行为操纵或把复杂度拉满。
- **起始参数（策展）**：`116–126 BPM`、明确四拍地板和 8/16 分音符层；用 16/32 小节的能量弧线营造变化，而非不断加速。动态可以比其他场景更大，但设峰值保护并避免突然的全静音。
- **配器与音效（策展）**：kick、clap、open/closed hat、弹性 bass、短 stab、明亮 lead、短 riser 与轻量 impact；所有效果必须有上限和预知式铺垫，避免惊吓式转场。
- **旋律生成（策展）**：短而可循环的 1–2 小节 hook，采用 call-and-response；低音锚定根音并在段落边界改变节奏，主旋律只在高潮进入。增加 `danceability`、`dropIntensity` 与 `transitionLength`，不以泛化的 `energy` 代替。

### 运动

- **证据与约束（直接）**：Karageorghis 等的随机顺序跑步机研究考察了同步音乐、耐力和心理生理指标。[来源 7] 另一个跑步机实验把 tempo 与响度分开操纵，说明它们不能收敛成一个 `energy` 值；跑步研究也发现音乐 tempo 会影响步频。[来源 15][来源 16] 对产品最可用的结论是提供稳定、可匹配的脉冲与速度控制；它不表示某一 BPM 对所有人、所有运动都更安全或更有效。
- **起始参数（策展）**：`128–150 BPM`，允许用户选择“半拍/原拍/双拍”以对齐个人步频；保持强而稳定的 downbeat。不要在运动中自动改 BPM，间歇训练只能由显式段落计划触发。
- **配器与音效（策展）**：干净、短起音的 kick/snare/hat，sidechain 的 synth bass，激励性的 brass/saw stab，有限的噪声上升；压缩使重拍清楚，但留足 headroom，避免持续失真疲劳。
- **旋律生成（策展）**：8 小节动力型 riff + 16 小节答句；节奏比旋律承担更多身份，采用稳定重复和极少的停顿。可用 `cadenceBpm`、`intervalPlan`、`downbeatStrength` 表达，而非只提高 density。

### 视频配乐

- **证据与约束（直接）**：Boltz 的实验研究表明，电影配乐可影响观看者对事件的情感影响、注意与后续记忆；这意味着视频背景音乐不应只有“好听”，还必须把可控的情绪、叙事提示和编辑点交给创作者。[来源 9]
- **起始参数（策展）**：不要设单一默认速度：提供 `slow 60–75`、`medium 84–100`、`upbeat 108–124 BPM` 三个可导出的起点；在固定节拍网格上生成，避免自由速度漂移，便于剪辑对点。
- **配器与音效（策展）**：可组合的 pad、piano/pluck、bass pulse、轻 percussion、可选 riser/impact；以干声和短/可控混响为默认，避免效果尾音遮挡剪辑。对画外旁白默认降低中频旋律密度和持续 pad。
- **旋律生成（策展）**：主题应是可剪断的 2/4/8 小节模块；每个段落写出 `marker`（进入、建立、转场、收束）与可选的 downbeat/impact cue。导出时保持 part/stem 与 marker，不把“视频情绪”写死进不可编辑的混音。

## 3. 直接可转为内容包的数据模型

现有场景只有 `mood`、`energy`、`bpm`、`scaleId`、`sections`，因而同一个 Generator 的默认规则吞掉了场景差异。首版不必一次实现全部合成器，先在 `AmbientScene` 增加可声明、可验证的 `musicProfile`，由 Generator 和 Audio Adapter 分别消费：

```js
{
  tempo: { defaultBpm: 68, minBpm: 54, maxBpm: 72, meter: '4/4', allowTempoChange: false },
  rhythm: { grid: '1/8', pulse: 'subtle', syncopation: 'low', fillEveryBars: 0 },
  density: { notesPerBar: [1, 4], silenceBarsEvery: [8, 16] },
  melody: { range: 'mid', maxLeapSemitones: 4, motifBars: 4, entrance: 'rare' },
  dynamics: { targetLufs: 'quiet', peakChangeBars: 4, transient: 'soft' },
  palette: { instruments: ['warm-pad', 'soft-keys'], effects: ['low-pass', 'long-reverb'] },
  arrangement: { energyArc: 'settle', markers: ['enter', 'rest', 'tail'] },
  safety: { forbid: ['siren-like', 'sudden-silence'] },
}
```

`musicProfile` 不是合成器私有参数：`palette.instruments` 是语义化音色角色，Audio Adapter 才将其映射到具体 patch；Score 仍只保存 Part、Pitch、动态、时间和 marker。这样可以在不改变生成作品语义的前提下替换 Web Audio、采样器或离线渲染器。

建议将现有四个泛化 Part（bass/harmony/melody/perc）扩成按场景启用的角色，例如 `drone`、`pulse`、`texture`、`hook`、`impact`。其中 `texture` 和 `impact` 必须显式标为可关闭，驾驶和休息场景还应具有 `safety` 禁止项。不要用特定地域/传统音阶给通用生活场景贴标签；除非内容包拥有可靠来源、演奏/音色语境和适当 provenance。

## 4. 验证顺序

1. **先做可听的差异**：为八个场景建立独立 `musicProfile`，并让生成器真正读取节奏、密度、旋律范围和配器角色；只改展示标签不算完成。
2. **做客观快照测试**：固定 seed 下断言 BPM、已启用 Part、每小节事件密度、最大旋律跳进、marker 和禁用的效果均符合场景 profile；不以“悦耳”这种不可重复断言代替测试。
3. **做盲听和情境测试**：至少让听者在“阅读/休息/驾驶模拟/运动”等目标任务中比较新旧版本；记录主观干扰、节奏匹配、疲劳和关闭率。驾驶只在安全的模拟环境测试。
4. **把偏好留给用户**：每个场景公开速度、安静度、打击乐、纹理/环境声和旋律显著度；研究支持的是范围与风险控制，不是剥夺个人差异的理由。

## 来源

1. Husain, G., Thompson, W. F., & Schellenberg, E. G. (2002). _Effects of Musical Tempo and Mode on Arousal, Mood, and Spatial Abilities_. **Music Perception, 20**(2), 151–171. 原始实验论文。[DOI](https://doi.org/10.1525/mp.2002.20.2.151)
2. Perham, N., & Currie, H. (2014). _Does listening to preferred music improve reading comprehension performance?_ **Applied Cognitive Psychology, 28**(2), 279–284. 原始实验论文；[DOI](https://doi.org/10.1002/acp.2994)，[作者存档全文](https://figshare.com/articles/journal_contribution/Does_listening_to_preferred_music_improve_reading_comprehension_performance_/19539196)。
3. Furnham, A., & Bradley, A. (1997). _Music while you work: The differential distraction of background music on the cognitive test performance of introverts and extraverts_. **Applied Cognitive Psychology, 11**(5), 445–455. 原始实验论文。[DOI](<https://doi.org/10.1002/(SICI)1099-0720(199710)11:5%3C445::AID-ACP472%3E3.0.CO;2-R>)
4. Milliman, R. E. (1986). _The Influence of Background Music on the Behavior of Restaurant Patrons_. **Journal of Consumer Research, 13**(2), 286–289. 餐厅现场研究。[DOI](https://doi.org/10.1086/209068)
5. Brodsky, W. (2001). _The effects of music tempo on simulated driving performance and vehicular control_. **Transportation Research Part F: Traffic Psychology and Behaviour, 4**(4), 219–241. 模拟驾驶实验。[DOI](<https://doi.org/10.1016/S1369-8478(01)00025-0>)
6. Harmat, L., Takács, J., & Bódizs, R. (2008). _Music improves sleep quality in students_. **Journal of Advanced Nursing, 62**(3), 327–335. 随机对照音乐干预研究。[DOI](https://doi.org/10.1111/j.1365-2648.2008.04602.x)
7. Karageorghis, C. I., Mouzourides, D. A., Priest, D.-L., Sasso, T. A., Morrish, D. J., & Walley, C. L. (2009). _Psychophysical and Ergogenic Effects of Synchronous Music during Treadmill Walking_. **Journal of Sport and Exercise Psychology, 31**(1), 18–36. 原始对照实验；[DOI](https://doi.org/10.1123/jsep.31.1.18)，[机构存档全文](https://bura.brunel.ac.uk/handle/2438/3117)。
8. McElrea, H., & Standing, L. (1992). _Fast Music Causes Fast Drinking_. **Perceptual and Motor Skills, 75**(2), 362. 原始实验论文。[DOI](https://doi.org/10.2466/pms.1992.75.2.362)
9. Boltz, M. G. (2001). _Musical Soundtracks as a Schematic Influence on the Cognitive Processing of Filmed Events_. **Music Perception, 18**(4), 427–454. 原始实验论文。[DOI](https://doi.org/10.1525/mp.2001.18.4.427)
10. Du, M., Jiang, J., Li, Z., Man, D., & Jiang, C. (2020). _The effects of background music on neural responses during reading comprehension_. **Scientific Reports**. 39 名研究生的阅读语义整合实验。[DOI](https://doi.org/10.1038/s41598-020-75623-3)
11. Lesiuk, T. (2005). _The effect of music listening on work performance_. **Psychology of Music, 33**(2), 173–191. 工作情境研究；属于家务的邻接证据。[DOI](https://doi.org/10.1177/0305735605050650)
12. Navarro, J., Osiurak, F., & Reynaud, E. (2018). _Does the Tempo of Music Impact Human Behavior Behind the Wheel?_ **Human Factors**. 人因驾驶研究；不能据此作驾驶安全承诺。[DOI](https://doi.org/10.1177/0018720818760901)
13. Bernardi, L., Porta, C., & Sleight, P. (2006). _Cardiovascular, cerebrovascular, and respiratory changes induced by different types of music in musicians and non-musicians: the importance of silence_. **Heart, 92**(4), 445–452. 小样本生理实验；[DOI](https://doi.org/10.1136/hrt.2005.064600)，[PMC 全文](https://pmc.ncbi.nlm.nih.gov/articles/PMC1860846/)。
14. Witek, M. A. G., et al. (2014). _Syncopation, Body-Movement and Pleasure in Groove Music_. **PLOS ONE, 9**(4), e94446. 原始听觉实验。[DOI](https://doi.org/10.1371/journal.pone.0094446)
15. Edworthy, J., & Waring, H. (2006). _The effects of music tempo and loudness level on treadmill exercise_. **Ergonomics, 49**(15), 1597–1610. 原始实验论文。[DOI](https://doi.org/10.1080/00140130600899104)
16. Van Dyck, E., et al. (2015). _Spontaneous entrainment of running cadence to music tempo_. **Sports Medicine - Open, 1**, 15. 跑步步频与音乐速度研究。[DOI](https://doi.org/10.1186/s40798-015-0025-9)
