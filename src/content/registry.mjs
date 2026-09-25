// SPDX-License-Identifier: Apache-2.0
/** 内容包 registry：只解析精确 packId@version，不做范围推断或跨包依赖。 */

const CORE_VERSION = '1.0.0';
const requiredKinds = ['parts', 'ambientScenes', 'generators', 'sessionStrategies'];

function keyOf(id, version) { return `${id}@${version}`; }

function isCompatible(range) {
  // 首版只接受声明当前 major 的简单范围，避免引入 semver 依赖。
  return typeof range === 'string' && (range === '*' || range.includes('1'));
}

export function validateContentPack(pack) {
  if (!pack?.manifest) throw new Error('内容包缺少 manifest');
  const { manifest } = pack;
  for (const field of ['id', 'version', 'coreCompatibility', 'license', 'provenance']) {
    if (!manifest[field]) throw new Error(`内容包 manifest 缺少 ${field}`);
  }
  if (!isCompatible(manifest.coreCompatibility)) throw new Error(`${manifest.id} 与 core ${CORE_VERSION} 不兼容`);
  const provenance = manifest.provenance;
  if (!provenance.kind || !provenance.statement) throw new Error('provenance 至少需要 kind 与 statement');
  if (['reference', 'measurement'].includes(provenance.kind) && !provenance.sources?.length) {
    throw new Error(`${provenance.kind} 内容必须提供 provenance.sources`);
  }
  for (const kind of requiredKinds) if (!Array.isArray(pack[kind])) throw new Error(`内容包缺少 ${kind}`);
  const ids = new Set();
  for (const kind of requiredKinds) {
    for (const resource of pack[kind]) {
      if (!resource?.id) throw new Error(`${kind} 存在缺少 id 的资源`);
      const id = `${kind}:${resource.id}`;
      if (ids.has(id)) throw new Error(`内容包内重复资源: ${id}`);
      ids.add(id);
    }
  }
  const generatorIds = new Set(pack.generators.map((item) => item.id));
  const strategyIds = new Set(pack.sessionStrategies.map((item) => item.id));
  for (const scene of pack.ambientScenes) {
    if (!generatorIds.has(scene.generatorId)) throw new Error(`场景 ${scene.id} 引用了不存在的 generator`);
    if (!strategyIds.has(scene.sessionStrategyId)) throw new Error(`场景 ${scene.id} 引用了不存在的 sessionStrategy`);
  }
  return pack;
}

export class ContentRegistry {
  constructor() { this.packs = new Map(); }
  register(pack) {
    validateContentPack(pack);
    const key = keyOf(pack.manifest.id, pack.manifest.version);
    if (this.packs.has(key)) throw new Error(`内容包已注册: ${key}`);
    this.packs.set(key, pack);
    return pack;
  }
  resolve(packId, packVersion) {
    const pack = this.packs.get(keyOf(packId, packVersion));
    if (!pack) throw new Error(`缺少内容包 ${keyOf(packId, packVersion)}`);
    return pack;
  }
  resolveSnapshot(snapshot) {
    const pack = this.resolve(snapshot.packId, snapshot.packVersion);
    const scene = pack.ambientScenes.find((item) => item.id === snapshot.sceneId);
    const generator = pack.generators.find((item) => item.id === snapshot.generatorId);
    const strategy = pack.sessionStrategies.find((item) => item.id === snapshot.sessionStrategyId);
    if (!scene || !generator || !strategy) throw new Error('Snapshot 引用的包内资源不存在');
    return { pack, scene, generator, strategy };
  }
}
