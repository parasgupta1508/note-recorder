# Recorder intelligence: background, logic and roadmap

Status: design only. Nothing in this document is built yet unless it says "(built)".

## 1. The four repos, and what we take from each

| Repo | What it is | Use in this app |
|---|---|---|
| **spotify/basic-pitch** (`@spotify/basic-pitch`, Apache-2.0) | Neural audio-to-notes model. Polyphonic, any instrument, about 0.9 MB, runs in the browser via TensorFlow.js. | The engine for an offline "Analyse in detail" step. |
| **craffel/pretty-midi** (Python, MIT) | A clean note data model (instrument → notes with pitch, start, end, velocity) plus analysis helpers: chroma, key, tempo, piano roll, synthesis. | Copy the **ideas**, not the code: our own note model and our own key/tempo/chroma analysis in JS. |
| **mido/mido** (Python) | Reads and writes MIDI messages and files; real-time ports. | Only the **file format** matters. A Standard MIDI File writer is about 60 lines of JS (header, tempo, note on/off, variable-length times). No library needed. |
| **celtera/libremidi** (C++20) | Cross-platform MIDI I/O, including WebMIDI through Emscripten. | **Not needed.** The browser already has the Web MIDI API (keyboard input, synth output). Not available on iOS Safari. |

## 2. How Basic Pitch works (read from `@spotify/basic-pitch` 1.0.1 source)

- **Input:** mono audio at 22,050 Hz. Features are computed with a hop of 256 samples, so one output frame is about 11.6 ms (about 86 frames per second).
- **Windows:** the audio is cut into 2-second windows with 30 frames of overlap. The overlap is trimmed after inference so the joins do not show.
- **Three outputs per frame** (per semitone from A0 to C8, plus a finer pitch grid):
  1. *frames*: how likely each semitone is sounding
  2. *onsets*: how likely a note starts here
  3. *contours*: finer pitch (about 3 bins per semitone), used for pitch bends and vibrato
- **Post-processing (`outputToNotesPoly`)** turns the activations into notes:
  - `onsetThresh` (default 0.5) and `frameThresh` (0.3): how strong a start / a sustained note must be
  - `minNoteLen` (5 frames, about 58 ms): shorter notes are dropped
  - `inferOnsets`: adds a start when the frame energy jumps, so repeated notes without a clear onset still split
  - `minFreq` / `maxFreq`: hard instrument range
  - `melodiaTrick`: extends a note along its frame energy, and removes neighbouring semitones around a peak
  - `energyTolerance` (11 frames): how long a note may dip before it ends
- **Output:** note events with start, duration, pitch, amplitude and pitch-bend contour. `noteFramesToTime` converts frames to seconds.
- **Limits (from its own README):** works best on one instrument at a time; it transcribes, it does **not** separate sound. A piano under a violin is also transcribed.

## 3. What we measured on the real clip (violin over piano, 111 s)

- Our live detector (single pitch): finds a clean pitch in only about 4 of 10 frames, covers 10 to 40 % of the music, makes many short fragments and octave flips. Auto mode made it worse by treating piano as noise.
- Basic Pitch: 1,909 notes, 1,232 in violin range and 677 below G3 (piano). Median note 0.14 s, so it fragments too, and the piano is mixed in. But its melody **agrees** with ours where ours has notes (19 to 30 s: E4 F#4 G4 … C#4 B3 G4 F#4 E4), and it fills the gaps ours has.
- Conclusion: Basic Pitch is a better *reference* and a better *offline* analyser. It is still not a violin-only output, so we need our own melody-extraction layer on top.

## 4. Target architecture

```
Capture ──► Detect ──────────────► Note model ──► Melody ──► Musical ──► Learning
            live: YIN detector      (one shape      extraction  analysis    features
            offline: Basic Pitch    for both)       (the        (key, tempo, (scoring,
                                                     violin)    intonation…)  progress)
```

**One note shape** for both engines: `{ midi, start, dur, level, cents, pts (pitch contour), source: 'live'|'bp', strength }`. Everything after detection (views, stats, replay, export, scoring) only sees this shape, so a better engine can be swapped in without touching the rest.

### 4.1 Melody extraction (violin out of violin + piano)
Works on the note list, so it is cheap and testable offline:

1. **Range filter:** keep only the instrument's range (violin G3 and up).
2. **Overtone suppression:** drop a note that starts within about 50 ms of a stronger note and sits 12, 19 or 24 semitones above it (octave, twelfth, double octave) unless it has its own onset strength.
3. **Instrument-likeness score per note**, from the pitch contour:
   - *bowed string:* sustained level, and vibrato (pitch wobble of 4 to 7 Hz, ±20 to 60 cents)
   - *piano:* sharp attack, level that only falls, pitch dead steady
   Score = vibrato energy + sustain − pure exponential decay. Low-score notes are accompaniment.
4. **Melody path:** pick one note at a time with dynamic programming (Viterbi). Cost = −(strength + likeness) + penalty per semitone leap + penalty for gaps. This favours a singable line and rejects octave flips.
5. **Merge fragments:** same pitch within 80 ms and no level dip → one note. A level dip of more than 40 % → two notes (this is the existing re-articulation rule).

### 4.2 Musical analysis (all from the note list; pretty-midi's ideas in JS)
- **Key:** pitch-class histogram weighted by duration, matched to major and minor profiles (we already have `guessKey`).
- **Tempo and beats:** inter-onset intervals, then the best tempo by autocorrelation; snap notes to a beat grid and report timing deviation per note.
- **Intonation:** cents error per note, tendency by pitch (high, low, sharp on a given note), drift within long notes.
- **Vibrato:** rate (Hz) and width (cents) per note, and how even it is.
- **Articulation:** per repeated note, gap length and level dip → label legato / portato / détaché / staccato.
- **Dynamics:** level contour per phrase.

### 4.3 Export
Standard MIDI File and (later) MusicXML, from the note model. This is what mido/pretty-midi do, and it is the way to open the result in MuseScore, a DAW, or a synth.

## 5. How to know it is getting better (the rule: never get worse)

1. **Silver reference:** Basic Pitch's melody for the clip, after the extraction layer. Useful but not truth, because Basic Pitch also makes mistakes.
2. **Gold reference:** a short stretch (20 to 30 notes) checked by ear, using Replay, and written into the test. This is what the numbers are really tuned against.
3. **Metrics:** note F1 with start within ±50 ms and pitch within 50 cents; fraction of music covered; fragments per minute; octave errors; piano notes wrongly kept.
4. Add the clip as a case in `tests/bench.js`, with the baseline ratchet (`--update` only goes up). Synthetic cases stay too. Real audio stays out of git (public repo).

## 6. Roadmap, each step gated by the benchmark

| Phase | What | Needs |
|---|---|---|
| 0 | Real-clip benchmark from Basic Pitch melody + your gold notes. **MIDI export** (60 lines, no dependency). | Nothing new. |
| 1 | **"Analyse in detail"** button: after recording, run Basic Pitch (lazy-loaded, cached for offline), show a progress bar, put the result in the same views, replay and stats. Live detector unchanged. | TensorFlow.js + 0.9 MB model, about 1 to 2.5 MB total, loaded only on demand. To verify: speed on a phone (WebGL / WASM backend). |
| 2 | **Melody extraction** (section 4.1) with the benchmark as judge. | Phase 0 data. |
| 3 | Musical analysis (4.2) and a report screen. | Phases 1 and 2. |
| 4 | Learning features (section 7). | Phase 3. |
| 5 | Improve the live detector using what the benchmark shows (hold a note through weak frames, stop Auto treating accompaniment as noise, octave continuity). | Phase 0 data. |

## 7. Ideas that make the app a learning and analysis tool

Ordered by value for a student:

1. **Learn a song by ear.** Record or load a piece, get its melody as notes, then play it back slowly with the falling-notes view and a synth, loop a bar, and practise along. This is the strongest feature Basic Pitch enables.
2. **Follow-along scoring.** Take a target (from step 1, or an imported MIDI file) and score each note you play: pitch, timing, intonation. A "wait mode" pauses until the right note is played.
3. **Intonation coach.** Per-note and per-pitch cents charts, "you are consistently sharp on E5", drift in long notes.
4. **Rhythm coach.** Rushing and dragging graph, tempo curve, beat grid on the sheet.
5. **Vibrato and articulation report.** Rate, width, evenness; counts of détaché, legato and staccato; gap lengths.
6. **Compare two takes.** Overlay today against last week on the same passage.
7. **Weak-spot trainer.** The scorecard already finds weak notes; add weak bars and a spaced-repetition queue.
8. **Chords for guitar and ukulele.** The current detector is single-note only; Basic Pitch is polyphonic, so strummed chords can be named.
9. **MIDI keyboard and synth** through the browser's Web MIDI API (where supported): reference tones and play-along.
10. **Export** to MIDI and MusicXML for teachers and notation software.

## 8. Risks and open questions

- **Speed on phones:** Basic Pitch took about 2 minutes for 111 s on pure CPU JavaScript here. WebGL or WASM should be much faster, but it must be measured on a real phone before promising it.
- **Size:** the model is small; TensorFlow.js is the bigger part. Load on demand only, and cache it so it works offline.
- **It will not remove piano sound,** only decide which notes are violin. Real separation (Demucs, UVR5) stays a desktop step.
- **Accuracy claims** need the gold reference first. Until then, "better" means "better against Basic Pitch", not "correct".
- **Licences:** Basic Pitch TypeScript is Apache-2.0 and pretty-midi is MIT, so both are fine for a public app. Keep the licence notice with the model if it is bundled.

## 9. Status after the first build (what exists now)

- **Built:** Live | Detailed modes; Basic Pitch bundled offline (`vendor/`); melody extraction (`extractMelody`) with a chord option for guitar and ukulele; vibrato detection (`vibratoOf`) that keeps a vibrato note as one note and still splits on a real bow change; adaptive display size; Falling view that shows the active note plus 4 lanes either side (zoom changes how many); install button; browser tests.
- **Checked against the repos:** Basic Pitch is used as designed (22.05 kHz mono, its own note post-processing, pitch bends kept as the contour). pretty-midi's note model is mirrored by our note shape. MIDI file writing (mido's job) is **not built yet**. libremidi / Web MIDI is not used.
- **Known limits:** the Live detector still fragments notes on real violin-with-piano audio (detector dropouts, not vibrato). Detailed is the answer for that. Vibrato notes split across a semitone border in Basic Pitch are not merged yet.

## 10. Broader music aspects not yet covered (candidates)

| Area | Idea |
|---|---|
| Rhythm | Beat and tempo tracking, snap to a grid, "rushing / dragging" graph, built-in metronome and count-in, tempo-matched replay. |
| Intonation | Cents error per note and per pitch, drift over long notes, choice of tuning system (equal, just, Pythagorean) because a violinist's "in tune" is not equal temperament. |
| Violin specifics | String and finger-position hints, open-string detection, double stops and chords, shifts and glissando (slides between notes, which now look like fragments), harmonics. |
| Tone and dynamics | Loudness contour per phrase, crescendo and diminuendo, attack sharpness, a brightness measure (spectral centroid) as a simple tone-quality cue. |
| Bowing and articulation | Bow-change count, détaché / legato / staccato / spiccato labels, even-bow-speed check using steady loudness. |
| Pitch ornaments | Trill, mordent, grace-note detection (fast alternations between neighbours), vibrato rate and width trends over time. |
| Harmony | Chord naming for guitar and ukulele, key and mode detection (major, minor, church modes), transposition for transposing instruments. |
| Notation | Proper note durations and rests on the sheet, key signature and accidentals, clef choice, MusicXML and MIDI export, print view. |
| Learning flow | Follow-along scoring, wait mode, loop a bar, slow-down without changing pitch, spaced repetition of weak bars, practice streaks and goals, teacher sharing of a session. |
| Ear training | Interval and chord quiz, "play back what you heard", sight-reading prompts. |
| Accessibility | Colour-blind-safe palette and shape cues, dyslexia-friendly font option, large-text mode, audio feedback for low-vision users. |
| Recording quality | Input level and room-noise coach before recording, clipping warning, per-session mic calibration. |
| Data | Per-piece history and progress charts, side-by-side take comparison, backup and restore (exists), optional cloud-free sharing by file. |
