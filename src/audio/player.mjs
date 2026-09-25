// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 实时播放器：前瞻调度 + 可跳转。
 *
 * 关键设计：**不使用 setTimeout 参与发声调度**（demo 的教训），
 * 而是用 requestAnimationFrame 做低帧率检查，把事件按音频时钟排进图里。
 * 这样实时与离线两条路径共用同一个 playNoteOn，行为一致。
 */

import { buildMasterBus, playNoteOn } from "./engine.mjs";

const LOOKAHEAD = 0.65; // 每次检查向前调度多少秒
const CHECK_MS = 80; // 检查间隔（仅用于决定"该调度了"，不作为时间基准）

export class Player {
  constructor() {
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
    // 噪声（混响 IR / 打击底噪）也由种子派生，保证实时与离线一致
    this.noiseSeed = "tunehub";
    this.mix = {};
    this.mixKey = "";
  }

  get supported() {
    return (
      typeof window !== "undefined" &&
      !!(window.AudioContext || window.webkitAudioContext)
    );
  }

  async init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });
    this.bus = buildMasterBus(this.ctx, { seed: this.noiseSeed, ...this.mix });
  }

  async resume() {
    await this.init();
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  /** 载入作品（不自动播放）。 */
  async load(piece) {
    this.piece = piece;
    this.events = piece.events;
    this.stop();
    const mix = piece.mix ?? {};
    const nextMixKey = JSON.stringify(mix);
    this.mix = mix;
    // 种子和场景空间感都决定总线。任一改变时重建，避免切场景后仍沿用上个场景的混响。
    if (
      this.ctx &&
      (this.noiseSeed !== piece.seed || this.mixKey !== nextMixKey)
    ) {
      this.noiseSeed = piece.seed;
      this.mixKey = nextMixKey;
      try {
        this.bus.master.disconnect();
      } catch {}
      this.bus = buildMasterBus(this.ctx, { seed: this.noiseSeed, ...mix });
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
    this.stop();

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

  stop() {
    this.playing = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 内部：把未来 LOOKAHEAD 秒内的事件排进音频图。 */
  _tick() {
    if (!this.playing || !this.ctx) return;
    const now = this.ctx.currentTime;
    const musicNow = this.offset + (now - this.startCtxTime);
    const horizon = musicNow + LOOKAHEAD;

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
      if (musicNow >= this.piece.totalSeconds + stillRinging) this.stop();
    }

    if (this.onProgress)
      this.onProgress(this.position, this.piece.totalSeconds);
  }
}
