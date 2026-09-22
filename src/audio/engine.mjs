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
      { type: 'sine', detune: 0, gain: 1.0 },
      { type: 'triangle', detune: 7, gain: 0.18 },
    ],
    attack: 0.008,
    decay: 0.5,
    sustain: 0.25,
    release: 0.25,
    filter: { type: 'lowpass', frequency: 340, q: 0.8, envAmount: 420 },
    gain: 0.9,
  },
  pad: {
    oscillators: [
      { type: 'triangle', detune: -5, gain: 0.5 },
      { type: 'triangle', detune: 6, gain: 0.45 },
      { type: 'sine', detune: 0, gain: 0.25 },
    ],
    attack: 0.9,
    decay: 1.2,
    sustain: 0.6,
    release: 1.6,
    filter: { type: 'lowpass', frequency: 1500, q: 0.5, envAmount: 300 },
    gain: 0.34,
  },
  melody: {
    oscillators: [
      { type: 'triangle', detune: 0, gain: 0.75 },
      { type: 'sine', detune: 0, gain: 0.4 },
      { type: 'sine', detune: 1200, gain: 0.07 },
    ],
    attack: 0.004,
    decay: 0.22,
    sustain: 0.06,
    release: 0.18,
    filter: { type: 'lowpass', frequency: 3600, q: 0.9, envAmount: 2200 },
    gain: 0.5,
  },
  perc: {
    // 打击：噪声 + 音高扫频
    noise: true,
    attack: 0.001,
    decay: 0.1,
    release: 0.05,
    filter: { type: 'highpass', frequency: 1200, q: 0.7 },
    lowpass: { frequency: 9000 },
    gain: 0.5,
  },
};

/** 打击乐各鼓的音高与包络微调（配方数据，不是算法）。 */
const PERC_TUNING = {
  kick: { type: 'sine', startHz: 130, endHz: 44, decay: 0.34, freqDecay: 0.06, gain: 1.0, noiseGain: 0.05 },
  snare: { type: 'triangle', startHz: 210, endHz: 170, decay: 0.17, freqDecay: 0.06, gain: 0.5, noiseGain: 0.5 },
  hat: { type: 'square', startHz: 8000, endHz: 7000, decay: 0.035, freqDecay: 0.02, gain: 0.12, noiseGain: 0.28 },
  clap: { type: 'triangle', startHz: 400, endHz: 300, decay: 0.11, freqDecay: 0.03, gain: 0.3, noiseGain: 0.6 },
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
  return (hashString(String(seed ?? 'tunehub')) ^ hashString(label)) >>> 0;
}

// ---------------------------------------------------------------------------
// 程序生成的混响 IR（零版权风险、可参数化、且确定性）
// ---------------------------------------------------------------------------

/**
 * 用"噪声 × 指数衰减"合成脉冲响应。
 * 好处：不需要下载任何 IR 资源，没有许可问题，房间大小/亮度可参数化，
 * 且**由种子决定**——同种子导出两次得到完全相同的文件。
 */
export function createReverbIR(ctx, { seconds = 2.2, decay = 3.0, brightness = 0.35, seed = 'tunehub' } = {}) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  const base = seedBase(seed, 'reverb-ir');
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
export function playNoteOn(ctx, destination, event, noiseSeed = 'tunehub') {
  const t = event.startTime;
  const patch = PATCHES[event.voice] ?? PATCHES.melody;
  const dur = Math.max(0.04, event.duration);

  if (event.voice === 'perc') {
    playPercOn(ctx, destination, event, t, noiseSeed);
    return;
  }

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

function playPercOn(ctx, destination, event, t, noiseSeed = 'tunehub') {
  const cfg = PERC_TUNING[event.timbre] ?? PERC_TUNING.kick;
  const vel = Math.max(0.05, Math.min(1, event.velocity));
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(destination);

  // 音高扫频体
  if (cfg.gain > 0.001) {
    const o = ctx.createOscillator();
    o.type = cfg.type;
    o.frequency.setValueAtTime(cfg.startHz, t);
    o.frequency.exponentialRampToValueAtTime(cfg.endHz, t + cfg.freqDecay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(cfg.gain * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cfg.decay);
    let node = o;
    if (cfg.type === 'square') {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6000;
      o.connect(hp);
      node = hp;
    }
    node.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + cfg.decay + 0.05);
  }

  // 噪声体
  if (cfg.noiseGain > 0.001) {
    const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * (cfg.decay + 0.05)));
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // 每个事件一条独立但确定的噪声：同事件重复渲染得到完全相同的底噪
    const base = seedBase(`${noiseSeed}|${event.timbre}|${event.startTime.toFixed(4)}`, 'perc-noise');
    for (let i = 0; i < noiseLen; i++) d[i] = detNoise32(base + i) * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = event.timbre === 'hat' ? 9000 : 2200;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(cfg.noiseGain * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cfg.decay);
    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + cfg.decay + 0.05);
  }
}

// ---------------------------------------------------------------------------
// 总线：混音链（压缩 + 限制 + 混响发送）
// ---------------------------------------------------------------------------

export function buildMasterBus(ctx, { reverbAmount = 0.34, volume = 0.85, seed = 'tunehub' } = {}) {
  const input = ctx.createGain();
  input.gain.value = 1;

  // 干声
  const dry = ctx.createGain();
  dry.gain.value = 1 - reverbAmount * 0.45;

  // 混响支路
  const convolver = ctx.createConvolver();
  convolver.buffer = createReverbIR(ctx, { seconds: 2.4, decay: 3.0, brightness: 0.32, seed });
  const wet = ctx.createGain();
  wet.gain.value = reverbAmount;
  const wetFilter = ctx.createBiquadFilter();
  wetFilter.type = 'lowpass';
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

  input.connect(dry);
  dry.connect(comp);
  input.connect(convolver);
  convolver.connect(wetFilter);
  wetFilter.connect(wet);
  wet.connect(comp);
  comp.connect(limiter);
  limiter.connect(master);
  master.connect(ctx.destination);

  return { input, master, comp, limiter, convolver };
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
  for (const e of events) {
    if (e.time >= offset) {
      if (e.time - offset >= span) continue;
      out.push({ ...e, startTime: e.time - offset });
    } else if (e.time + e.duration > offset) {
      // 跨过起点：从 0 开始，缩短剩余时长
      out.push({ ...e, startTime: 0, duration: e.time + e.duration - offset });
    }
  }
  return out.sort((a, b) => a.startTime - b.startTime);
}
