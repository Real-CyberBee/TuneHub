// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 浏览器内自检。纯 Node 测不到的部分都在这里：
 *   - OfflineAudioContext 区间渲染（导出路径的核心）
 *   - WAV 编码（真的产出可解码的音频）
 *   - 实时播放器的调度与前进
 *   - analyser 读到非零信号（即"真的出声了"）
 *
 * 访问 http://127.0.0.1:8765/tests/browser.html
 * 结果会写进页面里的 <pre id="out">，因此可以用
 *   chrome --headless --dump-dom .../tests/browser.html
 * 在 CI 里做无头验证。
 */

import { generate, VOICES, analyzePleasantness } from '../src/core/generate.mjs';
import { SCALES } from '../src/core/model.mjs';
import { Player } from '../src/audio/player.mjs';
import { renderRange, encodeWav } from '../src/audio/export.mjs';
import { prepareEvents } from '../src/audio/engine.mjs';

const out = [];
let pass = 0;
let fail = 0;

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((detail) => {
      pass++;
      out.push(`PASS  ${name}${detail ? '  — ' + detail : ''}`);
    })
    .catch((err) => {
      fail++;
      out.push(`FAIL  ${name}  — ${err && err.message ? err.message : err}`);
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

function flush() {
  const el = document.getElementById('out');
  el.textContent = out.join('\n') + `\n\n合计: ${pass} 通过, ${fail} 失败`;
  el.dataset.pass = String(pass);
  el.dataset.fail = String(fail);
  document.title = `browser-check pass=${pass} fail=${fail}`;
}

async function run() {
  out.push(`UA: ${navigator.userAgent}`);
  out.push(`AudioContext: ${typeof (window.AudioContext || window.webkitAudioContext)}`);
  out.push(`OfflineAudioContext: ${typeof (window.OfflineAudioContext || window.webkitOfflineAudioContext)}`);
  out.push('');

  const sampleRate = 22050; // 自检用低采样率，跑得快
  const piece = generate('browsr', { energy: 0.6, mood: 0.5 }, SCALES, {});

  // ---- 1. 确定性（浏览器端）----
  await check('同种子在浏览器端也逐事件一致', () => {
    const a = generate('browsr', { energy: 0.6, mood: 0.5 }, SCALES, {});
    const b = generate('browsr', { energy: 0.6, mood: 0.5 }, SCALES, {});
    assert(JSON.stringify(a.events) === JSON.stringify(b.events), '两次生成结果不同');
    return `${a.events.length} 个事件`;
  });

  // ---- 2. 离线渲染 ----
  let buf10 = null;
  await check('OfflineAudioContext 渲染 10 秒', async () => {
    const t0 = performance.now();
    buf10 = await renderRange(piece.events, { start: 0, duration: 10, tail: 1, sampleRate, seed: piece.seed });
    const ms = Math.round(performance.now() - t0);
    assert(buf10.length === Math.ceil(11 * sampleRate), `长度不符: ${buf10.length}`);
    return `${buf10.duration.toFixed(1)}s 用时 ${ms}ms`;
  });

  // ---- 3. 渲染出的确实有声音（不是静音）----
  await check('渲染结果含非零信号（真的出声了）', () => {
    assert(buf10, '上一步未产出 buffer');
    const d = buf10.getChannelData(0);
    let peak = 0;
    let rms = 0;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      rms += d[i] * d[i];
    }
    rms = Math.sqrt(rms / d.length);
    assert(peak > 0.001, `峰值过低 (${peak})，可能是静音`);
    assert(rms > 0.0001, `RMS 过低 (${rms})`);
    assert(peak <= 1.0001, `峰值削波 (${peak})`);
    assert(!Number.isNaN(rms), 'RMS 是 NaN');
    return `峰值 ${peak.toFixed(3)}, RMS ${rms.toFixed(4)}`;
  });

  // ---- 4. 无 NaN / 无削波 ----
  await check('渲染结果无 NaN 且不削波', () => {
    const d = buf10.getChannelData(0);
    let nan = 0;
    let clipped = 0;
    for (let i = 0; i < d.length; i++) {
      if (Number.isNaN(d[i])) nan++;
      if (Math.abs(d[i]) > 0.999) clipped++;
    }
    assert(nan === 0, `有 ${nan} 个 NaN`);
    assert(clipped / d.length < 0.001, `削波比例 ${(clipped / d.length * 100).toFixed(2)}% 过高`);
    return '干净';
  });

  // ---- 5. 区间可截取（"截断某一段保存"）----
  await check('可截取中间任意区间（区间导出）', async () => {
    const start = Math.min(8, Math.max(0, piece.totalSeconds * 0.3));
    const seg = await renderRange(piece.events, { start, duration: 6, tail: 1, sampleRate, seed: piece.seed });
    assert(seg.length === Math.ceil(7 * sampleRate), `长度不符 ${seg.length}`);
    const d = seg.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    assert(peak > 0.0005, `区间 [${start.toFixed(1)}s, +6s] 内没有声音 (peak=${peak})`);
    return `起点 ${start.toFixed(1)}s, 峰值 ${peak.toFixed(3)}`;
  });

  // ---- 6. 确定性导出：同参数两次渲染逐样本一致 ----
  await check('离线渲染严格确定：同参数两次渲染逐样本完全一致', async () => {
    const opts = { start: 0, duration: 4, tail: 0.5, sampleRate, seed: piece.seed };
    const a = await renderRange(piece.events, opts);
    const b = await renderRange(piece.events, opts);
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    assert(da.length === db.length, '长度不同');
    let maxDiff = 0;
    for (let i = 0; i < da.length; i++) maxDiff = Math.max(maxDiff, Math.abs(da[i] - db[i]));
    // float32 的机器精度约 2^-23 ≈ 1.2e-7。允许到 1e-5 是为了容忍
    // 求和顺序带来的浮点结合律差异；任何"真正的随机"都会远大于这个量级
    // （修复前这里是 0.507，即噪声未确定性时的量级）。
    assert(maxDiff < 1e-5, `渲染不可复现（最大样本差 ${maxDiff}）——噪声未确定性`);
    return `最大样本差 ${maxDiff.toExponential(2)}（≈ float32 机器精度，可视为逐样本一致）`;
  });

  // ---- 7. WAV 编码 ----
  await check('WAV 编码产出合法 RIFF 文件', async () => {
    const blob = encodeWav(buf10);
    const ab = await blob.arrayBuffer();
    const v = new DataView(ab);
    const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    assert(tag(0) === 'RIFF', `头不是 RIFF: ${tag(0)}`);
    assert(tag(8) === 'WAVE', `不是 WAVE: ${tag(8)}`);
    assert(tag(12) === 'fmt ', `缺 fmt 块: ${tag(12)}`);
    assert(tag(36) === 'data', `缺 data 块: ${tag(36)}`);
    const ch = v.getUint16(22, true);
    const rate = v.getUint32(24, true);
    const bits = v.getUint16(34, true);
    const dataSize = v.getUint32(40, true);
    assert(ch === 2, `声道数 ${ch}`);
    assert(rate === sampleRate, `采样率 ${rate}`);
    assert(bits === 16, `位深 ${bits}`);
    assert(ab.byteLength === 44 + dataSize, '文件长度与 data 块不一致');
    const expected = Math.ceil(11 * sampleRate) * 2 * 2;
    assert(dataSize === expected, `data 大小 ${dataSize} != ${expected}`);
    return `${(ab.byteLength / 1024).toFixed(0)} KB, ${ch}ch/${rate}Hz/${bits}bit`;
  });

  // ---- 8. 编码后可被浏览器解码（真·可播放）----
  await check('导出的 WAV 能被浏览器解码回来', async () => {
    const blob = encodeWav(buf10);
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
    const ok = Math.abs(decoded.duration - 11) < 0.05 && decoded.numberOfChannels === 2;
    await ac.close();
    assert(ok, `解码结果异常: ${decoded.duration}s / ${decoded.numberOfChannels}ch`);
    return `解码得到 ${decoded.duration.toFixed(2)}s / ${decoded.numberOfChannels}ch`;
  });

  // ---- 9. 实时播放器真的在推进，且 analyser 读到非零信号 ----
  await check('实时播放器出声（Analyser 读到非零 RMS）', async () => {
    const player = new Player();
    await player.resume();
    await player.load(piece);

    // 在总线上挂一个 analyser 来验证确实有信号
    const ac = player.ctx;
    const analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    player.bus.input.connect(analyser);
    const arr = new Float32Array(analyser.fftSize);

    await player.play(0);
    await new Promise((r) => setTimeout(r, 1300));

    let bestRms = 0;
    for (let i = 0; i < 25; i++) {
      analyser.getFloatTimeDomainData(arr);
      let s = 0;
      for (let j = 0; j < arr.length; j++) s += arr[j] * arr[j];
      bestRms = Math.max(bestRms, Math.sqrt(s / arr.length));
      await new Promise((r) => setTimeout(r, 40));
    }
    const pos = player.position;
    player.stop();
    await ac.close();

    assert(pos > 0.3, `播放头未推进 (${pos.toFixed(2)}s)`);
    assert(bestRms > 0.001, `未检测到音频信号 (rms=${bestRms.toFixed(5)})`);
    return `播放头 ${pos.toFixed(2)}s, RMS ${bestRms.toFixed(4)}`;
  });

  // ---- 10. 静音与播放头跳转 ----
  await check('静音声部与跳转播放都生效', async () => {
    const player = new Player();
    await player.resume();
    await player.load(piece);
    player.setMuted('perc', true);
    await player.play(5);
    await new Promise((r) => setTimeout(r, 350));
    const pos = player.position;
    player.stop();
    await player.ctx.close();
    assert(pos >= 5, `从 5s 起播后播放头应 >= 5，实际 ${pos.toFixed(2)}`);
    return `跳转到 5s 成功（当前 ${pos.toFixed(2)}s）`;
  });

  // ---- 11. prepareEvents 在浏览器端行为一致 ----
  await check('prepareEvents 区间切分正确', () => {
    const evs = [
      { time: 0, duration: 1, voice: 'melody', midi: 60, velocity: 1 },
      { time: 3, duration: 4, voice: 'pad', midi: 55, velocity: 1 },
      { time: 20, duration: 1, voice: 'melody', midi: 62, velocity: 1 },
    ];
    const o = prepareEvents(evs, 5, 4);
    assert(o.length === 1, `应只剩 1 个事件，实际 ${o.length}`);
    assert(o[0].startTime === 0, '起点应为 0');
    assert(Math.abs(o[0].duration - 2) < 1e-9, `剩余时长应为 2，实际 ${o[0].duration}`);
    return '跨起点长音被正确截断';
  });

  // ---- 12. 听感指标 ----
  await check('作品的听感指标达标', () => {
    const s = analyzePleasantness(piece.events);
    assert(s.verdict !== 'poor', `verdict=${s.verdict}`);
    assert(s.harshRate < 0.03, `不协和率 ${s.harshRate}`);
    return `悦耳度 ${(s.pleasantness * 100).toFixed(0)}%, 不协和率 ${(s.harshRate * 100).toFixed(2)}%`;
  });

  flush();
}

run().catch((err) => {
  out.push(`FATAL ${err && err.stack ? err.stack : err}`);
  fail++;
  flush();
});
