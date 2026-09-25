import { ContentRegistry } from './registry.mjs';
import ambientPack from './packs/tunehub-ambient/index.mjs';

const registry = new ContentRegistry();
registry.register(ambientPack);
export { registry, ambientPack };
