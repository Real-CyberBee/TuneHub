// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * TuneHub 界面。
 *
 * 这个文件只做三件事：把内核的事件流画出来、把用户的点击翻译成配置变化、驱动播放器。
 * 它**不包含任何音乐生成逻辑**——那是 src/core 的职责。
 */

import { VOICES, DEFAULT_CONFIG } from "../core/generate.mjs";
import { SCALES } from "../core/model.mjs";
import { newSeedString, isSeedStringValid } from "../core/rng.mjs";
import {
  AMBIENT_SCENES,
  ambientConfig,
  appendAmbientSegment,
  generateAmbientSegment,
  getAmbientScene,
} from "../core/ambient.mjs";
import { Player } from "../audio/player.mjs";
import {
  exportWav,
  exportStems,
  renderRange,
  encodeWav,
} from "../audio/export.mjs";
import { exportMidi, exportScoreJson } from "../audio/midi.mjs";

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

const state = {
  seed: "k7f3q9",
  ambientId: "reading",
  config: { ...DEFAULT_CONFIG, ...ambientConfig("reading") },
  overrides: {},
  locked: new Set(),
  muted: new Set(),
  piece: null,
  endless: false,
  nextSegmentIndex: 1,
  sceneAdjusted: false,
  busy: false,
};

const player = new Player();

// ---------------------------------------------------------------------------
// URL 序列化（种子 + 配置 + 声部覆盖 = 作品的全部）
// ---------------------------------------------------------------------------

function encodeState() {
  const p = new URLSearchParams();
  p.set("s", state.seed);
  p.set("a", state.ambientId);
  p.set("m", state.config.mood.toFixed(2));
  p.set("e", state.config.energy.toFixed(2));
  p.set("b", String(state.config.bpm));
  p.set("sc", state.config.scaleId);
  const ov = Object.entries(state.overrides);
  if (ov.length) p.set("o", ov.map(([k, v]) => `${k}:${v}`).join(","));
  if (state.locked.size) p.set("l", [...state.locked].join(","));
  if (state.endless) p.set("x", "1");
  return p.toString();
}

function decodeState() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return false;
  const p = new URLSearchParams(raw);
  const s = p.get("s");
  if (!s || !isSeedStringValid(s)) return false;
  state.seed = s;
  if (p.get("a")) {
    const scene = getAmbientScene(p.get("a"));
    state.ambientId = scene.id;
    state.config = { ...DEFAULT_CONFIG, ...ambientConfig(scene.id) };
  }
  if (p.get("m")) state.config.mood = clamp01(parseFloat(p.get("m")));
  if (p.get("e")) state.config.energy = clamp01(parseFloat(p.get("e")));
  if (p.get("b"))
    state.config.bpm = Math.min(
      168,
      Math.max(56, parseInt(p.get("b"), 10) || 92),
    );
  if (p.get("sc") && SCALES[p.get("sc")]) state.config.scaleId = p.get("sc");
  if (p.get("o")) {
    for (const pair of p.get("o").split(",")) {
      const [k, v] = pair.split(":");
      if (k && v) state.overrides[k] = v;
    }
  }
  if (p.get("l")) {
    for (const k of p.get("l").split(",")) if (VOICES[k]) state.locked.add(k);
  }
  state.endless = p.get("x") === "1";
  return true;
}

function clamp01(x) {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5;
}

function syncUrl() {
  history.replaceState(null, "", `#${encodeState()}`);
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

async function regenerate({ newSeed = false, reroll = null } = {}) {
  if (newSeed) {
    state.seed = newSeedString();
    state.overrides = {};
  }
  if (reroll) {
    // 只给未被锁定的声部换种子——这就是"锁 + 重掷"。
    // 用 crypto 取熵（用户要的是"新的"），生成后即固定，之后一切确定性派生。
    for (const id of Object.keys(VOICES)) {
      if (state.locked.has(id)) continue;
      if (reroll !== "all" && reroll !== id) continue;
      state.overrides[id] = newSeedString(5);
    }
  }

  state.nextSegmentIndex = 1;
  state.piece = generateAmbientSegment({
    seed: state.seed,
    sceneId: state.ambientId,
    config: state.config,
    overrides: state.overrides,
  });
  await player.load(state.piece);
  for (const id of Object.keys(VOICES))
    player.setMuted(id, state.muted.has(id));

  syncUrl();
  renderStatic();
  draw();
}

// ---------------------------------------------------------------------------
// 画布
// ---------------------------------------------------------------------------

const viz = document.getElementById("viz");
const vctx = viz.getContext("2d");
let W = 0,
  H = 0;

function resizeCanvas() {
  const rect = viz.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  viz.width = Math.max(1, rect.width * dpr);
  viz.height = Math.max(1, rect.height * dpr);
  W = rect.width;
  H = rect.height;
  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const VOICE_ORDER = ["bass", "harmony", "melody", "perc"];
const VOICE_COLOR = {
  bass: "#6b7fd7",
  harmony: "#4ecdc4",
  melody: "#ffd166",
  perc: "#ff6b6b",
};

function draw() {
  if (!state.piece) return;
  const piece = state.piece;
  vctx.clearRect(0, 0, W, H);
  vctx.fillStyle = "#0f111a";
  vctx.fillRect(0, 0, W, H);

  const padL = 34,
    padR = 10,
    padT = 12,
    padB = 26;
  const innerW = Math.max(10, W - padL - padR);
  const innerH = Math.max(10, H - padT - padB);
  const rowH = innerH / VOICE_ORDER.length;
  const total = piece.totalSeconds || 1;
  const xOf = (t) => padL + (t / total) * innerW;

  // 声部泳道 + 段落分隔
  VOICE_ORDER.forEach((id, i) => {
    const y = padT + i * rowH;
    if (i % 2 === 0) {
      vctx.fillStyle = "rgba(255,255,255,0.018)";
      vctx.fillRect(padL, y, innerW, rowH);
    }
    vctx.fillStyle = "rgba(255,255,255,0.30)";
    vctx.font = "10px -apple-system, sans-serif";
    vctx.textAlign = "left";
    vctx.textBaseline = "middle";
    vctx.fillText(VOICES[id].label, 6, y + rowH / 2);
  });

  // 段落边界与名称
  let acc = 0;
  const barSec = piece.barSeconds;
  vctx.textAlign = "center";
  for (const s of piece.config.sections) {
    const x0 = xOf(acc * barSec);
    const x1 = xOf((acc + s.bars) * barSec);
    acc += s.bars;
    vctx.strokeStyle = "rgba(255,255,255,0.055)";
    vctx.beginPath();
    vctx.moveTo(x1, padT);
    vctx.lineTo(x1, padT + innerH);
    vctx.stroke();
    vctx.fillStyle = "rgba(255,255,255,0.20)";
    vctx.font = "9px -apple-system, sans-serif";
    vctx.fillText(s.name, (x0 + x1) / 2, H - 12);
  }

  // 音符
  for (const e of piece.events) {
    const row = VOICE_ORDER.indexOf(e.voice);
    if (row < 0) continue;
    const y = padT + row * rowH;
    const muted = state.muted.has(e.voice);
    const alpha = muted ? 0.1 : 0.9;

    if (e.voice === "perc") {
      vctx.globalAlpha = alpha * 0.8;
      vctx.fillStyle = VOICE_COLOR.perc;
      const step = e.timbre === "kick" ? 2.5 : e.timbre === "snare" ? 2 : 1.4;
      const yOff =
        e.timbre === "kick"
          ? 0.62
          : e.timbre === "snare"
            ? 0.42
            : e.timbre === "clap"
              ? 0.3
              : 0.16;
      vctx.fillRect(
        xOf(e.time) - step / 2,
        y + rowH * yOff - step / 2,
        step,
        step,
      );
    } else {
      const v = VOICES[e.voice];
      const norm = (e.midi - v.low) / Math.max(1, v.high - v.low);
      const cy = y + rowH * (0.82 - norm * 0.64);
      const w = Math.max(2.5, xOf(e.time + e.duration) - xOf(e.time) - 1);
      const h = 3.6;
      vctx.globalAlpha = alpha * (0.35 + 0.65 * e.velocity);
      vctx.fillStyle = VOICE_COLOR[e.voice];
      roundRect(vctx, xOf(e.time), cy - h / 2, w, h, 1.8);
      vctx.fill();
    }
  }
  vctx.globalAlpha = 1;

  // 播放头
  if (player.playing) {
    const px = xOf(player.position);
    vctx.strokeStyle = "rgba(255,209,102,0.85)";
    vctx.lineWidth = 1;
    vctx.beginPath();
    vctx.moveTo(px, padT);
    vctx.lineTo(px, padT + innerH);
    vctx.stroke();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// 界面渲染
// ---------------------------------------------------------------------------

function renderStatic() {
  const piece = state.piece;
  document.getElementById("seedLabel").textContent = `种子 ${piece.seed}`;
  const s = piece.stats;
  const verdictLabel =
    { good: "悦耳", fair: "尚可", poor: "欠佳" }[s.verdict] ?? "";
  const durationLabel = state.endless
    ? `∞ 无尽 · 已预排 ${piece.ambient?.segmentCount ?? 1} 段`
    : `${Math.round(piece.totalSeconds)} 秒`;
  document.getElementById("statLabel").textContent =
    `${durationLabel} · ${piece.events.length} 音符 · ${piece.scaleName} · ${verdictLabel} ${(s.pleasantness * 100).toFixed(0)}%`;

  // 声部控件
  const voicesEl = document.getElementById("voices");
  voicesEl.innerHTML = "";
  for (const id of VOICE_ORDER) {
    const v = VOICES[id];
    const el = document.createElement("div");
    el.className =
      "voice" +
      (state.muted.has(id) ? " muted" : "") +
      (state.locked.has(id) ? " locked" : "");
    el.style.setProperty("--vc", VOICE_COLOR[id]);
    el.innerHTML = `<span class="vdot"></span><span class="vname">${v.label}</span>
      <span class="vlock">${state.locked.has(id) ? "🔒 锁定" : "静音"}</span>`;
    el.querySelector(".vname").addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleMute(id);
    });
    el.querySelector(".vdot").addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleMute(id);
    });
    el.querySelector(".vlock").addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleLock(id);
    });
    voicesEl.appendChild(el);
  }

  document.querySelectorAll(".scene").forEach((b) => {
    b.classList.toggle("active", b.dataset.id === state.ambientId);
  });
  const scene = getAmbientScene(state.ambientId);
  document.getElementById("sceneStatus").textContent = state.sceneAdjusted
    ? `${scene.name} · 已微调`
    : scene.tagline;
  const endlessBtn = document.getElementById("endlessBtn");
  endlessBtn.classList.toggle("active", state.endless);
  endlessBtn.setAttribute("aria-pressed", String(state.endless));
  endlessBtn.textContent = state.endless ? "∞ 无尽模式：开" : "∞ 无尽模式";
}

function renderScenes() {
  const el = document.getElementById("scenes");
  el.innerHTML = "";
  for (const scene of AMBIENT_SCENES) {
    const b = document.createElement("button");
    b.className = "scene";
    b.dataset.id = scene.id;
    b.innerHTML = `<span class="scene-icon">${scene.icon}</span><span class="scene-copy"><b>${scene.name}</b><small>${scene.tags.join(" · ")}</small></span>`;
    b.setAttribute("aria-label", `${scene.name}：${scene.tagline}`);
    b.addEventListener("click", () => {
      applyScene(scene).catch((err) =>
        setHint(`切换场景失败：${err.message}`, "warn"),
      );
    });
    el.appendChild(b);
  }
}

async function applyScene(scene) {
  const wasPlaying = player.playing;
  state.ambientId = scene.id;
  state.config = { ...DEFAULT_CONFIG, ...ambientConfig(scene.id) };
  state.overrides = {};
  state.sceneAdjusted = false;
  syncSliderValues();
  await regenerate();
  if (wasPlaying) await player.play(0);
  setHint(
    `已切到「${scene.name}」：${scene.tagline}${state.endless ? " 无尽模式会持续编排新的片段。" : ""}`,
    "good",
  );
}

function syncSliderValues() {
  document.getElementById("mood").value = String(state.config.mood);
  document.getElementById("energy").value = String(state.config.energy);
  document.getElementById("bpm").value = String(state.config.bpm);
}

function toggleMute(id) {
  if (state.muted.has(id)) state.muted.delete(id);
  else state.muted.add(id);
  player.setMuted(id, state.muted.has(id));
  renderStatic();
  draw();
}

function toggleLock(id) {
  if (state.locked.has(id)) state.locked.delete(id);
  else state.locked.add(id);
  syncUrl();
  renderStatic();
}

/** 在当前片段剩余一小段时预接下一段；生成是同步纯函数，所以可在动画帧安全执行。 */
function keepEndlessBuffer() {
  if (!state.endless || !player.playing || !state.piece) return;
  const remaining = state.piece.totalSeconds - player.position;
  if (remaining > 12) return;
  const segment = generateAmbientSegment({
    seed: state.seed,
    sceneId: state.ambientId,
    segmentIndex: state.nextSegmentIndex++,
    config: state.config,
    overrides: state.overrides,
  });
  state.piece = appendAmbientSegment(state.piece, segment);
  player.extend(state.piece);
  setHint(
    `无尽模式已续写第 ${state.piece.ambient.segmentCount} 段：${getAmbientScene(state.ambientId).name}仍在延展。`,
    "good",
  );
}

function setHint(msg, cls = "") {
  const el = document.getElementById("hint");
  el.textContent = msg;
  el.className = "hint" + (cls ? " " + cls : "");
}

// ---------------------------------------------------------------------------
// 播放控制
// ---------------------------------------------------------------------------

async function togglePlay() {
  const btn = document.getElementById("playBtn");
  if (!player.supported) {
    setHint("此浏览器不支持 Web Audio API，无法播放。", "warn");
    return;
  }
  if (player.playing) {
    player.stop();
    btn.textContent = "▶ 播放";
    draw();
    return;
  }
  try {
    setHint("正在启动音频…");
    await player.play(0);
    btn.textContent = "⏸ 停止";
    setHint("正在播放。拖动滑块会立刻重新生成。");
  } catch (err) {
    setHint(`播放失败：${err.message}`, "warn");
  }
}

function animate() {
  if (player.playing) {
    keepEndlessBuffer();
    draw();
    if (player.position >= (state.piece?.totalSeconds ?? 0)) {
      player.stop();
      document.getElementById("playBtn").textContent = "▶ 播放";
    }
  }
  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

async function doExport() {
  const btn = document.getElementById("exportBtn");
  if (state.busy) return;
  state.busy = true;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "渲染中…";
  setHint("正在离线渲染（比实时快，不需要等播放）…");
  try {
    const total = state.piece.totalSeconds;
    await exportWav(
      state.piece.events,
      {
        start: 0,
        duration: total,
        tail: 2.5,
        seed: state.piece.seed,
        ...state.piece.mix,
      },
      `tunehub-${state.seed}.wav`,
    );
    setHint(
      `已导出 ${Math.round(total)} 秒 WAV（tunehub-${state.seed}.wav）。`,
      "good",
    );
  } catch (err) {
    setHint(`导出失败：${err.message}`, "warn");
  } finally {
    state.busy = false;
    btn.disabled = false;
    btn.textContent = original;
  }
}

/**
 * 离线重渲染验证：渲染开头 10 秒并播放。
 * 这是"区间导出"路径的可运行证明——它完全不走实时播放器。
 */
async function doOfflineCheck() {
  const btn = document.getElementById("offlineBtn");
  if (state.busy) return;
  state.busy = true;
  btn.disabled = true;
  setHint("离线渲染中…");
  const t0 = performance.now();
  try {
    const buf = await renderRange(state.piece.events, {
      start: 0,
      duration: 10,
      tail: 1.5,
      seed: state.piece.seed,
      ...state.piece.mix,
    });
    const ms = Math.round(performance.now() - t0);
    const blob = encodeWav(buf);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    await audio.play();
    const speed = (buf.duration / (ms / 1000)).toFixed(1);
    setHint(
      `离线渲染 ${buf.duration.toFixed(1)} 秒用时 ${ms}ms（约 ${speed}× 实时），正在试听。`,
      "good",
    );
  } catch (err) {
    setHint(`离线渲染失败：${err.message}`, "warn");
  } finally {
    state.busy = false;
    btn.disabled = false;
  }
}

function doShare() {
  const url = `${location.origin}${location.pathname}#${encodeState()}`;
  navigator.clipboard?.writeText(url).then(
    () =>
      setHint(
        "分享链接已复制。链接里就是作品的全部信息——不需要服务器。",
        "good",
      ),
    () => setHint(`复制失败，请手动复制：${url}`, "warn"),
  );
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

const SCALE_CYCLE = [
  "majorPentatonic",
  "hirajoshi",
  "dorian",
  "lydianBright",
  "aeolian",
  "insen",
  "wholeTone",
  "mixolydian",
];

function bindControls() {
  const bindSlider = (id, key, isInt) => {
    const el = document.getElementById(id);
    let raf = null;
    el.addEventListener("input", () => {
      const v = isInt ? parseInt(el.value, 10) : parseFloat(el.value);
      state.config[key] = v;
      state.sceneAdjusted = true;
      // 滑块拖动时用 rAF 节流，避免每像素都重算
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(async () => {
        try {
          await regenerate();
          if (player.playing) await player.play(player.position);
        } catch (err) {
          setHint(`重新生成失败：${err.message}`, "warn");
        }
      });
    });
  };
  bindSlider("mood", "mood", false);
  bindSlider("energy", "energy", false);
  bindSlider("bpm", "bpm", true);

  document.getElementById("playBtn").addEventListener("click", togglePlay);
  document.getElementById("rerollBtn").addEventListener("click", async () => {
    await regenerate({ reroll: "all" });
    setHint(
      state.locked.size
        ? `已重掷未锁定的声部（保留了 ${[...state.locked].map((v) => VOICES[v].label).join("、")}）。`
        : "换了一个新作品。想留住某个声部？点它卡片上的「静音」右侧切换成「🔒 锁定」。",
    );
    if (player.playing) await player.play(0);
  });
  document.getElementById("scaleBtn").addEventListener("click", async () => {
    const i = SCALE_CYCLE.indexOf(state.config.scaleId);
    state.config.scaleId = SCALE_CYCLE[(i + 1) % SCALE_CYCLE.length];
    state.sceneAdjusted = true;
    state.overrides = {};
    await regenerate();
    setHint(
      `换成了「${state.piece.scaleName}」。同一个种子，换个音阶——这就是律制与音阶层的意义。`,
    );
    if (player.playing) await player.play(0);
  });
  document.getElementById("shareBtn").addEventListener("click", doShare);
  document.getElementById("exportBtn").addEventListener("click", doExport);
  document.getElementById("stemsBtn").addEventListener("click", async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      setHint("正在按声部分轨离线渲染…");
      const stems = await exportStems(
        state.piece.events,
        {
          start: 0,
          duration: state.piece.totalSeconds,
          tail: 2.5,
          seed: state.piece.seed,
          ...state.piece.mix,
        },
        `tunehub-${state.seed}`,
      );
      setHint(
        `已导出 ${Object.keys(stems).length} 个 WAV 分轨，可直接拖入 DAW。`,
        "good",
      );
    } catch (err) {
      setHint(`分轨导出失败：${err.message}`, "warn");
    } finally {
      state.busy = false;
    }
  });
  document.getElementById("midiBtn").addEventListener("click", () => {
    try {
      exportMidi(state.piece.score, `tunehub-${state.seed}.mid`);
      setHint(
        "已导出可编辑 MIDI。微分音会以 MIDI pitch bend 投影；完整信息请同时导出 Score。",
        "good",
      );
    } catch (err) {
      setHint(`MIDI 导出失败：${err.message}`, "warn");
    }
  });
  document.getElementById("scoreBtn").addEventListener("click", () => {
    try {
      exportScoreJson(
        state.piece.score,
        state.piece.snapshot,
        `tunehub-${state.seed}-score.json`,
      );
      setHint(
        "已导出无损 Score：含分数 Beat、Pitch、内容包引用和 Snapshot。",
        "good",
      );
    } catch (err) {
      setHint(`Score 导出失败：${err.message}`, "warn");
    }
  });
  document
    .getElementById("offlineBtn")
    .addEventListener("click", doOfflineCheck);
  document.getElementById("endlessBtn").addEventListener("click", () => {
    state.endless = !state.endless;
    syncUrl();
    renderStatic();
    setHint(
      state.endless
        ? "无尽模式已开启：当前片段结束前会自动续写下一段，保持同一场景与种子轨迹。"
        : "无尽模式已关闭：当前已排入的片段会播放完，然后停止。",
      "good",
    );
  });

  // 空格键播放/停止
  window.addEventListener("keydown", (e) => {
    if (
      e.code === "Space" &&
      !["INPUT", "TEXTAREA"].includes(e.target.tagName)
    ) {
      e.preventDefault();
      togglePlay();
    }
  });

  window.addEventListener("resize", () => {
    resizeCanvas();
    draw();
  });
}

async function boot() {
  const fromUrl = decodeState();
  renderScenes();
  bindControls();
  syncSliderValues();
  resizeCanvas();
  await regenerate();
  if (!fromUrl) syncUrl();

  if (!player.supported) {
    setHint("此浏览器不支持 Web Audio API。界面可以浏览，但无法出声。", "warn");
    document.getElementById("playBtn").disabled = true;
  } else {
    setHint("按「▶ 播放」，或直接拖动下面的三个滑块。空格键也可以播放。");
  }
  animate();
}

boot().catch((err) => {
  setHint(`初始化失败：${err.message}`, "warn");
  console.error(err);
});
