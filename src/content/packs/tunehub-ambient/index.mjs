// SPDX-License-Identifier: Apache-2.0
/** 首个受审核的内置 content-pack：@tunehub/ambient@1.0.0。 */

import { generate } from "../../../core/generate.mjs";
import {
  beat,
  edoPitch,
  makeMarkerEvent,
  makeNoteEvent,
  makeTempoMap,
  validateScore,
} from "../../../core/score.mjs";

const longForm = [
  { name: "进入", bars: 4, density: 0.32, entry: ["harmony", "perc"] },
  { name: "沉浸", bars: 12, density: 0.82, entry: ["bass", "melody"] },
  { name: "呼吸", bars: 4, density: 0.28, entry: [] },
  { name: "延展", bars: 12, density: 0.88, entry: ["melody"] },
  { name: "余韵", bars: 4, density: 0.26, entry: [] },
];

/**
 * 阅读与休息需要“持续存在但不抢注意力”，不是用完整静音制造呼吸。
 * `continuousBed` 是 Generator 的通用段落约束：每段从第 0 拍立即铺入极轻和声，
 * 并在下段开始后短暂尾随，避免随机低密度与慢起音让用户感知到断点。
 */
const continuousCalmForm = [
  {
    name: "进入",
    bars: 4,
    density: 0.42,
    entry: ["harmony"],
    continuousBed: true,
    continuityVelocity: 0.2,
  },
  {
    name: "沉浸",
    bars: 14,
    density: 0.82,
    entry: ["bass", "melody"],
    continuousBed: true,
    continuityVelocity: 0.18,
  },
  {
    name: "延展",
    bars: 12,
    density: 0.88,
    entry: ["melody"],
    continuousBed: true,
    continuityVelocity: 0.18,
  },
  {
    name: "余韵",
    bars: 6,
    density: 0.36,
    entry: ["harmony"],
    continuousBed: true,
    continuityVelocity: 0.14,
  },
];
const motionForm = [
  { name: "起步", bars: 4, density: 0.58, entry: ["perc", "bass"] },
  { name: "巡航", bars: 12, density: 1, entry: ["harmony", "melody"] },
  { name: "转场", bars: 4, density: 0.5, entry: [] },
  { name: "巡航", bars: 12, density: 1.05, entry: ["melody"] },
  { name: "收束", bars: 4, density: 0.45, entry: [] },
];

export const manifest = {
  id: "@tunehub/ambient",
  version: "1.0.0",
  coreCompatibility: ">=1.0.0 <2.0.0",
  license: "Apache-2.0",
  provenance: {
    kind: "editorial",
    statement: "TuneHub-curated ambient electronic music for everyday scenes; it does not claim to represent any musical tradition. / TuneHub 团队策展的日常场景氛围电子音乐；不宣称代表任何传统音乐。",
    limitations: ["场景与情绪映射属于产品策展。"],
  },
};

export const parts = [
  {
    id: "bass",
    name: "低音",
    capabilities: {
      lowMidi: 36,
      highMidi: 50,
      maxPolyphony: 1,
      continuousPitch: false,
      techniques: ["normal"],
    },
    render: { instrument: "subtractive-synth", timbre: "bass" },
  },
  {
    id: "harmony",
    name: "和声",
    capabilities: {
      lowMidi: 52,
      highMidi: 64,
      maxPolyphony: 3,
      continuousPitch: false,
      techniques: ["normal"],
    },
    render: { instrument: "subtractive-synth", timbre: "pad" },
  },
  {
    id: "melody",
    name: "旋律",
    capabilities: {
      lowMidi: 66,
      highMidi: 81,
      maxPolyphony: 1,
      continuousPitch: false,
      techniques: ["normal", "accent"],
    },
    render: { instrument: "subtractive-synth", timbre: "melody" },
  },
  {
    id: "perc",
    name: "打击",
    capabilities: {
      unpitched: true,
      maxPolyphony: 4,
      techniques: ["kick", "snare", "hat", "clap"],
    },
    render: { instrument: "noise-synth", timbre: "perc" },
  },
];

export const scales = {
  majorPentatonic: {
    id: "majorPentatonic",
    name: "大调五声",
    degrees: [0, 2, 4, 7, 9],
  },
  minorPentatonic: {
    id: "minorPentatonic",
    name: "小调五声",
    degrees: [0, 3, 5, 7, 10],
  },
  hirajoshi: {
    id: "hirajoshi",
    name: "平调子（日本）",
    degrees: [0, 2, 3, 7, 8],
  },
  insen: { id: "insen", name: "陰旋（日本）", degrees: [0, 1, 5, 7, 10] },
  gongShangJueZhiYu: {
    id: "gongShangJueZhiYu",
    name: "宫商角徵羽",
    degrees: [0, 2, 4, 7, 9],
  },
  dorian: { id: "dorian", name: "多利亚", degrees: [0, 2, 3, 5, 7, 9, 10] },
  aeolian: { id: "aeolian", name: "自然小调", degrees: [0, 2, 3, 5, 7, 8, 10] },
  mixolydian: {
    id: "mixolydian",
    name: "混合利底亚",
    degrees: [0, 2, 4, 5, 7, 9, 10],
  },
  lydianBright: {
    id: "lydianBright",
    name: "利底亚（明亮）",
    degrees: [0, 2, 4, 6, 7, 9, 11],
  },
  wholeTone: { id: "wholeTone", name: "全音阶", degrees: [0, 2, 4, 6, 8, 10] },
};

const STEADY_FOUR_ON_FLOOR = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const BACKBEAT = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
const OFFBEAT = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
const HOUSE_HAT = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0];
const LIGHT_SWING = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0];

// 下面每份编配都是内容数据，而不是散落在生成器里的 scene if/else。
// 乐器、节奏格、旋律可跳进幅度和空间感共同构成一个可试听的场景身份。
const READING_ARRANGEMENT = {
  id: "reading-felt-piano",
  bass: { timbre: "softBass", steps: [0], durationSteps: 14 },
  harmony: {
    timbre: "warmPad",
    steps: [0],
    eventsPerBar: 1,
    durationSteps: 15,
    velocity: 0.38,
  },
  melody: {
    timbre: "feltPiano",
    startSteps: [0],
    eventsPerBar: 1,
    durations: [
      { steps: 8, weight: 3 },
      { steps: 12, weight: 2 },
    ],
    maxLeap: 5,
    largeLeapPenalty: 0.38,
  },
  percussion: { patterns: {}, probability: 0 },
  mix: {
    reverbAmount: 0.26,
    reverbSeconds: 1.8,
    reverbDecay: 3.8,
    reverbBrightness: 0.18,
    volume: 0.76,
  },
};

const CHORES_ARRANGEMENT = {
  id: "chores-bouncy-marimba",
  bass: {
    timbre: "uprightBass",
    steps: [0, 8],
    secondNoteChance: 0.85,
    fifthChance: 0.25,
    durationSteps: 6,
  },
  harmony: {
    timbre: "electricPiano",
    steps: [0, 8],
    eventsPerBar: 2,
    durationSteps: 6,
    velocity: 0.42,
  },
  melody: {
    timbre: "marimba",
    startSteps: [0, 4, 8],
    eventsPerBar: 3,
    durations: [
      { steps: 2, weight: 2 },
      { steps: 4, weight: 3 },
      { steps: 6, weight: 1 },
    ],
    maxLeap: 7,
    direction: "ascending",
  },
  percussion: {
    patterns: { shaker: LIGHT_SWING, clap: BACKBEAT },
    probability: 0.92,
    accentVelocity: 0.62,
    normalVelocity: 0.42,
  },
  mix: {
    reverbAmount: 0.16,
    reverbSeconds: 1.1,
    reverbDecay: 2.2,
    reverbBrightness: 0.52,
    volume: 0.84,
  },
};

const DINING_ARRANGEMENT = {
  id: "dining-vibraphone",
  bass: { timbre: "uprightBass", steps: [0], durationSteps: 12 },
  harmony: {
    timbre: "warmPad",
    steps: [0],
    eventsPerBar: 1,
    durationSteps: 15,
    velocity: 0.42,
  },
  melody: {
    timbre: "vibraphone",
    startSteps: [0, 8],
    eventsPerBar: 2,
    durations: [
      { steps: 4, weight: 2 },
      { steps: 6, weight: 2 },
      { steps: 8, weight: 2 },
    ],
    maxLeap: 7,
    largeLeapPenalty: 0.5,
  },
  percussion: {
    patterns: { brush: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
    probability: 0.45,
    accentVelocity: 0.34,
    normalVelocity: 0.26,
  },
  mix: {
    reverbAmount: 0.3,
    reverbSeconds: 2,
    reverbDecay: 3,
    reverbBrightness: 0.3,
    volume: 0.76,
  },
};

const DRIVING_ARRANGEMENT = {
  id: "driving-pulse",
  bass: {
    timbre: "pulseBass",
    steps: [0, 4, 8, 12],
    secondNoteChance: 0.95,
    fifthChance: 0.18,
    durationSteps: 3,
  },
  harmony: {
    timbre: "roadPad",
    steps: [0, 8],
    eventsPerBar: 2,
    durationSteps: 7,
    velocity: 0.4,
  },
  melody: {
    timbre: "synthPluck",
    startSteps: [0, 4, 10],
    eventsPerBar: 3,
    durations: [
      { steps: 2, weight: 1 },
      { steps: 4, weight: 3 },
      { steps: 6, weight: 1 },
    ],
    maxLeap: 9,
    direction: "ascending",
  },
  percussion: {
    patterns: { kick: STEADY_FOUR_ON_FLOOR, hat: OFFBEAT, rim: BACKBEAT },
    probability: 0.88,
  },
  mix: {
    reverbAmount: 0.18,
    reverbSeconds: 1.4,
    reverbDecay: 2.1,
    reverbBrightness: 0.45,
    volume: 0.88,
  },
};

const RESTING_ARRANGEMENT = {
  id: "resting-glass-drone",
  bass: { timbre: "droneBass", steps: [0], durationSteps: 15 },
  harmony: {
    timbre: "glassPad",
    steps: [0],
    eventsPerBar: 1,
    durationSteps: 15,
    velocity: 0.3,
  },
  melody: {
    timbre: "softBell",
    startSteps: [0],
    eventsPerBar: 1,
    durations: [
      { steps: 12, weight: 2 },
      { steps: 16, weight: 2 },
    ],
    probability: 0.72,
    maxLeap: 4,
    largeLeapPenalty: 0.25,
    direction: "descending",
  },
  percussion: { patterns: {}, probability: 0 },
  mix: {
    reverbAmount: 0.48,
    reverbSeconds: 4.2,
    reverbDecay: 4.8,
    reverbBrightness: 0.14,
    volume: 0.68,
  },
};

const PARTY_ARRANGEMENT = {
  id: "party-club",
  bass: {
    timbre: "clubBass",
    steps: [0, 4, 8, 12],
    secondNoteChance: 1,
    fifthChance: 0.32,
    durationSteps: 3,
  },
  harmony: {
    timbre: "brightStab",
    steps: [0, 4, 8, 12],
    eventsPerBar: 4,
    durationSteps: 3,
    velocity: 0.45,
  },
  melody: {
    timbre: "synthLead",
    startSteps: [0, 3, 6],
    eventsPerBar: 3,
    durations: [
      { steps: 2, weight: 3 },
      { steps: 3, weight: 2 },
      { steps: 4, weight: 1 },
    ],
    maxLeap: 12,
    largeLeapPenalty: 0.9,
  },
  percussion: {
    patterns: {
      kick: STEADY_FOUR_ON_FLOOR,
      snare: BACKBEAT,
      hat: HOUSE_HAT,
      clap: BACKBEAT,
    },
    probability: 1,
  },
  mix: {
    reverbAmount: 0.16,
    reverbSeconds: 1.1,
    reverbDecay: 2,
    reverbBrightness: 0.62,
    volume: 0.92,
  },
};

const WORKOUT_ARRANGEMENT = {
  id: "workout-drive",
  bass: {
    timbre: "punchBass",
    steps: [0, 4, 8, 12],
    secondNoteChance: 1,
    fifthChance: 0.4,
    durationSteps: 3,
  },
  harmony: {
    timbre: "powerStab",
    steps: [0, 8],
    eventsPerBar: 2,
    durationSteps: 6,
    velocity: 0.48,
  },
  melody: {
    timbre: "synthLead",
    startSteps: [0, 4, 8],
    eventsPerBar: 3,
    durations: [
      { steps: 2, weight: 2 },
      { steps: 4, weight: 3 },
    ],
    maxLeap: 9,
    largeLeapPenalty: 0.72,
    direction: "ascending",
  },
  percussion: {
    patterns: {
      kick: STEADY_FOUR_ON_FLOOR,
      snare: BACKBEAT,
      hat: HOUSE_HAT,
      rim: OFFBEAT,
    },
    probability: 1,
    accentVelocity: 1,
    normalVelocity: 0.72,
  },
  mix: {
    reverbAmount: 0.1,
    reverbSeconds: 0.9,
    reverbDecay: 1.8,
    reverbBrightness: 0.68,
    volume: 0.94,
  },
};

const VIDEO_ARRANGEMENT = {
  id: "video-cinematic-cues",
  bass: { timbre: "cinematicBass", steps: [0], durationSteps: 12 },
  harmony: {
    timbre: "cinematicPad",
    steps: [0],
    eventsPerBar: 1,
    durationSteps: 15,
    velocity: 0.38,
  },
  melody: {
    timbre: "musicBox",
    startSteps: [0, 10],
    eventsPerBar: 2,
    durations: [
      { steps: 4, weight: 2 },
      { steps: 6, weight: 2 },
      { steps: 8, weight: 1 },
    ],
    probability: 0.8,
    maxLeap: 9,
    largeLeapPenalty: 0.6,
  },
  percussion: {
    patterns: { shaker: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0] },
    probability: 0.35,
    accentVelocity: 0.32,
    normalVelocity: 0.22,
  },
  mix: {
    reverbAmount: 0.38,
    reverbSeconds: 3.1,
    reverbDecay: 4,
    reverbBrightness: 0.28,
    volume: 0.78,
  },
};

function scene(id, icon, name, tagline, tags, config, arrangement) {
  return {
    id,
    icon,
    name,
    tagline,
    tags,
    generatorId: "ambient-generator-v1",
    sessionStrategyId: "quality-loop-v1",
    config: { ...config, arrangement },
  };
}

export const ambientScenes = [
  scene(
    "reading",
    "📖",
    "阅读",
    "留白、专注，不抢走文字",
    ["专注", "低干扰"],
    {
      mood: 0.58,
      energy: 0.22,
      bpm: 66,
      scaleId: "majorPentatonic",
      sections: continuousCalmForm,
    },
    READING_ARRANGEMENT,
  ),
  scene(
    "chores",
    "🧺",
    "做家务",
    "给重复动作一点轻快的节拍",
    ["轻快", "陪伴"],
    {
      mood: 0.72,
      energy: 0.58,
      bpm: 106,
      scaleId: "majorPentatonic",
      swing: 0.12,
      sections: motionForm,
    },
    CHORES_ARRANGEMENT,
  ),
  scene(
    "dining",
    "🍽️",
    "吃饭",
    "温暖从容，适合围桌交谈",
    ["温暖", "从容"],
    {
      mood: 0.68,
      energy: 0.32,
      bpm: 78,
      scaleId: "majorPentatonic",
      sections: longForm,
    },
    DINING_ARRANGEMENT,
  ),
  scene(
    "driving",
    "🚗",
    "开车",
    "稳定推进，陪你把路开长",
    ["律动", "推进"],
    {
      mood: 0.54,
      energy: 0.7,
      bpm: 100,
      scaleId: "majorPentatonic",
      sections: motionForm,
    },
    DRIVING_ARRANGEMENT,
  ),
  scene(
    "resting",
    "🌙",
    "休息",
    "慢慢松下来，让声音退到身后",
    ["舒缓", "夜晚"],
    {
      mood: 0.26,
      energy: 0.12,
      bpm: 58,
      scaleId: "majorPentatonic",
      sections: continuousCalmForm,
    },
    RESTING_ARRANGEMENT,
  ),
  scene(
    "party",
    "✨",
    "派对",
    "明亮有力，把房间点起来",
    ["明亮", "高能量"],
    {
      mood: 0.9,
      energy: 0.9,
      bpm: 124,
      scaleId: "majorPentatonic",
      sections: motionForm,
    },
    PARTY_ARRANGEMENT,
  ),
  scene(
    "workout",
    "🏃",
    "运动",
    "清晰的重拍，维持你的节奏",
    ["动力", "节拍"],
    {
      mood: 0.76,
      energy: 0.96,
      bpm: 136,
      scaleId: "majorPentatonic",
      sections: motionForm,
    },
    WORKOUT_ARRANGEMENT,
  ),
  scene(
    "video",
    "🎬",
    "视频配乐",
    "有画面感，给剪辑留出空间",
    ["画面", "背景"],
    {
      mood: 0.5,
      energy: 0.42,
      bpm: 86,
      scaleId: "majorPentatonic",
      sections: longForm,
    },
    VIDEO_ARRANGEMENT,
  ),
];

function legacyToScore(piece) {
  const beatPerSecond = piece.config.bpm / 60;
  const events = piece.events.map((event) =>
    makeNoteEvent({
      at: beat(Math.round(event.time * beatPerSecond * 960), 960),
      duration: beat(
        Math.max(1, Math.round(event.duration * beatPerSecond * 960)),
        960,
      ),
      partId: event.voice,
      pitch: edoPitch(event.midi),
      velocity: event.velocity,
      articulation: event.timbre,
      tags: event.section ? [event.section] : [],
    }),
  );
  let cursor = 0;
  for (const section of piece.config.sections) {
    events.push(
      makeMarkerEvent({
        at: beat(cursor * 4),
        kind: "section",
        label: section.name,
      }),
    );
    cursor += section.bars;
  }
  return validateScore({
    version: 1,
    tempoMap: makeTempoMap([{ at: beat(0), bpm: piece.config.bpm }]),
    meterMap: [{ at: beat(0), numerator: 4, denominator: 4 }],
    events,
  });
}

export const generators = [
  {
    id: "ambient-generator-v1",
    lookback: beat(0),
    lookahead: beat(0),
    /** 纯函数：当前实现以成熟的 legacy 算法作 Adapter，输出规范 Score 与兼容事件。 */
    generate({ seed, config, voiceOverrides = {} }) {
      const legacyPiece = generate(seed, config, scales, voiceOverrides);
      return { legacyPiece, score: legacyToScore(legacyPiece) };
    },
  },
];

export const sessionStrategies = [
  {
    id: "quality-loop-v1",
    /** 仅编排 seed/take，不写音符，也不接触 Audio。 */
    plan({ seed, sceneId, segmentIndex = 0 }) {
      const segmentSeed =
        segmentIndex === 0 ? seed : `${seed}:${sceneId}:${segmentIndex}`;
      return {
        segmentIndex,
        segmentSeed,
        takeSeeds: Array.from({ length: 8 }, (_, take) =>
          take ? `${segmentSeed}:take:${take}` : segmentSeed,
        ),
      };
    },
  },
];

export default {
  manifest,
  parts,
  ambientScenes,
  generators,
  sessionStrategies,
};
