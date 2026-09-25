# TuneHub Roadmap

> Do not advance on the assumption that the product is ready if the music does not sound good. Listening quality is the prerequisite for interaction and growth. See [Overview](OVERVIEW.md) and [Architecture](ARCHITECTURE.md).

## Status overview

| Milestone | Status |
|---|---|
| M0 Core extraction | Complete |
| M1 Listening quality | Core constraints and mix chain exist; curated presets and formal listening studies remain |
| M2 Accessible controls | Complete: mood, energy, tempo, lock, reroll, and sharing |
| M2.5 AI integration | Not started: MCP server and Skills |
| M3 First game | Not started |
| M4 Content ecosystem | Built-in reviewed pack exists; broader authoring, import, and contribution workflow remains |
| M5 Export | WAV, stems, MIDI, Score, offline rendering, and range rendering exist; UI and format limitations continue to evolve |
| M6 Advanced tuning | Not started; pitch abstraction exists, but tuning-file import and exploration UI do not |
| M7 Community | Not started |

The current suite has 52 passing Node tests. The browser suite covers the actual Web Audio path. Automated musicality checks are heuristics and do not replace human listening studies.

## M0 — Deterministic core (complete)

The core provides pitch and note-event models, seeded PRNG streams, deterministic generation, audio-clock scheduling, and adapters. Independent random streams prevent a change in one part from perturbing another. Future interface work should be validated with real musical examples; the number of registration hooks is intentionally not frozen.

## M1 — Listening quality (in progress)

The generator uses interval weighting, register separation, harmony constraints, mix processing, multi-section form, and density envelopes. Remaining work includes a broader curated sound palette, listening-validated presets, statistical checks across many seeds, and blind listening studies. The target is sustained listening without unacceptable musical failures. The evaluator can also support future AI feedback, but must not be presented as an objective substitute for listeners.

## M2 — Accessible play (complete)

Mood, energy, and tempo controls map to multiple internal parameters. Users can lock parts, reroll selected parts, mute parts, change scales, and share reproducible state. Continue preserving immediate feedback and beginner-friendly language.

## M2.5 — AI via MCP and Skills (planned)

Build a closed Action protocol and keep proposal separate from application. Invalid actions must be rejected with valid alternatives. Planned tools include capability description, piece evaluation, previews, and deterministic edits. Skills can teach an AI how to recommend and combine trusted content. Add prompt-injection defenses and regression cases. AI must not modify the core or execute generated code; all changes use the same Action path as games and UI.

Acceptance examples: interpret "make it quieter" as a validated energy change; preserve musical constraints; and explain limits honestly when asked for an authentic tradition the system cannot represent.

## M3 — First game (planned)

Rhythm tapping is the proposed first game because it stress-tests the core's ability to accept timed input. The game should schedule input against audio time, expose state at a requested time, recompute incrementally where possible, and record/replay a complete input log. Avoid failure states: timing deviations can alter sound or pitch. A session should be exportable or shareable. Ideally, this form should not require core-specific patches.

## M4 — Content ecosystem (in progress)

The repository contains an early JSON validator and sample pack plus a reviewed TypeScript ESM ambient pack used at runtime. The target authoring workflow should support typed static assets and reviewed code generators, with JSON retained for validated interchange. Define provenance and license checks, exact pack versions, compatibility, contribution review, optional preset editing, and safe visualizer extensions. Do not load executable code from arbitrary URLs.

## M5 — Export and sound sources (in progress)

Current exports include WAV, per-part stems, editable Standard MIDI, and a canonical Score format. Continue improving range selection, tails and fades, MIDI microtonal-loss reporting, and sound palette breadth. Possible future work includes MP3/Opus, AudioWorklet instruments, and sample-based instruments; assess licensing before adding dependencies.

## M6 — Advanced tuning (planned)

Explore ratio, cents, equal-division, and measured tunings; import Scala `.scl`/`.kbm` files; add advanced tuning comparisons and honest provenance. Use a few well-sourced examples to validate the model. Do not market comprehensive coverage of world music systems.

## M7 — Community (on demand)

Possible work includes more games, piece storage and forking, attribution, contribution requests, terms for user-generated content, performance, SEO, and accessibility.

## Sequencing

Listening quality gates product expansion. M4 and M6 may proceed in parallel. M2.5 and M3 share the Action protocol but can be built independently. Game and AI acceptance may reveal missing abstractions in earlier layers; address those at the correct layer rather than adding form-specific core patches.

## Implementation lessons

Previous checks found missing defaults, a computed-but-unused mood parameter, duplicate events crossing range boundaries, nondeterministic reverb/noise, a syntax error in async UI code, and text overflow. Regression tests should verify that parameters actually affect output, deterministic guarantees include noise, and screenshot review covers layout issues tests cannot observe.
