// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 极简 WebM(Matroska) 封装器：只做一件事——把 Opus 编码帧包成
 * `audio/webm; codecs="opus"`，好让 MediaSource 能喂给真正的 `<audio>` 元素。
 *
 * 为什么需要它：移动端浏览器只在**真正的媒体元素**上给后台播放待遇
 * （音频焦点、息屏不被冻结、锁屏控件）。Web Audio 直接出声拿不到这份待遇，
 * 息屏一分钟左右就会被系统掐掉。所以音频必须先变成"真媒体"，而 WebCodecs
 * 只给裸帧，容器得自己封。
 *
 * 只实现单轨 Opus 直播流所需的最小子集：
 *   EBML 头 → Segment(未知长度) → Info → Tracks → Cluster*
 * 不写 Cues / SeekHead——MSE 不需要，跳转由应用层重新喂数据完成。
 *
 * 参考：Matroska 规范、WebM 容器指南、Opus in WebM 的 CodecPrivate = OpusHead。
 */

// --- EBML 基本编码 ---------------------------------------------------------

const UNSET_SIZE = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

/** 元素 ID（已经带好长度标记位，按字节原样写）。 */
const ID = {
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  ebmlVersion: [0x42, 0x86],
  ebmlReadVersion: [0x42, 0xf7],
  ebmlMaxIdLength: [0x42, 0xf2],
  ebmlMaxSizeLength: [0x42, 0xf3],
  docType: [0x42, 0x82],
  docTypeVersion: [0x42, 0x87],
  docTypeReadVersion: [0x42, 0x85],
  segment: [0x18, 0x53, 0x80, 0x67],
  info: [0x15, 0x49, 0xa9, 0x66],
  timestampScale: [0x2a, 0xd7, 0xb1],
  muxingApp: [0x4d, 0x80],
  writingApp: [0x57, 0x41],
  tracks: [0x16, 0x54, 0xae, 0x6b],
  trackEntry: [0xae],
  trackNumber: [0xd7],
  trackUid: [0x73, 0xc5],
  trackType: [0x83],
  flagLacing: [0x9c],
  codecId: [0x86],
  codecPrivate: [0x63, 0xa2],
  codecDelay: [0x56, 0xaa],
  seekPreRoll: [0x56, 0xbb],
  defaultDuration: [0x23, 0xe3, 0x83],
  audio: [0xe1],
  samplingFrequency: [0xb5],
  channels: [0x9f],
  cluster: [0x1f, 0x43, 0xb6, 0x75],
  clusterTimestamp: [0xe7],
  simpleBlock: [0xa3],
};

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** EBML 变长整数（长度标记位 + 大端数值）。全 1 是"未知长度"，所以取严格小于。 */
function vint(value, forceLength = 0) {
  let length = forceLength;
  if (!length) {
    for (length = 1; length <= 8; length++) {
      if (value < 2 ** (7 * length) - 1) break;
    }
    if (length > 8) throw new RangeError("EBML 变长整数超出 8 字节");
  }
  const out = new Uint8Array(length);
  let rest = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  out[0] |= 1 << (8 - length);
  return out;
}

function uint(value, length = 0) {
  let size = length;
  if (!size) {
    size = 1;
    while (size < 8 && value >= 2 ** (8 * size)) size++;
  }
  const out = new Uint8Array(size);
  let rest = Math.max(0, Math.round(value));
  for (let i = size - 1; i >= 0; i--) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return out;
}

function float64(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, false);
  return out;
}

function utf8(text) {
  return new TextEncoder().encode(text);
}

function element(id, payload) {
  const body = payload instanceof Uint8Array ? payload : concat(payload);
  return concat([new Uint8Array(id), vint(body.length), body]);
}

function elements(payloads) {
  return concat(payloads);
}

// --- 主块 -----------------------------------------------------------------

/** 每个 Cluster 最多放多少毫秒（MSE 里一个 Cluster 就是一次 append 的粒度）。 */
const CLUSTER_MS = 1000;
/** SimpleBlock 的相对时间戳是 int16，留足余量。 */
const CLUSTER_MAX_MS = 30000;
/** Opus 标准预跳样本数（48 kHz）。 */
export const OPUS_PRE_SKIP_48K = 312;

export class WebmOpusMuxer {
  /**
   * @param {object} options
   * @param {Uint8Array} options.codecPrivate  OpusHead（WebCodecs 的 decoderConfig.description）
   * @param {number} options.channels
   * @param {number} options.sampleRate
   * @param {number} options.preSkip           编码器给出的预跳样本数
   */
  constructor({ codecPrivate, channels = 2, sampleRate = 48000, preSkip = OPUS_PRE_SKIP_48K } = {}) {
    if (!codecPrivate || codecPrivate.length < 19) {
      throw new Error("WebmOpusMuxer 需要 OpusHead（decoderConfig.description）");
    }
    this.codecPrivate = codecPrivate;
    this.channels = channels;
    this.sampleRate = sampleRate;
    this.preSkip = preSkip;
    this.pending = []; // 当前 Cluster 里累积的 SimpleBlock
    this.clusterBaseMs = null;
    this.nextClusterMs = 0;
    this.wroteHeader = false;
    this.frames = 0;
    this.bytes = 0;
  }

  /** 初始化段：EBML 头 + Segment(未知长度) + Info + Tracks。只应 append 一次。 */
  header() {
    if (this.wroteHeader) throw new Error("header() 只能调用一次");
    this.wroteHeader = true;

    const ebmlHeader = element(ID.ebml, [
      element(ID.ebmlVersion, uint(1)),
      element(ID.ebmlReadVersion, uint(1)),
      element(ID.ebmlMaxIdLength, uint(4)),
      element(ID.ebmlMaxSizeLength, uint(8)),
      element(ID.docType, utf8("webm")),
      element(ID.docTypeVersion, uint(4)),
      element(ID.docTypeReadVersion, uint(2)),
    ]);

    const info = element(ID.info, [
      element(ID.timestampScale, uint(1_000_000)), // 1 ms
      element(ID.muxingApp, utf8("tunehub")),
      element(ID.writingApp, utf8("tunehub")),
    ]);

    const audioSettings = element(ID.audio, [
      element(ID.samplingFrequency, float64(this.sampleRate)),
      element(ID.channels, uint(this.channels)),
    ]);

    const trackEntry = element(ID.trackEntry, [
      element(ID.trackNumber, uint(1)),
      element(ID.trackUid, uint(1)),
      element(ID.trackType, uint(2)), // 2 = audio
      element(ID.flagLacing, uint(0)),
      element(ID.codecId, utf8("A_OPUS")),
      element(ID.codecPrivate, this.codecPrivate),
      // 让播放器按 OpusHead 的预跳裁掉编码器延迟；SeekPreRoll 是 WebM 对 Opus 的要求。
      element(ID.codecDelay, uint(Math.round((this.preSkip * 1e9) / this.sampleRate))),
      element(ID.seekPreRoll, uint(80_000_000)),
      audioSettings,
    ]);

    const tracks = element(ID.tracks, [trackEntry]);
    const segment = concat([
      new Uint8Array(ID.segment),
      UNSET_SIZE, // 直播流：长度未知，后续 append 继续往这个 Segment 里塞
      info,
      tracks,
    ]);

    return concat([ebmlHeader, segment]);
  }

  /**
   * 塞入一帧 Opus 数据。
   * @param {Uint8Array} data
   * @param {number} timestampMs  该帧的绝对时间戳（毫秒）
   * @returns {Uint8Array|null}   凑满一个 Cluster 时返回可 append 的字节，否则 null
   */
  addFrame(data, timestampMs) {
    if (!this.wroteHeader) throw new Error("先调用 header()");
    const ts = Math.max(0, Math.round(timestampMs));
    if (this.clusterBaseMs === null || ts - this.clusterBaseMs >= CLUSTER_MS) {
      // 开新 Cluster 之前先把上一个吐出去
      const flushed = this.flushCluster();
      this.clusterBaseMs = ts;
      this.pending = [];
      if (flushed) {
        this.pushFrame(data, ts);
        this.frames += 1;
        this.bytes += data.length;
        return flushed;
      }
    }
    this.pushFrame(data, ts);
    this.frames += 1;
    this.bytes += data.length;
    return null;
  }

  /** 收尾：把最后一个 Cluster 吐出来。 */
  finish() {
    return this.flushCluster();
  }

  get frameCount() {
    return this.frames;
  }

  pushFrame(data, ts) {
    const relative = ts - this.clusterBaseMs;
    if (relative > CLUSTER_MAX_MS) throw new RangeError("Cluster 内时间跨度过大");
    const block = concat([
      vint(1, 1), // 轨道号
      new Uint8Array([(relative >> 8) & 0xff, relative & 0xff]),
      new Uint8Array([0x80]), // keyframe
      data,
    ]);
    this.pending.push(element(ID.simpleBlock, block));
  }

  flushCluster() {
    if (!this.pending.length) return null;
    const cluster = element(ID.cluster, [
      element(ID.clusterTimestamp, uint(this.clusterBaseMs)),
      elements(this.pending),
    ]);
    this.pending = [];
    return cluster;
  }
}

/** 从 OpusHead 里读出预跳样本数（小端 uint16，偏移 10）。 */
export function preSkipFromOpusHead(head) {
  if (!head || head.length < 12) return OPUS_PRE_SKIP_48K;
  return head[10] | (head[11] << 8);
}
