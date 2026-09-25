import { ContentRegistry } from './registry.mjs';
import ambientPack from './packs/tunehub-ambient/index.mjs';
import handpanSoloPack from './packs/handpan-solo/index.mjs';

const registry = new ContentRegistry();
registry.register(ambientPack);
registry.register(handpanSoloPack);
export { registry, ambientPack, handpanSoloPack };
