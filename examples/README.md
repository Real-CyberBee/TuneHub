# Content Pack Examples and Contribution Guide

The examples demonstrate typed constants, reviewed generator modules, and JSON interchange. The files under `content-pack/` are legacy JSON/schema examples; `validate.py` currently validates that format only. They are not connected as runtime packs. The built-in TypeScript ESM ambient pack is the current runtime example.

## Validate the legacy JSON examples

```bash
python3 examples/validate.py examples/content-pack
```

The validator checks required structure, provenance fields, cross-file references, and basic scale/rhythm constraints. It cannot verify source authenticity or whether the result sounds good.

## Legacy JSON layout

```text
content-pack/
├── tunings/      theoretical and measured tunings
├── scales/       pitch collections
├── frameworks/   older examples of melodic behavior
├── rhythms/      step patterns
├── styles/       combinations of voices and structure
├── voices/       legacy timbre recipes, not complete instruments or arrangement parts
└── themes/       visual themes
```

This layout is historical and does not prescribe the future content taxonomy. A generator may jointly express melody, rhythm, ornamentation, and technique. Extract separate assets only when independent reuse is useful.

## Choosing a representation

| Need | Suggested representation |
|---|---|
| Reusable tuning, scale, measurement, instrument capability, or timbre | Typed static definition |
| Pitch, rhythm, ornament, and playing technique that affect each other | One reviewed generator module |
| A one-click combination for users | Optional preset referencing trusted content and generators |
| Cross-language interchange | JSON with runtime validation |

Part means an arrangement role; instrument means performance capability and sound implementation; timbre means a particular sound recipe. The MVP does not fully separate all three yet.

## Required metadata

Every contribution needs stable unique IDs, localized names where relevant, provenance sources, an honest accuracy label, limitations, and a license. A schema can check whether fields are present, but people must verify citations and permissions. Mark approximations honestly. Research-only datasets must not be redistributed where their terms prohibit it.

## Contribution checklist

- IDs are unique and use the pack's naming convention.
- Names include English (`en`) and other supported languages where available.
- Sources, accuracy, limitations, and license are recorded.
- JSON examples pass `python3 examples/validate.py <directory>`; typed packs pass type and runtime validation.
- Code generators use seeded randomness and reviewed interfaces; dependencies and licenses are checked.
- The result has been auditioned. Automated checks cannot determine whether it sounds good.

The legacy examples contain placeholder academic sources, including `example.org` links. Replace them with verifiable measurements or authoritative publications before treating them as production content. The old `voiceRef` sample points to a timbre recipe; it is not a part or complete instrument definition.
