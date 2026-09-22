// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 内核测试。
 * 运行：node --test tests/
 *
 * 这里的三条断言对应 ROADMAP M0/M1 的验收标准：
 *   M0 —— 同种子必须逐事件一致（决定分享码与离线导出是否成立）
 *   M1 —— 听感达标（不协和碰撞率、密度、音区隔离）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32, splitmix32, hashSeed, deriveRng, weightedChoice, randomSeedString } from '../src/core/rng.mjs';
import { makeEdoTuning, SCALES, scalePitchesInRange } from '../src/core/model.mjs';
import { generate, normalizeConfig, VOICES, intervalWeight, analyzePleasantness, DEFAULT_CONFIG } from '../src/core/generate.mjs';

// ---------------------------------------------------------------------------
// M0：确定性
// ---------------------------------------------------------------------------

test('mulberry32 同种子产出同序列', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((x) => x >= 0 && x < 1));
});

test('不同种子产出不同序列', () => {
  const a = Array.from({ length: 20 }, mulberry32(1));
  const b = Array.from({ length: 20 }, mulberry32(2));
  assert.notDeepEqual(a, b);
});

test('子流派生：同 label 一致，不同 label 独立', () => {
  const r1 = Array.from({ length: 10 }, deriveRng('abc', 'bass'));
  const r2 = Array.from({ length: 10 }, deriveRng('abc', 'bass'));
  const r3 = Array.from({ length: 10 }, deriveRng('abc', 'melody'));
  assert.deepEqual(r1, r2, '同 (seed,label) 必须一致');
  assert.notDeepEqual(r1, r3, '不同 label 必须独立');
});

test('子流独立性：改动一个声部的参数不影响其它声部的事件', () => {
  const base = generate('testsd', { energy: 0.5 });
  const tweaked = generate('testsd', { energy: 0.5, mood: 0.9 });
  // mood 只影响旋律的音高选择与和声构成，不应改变打击事件
  const percBase = base.events.filter((e) => e.voice === 'perc');
  const percTweaked = tweaked.events.filter((e) => e.voice === 'perc');
  assert.deepEqual(percBase, percTweaked, 'mood 不应影响打击声部');
});

test('M0 核心验收：同种子 + 同配置 ⇒ 逐事件完全一致', () => {
  const a = generate('k7f3q9', { bpm: 100, mood: 0.3, energy: 0.7 });
  const b = generate('k7f3q9', { bpm: 100, mood: 0.3, energy: 0.7 });
  assert.deepEqual(a.events, b.events);
  assert.equal(a.totalSeconds, b.totalSeconds);
  assert.deepEqual(a.stats, b.stats);
});

test('不同种子 ⇒ 不同作品', () => {
  const a = generate('aaaaaa', {});
  const b = generate('bbbbbb', {});
  assert.notDeepEqual(a.events, b.events);
});

test('种子字符串可往返 hash', () => {
  assert.equal(hashSeed('abc'), hashSeed('abc'));
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
});

// ---------------------------------------------------------------------------
// M1：听感
// ---------------------------------------------------------------------------

test('所有种子都不产生难听结果（100 个种子）', () => {
  const results = [];
  for (let i = 0; i < 100; i++) {
    const seed = `s${i.toString(36).padStart(4, '0')}`;
    const piece = generate(seed, { mood: (i % 10) / 10, energy: ((i * 3) % 10) / 10 });
    results.push(piece.stats);
  }
  const poor = results.filter((s) => s.verdict === 'poor');
  assert.equal(poor.length, 0, `有 ${poor.length} 个种子产生了 poor 结果`);
  const avg = results.reduce((s, r) => s + r.pleasantness, 0) / results.length;
  assert.ok(avg > 0.8, `平均悦耳度 ${avg.toFixed(3)} 应 > 0.8`);
});

test('不协和碰撞率极低', () => {
  let totalHarsh = 0;
  let totalSim = 0;
  for (let i = 0; i < 60; i++) {
    const piece = generate(`h${i}`, { energy: 0.8 });
    totalHarsh += piece.stats.harshIntervals;
    totalSim += piece.stats.totalSimultaneities;
  }
  const rate = totalHarsh / Math.max(1, totalSim);
  assert.ok(rate < 0.02, `不协和率 ${rate.toFixed(4)} 应 < 0.02`);
});

test('声部音区严格隔离（无重叠）', () => {
  const piece = generate('ranges', { energy: 1.0, mood: 0.8 });
  const byVoice = {};
  for (const e of piece.events) {
    if (e.voice === 'perc') continue;
    (byVoice[e.voice] ??= []).push(e.midi);
  }
  assert.ok(byVoice.bass.length > 0 && byVoice.melody.length > 0, '应同时有低音与旋律');
  assert.ok(Math.max(...byVoice.bass) < Math.min(...byVoice.harmony), '低音必须低于和声');
  assert.ok(Math.max(...byVoice.harmony) < Math.min(...byVoice.melody), '和声必须低于旋律');
});

test('音区护栏：极端参数下仍不越界', () => {
  for (const mood of [0, 0.5, 1]) {
    for (const energy of [0, 1]) {
      const piece = generate('guard', { mood, energy });
      for (const e of piece.events) {
        if (e.voice === 'perc') continue;
        const v = VOICES[e.voice];
        assert.ok(e.midi >= v.low && e.midi <= v.high,
          `${e.voice} 音高 ${e.midi} 越界 [${v.low},${v.high}] (mood=${mood}, energy=${energy})`);
      }
    }
  }
});

test('密度不失控', () => {
  const piece = generate('dense', { energy: 1.0 });
  assert.ok(piece.stats.densityPeaks < piece.events.length * 0.05, '密度尖峰过多');
});

test('能量参数真实影响事件数量', () => {
  const quiet = generate('cmp', { energy: 0.1 });
  const loud = generate('cmp', { energy: 0.95 });
  assert.ok(loud.events.length > quiet.events.length * 1.3,
    `高能量应显著更密：quiet=${quiet.events.length}, loud=${loud.events.length}`);
});

test('情绪参数影响音高分布（走向更高）', () => {
  const dark = generate('moodtest', { mood: 0.05, energy: 0.6 });
  const bright = generate('moodtest', { mood: 0.95, energy: 0.6 });
  const avg = (p) => {
    const m = p.events.filter((e) => e.voice === 'melody');
    return m.reduce((s, e) => s + e.midi, 0) / Math.max(1, m.length);
  };
  assert.ok(avg(bright) > avg(dark), `明亮应更高：dark=${avg(dark).toFixed(1)}, bright=${avg(bright).toFixed(1)}`);
});

test('事件时间单调且非负', () => {
  const piece = generate('time', {});
  let prev = -1;
  for (const e of piece.events) {
    assert.ok(e.time >= 0, 'time 必须非负');
    assert.ok(e.time >= prev - 1e-9, 'time 必须递增');
    prev = e.time;
  }
});

test('段落密度包络：break 段比 main 段更疏', () => {
  const piece = generate('env', { energy: 0.7 });
  const count = (name) => piece.events.filter((e) => e.section === name).length;
  const barsOf = (name) => piece.config.sections.find((s) => s.name === name).bars;
  const density = (name) => count(name) / barsOf(name);
  assert.ok(density('break') < density('main'), 'break 段应比 main 段疏');
});

// ---------------------------------------------------------------------------
// 音程权重模型
// ---------------------------------------------------------------------------

test('协和音程权重高于不协和音程', () => {
  assert.ok(intervalWeight(7) > intervalWeight(1), '纯五 > 小二');
  assert.ok(intervalWeight(5) > intervalWeight(6), '纯四 > 三全音');
  assert.ok(intervalWeight(3) > intervalWeight(1), '小三 > 小二');
  assert.ok(intervalWeight(4) > intervalWeight(11), '大三 > 大七');
  assert.ok(intervalWeight(7) >= intervalWeight(2), '纯五 >= 大二');
});

// ---------------------------------------------------------------------------
// 律制 / 音阶
// ---------------------------------------------------------------------------

test('12-TET 频率计算正确', () => {
  const t = makeEdoTuning(12);
  assert.ok(Math.abs(t.freq(69) - 440) < 1e-9, 'A4 = 440');
  assert.ok(Math.abs(t.freq(60) - 261.6255653) < 1e-6, 'C4 ≈ 261.63');
  assert.ok(Math.abs(t.freq(81) - 880) < 1e-9, 'A5 = 880');
});

test('19-EDO 的频率与音分偏差非零（验证非 12-TET 可用）', () => {
  const t = makeEdoTuning(19);
  assert.ok(Math.abs(t.centsFrom12Tet(70)) > 1, '19-EDO 的音级应对 12-TET 有偏差');
});

test('音阶展开在音区内且去重有序', () => {
  const pool = scalePitchesInRange(SCALES.majorPentatonic, 66, 81, 60);
  assert.ok(pool.length > 0);
  assert.deepEqual(pool, [...new Set(pool)].sort((a, b) => a - b));
  assert.ok(pool.every((m) => m >= 66 && m <= 81));
});

test('所有内置音阶都能生成作品', () => {
  for (const id of Object.keys(SCALES)) {
    const piece = generate('scaletest', { scaleId: id });
    assert.ok(piece.events.length > 0, `音阶 ${id} 未产出事件`);
    assert.equal(piece.scaleId, id);
  }
});

// ---------------------------------------------------------------------------
// 配置归一化
// ---------------------------------------------------------------------------

test('配置越界被夹紧', () => {
  const c = normalizeConfig({ bpm: 9999, mood: -5, energy: 42 });
  assert.equal(c.bpm, 180);
  assert.equal(c.mood, 0);
  assert.equal(c.energy, 1);
});

test('默认配置可生成', () => {
  const piece = generate('default', {});
  assert.ok(piece.events.length > 50);
  assert.ok(piece.totalSeconds > 20);
});

// ---------------------------------------------------------------------------
// 锁 + 重掷：每声部种子覆盖
// ---------------------------------------------------------------------------

test('声部覆盖：只改变目标声部，其余声部逐事件不变', () => {
  const base = generate('locktest', { energy: 0.7 });
  const rolled = generate('locktest', { energy: 0.7 }, undefined, { melody: 'newmel' });

  const pick = (p, v) => p.events.filter((e) => e.voice === v);
  assert.notDeepEqual(pick(base, 'melody'), pick(rolled, 'melody'), '旋律应已改变');
  assert.deepEqual(pick(base, 'bass'), pick(rolled, 'bass'), '低音不应改变');
  assert.deepEqual(pick(base, 'harmony'), pick(rolled, 'harmony'), '和声不应改变');
  assert.deepEqual(pick(base, 'perc'), pick(rolled, 'perc'), '打击不应改变');
});

test('声部覆盖不改变曲式结构', () => {
  const base = generate('structtest', {});
  const rolled = generate('structtest', {}, undefined, { melody: 'zzz', perc: 'yyy' });
  assert.equal(base.totalSeconds, rolled.totalSeconds);
  assert.deepEqual(
    base.config.sections.map((s) => `${s.name}:${s.bars}`),
    rolled.config.sections.map((s) => `${s.name}:${s.bars}`),
  );
});

test('覆盖本身也是确定性的（可分享）', () => {
  const ov = { melody: 'abc12', bass: 'xy9' };
  const a = generate('shareme', { mood: 0.4 }, undefined, ov);
  const b = generate('shareme', { mood: 0.4 }, undefined, ov);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.overrides, ov);
});

test('覆盖后的作品仍然好听且不越界', () => {
  for (let i = 0; i < 25; i++) {
    const piece = generate(`ov${i}`, { energy: 0.9 }, undefined, { melody: `m${i}`, perc: `p${i}` });
    assert.ok(piece.stats.verdict !== 'poor', `覆盖后出现 poor: ${JSON.stringify(piece.stats)}`);
    for (const e of piece.events) {
      if (e.voice === 'perc') continue;
      const v = VOICES[e.voice];
      assert.ok(e.midi >= v.low && e.midi <= v.high, `${e.voice} 越界`);
    }
  }
});
