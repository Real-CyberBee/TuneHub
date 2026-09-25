// SPDX-License-Identifier: Apache-2.0
/** TuneHub原创手碟独奏：固定调音、稳定手型、低音锚点与即兴式变奏。 */

import { deriveRng, weightedChoice } from "../../../core/rng.mjs";
import { analyzePleasantness } from "../../../core/generate.mjs";
import {
  beat,
  edoPitch,
  makeMarkerEvent,
  makeNoteEvent,
  makeTempoMap,
  validateScore,
} from "../../../core/score.mjs";

const FIXED_TUNING = {
  id: "d-major-pentatonic-d3",
  name: "D Major Pentatonic · D3 Ding",
  rootMidi: 50,
  dingMidi: 50,
  // 固定示例音列：D3 Ding 与 D大调五声音级的场音，不提供换调入口。
  notes: [50, 57, 59, 62, 64, 66, 69, 71, 74],
};

const MELODY_NOTES = FIXED_TUNING.notes.filter((midi) => midi > FIXED_TUNING.dingMidi);
const EIGHTH_OFFBEATS = [2, 6, 10, 14];
const SIXTEENTH_FILLS = [1, 5, 9, 13];
const RUN_STARTS = [0, 4, 8, 12, 16, 20, 24];
const GHOST_STEPS = [3, 11];
const ANTICIPATION_STEPS = [7, 15];

export const manifest = {
  id: "@tunehub/handpan-solo",
  version: "2.2.1",
  coreCompatibility: ">=1.0.0 <2.0.0",
  license: "Apache-2.0",
  provenance: {
    kind: "editorial",
    statement:
      "TuneHub原创编配，固定为D3 Ding的D大调五声音列；以动态生成的两小节动机、近期音符的转移选择、低音锚点和句尾留白组织旋律，不取样或复刻任何艺术家的作品。",
    limitations: [
      "实际手碟音列由具体乐器决定；此页面展示一个固定D大调五声音列示例，合成音色不能替代真实琴体的模态共鸣与演奏细节。",
      "风格参考限于宽泛的现代手碟独奏编曲特征，不复刻Malte Marten的具体旋律或录音。",
    ],
  },
};

export const parts = [
  {
    id: "bass",
    name: "低音 Ding 共鸣",
    capabilities: {
      lowMidi: FIXED_TUNING.dingMidi,
      highMidi: FIXED_TUNING.dingMidi,
      maxPolyphony: 1,
      continuousPitch: false,
      techniques: ["deep-ding", "long-resonance", "phrase-anchor"],
    },
    render: { instrument: "handpan-synth", timbre: "handpanBass" },
  },
  {
    id: "melody",
    name: "手碟场音",
    capabilities: {
      lowMidi: MELODY_NOTES[0],
      highMidi: MELODY_NOTES.at(-1),
      maxPolyphony: 1,
      continuousPitch: false,
      techniques: ["center-tone", "edge-tap", "ghost-note", "muted-touch"],
    },
    render: { instrument: "handpan-synth", timbre: "handpanTone" },
  },
];

const soloForm = [
  { name: "引音", bars: 4, density: 0.38, register: -1, expression: 0.78, colorShift: -0.04 },
  { name: "主题", bars: 12, density: 0.68, register: 0, expression: 0.98, colorShift: 0.01 },
  { name: "回环", bars: 8, density: 0.52, register: -1, expression: 0.86, colorShift: -0.02 },
  { name: "展开", bars: 12, density: 0.78, register: 1, expression: 1.06, colorShift: 0.055 },
  { name: "余响", bars: 6, density: 0.3, register: -1, expression: 0.72, colorShift: -0.05 },
];

const handpanArrangement = {
  id: "d-pentatonic-flowing-handpan",
  tuning: FIXED_TUNING,
  lowDing: {
    midi: FIXED_TUNING.dingMidi,
    durationBeats: 1.35,
    velocity: 0.32,
    accentVelocity: 0.48,
    accentEveryBars: 4,
    softAccentVelocity: 0.38,
  },
  melody: {
    timbres: [
      { timbre: "handpanTone", weight: 7 },
      { timbre: "handpanEdge", weight: 2 },
      { timbre: "handpanGhost", weight: 1 },
    ],
  },
  mix: {
    // 保留琴体自身的模态尾音；空间混响只做近距离房间感，避免叠出虚假的长回声。
    reverbAmount: 0.12,
    reverbSeconds: 1.55,
    reverbDecay: 3.2,
    reverbBrightness: 0.24,
    volume: 0.78,
  },
};

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function barHumanize(seed, bar) {
  return (deriveRng(seed, `bar-feel:${bar}`)() - 0.5) * 0.018;
}

function normalizeHandpanConfig(config = {}) {
  const bpm = clamp(Number(config.bpm ?? 100), 60, 132);
  const mood = clamp(Number(config.mood ?? 0.56), 0, 1);
  const energy = clamp(Number(config.energy ?? 0.56), 0.12, 0.86);
  return {
    ...config,
    bpm,
    mood,
    energy,
    rootMidi: FIXED_TUNING.rootMidi,
    scaleId: FIXED_TUNING.id,
    swing: clamp(Number(config.swing ?? 0.11), 0, 0.18),
    barsPerChord: 2,
    sections: soloForm.map((section) => ({ ...section })),
    arrangement: handpanArrangement,
  };
}

/** 固定一、三拍作锚点；其余拍与切分音由种子和密度决定。 */
function createRhythmMotif(rng, energy) {
  const flow = (energy - 0.12) / (0.86 - 0.12);
  const steps = [];
  for (let bar = 0; bar < 2; bar++) {
    const base = bar * 16;
    for (const step of [0, 8]) steps.push({ step: base + step, role: "pulse" });
    for (const step of [4, 12]) {
      if (rng() < 0.5 + flow * 0.34) steps.push({ step: base + step, role: "support" });
    }
    for (const step of EIGHTH_OFFBEATS) {
      if (rng() < 0.16 + flow * 0.67) steps.push({ step: base + step, role: "offbeat" });
    }
    for (const step of SIXTEENTH_FILLS) {
      if (rng() < 0.03 + flow * 0.13) steps.push({ step: base + step, role: "ornament" });
    }
    for (const step of GHOST_STEPS) {
      if (rng() < 0.035 + flow * 0.22) steps.push({ step: base + step, role: "ghost" });
    }
    for (const step of ANTICIPATION_STEPS) {
      if (rng() < 0.035 + flow * 0.16) steps.push({ step: base + step, role: "anticipation" });
    }
  }
  return steps.sort((a, b) => a.step - b.step);
}

/** 每个乐句的动机由有惯性的游走产生；相邻乐句可发展旧动机或开启新句。 */
function makePhraseMotif(rng, section, phrase, melodyState) {
  const previous = melodyState.motif;
  const developChance = phrase === 0 ? 0.35 : phrase % 2 === 1 ? 0.82 : 0.63;
  if (previous && rng() < developChance) {
    const registerMove = section.register - melodyState.motifRegister;
    const motif = previous.map((index) => clamp(index + registerMove, 0, MELODY_NOTES.length - 1));
    const start = 2 + Math.floor(rng() * 11);
    const span = 2 + Math.floor(rng() * 3);
    const change = rng() < 0.5 ? -1 : 1;
    for (let slot = start; slot < Math.min(motif.length, start + span); slot++) {
      motif[slot] = clamp(motif[slot] + change, 0, MELODY_NOTES.length - 1);
    }
    return motif;
  }

  const center = clamp(3 + section.register, 1, 6);
  const lastPlayed = melodyState.recent.at(-1);
  let position = lastPlayed == null
    ? clamp(center + (rng() < 0.5 ? -1 : 1), 0, MELODY_NOTES.length - 1)
    : clamp(lastPlayed, center - 2, center + 2);
  let direction = rng() < 0.5 ? -1 : 1;
  let leg = 2 + Math.floor(rng() * 4);
  const motif = [position];
  for (let slot = 1; slot < 16; slot++) {
    if (leg <= 0 || position <= 0 || position >= MELODY_NOTES.length - 1) {
      direction = position <= 1 ? 1 : position >= MELODY_NOTES.length - 2 ? -1 : -direction;
      leg = 2 + Math.floor(rng() * 4);
    }
    const candidates = MELODY_NOTES.map((_, index) => index)
      .filter((index) => Math.abs(index - position) <= 2);
    const cadence = clamp(2 + section.register, 0, MELODY_NOTES.length - 1);
    const weights = candidates.map((index) => {
      const move = index - position;
      let weight = Math.abs(move) === 0 ? 0.7 : Math.abs(move) === 1 ? 1.25 : 0.32;
      if (Math.sign(move) === direction) weight *= 1.6;
      else if (move !== 0) weight *= 0.55;
      weight /= 1 + Math.abs(index - center) * 0.45;
      if (slot >= 12) weight /= 1 + Math.abs(index - cadence) * (slot - 11) * 0.6;
      if (motif.at(-1) === motif.at(-2) && move === 0) weight *= 0.35;
      return weight;
    });
    position = weightedChoice(rng, candidates, weights);
    motif.push(position);
    leg--;
  }
  return motif;
}

function pitchForStep(motif, step) {
  const slot = Math.floor(step / 2) % motif.length;
  return MELODY_NOTES[motif[slot]];
}

/** 用最近几音为轮廓锚点挑下一音：偏好邻音，重复后转向，大跳后逐步回收。 */
function chooseContextPitch(rng, anchorPitch, recent, role) {
  if (!recent.length) return anchorPitch;
  const anchor = MELODY_NOTES.indexOf(anchorPitch);
  const last = recent.at(-1);
  const previous = recent.at(-2);
  const beforePrevious = recent.at(-3);
  const weights = MELODY_NOTES.map((_, index) => {
    const fromAnchor = Math.abs(index - anchor);
    const fromLast = Math.abs(index - last);
    let weight = 1 / (1 + fromAnchor * fromAnchor * 1.8);
    weight *= [0.72, 1.35, 0.78, 0.3, 0.12, 0.055, 0.025, 0.01][fromLast];
    if (role === "pulse") weight *= index === anchor ? 2.2 : 1;
    if (previous === last) weight *= index === last ? 0.44 : 1.2;
    if (previous != null && beforePrevious != null) {
      const oldDirection = Math.sign(previous - beforePrevious);
      const direction = Math.sign(last - previous);
      if (oldDirection && oldDirection === direction && Math.sign(index - last) === direction) {
        weight *= 0.55;
      }
    }
    if (previous != null && previous - last >= 4 && index > last && index <= last + 2) {
      weight *= 2.4;
    }
    return weight;
  });
  return weightedChoice(rng, MELODY_NOTES, weights);
}

function velocityForRole(role, beatIndex, phraseGain, mood) {
  const roleGain =
    role === "pulse" ? (beatIndex % 2 === 0 ? 0.78 : 0.62) :
    role === "support" ? 0.55 :
    role === "offbeat" ? 0.44 :
    role === "anticipation" ? 0.34 :
    role === "run" ? 0.46 :
    role === "ornament" ? 0.38 : 0.3;
  return clamp(roleGain * phraseGain * (0.96 + (mood - 0.5) * 0.16), 0.12, 0.92);
}

/** 一次两小节的呼吸：渐强到可变的峰点，再自然退回。 */
function breathGain(step, totalSteps, crest) {
  const phase = clamp(step / totalSteps, 0, 1);
  const progress = phase < crest ? phase / crest : (1 - phase) / (1 - crest);
  return 0.88 + 0.2 * Math.sin(Math.PI * progress / 2);
}

/** 同一乐句保持手型倾向，每一击再有小幅落点与接触差异。 */
function strikeForRole(rng, role, timbre, touch, strikeIndex) {
  const basePosition =
    timbre === "handpanEdge" ? 0.72 :
    role === "pulse" ? 0.3 :
    role === "ornament" || role === "run" ? 0.52 :
    role === "ghost" || role === "anticipation" ? 0.48 : 0.42;
  const handOffset = (strikeIndex % 2 === 0 ? -1 : 1) * touch.handLead * 0.025;
  const strikePosition = clamp(
    basePosition + touch.positionDrift + handOffset + (rng() - 0.5) * 0.12,
    0.16, 0.82,
  );
  const baseContact =
    role === "pulse" ? 1.12 :
    role === "ghost" || role === "anticipation" ? 1.18 :
    role === "ornament" || role === "run" ? 0.86 :
    timbre === "handpanEdge" ? 0.88 : 1;
  return {
    strikePosition,
    contactScale: clamp(
      baseContact * (1 + touch.contactDrift + (rng() - 0.5) * 0.28),
      0.68, 1.45,
    ),
    energyScale: 1 + (rng() - 0.5) * 0.12,
  };
}

function timbreForRole(rng, role, mood) {
  if (role === "ghost" || role === "anticipation") return "handpanGhost";
  if (role === "ornament" || role === "run") return rng() < 0.18 ? "handpanEdge" : "handpanTone";
  if (role === "pulse") return "handpanTone";
  if (role === "offbeat" && rng() < 0.24 + mood * 0.16) return "handpanEdge";
  return "handpanTone";
}

function addPhraseEvents(events, {
  seed,
  rhythm,
  section,
  sectionIndex,
  sectionStartBar,
  config,
  stepSeconds,
  melodyState,
}) {
  const barsPerPhrase = 2;
  const globalFlow = (config.energy - 0.12) / (0.86 - 0.12);
  const phraseCount = Math.ceil(section.bars / barsPerPhrase);

  for (let phrase = 0; phrase < phraseCount; phrase++) {
    const phraseRng = deriveRng(seed, `phrase:${sectionIndex}:${phrase}`);
    const touchRng = deriveRng(seed, `touch:${sectionIndex}:${phrase}`);
    const melodyRng = deriveRng(seed, `melody-choice:${sectionIndex}:${phrase}`);
    const motifRng = deriveRng(seed, `motif:${sectionIndex}:${phrase}`);
    const motif = makePhraseMotif(motifRng, section, phrase, melodyState);
    melodyState.motif = motif;
    melodyState.motifRegister = section.register;
    const absolutePhrase = Math.floor((sectionStartBar + phrase * barsPerPhrase) / barsPerPhrase);
    const previousSection = config.sections[sectionIndex - 1] ?? section;
    const transition = Math.min(1, (phrase + 1) / 2);
    const expression = previousSection.expression +
      (section.expression - previousSection.expression) * transition;
    const colorShift = previousSection.colorShift +
      (section.colorShift - previousSection.colorShift) * transition;
    const sectionArc = 0.95 + 0.09 * Math.sin(Math.PI * (phrase + 0.5) / phraseCount);
    const phraseGain = expression * sectionArc * (0.96 + phraseRng() * 0.08);
    const breathCrest = 0.42 + touchRng() * 0.18;
    const touch = {
      positionDrift: (touchRng() - 0.5) * 0.1,
      contactDrift: (touchRng() - 0.5) * 0.22,
      handLead: touchRng() < 0.5 ? -1 : 1,
    };
    const phraseStartBar = sectionStartBar + phrase * barsPerPhrase;
    const phraseBars = Math.min(barsPerPhrase, section.bars - phrase * barsPerPhrase);

    const phraseRhythm = rhythm
      .filter((item) => Math.floor(item.step / 16) < phraseBars)
      .map((item) => ({ ...item }));
    const optionalItems = phraseRhythm.filter((item) => item.role !== "pulse");
    if (optionalItems.length && phraseRng() < 0.12 + globalFlow * 0.2 + (1 - expression) * 0.2) {
      const remove = optionalItems[Math.floor(phraseRng() * optionalItems.length)];
      phraseRhythm.splice(phraseRhythm.indexOf(remove), 1);
    }
    if (phraseRng() < 0.1 + globalFlow * 0.24 * expression) {
      const bar = Math.floor(phraseRng() * phraseBars);
      const candidates = EIGHTH_OFFBEATS
        .map((step) => ({ step: bar * 16 + step, role: "offbeat" }))
        .filter((candidate) => !phraseRhythm.some((item) => item.step === candidate.step));
      if (candidates.length) phraseRhythm.push(candidates[Math.floor(phraseRng() * candidates.length)]);
      phraseRhythm.sort((a, b) => a.step - b.step);
    }

    // 短连击成组出现；其余乐句继续回到同一个两小节手型。
    const runChance = globalFlow * (0.2 + section.density * 0.38) * expression;
    const runCount = (phraseRng() < runChance ? 1 : 0) +
      (phraseRng() < runChance * 0.55 ? 1 : 0);
    const usedStarts = new Set();
    for (let run = 0; run < runCount; run++) {
      const candidates = RUN_STARTS.filter((step) =>
        step < phraseBars * 16 - 3 && !usedStarts.has(step) &&
        Math.floor(step / 16) === (run % phraseBars),
      );
      if (!candidates.length) continue;
      const start = candidates[Math.floor(phraseRng() * candidates.length)];
      usedStarts.add(start);
      for (const step of [start + 1, start + 2]) {
        if (!phraseRhythm.some((item) => item.step === step)) {
          phraseRhythm.push({ step, role: "run" });
        }
      }
    }
    // 偶尔把一拍的填音整组拿掉，形成能听见的换气，而非逐音撒随机休止。
    if (phraseRng() < 0.22 + globalFlow * 0.18 + (1 - expression) * 0.25) {
      const liftBar = Math.floor(phraseRng() * phraseBars);
      const liftBeat = phraseRng() < 0.5 ? 1 : 3;
      const liftStart = liftBar * 16 + liftBeat * 4;
      for (let i = phraseRhythm.length - 1; i >= 0; i--) {
        if (phraseRhythm[i].step >= liftStart && phraseRhythm[i].step < liftStart + 4 &&
            phraseRhythm[i].role !== "pulse") phraseRhythm.splice(i, 1);
      }
    }
    phraseRhythm.sort((a, b) => a.step - b.step);
    const breatheAtEnd = phraseRng() < 0.2 + (1 - globalFlow) * 0.16 + (1 - expression) * 0.35;

    let strikeIndex = 0;
    for (const item of phraseRhythm) {
      const localBar = Math.floor(item.step / 16);
      const phraseStep = localBar * 16 + (item.step % 16);
      if (breatheAtEnd && phraseStep >= phraseBars * 16 - 4 &&
          item.role !== "pulse") continue;
      const globalStep = phraseStartBar * 16 + phraseStep;
      const beatIndex = Math.floor((item.step % 16) / 4);
      const isPhraseEnd = phraseStep >= (phraseBars * 16 - 4);
      let pitch = pitchForStep(motif, item.step);

      const swingOffset = item.step % 4 === 2 ? config.swing * stepSeconds : 0;
      const barFeel = barHumanize(seed, phraseStartBar + localBar);
      const looseRange = item.role === "ghost" || item.role === "anticipation" ? 0.036 : item.role === "offbeat" ? 0.024 : item.role === "ornament" || item.role === "run" ? 0.016 : 0.012;
      const looseTouch = item.step % 16 === 0 ? 0 : (phraseRng() - 0.5) * looseRange;
      const at = globalStep * stepSeconds + swingOffset + barFeel + looseTouch;
      const nextDistance = phraseRhythm.find((candidate) => candidate.step > item.step)?.step - item.step;
      const fallbackDistance = 2;
      const maxDuration = (nextDistance || fallbackDistance) * stepSeconds * 0.86;
      const durationScale = 0.76 + phraseRng() * 0.48;
      const duration = Math.min(maxDuration, stepSeconds * (item.role === "ghost" || item.role === "anticipation" ? 1.5 : item.role === "ornament" || item.role === "run" ? 1.15 : 3.1) * durationScale);
      const timbre = timbreForRole(phraseRng, item.role, config.mood);
      if (item.role === "ornament" || item.role === "run") {
        const scaleIndex = MELODY_NOTES.indexOf(pitch);
        const direction = item.role === "run" && item.step % 4 === 1 ? 1 : phraseRng() < 0.5 ? -1 : 1;
        pitch = MELODY_NOTES[clamp(scaleIndex + direction, 0, MELODY_NOTES.length - 1)];
      }
      pitch = chooseContextPitch(melodyRng, pitch, melodyState.recent, item.role);
      if (isPhraseEnd && section.name === "余响") pitch = 62;
      melodyState.recent.push(MELODY_NOTES.indexOf(pitch));
      if (melodyState.recent.length > 4) melodyState.recent.shift();
      const breath = breathGain(phraseStep + 0.5, phraseBars * 16, breathCrest);
      const strike = strikeForRole(touchRng, item.role, timbre, touch, strikeIndex++);
      events.push({
        time: Math.max(0, at),
        duration,
        voice: "melody",
        midi: pitch,
        velocity: clamp(
          velocityForRole(item.role, beatIndex, phraseGain * breath, config.mood) * strike.energyScale,
          0.12, 0.92,
        ),
        section: section.name,
        timbre,
        toneBrightness: clamp(config.mood + colorShift + (breath - 0.96) * 0.12, 0, 1),
        // 落点与接触时长改变激励方式；共振模态、音高和衰减仍属于同一只琴。
        strikePosition: strike.strikePosition,
        contactScale: strike.contactScale,
        phrase: absolutePhrase,
      });
    }
  }
}

function addDingAnchors(events, config, barSeconds, seed) {
  const ding = config.arrangement.lowDing;
  let bar = 0;
  for (const section of config.sections) {
    for (let localBar = 0; localBar < section.bars; localBar++, bar++) {
      const accent = bar % ding.accentEveryBars === 0;
      const phraseReturn = bar % 2 === 0;
      const dingRng = deriveRng(seed, `ding:${bar}`);
      if (!accent && dingRng() < 0.18 + (1 - (config.energy - 0.12) / (0.86 - 0.12)) * 0.18) continue;
      events.push({
        time: Math.max(0, bar * barSeconds + barHumanize(seed, bar)),
        duration: (60 / config.bpm) * ding.durationBeats * (0.88 + dingRng() * 0.24),
        voice: "bass",
        midi: ding.midi,
        velocity: (accent ? ding.accentVelocity : phraseReturn ? ding.velocity : ding.softAccentVelocity) *
          (0.82 + 0.18 * section.expression) * (0.9 + dingRng() * 0.2),
        section: section.name,
        timbre: "handpanBass",
        toneBrightness: config.mood,
        strikePosition: 0.14 + dingRng() * 0.08,
        contactScale: 0.9 + dingRng() * 0.2,
      });
    }
  }
}

function generateHandpan(seed, inputConfig = {}, voiceOverrides = {}) {
  const config = normalizeHandpanConfig(inputConfig);
  const barSeconds = (60 / config.bpm) * 4;
  const stepSeconds = barSeconds / 16;
  const melodySeed = voiceOverrides.melody ?? seed;
  const rhythm = createRhythmMotif(deriveRng(melodySeed, "handpan-rhythm"), config.energy);
  const events = [];
  const melodyState = { recent: [], motif: null, motifRegister: 0 };

  let sectionStartBar = 0;
  config.sections.forEach((section, sectionIndex) => {
    addPhraseEvents(events, {
      seed: melodySeed,
      rhythm,
      section,
      sectionIndex,
      sectionStartBar,
      config,
      stepSeconds,
      melodyState,
    });
    sectionStartBar += section.bars;
  });
  addDingAnchors(events, config, barSeconds, voiceOverrides.bass ?? seed);
  events.sort((a, b) => a.time - b.time || a.midi - b.midi);

  const totalBars = config.sections.reduce((sum, section) => sum + section.bars, 0);
  const stats = analyzePleasantness(events);
  return {
    seed,
    config,
    overrides: voiceOverrides,
    events,
    totalBars,
    totalSeconds: totalBars * barSeconds,
    barSeconds,
    stepSeconds,
    scaleId: FIXED_TUNING.id,
    scaleName: FIXED_TUNING.name,
    tuningId: FIXED_TUNING.id,
    mix: {
      ...config.arrangement.mix,
      reverbBrightness: 0.22 + config.mood * 0.18,
    },
    arrangementId: config.arrangement.id,
    stats,
  };
}

function pieceToScore(piece) {
  const beatsPerSecond = piece.config.bpm / 60;
  const events = piece.events.map((event) =>
    makeNoteEvent({
      at: beat(Math.round(event.time * beatsPerSecond * 960), 960),
      duration: beat(Math.max(1, Math.round(event.duration * beatsPerSecond * 960)), 960),
      partId: event.voice,
      pitch: edoPitch(event.midi),
      velocity: event.velocity,
      articulation: event.timbre,
      tags: event.section ? [event.section] : [],
    }),
  );
  let cursor = 0;
  for (const section of piece.config.sections) {
    events.push(makeMarkerEvent({ at: beat(cursor * 4), kind: "section", label: section.name }));
    cursor += section.bars;
  }
  return validateScore({
    version: 1,
    tempoMap: makeTempoMap([{ at: beat(0), bpm: piece.config.bpm }]),
    meterMap: [{ at: beat(0), numerator: 4, denominator: 4 }],
    events,
  });
}

export const ambientScenes = [
  {
    id: "handpan-solo",
    packId: manifest.id,
    packVersion: manifest.version,
    icon: "🪷",
    name: "手碟独奏",
    tagline: "固定音列、低音锚点与可辨认的回环手型",
    tags: ["手碟", "空灵", "独奏"],
    generatorId: "handpan-generator-v1",
    sessionStrategyId: "handpan-loop-v1",
    config: {
      mood: 0.64,
      energy: 0.56,
      bpm: 100,
      rootMidi: FIXED_TUNING.rootMidi,
      scaleId: FIXED_TUNING.id,
      swing: 0.11,
      barsPerChord: 2,
      sections: soloForm,
      arrangement: handpanArrangement,
    },
  },
];

export const generators = [
  {
    id: "handpan-generator-v1",
    lookback: beat(0),
    lookahead: beat(0),
    generate({ seed, config, voiceOverrides = {} }) {
      const legacyPiece = generateHandpan(seed, config, voiceOverrides);
      return { legacyPiece, score: pieceToScore(legacyPiece) };
    },
  },
];

export const sessionStrategies = [
  {
    id: "handpan-loop-v1",
    plan({ seed, sceneId, segmentIndex = 0 }) {
      const segmentSeed = segmentIndex === 0 ? seed : `${seed}:${sceneId}:${segmentIndex}`;
      return {
        segmentIndex,
        segmentSeed,
        takeSeeds: Array.from({ length: 8 }, (_, take) => take ? `${segmentSeed}:take:${take}` : segmentSeed),
      };
    },
  },
];

export default { manifest, parts, ambientScenes, generators, sessionStrategies };
