/**
 * 内核数据模型。
 *
 * 关键决定：音高不是 MIDI 整数，而是带标签的联合类型。
 * 一旦退化成正整数，就永久失去表达中立三度、纯律比例、甘美兰实测频率的能力。
 * 详见 docs/ARCHITECTURE.md §2.1。
 */

// ---------------------------------------------------------------------------
// 律制 / 音阶
// ---------------------------------------------------------------------------

/**
 * 律制：把一个音级序号映射成频率。
 * MVP 只实现 12-TET 与 n-EDO（足以验证架构），ratio/measured 留作后续扩展。
 */
export function makeEdoTuning(divisions = 12, refHz = 440, refStep = 69) {
  return {
    id: `${divisions}-edo`,
    kind: 'edo',
    divisions,
    refHz,
    refStep,
    /**
     * @param {number} step 音级序号（可为小数，表示级间微分音）
     * @returns {number} 频率 Hz
     */
    freq(step) {
      return refHz * Math.pow(2, (step - refStep) / divisions);
    },
    /** 某音级相对 12-TET 的音分偏差（用于"音分偏差"可视化）。 */
    centsFrom12Tet(step) {
      const exact = (step - refStep) * (1200 / divisions);
      const tet = (step - refStep) * 100;
      return exact - tet;
    },
  };
}

/** 音阶 = 从律制中取哪些步进（以半音为单位的相对值，MVP 限定在 12-TET 网格）。 */
export const SCALES = {
  majorPentatonic: { id: 'majorPentatonic', name: '大调五声', degrees: [0, 2, 4, 7, 9] },
  minorPentatonic: { id: 'minorPentatonic', name: '小调五声', degrees: [0, 3, 5, 7, 10] },
  hirajoshi: { id: 'hirajoshi', name: '平调子（日本）', degrees: [0, 2, 3, 7, 8] },
  insen: { id: 'insen', name: '陰旋（日本）', degrees: [0, 1, 5, 7, 10] },
  gongShangJueZhiYu: { id: 'gongShangJueZhiYu', name: '宫商角徵羽', degrees: [0, 2, 4, 7, 9] },
  dorian: { id: 'dorian', name: '多利亚', degrees: [0, 2, 3, 5, 7, 9, 10] },
  aeolian: { id: 'aeolian', name: '自然小调', degrees: [0, 2, 3, 5, 7, 8, 10] },
  mixolydian: { id: 'mixolydian', name: '混合利底亚', degrees: [0, 2, 4, 5, 7, 9, 10] },
  lydianBright: { id: 'lydianBright', name: '利底亚（明亮）', degrees: [0, 2, 4, 6, 7, 9, 11] },
  wholeTone: { id: 'wholeTone', name: '全音阶', degrees: [0, 2, 4, 6, 8, 10] },
};

/** 把音阶展开到某个音区内的所有可用音级（绝对 MIDI 音符号，可为小数）。 */
export function scalePitchesInRange(scale, lowMidi, highMidi, rootMidi = 60) {
  const out = [];
  for (let oct = -2; oct <= 4; oct++) {
    for (const d of scale.degrees) {
      const m = rootMidi + oct * 12 + d;
      if (m >= lowMidi && m <= highMidi) out.push(m);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 事件
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} NoteEvent
 * @property {number} time      相对作品起点的秒数（不是墙钟时间！）
 * @property {number} duration  秒
 * @property {string} voice     声部 id
 * @property {number} midi      音符号（可为小数以表示微分音）
 * @property {number} velocity  0..1
 * @property {string} section   所属段落名
 * @property {string} [timbre]  音色 id
 */

export function makeEvent(o) {
  return {
    time: o.time,
    duration: o.duration,
    voice: o.voice,
    midi: o.midi,
    velocity: o.velocity ?? 1,
    section: o.section ?? '',
    timbre: o.timbre ?? o.voice,
  };
}

/** 作品 = 种子 + 配置（+ 后续的输入日志）。序列化后即为分享码。 */
export function serializePiece(piece) {
  return JSON.stringify({ v: 1, seed: piece.seed, config: piece.config });
}

export function deserializePiece(json) {
  const o = JSON.parse(json);
  if (o.v !== 1) throw new Error(`不支持的版本: ${o.v}`);
  return o;
}
