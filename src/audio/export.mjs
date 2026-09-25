// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 离线渲染与导出。
 *
 * 这是"截断某一段时间保存"的实现路径（见 docs/ROADMAP.md M5）：
 * **离线重渲染**，而不是实时录制。好处是精确区间、任意时长、快于实时、可确定性复现。
 *
 * 这条路径成立的前提是内核是确定性的、且音色代码不依赖墙钟——
 * 所以本模块用的 playNoteOn 与实时播放器是**同一个函数**。
 */

import { buildMasterBus, playNoteOn, prepareEvents } from './engine.mjs';

/**
 * 把事件流离屏渲染成 AudioBuffer。
 *
 * @param {Array} events  内核产出的全部事件
 * @param {Object} opts
 * @param {number} opts.start       区间起点（秒）
 * @param {number} opts.duration    区间长度（秒）
 * @param {number} opts.sampleRate  默认 44100
 * @param {number} opts.tail        额外尾音，避免混响被截断（默认 2.5s）
 * @param {number} opts.fadeOut     结尾淡出时长（默认 0.35s）
 */
export async function renderRange(events, opts = {}) {
  const {
    start = 0,
    duration = 30,
    sampleRate = 44100,
    tail = 2.5,
    fadeOut = 0.35,
    volume = 0.85,
    reverbAmount = 0.34,
    reverbSeconds = 2.4,
    reverbDecay = 3,
    reverbBrightness = 0.32,
    seed = 'tunehub',
  } = opts;

  const total = duration + tail;
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('此浏览器不支持 OfflineAudioContext，无法导出');

  const ctx = new Ctx(2, Math.ceil(total * sampleRate), sampleRate);
  const bus = buildMasterBus(ctx, {
    reverbAmount,
    reverbSeconds,
    reverbDecay,
    reverbBrightness,
    volume,
    seed,
  });

  // 事件流是确定性的，随机噪声（打击底噪、混响 IR）也由 seed 派生，
  // 因此同一 (事件, seed, 区间) 永远渲染出**逐样本相同**的音频。
  const prepared = prepareEvents(events, start, total).filter((e) => e.startTime < total);

  for (const e of prepared) {
    playNoteOn(ctx, bus.input, e, seed);
  }

  // 结尾淡出，避免截断爆音
  const nyquistSafe = Math.min(1, Math.max(0, duration / Math.max(0.001, total)));
  if (fadeOut > 0) {
    const g = bus.master.gain;
    const fadeStart = Math.max(0, total - fadeOut);
    g.setValueAtTime(volume, fadeStart);
    g.linearRampToValueAtTime(0.0001, total);
    void nyquistSafe;
  }

  return ctx.startRendering();
}

// ---------------------------------------------------------------------------
// WAV 编码（零依赖）
// ---------------------------------------------------------------------------

/** AudioBuffer → WAV Blob（16-bit PCM）。约 50 行，无需任何库。 */
export function encodeWav(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // 渲染结果已通过主总线的压缩与限制；PCM 编码不再额外改变未削波的波形。
  // 若峰值仍超过 1，只做整段线性缩放，避免整数削波引入新的谐波。
  const channels = [];
  for (let c = 0; c < numCh; c++) channels.push(audioBuffer.getChannelData(c));
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(channel[i]));
  }
  const linearGain = peak > 1 ? 1 / peak : 1;
  let offset = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = channels[c][i] * linearGain;
      s = Math.max(-1, Math.min(1, s));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

/** 便捷：渲染并直接下载。 */
export async function exportWav(events, opts = {}, filename = 'tunehub.wav') {
  const buf = await renderRange(events, opts);
  const blob = encodeWav(buf);
  triggerDownload(blob, filename);
  return blob;
}

/** 按 Part/声部离线渲染 WAV 分轨，供任意 DAW 继续编辑。 */
export async function exportStems(events, opts = {}, prefix = 'tunehub') {
  const voices = [...new Set(events.map((event) => event.voice ?? event.partId).filter(Boolean))];
  const blobs = {};
  for (const voice of voices) {
    const buffer = await renderRange(events.filter((event) => (event.voice ?? event.partId) === voice), opts);
    const blob = encodeWav(buffer);
    triggerDownload(blob, `${prefix}-${voice}.wav`);
    blobs[voice] = blob;
  }
  return blobs;
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
