// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 音频层冒烟测试。
 *
 * Node 里没有 Web Audio，所以这里用一组**记录型桩件**替换它：
 * 目的不是验证声音好不好听（那要靠耳朵），而是抓出
 *   - 调用了不存在的方法（拼写错误）
 *   - 误用字段（例如把 midi 当频率用）
 *   - 包络参数非法（指数斜坡到 0、NaN）
 *   - 区间切分逻辑错误
 * 这些都是在浏览器里调试最耗时的问题。
 *
 * 运行：node --test "tests/*.test.mjs"
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  playNoteOn,
  buildMasterBus,
  prepareEvents,
  createReverbIR,
  midiToHz,
} from "../src/audio/engine.mjs";
import { generate } from "../src/core/generate.mjs";
import { encodeMidi } from "../src/audio/midi.mjs";
import { beat, edoPitch } from "../src/core/score.mjs";

// ---------------------------------------------------------------------------
// Web Audio 桩件
// ---------------------------------------------------------------------------

function makeParam(name, log) {
  let _v = 0;
  const p = {
    _name: name,
    get value() {
      return _v;
    },
    // 直接赋值也要记录——否则会漏掉"振荡器频率设对了吗"这类检查
    set value(v) {
      if (typeof v !== "number" || Number.isNaN(v))
        throw new Error(`${name} 直接赋值不是数字: ${v}`);
      _v = v;
      log.push(["setValue", name, v]);
    },
    setValueAtTime(v, t) {
      check(name, v, t);
      log.push(["setValueAtTime", name, v, t]);
      return p;
    },
    linearRampToValueAtTime(v, t) {
      check(name, v, t);
      log.push(["linearRamp", name, v, t]);
      return p;
    },
    exponentialRampToValueAtTime(v, t) {
      if (v === 0)
        throw new Error(`exponentialRampToValueAtTime 不能到 0（${name}）`);
      check(name, v, t);
      log.push(["expRamp", name, v, t]);
      return p;
    },
    setTargetAtTime(v, t) {
      check(name, v, t);
      return p;
    },
  };
  function check(n, v, t) {
    if (typeof v !== "number" || Number.isNaN(v))
      throw new Error(`${n} 的值不是数字: ${v}`);
    if (typeof t !== "number" || Number.isNaN(t))
      throw new Error(`${n} 的时间不是数字: ${t}`);
    if (t < 0) throw new Error(`${n} 的时间为负: ${t}`);
  }
  return p;
}

function makeNode(kind, log) {
  const node = {
    _kind: kind,
    connect(dest) {
      log.push(["connect", kind, dest?._kind ?? "dest"]);
      return dest;
    },
    disconnect() {},
  };
  return node;
}

function makeCtx({ sampleRate = 44100 } = {}) {
  const log = [];
  const ctx = {
    _log: log,
    sampleRate,
    currentTime: 0,
    state: "running",
    destination: makeNode("destination", log),
    createGain() {
      const n = makeNode("gain", log);
      n.gain = makeParam("gain", log);
      return n;
    },
    createOscillator() {
      const n = makeNode("osc", log);
      n.type = "sine";
      n.frequency = makeParam("frequency", log);
      n.detune = makeParam("detune", log);
      n.start = (t) => {
        if (t < 0) throw new Error("osc.start 时间为负");
        log.push(["osc.start", t]);
      };
      n.stop = (t) => {
        if (t < 0) throw new Error("osc.stop 时间为负");
        log.push(["osc.stop", t]);
      };
      return n;
    },
    createBiquadFilter() {
      const n = makeNode("biquad", log);
      n.type = "lowpass";
      n.frequency = makeParam("frequency", log);
      n.Q = makeParam("Q", log);
      return n;
    },
    createConvolver() {
      const n = makeNode("convolver", log);
      n.buffer = null;
      return n;
    },
    createDynamicsCompressor() {
      const n = makeNode("compressor", log);
      for (const k of ["threshold", "knee", "ratio", "attack", "release"])
        n[k] = makeParam(k, log);
      return n;
    },
    createBuffer(ch, len, rate) {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return {
        numberOfChannels: ch,
        length: len,
        sampleRate: rate,
        getChannelData: (i) => data[i],
      };
    },
    createBufferSource() {
      const n = makeNode("bufferSource", log);
      n.buffer = null;
      n.start = (t) => log.push(["src.start", t]);
      n.stop = (t) => log.push(["src.stop", t]);
      return n;
    },
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// 频率换算
// ---------------------------------------------------------------------------

test("midiToHz 正确", () => {
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToHz(60) - 261.6255653) < 1e-6);
  // 微分音也要能算
  assert.ok(midiToHz(69.5) > 440 && midiToHz(69.5) < 466.2);
});

test("规范 Score 可导出可编辑 Standard MIDI File", async () => {
  const score = {
    version: 1,
    tempoMap: [{ at: beat(0), bpm: 120 }],
    meterMap: [{ at: beat(0), numerator: 4, denominator: 4 }],
    events: [
      {
        type: "note",
        at: beat(0),
        duration: beat(1),
        partId: "melody",
        pitch: edoPitch(69.5),
        velocity: 0.8,
      },
    ],
  };
  const blob = encodeMidi(score);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(
    [...bytes.slice(0, 4)],
    [0x4d, 0x54, 0x68, 0x64],
    "MIDI 头必须为 MThd",
  );
  assert.ok(bytes.includes(0x90), "MIDI 必须包含 note-on");
  assert.ok(bytes.includes(0xe0), "微分音应投影为 pitch bend");
});

// ---------------------------------------------------------------------------
// 混响 IR
// ---------------------------------------------------------------------------

test("混响 IR 长度与声道正确，且无 NaN", () => {
  const ctx = makeCtx();
  const ir = createReverbIR(ctx, { seconds: 0.5, decay: 3, brightness: 0.3 });
  assert.equal(ir.numberOfChannels, 2);
  assert.equal(ir.length, Math.floor(44100 * 0.5));
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    assert.equal(d.length, ir.length);
    for (let i = 0; i < 100; i++) assert.ok(!Number.isNaN(d[i]));
    // 起点应接近 0（有淡入，避免咔哒）
    assert.ok(Math.abs(d[0]) < 1e-6);
  }
});

// ---------------------------------------------------------------------------
// 总线
// ---------------------------------------------------------------------------

test("总线构建成功且接线合理", () => {
  const ctx = makeCtx();
  const bus = buildMasterBus(ctx);
  assert.ok(
    bus.input && bus.master && bus.comp && bus.limiter && bus.convolver,
  );
  assert.ok(bus.convolver.buffer, "卷积器必须已载入 IR");
  const kinds = ctx._log
    .filter((l) => l[0] === "connect")
    .map((l) => `${l[1]}→${l[2]}`);
  assert.ok(kinds.includes("compressor→compressor"), "应有限制器串联");
});

// ---------------------------------------------------------------------------
// 单音播放
// ---------------------------------------------------------------------------

test("每个声部都能在给定时间构造出节点，且包络合法", () => {
  for (const voice of ["bass", "harmony", "melody", "perc"]) {
    for (const timbre of ["kick", "snare", "hat", "clap"]) {
      const ctx = makeCtx();
      const bus = buildMasterBus(ctx);
      assert.doesNotThrow(() => {
        playNoteOn(ctx, bus.input, {
          voice,
          timbre,
          midi: 60,
          velocity: 0.8,
          duration: 0.5,
          startTime: 0.25,
        });
      }, `${voice}/${timbre} 构造失败`);
    }
  }
});

test("内容包声明的场景音色都能由 Web Audio Adapter 渲染", () => {
  const sceneTimbres = [
    "softBass",
    "uprightBass",
    "pulseBass",
    "droneBass",
    "clubBass",
    "punchBass",
    "cinematicBass",
    "warmPad",
    "roadPad",
    "glassPad",
    "electricPiano",
    "brightStab",
    "powerStab",
    "cinematicPad",
    "feltPiano",
    "marimba",
    "vibraphone",
    "synthPluck",
    "softBell",
    "synthLead",
    "musicBox",
    "continuityPad",
  ];
  for (const timbre of sceneTimbres) {
    const ctx = makeCtx();
    const bus = buildMasterBus(ctx);
    assert.doesNotThrow(
      () =>
        playNoteOn(ctx, bus.input, {
          voice: "melody",
          timbre,
          midi: 69,
          velocity: 0.7,
          duration: 0.5,
          startTime: 0,
        }),
      `${timbre} 应有合法渲染配方`,
    );
  }
});

test("振荡器频率与音高一致（不会把 midi 当 Hz）", () => {
  const ctx = makeCtx();
  const bus = buildMasterBus(ctx);
  playNoteOn(ctx, bus.input, {
    voice: "melody",
    midi: 69,
    velocity: 1,
    duration: 0.4,
    startTime: 0,
  });
  const anyFreq = ctx._log.filter(
    (l) =>
      (l[0] === "setValueAtTime" || l[0] === "setValue") &&
      l[1] === "frequency",
  );
  assert.ok(anyFreq.length > 0, "应设置过频率");
  assert.ok(
    anyFreq.some((l) => Math.abs(l[2] - 440) < 1e-6),
    `A4 应产生 440Hz 基频，实际 ${JSON.stringify(anyFreq)}`,
  );
});

test("包络不使用非法的指数斜坡到 0", () => {
  const ctx = makeCtx();
  const bus = buildMasterBus(ctx);
  // 桩件会在 exponentialRamp 到 0 时抛错，这里不应抛
  assert.doesNotThrow(() => {
    playNoteOn(ctx, bus.input, {
      voice: "pad",
      midi: 60,
      velocity: 0,
      duration: 3,
      startTime: 0,
    });
  });
});

test("零力度、零时长等边界输入不产生 NaN", () => {
  const ctx = makeCtx();
  const bus = buildMasterBus(ctx);
  for (const ev of [
    { voice: "melody", midi: 60, velocity: 0, duration: 0, startTime: 0 },
    { voice: "bass", midi: 36, velocity: 0, duration: 0.001, startTime: 10 },
    {
      voice: "perc",
      timbre: "hat",
      midi: 42,
      velocity: 0,
      duration: 0,
      startTime: 5,
    },
  ]) {
    assert.doesNotThrow(
      () => playNoteOn(ctx, bus.input, ev),
      JSON.stringify(ev),
    );
  }
});

// ---------------------------------------------------------------------------
// 区间切分（导出路径的核心）
// ---------------------------------------------------------------------------

test("prepareEvents：区间内事件被平移到 0 起点", () => {
  const events = [
    { time: 0, duration: 1, voice: "melody", midi: 60, velocity: 1 },
    { time: 5, duration: 1, voice: "melody", midi: 62, velocity: 1 },
    { time: 12, duration: 1, voice: "melody", midi: 64, velocity: 1 },
  ];
  const out = prepareEvents(events, 5, 5);
  assert.deepEqual(
    out.map((e) => e.startTime),
    [0],
  );
  assert.equal(out[0].midi, 62);
});

test("prepareEvents：跨过起点的长音被保留并从 0 开始", () => {
  const events = [
    { time: 2, duration: 10, voice: "harmony", midi: 55, velocity: 1 }, // 2..12，跨过 offset=5
  ];
  const out = prepareEvents(events, 5, 4);
  assert.equal(out.length, 1);
  assert.equal(out[0].startTime, 0);
  assert.ok(
    Math.abs(out[0].duration - 7) < 1e-9,
    `剩余时长应为 7，实际 ${out[0].duration}`,
  );
});

test("prepareEvents：不重复计入（回归：曾把跨起点音符算两次）", () => {
  const events = [
    { time: 0, duration: 6, voice: "bass", midi: 40, velocity: 1 },
  ];
  const out = prepareEvents(events, 2, 8);
  assert.equal(out.length, 1, `应只有 1 个事件，实际 ${out.length}`);
});

test("prepareEvents：span 之外的事件被排除", () => {
  const events = [
    { time: 0, duration: 1, voice: "melody", midi: 60, velocity: 1 },
    { time: 100, duration: 1, voice: "melody", midi: 60, velocity: 1 },
  ];
  const out = prepareEvents(events, 0, 10);
  assert.equal(out.length, 1);
});

test("prepareEvents：输出按时间有序，且真实作品全区间不丢事件", () => {
  const piece = generate("prep", { energy: 0.8 });
  const out = prepareEvents(piece.events, 0, piece.totalSeconds);
  assert.equal(out.length, piece.events.length, "整段导出不应丢事件");
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].startTime >= out[i - 1].startTime, "必须有序");
  }
  const maxStart = Math.max(...out.map((e) => e.startTime));
  assert.ok(maxStart < piece.totalSeconds);
});

test("任意区间切分都不越界、不产生负时间", () => {
  const piece = generate("ranges", { energy: 0.7 });
  for (const start of [
    0,
    1.3,
    5,
    piece.totalSeconds * 0.5,
    piece.totalSeconds - 0.5,
  ]) {
    const out = prepareEvents(piece.events, start, 8);
    for (const e of out) {
      assert.ok(e.startTime >= 0, `负起点 ${e.startTime}`);
      assert.ok(e.startTime < 8 + 1e-9, `超出区间 ${e.startTime}`);
      assert.ok(e.duration > 0, `非正时长 ${e.duration}`);
      assert.ok(!Number.isNaN(e.midi));
    }
  }
});

// ---------------------------------------------------------------------------
// 端到端：整首作品能在桩件上完整渲染（不放声，但走完全部代码路径）
// ---------------------------------------------------------------------------

test("整首作品可完整走完音频图构建（无异常）", () => {
  const piece = generate("e2e", { energy: 0.85, mood: 0.6 });
  const ctx = makeCtx();
  const bus = buildMasterBus(ctx);
  const prepared = prepareEvents(piece.events, 0, piece.totalSeconds);
  assert.ok(prepared.length > 100, "应有足量事件");
  for (const e of prepared) {
    playNoteOn(ctx, bus.input, e);
  }
  const starts = ctx._log.filter((l) => l[0] === "osc.start");
  assert.ok(starts.length > 50, `应创建了大量振荡器，实际 ${starts.length}`);
});
