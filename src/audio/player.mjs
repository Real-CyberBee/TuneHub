// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 实时播放器：前瞻调度 + 可跳转。
 *
 * 关键设计：**不使用 setTimeout 参与发声调度**（demo 的教训），
 * 而是用 setInterval 做低帧率检查，把事件按音频时钟排进图里。
 * 这样实时与离线两条路径共用同一个 playNoteOn，行为一致。
 *
 * 后台播放相关：
 *  - `lookahead` 可在页面隐藏时调大，让未来若干秒的音符提前排进音频图；
 *    移动端息屏后定时器会被节流，提前排好的音符不受影响。
 *  - `onTick` 让上层有机会在**定时器里**（而不是 requestAnimationFrame 里）
 *    续写无尽模式的下一段——rAF 在后台根本不跑。
 */

import { buildMasterBus, playNoteOn } from "./engine.mjs";

/** 前台：小前瞻，保证拖滑块后的重新生成足够跟手。 */
export const LOOKAHEAD_VISIBLE = 0.65;
/** 后台 / 息屏：大前瞻，扛住定时器节流。 */
export const LOOKAHEAD_HIDDEN = 25;
const CHECK_MS = 80; // 检查间隔（仅用于决定"该调度了"，不作为时间基准）

export class Player {
  constructor({ analyse = false } = {}) {
    this.ctx = null;
    this.bus = null;
    this.piece = null;
    this.events = [];
    this.startCtxTime = 0; // 音乐 0 秒对应的 ctx.currentTime
    this.offset = 0; // 本段音乐从作品的第几秒开始
    this.nextIdx = 0;
    this.timer = null;
    this.playing = false;
    this.muted = new Set();
    this.onProgress = null;
    this.onTick = null; // ({ musicNow, horizon, position, total }) => void
    this.onEnded = null; // 自然播完（不是用户 stop）时触发
    this.lookahead = LOOKAHEAD_VISIBLE;
    // 噪声（混响 IR / 打击底噪）也由种子派生，保证实时与离线一致
    this.noiseSeed = "tunehub";
    this.mix = {};
    this.mixKey = "";
    this.analyse = analyse;
  }

  get supported() {
    return (
      typeof window !== "undefined" &&
      !!(window.AudioContext || window.webkitAudioContext)
    );
  }

  /** 调整前瞻窗口（秒）。页面隐藏时调大，回到前台再调小。 */
  setLookahead(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.lookahead = seconds;
  }

  async init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });
    this.bus = buildMasterBus(this.ctx, {
      seed: this.noiseSeed,
      ...this.mix,
      analyse: this.analyse,
    });
  }

  async resume() {
    await this.init();
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  /** 载入作品（不自动播放）。 */
  async load(piece) {
    this.piece = piece;
    this.events = piece.events;
    this._halt();
    const mix = piece.mix ?? {};
    const nextMixKey = JSON.stringify(mix);
    const nextSeed = piece.seed ?? "tunehub";
    const busChanged = this.noiseSeed !== nextSeed || this.mixKey !== nextMixKey;
    this.noiseSeed = nextSeed;
    this.mix = mix;
    this.mixKey = nextMixKey;
    // 种子和场景空间感都决定总线。任一改变时重建，避免切场景后仍沿用上个场景的混响。
    if (this.ctx && busChanged) {
      try {
        this.bus.master.disconnect();
      } catch {}
      this.bus = buildMasterBus(this.ctx, {
        seed: this.noiseSeed,
        ...mix,
        analyse: this.analyse,
      });
    }
  }

  /**
   * 用一条更长的时间线替换当前作品，保留正在运行的音频时钟与已调度事件。
   * 氛围模式在片段结束前调用它，把下一段排进同一条时间线上，避免 stop/play
   * 带来的间隙。调用方必须只追加未来事件，不能改写已调度的前缀。
   */
  extend(piece) {
    if (!piece || !Array.isArray(piece.events) || !this.piece) return;
    if (piece.totalSeconds < this.piece.totalSeconds) {
      throw new Error("播放器只能扩展时间线，不能缩短当前作品");
    }
    this.piece = piece;
    this.events = piece.events;
  }

  setMuted(voiceId, muted) {
    if (muted) this.muted.add(voiceId);
    else this.muted.delete(voiceId);
  }

  /** 当前播放头在作品中的秒数。 */
  get position() {
    if (!this.ctx) return 0;
    if (!this.playing) return this.offset;
    return this.offset + (this.ctx.currentTime - this.startCtxTime);
  }

  async play(fromSeconds = null) {
    await this.resume();
    if (!this.events.length) return;
    const from = fromSeconds == null ? this.position : fromSeconds;
    this._halt();

    this.offset = Math.max(0, Math.min(from, this.piece.totalSeconds));
    this.startCtxTime = this.ctx.currentTime + 0.08; // 留一点余量，避免首音被吃掉
    this.nextIdx = 0;
    this.playing = true;

    // 跳过起点之前的事件
    while (
      this.nextIdx < this.events.length &&
      this.events[this.nextIdx].time < this.offset
    ) {
      this.nextIdx++;
    }

    this._tick();
    this.timer = setInterval(() => this._tick(), CHECK_MS);
  }

  /**
   * 暂停：记住当前播放头，停掉调度但不回到作品开头。
   * 锁屏上的「暂停 / 继续」走这条路径；界面上的「停止」仍然从 0 重新开始。
   */
  pause() {
    if (!this.playing) return;
    const at = this.position;
    this._halt();
    this.offset = Math.max(0, at);
  }

  stop() {
    this._halt();
  }

  /**
   * 立刻按当前前瞻窗口补排一次。
   * 页面刚转入后台时调用：趁定时器还没被节流，把后面几十秒先排进音频图。
   */
  fill() {
    this._tick();
  }

  /** 内部：只停调度，不触发 onEnded。 */
  _halt() {
    this.playing = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 内部：把未来 lookahead 秒内的事件排进音频图。 */
  _tick() {
    if (!this.playing || !this.ctx) return;
    const now = this.ctx.currentTime;
    const musicNow = this.offset + (now - this.startCtxTime);
    const horizon = musicNow + this.lookahead;

    while (this.nextIdx < this.events.length) {
      const e = this.events[this.nextIdx];
      if (e.time > horizon) break;
      this.nextIdx++;
      if (this.muted.has(e.voice)) continue;
      const startTime = this.startCtxTime + (e.time - this.offset);
      if (startTime < now - 0.05) continue; // 已经过去，丢弃
      playNoteOn(this.ctx, this.bus.input, { ...e, startTime }, this.noiseSeed);
    }

    // 结束检测
    if (musicNow >= this.piece.totalSeconds) {
      const stillRinging = this.muted.size >= 4 ? 0 : 2;
      if (musicNow >= this.piece.totalSeconds + stillRinging) {
        this._halt();
        if (this.onEnded) this.onEnded();
        return;
      }
    }

    // 上层的续写机会：在后台也照常触发（rAF 在后台是停的，不能用它续写）。
    // 续写失败不能打断调度循环——音还要继续响。
    if (this.onTick) {
      try {
        this.onTick({
          musicNow,
          horizon,
          position: this.position,
          total: this.piece.totalSeconds,
        });
      } catch (error) {
        console.error("[TuneHub] onTick 续写失败：", error);
      }
    }

    if (this.onProgress)
      this.onProgress(this.position, this.piece.totalSeconds);
  }
}
