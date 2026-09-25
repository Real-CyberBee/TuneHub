// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 生成器：在"好听的子空间"里随机。
 *
 * 核心原则（见 docs/OVERVIEW.md §3 与 ROADMAP M1）：
 * 不是"生成声音然后检查是否好听"，而是**从一开始就不进入难听区域**。
 *
 * 四个手段：
 *   1. 音程悦耳度加权采样（避免小二度/三全音碰撞）
 *   2. 声部音区严格隔离（低音 < 和声 < 旋律，互不重叠）
 *   3. 每声部独立随机子流（改一个声部不会污染其它声部）
 *   4. 密度包络 + 声部逐层进退场（提供方向感）
 */

import {
  deriveRng,
  weightedChoice,
  randomSeedString,
  hashSeed,
  mulberry32,
} from "./rng.mjs";
import { makeEdoTuning, scalePitchesInRange, SCALES } from "./model.mjs";

// ---------------------------------------------------------------------------
// 1. 声部定义：音区严格互不重叠
// ---------------------------------------------------------------------------

export const VOICES = {
  bass: {
    id: "bass",
    label: "低音",
    low: 36,
    high: 50,
    gainDb: -6,
    decay: 0.9,
  },
  harmony: {
    id: "harmony",
    label: "和声",
    low: 52,
    high: 64,
    gainDb: -13,
    decay: 1.6,
  },
  melody: {
    id: "melody",
    label: "旋律",
    low: 66,
    high: 81,
    gainDb: -10,
    decay: 0.45,
  },
  perc: { id: "perc", label: "打击", low: 0, high: 0, gainDb: -8, decay: 0.2 },
};

/** 音区隔离的护栏：任何量化/游走都不得越界。 */
function clampToVoiceRange(voiceId, midi) {
  const voiceDefinition = VOICES[voiceId];
  if (!voiceDefinition || voiceId === "perc") return midi;
  return Math.min(voiceDefinition.high, Math.max(voiceDefinition.low, midi));
}

// ---------------------------------------------------------------------------
// 2. 音程悦耳度模型
// ---------------------------------------------------------------------------

/**
 * 音程（半音数）的悦耳度权重。
 * 完全协和(纯八/纯五/纯四)与协和(大小三/六度)高；小二度与大七度接近禁止。
 * 这是"难听音符"最主要的来源，所以权重差距必须拉开。
 */
const INTERVAL_WEIGHT = {
  0: 0.0, // 同度：交给专门逻辑处理（避免声部合并）
  1: 0.02, // 小二度  ← 接近禁止
  2: 0.55, // 大二度
  3: 1.0, // 小三度
  4: 0.9, // 大三度
  5: 1.0, // 纯四度
  6: 0.05, // 三全音 ← 接近禁止
  7: 1.2, // 纯五度  ← 最优先
  8: 0.5, // 小六度
  9: 0.85, // 大六度
  10: 0.6, // 小七度
  11: 0.05, // 大七度 ← 接近禁止
  12: 0.8, // 八度
};

export function intervalWeight(semitones) {
  const a = Math.abs(semitones);
  if (a > 12) return 0.4; // 超过八度，用较保守的默认值
  return INTERVAL_WEIGHT[a] ?? 0.3;
}

/** 情绪参数（0 幽暗 → 1 明亮）对音阶与音程的调制。 */
export function moodFactors(mood) {
  return {
    // 明亮时更偏好大六度/大七度，幽暗时更偏好小音程
    intervalBias: {
      3: 1.3 - 0.5 * mood,
      4: 0.7 + 0.6 * mood,
      8: 0.6 + 0.4 * mood,
      9: 0.6 + 0.6 * mood,
      10: 0.8 + 0.4 * mood,
      11: 0.5 + 2.5 * mood,
    },
    // 明亮时音区整体略高
    octaveShift: Math.round((mood - 0.5) * 1.2),
  };
}

// ---------------------------------------------------------------------------
// 3. 节奏：按 16 分音符栅格定义的分层步进模式
// ---------------------------------------------------------------------------

const STEPS_PER_BAR = 16;

const RHYTHM_PATTERNS = {
  perc: {
    kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  },
};

const PERCUSSION_MIDI = {
  kick: 36,
  snare: 38,
  hat: 42,
  clap: 39,
  brush: 38,
  shaker: 70,
  rim: 37,
};

/** 旋律可用的时值（以 16 分音符步为单位）与权重。 */
const MELODY_DURATIONS = [
  { steps: 4, weight: 3.0 }, // 四分
  { steps: 6, weight: 1.4 }, // 附点四分
  { steps: 8, weight: 1.8 }, // 二分
  { steps: 3, weight: 1.0 }, // 附点八分
  { steps: 2, weight: 0.7 }, // 八分（偶尔点缀）
];

/** 每小节的旋律事件数（受 energy 影响）。 */
function defaultMelodyEventsPerBar(energy) {
  return energy < 0.3 ? 1 : energy < 0.7 ? 2 : 3;
}

/** 每小节的和声垫触发数。 */
function defaultHarmonyEventsPerBar(energy) {
  return energy < 0.4 ? 1 : 2;
}

/**
 * 通用编配的兜底值。内容包可以用 `arrangement` 覆盖它，但内核并不认识
 * “阅读”或“派对”这些产品概念；它只执行一份声明式的编配方案。
 *
 * 这就是内容层与生成层的 seam：新增场景主要是添加数据，而非向内核堆分支。
 */
export const DEFAULT_ARRANGEMENT = {
  id: "balanced",
  bass: {
    timbre: "bass",
    steps: [0, 8],
    secondNoteChance: 0.5,
    fifthChance: 0.4,
    durationSteps: 7,
  },
  harmony: {
    timbre: "pad",
    steps: [0, 8],
    eventsPerBar: null,
    velocity: 0.5,
    durationSteps: null,
  },
  melody: {
    timbre: "melody",
    startSteps: [0, 6, 10],
    eventsPerBar: null,
    durations: MELODY_DURATIONS,
    probability: 1.1,
    maxLeap: 12,
    largeLeapPenalty: 0.75,
    direction: "free",
  },
  percussion: {
    patterns: RHYTHM_PATTERNS.perc,
    probability: 1,
    accentVelocity: 0.95,
    normalVelocity: 0.62,
  },
  mix: {
    reverbAmount: 0.34,
    reverbSeconds: 2.4,
    reverbDecay: 3,
    reverbBrightness: 0.32,
    volume: 0.85,
  },
};

// ---------------------------------------------------------------------------
// 4. 调性中心（和声锚点）
// ---------------------------------------------------------------------------

/**
 * 调性中心随段落缓慢移动：这是"方向感"的来源之一。
 * 用五度圈步进，保证转调听起来自然。
 */
function keyCenterForSection(rng, base, step) {
  const fifthsWalk = [0, 0, 7, 7, 5, 2, 0, -3, 0, 5];
  return base + fifthsWalk[(step * 3) % fifthsWalk.length];
}

// ---------------------------------------------------------------------------
// 5. 主生成函数
// ---------------------------------------------------------------------------

const DEFAULT_SECTIONS = [
  { name: "intro", bars: 4, density: 0.35, entry: ["harmony", "perc"] },
  { name: "main", bars: 12, density: 1.0, entry: ["bass", "melody"] },
  { name: "break", bars: 4, density: 0.3, entry: [] },
  { name: "main2", bars: 10, density: 1.0, entry: ["melody"] },
  { name: "outro", bars: 6, density: 0.25, entry: [] },
];

export const DEFAULT_CONFIG = {
  bpm: 92,
  mood: 0.45, // 0 幽暗 → 1 明亮
  energy: 0.55, // 0 安静 → 1 热闹
  scaleId: "majorPentatonic",
  rootMidi: 60,
  barsPerChord: 4,
  sections: DEFAULT_SECTIONS,
  swing: 0.08,
};

export function normalizeConfig(partial = {}) {
  const normalizedConfig = {
    ...DEFAULT_CONFIG,
    ...partial,
    sections: partial.sections ?? DEFAULT_SECTIONS.map((s) => ({ ...s })),
  };
  normalizedConfig.bpm = Math.min(180, Math.max(50, normalizedConfig.bpm));
  normalizedConfig.mood = Math.min(1, Math.max(0, normalizedConfig.mood));
  normalizedConfig.energy = Math.min(1, Math.max(0, normalizedConfig.energy));
  return normalizedConfig;
}

/**
 * 只合并编配的第一层子域，避免一个场景为了改旋律而意外丢掉默认的混音或打击设置。
 * 生成时只读返回值，因而 content-pack 中的策展数据永远不会被运行时污染。
 */
function resolveArrangement(arrangement = {}) {
  return {
    ...DEFAULT_ARRANGEMENT,
    ...arrangement,
    bass: { ...DEFAULT_ARRANGEMENT.bass, ...arrangement.bass },
    harmony: { ...DEFAULT_ARRANGEMENT.harmony, ...arrangement.harmony },
    melody: { ...DEFAULT_ARRANGEMENT.melody, ...arrangement.melody },
    percussion: {
      ...DEFAULT_ARRANGEMENT.percussion,
      ...arrangement.percussion,
    },
    mix: { ...DEFAULT_ARRANGEMENT.mix, ...arrangement.mix },
  };
}

/**
 * 生成一个作品的事件流。
 *
 * @param {string} seed  分享码里的短种子
 * @param {Object} config
 * @param {Object} scales 音阶表（允许外部注入，便于扩展）
 * @param {Object} overrides 每声部种子覆盖 {"melody":"x8k2"}。
 *   这是"锁定 + 重掷"的实现基础：只替换目标声部的种子，
 *   其余声部与结构完全不动——保证局部修改只影响局部。
 * @returns {{seed:string, config:Object, events:Array, totalBars:number, meta:Object}}
 */
export function generate(seed, config = {}, scales = SCALES, overrides = {}) {
  const normalizedConfig = normalizeConfig(config);
  const arrangement = resolveArrangement(normalizedConfig.arrangement);
  const scale =
    scales[normalizedConfig.scaleId] ??
    scales.majorPentatonic ??
    SCALES.majorPentatonic;
  const tuning = makeEdoTuning(12);
  const moodProfile = moodFactors(normalizedConfig.mood);

  const barSeconds = (60 / normalizedConfig.bpm) * 4;
  const stepSeconds = barSeconds / STEPS_PER_BAR;

  const events = [];

  // 每个声部一条独立子流——保证修改一个声部不影响其它声部。
  // 结构流不参与覆盖：重掷某个声部不应改变曲式。
  const seedOf = (voiceId) => overrides[voiceId] ?? seed;
  const randomStreamByVoice = {
    bass: deriveRng(seedOf("bass"), "bass"),
    harmony: deriveRng(seedOf("harmony"), "harmony"),
    melody: deriveRng(seedOf("melody"), "melody"),
    perc: deriveRng(seedOf("perc"), "perc"),
    structure: deriveRng(seed, "structure"),
  };

  let barCursor = 0;
  let previousMelodyPitch = null;
  const recentHarmonyPitches = [];

  normalizedConfig.sections.forEach((section, sectionIndex) => {
    const sectionEventStartIndex = events.length;
    const sectionStartSeconds = barCursor * barSeconds;
    const keyCenter = keyCenterForSection(
      randomStreamByVoice.structure,
      normalizedConfig.rootMidi,
      sectionIndex,
    );
    // 高能量提高密度，低能量降低密度（但不为零，避免"空掉"）
    const effectiveDensity = Math.min(
      1.35,
      section.density * (0.55 + 0.85 * normalizedConfig.energy),
    );

    // ---- 打击 ----
    if (effectiveDensity > 0.22) {
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = (barCursor + bar) * barSeconds;
        for (const [percussionTimbre, rhythmPattern] of Object.entries(
          arrangement.percussion.patterns,
        )) {
          const percussionWeight = percussionWeightFor(
            percussionTimbre,
            effectiveDensity,
            arrangement.percussion.probability,
          );
          for (let stepIndex = 0; stepIndex < STEPS_PER_BAR; stepIndex++) {
            if (!rhythmPattern[stepIndex]) continue;
            if (randomStreamByVoice.perc() > percussionWeight) continue;
            const swingOffset =
              stepIndex % 2 === 1 ? normalizedConfig.swing * stepSeconds : 0;
            events.push({
              time: barStart + stepIndex * stepSeconds + swingOffset,
              duration: 0.12,
              voice: "perc",
              midi: PERCUSSION_MIDI[percussionTimbre] ?? 36,
              velocity:
                stepIndex % 4 === 0
                  ? arrangement.percussion.accentVelocity
                  : arrangement.percussion.normalVelocity,
              section: section.name,
              timbre: percussionTimbre,
            });
          }
        }
      }
    }

    // ---- 低音 ----
    if (effectiveDensity > 0.3) {
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = (barCursor + bar) * barSeconds;
        const chordIdx = Math.floor(
          (barCursor + bar) / normalizedConfig.barsPerChord,
        );
        const root =
          keyCenter +
          pickChordOffset(randomStreamByVoice.bass, chordIdx, scale);
        const bassSteps = arrangement.bass.steps;
        for (let bassIndex = 0; bassIndex < bassSteps.length; bassIndex++) {
          if (
            bassIndex > 0 &&
            randomStreamByVoice.bass() >
              arrangement.bass.secondNoteChance * effectiveDensity
          )
            continue;
          // 低音：根音为主，偶尔五度
          const midi = clampToVoiceRange(
            "bass",
            toBassRegister(root, normalizedConfig.rootMidi) +
              (bassIndex > 0 &&
              randomStreamByVoice.bass() > 1 - arrangement.bass.fifthChance
                ? 7
                : 0),
          );
          const step = bassSteps[bassIndex];
          events.push({
            time: barStart + step * stepSeconds,
            duration:
              stepSeconds *
              Math.min(arrangement.bass.durationSteps, STEPS_PER_BAR - step),
            voice: "bass",
            midi,
            velocity: bassIndex === 0 ? 0.92 : 0.7,
            section: section.name,
            timbre: arrangement.bass.timbre,
          });
        }
      }
    }

    // ---- 和声垫 ----
    if (effectiveDensity > 0.25) {
      const harmonyEventsPerBar =
        arrangement.harmony.eventsPerBar ??
        defaultHarmonyEventsPerBar(effectiveDensity);
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = (barCursor + bar) * barSeconds;
        const chordIdx = Math.floor(
          (barCursor + bar) / normalizedConfig.barsPerChord,
        );
        const root =
          keyCenter +
          pickChordOffset(randomStreamByVoice.harmony, chordIdx, scale);
        for (
          let harmonyIndex = 0;
          harmonyIndex < harmonyEventsPerBar;
          harmonyIndex++
        ) {
          if (randomStreamByVoice.harmony() > Math.min(1, effectiveDensity))
            continue;
          const step =
            arrangement.harmony.steps[
              harmonyIndex % arrangement.harmony.steps.length
            ];
          // 和声：根音 + 五度 + 三度（从音阶里取，保证协和）
          const chord = buildChord(root, scale, moodProfile);
          for (const midi of chord) {
            const harmonyMidi = clampToVoiceRange("harmony", midi);
            events.push({
              time: barStart + step * stepSeconds,
              duration:
                stepSeconds *
                (arrangement.harmony.durationSteps ??
                  (harmonyEventsPerBar === 1 ? 15 : 7)),
              voice: "harmony",
              midi: harmonyMidi,
              velocity: arrangement.harmony.velocity,
              section: section.name,
              timbre: arrangement.harmony.timbre,
            });
            recentHarmonyPitches.push({
              time: barStart + step * stepSeconds,
              midi: harmonyMidi,
            });
          }
        }
      }
    }

    // ---- 旋律（音程悦耳度加权随机游走）----
    if (effectiveDensity > 0.3) {
      const melodyEventsPerBar =
        arrangement.melody.eventsPerBar ??
        defaultMelodyEventsPerBar(effectiveDensity);
      const melodyLow = arrangement.melody.lowMidi ?? VOICES.melody.low;
      const melodyHigh = arrangement.melody.highMidi ?? VOICES.melody.high;
      const pitchPool = scalePitchesInRange(
        scale,
        melodyLow,
        melodyHigh,
        normalizedConfig.rootMidi,
      );
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = (barCursor + bar) * barSeconds;
        for (
          let melodyIndex = 0;
          melodyIndex < melodyEventsPerBar;
          melodyIndex++
        ) {
          if (
            randomStreamByVoice.melody() >
            Math.min(1, effectiveDensity * arrangement.melody.probability)
          )
            continue;
          const step =
            arrangement.melody.startSteps[
              melodyIndex % arrangement.melody.startSteps.length
            ];
          const durationSteps = weightedChoice(
            randomStreamByVoice.melody,
            arrangement.melody.durations.map((duration) => duration.steps),
            arrangement.melody.durations.map((duration) => duration.weight),
          );
          if (step + durationSteps > STEPS_PER_BAR) continue;

          let midi;
          if (previousMelodyPitch == null) {
            // 首次进入：从音阶中较稳定的音开始（根音/五度/三度），并带情绪的音区偏好
            midi = weightedChoice(
              randomStreamByVoice.melody,
              pitchPool,
              pitchPool.map(
                (p) =>
                  (0.3 + intervalWeight((p - normalizedConfig.rootMidi) % 12)) *
                  octaveBias(p, normalizedConfig.rootMidi, moodProfile),
              ),
            );
          } else {
            const candidates = pitchPool
              .map((p) => {
                const intervalFromPrevious = p - previousMelodyPitch;
                let weight = intervalWeight(intervalFromPrevious);
                // 情绪调制：音程色彩
                const pitchClassInterval = Math.abs(intervalFromPrevious) % 12;
                weight *= moodProfile.intervalBias[pitchClassInterval] ?? 1;
                // 情绪调制：音区偏好（幽暗偏低、明亮偏高）
                weight *= octaveBias(p, normalizedConfig.rootMidi, moodProfile);
                // 与当前和声的协和加成
                weight *=
                  1 +
                  0.35 * harmonyConsonance(p, recentHarmonyPitches, barStart);
                // 场景可声明旋律的跳进容忍度；仍是软约束，保留旋律的呼吸感。
                if (Math.abs(intervalFromPrevious) > arrangement.melody.maxLeap)
                  weight *= 0.05;
                else if (Math.abs(intervalFromPrevious) > 4)
                  weight *= arrangement.melody.largeLeapPenalty;
                if (
                  arrangement.melody.direction === "ascending" &&
                  intervalFromPrevious > 0
                )
                  weight *= 1.35;
                if (
                  arrangement.melody.direction === "descending" &&
                  intervalFromPrevious < 0
                )
                  weight *= 1.35;
                return { pitch: p, weight };
              })
              .filter((candidate) => candidate.weight > 0.001);
            if (!candidates.length) continue;
            midi = weightedChoice(
              randomStreamByVoice.melody,
              candidates.map((candidate) => candidate.pitch),
              candidates.map((candidate) => candidate.weight),
            );
          }
          previousMelodyPitch = midi;
          const swingOffset =
            step % 2 === 1 ? normalizedConfig.swing * stepSeconds : 0;
          events.push({
            time: barStart + step * stepSeconds + swingOffset,
            duration: durationSteps * stepSeconds * 0.92,
            voice: "melody",
            midi: Math.min(melodyHigh, Math.max(melodyLow, midi)),
            velocity: 0.62 + 0.3 * (melodyIndex === 0 ? 1 : 0.4),
            section: section.name,
            timbre: Array.isArray(arrangement.melody.timbres)
              ? weightedChoice(
                  randomStreamByVoice.melody,
                  arrangement.melody.timbres.map((item) => item.timbre),
                  arrangement.melody.timbres.map((item) => item.weight),
                )
              : arrangement.melody.timbre,
          });
        }
      }
    }

    /**
     * `continuousBed` 用于没有“呼吸/停顿”概念的场景：每段第 0 拍立即入声，
     * 尾部跨过段落边界，给下一段的底床攻击时间做交叉淡化。
     * `minimumEvents` 是更弱的兜底约束，仍可供未来场景在随机抽空时使用。
     */
    const mustInsertContinuityBed = section.continuousBed;
    const needsFallbackBed =
      section.minimumEvents &&
      events.length - sectionEventStartIndex < section.minimumEvents;
    if (mustInsertContinuityBed || needsFallbackBed) {
      const continuityMidi = clampToVoiceRange(
        "harmony",
        buildChord(keyCenter, scale, moodProfile)[0],
      );
      events.push({
        time: sectionStartSeconds,
        duration:
          section.bars * barSeconds +
          (mustInsertContinuityBed ? barSeconds / 2 : 0),
        voice: "harmony",
        midi: continuityMidi,
        velocity:
          section.continuityVelocity ?? arrangement.harmony.velocity * 0.45,
        section: section.name,
        timbre: mustInsertContinuityBed
          ? "continuityPad"
          : arrangement.harmony.timbre,
      });
      recentHarmonyPitches.push({
        time: sectionStartSeconds,
        midi: continuityMidi,
      });
    }

    barCursor += section.bars;
  });

  events.sort((a, b) => a.time - b.time || a.voice.localeCompare(b.voice));

  const totalBars = normalizedConfig.sections.reduce(
    (barTotal, section) => barTotal + section.bars,
    0,
  );
  const totalSeconds = totalBars * barSeconds;

  const stats = analyzePleasantness(events);

  return {
    seed,
    config: normalizedConfig,
    overrides,
    events,
    totalBars,
    totalSeconds,
    barSeconds,
    stepSeconds,
    scaleId: scale.id,
    scaleName: scale.name,
    tuningId: tuning.id,
    mix: arrangement.mix,
    arrangementId: arrangement.id,
    stats,
  };
}

// ---------------------------------------------------------------------------
// 6. 内部工具
// ---------------------------------------------------------------------------

/**
 * 用明确的鼓件角色计算命中概率。内容包提供节奏格子，内核仍保有密度护栏，
 * 这样低能量参数不会把场景错误地渲染成满格节拍。
 */
function percussionWeightFor(timbre, effectiveDensity, profileProbability) {
  const roleWeight =
    timbre === "kick"
      ? 1
      : timbre === "snare"
        ? 0.85
        : ["hat", "shaker"].includes(timbre)
          ? 0.7 * effectiveDensity
          : 0.45;
  return Math.min(1, roleWeight * effectiveDensity * profileProbability);
}

/** 按小节轮换一个和弦根音偏移（走音阶的稳定音级）。 */
function pickChordOffset(rng, chordIdx, scale) {
  const stable = [0, 7, 5, 9, 2].filter(
    (d) => scale.degrees.includes(d) || d === 7,
  );
  return stable[chordIdx % stable.length];
}

/** 把根音放到低音声部音区（不做 12-TET 假设之外的运算）。 */
function toBassRegister(root, rootMidi) {
  let bassMidi = root;
  while (bassMidi > VOICES.bass.high) bassMidi -= 12;
  while (bassMidi < VOICES.bass.low) bassMidi += 12;
  return bassMidi;
}

/**
 * 从当前音阶里构造协和三音和声。
 *
 * 旧实现把固定大/小三度直接塞进任何音阶；多利亚、全音、五声音阶等场景会
 * 让和声与旋律池不属于同一集合，长时间背景播放时尤其容易积累刺耳碰撞。
 * 这里仍偏好三度/五度，但只选音阶中实际存在、悦耳度更高的音级。
 */
function buildChord(root, scale, moodProfile) {
  const wantsMajor = moodProfile.intervalBias[4] >= moodProfile.intervalBias[3];
  const pickDegree = (target, excluded = []) =>
    scale.degrees
      .filter((degree) => degree !== 0 && !excluded.includes(degree))
      .map((degree) => ({
        degree,
        // 距目标近是色彩偏好；音程权重则是不可跨越的听感护栏。
        score: intervalWeight(degree) / (1 + Math.abs(degree - target)),
      }))
      .sort((a, b) => b.score - a.score || a.degree - b.degree)[0]?.degree;

  const third = pickDegree(wantsMajor ? 4 : 3) ?? 3;
  const fifth = pickDegree(7, [third]) ?? 7;
  return [root, root + fifth, root + third].filter(
    (chordMidi) => chordMidi <= VOICES.harmony.high + 12,
  );
}

/** 某音与当前和声的协和程度（0..1），用于给旋律候选加权。 */
function harmonyConsonance(pitch, harmonyPitches, now) {
  const recent = harmonyPitches.filter(
    (h) => now - h.time < 3 && h.time <= now,
  );
  if (!recent.length) return 0;
  let best = 0;
  for (const h of recent) {
    best = Math.max(best, intervalWeight(pitch - h.midi));
  }
  return best;
}

/**
 * 情绪的音区偏好：幽暗（mood<0.5）倾向低音区，明亮倾向高音区。
 * 指数形式保证是温和偏好而非硬约束——否则会失去"随机"的价值。
 */
function octaveBias(pitch, rootMidi, moodProfile) {
  const octavesRel = (pitch - rootMidi) / 12;
  return Math.pow(2, 0.45 * moodProfile.octaveShift * octavesRel);
}

/**
 * 听感分析：AI 层的 evaluate_piece 直接复用这个函数。
 * 见 docs/ROADMAP.md M1 与 M2.5。
 */
export function analyzePleasantness(events) {
  let harshIntervals = 0;
  let samePitchCollisions = 0;
  let totalSimultaneities = 0;

  // 按时间窗分组，检查同时发声的音是否冲突
  const tol = 0.035;
  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    if (a.voice === "perc") continue;
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      if (b.time - a.time > tol) break;
      if (b.voice === "perc" || b.voice === a.voice) continue;
      const iv = Math.abs(a.midi - b.midi) % 12;
      totalSimultaneities++;
      if (iv === 1 || iv === 6 || iv === 11) harshIntervals++;
      // 八度是有意保留的配器关系，并不是“同音碰撞”；只惩罚真正相同的绝对音高。
      if (Math.abs(a.midi - b.midi) < 0.01) samePitchCollisions++;
    }
  }

  // 密度检查：任意 1 秒窗口内的“起音时刻”数。一个三和弦是一次听觉起音，
  // 不能因为被拆成三个 NoteEvent 就被误判为三倍密度。
  const onsetTimes = [];
  for (const event of events) {
    if (
      !onsetTimes.length ||
      event.time - onsetTimes[onsetTimes.length - 1] > tol
    )
      onsetTimes.push(event.time);
  }
  let densityPeaks = 0;
  const maxAllowed = 14;
  for (let onsetIndex = 0; onsetIndex < onsetTimes.length; onsetIndex++) {
    let onsetCount = 0;
    for (
      let laterOnsetIndex = onsetIndex;
      laterOnsetIndex < onsetTimes.length &&
      onsetTimes[laterOnsetIndex] - onsetTimes[onsetIndex] <= 1;
      laterOnsetIndex++
    )
      onsetCount++;
    if (onsetCount > maxAllowed) densityPeaks++;
  }

  const harshRate = totalSimultaneities
    ? harshIntervals / totalSimultaneities
    : 0;
  const pleasantness = Math.max(
    0,
    Math.min(
      1,
      1 - harshRate * 4 - densityPeaks * 0.004 - samePitchCollisions * 0.01,
    ),
  );

  return {
    pleasantness: Number(pleasantness.toFixed(3)),
    harshIntervals,
    harshRate: Number(harshRate.toFixed(4)),
    samePitchCollisions,
    densityPeaks,
    totalSimultaneities,
    totalEvents: events.length,
    verdict:
      pleasantness > 0.75 ? "good" : pleasantness > 0.55 ? "fair" : "poor",
  };
}

/** 便捷入口：直接从一个新种子生成作品。 */
export function generateWithNewSeed(config = {}, scales) {
  const rng = mulberry32(hashSeed(String(Date.now())));
  const seed = randomSeedString(rng);
  return generate(seed, config, scales);
}
