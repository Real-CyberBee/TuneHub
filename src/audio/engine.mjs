// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 音频引擎：把内核产出的事件流变成声音。
 *
 * 全部基于原生 Web Audio API，**零第三方依赖**。
 * 之所以不用 Tone.js：本引擎只需要"振荡器 + 包络 + 滤波 + 噪声 + 混响"，
 * 原生 API 已足够，且能完全掌控离线渲染（区间导出）的行为。
 * 架构上这对应 docs/ARCHITECTURE.md 里的"适配器层"——将来可替换为 Tone.js 适配器。
 */

// ---------------------------------------------------------------------------
// 音色定义：声明式配方（对应内容层的 voice kind）
// ---------------------------------------------------------------------------

const PATCHES = {
  bass: {
    oscillators: [
      { type: "sine", detune: 0, gain: 1.0 },
      { type: "triangle", detune: 7, gain: 0.18 },
    ],
    attack: 0.008,
    decay: 0.5,
    sustain: 0.25,
    release: 0.25,
    filter: { type: "lowpass", frequency: 340, q: 0.8, envAmount: 420 },
    gain: 0.9,
  },
  pad: {
    oscillators: [
      { type: "triangle", detune: -5, gain: 0.5 },
      { type: "triangle", detune: 6, gain: 0.45 },
      { type: "sine", detune: 0, gain: 0.25 },
    ],
    attack: 0.9,
    decay: 1.2,
    sustain: 0.6,
    release: 1.6,
    filter: { type: "lowpass", frequency: 1500, q: 0.5, envAmount: 300 },
    gain: 0.34,
  },
  melody: {
    oscillators: [
      { type: "triangle", detune: 0, gain: 0.75 },
      { type: "sine", detune: 0, gain: 0.4 },
      { type: "sine", detune: 1200, gain: 0.07 },
    ],
    attack: 0.004,
    decay: 0.22,
    sustain: 0.06,
    release: 0.18,
    filter: { type: "lowpass", frequency: 3600, q: 0.9, envAmount: 2200 },
    gain: 0.5,
  },
  // 场景的乐器名是内容包可声明的“渲染提示”。未知名称会退回到声部默认音色，
  // 让旧作品与未来内容包即使没有新适配器也能安全播放。
  softBass: {
    oscillators: [
      { type: "sine", detune: 0, gain: 1 },
      { type: "triangle", detune: 4, gain: 0.08 },
    ],
    attack: 0.08,
    decay: 0.8,
    sustain: 0.32,
    release: 0.7,
    filter: { type: "lowpass", frequency: 240, q: 0.5, envAmount: 100 },
    gain: 0.62,
  },
  uprightBass: {
    oscillators: [
      { type: "triangle", detune: 0, gain: 0.75 },
      { type: "sine", detune: 0, gain: 0.42 },
    ],
    attack: 0.012,
    decay: 0.38,
    sustain: 0.16,
    release: 0.35,
    filter: { type: "lowpass", frequency: 680, q: 0.8, envAmount: 420 },
    gain: 0.72,
  },
  pulseBass: {
    oscillators: [
      { type: "sawtooth", detune: 0, gain: 0.42 },
      { type: "sine", detune: 0, gain: 0.68 },
    ],
    attack: 0.006,
    decay: 0.18,
    sustain: 0.14,
    release: 0.12,
    filter: { type: "lowpass", frequency: 460, q: 1.1, envAmount: 650 },
    gain: 0.72,
  },
  droneBass: {
    oscillators: [
      { type: "sine", detune: -4, gain: 0.8 },
      { type: "sine", detune: 5, gain: 0.5 },
    ],
    attack: 1.1,
    decay: 1.3,
    sustain: 0.58,
    release: 2.6,
    filter: { type: "lowpass", frequency: 190, q: 0.4, envAmount: 30 },
    gain: 0.48,
  },
  clubBass: {
    oscillators: [
      { type: "sawtooth", detune: 0, gain: 0.52 },
      { type: "sine", detune: 0, gain: 0.8 },
    ],
    attack: 0.004,
    decay: 0.12,
    sustain: 0.2,
    release: 0.1,
    filter: { type: "lowpass", frequency: 620, q: 1.3, envAmount: 1100 },
    gain: 0.8,
  },
  punchBass: {
    oscillators: [
      { type: "square", detune: 0, gain: 0.25 },
      { type: "sine", detune: 0, gain: 0.9 },
    ],
    attack: 0.003,
    decay: 0.12,
    sustain: 0.1,
    release: 0.08,
    filter: { type: "lowpass", frequency: 720, q: 1.4, envAmount: 1500 },
    gain: 0.86,
  },
  cinematicBass: {
    oscillators: [
      { type: "sine", detune: -7, gain: 0.85 },
      { type: "triangle", detune: 6, gain: 0.28 },
    ],
    attack: 0.25,
    decay: 0.8,
    sustain: 0.38,
    release: 1.8,
    filter: { type: "lowpass", frequency: 330, q: 0.7, envAmount: 180 },
    gain: 0.64,
  },
  warmPad: {
    oscillators: [
      { type: "triangle", detune: -8, gain: 0.46 },
      { type: "triangle", detune: 9, gain: 0.42 },
      { type: "sine", detune: 0, gain: 0.22 },
    ],
    attack: 0.6,
    decay: 1.4,
    sustain: 0.58,
    release: 1.8,
    filter: { type: "lowpass", frequency: 1200, q: 0.45, envAmount: 200 },
    gain: 0.3,
  },
  /** 段落连续层：快起音、低亮度、长释放，专用于阅读/休息的无断点底床。 */
  continuityPad: {
    oscillators: [
      { type: "sine", detune: -4, gain: 0.54 },
      { type: "triangle", detune: 5, gain: 0.28 },
    ],
    attack: 0.025,
    decay: 0.9,
    sustain: 0.42,
    release: 1.6,
    filter: { type: "lowpass", frequency: 980, q: 0.4, envAmount: 120 },
    gain: 0.17,
  },
  roadPad: {
    oscillators: [
      { type: "sawtooth", detune: -5, gain: 0.22 },
      { type: "triangle", detune: 6, gain: 0.54 },
    ],
    attack: 0.16,
    decay: 0.45,
    sustain: 0.32,
    release: 0.72,
    filter: { type: "lowpass", frequency: 1900, q: 0.7, envAmount: 700 },
    gain: 0.32,
  },
  glassPad: {
    oscillators: [
      { type: "sine", detune: -12, gain: 0.54 },
      { type: "sine", detune: 9, gain: 0.48 },
      { type: "triangle", detune: 1200, gain: 0.08 },
    ],
    attack: 1.5,
    decay: 1.8,
    sustain: 0.52,
    release: 3.2,
    filter: { type: "lowpass", frequency: 2400, q: 0.35, envAmount: 120 },
    gain: 0.25,
  },
  electricPiano: {
    oscillators: [
      { type: "sine", detune: 0, gain: 0.62 },
      { type: "sine", detune: 1200, gain: 0.2 },
      { type: "triangle", detune: 0, gain: 0.22 },
    ],
    attack: 0.006,
    decay: 0.7,
    sustain: 0.14,
    release: 0.45,
    filter: { type: "lowpass", frequency: 2600, q: 0.7, envAmount: 1200 },
    gain: 0.34,
  },
  brightStab: {
    oscillators: [
      { type: "sawtooth", detune: -5, gain: 0.35 },
      { type: "sawtooth", detune: 6, gain: 0.32 },
      { type: "sine", detune: 0, gain: 0.2 },
    ],
    attack: 0.003,
    decay: 0.18,
    sustain: 0.1,
    release: 0.2,
    filter: { type: "lowpass", frequency: 3100, q: 1, envAmount: 1900 },
    gain: 0.35,
  },
  powerStab: {
    oscillators: [
      { type: "square", detune: -4, gain: 0.24 },
      { type: "sawtooth", detune: 5, gain: 0.34 },
      { type: "sine", detune: 0, gain: 0.2 },
    ],
    attack: 0.003,
    decay: 0.14,
    sustain: 0.08,
    release: 0.16,
    filter: { type: "lowpass", frequency: 3400, q: 1.2, envAmount: 2200 },
    gain: 0.38,
  },
  cinematicPad: {
    oscillators: [
      { type: "triangle", detune: -10, gain: 0.4 },
      { type: "sine", detune: 7, gain: 0.48 },
      { type: "sine", detune: 1200, gain: 0.12 },
    ],
    attack: 1,
    decay: 1.6,
    sustain: 0.54,
    release: 2.8,
    filter: { type: "lowpass", frequency: 1700, q: 0.5, envAmount: 260 },
    gain: 0.28,
  },
  feltPiano: {
    oscillators: [
      { type: "triangle", detune: 0, gain: 0.5 },
      { type: "sine", detune: 0, gain: 0.42 },
      { type: "sine", detune: 1200, gain: 0.06 },
    ],
    attack: 0.008,
    decay: 0.7,
    sustain: 0.08,
    release: 0.65,
    filter: { type: "lowpass", frequency: 2100, q: 0.7, envAmount: 900 },
    gain: 0.36,
  },
  marimba: {
    oscillators: [
      { type: "sine", detune: 0, gain: 0.72 },
      { type: "sine", detune: 1200, gain: 0.13 },
      { type: "triangle", detune: 0, gain: 0.16 },
    ],
    attack: 0.002,
    decay: 0.26,
    sustain: 0.03,
    release: 0.12,
    filter: { type: "lowpass", frequency: 4200, q: 0.8, envAmount: 1600 },
    gain: 0.42,
  },
  vibraphone: {
    oscillators: [
      { type: "sine", detune: -3, gain: 0.62 },
      { type: "sine", detune: 4, gain: 0.53 },
      { type: "sine", detune: 1200, gain: 0.1 },
    ],
    attack: 0.008,
    decay: 1,
    sustain: 0.18,
    release: 1.1,
    filter: { type: "lowpass", frequency: 3400, q: 0.45, envAmount: 700 },
    gain: 0.32,
  },
  synthPluck: {
    oscillators: [
      { type: "sawtooth", detune: 0, gain: 0.42 },
      { type: "triangle", detune: 0, gain: 0.42 },
    ],
    attack: 0.003,
    decay: 0.16,
    sustain: 0.05,
    release: 0.18,
    filter: { type: "lowpass", frequency: 2800, q: 1.2, envAmount: 2300 },
    gain: 0.4,
  },
  softBell: {
    oscillators: [
      { type: "sine", detune: 0, gain: 0.64 },
      { type: "sine", detune: 1200, gain: 0.13 },
      { type: "sine", detune: 1900, gain: 0.05 },
    ],
    attack: 0.02,
    decay: 1.8,
    sustain: 0.04,
    release: 2.4,
    filter: { type: "lowpass", frequency: 3600, q: 0.35, envAmount: 500 },
    gain: 0.25,
  },
  synthLead: {
    oscillators: [
      { type: "sawtooth", detune: -6, gain: 0.34 },
      { type: "sawtooth", detune: 7, gain: 0.3 },
      { type: "sine", detune: 0, gain: 0.22 },
    ],
    attack: 0.004,
    decay: 0.16,
    sustain: 0.18,
    release: 0.2,
    filter: { type: "lowpass", frequency: 3600, q: 1.1, envAmount: 2400 },
    gain: 0.42,
  },
  musicBox: {
    oscillators: [
      { type: "sine", detune: 0, gain: 0.6 },
      { type: "sine", detune: 1200, gain: 0.16 },
      { type: "sine", detune: 2400, gain: 0.06 },
    ],
    attack: 0.003,
    decay: 0.65,
    sustain: 0.02,
    release: 0.9,
    filter: { type: "lowpass", frequency: 4600, q: 0.45, envAmount: 800 },
    gain: 0.28,
  },
  perc: {
    // 打击：噪声 + 音高扫频
    noise: true,
    attack: 0.001,
    decay: 0.1,
    release: 0.05,
    filter: { type: "highpass", frequency: 1200, q: 0.7 },
    lowpass: { frequency: 9000 },
    gain: 0.5,
  },
};

/** 打击乐各鼓的音高与包络微调（配方数据，不是算法）。 */
const PERC_TUNING = {
  kick: {
    type: "sine",
    startHz: 130,
    endHz: 44,
    decay: 0.34,
    freqDecay: 0.06,
    gain: 1.0,
    noiseGain: 0.05,
  },
  snare: {
    type: "triangle",
    startHz: 210,
    endHz: 170,
    decay: 0.17,
    freqDecay: 0.06,
    gain: 0.5,
    noiseGain: 0.5,
  },
  hat: {
    type: "square",
    startHz: 8000,
    endHz: 7000,
    decay: 0.035,
    freqDecay: 0.02,
    gain: 0.12,
    noiseGain: 0.28,
  },
  clap: {
    type: "triangle",
    startHz: 400,
    endHz: 300,
    decay: 0.11,
    freqDecay: 0.03,
    gain: 0.3,
    noiseGain: 0.6,
  },
  brush: {
    type: "sine",
    startHz: 180,
    endHz: 120,
    decay: 0.14,
    freqDecay: 0.04,
    gain: 0.04,
    noiseGain: 0.22,
    noiseHz: 1800,
  },
  shaker: {
    type: "square",
    startHz: 6800,
    endHz: 5600,
    decay: 0.045,
    freqDecay: 0.02,
    gain: 0.04,
    noiseGain: 0.2,
    noiseHz: 7000,
  },
  rim: {
    type: "triangle",
    startHz: 2600,
    endHz: 1250,
    decay: 0.055,
    freqDecay: 0.018,
    gain: 0.22,
    noiseGain: 0.06,
    noiseHz: 3400,
  },
};

export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// 确定性噪声
// ---------------------------------------------------------------------------

/**
 * 确定性伪随机：替代 Math.random()。
 *
 * 为什么必须这样：噪声（打击底噪、混响 IR）如果每帧随机，
 * **同种子两次渲染就不是逐样本一致的**——这会同时破坏
 *   1) M0 的验收标准（实时/离线一致）
 *   2) "导出可复现"（同一作品导出两次得到不同文件）
 *   3) 分享链接的可信度
 * 所以噪声也必须由种子派生。音乐部分是种子决定的，噪声部分同样。
 */
function detNoise32(i) {
  let x = (i | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 由种子 + 标签派生一个稳定的 32-bit 起点。 */
function seedBase(seed, label) {
  return (hashString(String(seed ?? "tunehub")) ^ hashString(label)) >>> 0;
}

// 模态参数是基于公开手碟物理模型的通用近似，不复用其源码或参数表。
// ratio 取接近 1:2:3 的主模态；少量 Hz 的伴随模态提供自然拍频。
const HANDPAN_MODAL_PATCHES = {
  handpanTone: {
    gain: 0.9,
    contactSeconds: 0.001,
    modes: [
      { ratio: 1, gain: 0.9, t60: 3.2 },
      { ratio: 1, offset: 1.1, gain: 0.13, t60: 2.1 },
      { ratio: 2, gain: 0.52, t60: 2.5 },
      { ratio: 2, offset: 1.6, gain: 0.13, t60: 1.9 },
      { ratio: 3, gain: 0.4, t60: 2.5 },
      { ratio: 3, offset: -2.2, gain: 0.1, t60: 1.9 },
      { ratio: 3.98, gain: 0.12, t60: 0.36 },
      { ratio: 5.9, gain: 0.18, t60: 0.32 },
      { ratio: 7.4, gain: 0.1, t60: 0.27 },
    ],
  },
  handpanBass: {
    gain: 0.82,
    // Ding 的接触力仍是圆顶脉冲；过长的接触会在激励阶段滤掉二、三倍频。
    contactSeconds: 0.003,
    modes: [
      { frequency: 85, gain: 0.1, t60: 1.5 },
      { ratio: 1, gain: 0.86, t60: 1.8 },
      { ratio: 1, offset: 1.1, gain: 0.18, t60: 1.25 },
      { ratio: 2, gain: 0.85, t60: 2.2 },
      { ratio: 2, offset: 1.6, gain: 0.16, t60: 1.8 },
      { ratio: 3, gain: 0.65, t60: 3 },
      { ratio: 3, offset: -2.2, gain: 0.12, t60: 2.3 },
      { ratio: 3.98, gain: 0.09, t60: 0.24 },
    ],
  },
  handpanDing: {
    gain: 0.84,
    contactSeconds: 0.006,
    modes: [
      { ratio: 1, gain: 0.82, t60: 0.78 },
      { ratio: 1, offset: 1.1, gain: 0.18, t60: 0.62 },
      { ratio: 2, gain: 0.62, t60: 0.64 },
      { ratio: 2, offset: 1.6, gain: 0.15, t60: 0.52 },
      { ratio: 3, gain: 0.48, t60: 0.42 },
      { ratio: 3, offset: -2.2, gain: 0.12, t60: 0.32 },
      { ratio: 3.98, gain: 0.13, t60: 0.2 },
      { ratio: 5.9, gain: 0.05, t60: 0.1, gate: 0.5 },
    ],
  },
  handpanEdge: {
    gain: 0.62,
    contactSeconds: 0.0045,
    modes: [
      { ratio: 1, gain: 0.48, t60: 0.48 },
      { ratio: 1, offset: 1.1, gain: 0.12, t60: 0.4 },
      { ratio: 2, gain: 0.5, t60: 0.42 },
      { ratio: 2, offset: 1.6, gain: 0.15, t60: 0.34 },
      { ratio: 3, gain: 0.42, t60: 0.3 },
      { ratio: 3, offset: -2.2, gain: 0.12, t60: 0.24 },
      { ratio: 3.98, gain: 0.15, t60: 0.16 },
      { ratio: 5.9, gain: 0.06, t60: 0.08, gate: 0.52 },
    ],
  },
  handpanGhost: {
    gain: 0.52,
    contactSeconds: 0.008,
    modes: [
      { ratio: 1, gain: 0.92, t60: 0.52 },
      { ratio: 1, offset: 1.1, gain: 0.14, t60: 0.42 },
      { ratio: 2, gain: 0.32, t60: 0.4 },
      { ratio: 2, offset: 1.6, gain: 0.08, t60: 0.32 },
      { ratio: 3, gain: 0.16, t60: 0.26 },
      { ratio: 3, offset: -2.2, gain: 0.04, t60: 0.2 },
    ],
  },
};

// 固定 D 大调示例琴的弱琴体耦合：被击中的音区会带动同一琴壳上的邻近音区。
// 只给已对照过的 A3、D4、E4 加入低电平共振，避免凭空生成不在音列中的音。
const HANDPAN_TONE_COUPLING = {
  57: [{ frequency: 293.66, gain: 0.025, t60: 1.1 }, { frequency: 90, gain: 0.019, t60: 0.9 }],
  62: [{ frequency: 220, gain: 0.07, t60: 0.9 }],
  64: [{ frequency: 293.66, gain: 0.035, t60: 0.9 }, { frequency: 220, gain: 0.05, t60: 0.9 }],
};

/** 真实单音的低场音更偏基音；随音区升高，倍频更容易被激发。 */
function handpanModeGain(patch, mode, pitch) {
  if (patch !== HANDPAN_MODAL_PATCHES.handpanTone) return 1;
  const register = Math.max(0, Math.min(1, (pitch - 220) / 110));
  const order = mode.ratio ?? 1;
  if (order >= 3.9) return 0.4 + register * 0.6;
  // 真实琴的上部模态早期较柔和，随后才显出金属余振；
  // 降低初始激励并减少这些模态的阻尼，比延长整条音符更接近这种演化。
  if (order >= 2.9) return (0.052 + register * 1.05) * 0.4;
  if (order >= 1.9) return (0.092 + register * 0.38) * 0.5;
  return 1;
}

/** 场音的基音尾音随音高略缩短；把最长衰减留给低场音。 */
function handpanModeT60(patch, mode, pitch) {
  if (patch !== HANDPAN_MODAL_PATCHES.handpanTone) return mode.t60;
  if (mode.ratio !== 1) return mode.t60;
  const register = Math.max(0, Math.min(1, (pitch - 220) / 110));
  return mode.offset ? mode.t60 - register * 0.35 : mode.t60 - register * 0.55;
}

/** 用圆顶包络的短促接触力激发并行共振模态，保留轻微的表面纹理。 */
function playHandpanModal(ctx, destination, event, startTime, noiseSeed) {
  const patch = HANDPAN_MODAL_PATCHES[event.timbre];
  if (!patch) return false;

  const velocity = Math.max(0.02, Math.min(1, event.velocity));
  const hitTime = event.time ?? event.startTime ?? startTime;
  const seed = seedBase(
    `${noiseSeed}|${event.timbre}|${event.midi}|${hitTime.toFixed(4)}`,
    "handpan-pluck",
  );
  // 接触时长改变激励脉冲的频谱；每次击奏可以不同，但不改琴体固有的音高与余振。
  const contactScale = Number.isFinite(event.contactScale)
    ? Math.max(0.65, Math.min(1.5, event.contactScale))
    : 1;
  const contactSeconds = patch.contactSeconds * contactScale;
  const pulseSeconds = contactSeconds;
  const strikePosition = Math.max(0, Math.min(1, event.strikePosition ?? 0.42));
  const brightness = Math.max(0, Math.min(1, event.toneBrightness ?? 0.56));
  const length = Math.max(1, Math.floor(ctx.sampleRate * pulseSeconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const progress = (i + 0.5) / length;
    const roundEnvelope = Math.sin(Math.PI * progress) ** 2;
    // 手指接触力主要是单向、平滑的脉冲；轻微纹理保留拨动金属表面的触感。
    // 纯随机噪声在仅数毫秒内会偶然抵消某些基音，使相邻音区像不同乐器。
    samples[i] = (0.8 + 0.2 * (detNoise32(seed + i) * 2 - 1)) * roundEnvelope;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const exciter = ctx.createGain();
  exciter.gain.value = 28 * patch.gain * Math.pow(velocity, 1.18);
  source.connect(exciter);

  // 短激励源结束后，浏览器可能提前停止上游静默的 Biquad 处理。
  // 保持零输入到模态衰减完成，才能听到琴体自身的尾音。
  const ringSource = ctx.createBufferSource();
  ringSource.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  ringSource.loop = true;
  ringSource.connect(exciter);

  const pitch = midiToHz(event.midi);
  const modalMix = ctx.createGain();
  modalMix.gain.value = 1;
  modalMix.connect(destination);
  const modes = patch === HANDPAN_MODAL_PATCHES.handpanTone
    ? [...patch.modes, ...(HANDPAN_TONE_COUPLING[event.midi] ?? [])]
    : patch.modes;
  for (const mode of modes) {
    if (mode.gate && velocity < mode.gate) continue;
    const frequency = mode.frequency ?? pitch * (mode.ratio ?? 1) + (mode.offset ?? 0);
    if (frequency < 30 || frequency > ctx.sampleRate * 0.45) continue;

    const resonator = ctx.createBiquadFilter();
    resonator.type = "bandpass";
    resonator.frequency.value = frequency;
    // Q 对应每个模态各自的衰减时间，而非整颗音符共用一个尾音包络。
    const t60 = handpanModeT60(patch, mode, pitch);
    // Q 随频率增大；固定封顶 500 会把 D4/E4 的高阶模态硬截成短尾音。
    // 此处由模态 T60 换算 Q，4k 只防御异常输入，不参与正常手碟音区。
    resonator.Q.value = Math.max(2, Math.min(4000, Math.PI * frequency * t60 / Math.log(1000)));
    const modeGain = ctx.createGain();
    const gate = mode.gate
      ? Math.pow((velocity - mode.gate) / (1 - mode.gate), 1.4)
      : 1;
    // 外缘触弦相对更容易激发高阶模态；位置影响限制在小范围内，避免变成音高滤波效果。
    const modalOrder = Math.max(0, Math.log2(frequency / pitch));
    const brightnessResponse = 1 + (brightness - 0.56) * 0.9 * Math.min(1, modalOrder / 2);
    const positionResponse = Math.max(
      0.72,
      Math.min(1.2, 1 + (strikePosition - 0.42) * (0.18 + modalOrder * 0.42)),
    );
    modeGain.gain.value = mode.gain * handpanModeGain(patch, mode, pitch) * gate * brightnessResponse * positionResponse;
    exciter.connect(resonator);
    resonator.connect(modeGain);
    modeGain.connect(modalMix);
  }

  source.start(startTime);
  source.stop(startTime + pulseSeconds + 0.001);
  const ringSeconds = Math.max(...modes.map((mode) => handpanModeT60(patch, mode, pitch))) * 2;
  ringSource.start(startTime);
  ringSource.stop(startTime + ringSeconds);
  return true;
}

// ---------------------------------------------------------------------------
// 程序生成的混响 IR（零版权风险、可参数化、且确定性）
// ---------------------------------------------------------------------------

/**
 * 用"噪声 × 指数衰减"合成脉冲响应。
 * 好处：不需要下载任何 IR 资源，没有许可问题，房间大小/亮度可参数化，
 * 且**由种子决定**——同种子导出两次得到完全相同的文件。
 */
export function createReverbIR(
  ctx,
  { seconds = 2.2, decay = 3.0, brightness = 0.35, seed = "tunehub" } = {},
) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  const base = seedBase(seed, "reverb-ir");
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    const chBase = (base + ch * 0x9e3779b9) >>> 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      const white = detNoise32(chBase + i) * 2 - 1;
      // 一阶低通：brightness 越小越暗
      lp = lp + brightness * (white - lp);
      data[i] = lp * env;
    }
    // 前 12ms 快速淡入，避免咔哒声
    const pre = Math.floor(rate * 0.012);
    for (let i = 0; i < pre && i < len; i++) data[i] *= i / pre;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// 单音播放
// ---------------------------------------------------------------------------

/**
 * 在给定 AudioContext 上播放一个音。
 * 这个函数是**实时与离线共用的**——这是"同种子实时/离线一致"的关键。
 */
export function playNoteOn(ctx, destination, event, noiseSeed = "tunehub") {
  const t = event.startTime;
  const patch = PATCHES[event.timbre] ?? PATCHES[event.voice] ?? PATCHES.melody;
  const dur = Math.max(0.04, event.duration);

  if (event.voice === "perc") {
    playPercOn(ctx, destination, event, t, noiseSeed);
    return;
  }
  if (playHandpanModal(ctx, destination, event, t, noiseSeed)) return;

  const voiceGain = ctx.createGain();
  voiceGain.gain.value = 0;

  let filter = null;
  let filterPeak = null;
  const fcfg = patch.filter;
  if (fcfg) {
    filter = ctx.createBiquadFilter();
    filter.type = fcfg.type;
    filter.frequency.value = fcfg.frequency;
    filter.Q.value = fcfg.q ?? 0.7;
    if (fcfg.envAmount) {
      filterPeak = Math.min(18000, fcfg.frequency + fcfg.envAmount);
      filter.frequency.setValueAtTime(fcfg.frequency, t);
      filter.frequency.linearRampToValueAtTime(filterPeak, t + 0.02);
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(120, fcfg.frequency),
        t + Math.max(0.08, dur * 1.1),
      );
    }
    voiceGain.connect(filter);
    filter.connect(destination);
  } else {
    voiceGain.connect(destination);
  }

  // 包络：线性 attack → 衰减到 sustain → release
  const vel = Math.max(0.02, Math.min(1, event.velocity));
  const peak = patch.gain * vel;
  const sustainLevel = Math.max(peak * patch.sustain, 0.0001);
  const g = voiceGain.gain;
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(peak, t + patch.attack);
  g.exponentialRampToValueAtTime(sustainLevel, t + patch.attack + patch.decay);
  const releaseStart = Math.max(t + patch.attack + patch.decay, t + dur);
  g.setValueAtTime(Math.max(sustainLevel, 0.0001), releaseStart);
  g.exponentialRampToValueAtTime(0.0001, releaseStart + patch.release);

  const stopAt = releaseStart + patch.release + 0.05;
  for (const osc of patch.oscillators) {
    const o = ctx.createOscillator();
    o.type = osc.type;
    o.frequency.value = midiToHz(event.midi);
    if (osc.detune) o.detune.value = osc.detune;
    const og = ctx.createGain();
    og.gain.value = osc.gain;
    o.connect(og);
    og.connect(voiceGain);
    o.start(t);
    o.stop(stopAt);
  }
}

function playPercOn(ctx, destination, event, t, noiseSeed = "tunehub") {
  const percussionPatch = PERC_TUNING[event.timbre] ?? PERC_TUNING.kick;
  const velocity = Math.max(0.05, Math.min(1, event.velocity));
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(destination);

  // 音高扫频体
  if (percussionPatch.gain > 0.001) {
    const o = ctx.createOscillator();
    o.type = percussionPatch.type;
    o.frequency.setValueAtTime(percussionPatch.startHz, t);
    o.frequency.exponentialRampToValueAtTime(
      percussionPatch.endHz,
      t + percussionPatch.freqDecay,
    );
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(percussionPatch.gain * velocity, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + percussionPatch.decay);
    let node = o;
    if (percussionPatch.type === "square") {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 6000;
      o.connect(hp);
      node = hp;
    }
    node.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + percussionPatch.decay + 0.05);
  }

  // 噪声体
  if (percussionPatch.noiseGain > 0.001) {
    const noiseLen = Math.max(
      1,
      Math.floor(ctx.sampleRate * (percussionPatch.decay + 0.05)),
    );
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // 每个事件一条独立但确定的噪声：同事件重复渲染得到完全相同的底噪
    const base = seedBase(
      `${noiseSeed}|${event.timbre}|${event.startTime.toFixed(4)}`,
      "perc-noise",
    );
    for (let i = 0; i < noiseLen; i++) d[i] = detNoise32(base + i) * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value =
      percussionPatch.noiseHz ?? (event.timbre === "hat" ? 9000 : 2200);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(
      percussionPatch.noiseGain * velocity,
      t + 0.002,
    );
    g.gain.exponentialRampToValueAtTime(0.0001, t + percussionPatch.decay);
    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + percussionPatch.decay + 0.05);
  }
}

// ---------------------------------------------------------------------------
// 总线：混音链（压缩 + 限制 + 混响发送）
// ---------------------------------------------------------------------------

export function buildMasterBus(
  ctx,
  {
    reverbAmount = 0.34,
    reverbSeconds = 2.4,
    reverbDecay = 3,
    reverbBrightness = 0.32,
    volume = 0.85,
    seed = "tunehub",
    analyse = false,
  } = {},
) {
  const input = ctx.createGain();
  input.gain.value = 1;

  // 干声
  const dry = ctx.createGain();
  dry.gain.value = 1 - reverbAmount * 0.45;

  // 混响支路
  const convolver = ctx.createConvolver();
  convolver.buffer = createReverbIR(ctx, {
    seconds: reverbSeconds,
    decay: reverbDecay,
    brightness: reverbBrightness,
    seed,
  });
  const wet = ctx.createGain();
  wet.gain.value = reverbAmount;
  const wetFilter = ctx.createBiquadFilter();
  wetFilter.type = "lowpass";
  wetFilter.frequency.value = 4200;

  // 压缩 + 限制：防止爆音（demo 里只用了压缩器，这里补上限制器）
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 3.2;
  comp.attack.value = 0.006;
  comp.release.value = 0.25;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;

  const master = ctx.createGain();
  master.gain.value = volume;

  let analyser = null;
  if (analyse) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.78;
    analyser.minDecibels = -112;
    analyser.maxDecibels = -24;
  }

  input.connect(dry);
  dry.connect(comp);
  input.connect(convolver);
  convolver.connect(wetFilter);
  wetFilter.connect(wet);
  wet.connect(comp);
  comp.connect(limiter);
  limiter.connect(master);
  if (analyser) {
    master.connect(analyser);
    analyser.connect(ctx.destination);
  } else {
    master.connect(ctx.destination);
  }

  return { input, master, comp, limiter, convolver, analyser };
}

// ---------------------------------------------------------------------------
// 事件准备：把内核事件加上绝对开始时间
// ---------------------------------------------------------------------------

/**
 * 截取 [offset, offset+span) 区间的事件，并平移到 0 起点。
 *
 * 两种边界情况都要处理：
 *  - 跨过起点的长音（pad / bass）：保留，但从 0 开始并按剩余时长计算
 *  - 落在 span 内的事件：正常平移
 * 不额外渲染尾音——尾音由调用方（renderRange）通过加大 span 处理。
 *
 * @param {Array} events  内核产出的事件（time 为相对作品起点）
 * @param {number} offset 区间起点（秒）
 * @param {number} span   区间长度（秒）
 */
export function prepareEvents(events, offset = 0, span = Infinity) {
  const out = [];
  for (const event of events) {
    if (event.time >= offset) {
      if (event.time - offset >= span) continue;
      out.push({ ...event, startTime: event.time - offset });
    } else if (event.time + event.duration > offset) {
      // 跨过起点：从 0 开始，缩短剩余时长
      out.push({
        ...event,
        startTime: 0,
        duration: event.time + event.duration - offset,
      });
    }
  }
  return out.sort((a, b) => a.startTime - b.startTime);
}
