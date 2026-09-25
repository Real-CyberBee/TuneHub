// SPDX-License-Identifier: Apache-2.0
/** 零依赖 Standard MIDI File（format 0）导出 Adapter。 */

import { beatNumber, pitchToMidi, validateScore } from '../core/score.mjs';
import { triggerDownload } from './export.mjs';

function varLen(value) {
  let buffer = value & 0x7f;
  const out = [];
  while ((value >>= 7)) { buffer <<= 8; buffer |= ((value & 0x7f) | 0x80); }
  while (true) { out.push(buffer & 0xff); if (buffer & 0x80) buffer >>= 8; else break; }
  return out;
}

function bytesToBlob(bytes) { return new Blob([new Uint8Array(bytes)], { type: 'audio/midi' }); }

/**
 * 把规范 Score 投影为可编辑 MIDI。微分音可选用 pitch bend；同一 channel 内
 * 重叠且不同 bend 的音无法被 MIDI 1.0 无损表达，调用方可据 diagnostics 提示用户。
 */
export function encodeMidi(score, { ppq = 960, pitchBend = true } = {}) {
  validateScore(score);
  const events = [];
  for (const event of score.events) {
    if (event.type !== 'note') continue;
    const tick = Math.max(0, Math.round(beatNumber(event.at) * ppq));
    const duration = Math.max(1, Math.round(beatNumber(event.duration) * ppq));
    const exact = pitchToMidi(event.pitch);
    const note = Math.max(0, Math.min(127, Math.round(exact)));
    const velocity = Math.max(1, Math.min(127, Math.round(event.velocity * 127)));
    const channel = event.partId === 'perc' ? 9 : 0;
    if (pitchBend && channel !== 9) {
      const bend = Math.max(0, Math.min(16383, Math.round(8192 + (exact - note) / 2 * 8192)));
      events.push({ tick, order: 0, bytes: [0xe0 | channel, bend & 0x7f, (bend >> 7) & 0x7f] });
    }
    events.push({ tick, order: 1, bytes: [0x90 | channel, note, velocity] });
    events.push({ tick: tick + duration, order: 0, bytes: [0x80 | channel, note, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track = [];
  let previous = 0;
  for (const event of events) { track.push(...varLen(event.tick - previous), ...event.bytes); previous = event.tick; }
  track.push(0, 0xff, 0x2f, 0);
  const out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff,
    0x4d, 0x54, 0x72, 0x6b, (track.length >>> 24) & 0xff, (track.length >>> 16) & 0xff, (track.length >>> 8) & 0xff, track.length & 0xff, ...track];
  return bytesToBlob(out);
}

export function exportMidi(score, filename = 'tunehub.mid') {
  const blob = encodeMidi(score);
  triggerDownload(blob, filename);
  return blob;
}

export function exportScoreJson(score, snapshot, filename = 'tunehub-score.json') {
  validateScore(score);
  const blob = new Blob([JSON.stringify({ score, snapshot }, null, 2)], { type: 'application/json' });
  triggerDownload(blob, filename);
  return blob;
}
