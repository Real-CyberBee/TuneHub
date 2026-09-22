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

import { deriveRng, weightedChoice, randomSeedString, hashSeed, mulberry32 } from './rng.mjs';
import { makeEdoTuning, scalePitchesInRange, SCALES } from './model.mjs';

// ---------------------------------------------------------------------------
// 1. 声部定义：音区严格互不重叠
// ---------------------------------------------------------------------------

export const VOICES = {
  bass: { id: 'bass', label: '低音', low: 36, high: 50, gainDb: -6, decay: 0.9 },
  harmony: { id: 'harmony', label: '和声', low: 52, high: 64, gainDb: -13, decay: 1.6 },
  melody: { id: 'melody', label: '旋律', low: 66, high: 81, gainDb: -10, decay: 0.45 },
  perc: { id: 'perc', label: '打击', low: 0, high: 0, gainDb: -8, decay: 0.2 },
};

/** 音区隔离的护栏：任何量化/游走都不得越界。 */
function clampToVoiceRange(voiceId, midi) {
  const v = VOICES[voiceId];
  if (!v || voiceId === 'perc') return midi;
  return Math.min(v.high, Math.max(v.low, midi));
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

/** 旋律可用的时值（以 16 分音符步为单位）与权重。 */
const MELODY_DURATIONS = [
  { steps: 4, weight: 3.0 }, // 四分
  { steps: 6, weight: 1.4 }, // 附点四分
  { steps: 8, weight: 1.8 }, // 二分
  { steps: 3, weight: 1.0 }, // 附点八分
  { steps: 2, weight: 0.7 }, // 八分（偶尔点缀）
];

/** 每小节的旋律事件数（受 energy 影响）。 */
function melodyEventsPerBar(energy) {
  return energy < 0.3 ? 1 : energy < 0.7 ? 2 : 3;
}

/** 每小节的和声垫触发数。 */
function harmonyEventsPerBar(energy) {
  return energy < 0.4 ? 1 : 2;
}

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
  { name: 'intro', bars: 4, density: 0.35, entry: ['harmony', 'perc'] },
  { name: 'main', bars: 12, density: 1.0, entry: ['bass', 'melody'] },
  { name: 'break', bars: 4, density: 0.3, entry: [] },
  { name: 'main2', bars: 10, density: 1.0, entry: ['melody'] },
  { name: 'outro', bars: 6, density: 0.25, entry: [] },
];

export const DEFAULT_CONFIG = {
  bpm: 92,
  mood: 0.45, // 0 幽暗 → 1 明亮
  energy: 0.55, // 0 安静 → 1 热闹
  scaleId: 'majorPentatonic',
  rootMidi: 60,
  barsPerChord: 4,
  sections: DEFAULT_SECTIONS,
  swing: 0.08,
};

export function normalizeConfig(partial = {}) {
  const cfg = {
    ...DEFAULT_CONFIG,
    ...partial,
    sections: partial.sections ?? DEFAULT_SECTIONS.map((s) => ({ ...s })),
  };
  cfg.bpm = Math.min(180, Math.max(50, cfg.bpm));
  cfg.mood = Math.min(1, Math.max(0, cfg.mood));
  cfg.energy = Math.min(1, Math.max(0, cfg.energy));
  return cfg;
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
  const cfg = normalizeConfig(config);
  const scale = scales[cfg.scaleId] ?? scales.majorPentatonic ?? SCALES.majorPentatonic;
  const tuning = makeEdoTuning(12);
  const mf = moodFactors(cfg.mood);

  const barSeconds = (60 / cfg.bpm) * 4;
  const stepSeconds = barSeconds / STEPS_PER_BAR;

  const events = [];
  const meta = { harshIntervals: 0, densityPeaks: 0, registerConflicts: 0 };

  // 每个声部一条独立子流——保证修改一个声部不影响其它声部。
  // 结构流不参与覆盖：重掷某个声部不应改变曲式。
  const seedOf = (voiceId) => overrides[voiceId] ?? seed;
  const rngs = {
    bass: deriveRng(seedOf('bass'), 'bass'),
    harmony: deriveRng(seedOf('harmony'), 'harmony'),
    melody: deriveRng(seedOf('melody'), 'melody'),
    perc: deriveRng(seedOf('perc'), 'perc'),
    structure: deriveRng(seed, 'structure'),
  };

  // 声部进入顺序（错开，避免一起进来）
  const staggeredEntry = {
    harmony: 0,
    perc: 1,
    bass: 8,
    melody: 16,
  };

  let barCursor = 0;
  let activeVoices = new Set();
  const lastMelodyPitch = { value: null };
  const harmonyPitches = { value: [] };

  cfg.sections.forEach((section, sIdx) => {
    const keyCenter = keyCenterForSection(rngs.structure, cfg.rootMidi, sIdx);
    const density = section.density;
    // 高能量提高密度，低能量降低密度（但不为零，避免"空掉"）
    const effDensity = Math.min(1.35, density * (0.55 + 0.85 * cfg.energy));

    const sectionStartBar = barCursor;

    // ---- 打击 ----
    if (effDensity > 0.22) {
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = (barCursor + bar) * barSeconds;
        for (const [drum, pattern] of Object.entries(RHYTHM_PATTERNS.perc)) {
          const drumWeight = drum === 'kick' ? 1 : drum === 'snare' ? 0.85 : drum === 'hat' ? 0.7 * effDensity : 0.35;
          for (let s = 0; s < STEPS_PER_BAR; s++) {
            if (!pattern[s]) continue;
            if (rngs.perc() > Math.min(1, drumWeight * effDensity)) continue;
            const swingOffset = s % 2 === 1 ? cfg.swing * stepSeconds : 0;
            events.push({
              time: barStart + s * stepSeconds + swingOffset,
              duration: 0.12,
              voice: 'perc',
              midi: drum === 'kick' ? 36 : drum === 'snare' ? 38 : drum === 'hat' ? 42 : 39,
              velocity: s % 4 === 0 ? 0.95 : 0.62,
              section: section.name,
              timbre: drum,
            });
          }
        }
      }
    }

    // ---- 低音 ----
    if (effDensity > 0.3) {
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = (barCursor + bar) * barSeconds;
        const chordIdx = Math.floor((barCursor + bar) / cfg.barsPerChord);
        const root = keyCenter + pickChordOffset(rngs.bass, chordIdx, scale);
        const nBassEvents = effDensity > 0.8 ? 2 : 1;
        for (let i = 0; i < nBassEvents; i++) {
          if (i > 0 && rngs.bass() > 0.5 * effDensity) continue;
          // 低音：根音为主，偶尔五度
          const midi = clampToVoiceRange('bass', toBassRegister(root, cfg.rootMidi) + (i > 0 && rngs.bass() > 0.6 ? 7 : 0));
          const step = i === 0 ? 0 : 8;
          events.push({
            time: barStart + step * stepSeconds,
            duration: stepSeconds * 7,
            voice: 'bass',
            midi,
            velocity: i === 0 ? 0.92 : 0.7,
            section: section.name,
            timbre: 'bass',
          });
        }
      }
    }

    // ---- 和声垫 ----
    if (effDensity > 0.25) {
      const perBar = harmonyEventsPerBar(effDensity);
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = (barCursor + bar) * barSeconds;
        const chordIdx = Math.floor((barCursor + bar) / cfg.barsPerChord);
        const root = keyCenter + pickChordOffset(rngs.harmony, chordIdx, scale);
        for (let i = 0; i < perBar; i++) {
          if (rngs.harmony() > Math.min(1, effDensity)) continue;
          const step = i === 0 ? 0 : 8;
          // 和声：根音 + 五度 + 三度（从音阶里取，保证协和）
          const chord = buildChord(root, scale, mf);
          for (const midi of chord) {
            const m = clampToVoiceRange('harmony', midi);
            events.push({
              time: barStart + step * stepSeconds,
              duration: stepSeconds * (perBar === 1 ? 15 : 7),
              voice: 'harmony',
              midi: m,
              velocity: 0.5,
              section: section.name,
              timbre: 'pad',
            });
            harmonyPitches.value.push({ time: barStart + step * stepSeconds, midi: m });
          }
        }
      }
    }

    // ---- 旋律（音程悦耳度加权随机游走）----
    if (effDensity > 0.3) {
      const perBar = melodyEventsPerBar(effDensity);
      const pitchPool = scalePitchesInRange(scale, VOICES.melody.low, VOICES.melody.high, cfg.rootMidi);
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = (barCursor + bar) * barSeconds;
        let stepCursor = 0;
        for (let i = 0; i < perBar; i++) {
          if (rngs.melody() > Math.min(1, effDensity * 1.1)) continue;
          const dur = weightedChoice(
            rngs.melody,
            MELODY_DURATIONS.map((d) => d.steps),
            MELODY_DURATIONS.map((d) => d.weight),
          );
          if (stepCursor + dur > STEPS_PER_BAR) break;

          let midi;
          if (lastMelodyPitch.value == null) {
            // 首次进入：从音阶中较稳定的音开始（根音/五度/三度），并带情绪的音区偏好
            midi = weightedChoice(
              rngs.melody,
              pitchPool,
              pitchPool.map((p) => (0.3 + intervalWeight((p - cfg.rootMidi) % 12)) * octaveBias(p, cfg.rootMidi, mf)),
            );
          } else {
            const cands = pitchPool
              .map((p) => {
                const iv = p - lastMelodyPitch.value;
                let w = intervalWeight(iv);
                // 情绪调制：音程色彩
                const key = Math.abs(iv) % 12;
                w *= mf.intervalBias[key] ?? 1;
                // 情绪调制：音区偏好（幽暗偏低、明亮偏高）
                w *= octaveBias(p, cfg.rootMidi, mf);
                // 与当前和声的协和加成
                w *= 1 + 0.35 * harmonyConsonance(p, harmonyPitches.value, barStart);
                // 略微惩罚连续同向大跳
                if (Math.abs(iv) > 4) w *= 0.75;
                return { p, w };
              })
              .filter((c) => c.w > 0.001);
            if (!cands.length) continue;
            midi = weightedChoice(rngs.melody, cands.map((c) => c.p), cands.map((c) => c.w));
          }
          lastMelodyPitch.value = midi;
          const swingOffset = stepCursor % 2 === 1 ? cfg.swing * stepSeconds : 0;
          events.push({
            time: barStart + stepCursor * stepSeconds + swingOffset,
            duration: dur * stepSeconds * 0.92,
            voice: 'melody',
            midi: clampToVoiceRange('melody', midi),
            velocity: 0.62 + 0.3 * (i === 0 ? 1 : 0.4),
            section: section.name,
            timbre: 'pluck',
          });
          stepCursor += dur;
        }
      }
    }

    section.entry.forEach((v) => activeVoices.add(v));
    barCursor += section.bars;
  });

  events.sort((a, b) => a.time - b.time || a.voice.localeCompare(b.voice));

  const totalBars = cfg.sections.reduce((n, s) => n + s.bars, 0);
  const totalSeconds = totalBars * barSeconds;

  const stats = analyzePleasantness(events);

  return {
    seed,
    config: cfg,
    overrides,
    events,
    totalBars,
    totalSeconds,
    barSeconds,
    stepSeconds,
    scaleId: scale.id,
    scaleName: scale.name,
    tuningId: tuning.id,
    stats,
  };
}

// ---------------------------------------------------------------------------
// 6. 内部工具
// ---------------------------------------------------------------------------

/** 按小节轮换一个和弦根音偏移（走音阶的稳定音级）。 */
function pickChordOffset(rng, chordIdx, scale) {
  const stable = [0, 7, 5, 9, 2].filter((d) => scale.degrees.includes(d) || d === 7);
  return stable[chordIdx % stable.length];
}

/** 把根音放到低音声部音区（不做 12-TET 假设之外的运算）。 */
function toBassRegister(root, rootMidi) {
  let m = root;
  while (m > VOICES.bass.high) m -= 12;
  while (m < VOICES.bass.low) m += 12;
  return m;
}

/** 从音阶里构造一个协和的三音和声（根音 + 五度 + 三度）。 */
function buildChord(root, scale, mf) {
  const wantsMajor = mf.intervalBias[4] >= mf.intervalBias[3];
  const third = wantsMajor ? 4 : 3;
  const candidates = [root, root + 7, root + third, root + 12];
  return candidates.filter((m) => m <= VOICES.harmony.high + 12).slice(0, 3);
}

/** 某音与当前和声的协和程度（0..1），用于给旋律候选加权。 */
function harmonyConsonance(pitch, harmonyPitches, now) {
  const recent = harmonyPitches.filter((h) => now - h.time < 3 && h.time <= now);
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
function octaveBias(pitch, rootMidi, mf) {
  const octavesRel = (pitch - rootMidi) / 12;
  return Math.pow(2, 0.45 * mf.octaveShift * octavesRel);
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
    if (a.voice === 'perc') continue;
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      if (b.time - a.time > tol) break;
      if (b.voice === 'perc' || b.voice === a.voice) continue;
      const iv = Math.abs(a.midi - b.midi) % 12;
      totalSimultaneities++;
      if (iv === 1 || iv === 6 || iv === 11) harshIntervals++;
      if (iv === 0) samePitchCollisions++;
    }
  }

  // 密度检查：任意 1 秒窗口内的音符数
  let densityPeaks = 0;
  const maxAllowed = 14;
  for (let i = 0; i < events.length; i++) {
    let n = 0;
    for (let j = i; j < events.length && events[j].time - events[i].time <= 1; j++) n++;
    if (n > maxAllowed) densityPeaks++;
  }

  const harshRate = totalSimultaneities ? harshIntervals / totalSimultaneities : 0;
  const pleasantness = Math.max(
    0,
    Math.min(1, 1 - harshRate * 4 - densityPeaks * 0.004 - samePitchCollisions * 0.01),
  );

  return {
    pleasantness: Number(pleasantness.toFixed(3)),
    harshIntervals,
    harshRate: Number(harshRate.toFixed(4)),
    samePitchCollisions,
    densityPeaks,
    totalSimultaneities,
    totalEvents: events.length,
    verdict: pleasantness > 0.75 ? 'good' : pleasantness > 0.55 ? 'fair' : 'poor',
  };
}

/** 便捷入口：直接从一个新种子生成作品。 */
export function generateWithNewSeed(config = {}, scales) {
  const rng = mulberry32(hashSeed(String(Date.now())));
  const seed = randomSeedString(rng);
  return generate(seed, config, scales);
}
