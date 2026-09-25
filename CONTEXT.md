# TuneHub Musical Content Glossary

This glossary defines how TuneHub uses the terms tuning, scale, framework, rhythm, part, instrument, timbre, and style. These terms describe different musical questions; they do not require one-to-one or independent code interfaces.

## Terms

**Tuning:** A system that maps pitches to frequencies, such as equal divisions, ratios, or measured tuning.

**Scale:** A selected collection of pitches available within a tuning.

**Framework:** Musical rules for using pitches in melodies and phrases, such as ascending or descending movement, emphasis, and characteristic phrases.

**Rhythm:** The organization of sounds in time, including beats, cycles, and accents.

**Part:** A musical line or arrangement role, such as bass, melody, or percussion.

**Instrument:** A playable entity that has or references performance capabilities and a sound implementation. A part can be assigned to an instrument.

Avoid treating an instrument as synonymous with a part or a timbre.

**Timbre:** A sound choice or recipe used by an instrument or sound implementation. One instrument can have multiple timbres.

Avoid treating a timbre recipe as a complete instrument definition.

**Style preset:** An optional user-facing combination that may bind a default tempo, generator code, part-to-instrument assignments, timbres, and other parameters. Framework, rhythm, ornamentation, and technique may be coupled and can be implemented together in generator code.

Avoid treating a style preset as the only container for all musical rules, or requiring related concepts to be split into independent extension interfaces.
