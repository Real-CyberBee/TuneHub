// SPDX-License-Identifier: Apache-2.0
/**
 * 跨内容包、生成器与 Adapter 的规范乐谱模型。
 * 音乐时间和音高在这里保持无损；秒与 MIDI 都是下游 Adapter 的投影。
 */

export const SCORE_VERSION = 1;

export function beat(numerator, denominator = 1) {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new Error('Beat 必须是分母为正整数的分数');
  }
  const sign = denominator < 0 ? -1 : 1;
  const gcd = (a, b) => b ? gcd(b, a % b) : Math.abs(a);
  const d = gcd(numerator, denominator);
  return { numerator: sign * numerator / d, denominator: Math.abs(denominator / d) };
}

export function beatNumber(value) {
  return value.numerator / value.denominator;
}

/** 12-TET 只是 Pitch 的一个合法表达，不是规范模型的唯一真相。 */
export function edoPitch(step, divisions = 12, ref = 69) {
  return { kind: 'edo', step, divisions, ref };
}

export function pitchToHz(pitch) {
  if (pitch.kind === 'absolute') return pitch.hz;
  if (pitch.kind === 'ratio') return pitch.ref * pitch.num / pitch.den;
  if (pitch.kind === 'cents') return pitch.ref * Math.pow(2, pitch.cents / 1200);
  if (pitch.kind === 'edo') return 440 * Math.pow(2, (pitch.step - pitch.ref) / pitch.divisions);
  throw new Error(`未知 Pitch kind: ${pitch?.kind}`);
}

/** 将规范 EDO Pitch 投影为当前 Web Audio Adapter 兼容的 MIDI 小数。 */
export function pitchToMidi(pitch) {
  const hz = pitchToHz(pitch);
  return 69 + 12 * Math.log2(hz / 440);
}

export function makeTempoMap(segments = [{ at: beat(0), bpm: 92 }]) {
  const sorted = [...segments].sort((a, b) => beatNumber(a.at) - beatNumber(b.at));
  if (!sorted.length || beatNumber(sorted[0].at) !== 0) throw new Error('TempoMap 必须从 Beat 0 开始');
  if (sorted.some((segment) => !Number.isFinite(segment.bpm) || segment.bpm <= 0)) throw new Error('TempoMap BPM 必须为正数');
  return sorted;
}

/** 分段恒定 TempoMap：把音乐 Beat 映射到 Audio Adapter 所需的秒。 */
export function beatToSeconds(value, tempoMap) {
  const target = beatNumber(value);
  const map = makeTempoMap(tempoMap);
  let seconds = 0;
  for (let i = 0; i < map.length; i++) {
    const current = beatNumber(map[i].at);
    const next = i + 1 < map.length ? beatNumber(map[i + 1].at) : target;
    if (target <= current) break;
    seconds += (Math.min(target, next) - current) * 60 / map[i].bpm;
    if (target <= next) break;
  }
  return seconds;
}

export function makeNoteEvent({ at, duration, partId, pitch, velocity = 1, articulation, tags = [] }) {
  return { type: 'note', at, duration, partId, pitch, velocity, articulation, tags };
}

export function makeControlEvent({ at, target, value, curve = 'step', partId }) {
  return { type: 'control', at, target, value, curve, partId };
}

export function makeMarkerEvent({ at, kind = 'section', label, data }) {
  return { type: 'marker', at, kind, label, data };
}

export function validateScore(score) {
  if (!score || score.version !== SCORE_VERSION) throw new Error('不支持的 Score 版本');
  makeTempoMap(score.tempoMap);
  if (!Array.isArray(score.meterMap) || !score.meterMap.length) throw new Error('Score 必须有 MeterMap');
  if (!Array.isArray(score.events)) throw new Error('Score events 必须是数组');
  for (const event of score.events) {
    if (!['note', 'control', 'marker'].includes(event.type)) throw new Error(`未知事件类型: ${event.type}`);
    beatNumber(event.at);
    if (event.type === 'note') {
      if (!event.partId || !event.pitch || beatNumber(event.duration) <= 0) throw new Error('note 缺少 partId、pitch 或合法 duration');
      if (!Number.isFinite(event.velocity) || event.velocity < 0 || event.velocity > 1) throw new Error('note velocity 必须在 0..1');
    }
    if (event.type === 'control' && (!event.target || !Number.isFinite(event.value))) throw new Error('control 缺少 target 或 value');
  }
  return score;
}

/** Snapshot 是作品复现的唯一必需持久化物；交互日志是未来形态的可选附属物。 */
export function makePieceSnapshot(input) {
  const required = ['packId', 'packVersion', 'sceneId', 'sessionStrategyId', 'generatorId', 'seed'];
  for (const field of required) if (!input[field]) throw new Error(`PieceSnapshot 缺少 ${field}`);
  return {
    version: SCORE_VERSION,
    packId: input.packId,
    packVersion: input.packVersion,
    sceneId: input.sceneId,
    sessionStrategyId: input.sessionStrategyId,
    generatorId: input.generatorId,
    seed: input.seed,
    configOverrides: input.configOverrides ?? {},
    voiceOverrides: input.voiceOverrides ?? {},
    mode: input.mode ?? 'finite',
  };
}
