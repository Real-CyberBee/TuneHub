# TuneHub Architecture

> Three principles: a small, capable core; content represented as data or code as appropriate; and one Action path for every interaction form.

## 1. Layers

```text
L4 Forms       Generator UI | Games | AI | Canvas | Teaching
                 │ Action protocol
L3 Visualizers Pure functions: score + context -> rendering
L2 Content     Versioned packs: tunings, scales, generators, parts, instruments, timbres, themes
L1 Core        PRNG, events, operators, scheduler, registry, adapter interfaces
```

The core API follows semantic versioning; breaking changes require an RFC. Content packs can version independently and use stable IDs for compatibility and reproducibility. Forms are independently released. L2 and L4 depend on L1, not directly on each other.

## 2. Core model

### 2.1 Pitch

Pitch must not be reduced to an integer MIDI note. TuneHub's model supports ratios, cents, equal divisions of the octave, and absolute measured frequencies. This is necessary for microtonal intervals and measured ensemble tunings. The UI may display note names; the core retains the actual pitch representation.

```ts
type Pitch =
  | { kind: 'ratio'; num: number; den: number; ref: number }
  | { kind: 'cents'; cents: number; ref: number }
  | { kind: 'edo'; step: number; divisions: number; ref: number }
  | { kind: 'absolute'; hz: number };
```

### 2.2 Musical concepts

Tuning maps pitch to frequency; a scale selects pitches; a framework describes how pitches are used; rhythm places sound in time. These terms describe different questions but are not required to map one-to-one onto extension interfaces. Tunings and scales are often reusable static data. Framework, rhythm, ornament, and technique may be coupled and handled by one generator. Extract separate assets when there is clear reuse.

### 2.3 Piece and determinism

```ts
type Piece = { seed: number; config: Config; inputLog: Action[] };
```

The seed, configuration, and input log support replay, undo, audit, sharing, and offline rendering. The core must use injected seeded PRNGs rather than bare `Math.random()`, schedule sound against the audio clock rather than `setTimeout`, and declare operator lookback/lookahead windows where incremental recomputation needs them. The implementation uses a `mulberry32` sequence and `splitmix32`-derived independent streams for parts and operators.

## 3. Content packs and extension points

Content concepts do not imply a fixed number of registration interfaces. Static material should use typed constants. Dynamic behavior can be implemented in reviewed modules that use a stable core interface. TypeScript types are authoring aids, not a security sandbox. Do not execute untrusted code fetched from arbitrary URLs. JSON remains a validated import/export format. Registries use namespaced IDs and exact `id@version` references. Optional style presets can bind assets and generators but are not mandatory.

| Content | Suggested representation |
|---|---|
| Tuning, scale, instrument capability, timbre | Typed constants |
| Coupled framework, rhythm, ornament, technique | A generator module; extract assets when useful |
| Optional style preset | Typed definition referencing trusted assets and generators |
| Visualizer or operator | Reviewed module behind a constrained interface |
| Game or AI form | Separate application |

A generator may coordinate related decisions in one place:

```ts
export function generatePhrase(context: GeneratorContext, rng: SeededRandom): NoteEvent[] {
  return makePhrase(context, rng);
}
```

The current event model may need extension to represent specific ornaments and techniques. Validate proposed types with real examples before freezing them.

### Parts, instruments, timbres

A **part** is a musical line or arrangement role such as bass or percussion. An **instrument** describes playable capabilities and its sound implementation. A **timbre** is the selected sound or synthesis recipe. Generators may read instrument capabilities; audio adapters render events through the associated implementation. The MVP does not yet fully separate these concepts: `NoteEvent.voice` identifies a part, while patches are selected partly by voice name.

### Provenance, trust, and license

Every content item must state its sources, accuracy, limitations, and license. Types can require fields and validation can catch omissions, but neither proves that a citation is authentic. Human review remains necessary. Static material is straightforward to inspect. Executable modules require code review, dependency and license checks, compatibility checks, performance checks, and appropriate isolation. A pure-function convention alone is not a sandbox.

## 4. Action protocol

The Action protocol is the only mutation path for UI, games, and AI. Its initial closed verb set is:

```text
generate reroll lock unlock setParam setVoice setStructure
applyStyle setTuning play stop renderRange export
```

This is a verb list, not a programming language: no nesting, conditions, loops, or variables. The human-readable text form supports review and diffs:

```text
piece v1 seed=7f3a91c2
@action setParam key=energy value=0.72
@action reroll targets=voice:melody
```

Validate syntax, references, ranges, semantic conflicts, and safety. Unknown actions must be rejected rather than silently ignored. The format is versioned; actions are additive, and old shared links must remain readable.

## 5. Technology and licensing

The MVP currently uses native ES modules and Web Audio with no runtime dependencies. Earlier architecture research evaluated Tone.js, sonic-weave, Tonal.js, smplr, Meyda, Scala formats, and visualization libraries; those are options, not current runtime dependencies. Keep production dependency licensing explicit and reject incompatible GPL/AGPL additions unless the project intentionally changes its licensing position.

Source code uses Apache-2.0. Content packs may need item-level content licenses; executable modules need software licenses. A separate content repository may make independent review and release easier. Research datasets such as CompMusic, Saraga, or Dunya must not be redistributed where their terms prohibit it. Cite measurements and respect source licenses.

## 6. Target package layout

The longer-term monorepo may separate `core`, content schemas, audio adapters, export adapters, visualizer primitives, registry, MCP server, apps, Skills, and contribution templates. The current repository is a compact MVP and does not yet have this package layout.

## 7. Architecture acceptance criterion

Adding a new form (game, AI, canvas, or teaching experience) should not require changes to L1–L3. If it does, identify and correct the missing abstraction rather than adding form-specific patches to the core.
