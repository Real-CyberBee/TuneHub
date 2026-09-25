# Ambient Scene Sound Design Research

This research proposes evidence-informed starting points for eight ambient electronic music scenes. It addresses a current product limitation: scenes that only vary BPM, energy, or mood can still sound too similar.

## 1. How to use the evidence

Research findings are constraints and context, not guarantees that music improves performance, mood, sleep, or safety for every listener. Scene defaults below are editorial starting points. Keep preferences adjustable and distinguish direct experimental evidence from design choices. In particular, do not frame driving music as a safety aid, or party music as a way to encourage drinking.

## 2. Scene design cards

### Reading

Preferred music may support some listeners, but background music can distract during cognitive work, especially depending on task and listener. Begin with 60–80 BPM, sparse midrange activity, soft attacks, and no prominent vocal-like lead. Use a stable 4/4 or 6/8 pulse, long pads, restrained keyboard or pluck, and motifs with few large leaps. Expose melody prominence and percussion as controls.

### Chores

Work-performance research is adjacent evidence rather than direct evidence for every household task. Offer a clear but not aggressive pulse around 100–120 BPM, repeated bass and percussion, and short call-and-response motifs. Avoid abrupt transitions. Let listeners adjust tempo and rhythmic density to the task.

### Dinner

Restaurant field research suggests that background music tempo can relate to dining behavior, but does not establish one ideal setting for everyone. Start around 80–105 BPM with moderate loudness, warm timbres, and conversational space. Keep high-frequency percussion and busy melodies restrained; allow the listener to choose liveliness.

### Driving

Simulator and human-factors studies investigate tempo and driving behavior, but do not support universal safety claims. Use a steady, moderate pulse, modest dynamics, restrained transients, no siren-like sounds, and no sudden silence. Do not automatically change tempo. Make the product clear that it is entertainment, not a driving-safety intervention.

### Rest

Sleep and relaxation studies vary in participant, intervention, and outcome. Offer a slow, low-density range around 54–72 BPM, soft attacks, minimal high frequencies, sparse melody, and gradual release. Avoid sudden silence, loud events, or a strong final cadence. Let users control duration and intensity.

### Party

Groove research suggests a nonlinear relationship between syncopation and pleasure; maximal rhythmic complexity is not necessarily best. Start around 116–126 BPM with a clear four-beat pulse, moderate syncopation, bass, kick, claps, and short melodic hooks. Build energy through arrangement rather than continuous acceleration. Avoid messaging that encourages alcohol consumption.

### Exercise

Exercise studies distinguish tempo, loudness, synchronization, and cadence; a single energy control cannot represent them all. Offer a stable 128–150 BPM range and half-time, on-time, or double-time pulse interpretations. Do not change tempo during use unless the listener explicitly selects an interval plan. Keep headroom and avoid sustained distortion.

### Video scoring

Film-score studies show that music can influence emotional interpretation and attention. Provide selectable tempo ranges rather than one default, fixed timing grids for editing, modular 2/4/8-bar themes, and section markers such as entrance, build, transition, and ending. Offer dry or controlled reverb and export parts/markers for editing.

## 3. Candidate profile schema

Current scenes expose broad controls such as mood, energy, BPM, scale, and sections. A declarative `musicProfile` can capture richer scene differences while keeping generation and rendering separate:

```js
{
  tempo: { defaultBpm: 68, minBpm: 54, maxBpm: 72, meter: '4/4', allowTempoChange: false },
  rhythm: { grid: '1/8', pulse: 'subtle', syncopation: 'low', fillEveryBars: 0 },
  density: { notesPerBar: [1, 4], silenceBarsEvery: [8, 16] },
  melody: { range: 'mid', maxLeapSemitones: 4, motifBars: 4, entrance: 'rare' },
  dynamics: { targetLufs: 'quiet', peakChangeBars: 4, transient: 'soft' },
  palette: { instruments: ['warm-pad', 'soft-keys'], effects: ['low-pass', 'long-reverb'] },
  arrangement: { energyArc: 'settle', markers: ['enter', 'rest', 'tail'] },
  safety: { forbid: ['siren-like', 'sudden-silence'] },
}
```

This profile should use semantic roles; audio adapters map those roles to concrete patches. The canonical Score should preserve parts, pitch, dynamics, time, and markers so another renderer can be substituted. Scene-specific roles may include drone, pulse, texture, hook, and impact. Mark optional texture and impact roles as disableable. Avoid assigning cultural or regional scales to generic everyday scenes without reliable provenance and an appropriate musical context.

## 4. Validation order

1. Implement visibly different profiles that affect rhythm, density, register, and timbre; label-only changes do not count.
2. Add fixed-seed tests for BPM, enabled parts, event density, melodic leap limits, markers, and forbidden effects.
3. Conduct listening and task-context studies. Record perceived distraction, pulse fit, fatigue, and opt-out behavior. Test driving only in a safe simulator.
4. Keep tempo, loudness, percussion, texture, and melody prominence adjustable. Research supports considering these dimensions; it does not justify removing listener choice.

## Sources

1. Husain, Thompson & Schellenberg (2002), “Effects of Musical Tempo and Mode on Arousal, Mood, and Spatial Abilities,” *Music Perception*. [DOI](https://doi.org/10.1525/mp.2002.20.2.151)
2. Perham & Currie (2014), “Does listening to preferred music improve reading comprehension performance?”, *Applied Cognitive Psychology*. [DOI](https://doi.org/10.1002/acp.2994)
3. Furnham & Bradley (1997), “Music while you work: The differential distraction of background music…”, *Applied Cognitive Psychology*. [DOI](https://doi.org/10.1002/(SICI)1099-0720(199710)11:5%3C445::AID-ACP472%3E3.0.CO;2-R)
4. Milliman (1986), “The Influence of Background Music on the Behavior of Restaurant Patrons,” *Journal of Consumer Research*. [DOI](https://doi.org/10.1086/209068)
5. Brodsky (2001), “The effects of music tempo on simulated driving performance and vehicular control,” *Transportation Research Part F*. [DOI](https://doi.org/10.1016/S1369-8478(01)00025-0)
6. Harmat, Takács & Bódizs (2008), “Music improves sleep quality in students,” *Journal of Advanced Nursing*. [DOI](https://doi.org/10.1111/j.1365-2648.2008.04602.x)
7. Karageorghis et al. (2009), “Psychophysical and Ergogenic Effects of Synchronous Music during Treadmill Walking,” *Journal of Sport and Exercise Psychology*. [DOI](https://doi.org/10.1123/jsep.31.1.18)
8. McElrea & Standing (1992), “Fast Music Causes Fast Drinking,” *Perceptual and Motor Skills*. [DOI](https://doi.org/10.2466/pms.1992.75.2.362)
9. Boltz (2001), “Musical Soundtracks as a Schematic Influence on the Cognitive Processing of Filmed Events,” *Music Perception*. [DOI](https://doi.org/10.1525/mp.2001.18.4.427)
10. Du et al. (2020), “The effects of background music on neural responses during reading comprehension,” *Scientific Reports*. [DOI](https://doi.org/10.1038/s41598-020-75623-3)
11. Lesiuk (2005), “The effect of music listening on work performance,” *Psychology of Music*. [DOI](https://doi.org/10.1177/0305735605050650)
12. Navarro, Osiurak & Reynaud (2018), “Does the Tempo of Music Impact Human Behavior Behind the Wheel?”, *Human Factors*. [DOI](https://doi.org/10.1177/0018720818760901)
13. Bernardi, Porta & Sleight (2006), “Cardiovascular, cerebrovascular, and respiratory changes induced by different types of music…,” *Heart*. [DOI](https://doi.org/10.1136/hrt.2005.064600)
14. Witek et al. (2014), “Syncopation, Body-Movement and Pleasure in Groove Music,” *PLOS ONE*. [DOI](https://doi.org/10.1371/journal.pone.0094446)
15. Edworthy & Waring (2006), “The effects of music tempo and loudness level on treadmill exercise,” *Ergonomics*. [DOI](https://doi.org/10.1080/00140130600899104)
16. Van Dyck et al. (2015), “Spontaneous entrainment of running cadence to music tempo,” *Sports Medicine - Open*. [DOI](https://doi.org/10.1186/s40798-015-0025-9)
