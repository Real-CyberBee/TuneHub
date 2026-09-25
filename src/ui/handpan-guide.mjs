// SPDX-License-Identifier: Apache-2.0
/** 讲解页直接复用手碟发音引擎，用实时频谱驱动模态示意。 */

import { buildMasterBus, midiToHz, playNoteOn } from "../audio/engine.mjs";
import { getLocale, setLocale, t, toggleLocale } from "./i18n.mjs";
import { initPwa, refreshInstallButton } from "./pwa.mjs";

const notes = [
  { midi: 50, label: "D3 Ding", timbre: "handpanBass" },
  { midi: 57, label: "A3", timbre: "handpanTone" },
  { midi: 62, label: "D4", timbre: "handpanTone" },
  { midi: 64, label: "E4", timbre: "handpanTone" },
];
const fields = [57, 59, 62, 64, 66, 69, 71, 74];
const canvas = document.getElementById("guideViz");
const paint = canvas.getContext("2d");
const meters = ["modeOneBar", "modeTwoBar", "modeThreeBar"].map((id) => document.getElementById(id));
const state = { note: notes[0], audio: null, bus: null, spectrum: null, lastHit: -Infinity };
let width = 0;
let height = 0;

function setStatus(message, kind = "") {
  const element = document.getElementById("guideStatus");
  element.textContent = message;
  element.dataset.kind = kind;
}

function applyLocale(locale = getLocale()) {
  setLocale(locale);
  document.documentElement.lang = getLocale() === "zh" ? "zh-CN" : "en";
  document.title = t("guidePageTitle");
  const text = {
    guideBack: "guideBack",
    handpanSeries: "handpanSeries",
    guideEyebrow: "guideEyebrow",
    guideTitle: "guideTitle",
    guideIntro: "guideIntro",
    guideLiveLabel: "guideLiveLabel",
    guideLabHint: "guideLabHint",
    guideStrike: "guideStrike",
    guideModesEyebrow: "guideModesEyebrow",
    guideModesTitle: "guideModesTitle",
    guideModesIntro: "guideModesIntro",
    guideModeOne: "guideModeOne",
    guideModeTwo: "guideModeTwo",
    guideModeThree: "guideModeThree",
    guideProcessEyebrow: "guideProcessEyebrow",
    guideProcessTitle: "guideProcessTitle",
    guideStepContact: "guideStepContact",
    guideStepPlate: "guideStepPlate",
    guideStepSpace: "guideStepSpace",
    guideContactTitle: "guideContactTitle",
    guideContactBody: "guideContactBody",
    guideContactDetail: "guideContactDetail",
    guidePlateTitle: "guidePlateTitle",
    guidePlateBody: "guidePlateBody",
    guidePlateDetail: "guidePlateDetail",
    guideSpaceTitle: "guideSpaceTitle",
    guideSpaceBody: "guideSpaceBody",
    guideSpaceDetail: "guideSpaceDetail",
    guideMelodyEyebrow: "guideMelodyEyebrow",
    guideMelodyTitle: "guideMelodyTitle",
    guideMelodyBody: "guideMelodyBody",
    guideCaveat: "guideCaveat",
    guideReturn: "guideReturn",
  };
  for (const [id, key] of Object.entries(text)) {
    document.getElementById(id).textContent = t(key);
  }
  document.getElementById("guideLab").setAttribute("aria-label", t("guideLabLabel"));
  canvas.setAttribute("aria-label", t("guideCanvasLabel"));
  document.querySelector(".guide-note-picker").setAttribute("aria-label", t("guideChooseNote"));
  const language = document.getElementById("localeBtn");
  language.textContent = t("language");
  language.title = t("languageTitle");
  setStatus(t("guideReady"));
  refreshInstallButton();
}

function selectNote(midi) {
  state.note = notes.find((note) => note.midi === midi) ?? notes[0];
  for (const button of document.querySelectorAll(".note-button")) {
    const active = Number(button.dataset.midi) === state.note.midi;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  setStatus(t("guideSelected", { note: state.note.label }));
}

async function strike() {
  try {
    if (!state.audio) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error(t("guideUnsupported"));
      state.audio = new AudioCtx({ latencyHint: "interactive" });
      state.bus = buildMasterBus(state.audio, {
        seed: "handpan-guide",
        reverbAmount: 0.12,
        reverbSeconds: 1.55,
        reverbDecay: 3.2,
        reverbBrightness: 0.32,
        volume: 0.72,
        analyse: true,
      });
      state.spectrum = new Float32Array(state.bus.analyser.frequencyBinCount);
    }
    if (state.audio.state === "suspended") await state.audio.resume();
    const at = state.audio.currentTime + 0.025;
    playNoteOn(state.audio, state.bus.input, {
      time: at,
      startTime: at,
      duration: 1,
      midi: state.note.midi,
      timbre: state.note.timbre,
      velocity: 0.58,
      toneBrightness: 0.64,
      strikePosition: state.note.midi === 50 ? 0.18 : 0.42,
      contactScale: 1,
    }, "handpan-guide");
    state.lastHit = performance.now();
    setStatus(t("guidePlayed", { note: state.note.label }));
  } catch (error) {
    setStatus(t("guidePlayFailed", { error: error.message }), "warn");
  }
}

function modeLevels() {
  if (!state.bus?.analyser) return [0, 0, 0];
  const analyser = state.bus.analyser;
  analyser.getFloatFrequencyData(state.spectrum);
  const binWidth = state.audio.sampleRate / analyser.fftSize;
  const fundamental = midiToHz(state.note.midi);
  return [1, 2, 3].map((multiple) => {
    const center = Math.round(fundamental * multiple / binWidth);
    let peak = -120;
    for (let bin = Math.max(0, center - 1); bin <= Math.min(center + 1, state.spectrum.length - 1); bin++) {
      peak = Math.max(peak, state.spectrum[bin]);
    }
    return Math.max(0, Math.min(1, (peak + 96) / 65));
  });
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  width = bounds.width;
  height = bounds.height;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  paint.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function fieldPosition(midi, centerX, centerY, radius) {
  if (midi === 50) return { x: centerX, y: centerY, angle: 0 };
  const index = fields.indexOf(midi);
  const angle = -Math.PI / 2 + index * Math.PI * 2 / fields.length;
  return {
    x: centerX + Math.cos(angle) * radius * 0.68,
    y: centerY + Math.sin(angle) * radius * 0.68,
    angle: angle + Math.PI / 2,
  };
}

function draw() {
  if (!width || !height) return;
  const levels = modeLevels();
  meters.forEach((bar, index) => { bar.style.width = `${Math.round(levels[index] * 100)}%`; });
  paint.clearRect(0, 0, width, height);
  const x = width / 2;
  const y = height / 2;
  const radius = Math.min(width * 0.28, height * 0.43, 156);
  const glow = paint.createRadialGradient(x - radius * 0.24, y - radius * 0.3, 5, x, y, radius * 1.2);
  glow.addColorStop(0, "#436c5b");
  glow.addColorStop(0.55, "#24483d");
  glow.addColorStop(1, "#102826");
  paint.beginPath();
  paint.arc(x, y, radius, 0, Math.PI * 2);
  paint.fillStyle = glow;
  paint.fill();
  paint.strokeStyle = "rgba(221,239,225,.34)";
  paint.lineWidth = 1.5;
  paint.stroke();
  for (let ring = 1; ring <= 4; ring++) {
    paint.beginPath();
    paint.arc(x, y, radius * (0.72 + ring * 0.055), 0, Math.PI * 2);
    paint.strokeStyle = `rgba(210,234,218,${0.055 + ring * 0.018})`;
    paint.lineWidth = 1;
    paint.stroke();
  }

  for (const midi of [50, ...fields]) {
    const field = fieldPosition(midi, x, y, radius);
    const active = midi === state.note.midi;
    paint.save();
    paint.translate(field.x, field.y);
    paint.rotate(field.angle);
    paint.beginPath();
    paint.ellipse(0, 0, radius * (midi === 50 ? 0.21 : 0.155), radius * (midi === 50 ? 0.16 : 0.1), 0, 0, Math.PI * 2);
    paint.fillStyle = active ? "rgba(232,201,152,.21)" : "rgba(7,29,27,.24)";
    paint.strokeStyle = active ? "rgba(232,201,152,.94)" : "rgba(181,224,194,.32)";
    paint.lineWidth = active ? 2 : 1;
    paint.fill();
    paint.stroke();
    paint.restore();
  }

  const selected = fieldPosition(state.note.midi, x, y, radius);
  const colors = ["164,224,194", "232,201,152", "172,216,220"];
  levels.forEach((level, index) => {
    paint.beginPath();
    paint.arc(selected.x, selected.y, radius * (0.22 + index * 0.09 + level * 0.12), 0, Math.PI * 2);
    paint.strokeStyle = `rgba(${colors[index]},${0.07 + level * 0.62})`;
    paint.lineWidth = 1 + level * 2;
    paint.stroke();
  });
  const age = (performance.now() - state.lastHit) / 1000;
  if (age < 1.4) {
    for (let wave = 0; wave < 3; wave++) {
      const progress = (age - wave * 0.14) / 1.1;
      if (progress < 0 || progress > 1) continue;
      paint.beginPath();
      paint.arc(selected.x, selected.y, radius * (0.12 + progress * 0.9), 0, Math.PI * 2);
      paint.strokeStyle = `rgba(232,201,152,${(1 - progress) * 0.54})`;
      paint.lineWidth = 1.8;
      paint.stroke();
    }
  }
  paint.fillStyle = "rgba(241,239,218,.94)";
  paint.font = "12px 'DM Mono', monospace";
  paint.textAlign = "center";
  paint.textBaseline = "middle";
  paint.fillText(state.note.label, selected.x, selected.y);
  requestAnimationFrame(draw);
}

document.getElementById("localeBtn").addEventListener("click", () => applyLocale(toggleLocale()));
for (const button of document.querySelectorAll(".note-button")) {
  button.addEventListener("click", () => selectNote(Number(button.dataset.midi)));
}
document.getElementById("guideStrike").addEventListener("click", strike);
canvas.addEventListener("click", strike);
canvas.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    strike();
  }
});
window.addEventListener("resize", resize);
initPwa();
applyLocale();
resize();
draw();
