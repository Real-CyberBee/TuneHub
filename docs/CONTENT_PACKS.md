# Content Packs and Portable Exports

`@tunehub/ambient@1.0.0` is the first built-in content pack. It ships as a reviewed static ESM module; the application does not download or execute third-party code from arbitrary URLs.

## Pack contract

A pack declares `id`, `version`, `coreCompatibility`, license, and provenance. The registry resolves exact `packId@version` references and rejects cross-pack references. Registration validates the manifest, resource IDs, local scene-to-generator and scene-to-strategy references, and compatibility range.

Pack resources include:

- **AmbientScene:** curated scene metadata and default configuration.
- **Arrangement profile:** scene-specific musical roles, rhythmic grid, melodic intervals and durations, and reverb space. The generator reads these declarations rather than branching on scene IDs.
- **Part:** musical capability and default rendering hints. Events refer to semantic parts rather than embedding audio-engine details.
- **Generator:** deterministic note-event production from a snapshot and seeded random source.
- **Session strategy:** deterministic continuation rules for an endless session.

## Reproducibility and exports

A shareable snapshot identifies the pack by exact version and records the scene, seed, and user parameters. This keeps old links meaningful when a pack evolves. The canonical Score preserves musical timing and pitch representation; adapters can project it to MIDI or render it to audio. MIDI is an editable interchange format and may not preserve every microtonal detail. The Score export retains TuneHub-specific timing and pitch metadata for lossless round trips.

## Trust and licensing

Static packs are reviewed and built with the application. TypeScript types help authors but are not a runtime sandbox. Any imported JSON must pass runtime validation. Executable extensions require code review, dependency and license checks, compatibility checks, and an explicit execution boundary. Every resource must identify its sources, accuracy, limitations, and license; metadata completeness does not establish source authenticity, which still requires human review.
