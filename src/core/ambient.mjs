// SPDX-License-Identifier: Apache-2.0
/** L2 氛围 content-pack 的兼容 Facade；此处不保存音乐审美数据。 */

import { ambientPack, registry } from "../content/builtin.mjs";
import { makePieceSnapshot } from "./score.mjs";

export const AMBIENT_SCENES = ambientPack.ambientScenes;

/** 内容包配置只含 JSON 数据；递归复制防止 UI 微调反向污染内置策展内容。 */
function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

export function getAmbientScene(id) {
  return AMBIENT_SCENES.find((scene) => scene.id === id) ?? AMBIENT_SCENES[0];
}

export function ambientConfig(sceneId) {
  return cloneConfig(getAmbientScene(sceneId).config);
}

export function ambientSegmentSeed(seed, sceneId, segmentIndex = 0) {
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0)
    throw new Error("氛围片段序号必须是非负整数");
  return segmentIndex === 0 ? seed : `${seed}:${sceneId}:${segmentIndex}`;
}

export function makeAmbientSnapshot({
  seed,
  sceneId = "reading",
  configOverrides = {},
  voiceOverrides = {},
  mode = "finite",
}) {
  const scene = getAmbientScene(sceneId);
  return makePieceSnapshot({
    packId: ambientPack.manifest.id,
    packVersion: ambientPack.manifest.version,
    sceneId: scene.id,
    sessionStrategyId: scene.sessionStrategyId,
    generatorId: scene.generatorId,
    seed,
    configOverrides,
    voiceOverrides,
    mode,
  });
}

export function generateAmbientSegment({
  seed,
  sceneId = "reading",
  segmentIndex = 0,
  config = {},
  overrides = {},
}) {
  const snapshot = makeAmbientSnapshot({
    seed,
    sceneId,
    configOverrides: config,
    voiceOverrides: overrides,
  });
  const { pack, scene, generator, strategy } =
    registry.resolveSnapshot(snapshot);
  const plan = strategy.plan({ seed, sceneId: scene.id, segmentIndex });
  const resolvedConfig = { ...ambientConfig(scene.id), ...config };
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
    )
      selected = result;
    if (result.legacyPiece.stats.verdict === "good") {
      selected = result;
      break;
    }
  }
  return {
    ...selected.legacyPiece,
    score: selected.score,
    snapshot,
    ambient: {
      sceneId: scene.id,
      segmentIndex,
      baseSeed: seed,
      segmentSeed: plan.segmentSeed,
      packId: pack.manifest.id,
      packVersion: pack.manifest.version,
    },
  };
}

export function appendAmbientSegment(timeline, segment) {
  if (!timeline)
    return {
      ...segment,
      events: segment.events.map((event) => ({ ...event })),
      ambient: { ...segment.ambient, segmentCount: 1 },
    };
  const offset = timeline.totalSeconds;
  return {
    ...timeline,
    config: {
      ...timeline.config,
      sections: timeline.config.sections.concat(
        segment.config.sections.map((section) => ({
          ...section,
          name: `${segment.ambient.segmentIndex + 1}·${section.name}`,
        })),
      ),
    },
    events: timeline.events.concat(
      segment.events.map((event) => ({
        ...event,
        time: event.time + offset,
        section: `${segment.ambient.segmentIndex + 1}·${event.section}`,
      })),
    ),
    totalBars: timeline.totalBars + segment.totalBars,
    totalSeconds: offset + segment.totalSeconds,
    ambient: {
      ...timeline.ambient,
      segmentCount: (timeline.ambient?.segmentCount ?? 1) + 1,
      lastSegmentIndex: segment.ambient.segmentIndex,
    },
  };
}
