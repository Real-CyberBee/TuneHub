# TuneHub Overview

TuneHub is an open-source, browser-first music generation platform. It aims to make music creation approachable for beginners while giving musicians and contributors room to explore deeper ideas.

## 1. Product

TuneHub began as a small demo that triggered random notes across four parts. Its central idea remains: **music can be created by shaping randomness with useful constraints**. The demo is a starting point, not a product template. Product success depends first on two questions: does it sound good, and is it fun to use?

The goals, in order, are:

1. **Enjoyable and playful:** people with no music knowledge can create or play music immediately.
2. **Contributable:** static material can be expressed as typed constants; coupled musical behavior can be implemented in code.
3. **Multi-form:** games, AI clients, and teaching tools can consume the same deterministic core.

## 2. Priorities

1. Listening quality: music must be worth continuing to hear.
2. Interaction: zero setup and immediate feedback.
3. Play: approachable games and natural-language interfaces.
4. Generator breadth.
5. Compatibility with musical systems such as tunings and traditions. This is an architectural capability, not a marketing claim.

## 3. Design principles

- Treat listening quality as an engineering problem: weighted generation, a mix chain, and listening validation.
- Keep beginner controls human-readable: mood, energy, tempo, lock, and reroll. Advanced parameters can remain available deeper in the interface.
- AI is a language interface, not a black-box composer. It proposes actions and never edits the score directly.
- Keep the core stable. Choose typed data or code according to the content being expressed; JSON is an interchange format, not the required source format.
- Make randomness reproducible. A piece is determined by its seed, configuration, and input log.
- Compose constraints as reusable operators rather than scattered special cases.
- Support musical systems in the architecture without claiming comprehensive cultural representation. State approximations and limitations explicitly.

## 4. Interaction ladder

TuneHub is a gradual path rather than a split between "simple" and "professional" modes:

| Level | Interaction |
|---|---|
| 0 | Press play and hear music. |
| 1 | Adjust mood, energy, and tempo. |
| 2 | Lock one part and reroll another. |
| 3 | Mute or layer parts. |
| 4 | Inspect detailed parameters. |
| 5 | Explore tunings, generators, operator chains, and DSP. |

Games and natural language are parallel interaction forms. The controls remove the need to know music theory; AI can remove the need to know which control to use.

## 5. AI integration

The product direction is an MCP server and Skill, with no built-in chat interface. The user can ask an AI client to make a piece; the AI invokes TuneHub tools.

```text
Natural language ─┐
Game input ────────┼─> Action protocol -> input log -> deterministic core -> audio
AI proposal ──────┘
```

AI never edits notes directly. This keeps results reproducible, makes actions reviewable and reversible, and avoids executing model-generated code. `propose_actions` and `apply_actions` should be separate: validate proposals and report usable alternatives before applying them. `evaluate_piece` provides objective metrics because a language model cannot hear the output. MCP provides tools; human-authored Skills provide recommendations.

The tool set must be a closed set of declarative actions, never a general-purpose execution environment. The local experience must remain useful without AI.

## 6. Product space

Web Audio synthesis and random music generators are common. TuneHub's intended distinction is that users can hear differences across musical systems, contributors can choose data or code, and games and AI are first-class consumers of the core. Prior art such as generative.fm also highlights the need to review code contributions and define execution boundaries.

## 7. Content model

The core provides stable mechanisms; content packs provide reusable musical material, rules, and metadata. Packs can include static definitions, code generators, and optional presets. A generator may coordinate melody, rhythm, ornamentation, and playing technique when those dimensions affect one another.

Use typed constants for stable definitions such as tunings, scales, measurements, instrument capabilities, and timbre parameters. Use code when behavior needs coordinated decisions. A part is an arrangement role; an instrument describes capabilities and sound implementation; a timbre selects a particular sound. Split reusable patterns into separate assets only when reuse is clear. Every item needs provenance, accuracy, limitations, and license metadata. Imported JSON requires runtime validation, and executable extensions require review and isolation.

The current `PATCHES` table contains synthesis recipes, not complete instrument definitions. Voice/part and timbre selection are still coupled in parts of the MVP.

## 8. Out of scope

- Built-in AI chat interface (MCP server and Skill only).
- Real-time multi-user collaboration.
- ML music-generation models.
- Marketing claims based on broad world-music coverage.
- Generators that reduce oral traditions to scales.
- A full DAW or non-12-TET staff notation.

## 9. Decisions and references

Apache-2.0 is the project license. A separate content repository is recommended because content licensing and release cadence differ from code. Rhythm tapping is the proposed first game. See [Architecture](ARCHITECTURE.md), [Roadmap](ROADMAP.md), and the historical research notes in `archive/`.
