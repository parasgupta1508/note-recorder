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

- [ ] **Scales can be learned and practised in two places:** the built-in scale pieces in the Practice menu (the library packs, for example for violin) and the separate Scale drill. Decide with the owner whether to merge them, or keep both with clear roles. Questions to ask: which one is the main way to practise a scale; should progress from both count towards the same "Full scale" measure in Progress; should the Practice menu's scales open the Scale drill instead of a second player.

## Piece practice follow-ups

- [ ] Try it on a real violin, guitar and piano piece with the microphone (so far only synthetic frames and the structure of real GitHub files were checked). Check the staff, the fingerings and how Tempo-locked feels on a piece with fast notes.
- [ ] Expand repeats (`<repeat>`, endings) and keep grace notes: the parser skips both (`js/core/musicxml.js`).
- [ ] Staff: beams, ties and slurs, a bass clef and a grand staff for piano, and spacing in proportion to note length (today every note gets the same width).
- [ ] Violin hand position: `ppPositions` picks the lowest position that reaches each note and stays while it can; use the score's own fingering marks (`<fingering>`) when they exist.
- [ ] Wait mode with accompaniment (today the other parts play in Tempo mode and "Hear piece" only).
- [ ] Offer "Save to my library" for a piece opened from GitHub (today nothing is stored by design).
- [ ] Let a piece open from the Pieces tab with a "Practise with scoring" button, so the two screens share one list.
- [ ] The Staff, Tab, Fingerboard and Piano roll exist twice now (`scale-visual.js` and `piece-visual.js`), as do the two engines. When the owner agrees, share the drawing code (a parameterised view) instead of keeping two copies in step.
- [ ] Per-piece progress in the Progress tab and in the backup file: piece runs are in `localStorage` (`tuner-piece-runs-v1`) only. Needs a decision with the owner, because the Progress tab and the backup belong to the Scale drills history.
- [ ] The local checkout of `main` was 18 commits behind GitHub and holds an unfinished experiment (Recorder views Staff/Tab/Fingerboard/Roll: `js/core/fingerboard.js`, `instrument-views.js` missing). The Scale drills now have these displays, so decide whether that experiment is still wanted before it is merged or deleted.
- [ ] Add the Piece libraries list (`tuner-piece-libs-v1`) and the piece run summaries to the backup / restore file.
- [ ] Instrument filter: libraries rarely say which instrument a score is for. Once a piece is opened its real instrument is known; consider remembering it (in memory only, or by file path in `localStorage`) so the filter gets better as pieces are opened.
- [ ] Grand staff: beams between the two staves, notes that cross between staves keep the split at middle C.

