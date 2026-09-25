// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 后台播放相关的播放器行为测试。
 *
 * 这些性质决定了"息屏后音乐还连着"：
 *   - 隐藏页面时前瞻窗口要变大（定时器被节流也不断音）
 *   - 锁屏「暂停 / 继续」要保留播放头，不能回到开头
 *   - 无尽续写走 onTick（rAF 在后台不跑），且续写失败不能打断发声
 *   - 自然播完与用户按停止要能区分
 *
 * 这里不需要真的 Web Audio：事件故意排到很远的未来，播放器只走调度骨架，
 * 不会碰到 playNoteOn。总线与 ctx 用最小桩件代替。
 *
 * 运行：node --test "tests/*.test.mjs"
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { Player, LOOKAHEAD_VISIBLE, LOOKAHEAD_HIDDEN } from "../src/audio/player.mjs";

function makePlayer() {
  const player = new Player();
  player.ctx = { currentTime: 0, state: "running", resume: async () => {} };
  player.bus = { input: null, master: { disconnect() {} } };
  player.noiseSeed = "background";
  player.mixKey = "{}";
  return player;
}

/** 事件排在未来很远：永远不进调度窗口，测试就只覆盖控制逻辑。 */
function makePiece({ totalSeconds = 40 } = {}) {
  return {
    seed: "background",
    mix: {},
    totalSeconds,
    events: [{ voice: "melody", midi: 69, time: 100000, duration: 1, velocity: 0.8 }],
  };
}

test("后台前瞻窗口远大于前台，且非法值被忽略", () => {
  assert.ok(LOOKAHEAD_HIDDEN > LOOKAHEAD_VISIBLE * 10, "后台前瞻必须明显更大");
  const player = makePlayer();
  assert.equal(player.lookahead, LOOKAHEAD_VISIBLE);
  player.setLookahead(LOOKAHEAD_HIDDEN);
  assert.equal(player.lookahead, LOOKAHEAD_HIDDEN);
  for (const bad of [0, -1, NaN, undefined, "5"]) {
    player.setLookahead(bad);
    assert.equal(player.lookahead, LOOKAHEAD_HIDDEN, `非法值 ${String(bad)} 不应改变前瞻`);
  }
});

test("暂停保留播放头，继续时从暂停处接着放", async () => {
  const player = makePlayer();
  await player.load(makePiece());
  await player.play(0);
  try {
    player.ctx.currentTime = 5;
    const before = player.position;
    assert.ok(before > 4.5 && before < 5, `播放头应在 5 秒附近，实际 ${before}`);

    player.pause();
    assert.equal(player.playing, false);
    assert.ok(Math.abs(player.position - before) < 1e-9, "暂停后播放头应停在原处");

    // 暂停期间挂钟继续走，但音乐位置不能跟着走。
    player.ctx.currentTime = 30;
    assert.ok(Math.abs(player.position - before) < 1e-9, "暂停期间播放头不应移动");

    await player.play();
    assert.equal(player.playing, true);
    player.ctx.currentTime = 31.08; // 续播会留 0.08s 余量
    assert.ok(
      Math.abs(player.position - (before + 1)) < 1e-6,
      `继续后应从暂停处往后走，实际 ${player.position}，期望 ${before + 1}`,
    );
  } finally {
    player.stop();
  }
});

test("用户停止不触发 onEnded，自然播完才触发", async () => {
  const player = makePlayer();
  let ended = 0;
  player.onEnded = () => {
    ended += 1;
  };
  await player.load(makePiece({ totalSeconds: 1 }));
  await player.play(0);
  player.stop();
  assert.equal(ended, 0, "用户按停止不应算自然播完");

  await player.play(0);
  player.ctx.currentTime = 10; // 远超 totalSeconds + 尾音
  player.fill();
  assert.equal(ended, 1, "自然播完应触发一次 onEnded");
  assert.equal(player.playing, false, "播完后应停止调度");
});

test("onTick 在定时器路径上给出 horizon 与 total，抛错也不打断调度", async () => {
  const player = makePlayer();
  player.setLookahead(12);
  const seen = [];
  let threw = false;
  player.onTick = ({ horizon, musicNow, total }) => {
    seen.push({ window: horizon - musicNow, total });
    if (!threw) {
      threw = true;
      throw new Error("续写失败（模拟）");
    }
  };
  await player.load(makePiece());
  const originalError = console.error;
  console.error = () => {};
  try {
    await player.play(0);
    assert.equal(seen.length, 1, "play 之后应立即有一次调度机会");
    assert.ok(Math.abs(seen[0].window - 12) < 1e-9, "horizon 应等于 lookahead");
    assert.equal(seen[0].total, 40);

    player.ctx.currentTime = 1;
    player.fill(); // onTick 抛错被吞掉，调度循环不能因此中断
    assert.equal(seen.length, 2);
    assert.equal(player.playing, true, "续写失败不应导致停止播放");
  } finally {
    console.error = originalError;
    player.stop();
  }
});

test("时间线只能向后扩展", async () => {
  const player = makePlayer();
  await player.load(makePiece({ totalSeconds: 10 }));
  assert.throws(() => player.extend(makePiece({ totalSeconds: 5 })), /只能扩展/);
  player.extend(makePiece({ totalSeconds: 20 }));
  assert.equal(player.piece.totalSeconds, 20);
  assert.equal(player.events.length, 1, "扩展后事件流应换成新的");
});

test("未播放时的 fill 是空操作", () => {
  const player = makePlayer();
  player.fill();
  assert.equal(player.playing, false);
  assert.equal(player.timer, null);
});
