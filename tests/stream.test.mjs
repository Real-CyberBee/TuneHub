// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 流式播放链路的纯逻辑测试：WebM 封装器 + 链路探测 + 播放器门面。
 *
 * 真实的"编码 → MSE → 出声"只能在浏览器里跑（tests/.deploy/lab 下的几个页面），
 * 这里守住的是容器字节的正确性和"探测失败必须老实退回实时合成"这两条底线。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { WebmOpusMuxer, preSkipFromOpusHead, OPUS_PRE_SKIP_48K } from "../src/audio/webm-muxer.mjs";
import { detectStreamSupport, STREAM_MIME } from "../src/audio/stream-pipeline.mjs";
import { MediaPlayer } from "../src/audio/media-player.mjs";
import { SpectrumTap, downsampleToTap } from "../src/audio/spectrum-tap.mjs";

// --- 最小的 EBML 读取器，只够验证结构 ---------------------------------------

const UNSET = 0xffffffffffffff;

/** 元素 ID 是"带长度标记位的原样字节"，不能剥掉标记位。 */
function readId(bytes, offset) {
  const first = bytes[offset];
  let length = 1;
  while (length <= 4 && !(first & (1 << (8 - length)))) length++;
  if (length > 4) throw new Error("非法 EBML 元素 ID");
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[offset + i];
  return { value, length };
}

/** 长度才是变长整数，需要剥掉长度标记位。 */
function readVint(bytes, offset) {
  const first = bytes[offset];
  let length = 1;
  while (length <= 8 && !(first & (1 << (8 - length)))) length++;
  if (length > 8) throw new Error("非法 EBML 变长整数");
  let value = first & ((1 << (8 - length)) - 1);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[offset + i];
  return { value, length, unknown: length === 8 && value === UNSET };
}

/** 按 EBML 规则顺序遍历一段字节里的同级元素。 */
function children(bytes, from, to) {
  const out = [];
  let i = from;
  while (i < to) {
    const id = readId(bytes, i);
    const size = readVint(bytes, i + id.length);
    const dataStart = i + id.length + size.length;
    const dataEnd = size.unknown ? to : dataStart + size.value;
    out.push({ id: id.value, idAt: i, sizeAt: i + id.length, dataStart, dataEnd });
    if (size.unknown) break;
    i = dataEnd;
  }
  return out;
}

const bytesToText = (bytes) => new TextDecoder().decode(bytes);

const HEAD = Uint8Array.from([
  0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // OpusHead
  0x01, 0x02, 0x38, 0x01, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function makeMuxer(overrides = {}) {
  return new WebmOpusMuxer({ codecPrivate: HEAD, channels: 2, sampleRate: 48000, ...overrides });
}

function headerTree(muxer) {
  const header = muxer.header();
  const top = children(header, 0, header.length);
  assert.equal(top.length, 2, "顶层应该是 EBML 头 + Segment");
  const ebml = header.subarray(top[0].dataStart, top[0].dataEnd);
  const segment = header.subarray(top[1].dataStart, top[1].dataEnd);
  return { header, ebml, segment, top };
}

/** 取"第一个元素的内容"，方便继续往里翻。 */
function payloadOf(bytes) {
  const [first] = children(bytes, 0, bytes.length);
  return bytes.subarray(first.dataStart, first.dataEnd);
}

// --- 测试 -------------------------------------------------------------------

test("OpusHead 预跳样本数是小端 uint16", () => {
  assert.equal(preSkipFromOpusHead(HEAD), 312);
  assert.equal(OPUS_PRE_SKIP_48K, 312);
  assert.equal(preSkipFromOpusHead(null), OPUS_PRE_SKIP_48K);
  assert.equal(preSkipFromOpusHead(new Uint8Array(4)), OPUS_PRE_SKIP_48K);
});

test("缺 OpusHead 时直接报错，而不是产出一条谁也解不开的流", () => {
  assert.throws(() => new WebmOpusMuxer({ codecPrivate: null }), /OpusHead/);
  assert.throws(() => new WebmOpusMuxer({ codecPrivate: new Uint8Array(8) }), /OpusHead/);
});

test("初始化段是合法的 WebM 头，且 Segment 用未知长度（直播流）", () => {
  const { header, ebml, segment, top } = headerTree(makeMuxer());

  assert.deepEqual([...header.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3], "EBML magic");
  assert.equal(top[0].id, 0x1a45dfa3);
  assert.equal(top[1].id, 0x18538067);

  const ebmlKids = children(ebml, 0, ebml.length).map((k) => k.id);
  assert.ok(ebmlKids.includes(0x4286), "EBMLVersion");
  assert.ok(ebmlKids.includes(0x42f7), "EBMLReadVersion");
  assert.ok(ebmlKids.includes(0x42f2), "EBMLMaxIDLength");
  assert.ok(ebmlKids.includes(0x42f3), "EBMLMaxSizeLength");
  assert.ok(ebmlKids.includes(0x4282), "DocType");
  assert.ok(ebmlKids.includes(0x4285), "DocTypeReadVersion");

  const docType = children(ebml, 0, ebml.length).find((k) => k.id === 0x4282);
  assert.equal(bytesToText(ebml.subarray(docType.dataStart, docType.dataEnd)), "webm");

  // Segment 的长度字段必须是"未知长度"，否则后续 append 的 Cluster 无处安放。
  const sizeField = readVint(header, top[1].sizeAt);
  assert.equal(sizeField.unknown, true, "Segment 应为未知长度");
  assert.ok(segment.length > 0, "Segment 内容就是后面的 Info + Tracks");
});

test("轨道声明为 A_OPUS，CodecPrivate = OpusHead，并带 CodecDelay / SeekPreRoll", () => {
  const { segment } = headerTree(makeMuxer());
  const info = children(segment, 0, segment.length).find((k) => k.id === 0x1549a966);
  const tracks = children(segment, 0, segment.length).find((k) => k.id === 0x1654ae6b);
  assert.ok(info && tracks, "Info 与 Tracks 都要在");

  const infoKids = children(segment, info.dataStart, info.dataEnd);
  const scale = infoKids.find((k) => k.id === 0x2ad7b1);
  assert.ok(scale, "TimestampScale");
  assert.equal(segment[scale.dataStart], 0x0f, "1000000 = 0x0F4240");
  assert.equal(segment[scale.dataStart + 2], 0x40);

  const entry = children(segment, tracks.dataStart, tracks.dataEnd).find((k) => k.id === 0xae);
  const entryKids = children(segment, entry.dataStart, entry.dataEnd);
  const byId = (id) => entryKids.find((k) => k.id === id);

  const codecId = byId(0x86);
  assert.equal(bytesToText(segment.subarray(codecId.dataStart, codecId.dataEnd)), "A_OPUS");

  const priv = byId(0x63a2);
  assert.deepEqual(
    [...segment.subarray(priv.dataStart, priv.dataEnd)],
    [...HEAD],
    "CodecPrivate 必须是编码器给的 OpusHead",
  );

  const trackType = byId(0x83);
  assert.equal(segment[trackType.dataStart], 2, "TrackType=2 表示音频");

  const delay = byId(0x56aa);
  assert.ok(delay, "CodecDelay");
  const delayNs = [...segment.subarray(delay.dataStart, delay.dataEnd)].reduce((n, b) => n * 256 + b, 0);
  assert.equal(delayNs, Math.round((312 * 1e9) / 48000), "CodecDelay = preSkip / 采样率");

  assert.ok(byId(0x56bb), "SeekPreRoll");

  const audio = children(segment, byId(0xe1).dataStart, byId(0xe1).dataEnd);
  const channels = audio.find((k) => k.id === 0x9f);
  assert.equal(segment[channels.dataStart], 2, "Channels=2");
  assert.ok(audio.find((k) => k.id === 0xb5), "SamplingFrequency");
});

test("帧按约 1 秒聚成 Cluster，时间戳递增且相对偏移正确", () => {
  const muxer = makeMuxer();
  muxer.header();
  const clusters = [];
  const frames = 150; // 3 秒，每帧 20ms
  for (let i = 0; i < frames; i++) {
    const chunk = muxer.addFrame(new Uint8Array([i & 0xff, 0x00]), i * 20);
    if (chunk) clusters.push(chunk);
  }
  const tail = muxer.finish();
  if (tail) clusters.push(tail);

  assert.ok(clusters.length >= 3 && clusters.length <= 4, `3 秒应聚成 3~4 个 Cluster，实际 ${clusters.length}`);
  assert.equal(muxer.frameCount, frames);

  let previousBase = -1;
  let seen = 0;
  for (const cluster of clusters) {
    assert.equal(cluster[0], 0x1f, "Cluster ID 首字节");
    const body = payloadOf(cluster);
    const kids = children(body, 0, body.length);
    const ts = kids.find((k) => k.id === 0xe7);
    assert.ok(ts, "每个 Cluster 都要带 Timestamp");
    const base = [...body.subarray(ts.dataStart, ts.dataEnd)].reduce((n, b) => n * 256 + b, 0);
    assert.ok(base > previousBase, "Cluster 时间戳必须递增");
    previousBase = base;

    const blocks = kids.filter((k) => k.id === 0xa3);
    assert.ok(blocks.length > 0);
    for (const block of blocks) {
      const blockBody = body.subarray(block.dataStart, block.dataEnd);
      const track = readVint(blockBody, 0);
      assert.equal(track.value, 1, "轨道号 1");
      const relative = (blockBody[track.length] << 8) | blockBody[track.length + 1];
      assert.ok(relative >= 0 && relative < 32768, "相对时间戳落在 int16 正区间");
      assert.equal(blockBody[track.length + 2], 0x80, "关键帧标志位");
      seen++;
    }
  }
  assert.equal(seen, frames, "每一帧都要出现在某个 SimpleBlock 里");
});

test("finish() 清空挂起帧，重复调用不再产出", () => {
  const muxer = makeMuxer();
  muxer.header();
  muxer.addFrame(new Uint8Array([1, 2, 3]), 0);
  const first = muxer.finish();
  assert.ok(first instanceof Uint8Array && first.length > 0);
  assert.equal(muxer.finish(), null);
});

test("没写头就先塞帧会被拒绝", () => {
  const muxer = makeMuxer();
  assert.throws(() => muxer.addFrame(new Uint8Array([1]), 0), /header/);
});

test("header() 只能调用一次——重复写头会毁掉整条流", () => {
  const muxer = makeMuxer();
  muxer.header();
  assert.throws(() => muxer.header(), /一次/);
});

test("流式 MIME 明确是 WebM/Opus", () => {
  assert.match(STREAM_MIME, /audio\/webm/);
  assert.match(STREAM_MIME, /opus/);
});

test("非浏览器环境下探测必须老实返回不支持", async () => {
  const support = await detectStreamSupport();
  assert.equal(support.ok, false);
  assert.equal(support.reason, "no-window");
  assert.equal(typeof window, "undefined", "这个测试本来就该跑在 Node 里");
});

test("探测失败时 MediaPlayer 自动退回实时实现，且接口保持完整", async () => {
  const player = new MediaPlayer({ analyse: false });
  const mode = await player.ready();
  assert.equal(mode, "realtime", "Node 里没有 WebCodecs/MSE，只能退回实时合成");
  assert.equal(player.mode, "realtime");
  assert.equal(player.reason, "no-window");

  for (const method of ["load", "extend", "setMuted", "setLookahead", "fill", "resume", "play", "pause", "stop"]) {
    assert.equal(typeof player[method], "function", `门面必须转发 ${method}`);
  }
  assert.equal(typeof player.position, "number");
  assert.equal(player.playing, false);
  assert.equal(player.bufferedAhead, 0);
  // onTick / onProgress / onEnded 由页面赋值，门面负责转接。
  assert.equal(player.onTick, null);
  assert.equal(player.onProgress, null);
  assert.equal(player.onEnded, null);
});

// --- 频谱取样器（可视化用，不依赖 Web Audio） --------------------------------

test("频谱取样器：整段静音时给 minDecibels，喂正弦时在该频率出峰", () => {
  const tap = new SpectrumTap({ fftSize: 2048, sampleRate: 12000 });
  const bins = new Float32Array(tap.frequencyBinCount);

  tap.setPosition(0);
  tap.getFloatFrequencyData(bins);
  assert.ok(bins.every((v) => v === tap.minDecibels), '没有数据时应全是 minDecibels');

  // 12 kHz 下 bin 宽度 = 5.859 Hz；喂 1000 Hz 正弦，峰值应落在 1000 Hz 附近的 bin。
  const seconds = 1;
  const samples = new Float32Array(tap.sampleRate * seconds);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.8 * Math.sin((2 * Math.PI * 1000 * i) / tap.sampleRate);
  }
  tap.push(0, samples);
  tap.setPosition(seconds);
  tap.getFloatFrequencyData(bins);

  let peakBin = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[peakBin]) peakBin = i;
  const peakHz = (peakBin * tap.sampleRate) / tap.fftSize;
  assert.ok(Math.abs(peakHz - 1000) < 30, `峰值应落在 1 kHz 附近，实际 ${peakHz.toFixed(1)} Hz`);
  assert.ok(bins[peakBin] > -40, `峰值应足够高，实际 ${bins[peakBin].toFixed(1)} dB`);
});

test("频谱取样器：播放头走到哪就取哪一段，并丢掉放过去的 PCM", () => {
  const tap = new SpectrumTap({ fftSize: 512, sampleRate: 12000 });
  const bins = new Float32Array(tap.frequencyBinCount);
  // 第 0~1 秒喂 400Hz，第 2~3 秒喂 2000Hz
  const mk = (hz) => {
    const a = new Float32Array(12000);
    for (let i = 0; i < a.length; i++) a[i] = 0.8 * Math.sin((2 * Math.PI * hz * i) / 12000);
    return a;
  };
  tap.push(0, mk(400));
  tap.push(2, mk(2000));

  const peakHz = (position) => {
    tap.setPosition(position);
    tap.getFloatFrequencyData(bins);
    let best = 0;
    for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
    return (best * tap.sampleRate) / tap.fftSize;
  };
  assert.ok(Math.abs(peakHz(1) - 400) < 60, `播放头在 1s 时应听到 400Hz，实际 ${peakHz(1).toFixed(0)}Hz`);
  assert.ok(Math.abs(peakHz(3) - 2000) < 80, `播放头在 3s 时应听到 2000Hz，实际 ${peakHz(3).toFixed(0)}Hz`);
});

test("频谱取样器：长时间播放不会无限长内存", () => {
  const tap = new SpectrumTap({ fftSize: 512, sampleRate: 12000 });
  const chunk = new Float32Array(12000);
  for (let i = 0; i < 400; i++) {
    tap.setPosition(i);
    tap.push(i, chunk);
  }
  let total = 0;
  for (const c of tap.chunks) total += c.data.length;
  assert.ok(total <= 152 * 12000, `保留的 PCM 应该封顶在约 150 秒，实际 ${(total / 12000).toFixed(0)} 秒`);
});

test("频谱取样器：已经渲染到播放头之后的分片不能把取值窗口带偏", () => {
  const tap = new SpectrumTap({ fftSize: 512, sampleRate: 12000 });
  const bins = new Float32Array(tap.frequencyBinCount);
  const tone = (hz) => {
    const a = new Float32Array(12000);
    for (let i = 0; i < a.length; i++) a[i] = 0.8 * Math.sin((2 * Math.PI * hz * i) / 12000);
    return a;
  };
  // 真实链路里始终有远超播放头的前瞻缓冲，这里刻意先推一段"未来"的分片。
  tap.push(0, tone(400));
  tap.push(2, tone(2000));
  tap.push(4, tone(3000));

  const peakHz = (position) => {
    tap.setPosition(position);
    tap.getFloatFrequencyData(bins);
    let best = 0;
    for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
    return (best * tap.sampleRate) / tap.fftSize;
  };
  // 播放头扫过三个区间，读数必须跟着走；修 bug 前这里只会返回同一个值。
  assert.ok(Math.abs(peakHz(1) - 400) < 60, `1s 应为 400Hz，实际 ${peakHz(1).toFixed(0)}Hz`);
  assert.ok(Math.abs(peakHz(3) - 2000) < 80, `3s 应为 2000Hz，实际 ${peakHz(3).toFixed(0)}Hz`);
  assert.ok(Math.abs(peakHz(5) - 3000) < 100, `5s 应为 3000Hz，实际 ${peakHz(5).toFixed(0)}Hz`);
  assert.notEqual(peakHz(1).toFixed(0), peakHz(3).toFixed(0), '不同播放头位置必须给出不同的频谱');
});
