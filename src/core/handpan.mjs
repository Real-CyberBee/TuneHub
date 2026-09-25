// SPDX-License-Identifier: Apache-2.0
/** 手碟 Solo 内容包的独立生成入口，不并入氛围电子场景 Facade。 */

import { handpanSoloPack, registry } from "../content/builtin.mjs";
import { makePieceSnapshot } from "./score.mjs";

const scene = handpanSoloPack.ambientScenes[0];

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

export const HANDPAN_DEFAULT_CONFIG = cloneConfig(scene.config);

export function generateHandpanSegment({
  seed,
  segmentIndex = 0,
  config = {},
  overrides = {},
}) {
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    throw new Error("手碟片段序号必须是非负整数");
  }
  const snapshot = makePieceSnapshot({
    packId: handpanSoloPack.manifest.id,
    packVersion: handpanSoloPack.manifest.version,
    sceneId: scene.id,
    sessionStrategyId: scene.sessionStrategyId,
    generatorId: scene.generatorId,
    seed,
    configOverrides: config,
    voiceOverrides: overrides,
  });
  const { pack, generator, strategy } = registry.resolveSnapshot(snapshot);
  const plan = strategy.plan({ seed, sceneId: scene.id, segmentIndex });
  const resolvedConfig = { ...HANDPAN_DEFAULT_CONFIG, ...config };
  let selected = null;
  for (const takeSeed of plan.takeSeeds) {
    const result = generator.generate({
      seed: takeSeed,
      config: resolvedConfig,
      voiceOverrides: overrides,
      parts: pack.parts,
    });
    if (
      !selected ||
      result.legacyPiece.stats.pleasantness >
        selected.legacyPiece.stats.pleasantness
    ) {
      selected = result;
    }
    if (result.legacyPiece.stats.verdict === "good") {
      selected = result;
      break;
    }
  }
  return {
    ...selected.legacyPiece,
    score: selected.score,
    snapshot,
    handpan: {
      sceneId: scene.id,
      segmentIndex,
      segmentCount: 1,
      lastSegmentIndex: segmentIndex,
      baseSeed: seed,
      segmentSeed: plan.segmentSeed,
      packId: pack.manifest.id,
      packVersion: pack.manifest.version,
    },
  };
}

/** 把下一段接在同一条音频时间线上，保留前段尚在振动的模态尾音。 */
export function appendHandpanSegment(timeline, segment) {
  if (!timeline) {
    return {
      ...segment,
      events: segment.events.map((event) => ({ ...event })),
      handpan: { ...segment.handpan, segmentCount: 1, lastSegmentIndex: segment.handpan.segmentIndex },
    };
  }
  if (segment.handpan.segmentIndex !== (timeline.handpan.lastSegmentIndex ?? 0) + 1) {
    throw new Error("手碟片段序号不连续");
  }
  const offset = timeline.totalSeconds;
  const prefix = `${segment.handpan.segmentIndex + 1}·`;
  return {
    ...timeline,
    config: {
      ...timeline.config,
      sections: timeline.config.sections.concat(
        segment.config.sections.map((section) => ({
          ...section,
          name: `${prefix}${section.name}`,
        })),
      ),
    },
    events: timeline.events.concat(
      segment.events.map((event) => ({
        ...event,
        time: event.time + offset,
        section: `${prefix}${event.section}`,
      })),
    ),
    totalBars: timeline.totalBars + segment.totalBars,
    totalSeconds: offset + segment.totalSeconds,
    handpan: {
      ...timeline.handpan,
      segmentCount: (timeline.handpan.segmentCount ?? 1) + 1,
      lastSegmentIndex: segment.handpan.segmentIndex,
    },
  };
}
