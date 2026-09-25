// SPDX-License-Identifier: Apache-2.0
/** 手碟 Solo 专属 UI：随机生成、演奏控制与独奏音色调节。 */

import { newSeedString } from "../core/rng.mjs";
import {
  appendHandpanSegment,
  generateHandpanSegment,
  HANDPAN_DEFAULT_CONFIG,
} from "../core/handpan.mjs";
import { Player } from "../audio/player.mjs";
import { exportWav } from "../audio/export.mjs";
import { getLocale, setLocale, t, toggleLocale } from "./i18n.mjs";

const state = {
  seed: newSeedString(),
  config: JSON.parse(JSON.stringify(HANDPAN_DEFAULT_CONFIG)),
  piece: null,
  endless: false,
  nextSegmentIndex: 1,
  busy: false,
};
const player = new Player({ analyse: true });
const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const FIELD_MIDIS = [57, 59, 62, 64, 66, 69, 71, 74];
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
let width = 0;
let height = 0;
let activeAnalyser = null;
let waveformData = null;
let spectrumData = null;

function readAudioSignal() {
  const analyser = player.bus?.analyser;
  if (!analyser) return null;
  if (activeAnalyser !== analyser) {
    activeAnalyser = analyser;
    waveformData = new Float32Array(analyser.fftSize);
    spectrumData = new Float32Array(analyser.frequencyBinCount);
  }
  analyser.getFloatTimeDomainData(waveformData);
  analyser.getFloatFrequencyData(spectrumData);
  return { analyser, waveform: waveformData, spectrum: spectrumData };
}

function midiLabel(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function modalEnergy(signal, frequency) {
  if (!signal || frequency <= 0) return 0;
  const binWidth = player.ctx.sampleRate / signal.analyser.fftSize;
  const center = Math.round(frequency / binWidth);
  let peakDb = -120;
  for (let bin = Math.max(0, center - 1); bin <= Math.min(signal.spectrum.length - 1, center + 1); bin++) {
    peakDb = Math.max(peakDb, signal.spectrum[bin]);
  }
  return Math.max(0, Math.min(1, (peakDb + 96) / 62));
}

function setHint(message, kind = "") {
  const hint = document.getElementById("hint");
  hint.textContent = message;
  hint.dataset.kind = kind;
}

function applyLocale(locale = getLocale()) {
  setLocale(locale);
  const lang = getLocale();
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = t("handpanTitle");
  const text = {
    handpanSeries: "handpanSeries",
    handpanBack: "handpanBack",
    handpanOriginal: "handpanOriginal",
    handpanKicker: "handpanKicker",
    handpanTuneKicker: "handpanTuneKicker",
    handpanHeadline: "handpanHeadline",
    handpanLede: "handpanLede",
    handpanFeel: "handpanFeel",
    handpanSummary: "handpanSummary",
    handpanMoodLabel: "handpanMoodLabel",
    handpanMoodWarm: "handpanMoodWarm",
    handpanMoodBright: "handpanMoodBright",
    handpanDensity: "handpanDensity",
    handpanMoreSpace: "handpanMoreSpace",
    handpanMoreFlow: "handpanMoreFlow",
    handpanPulse: "handpanPulse",
    handpanSlowBreath: "handpanSlowBreath",
    handpanQuickFlow: "handpanQuickFlow",
    exportBtn: "handpanExport",
    handpanDisclaimer: "handpanDisclaimer",
    randomBtn: "handpanRandom",
  };
  for (const [id, key] of Object.entries(text)) {
    document.getElementById(id).textContent = t(key);
  }
  document.getElementById("handpanStage").setAttribute("aria-label", t("handpanStage"));
  document.getElementById("viz").setAttribute("aria-label", t("handpanCanvas"));
  document.getElementById("handpanTransport").setAttribute("aria-label", t("handpanTransport"));
  document.getElementById("handpanControls").setAttribute("aria-label", t("handpanControls"));
  const languageButton = document.getElementById("localeBtn");
  languageButton.textContent = t("language");
  languageButton.title = t("languageTitle");
  const playButton = document.getElementById("playBtn");
  playButton.setAttribute("aria-label", player.playing ? t("handpanStop") : t("handpanPlay"));
  syncEndlessButton();
  if (state.piece) {
    syncControls();
    syncStats();
  }
  document.getElementById("hint").textContent = state.endless
    ? t("handpanEndlessStarted")
    : t("handpanStartHint");
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  width = rect.width;
  height = rect.height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function draw() {
  if (!state.piece || !width || !height) return;
  const signal = readAudioSignal();
  ctx.clearRect(0, 0, width, height);
  const centerX = width / 2;
  const centerY = height * 0.43;
  const shellX = Math.min(width * 0.41, 270);
  const shellY = Math.min(height * 0.31, 98);

  // 手碟壳体俯视轮廓与车削金属环。
  const shell = ctx.createRadialGradient(centerX - shellX * 0.2, centerY - shellY * 0.4, 8, centerX, centerY, shellX * 1.2);
  shell.addColorStop(0, "rgba(88,130,111,.46)");
  shell.addColorStop(0.62, "rgba(31,67,61,.68)");
  shell.addColorStop(1, "rgba(13,31,31,.92)");
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, shellX, shellY, 0, 0, Math.PI * 2);
  ctx.fillStyle = shell;
  ctx.fill();
  for (let ring = 0; ring < 4; ring++) {
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, shellX * (0.84 + ring * 0.045), shellY * (0.78 + ring * 0.055), 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(201,232,217,${0.09 - ring * 0.014})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 每个音区的三道模态环分别对应基音、八度与十二度附近的共振能量。
  const drawField = (midi, x, y, rx, ry, rotation, ding = false) => {
    const f0 = 440 * 2 ** ((midi - 69) / 12);
    const energies = [modalEnergy(signal, f0), modalEnergy(signal, f0 * 2), modalEnergy(signal, f0 * 3)];
    const level = Math.max(...energies);
    const accent = ding ? "232,201,152" : "164,224,194";
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx + level * 7, ry + level * 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${accent},${0.035 + level * 0.16})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${accent},${0.18 + level * 0.68})`;
    ctx.lineWidth = 1 + level * 1.4;
    ctx.stroke();
    for (let mode = 0; mode < energies.length; mode++) {
      const inset = 4 + mode * 4;
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(3, rx - inset), Math.max(2, ry - inset * 0.55), 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${accent},${0.07 + energies[mode] * 0.58})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(228,238,230,.82)";
    ctx.font = "10px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(midiLabel(midi), 0, 0);
    ctx.restore();
  };

  drawField(50, centerX, centerY, Math.min(37, width * 0.1), 23, 0, true);
  FIELD_MIDIS.forEach((midi, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / FIELD_MIDIS.length);
    const x = centerX + Math.cos(angle) * shellX * 0.69;
    const y = centerY + Math.sin(angle) * shellY * 0.63;
    drawField(midi, x, y, Math.min(28, width * 0.076), 16, angle + Math.PI / 2);
  });

  // 底部显示总线的真实时域波形；停音后仍可观察模态和混响尾音。
  const waveY = height * 0.84;
  ctx.beginPath();
  ctx.moveTo(22, waveY);
  ctx.lineTo(width - 22, waveY);
  ctx.strokeStyle = "rgba(220,238,224,.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
  if (signal?.waveform) {
    let peak = 0;
    for (const sample of signal.waveform) peak = Math.max(peak, Math.abs(sample));
    const displayGain = peak > 0.0001 ? Math.min(12, 0.62 / peak) : 0;
    ctx.beginPath();
    const points = Math.max(100, Math.floor(width * 1.2));
    for (let i = 0; i < points; i++) {
      const sampleIndex = Math.floor((i / (points - 1)) * (signal.waveform.length - 1));
      const sample = signal.waveform[sampleIndex] * displayGain;
      const x = 22 + (i / (points - 1)) * (width - 44);
      const y = waveY - sample * Math.min(21, height * 0.075);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(164,224,194,.86)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

function syncControls() {
  document.getElementById("mood").value = String(state.config.mood);
  document.getElementById("energy").value = String(state.config.energy);
  document.getElementById("bpm").value = String(state.config.bpm);
  const mood = state.config.mood;
  document.getElementById("moodValue").textContent =
    mood < 0.42 ? t("handpanMoodDeep") : mood > 0.64 ? t("handpanMoodBrightValue") : t("handpanMoodValue");
  const energy = state.config.energy;
  document.getElementById("energyValue").textContent =
    energy < 0.28 ? t("handpanSparse") : energy > 0.5 ? t("handpanFlowing") : t("handpanDensityRelaxed");
  document.getElementById("bpmValue").textContent = `${state.config.bpm} BPM`;
  document.getElementById("scaleName").textContent = t("handpanFixedTuning");
}

function syncStats() {
  if (!state.piece) return;
  const key = state.endless || (state.piece.handpan?.segmentCount ?? 1) > 1
    ? "handpanEndlessStats"
    : "handpanStats";
  document.getElementById("pieceStats").textContent = t(key, {
    count: state.piece.events.length,
    duration: Math.round(state.piece.totalSeconds),
    segments: state.piece.handpan?.segmentCount ?? 1,
  });
}

function syncEndlessButton() {
  const button = document.getElementById("endlessBtn");
  button.classList.toggle("active", state.endless);
  button.setAttribute("aria-pressed", String(state.endless));
  button.textContent = t(state.endless ? "handpanEndlessOn" : "handpanEndless");
  button.title = t("handpanEndlessTitle");
}

async function regenerate({ newSeed = false, resume = true } = {}) {
  if (newSeed) state.seed = newSeedString();
  const wasPlaying = player.playing;
  const position = player.position;
  state.piece = generateHandpanSegment({
    seed: state.seed,
    config: state.config,
  });
  state.nextSegmentIndex = 1;
  activeAnalyser = null;
  await player.load(state.piece);
  document.getElementById("seedLabel").textContent = t("handpanSeed", { seed: state.seed.toUpperCase() });
  syncStats();
  syncControls();
  draw();
  if (wasPlaying && resume) {
    await player.play(newSeed ? 0 : position % state.piece.totalSeconds);
  }
}

/** 在片段结束前预接下一段，保持同一个 AudioContext 和模态尾音。 */
function keepEndlessBuffer() {
  if (!state.endless || !player.playing || !state.piece) return;
  if (state.piece.totalSeconds - player.position > 12) return;
  const segment = generateHandpanSegment({
    seed: state.seed,
    segmentIndex: state.nextSegmentIndex,
    config: state.config,
  });
  const extended = appendHandpanSegment(state.piece, segment);
  player.extend(extended);
  state.piece = extended;
  state.nextSegmentIndex += 1;
  syncStats();
  setHint(t("handpanEndlessSegment", { segments: extended.handpan.segmentCount }), "good");
}

async function togglePlay() {
  const button = document.getElementById("playBtn");
  if (player.playing) {
    player.stop();
    button.textContent = "▶";
    button.setAttribute("aria-label", t("handpanPlay"));
    draw();
    return;
  }
  try {
    await player.play(0);
    button.textContent = "Ⅱ";
    button.setAttribute("aria-label", t("handpanStop"));
    setHint(t("handpanPlaying"), "good");
  } catch (error) {
    setHint(t("handpanPlayFailed", { error: error.message }), "warn");
  }
}

function bindControls() {
  document.getElementById("localeBtn").addEventListener("click", () => applyLocale(toggleLocale()));
  document.getElementById("playBtn").addEventListener("click", togglePlay);
  document.getElementById("endlessBtn").addEventListener("click", () => {
    state.endless = !state.endless;
    syncEndlessButton();
    syncStats();
    setHint(t(state.endless ? "handpanEndlessStarted" : "handpanEndlessStopped"), "good");
  });
  document.getElementById("randomBtn").addEventListener("click", async () => {
    try {
      await regenerate({ newSeed: true });
      setHint(t("handpanNewPhrase"), "good");
    } catch (error) {
      setHint(t("handpanGenerateFailed", { error: error.message }), "warn");
    }
  });
  let frame = 0;
  for (const [id, key, integer] of [
    ["mood", "mood", false],
    ["energy", "energy", false],
    ["bpm", "bpm", true],
  ]) {
    document.getElementById(id).addEventListener("input", (event) => {
      state.config[key] = integer
        ? Number.parseInt(event.currentTarget.value, 10)
        : Number.parseFloat(event.currentTarget.value);
      syncControls();
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(async () => {
        try {
          await regenerate();
          setHint(t("handpanParamsUpdated"), "good");
        } catch (error) {
          setHint(t("handpanUpdateFailed", { error: error.message }), "warn");
        }
      });
    });
  }

  document.getElementById("exportBtn").addEventListener("click", async () => {
    if (state.busy) return;
    state.busy = true;
    const button = document.getElementById("exportBtn");
    button.disabled = true;
    button.textContent = t("handpanRendering");
    try {
      await exportWav(
        state.piece.events,
        {
          start: 0,
          duration: state.piece.totalSeconds,
          tail: 3,
          seed: state.piece.seed,
          ...state.piece.mix,
        },
        `handpan-solo-${state.seed}.wav`,
      );
      setHint(t("handpanExported"), "good");
    } catch (error) {
      setHint(t("handpanExportFailed", { error: error.message }), "warn");
    } finally {
      state.busy = false;
      button.disabled = false;
      button.textContent = t("handpanExport");
    }
  });
}

function animate() {
  try {
    keepEndlessBuffer();
  } catch (error) {
    state.endless = false;
    syncEndlessButton();
    syncStats();
    setHint(t("handpanEndlessFailed", { error: error.message }), "warn");
  }
  if (player.playing && player.position >= state.piece.totalSeconds) {
    player.stop();
    const button = document.getElementById("playBtn");
    button.textContent = "▶";
    button.setAttribute("aria-label", t("handpanPlay"));
  }
  draw();
  requestAnimationFrame(animate);
}

async function boot() {
  applyLocale();
  bindControls();
  window.addEventListener("resize", resize);
  resize();
  await regenerate({ resume: false });
  setHint(t("handpanStartHint"));
  animate();
}

boot().catch((error) => {
  setHint(t("handpanInitFailed", { error: error.message }), "warn");
  console.error(error);
});
