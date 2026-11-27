# To do (later)

- [ ] **Engines screen: rename "Test" to "Self-check" and add a short explanation.** The button (in `js/app/engines/ui.js`, `data-test`) runs `engineContract()`: a quick software check on made-up sound (A4 then C5, plus silence). It checks silence gives no notes, output format, same result twice, pitches inside the range, A4/C5 within 20 cents, and speed. It does not use the microphone and does not say which algorithm is better. Suggested line under the buttons: "Self-check: a quick test on a made-up sound to confirm the algorithm works. It does not use your microphone." The passed/failed messages (also in `ui.js`) should use the same word.
- [ ] Tuner: make the in-tune beep re-arm when the target note changes (today it only re-arms after about 1 s of silence).
- [ ] Optional: time-to-settle measurement in `tests/mic-loopback.js` for comparing against other tuner apps.
- [ ] Try MPM on real noisy-room recordings before suggesting it as a default.
- [ ] Engines screen: consider the label "Tuner & live pitch algorithm", because that choice also drives Practice and the Recorder's pitch.
- [ ] SwiftF0 (neural pitch): code exists but is switched off. Needs an ONNX runtime and the model file vendored under `vendor/`, then enabling `caps.live`/`caps.offline`.
- [ ] CREPE: not built (needs a model download). Only worth it if noisy rooms stay a problem.
- [ ] Compare the Tuner against SoundCorset (Android) on the same notes: settle time and steadiness.

## Scale evaluation follow-ups

- [ ] Check the rubric against real microphone recordings (violin, guitar, ukulele, piano) and tune the constants in `js/core/evaluation.js` (6 cents full marks, tone wobble allowance, the 0.08 beat grace on pulse). Synthetic frames only so far.
- [ ] Coach: add rules for string crossings and position shifts once the position model knows which notes are shifts.
- [ ] Notation: a bass clef for low piano scales, and a grand staff view; guitar is written an octave above where it sounds.
- [ ] The Recorder's new fingerboard model (`js/core/fingerboard.js`, other session) overlaps `visPlace` in `js/core/visual.js`: merge them when that work lands.
- [ ] Progress per instrument and the three measures (below) should read the new scored runs as the "Full scale" measure.

## Progress screen (before building, ask the owner to confirm the details)

- [ ] **Progress per instrument.** A player can track progress separately for each instrument (violin, guitar, ukulele, piano/chromatic, voice). Add an instrument selector on the Progress screen.
- [ ] **Three measures per instrument:** **Note**, **Full scale**, **Piece**. The Progress screen needs a selector for these three.
- [ ] **Compare compares like with like:** the same measure on both sides (a note against a note, a scale against a scale, a piece against a piece).
- [ ] **Progress over time on three graphs:** one for Note, one for Scale, one for Piece.
- [ ] Ask the owner for the changes they want in Progress as the work goes (what to plot, which score, date range, what "same metric" means for a piece), instead of guessing.

## Settings clean-up

- [ ] **Instruments:** remove the extra instruments. Keep only violin, guitar, ukulele, piano/chromatic and voice.
- [ ] **Consolidate Microphone, Accuracy check and Detection.** They overlap and are confusing now. Merge them into one clearer structure (suggestion to confirm with the owner: one "Listening" group with the mic and calibration, an "Accuracy" check, and the detection presets in one place).

## Scales: two places today

- [ ] **Scales can be learned and practised in two places** (partly settled: Practise on a generated scale in Pieces now opens the Scale drills set to that scale, so Pieces no longer has its own scale player; progress counting towards one "Full scale" measure is still open): the built-in scale pieces in the Practice menu (the library packs, for example for violin) and the separate Scale drill. Decide with the owner whether to merge them, or keep both with clear roles. Questions to ask: which one is the main way to practise a scale; should progress from both count towards the same "Full scale" measure in Progress; should the Practice menu's scales open the Scale drill instead of a second player.

## Piece practice follow-ups

- [ ] Try it on a real violin, guitar and piano piece with the microphone (so far only synthetic frames and the structure of real GitHub files were checked). Check the staff, the fingerings and how Tempo-locked feels on a piece with fast notes.
- [ ] Expand repeats (`<repeat>`, endings) and keep grace notes: the parser skips both (`js/core/musicxml.js`).
- [ ] Staff: beams, ties and slurs, a bass clef and a grand staff for piano, and spacing in proportion to note length (today every note gets the same width).
- [ ] Violin hand position: `ppPositions` picks the lowest position that reaches each note and stays while it can; use the score's own fingering marks (`<fingering>`) when they exist.
- [ ] Wait mode with accompaniment (today the other parts play in Tempo mode and "Hear piece" only).
- [ ] Let a piece open from the Pieces tab with a "Practise with scoring" button, so the two screens share one list.
- [ ] The Staff, Tab, Fingerboard and Piano roll exist twice now (`scale-visual.js` and `piece-visual.js`), as do the two engines. When the owner agrees, share the drawing code (a parameterised view) instead of keeping two copies in step.
- [ ] Per-piece progress in the Progress tab and in the backup file: piece runs are in `localStorage` (`tuner-piece-runs-v1`) only. Needs a decision with the owner, because the Progress tab and the backup belong to the Scale drills history.
- [ ] The local checkout of `main` was 18 commits behind GitHub and holds an unfinished experiment (Recorder views Staff/Tab/Fingerboard/Roll: `js/core/fingerboard.js`, `instrument-views.js` missing). The Scale drills now have these displays, so decide whether that experiment is still wanted before it is merged or deleted.
- [ ] Grand staff: beams between the two staves, notes that cross between staves keep the split at middle C.
- [ ] Add the piece favourites, tags and tag names (`tuner-piece-meta-v1`, `tuner-piece-tags-v1`) to the backup / restore file.

## Evaluation audit follow-ups (deferred on purpose)

- [ ] **Progress charts must not mix graders.** `histRecord` stores which grader scored a run (`eng`), but `histTrend` ignores it, so switching between Strict and Practical makes a chart jump by up to 20 points. Plot or filter by grader.
- [ ] **Web MIDI input** for keyboards (`navigator.requestMIDIAccess`; not on iOS Safari). It could feed `onAttempt({ t, midi, cents, hz })` for single notes; polyphonic chords need new matching, and the pitch pillar means nothing for a keyboard, so the weights need rethinking.
- [ ] **Latency-calibrated onsets, elastic tempo for pieces, AudioWorklet / Worker for the pitch loop.** The measured speaker-to-microphone lag is about 60 ms in software and about 220 ms through a laptop speaker and microphone; the scorer forgives a constant lag but the skip rule does not.
- [ ] **Teacher-marked calibration set.** Record real scales and pieces and have a teacher mark them, then tune the grader thresholds against those marks (the speaker test gives known-truth sound, not teacher opinion).
- [ ] **Speaker test on a quiet room with the volume raised.** The real-speaker run stops at "TOO QUIET" when the microphone barely hears the speaker; run `node tests/mic-loopback.js --mode speaker --gold` once the volume is up to collect the 20-30 clips.

## Evaluation audit: what was done, and what is still open

Done (see `CLAUDE.md`, "Grader rules"): fault penalty and weakest-link caps, bounded offset forgiveness, evenness-based pulse, the zone and free margin no longer stack, one fixed frame rate for the drills, clarity / held length / listening share stored per note, deep-dip detection of repeated notes in pieces, per-note history for pieces (newest 12 runs), the coach keys piece notes by place, the speaker test and the performance synthesiser.

- [ ] **Run the real speaker test with the volume up** and collect the 20-30 clips: `node tests/mic-loopback.js --mode speaker --gold` (it stops at "TOO QUIET" when the microphone barely hears the speaker). A small laptop speaker cannot play below about 230 Hz, so low guitar and violin notes are left out of its figures.
- [ ] **Wait for note does not store clarity or listening share** (`waitFrame` keeps no per-frame clarity), so the cleanliness part of tone and the "microphone heard only X%" notice only work in Tempo-locked mode.
- [ ] **Note length is only judged for bowed instruments in Tempo-locked mode** (plucked and struck notes decay by themselves).
- [ ] **Pieces: the just / Pythagorean zone uses one tonic** for the whole piece (`peCtx`), so it is wrong after a modulation. Needs the key signature per bar from `js/core/musicxml.js`. Pieces are also still reduced to the top line, and tempo is the constant one you choose.
- [ ] **Tone has no vibrato model**: wobble is the standard deviation of the smoothed frames. Vibrato rate and depth need a shorter window than 93 ms (a 6 Hz vibrato has a period of about 167 ms).
- [ ] **Measured and left alone:** the 93 ms analysis window finds 29 of 29 notes at 240 BPM on the synthesised violin, so no shorter window was added. Re-check on real clips.
- [ ] **Teacher-marked calibration** is still needed to tune the grader's numbers (the speaker test has a known truth, not a teacher's opinion).
- [ ] **Slurred repeats in scales and the Recorder** use the old rule (a pause of 3 frames); the level-dip rule is only on in pieces where the next written note repeats the pitch.

## Instrument sounds

- [ ] **Viola, cello, mandolin and bass** have no recordings of their own: viola and cello use the violin, mandolin and bass the guitar (`smpKey` in `js/app/sampler.js`). Add banks (VSCO 2 CE has a cello and viola) if those instruments are offered.
- [ ] **Steel-string guitar** (FreePats `FSS-SteelStringGuitar`, CC0) and a **violin pizzicato / spiccato** layer (VSCO 2 CE has them) would let a scale or piece use the articulation it is marked with.
- [ ] **The recorder's own playback** (`js/app/recorder.js`, `chart.js` note taps and the Tuner string buttons) still use the plain tone. They could use the recordings too.
- [ ] **Piano pedal and chords:** the piano bank has one velocity layer and no pedal, and a piece's accompaniment plays every note for its written length.

## Real pieces through the speaker test (silent mode, real recordings)

First run on 10 public-domain scores found that **quick notes are lost**: notes with under 150 ms to the next were found 10% of the time. The listening now adapts to the shortest written gap (`listenFor`): Maple Leaf Rag went from 38% to 72% of notes found, Mozart K. 155 from 57% to 82%. Full set after the fix (silent, real recordings), notes found: Corelli 93%, Haydn 91%, Beethoven 91%, Mozart 84%, Handel 84%, Bach 81%, Joplin 79%, Schumann 79%, Aloha Oe 98%, Foster 99%; 5 of 10 pass. Through the real speaker and microphone Corelli found 62 of 70 notes (median 2.4 cents, onset lag 267 ms against 100 ms silent). Still open:
- [ ] **About 10% of notes are missed even with 250 ms or more to the next note** (Schumann, Bach, Handel). Look at which: repeated same-pitch notes on a decaying piano, chords reduced to the top line, or a missed note shifting the matching of the next ones.

- [ ] **Notes under about 100 ms apart are still found only about 40% of the time**, and 100-150 ms about 70%. Ideas: onset detection from the level (not only from a steady pitch), a pitch track that keeps the previous note's pitch until the next is confirmed, and trying MPM (`f0-alt.js`) on these takes (it was best in noise).
- [ ] **Run the full 10-piece set after every change** to the detector or the attempt logic, and add a number to a baseline once it is stable (the speaker test is not a ratchet yet).
- [ ] **Piece practice still shows the test piece afterwards** (the screen is not put back as it was).

