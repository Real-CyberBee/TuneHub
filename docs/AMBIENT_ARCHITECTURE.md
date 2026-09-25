# Ambient Electronic Music Pilot Architecture

The ambient electronic music pilot is TuneHub's first complete content-to-generation-to-playback slice. It offers selectable listening scenes and provides a reusable pattern for future games, AI clients, and community packs.

## Goals and boundaries

- Users begin with a listening context such as reading, chores, dinner, driving, rest, a party, exercise, or video scoring instead of facing abstract controls.
- Scenes provide curated metadata and generation configuration. Note generation remains in `src/core/generate.mjs`.
- Endless playback must be reproducible and scheduled ahead of the segment boundary, without a stop/play gap.
- The core has no DOM, `AudioContext`, wall-clock dependency, or new runtime dependency.

## Module responsibilities

```text
src/content/                  Reviewed content packs and registry
src/core/ambient.mjs           Scene lookup, snapshots, segment seeds, timeline joins
src/core/generate.mjs          Deterministic NoteEvent generation and musical evaluation
src/audio/player.mjs           Audio-clock scheduling and future-only timeline extension
src/ui/app.mjs                 Scene selection, controls, endless mode, sharing, visualization
```

Each scene has a stable ID, presentation metadata, tags, and public generation configuration. It contains no UI callbacks or audio implementation. `ambientConfig()` returns a deep copy so user edits cannot mutate registered content.

## Reproducible endless sessions

A shared session records the base seed, scene ID (`a`), parameters, and endless-mode flag (`x`). Segment zero uses the base seed; later segment seeds are derived from the base seed, scene ID, and segment index. Each segment tries up to eight deterministic takes, selecting the first with a `good` verdict or otherwise the highest musicality score.

The UI generates the next segment with 12 seconds remaining. `appendAmbientSegment()` offsets the new events and returns an extended timeline; `Player.extend()` replaces only future events. Audio already scheduled in Web Audio is not rewritten. Turning endless mode off lets the scheduled timeline finish naturally.

## Reuse guidelines

1. Define stable content IDs and reviewable metadata; keep product decisions out of UI code.
2. Feed configuration to a pure generator so the work remains a function of seed and configuration.
3. For continuous playback, use deterministic segment indices and append-only timelines; do not use timers or random continuation.
4. Test content coverage, determinism, and timeline joins. Keep browser checks for the actual audio path.

This pilot does not freeze the general content-pack API. A generator for a musical tradition may need to coordinate rhythm, ornamentation, and playing technique. The pilot establishes a smaller contract: content is selectable, configuration is consumable by a generator, and output can play continuously.
