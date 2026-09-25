# TuneHub Documentation

TuneHub is an open-source, browser-first ambient electronic music studio. This directory contains the product overview, architecture, roadmap, content-pack format, and scene-design research.

## Start here

- [Project README](../README.md): run the app, use the current features, and run verification.
- [Overview](OVERVIEW.md): product goals, interaction model, AI integration, and content philosophy.
- [Architecture](ARCHITECTURE.md): core model, content packs, actions, and technical boundaries.
- [Roadmap](ROADMAP.md): milestones, current status, and acceptance criteria.
- [Ambient architecture](AMBIENT_ARCHITECTURE.md): the scene-based ambient electronic music implementation.
- [Content packs](CONTENT_PACKS.md): pack metadata, validation, and portable score exports.
- [Scene sound-design research](AMBIENT_SCENE_SOUND_DESIGN_RESEARCH.md): evidence-informed scene profiles and listening guidance.
- [Examples and contribution guide](../examples/README.md): legacy JSON examples and content contribution workflow.

Chinese translations are maintained separately under [`docs/zh-CN/`](zh-CN/). Historical research notes remain in [`docs/archive/`](archive/); Chinese source copies are also available under [`docs/zh-CN/archive/`](zh-CN/archive/).

## Current status

The MVP includes deterministic generation, browser playback, scene-based ambient electronic music, endless playback, and WAV, stems, MIDI, and Score exports. AI/MCP integration, the first game, and the broader community content workflow are not yet implemented. See the roadmap for details.

## Local checks

```bash
node --test 'tests/*.test.mjs'
python3 examples/validate.py examples/content-pack
```
