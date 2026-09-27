// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 频谱取样器：从**已经渲染好的 PCM** 里算频谱，给可视化用。
 *
 * 为什么不挂 AnalyserNode：流式链路本来就是为了"不依赖 Web Audio"才存在的——
 * 多养一条常驻 AudioContext 既白烧 CPU，又可能干扰真正的媒体元素在息屏后拿到的
 * 后台播放待遇。而且实测浏览器会裁掉某些只通向静音节点的支路，分析器接在链路里
 * 输出有信号、自己的缓冲区却永远是 0。
 *
 * 这里的做法是确定性的：渲染分片时顺手留一份**降采样单声道**拷贝（12 kHz 足够
 * 覆盖手碟模态环关心的频段），再按播放头位置取一个窗口做 FFT。对外暴露成
 * AnalyserNode 的形状（fftSize / frequencyBinCount / getFloatFrequencyData），
 * 这样界面代码不用改。
 */

/** 可视化用 12 kHz：bin 宽度和 48 kHz + fftSize 8192 完全一样，但省 4 倍内存和算力。 */
export const TAP_RATE = 12000;
const DEFAULT_FFT = 2048;
/** dB 映射与 buildMasterBus 里的 AnalyserNode 保持一致。 */
const MIN_DB = -112;
const MAX_DB = -24;
/** 最多留多少秒 PCM：够覆盖"渲染前沿 - 播放头"的领先量即可。 */
const HISTORY_SECONDS = 150;

// --- 迭代式 radix-2 FFT ------------------------------------------------------

const twiddleCache = new Map();

function twiddles(n) {
  let table = twiddleCache.get(n);
  if (table) return table;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    const angle = (-2 * Math.PI * i) / n;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }
  table = { cos, sin };
  twiddleCache.set(n, table);
  return table;
}

function bitReverse(value, bits) {
  let out = 0;
  for (let i = 0; i < bits; i++) {
    out = (out << 1) | (value & 1);
    value >>= 1;
  }
  return out;
}

/** 原地复数 FFT（real/imag 长度必须是 2 的幂）。 */
function fft(real, imag) {
  const n = real.length;
  const bits = Math.log2(n) | 0;
  for (let i = 0; i < n; i++) {
    const j = bitReverse(i, bits);
    if (j > i) {
      let tmp = real[i]; real[i] = real[j]; real[j] = tmp;
      tmp = imag[i]; imag[i] = imag[j]; imag[j] = tmp;
    }
  }
  const { cos, sin } = twiddles(n);
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j++) {
        const k = j * step;
        const c = cos[k];
        const s = sin[k];
        const even = i + j;
        const odd = even + half;
        const tre = real[odd] * c - imag[odd] * s;
        const tim = real[odd] * s + imag[odd] * c;
        real[odd] = real[even] - tre;
        imag[odd] = imag[even] - tim;
        real[even] += tre;
        imag[even] += tim;
      }
    }
  }
}

/** Blackman 窗，和 AnalyserNode 规范里用的窗一致。 */
function blackman(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n);
  }
  return w;
}

export class SpectrumTap {
  /**
   * @param {object} options
   * @param {number} options.fftSize     默认 2048（配合 12 kHz 得到 5.9 Hz/bin）
   * @param {number} options.sampleRate  送入 push() 的 PCM 采样率
   * @param {() => number} options.positionProvider
   *        每次取值时现取播放头。可视化是逐帧读的，如果只在心跳里更新位置，
   *        频谱就会 4Hz 一跳、画面一顿一顿。
   */
  constructor({ fftSize = DEFAULT_FFT, sampleRate = TAP_RATE, positionProvider = null } = {}) {
    this.fftSize = fftSize;
    this.frequencyBinCount = fftSize >> 1;
    this.sampleRate = sampleRate;
    this.minDecibels = MIN_DB;
    this.maxDecibels = MAX_DB;
    this.chunks = [];
    this.position = 0;
    this.positionProvider = positionProvider;
    this.window = blackman(fftSize);
    this.real = new Float32Array(fftSize);
    this.imag = new Float32Array(fftSize);
    this.scratch = new Float32Array(fftSize);
  }

  /** 当前播放头（秒），取值窗口以它结尾。 */
  setPosition(seconds) {
    if (Number.isFinite(seconds)) this.position = seconds;
  }

  /** 现取播放头：优先用外部给的 provider，其次用最近一次 setPosition。 */
  #now() {
    if (this.positionProvider) {
      const value = this.positionProvider();
      if (Number.isFinite(value)) return value;
    }
    return this.position;
  }

  /** 追加一段降采样单声道 PCM；start 是这段第一个采样对应的音乐时间。 */
  push(start, samples) {
    if (!samples || !samples.length) return;
    this.chunks.push({ start, end: start + samples.length / this.sampleRate, data: samples });
    // 丢掉早就放过去的数据，内存不随时间增长。
    const floor = this.#now() - 2;
    while (this.chunks.length && this.chunks[0].end < floor) this.chunks.shift();
    const limit = Math.ceil(HISTORY_SECONDS * this.sampleRate);
    let total = 0;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      total += this.chunks[i].data.length;
      if (total > limit) { this.chunks.splice(0, i); break; }
    }
  }

  clear() {
    this.chunks.length = 0;
  }

  get ready() {
    return this.chunks.length > 0;
  }

  /** 取以播放头结尾、长度 fftSize 的窗口；数据不足时返回 false。 */
  #fillWindow() {
    const need = this.fftSize;
    // end 是"还想要的数据到哪个采样为止"。分片是从新到旧回看的，注意：
    // 播放头后方（未来）那些已经渲染好的分片完全不参与，绝不能因为它们而把
    // end 往前挪——否则窗口会固定住，频谱再也不变（这正是手碟页画面静止的原因）。
    let end = this.#now() * this.sampleRate;
    const out = this.scratch;
    let filled = 0;
    for (let i = this.chunks.length - 1; i >= 0 && filled < need; i--) {
      const chunk = this.chunks[i];
      const chunkStart = chunk.start * this.sampleRate;
      const wantedEnd = Math.min(end, chunkStart + chunk.data.length);
      if (wantedEnd > chunkStart) {
        const available = Math.min(Math.floor(wantedEnd - chunkStart), chunk.data.length);
        const take = Math.min(available, need - filled);
        if (take > 0) {
          out.set(chunk.data.subarray(available - take, available), need - filled - take);
          filled += take;
        }
      }
      end = Math.min(end, chunkStart);
    }
    return filled >= need;
  }

  /**
   * 与 AnalyserNode.getFloatFrequencyData 同形：写入 dB 值（长度 frequencyBinCount）。
   * 数据不足时写入 minDecibels（等价于"静音"）。
   */
  getFloatFrequencyData(out) {
    const bins = Math.min(out.length, this.frequencyBinCount);
    if (!this.#fillWindow()) {
      out.fill(this.minDecibels, 0, bins);
      return out;
    }
    const n = this.fftSize;
    const window = this.window;
    const real = this.real;
    const imag = this.imag;
    for (let i = 0; i < n; i++) {
      real[i] = this.scratch[i] * window[i];
      imag[i] = 0;
    }
    fft(real, imag);
    for (let k = 0; k < bins; k++) {
      const magnitude = Math.hypot(real[k], imag[k]) / n;
      const db = 20 * Math.log10(magnitude || 1e-12);
      out[k] = Math.min(this.maxDecibels, Math.max(this.minDecibels, db));
    }
    return out;
  }

  /** 方便测试／调试：直接拿一遍波形。 */
  getFloatTimeDomainData(out) {
    if (!this.#fillWindow()) {
      out.fill(0);
      return out;
    }
    const n = Math.min(out.length, this.fftSize);
    out.set(this.scratch.subarray(this.fftSize - n));
    return out;
  }
}

/** 把 48 kHz 立体声渲染结果降成 12 kHz 单声道，供 SpectrumTap 使用。 */
export function downsampleToTap(left, right, factor) {
  const sourceLength = left.length;
  const outLength = Math.floor(sourceLength / factor);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    let sum = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) {
      const index = base + j;
      sum += right && right !== left ? (left[index] + right[index]) * 0.5 : left[index];
    }
    out[i] = sum / factor;
  }
  return out;
}
