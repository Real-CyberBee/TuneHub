# TuneHub: Ambient Electronic Music Studio

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![No runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen.svg)](#run-locally)
[![Tests](https://img.shields.io/badge/tests-52%20passing-brightgreen.svg)](#verification)

> **Make ambient electronic music in a few clicks.** An open-source, browser-first music generation studio.
>
> Chinese documentation:(docs/zh-CN/README.md)。

![TuneHub interface](docs/screenshot.png)

## Features

TuneHub opens with a complete piece and is designed for people without music theory knowledge.

| Action | Result |
|---|---|
| Press **Play** | Listen to the current piece. |
| Adjust **mood, energy, and tempo** | Regenerate immediately with updated musical character. |
| Select a listening scene | Generate scene-specific ambient electronic music. |
| Press **Reroll** | Create a new piece while keeping locked parts unchanged. |
| Mute or lock a part | Keep the parts you like and regenerate the rest. |
| Change scale | Hear a different scale with the same seed. |
| Copy a share link | Share the complete piece state; no server is required. |
| Export WAV, stems, MIDI, or Score | Render audio or take the piece into a DAW and other tools. |
| Enable endless mode | Continue with reproducible segments scheduled without playback gaps. |

## Run locally

```bash
python3 serve.py
```

Then open <http://127.0.0.1:8765/>. A local server is required because the app uses ES modules; opening `index.html` with `file://` is blocked by browser CORS rules.

The application has no build step or runtime dependencies. It uses native ES modules and Web Audio.

## Verification

```bash
node --test 'tests/*.test.mjs'
node tests/run-browser-check.mjs http://127.0.0.1:8765
```

The browser checks exercise paths that Node alone cannot cover: `OfflineAudioContext` range rendering, WAV encoding and decoding, audible realtime playback, and range slicing. The check page is also available at <http://127.0.0.1:8765/tests/browser.html>.

## How generation stays musical

Uniformly random parameters tend to create register clashes, dissonant collisions, and uncontrolled density. TuneHub constrains generation from the start:

- Weighted interval selection favors fifths, fourths, thirds, and sixths while greatly reducing seconds, tritones, and major sevenths.
- Strict registers separate bass, harmony, and melody.
- Each part receives an independent random stream, so changing one part does not perturb the others.
- A multi-section form, density envelopes, and gradual tonal movement provide large-scale shape.
- A mix chain provides bus compression, limiting, per-part filtering, and deterministic convolution reverb.

The displayed musicality score summarizes weighted dissonant collisions, density spikes, and unison collisions. Kernel tests evaluate fixed seeds and musical constraints; a score is a heuristic, not a substitute for listening studies.

## Architecture

```text
src/core/     Deterministic generation with no DOM or audio dependency
src/audio/    Native Web Audio playback, rendering, and export adapters
src/content/  Versioned, reviewed content packs and registry
src/ui/       Interface and user actions
```

The core avoids unseeded `Math.random()`, schedules sound against the audio clock rather than `setTimeout`, and derives noise from seeds. A shareable piece is represented by its seed, configuration, and part-seed overrides.

Content can use typed static definitions or code when musical behavior needs to coordinate melody, rhythm, ornamentation, and playing technique. Part is an arrangement role; instrument describes playable capabilities and sound implementation; timbre is a specific sound choice. JSON remains an import/export format. See the [architecture](docs/ARCHITECTURE.md) and [content-pack guide](docs/CONTENT_PACKS.md).

## Repository map

```text
index.html                   Browser application
serve.py                     Local static server
src/core/                    Generation, model, and reproducible session logic
src/audio/                   Web Audio, playback, and export formats
src/content/                 Built-in content packs and registry
src/ui/                      Interface and styles
tests/                       Kernel, audio, and browser checks
docs/                        English product and technical documentation
docs/zh-CN/                  Chinese translations
docs/archive/                Historical research notes
examples/                    Legacy JSON examples and validator
prototype/                   Read-only original demo
```

## Current limitations

The MVP includes deterministic generation, scene-based ambient electronic music, endless playback, and WAV, stems, MIDI, and Score exports. The broader content-pack authoring workflow, AI/MCP server, first game, and advanced tuning interface remain future work. The generator currently has a small sound palette and has not been validated through formal blind listening studies. See the [roadmap](docs/ROADMAP.md).

## Decisions and license

The project is licensed under [Apache License 2.0](LICENSE) (see also [NOTICE](NOTICE)). Runtime code has no third-party dependencies. `prototype/original-demo.html` is a historical starting point and is not original TuneHub code.
