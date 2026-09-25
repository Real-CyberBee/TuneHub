// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 锁屏 / 后台播放桥接层。
 *
 * 浏览器不能凭空让一个移动端标签页在息屏后继续出声，能做的是给操作系统
 * **一个它认识的媒体会话**，并让 JS 调度在后台仍然可靠。这里做三件事：
 *
 *  1. **Media Session API**：把曲目信息交给系统，锁屏 / 通知栏 / 耳机线控的
 *     播放、暂停、进度按钮都回接到播放器。
 *  2. **静音保活音轨**：循环播放一段 1 秒的静音 WAV。它本身听不见，但让系统
 *     认为"这个页面正在放音频"，从而不冻结标签页、不挂起 AudioContext。
 *     必须在用户手势里启动（由播放按钮触发），否则会被自动播放策略拦下。
 *  3. **AudioContext 复原**：移动端在息屏 / 切换应用后会把 AudioContext 置为
 *     `suspended`，回到前台时自动 `resume()`，避免"回来了但没声音"。
 *
 * 已知平台差异（诚实交代，不假装万能）：
 *  - Android Chrome：息屏、切到别的 App 都能继续播放。
 *  - iOS Safari：Web Audio 在锁屏后是否继续由系统决定；静音保活音轨能显著提高
 *    存活率，但 iOS 仍可能在长时间锁屏后挂起 AudioContext，解锁后会自动恢复。
 *  - 桌面浏览器：标签页后台照常播放，锁屏按钮可用。
 */

const SILENT_SECONDS = 1;
const SILENT_SAMPLE_RATE = 8000;

/** 生成一段纯静音的 WAV，作为保活音轨（不引入任何二进制资源文件）。 */
function createSilentWavUrl() {
  const frames = SILENT_SECONDS * SILENT_SAMPLE_RATE;
  const bytes = 44 + frames * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SILENT_SAMPLE_RATE, true);
  view.setUint32(28, SILENT_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, frames * 2, true);
  // 采样区保持全 0 —— 真正的静音，不会有任何可听内容。
  return URL.createObjectURL(new Blob([view.buffer], { type: "audio/wav" }));
}

export class PlaybackSession {
  /**
   * @param {object} options
   * @param {() => (AudioContext|null)} options.getContext  取当前 AudioContext
   * @param {() => boolean} options.isPlaying               当前是否应当在播放
   */
  constructor({ getContext = () => null, isPlaying = () => false } = {}) {
    this.getContext = getContext;
    this.isPlaying = isPlaying;
    this.audio = null;
    this.audioUrl = null;
    this.bound = new Set();
    this.lastPositionUpdate = 0;
    this.resumeHooked = false;
  }

  get supported() {
    return typeof navigator !== "undefined" && "mediaSession" in navigator;
  }

  /** 把锁屏按钮接回播放器。未实现的动作会被浏览器忽略。 */
  bind(handlers = {}) {
    if (!this.supported) return;
    const actions = {
      play: handlers.onPlay,
      pause: handlers.onPause,
      stop: handlers.onStop,
      seekto: handlers.onSeek,
      seekbackward: handlers.onSeekBackward,
      seekforward: handlers.onSeekForward,
      nexttrack: handlers.onNext,
      previoustrack: handlers.onPrevious,
    };
    for (const [action, handler] of Object.entries(actions)) {
      if (typeof handler !== "function") continue;
      try {
        navigator.mediaSession.setActionHandler(action, handler);
        this.bound.add(action);
      } catch {
        // 该动作不被这个浏览器支持，跳过即可。
      }
    }
  }

  setMetadata({ title, artist = "TuneHub", album = "", artwork = [] } = {}) {
    if (!this.supported || typeof MediaMetadata === "undefined") return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork: artwork.map((icon) => ({ ...icon })),
      });
    } catch {}
  }

  setState(state) {
    if (!this.supported) return;
    try {
      navigator.mediaSession.playbackState = state;
    } catch {}
  }

  /** 给锁屏进度条喂位置；duration 非法时静默跳过（API 会抛错）。 */
  updatePosition(position, duration, rate = 1) {
    if (!this.supported || !navigator.mediaSession.setPositionState) return;
    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;
    const now = Date.now();
    if (now - this.lastPositionUpdate < 900) return;
    this.lastPositionUpdate = now;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: rate,
        position: Math.min(Math.max(position, 0), duration),
      });
    } catch {}
  }

  /** 启动保活音轨并进入 playing 状态。必须在用户手势里调用。 */
  async start() {
    this.setState("playing");
    if (this.audio) {
      if (this.audio.paused) {
        try {
          await this.audio.play();
        } catch {}
      }
      return;
    }
    try {
      const audio = document.createElement("audio");
      audio.loop = true;
      audio.preload = "auto";
      audio.setAttribute("playsinline", "");
      audio.setAttribute("aria-hidden", "true");
      audio.dataset.tunehubKeepAlive = "1";
      audio.style.cssText =
        "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
      this.audioUrl = createSilentWavUrl();
      audio.src = this.audioUrl;
      document.body.appendChild(audio);
      this.audio = audio;
      await audio.play();
    } catch {
      // 保活失败不影响正常发声，只是后台存活率下降。
      this.audio = null;
    }
  }

  /** 暂停：同时停下保活音轨，让系统收起媒体会话。 */
  pause() {
    this.setState("paused");
    if (this.audio && !this.audio.paused) {
      try {
        this.audio.pause();
      } catch {}
    }
  }

  stop() {
    this.setState("none");
    if (this.audio) {
      try {
        this.audio.pause();
      } catch {}
    }
  }

  /**
   * 监听 AudioContext 被系统挂起 / 页面回到前台，并自动恢复播放。
   * 只挂一次；页面切走再回来时不会重复绑定。
   */
  watchContext() {
    if (this.resumeHooked || typeof document === "undefined") return;
    this.resumeHooked = true;
    const tryResume = () => {
      if (!this.isPlaying()) return;
      const ctx = this.getContext();
      if (!ctx) return;
      if (ctx.state !== "running") ctx.resume().catch(() => {});
    };
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tryResume();
    });
    window.addEventListener("pageshow", tryResume);
    window.addEventListener("focus", tryResume);
  }
}

/** 播放页共用的锁屏封面（相对路径，子路径部署也成立）。 */
export const SESSION_ARTWORK = [
  { src: "./icons/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "./icons/icon-512.png", sizes: "512x512", type: "image/png" },
];
