// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 用真正的 `<audio>` 元素播放合成结果。
 *
 * 背景：安卓 Chrome 上，Web Audio 直连扬声器拿不到"媒体播放"待遇——息屏后被
 * 节流/冻结，一分钟左右就断。系统只认真正的媒体元素，所以我们把合成结果
 * 离线渲染 + 编码成 Opus/WebM，再通过 MediaSource 喂给 `<audio>`。
 *
 * 这一层只做"什么时候渲染下一片、怎么喂进 MediaSource、怎么和内核时间轴对齐"：
 *   · 媒体时间轴 == 音乐时间轴，所以 position / 跳转都不用换算；
 *   · 始终把缓冲保持在播放头前方 AHEAD_TARGET 秒；
 *   · 分片长度由短到长，第一片短是为了尽快出声。
 *
 * 探测不通过时（没有 WebCodecs、没有 MSE、不是 Chrome 系）自动退回原来的
 * 实时 Web Audio 实现，所以调用方拿到的永远是同一套接口。
 *
 * 接口与 `Player` 保持一致：play/pause/stop/load/extend/setMuted/position/
 * playing/supported/ctx/bus/setLookahead/fill/onTick/onProgress/onEnded。
 */

import { Player } from "./player.mjs";
import { detectStreamSupport, StreamPipeline, STREAM_MIME } from "./stream-pipeline.mjs";

/** 第一片：短一点，先把声音放出来，剩下的边放边补。 */
const SLICE_FIRST = 4;
/** 之后的片长上限。 */
const SLICE_MAX = 16;
/** 播放头前方要始终保持的缓冲秒数。 */
const AHEAD_TARGET = 45;
/** 起播前至少先攒这么多秒，避免刚响就卡。 */
const AHEAD_START = 2.5;
/** 心跳间隔（喂给 onTick / onProgress，无尽模式靠它续写）。 */
const TICK_MS = 500;

function waitForEvent(target, type, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const done = () => {
      target.removeEventListener(type, onOk);
      target.removeEventListener("error", onErr);
      if (timer) clearTimeout(timer);
      resolve();
    };
    const onOk = () => done();
    const onErr = () => {
      target.removeEventListener(type, onOk);
      target.removeEventListener("error", onErr);
      if (timer) clearTimeout(timer);
      reject(new Error(`${type} 之前出现错误`));
    };
    target.addEventListener(type, onOk, { once: true });
    target.addEventListener("error", onErr, { once: true });
    if (timeoutMs > 0) timer = setTimeout(done, timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// 流式实现
// ---------------------------------------------------------------------------

class StreamEngine {
  constructor({ analyse = false } = {}) {
    this.analyse = analyse;
    this.audio = null;
    this.objectUrl = null;
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.pipeline = null;

    this.piece = null;
    this.events = [];
    this.mix = {};
    this.seed = "tunehub";
    this.muted = new Set();

    this.playing = false;
    this.dirty = true;
    this.streamOpen = false;
    this.ending = false;
    this.nextStart = 0;
    this.sliceSeconds = SLICE_FIRST;
    this.pendingPosition = 0;

    this.generation = 0;
    this.producing = false;
    this.appendChain = Promise.resolve();
    this.queuedBytes = 0;

    this.ticker = null;
    this.pumpTimer = null;
    this.failure = null;

    this.shadow = null;
    this.shadowGain = null;

    this.onEnded = null;
    this.onTick = null;
    this.onProgress = null;
    this.onError = null;
  }

  get kind() {
    return "stream";
  }

  get supported() {
    return true;
  }

  /** 可视化支路：静音跑一遍实时合成，只取频谱，不出声。 */
  async #ensureShadow() {
    if (!this.analyse || this.shadow) return;
    const shadow = new Player({ analyse: true });
    await shadow.init();
    const gain = shadow.ctx.createGain();
    gain.gain.value = 0;
    // analyser 在 buildMasterBus 里是接去 destination 的，这里改道到 0 增益，
    // 这样既有频谱又不会和 <audio> 重复出声。
    try {
      shadow.bus.analyser.disconnect();
    } catch {}
    shadow.bus.analyser.connect(gain);
    gain.connect(shadow.ctx.destination);
    this.shadow = shadow;
    this.shadowGain = gain;
  }

  get ctx() {
    return this.shadow ? this.shadow.ctx : null;
  }

  get bus() {
    return this.shadow ? this.shadow.bus : null;
  }

  get position() {
    if (this.streamOpen && this.audio && Number.isFinite(this.audio.currentTime)) {
      return this.audio.currentTime;
    }
    return this.pendingPosition;
  }

  get bufferedAhead() {
    const sb = this.sourceBuffer;
    if (!sb || !sb.buffered || !sb.buffered.length) return 0;
    const end = sb.buffered.end(sb.buffered.length - 1);
    return Math.max(0, end - this.position);
  }

  #ensureElement() {
    if (this.audio) return this.audio;
    const audio = document.createElement("audio");
    audio.setAttribute("playsinline", "");
    audio.preload = "auto";
    audio.dataset.tunehubOutput = "1";
    // 放在文档里但不参与布局：某些移动端浏览器会暂停"脱离文档"的媒体元素。
    audio.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    audio.addEventListener("timeupdate", () => this.#tick());
    audio.addEventListener("play", () => {
      this.playing = true;
    });
    audio.addEventListener("pause", () => {
      this.playing = false;
    });
    audio.addEventListener("ended", () => {
      this.playing = false;
      this.#stopTicker();
      if (this.onEnded) this.onEnded();
    });
    audio.addEventListener("error", () => {
      this.#fail(new Error("媒体元素播放出错"));
    });
    document.body.appendChild(audio);
    this.audio = audio;
    return audio;
  }

  #visibleEvents() {
    if (!this.muted.size) return this.events;
    return this.events.filter((event) => !this.muted.has(event.voice));
  }

  // --- 生命周期 ---------------------------------------------------------

  async load(piece) {
    this.piece = piece;
    this.events = piece.events ?? [];
    this.mix = piece.mix ?? {};
    this.seed = piece.seed ?? "tunehub";
    this.dirty = true;
    if (this.playing) this.#halt();
    if (this.shadow) await this.shadow.load(piece);
  }

  extend(piece) {
    if (!piece || !Array.isArray(piece.events) || !this.piece) return;
    if (piece.totalSeconds < this.piece.totalSeconds) {
      throw new Error("播放器只能扩展时间线，不能缩短当前作品");
    }
    this.piece = piece;
    this.events = piece.events;
    this.mix = piece.mix ?? this.mix;
    this.seed = piece.seed ?? this.seed;
    if (this.shadow) this.shadow.extend(piece);
  }

  setMuted(voiceId, muted) {
    const before = this.muted.has(voiceId);
    if (muted) this.muted.add(voiceId);
    else this.muted.delete(voiceId);
    if (this.shadow) this.shadow.setMuted(voiceId, muted);
    // 已经渲染好的缓冲改不了，只能从当前位置重开一条流。
    if (before !== muted && this.playing) this.#restartAt(this.position);
  }

  setLookahead() {
    /* 流式链路不需要前瞻窗口，保留接口只为兼容。 */
  }

  fill() {
    this.#pumpSoon(0);
  }

  async resume() {
    await this.#ensureShadow();
    if (this.shadow) await this.shadow.resume();
  }

  async play(fromSeconds = null) {
    await this.#ensureShadow();
    const target = fromSeconds == null
      ? (this.dirty || !this.streamOpen ? 0 : this.position)
      : Math.max(0, fromSeconds);

    if (this.streamOpen && !this.dirty && this.#inBuffered(target)) {
      // 目标点已经在缓冲里：直接跳，不重开流。
      this.pendingPosition = target;
      this.audio.currentTime = target;
      await this.#startElement();
    } else {
      await this.#openStream(target);
    }

    this.playing = true;
    this.#startTicker();
    this.#pumpSoon(0);
    if (this.shadow) {
      await this.shadow.play(this.position);
    }
  }

  pause() {
    const at = this.position;
    if (this.audio && !this.audio.paused) this.audio.pause();
    this.playing = false;
    this.pendingPosition = at;
    this.#stopTicker();
    if (this.shadow) this.shadow.pause();
  }

  stop() {
    this.#halt();
    this.#teardownStream();
    this.pendingPosition = 0;
    if (this.audio) {
      try {
        this.audio.removeAttribute("src");
        this.audio.load();
      } catch {}
    }
    if (this.shadow) this.shadow.stop();
  }

  #halt() {
    this.playing = false;
    this.#stopTicker();
    if (this.audio && !this.audio.paused) {
      try {
        this.audio.pause();
      } catch {}
    }
    if (this.pumpTimer) {
      clearTimeout(this.pumpTimer);
      this.pumpTimer = null;
    }
  }

  #inBuffered(seconds) {
    const sb = this.sourceBuffer;
    if (!sb || !sb.buffered.length) return false;
    for (let i = 0; i < sb.buffered.length; i++) {
      if (seconds >= sb.buffered.start(i) && seconds < sb.buffered.end(i) - 0.35) return true;
    }
    return false;
  }

  #startElement() {
    const audio = this.#ensureElement();
    if (!audio.paused) return Promise.resolve();
    return audio.play().catch((error) => {
      if (error && error.name === "AbortError") return;
      throw error;
    });
  }

  #restartAt(seconds) {
    const at = Math.max(0, seconds);
    this.#openStream(at).catch((error) => this.#fail(error));
  }

  // --- 打开一条新流 -----------------------------------------------------

  async #openStream(startAt) {
    const gen = ++this.generation;
    this.#teardownStream();
    const audio = this.#ensureElement();

    const mediaSource = new MediaSource();
    this.mediaSource = mediaSource;
    this.objectUrl = URL.createObjectURL(mediaSource);
    audio.src = this.objectUrl;
    this.pendingPosition = startAt;
    this.nextStart = startAt;
    this.sliceSeconds = SLICE_FIRST;
    this.ending = false;
    this.failure = null;

    // 用户手势的"瞬时激活"只有几秒，等渲染完再 play() 可能就被拒了。
    // 所以先把 play() 发出去——此时还没有数据，它会一直挂着，等第一片到了自然开声。
    const started = audio.play().catch((error) => {
      if (error && error.name === "AbortError") return;
      throw error;
    });

    await new Promise((resolve) => {
      if (mediaSource.readyState === "open") return resolve();
      mediaSource.addEventListener("sourceopen", resolve, { once: true });
    });
    if (gen !== this.generation) return;

    this.sourceBuffer = mediaSource.addSourceBuffer(STREAM_MIME);
    this.sourceBuffer.mode = "segments";
    this.sourceBuffer.addEventListener("error", () => this.#fail(new Error("SourceBuffer 出错")));

    this.pipeline = new StreamPipeline({
      onInit: (bytes) => this.#enqueue(bytes),
      onSegment: (bytes) => this.#enqueue(bytes),
      onError: (error) => this.#fail(error),
    });

    this.streamOpen = true;
    this.dirty = false;

    // 先把头几片做出来，让 play() 有条件兑现。编码器不再逐片 flush，帧是异步
    // 吐出来的，所以这里轮询等缓冲真的到位，而不是假设 produce() 返回就写完了。
    const deadline = Date.now() + 6000;
    let produced = 0;
    while (gen === this.generation && this.streamOpen) {
      await this.#produceOne(gen);
      produced += 1;
      await this.appendChain;
      if (this.bufferedAhead >= AHEAD_START) break;
      const pieceEnd = this.piece ? this.piece.totalSeconds : 0;
      if (this.nextStart >= pieceEnd - 0.02) break;
      if (produced >= 6 || Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    // MSE 的时间轴从 startAt 开始，播放头要对齐过去（跳转时尤其重要）。
    if (startAt > 0 && audio.currentTime < startAt - 0.05) {
      try {
        audio.currentTime = startAt;
      } catch {}
    }
    await started;
  }

  #teardownStream() {
    this.streamOpen = false;
    if (this.pipeline) {
      this.pipeline.close().catch(() => {});
      this.pipeline = null;
    }
    const sb = this.sourceBuffer;
    if (sb) {
      try {
        sb.abort();
      } catch {}
    }
    this.sourceBuffer = null;
    this.mediaSource = null;
    if (this.objectUrl) {
      const url = this.objectUrl;
      this.objectUrl = null;
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }

  // --- 生产与喂数据 -----------------------------------------------------

  #nextSlice() {
    const pieceEnd = this.piece ? this.piece.totalSeconds : 0;
    const remaining = pieceEnd - this.nextStart;
    const want = this.sliceSeconds;
    return Math.max(0.5, Math.min(want, remaining));
  }

  async #produceOne(gen) {
    if (!this.pipeline || !this.streamOpen) return;
    if (gen !== undefined && gen !== this.generation) return;
    const pieceEnd = this.piece ? this.piece.totalSeconds : 0;
    if (this.nextStart >= pieceEnd - 0.02) return;
    const duration = this.#nextSlice();
    const events = this.#visibleEvents();
    const next = await this.pipeline.produce({
      events,
      mix: this.mix,
      seed: this.seed,
      start: this.nextStart,
      duration,
    });
    if (gen !== undefined && gen !== this.generation) return;
    this.nextStart = next;
    // 逐片变长，减少边界数量；到上限为止。
    this.sliceSeconds = Math.min(SLICE_MAX, this.sliceSeconds + 4);
  }

  #enqueue(bytes) {
    if (!bytes || !bytes.length) return;
    this.queuedBytes += bytes.length;
    const gen = this.generation;
    this.appendChain = this.appendChain
      .then(() => this.#appendNow(bytes, gen))
      .catch((error) => this.#fail(error))
      .finally(() => {
        this.queuedBytes -= bytes.length;
      });
  }

  async #appendNow(bytes, gen) {
    if (gen !== this.generation) return;
    const sb = this.sourceBuffer;
    if (!sb || !this.mediaSource || this.mediaSource.readyState !== "open") return;
    if (sb.updating) await waitForEvent(sb, "updateend");
    try {
      sb.appendBuffer(bytes);
      await waitForEvent(sb, "updateend");
    } catch (error) {
      if (!error || error.name !== "QuotaExceededError") throw error;
      // 缓冲满了：丢掉已经放过的部分再试一次。
      const keepFrom = Math.max(0, this.position - 8);
      try {
        if (sb.updating) await waitForEvent(sb, "updateend");
        sb.remove(0, keepFrom);
        await waitForEvent(sb, "updateend");
      } catch {}
      if (sb.updating) await waitForEvent(sb, "updateend");
      sb.appendBuffer(bytes);
      await waitForEvent(sb, "updateend");
    }
  }

  #pumpSoon(delay = 120) {
    if (this.pumpTimer || !this.streamOpen) return;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      this.#pump();
    }, delay);
  }

  async #pump() {
    if (this.producing || !this.streamOpen) return;
    this.producing = true;
    const gen = this.generation;
    try {
      while (
        this.streamOpen &&
        gen === this.generation &&
        this.bufferedAhead + this.queuedBytes / 12000 < AHEAD_TARGET
      ) {
        const pieceEnd = this.piece ? this.piece.totalSeconds : 0;
        if (this.nextStart >= pieceEnd - 0.02) {
          await this.#maybeEnd(gen);
          break;
        }
        await this.#produceOne(gen);
        // 让出主线程，别把 UI 卡住。
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      this.#fail(error);
    } finally {
      this.producing = false;
    }
  }

  /** 作品排完了：先给上层一次续写机会，再决定收尾。 */
  async #maybeEnd(gen) {
    if (this.ending) return;
    this.ending = true;
    if (this.onTick) this.onTick(this.#tickPayload(true));
    await new Promise((resolve) => setTimeout(resolve, 220));
    if (gen !== this.generation) return;
    const pieceEnd = this.piece ? this.piece.totalSeconds : 0;
    if (this.nextStart < pieceEnd - 0.02) {
      this.ending = false;
      this.#pumpSoon(0);
      return;
    }
    if (this.mediaSource && this.mediaSource.readyState === "open") {
      try {
        this.mediaSource.endOfStream();
      } catch {}
    }
  }

  // --- 心跳 -------------------------------------------------------------

  #tickPayload(force = false) {
    const position = this.position;
    const total = this.piece ? this.piece.totalSeconds : 0;
    const ahead = this.bufferedAhead;
    return {
      musicNow: position,
      horizon: position + (force ? AHEAD_TARGET + 20 : ahead + 15),
      position,
      total,
      bufferedAhead: ahead,
    };
  }

  #tick() {
    if (!this.playing) return;
    // 播放头往前走会吃掉缓冲，所以每次心跳都要把后方补回来。
    // 心跳同时挂在 timeupdate 和定时器上：前者由媒体播放驱动，后台不会被节流。
    this.#pumpSoon(0);
    if (this.onTick) {
      try {
        this.onTick(this.#tickPayload());
      } catch (error) {
        console.error("[TuneHub] onTick 续写失败：", error);
      }
    }
    if (this.onProgress) this.onProgress(this.position, this.piece ? this.piece.totalSeconds : 0);
    if (this.shadow && this.shadow.playing) this.shadow.fill();
  }

  #startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.#tick(), TICK_MS);
  }

  #stopTicker() {
    if (!this.ticker) return;
    clearInterval(this.ticker);
    this.ticker = null;
  }

  #fail(error) {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    if (this.failure) return;
    this.failure = wrapped;
    console.error("[TuneHub] 流式播放失败：", wrapped);
    if (this.onError) this.onError(wrapped);
  }

  async destroy() {
    this.#halt();
    this.#teardownStream();
    if (this.shadow) {
      this.shadow.stop();
      try {
        await this.shadow.ctx?.close();
      } catch {}
      this.shadow = null;
    }
    if (this.audio) {
      this.audio.remove();
      this.audio = null;
    }
  }
}

// ---------------------------------------------------------------------------
// 门面：探测失败自动退回实时 Web Audio
// ---------------------------------------------------------------------------

/**
 * 对外只暴露这一个类。构造之后调用 `ready()` 会完成能力探测并选定实现，
 * 但即使不 await，所有方法内部也会先等探测结束，所以调用顺序无所谓。
 */
export class MediaPlayer {
  constructor({ analyse = false } = {}) {
    this.analyse = analyse;
    this.mode = "pending";
    this.reason = null;
    this.impl = null;
    this.onEnded = null;
    this.onTick = null;
    this.onProgress = null;
    this.onError = null;
    this.readyPromise = this.#init();
    this.readyPromise.catch(() => {});
  }

  async #init() {
    let support = { ok: false, reason: "unknown" };
    try {
      support = await detectStreamSupport();
    } catch (error) {
      support = { ok: false, reason: String(error && error.message) };
    }
    if (support.ok) {
      this.impl = new StreamEngine({ analyse: this.analyse });
      this.mode = "stream";
    } else {
      this.impl = new Player({ analyse: this.analyse });
      this.mode = "realtime";
      this.reason = support.reason;
    }
    const impl = this.impl;
    impl.onEnded = (...args) => this.onEnded && this.onEnded(...args);
    impl.onTick = (...args) => this.onTick && this.onTick(...args);
    impl.onProgress = (...args) => this.onProgress && this.onProgress(...args);
    if (this.onError) impl.onError = (error) => this.onError(error);
    return this.mode;
  }

  /** 等探测结束；返回实际采用的模式（"stream" / "realtime"）。 */
  ready() {
    return this.readyPromise;
  }

  get supported() {
    if (this.impl) return this.impl.supported;
    // 还没探测完：先给一个同步的乐观判断，探测完会以 impl 为准。
    return typeof window !== "undefined" && !!window.MediaSource && typeof AudioEncoder !== "undefined";
  }

  get playing() {
    return this.impl ? this.impl.playing : false;
  }

  get position() {
    return this.impl ? this.impl.position : 0;
  }

  /** 播放头前方已经缓冲好的秒数；界面可以拿它显示"边放边合成"的进度。 */
  get bufferedAhead() {
    return this.impl && this.impl.bufferedAhead ? this.impl.bufferedAhead : 0;
  }

  get ctx() {
    return this.impl ? this.impl.ctx : null;
  }

  get bus() {
    return this.impl ? this.impl.bus : null;
  }

  async load(piece) {
    await this.readyPromise;
    return this.impl.load(piece);
  }

  async extend(piece) {
    await this.readyPromise;
    return this.impl.extend(piece);
  }

  async setMuted(voiceId, muted) {
    await this.readyPromise;
    return this.impl.setMuted(voiceId, muted);
  }

  async setLookahead(seconds) {
    await this.readyPromise;
    return this.impl.setLookahead(seconds);
  }

  async fill() {
    await this.readyPromise;
    return this.impl.fill();
  }

  async resume() {
    await this.readyPromise;
    return this.impl.resume();
  }

  async play(fromSeconds = null) {
    await this.readyPromise;
    return this.impl.play(fromSeconds);
  }

  async pause() {
    await this.readyPromise;
    return this.impl.pause();
  }

  async stop() {
    await this.readyPromise;
    return this.impl.stop();
  }

  async destroy() {
    await this.readyPromise;
    return this.impl.destroy ? this.impl.destroy() : undefined;
  }
}
