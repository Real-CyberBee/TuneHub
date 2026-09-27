// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 把确定性内核合成出来的音乐，做成一条**真正的媒体流**。
 *
 * 为什么不用 Web Audio 直接出声：移动端浏览器只把"真正的媒体元素"当作媒体播放。
 * Web Audio 直连 destination 拿不到音频焦点，息屏后页面会被节流甚至冻结，
 * 一分钟左右就断（安卓实测）。要让息屏继续放，声音必须从 `<audio>` 里出来。
 *
 * 所以链路是：
 *   事件流 → OfflineAudioContext 离线渲染（远快于实时）
 *          → WebCodecs AudioEncoder 编码成 Opus 裸帧
 *          → WebmOpusMuxer 封成 WebM
 *          → MediaSource 喂给 <audio>
 *
 * 分片之间要无缝：第 k 片渲染 `[start - tail, start + duration)` 再丢掉前 tail 秒，
 * 这样上一片末尾音符的混响尾巴仍然落在这一片里，边界处不会"咔"一下。
 */

import { renderRange } from "./export.mjs";
import { WebmOpusMuxer, OPUS_PRE_SKIP_48K, preSkipFromOpusHead } from "./webm-muxer.mjs";

/** Opus 在 WebM 里的 MIME；MediaSource 用它挑选解码器。 */
export const STREAM_MIME = 'audio/webm; codecs="opus"';
/** Opus 只认 48/24/16/12/8 kHz，直接用 48 kHz 省掉重采样。 */
export const STREAM_SAMPLE_RATE = 48000;
/** Opus 的标准帧长：20 ms。 */
const FRAME_SAMPLES = 960;

/**
 * 探测这台设备能不能走流式链路。不能的话调用方应该退回实时 Web Audio。
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function detectStreamSupport() {
  if (typeof window === "undefined") return { ok: false, reason: "no-window" };
  if (typeof AudioEncoder === "undefined") return { ok: false, reason: "no-webcodecs" };
  if (typeof MediaSource === "undefined") return { ok: false, reason: "no-mediasource" };
  if (typeof OfflineAudioContext === "undefined" && typeof window.webkitOfflineAudioContext === "undefined") {
    return { ok: false, reason: "no-offline-context" };
  }
  if (!MediaSource.isTypeSupported(STREAM_MIME)) return { ok: false, reason: "no-webm-opus-mse" };
  try {
    const result = await AudioEncoder.isConfigSupported({
      codec: "opus",
      sampleRate: STREAM_SAMPLE_RATE,
      numberOfChannels: 2,
      bitrate: 128000,
    });
    if (!result || !result.supported) return { ok: false, reason: "no-opus-encoder" };
  } catch {
    return { ok: false, reason: "opus-probe-failed" };
  }
  return { ok: true };
}

/** 极少数实现不给 decoderConfig.description；按 OpusHead 规范自己拼一个。 */
function synthOpusHead(channels, sampleRate, preSkip) {
  const head = new Uint8Array(19);
  const magic = "OpusHead";
  for (let i = 0; i < 8; i++) head[i] = magic.charCodeAt(i);
  head[8] = 1; // version
  head[9] = channels;
  head[10] = preSkip & 0xff;
  head[11] = (preSkip >> 8) & 0xff;
  new DataView(head.buffer).setUint32(12, sampleRate, true);
  new DataView(head.buffer).setUint16(16, 0, true); // output gain
  head[18] = 0; // mapping family
  return head;
}

/**
 * 一条持续的流：内部长期持有同一个 AudioEncoder 和同一个 WebmOpusMuxer，
 * 因此时间戳在整条流上是连续递增的。
 */
export class StreamPipeline {
  /**
   * @param {object} options
   * @param {number} options.sampleRate
   * @param {number} options.channels
   * @param {number} options.bitrate
   * @param {number} options.tailSeconds  每片额外向前多渲染的秒数（覆盖长混响尾巴）
   * @param {(bytes: Uint8Array) => void} options.onInit    初始化段（只能一次）
   * @param {(bytes: Uint8Array) => void} options.onSegment 媒体段（Cluster）
   * @param {(error: Error) => void} options.onError
   */
  constructor({
    sampleRate = STREAM_SAMPLE_RATE,
    channels = 2,
    bitrate = 128000,
    tailSeconds = 6,
    onInit = null,
    onSegment = null,
    onError = null,
  } = {}) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.bitrate = bitrate;
    this.tailSeconds = tailSeconds;
    this.onInit = onInit;
    this.onSegment = onSegment;
    this.onError = onError;

    this.encoder = null;
    this.muxer = null;
    this.opened = false;
    this.closed = false;
    this.frames = 0;
    this.bytes = 0;
    this.renderMs = 0;
  }

  get frameCount() {
    return this.frames;
  }

  /** 打开编码器。必须在 produce() 之前调用。 */
  async open() {
    if (this.opened) return;
    this.opened = true;
    this.encoder = new AudioEncoder({
      output: (chunk, metadata) => this.#handleChunk(chunk, metadata),
      error: (error) => {
        if (this.onError) this.onError(error instanceof Error ? error : new Error(String(error)));
      },
    });
    this.encoder.configure({
      codec: "opus",
      sampleRate: this.sampleRate,
      numberOfChannels: this.channels,
      bitrate: this.bitrate,
    });
  }

  #handleChunk(chunk, metadata) {
    if (!this.muxer) {
      const description = metadata && metadata.decoderConfig && metadata.decoderConfig.description;
      const head = description
        ? new Uint8Array(description)
        : synthOpusHead(this.channels, this.sampleRate, OPUS_PRE_SKIP_48K);
      this.muxer = new WebmOpusMuxer({
        codecPrivate: head,
        channels: this.channels,
        sampleRate: this.sampleRate,
        preSkip: preSkipFromOpusHead(head),
      });
      if (this.onInit) this.onInit(this.muxer.header());
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.frames += 1;
    this.bytes += data.length;
    const cluster = this.muxer.addFrame(data, chunk.timestamp / 1000);
    if (cluster && this.onSegment) this.onSegment(cluster);
  }

  /**
   * 渲染并编码一段音乐，通过 onInit / onSegment 吐给 MediaSource。
   *
   * @param {object} job
   * @param {Array} job.events  完整事件流
   * @param {object} job.mix    场景混音参数（与实时播放器同一份）
   * @param {string} job.seed
   * @param {number} job.start  这一片的音乐起点（秒）
   * @param {number} job.duration 这一片的长度（秒），会向下取整到 20ms 的整数倍
   * @returns {Promise<number>} 下一片的起点
   */
  async produce({ events, mix = {}, seed = "tunehub", start = 0, duration = 8 }) {
    if (!this.opened) await this.open();
    if (this.closed) throw new Error("StreamPipeline 已关闭");
    // 对齐到 Opus 帧长，避免最后半帧被丢掉导致时间戳错位
    const frames = Math.max(1, Math.round((duration * this.sampleRate) / FRAME_SAMPLES));
    const span = (frames * FRAME_SAMPLES) / this.sampleRate;
    const tail = this.tailSeconds;

    const t0 = performance.now();
    const buffer = await renderRange(events, {
      start: start - tail,
      duration: span + tail,
      sampleRate: this.sampleRate,
      tail: 0,
      fadeOut: 0,
      ...mix,
      seed,
    });
    this.renderMs += performance.now() - t0;

    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const base = Math.round(tail * this.sampleRate);
    const stop = Math.round((tail + span) * this.sampleRate);
    const planar = new Float32Array(FRAME_SAMPLES * 2);

    for (let offset = base; offset + FRAME_SAMPLES <= stop; offset += FRAME_SAMPLES) {
      planar.set(left.subarray(offset, offset + FRAME_SAMPLES), 0);
      planar.set(right.subarray(offset, offset + FRAME_SAMPLES), FRAME_SAMPLES);
      const at = start + (offset - base) / this.sampleRate;
      this.encoder.encode(
        new AudioData({
          format: "f32-planar",
          sampleRate: this.sampleRate,
          numberOfFrames: FRAME_SAMPLES,
          numberOfChannels: 2,
          timestamp: Math.round(at * 1e6),
          data: planar.slice(0),
        }),
      );
    }
    // 刻意**不**在这里 flush：flush 会把编码器内部的预跳/前瞻状态收尾，
    // 每次分片都 flush 等于每片都重新插入一次编码延迟，一条流放久了会累积
    // 漂移（实测分片越多、包络越对不齐）。编码帧本来就会按顺序从 output
    // 回调吐出来，只有整条流真正结束时才需要 flush。
    return start + span;
  }

  /** 关闭并吐出最后一个 Cluster。 */
  async close() {
    if (this.closed) return null;
    this.closed = true;
    let tail = null;
    try {
      if (this.encoder && this.encoder.state !== "closed") {
        await this.encoder.flush();
        this.encoder.close();
      }
    } catch {}
    if (this.muxer) tail = this.muxer.finish();
    return tail;
  }
}
