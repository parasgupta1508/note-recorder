# Practice Companion: build plan (v4, for Claude Code)

Status: design only. Nothing here is built unless marked "(exists)". Written for the existing PWA in this repo (`note-recorder`, deployed to GitHub Pages). Background on the detector and Basic Pitch is in `docs/intelligence-plan.md`; working rules are in `CLAUDE.md`. Read both first. Where this plan and `CLAUDE.md` disagree, `CLAUDE.md` wins.

## 0. How to use this document

Work one phase at a time (section 9). Each phase ends with a gate. Do not start a phase until the previous gate passes. After each phase: run the tests listed, bump `CACHE` in `sw.js`, list new files in `index.html` and `FILES` in `sw.js`, commit, push (see `CLAUDE.md`).

Suggested first prompt: "Read CLAUDE.md, docs/intelligence-plan.md and docs/practice-companion-plan.md. Implement Phase 0 only, then stop and report."

Hard constraints (all from the existing repo, repeated because breaking them is expensive):
- No build step for the app. Vanilla JS, classic scripts, shared scope in `js/app/`. Pure logic in `js/core/` (no `document`, `window`, `localStorage`, `indexedDB`), loaded by Node tests through `tests/lib/load.js`.
- `yin()` in `js/core/pitch.js` stays the single pitch detector. Do not add a second one. Improve it in place and keep the ratchet green.
- Never make detection worse: `tests/bench.js`, `tests/strings.js`, `tests/detailed-strings.js`, `tests/pitch-sweep.js`, `tests/resample.js` and their baselines in `tests/baselines/` must not regress.
- Everything must work offline after install. Anything heavy is vendored under `vendor/` and cached by the service worker.
- No Python or native modules in the critical path. This PC's Application Control policy blocks some native Python modules; do not try to work around it (see `CLAUDE.md`). Python/Node helper tools stay optional and live under `tools/lab/`.
- The repo and the site are public. Never commit recordings, exported practice data, or copyrighted scores. Test fixtures must be self-written or public domain. Add `backups/` and `*.practice.json` to `.gitignore` in Phase 0.

## 1. Product

**One sentence.** An offline PWA that shows a piece as sheet music, plays an accompaniment and click, listens to a violin student play, and says which bars to fix next, how far off each note was (in cents and milliseconds), and whether practice is working over time.

**Audience.** Two intermediate violin students (about 13) with a teacher. They are not beginners and want to improve seriously. Personal use, run from the phone, tablet or PC they already use. No accounts, no cloud, no sharing service, no legal scaffolding.

**Implications of "intermediate, serious":**
- Tolerances are tight (default ±15 cents on pieces, ±10 on scales and slow practice; both configurable per player).
- Show real numbers (cents, ms) with arrows and colour. No cartoon feedback, no single score as the headline.
- The app teaches practice method, not just correctness: tempo ladder, clean-repetition counts, recurring-bias findings, weekly teacher summary.
- Repertoire is real repertoire (scores from the teacher, IMSLP, MuseScore). Importing a good score matters more than transcribing audio.

**The loop.** Import a piece, pick a bar range, practise with click or accompaniment at a chosen tempo, record a take, see the sheet coloured note by note, loop the weakest bars, climb the tempo ladder, review progress, send the teacher a summary.

**Honest boundaries (put these in the app's About text too).**
- It measures pitch (cents), timing, completeness, tempo stability and, later, dynamics shape. It does not judge tone, bow control, phrasing or posture. Scores are practice hints, not grades.
- Single-note lines are evaluated. Double stops are shown as "not evaluated" (grey), never red.
- Accuracy depends on microphone, room and segmentation. Low-confidence notes are marked "unsure" and never penalised.
- Practice data lives in each device's browser storage. There is no sync. Use the backup file (Phase 0) to move or protect it.

## 2. What already exists (mapped to what is needed)

| Capability | State | Where |
|---|---|---|
| Single pitch detector, harmonic check | exists | `js/core/pitch.js` |
| Notes from pitch frames, vibrato, re-articulation | exists | `js/core/segmenter.js` (`Segmenter`, `vibratoOf`) |
| Offline analysis of a recording | exists | `js/core/listening.js` (`analyseSamples`) |
| Basic Pitch "Detailed" analysis, offline | exists | `js/core/detailed.js`, `vendor/` |
| Mic pipeline, calibration, level gate, wake lock | exists, uses deprecated `ScriptProcessor` | `js/app/audio.js` |
| Scale practice: expected sequence, lookahead matching, cents grading, passes | exists | `js/app/practice-engine.js`, `practice.js` |
| Metronome, tuner, analysis tab, profiles (instruments) | exists | `js/app/metronome.js`, `tuner.js`, `analysis.js`, `profiles.js` |
| Recorder with Sheet and Falling views | exists (shows detected notes, not a reference score) | `js/app/recorder.js`, `chart.js` |
| MIDI read/write, note matching, F1 | exists | `js/core/midi.js`, `compare.js` |
| Lab: YouTube/audio to reference MIDI (local helper) | exists | `js/app/lab.js`, `tools/lab/` |
| Synthetic test audio, ratchet benchmarks, headless smoke tests | exists | `tests/lib/synth.js`, `tests/*.js` |
| Reference score model (MusicXML/MIDI to timeline) | **missing** | Phase 1 |
| Alignment of a take to a reference, per-note scoring | **missing** | Phase 2 |
| Rendered sheet music for an imported score | **missing** | Phase 3 |
| Bar range, loop, count-in, tempo, latency-aware timing | **missing** | Phase 4 |
| Accompaniment | **missing** | Phase 5 |
| Takes database, players, backup | **missing** (only `localStorage` settings and scale passes) | Phase 0 |
| Tempo ladder, bias profile, trends, teacher summary | **missing** | Phase 6 |

Engine A from the earlier plans ("audio to sheet") is mostly the existing Lab. Phase 7 only bridges it into Pieces.

## 3. Architecture decisions

1. **Browser-only core.** GitHub Pages is static hosting, so a FastAPI/Celery/Postgres backend is out. Evaluation runs in the page, in `js/core/`, testable in Node. Earlier plans' CREPE/DTW-in-Python moves to JS, built on the existing YIN and `Segmenter`. CREPE and pYIN stay Lab-only cross-checks.
2. **Evaluate note events, not raw frames.** Align the `Segmenter` note events (`{midi, note, hz, cents, start, dur, lvl, pts, vib}`) to the reference notes with a dynamic-programming alignment. Hundreds of notes, so it runs instantly and a looped bar scores in well under a second. The cost is that segmentation errors become scoring errors, which is why segmentation is gated by tests (section 10) and low-confidence notes become "unsure".
3. **Reference is a timeline, not an audio file.** MusicXML is parsed into a flat list of notes with beats, a tempo map and a bar table (repeats expanded). Everything downstream (display, scoring, accompaniment, metronome sync, bar loops) reads this one structure.
4. **Sheet display: OpenSheetMusicDisplay (BSD-3-Clause), vendored and lazy-loaded.** Needs a spike (Phase 3 gate: three sample scores render in under 3 s on the phone and tablet; coloured per note; tap a bar to select). Fallback: VexFlow (MIT), or the existing Sheet renderer in `chart.js` for simple pieces. MIDI-only imports use the existing Falling view and are not engraved.
5. **Accompaniment is synthesised from the score**, not time-stretched from a recording. Render the chosen range with `OfflineAudioContext` into an `AudioBuffer` (accompaniment plus click), then play it on the audio clock. This gives exact tempo changes, exact metronome sync and exact bar loops. Simple additive piano-like synth first; better sounds are optional later.
6. **Timing is measured against the audio clock with calibrated latency.** Capture moves from `ScriptProcessor` to `AudioWorklet` so every block has a sample-accurate time. A per-"setup" latency offset (for example "iPad + AirPods") is measured once and subtracted. Without a click (free mode), timing is judged by interval ratios and tempo drift, never by absolute time.
7. **DTW is for alignment only, never for measuring timing.** Timing is measured from matched onsets after alignment, against the click grid (click mode) or a fitted local tempo (free mode). Do not read rhythm error out of how far the alignment path bent.
8. **Storage: IndexedDB for takes and pieces; `localStorage` stays for settings.** Request `navigator.storage.persist()`. Keep raw audio for only the last N takes per piece range (default 10, capped by `navigator.storage.estimate()`), because recordings are about 5 MB per minute at 16-bit mono 44.1 kHz. Always keep note events and results so old takes remain viewable. Provide Export/Import of everything as one file.
9. **Players, not accounts.** A profile picker (names, per-player tolerance, A4, intonation reference, setups). No passwords, no network identity.
10. **Intonation reference is selectable.** Default equal temperament. Option "Just (key-aware)" adjusts targets by scale degree (appendix B) because expressive intonation on violin differs from piano tuning by up to about 14 cents on thirds. Tolerances apply after the adjustment and after the per-take tuning offset.
11. **Dropped from earlier plans:** Celery/Redis/Postgres/Docker/JWT, GPU, VioPTT/MuScriptor, Demucs/Python separation (likely blocked by the PC's policy; revisit only if it runs), LilyPond (use OSMD SVG and `window.print`), custom notation editor (use MuseScore), time-stretched backing tracks, guitar chord evaluation.

## 4. Data model

Pure-JS shapes (document them in `js/core/schema.js` with a `SCHEMA_VERSION`). IndexedDB wrapper is in `js/app/store.js`.

```
Player   { id, name, instrument:'violin', tolCentsPiece:15, tolCentsScale:10, a4:440,
           intonationRef:'equal'|'just', clickDefaultBpm, createdAt }
Setup    { id, playerId, name, latencyMs, micDeviceId?, calibratedAt }      // "iPad + AirPods"
Piece    { id, title, composer?, source:'musicxml'|'midi'|'lab', xml?, midi?,
           timeline, bars[], tempoMap[], keySig[], createdAt, tags[] }
Timeline note  { id, midi, startBeat, durBeats, bar, beatInBar, voice, part,
                 tieStart:bool, tieEnd:bool, grace:bool, doubleStop:bool, flags[] }
Bar      { index, playOrder, startBeat, beats, timeSig, key, label, repeatGroup? }
Take     { id, playerId, pieceId, setupId, createdAt, barRange:[a,b], bpm, mode:'click'|'free',
           accompaniment:bool, events[], attempts[], alignment[], noteResults[], barScores[],
           summary, tuningOffsetCents, paramsVersion, audioKey? }
NoteResult { refId, status:'ok'|'sharp'|'flat'|'wrong'|'missed'|'extra'|'unsure'|'notEvaluated',
             settledCents, landingCents, driftCents, onsetErrMs?, ioiRatioErr?, durErr, vib, confidence }
BarScore { bar, pitch, rhythm, completeness, overall, nEvaluated, nUnsure }
Ladder   { playerId, pieceId, barRange, targetBpm, currentBpm, cleanStreak, history[] }
Session  { id, playerId, start, end, activeMs }
```

`paramsVersion` ties results to the scoring parameters used, so a later improvement can re-score stored takes (from stored audio if present, otherwise from stored events).

## 5. Reference engine (`js/core/musicxml.js`, `timeline.js`)

- Pure XML parsing in core. Write a small tokenizer (or a vendored MIT parser) so Node tests do not need `DOMParser`. The app may use `DOMParser` and hand the core a plain object instead; pick one in Phase 1 and test it.
- Support: score-partwise, parts and measures, `divisions`, pitch/alter/octave, rests, `chord` (marks `doubleStop` when two sounding notes share a part and voice), ties, grace notes (flagged, not scored in v1), `time`, `key`, `sound tempo` and `metronome` markings, implicit pickup measures, forward/backward repeats and numbered endings, `D.C.`/`D.S.`/coda only if cheap (otherwise warn and play linear), multiple parts (the violin part is selected by the user; the others become accompaniment).
- `.mxl` (zipped) support via a minimal zip reader and `DecompressionStream('deflate-raw')`; MuseScore exports `.mxl` by default, so this is required for a smooth workflow. Fall back to a clear message plus the "export uncompressed" instruction.
- Output: `timeline[]`, `bars[]` (with `playOrder` after repeat expansion), `tempoMap[]`. Ties merge into one scored note whose onset is the first note's.
- MIDI import uses `js/core/midi.js`, quantises lightly to a beat grid, and produces the same timeline shape with no engraving.
- Fixtures in `tests/fixtures/`: hand-written small MusicXML files covering a scale, a tune with a pickup bar, ties, a repeat with first/second endings, a grace note, a double stop, a tempo change, and a 3/4 piece. `tests/musicxml.js` and `tests/timeline.js` assert exact timelines.

## 6. Evaluator (`js/core/align.js`, `intonation.js`, `evaluate.js`)

**Input.** `events` from the existing pipeline (offline `analyseSamples` over the recorded buffer, so a bar loop needs only a few seconds of audio) plus a reference range and a mode. The offline pass may look ahead and smooth in ways the live detector cannot.

**Steps.**
1. **Attempts.** Split the take into attempts at silences of 1.0 s or more or when the aligned position jumps backwards. Default view scores the last complete attempt of the selected range; a toggle shows the best attempt or all attempts.
2. **Alignment (per attempt).** Monotonic dynamic programming over reference notes R and event notes T, subsequence-style (free start and end on R, so partial takes and skipped openings cost nothing). Match cost = pitch cost (0 exact, 0.5 for one semitone off, 2 otherwise; ±12 semitones is treated as "octave-suspect", see step 5) + time cost (click mode: onset distance from the expected click-grid time after latency correction, normalised by note duration; free mode: deviation of the local interval ratio). Gap cost: missed reference 1.0, extra event 0.7. Tune the costs on synthetic tests, then freeze them in `EVAL_PARAMS`.
3. **Per-note measurement.** For each matched pair:
   - `settledCents`: median of the smoothed contour after the first 100 ms (vibrato centre = median of the smoothed 50-100 ms window), relative to the target pitch (appendix B for just intonation) and the take's tuning offset.
   - `landingCents`: mean cents over the first 60-100 ms (scooping).
   - `driftCents`: slope of the contour over the settled part, for notes of 400 ms or more.
   - Click mode: `onsetErrMs` against the click grid minus calibrated latency. Free mode: `ioiRatioErr` against the fitted tempo (robust regression through matched onsets); report tempo drift separately.
   - `durErr` for notes with clear releases (optional, low weight).
4. **Tuning offset.** Median `settledCents` over high-confidence notes in the take. Reported separately ("your violin is about 18 cents flat, tune the A") and subtracted before classification. Cap at ±40 cents; beyond that, ask the player to tune and re-record.
5. **Classification.** `ok` if |cents| <= tolerance; `sharp`/`flat` if tolerance < |cents| <= 50; `wrong` if the rounded semitone differs from the reference (after the tuning offset); `missed` if no event matched; `extra` if an event matched nothing; `notEvaluated` for double stops and grace notes. `unsure` if the event has fewer than 5 voiced frames, median clarity below the confidence threshold, an octave or twelfth suspect, or disagrees with the Detailed path by more than 50 cents when that path was run. `unsure` is never penalised and never red.
6. **Rhythm "ok".** |onsetErrMs| <= max(50 ms, 12% of the beat) in click mode; the equivalent interval-ratio window in free mode. These numbers are starting points; the spike tunes them.
7. **Aggregation.** Per bar: pitch = share of evaluated notes that are `ok` (partial credit for `sharp`/`flat` within 2x tolerance), rhythm = share `ok`, completeness = matched / expected inside the take scope. Take scope = the selected bar range, or, if nothing was selected, the span the attempt actually covered (banner: "You played bars 12-16"). Overall = weighted sum with weights in `EVAL_PARAMS` (pitch 0.5, rhythm 0.3, completeness 0.2).
8. **Weak bars.** Rank by `overall` ascending, tie-broken by number of `wrong`/`missed`; return the lowest five, merging adjacent weak bars into ranges for looping.

**Outputs also feed:** the bias profile (Phase 6), the ladder (Phase 6), the report (Phase 6).

**Failure behaviour.** If alignment cost is above a threshold (the player did not play the selected material), return `status: 'noMatch'` and tell the user, rather than producing red notes.

## 7. Screens (add to the existing tab bar)

Existing tabs: Tuner, Scale, Analysis, Recorder, Lab, Settings (`js/app/base.js` line with the tab list must be updated when adding tabs). Add **Pieces** and **Progress**. Keep the existing tabs working.

- **Player switcher** (header): pick a player; all new data is per player.
- **Pieces (library):** list with last practised, tempo reached, share of bars "learned". Import button (MusicXML/MXL/MIDI, or "from Lab").
- **Piece view:** sheet (OSMD) with bar numbers; tap a bar or drag to select a range; controls: tempo (BPM or %), click on/off, accompaniment on/off, count-in, loop on/off, record/stop; part picker (which part is the violin).
- **Feedback:** the same sheet coloured per note. Status is shown by colour and shape (▲ sharp, ▼ flat, ● ok, ✕ wrong, ◌ missed, ? unsure, grey for not evaluated), with a colour-blind-safe palette. Tap a note: cents (settled, landing, drift), onset error, vibrato. Bar heat strip, the weak-bar list with Loop buttons, the tuning-offset banner, and a take-vs-previous-take comparison.
- **Progress:** per piece and range: tempo ladder, trend of pitch/rhythm per take, clean-repetition streak; per player: bias profile, practice minutes per week.
- **Settings additions:** players, setups and latency calibration, tolerances, intonation reference, headphone reminder, backup export/import, storage usage.
- **Report (print view):** one page for the teacher (section 8).

## 8. Practice features (what makes it a coach)

- **Bar loop** with count-in, optional click and accompaniment, and a counter of consecutive "clean" repetitions. Default goal: 3 clean in a row.
- **Tempo ladder** (`js/core/ladder.js`, pure): start at 60% of the marked tempo, +4 BPM (or 5%) after 3 clean takes in a row, offer to step back after 2 unclean takes at one level, "learned" when 3 clean takes at the target tempo. "Clean" = bar-range pitch >= 90% ok, rhythm >= 85%, completeness 100%, tunable per player.
- **Bias profile** (`js/core/bias.js`, pure): rolling median of `settledCents` per note (pitch name with octave) over the last 20 takes, with sign consistency. Report notes with |median| >= 8 cents, at least 6 samples across at least 3 takes, and at least 70% same sign, in plain words ("F♯5 is flat on average: -17 cents over 14 samples in 5 takes"). Later: by interval type and direction (shifts that overshoot), by register.
- **Scales and arpeggios** keep their existing engine but write `Take`-shaped records, so scale results also feed the bias profile and trends. Add arpeggios and thirds generators from `buildScale` if not present.
- **Beyond pitch (after Phase 6, only if the evaluator is trustworthy):** tempo stability graph, note-length evenness for runs, dynamics contour against markings, landing and drift summaries.
- **Teacher report** (`js/app/report.js`, print stylesheet, `window.print`): date range, minutes practised, pieces and ranges worked, ladder progress, three weakest ranges, bias profile, one chart per piece. No upload; the player shows it or prints it to PDF.
- **Practice log:** active practice time per day (time with the mic open and a take or loop in progress), shown on Progress. Shared openly with the player; the goal is to help them see their own work, not to monitor them.

## 9. Build plan

Sizes: S = a day or two, M = about a week, L = one to two weeks of part-time work. Do the phases in order.

### Phase 0: Foundations (S)
- `js/core/schema.js` (shapes, `SCHEMA_VERSION`), `js/app/store.js` (IndexedDB: players, setups, pieces, takes, audio, ladders, sessions), `js/app/players.js` (profile picker), `js/app/backup.js` (export/import one JSON file, optionally with audio), `navigator.storage.persist()`, storage-usage display.
- `.gitignore`: `backups/`, `*.practice.json`.
- Migrate nothing yet; existing `localStorage` settings and scale passes keep working.
- Tests: `tests/structure.js`, `tests/smoke.js` still pass; a new `tests/store.js` smoke through headless Edge (create player, write/read a take, export, import).
- Gate: backup round-trips; the app loads offline; no regression in the existing benchmarks.

### Phase 1: Reference timeline (M)
- `js/core/musicxml.js`, `js/core/timeline.js`, `.mxl` reader, MIDI-to-timeline.
- Fixtures and `tests/musicxml.js`, `tests/timeline.js` (exact assertions for ties, repeats, pickup, grace, double stops, tempo changes).
- Gate: every fixture produces the expected timeline; a real MuseScore export (kept out of git) imports without error and bar counts match the score.

### Phase 2: Evaluator spike, no UI (L). **This phase decides whether the app is worth building.**
- `js/core/align.js`, `intonation.js`, `evaluate.js`, `EVAL_PARAMS`.
- Test generators in `tests/lib/synth.js` extended: violin-like takes rendered from a timeline with injected errors (section 10).
- CLI for real audio: `node tests/realtake.js <take.f32|wav> <piece.musicxml> [--range a-b] [--mode click|free] [--bpm n]` prints per-bar and per-note results (patterned on `tests/realclip.js`). Real audio stays in git-ignored `tests/audio/`.
- Benchmarks join the ratchet: `tests/eval-synth.js` with a saved baseline.
- Gate: section 10 gates T1, T3 (synthetic part), T4, T5, T6 pass, and T2 (teacher-labelled real takes) passes. If T2 fails after two focused iterations, fall back to **Follow mode only** (live wait-mode scoring like the existing scale practice, applied to pieces) and re-plan; do not build the rest on a scorer that is not trusted.

### Phase 3: Piece screen MVP (L)
- Vendor OSMD under `vendor/` with its licence file; lazy-load on the Pieces tab; list in `sw.js` vendor cache. Spike gate first: three fixture scores render in under 3 s on the phone and tablet, per-note colouring and bar selection work. Fallback per section 3.
- `js/app/pieces.js`, `js/app/piece-view.js`, `js/app/feedback.js`: import, sheet, bar-range selection, record a take with the existing audio path, run the evaluator, colour the notes, bar heat strip, weak-bar list, note detail on tap.
- Takes saved to IndexedDB with events and results; audio kept for the last 10 per range.
- Tests: `tests/smoke-piece.js` (headless Edge: import a fixture, load a synthetic take, assert coloured notes and weak-bar list); screenshot check with `tests/shot.js`-style script.
- Gate: your teacher-labelled takes show the weak bars they would pick (T2 repeated through the UI); a player can complete the loop import, record, feedback without help.

### Phase 4: Practice loop and timing (M)
- Replace `ScriptProcessor` capture with an `AudioWorklet` (`js/app/capture-worklet.js`, listed in `FILES`), keep a fallback for browsers without it. Re-run `tests/strings.js` and `tests/bench.js` to confirm detection is unchanged.
- Count-in, click scheduled on the audio clock, bar loop, tempo control, clean-repetition counter.
- Latency calibration (Settings): loopback test (click out of the speaker, mic listens; for Bluetooth headphones place one earcup at the mic) with a "pluck along" fallback. Stored per setup. Show the measured value and a re-test button.
- Make sure `getUserMedia` keeps echo cancellation, noise suppression and auto gain off (already so in `audio.js`; add a test or a visible check).
- Gate: T6 on a real device (measured offset repeatable within about 15 ms); looped-bar feedback appears within one second of stopping.

### Phase 5: Accompaniment (M)
- `js/core/synth-plan.js` (timeline to note-on/off list, pure) and `js/app/accompaniment.js` (`OfflineAudioContext` render of the range plus click to an `AudioBuffer`, play on the audio clock, re-render on tempo change). Simple additive piano-like voice; polyphony limit for phones.
- A headphones reminder when accompaniment is on; the setup records whether headphones are in use.
- Source of the accompaniment: other parts in the MusicXML (for example piano) or the MIDI file.
- Gate: accompaniment and click stay locked to the sheet at every bar at 50-120% tempo; no audible drift over a full piece.

### Phase 6: Coaching analytics (M)
- `js/core/ladder.js`, `bias.js`, `report.js` (pure and tested), `js/app/progress.js`, `js/app/report.js`.
- Scale practice writes `Take`-shaped records.
- Gate: a week of real use produces a bias profile and a ladder that you and the teacher agree with.

### Phase 7: Content pipeline (S-M)
- Lab: a "Use as piece" button that sends the reference MIDI into Pieces; a documented MuseScore workflow (`docs/musescore-workflow.md`: import MIDI or PDF-converted MusicXML, correct, export MusicXML/MXL, import into the app).
- Optional and experimental: PDF to MusicXML via Audiveris through the local helper if Java is available.
- Gate: a YouTube clip becomes a correctable piece in under ten minutes of your time.

### Phase 8: Polish (S)
- Colour-blind check, large-text option, tablet layout, offline re-test (`tests/smoke.js` plus a manual airplane-mode run), cache version bump, README and CLAUDE.md updates (folder map, new test commands, new conventions).

## 10. Test strategy and the Phase 2 gates

All gates run in Node unless stated. Each new core module gets a benchmark with a saved baseline that only goes up (`--update` rule from `CLAUDE.md`).

| ID | Test | Method | Gate |
|---|---|---|---|
| T1 | Synthetic injected errors | Render a piece from its timeline with a violin-like synth (vibrato, bow noise, legato and détaché), injecting: ±10/±20/±30 cent offsets, wrong semitones, a dropped bar, a restart, a skipped repeat, tempo drift | ≥90% of errors of 20 cents or more recovered with the right bar, note and direction; ≤5% false reds on clean takes |
| T2 | Teacher-labelled real takes | 10 real takes (mix of both students), teacher marks weak bars on paper; run `realtake.js`/the UI | Top-5 weak-bar overlap ≥70%; top-3 contains at least one teacher-marked bar in ≥80% of takes |
| T3 | Test-retest | Same passage played 5 times (real) and 5 synthetic renders with noise | Real: bar-score SD ≤5 points; define "reliable change" as 2 SD and use it for ladder decisions |
| T4 | Resolution floor | Sweep injected cents error 5-40 | Smallest error detected at ≥90% is ≤15 cents (record the number; it limits tolerance settings) |
| T5 | Legato and shifts | Existing legato cases in `tests/bench.js` plus shifts and runs at 16ths | Note-count error ≤15%; no `wrong` produced by a segmentation split alone (it must become `unsure`) |
| T6 | Latency recovery | Synthetic take with a known offset (0-300 ms) and a click | Recovered within ±15 ms |
| T7 | Double stops, grace notes | Fixtures | Always `notEvaluated`, never red |
| T8 | Partial and restarted takes | Synthetic | Correct scope banner; no spurious `missed` outside the played span |
| T9 | Regression | Existing ratchet suite | Unchanged or better |

Real recordings are personal data and copyrighted performances: never commit them, never put them in fixtures. Document how each was labelled in a local `tests/audio/README.local.txt` (git-ignored).

Kill and fallback rules: if T2 or T3 fail after two iterations, narrow the scorer (pitch only, Follow mode) rather than ship unreliable feedback. If OSMD fails its spike, use the fallback in section 3. If the AudioWorklet migration lowers any detection baseline, keep `ScriptProcessor` and use `AudioContext` timestamps with the calibrated latency.

## 11. Risks

1. **Segmentation on real violin** (legato, shifts, fast runs, vibrato). Mitigation: T5, the `unsure` class, optional Detailed (Basic Pitch) second opinion on `unsure` notes, offline analysis with look-ahead.
2. **OSMD size and speed on phones.** Mitigation: lazy load, vendor cache, Phase 3 spike, fallback renderer.
3. **Latency variation across devices and Bluetooth.** Mitigation: per-setup calibration, free mode that needs no absolute timing, a visible latency value.
4. **Equal temperament versus expressive intonation.** Mitigation: selectable reference, tolerances after adjustment, the per-take tuning offset.
5. **IndexedDB eviction or loss** (especially on iOS for non-installed web apps). Mitigation: install the PWA, `storage.persist()`, backup export with a periodic reminder, events kept even when audio is dropped.
6. **Scope creep.** Mitigation: phases with gates; the "Beyond pitch" items wait until the evaluator is trusted.
7. **Public repo.** Mitigation: git-ignored data paths, no scores or recordings in fixtures, the backup file is user-held.
8. **Rigid accompaniment** is not musical (no rubato). Accepted: it is a practice aid for tempo and ensemble; the player can switch to click only.

## 12. Out of scope (for now)

Accounts, login, cloud sync, sharing service, legal text; Demucs and other Python model pipelines; VioPTT and similar; LilyPond; a notation editor; guitar and ukulele pieces (their tuner and scale features stay as they are); chord and double-stop evaluation; tone, bow and phrasing judgement; real-time whole-piece colouring.

## 13. Working agreements for Claude Code

Per change:
1. Decide core vs app: logic without screen or storage goes in `js/core/` with a Node test; screens and browser APIs go in `js/app/`.
2. Add or extend the benchmark or test first when changing detection, segmentation or evaluation.
3. New file under `js/`, `css/`, `icons/` or `vendor/`: list it in `index.html` (load order) and in `FILES` in `sw.js`; run `node tests/structure.js`.
4. Bump `CACHE` in `sw.js`.
5. Run: `node tests/structure.js`, `node tests/smoke.js`, the relevant benchmarks from `CLAUDE.md`, and any new tests. Fix regressions; do not commit them.
6. Look at screenshots after any display change.
7. Commit and push once per set of changes (see `CLAUDE.md`).
8. Ask the owner before: changing the pitch detector's public behaviour, deleting stored data formats, adding any network call from the app, or adding anything that sends data off the device.

## Appendix A: default parameters (all in `EVAL_PARAMS`, all tunable by the spike)

| Parameter | Default |
|---|---|
| Piece tolerance (settled cents) | ±15 (player setting) |
| Scale and slow-practice tolerance | ±10 (existing `tol` default) |
| Wrong-note threshold | rounded semitone differs after tuning offset |
| Landing window | first 100 ms of a note |
| Settled window | after 100 ms |
| Unsure | <5 voiced frames, or median clarity under threshold, or octave/twelfth suspect, or Detailed disagrees by >50 cents |
| Rhythm ok (click mode) | ≤ max(50 ms, 12% of a beat) |
| Attempt split | silence ≥ 1.0 s or position jump backwards |
| Tuning offset cap | ±40 cents |
| Weights | pitch 0.5, rhythm 0.3, completeness 0.2 |
| Ladder step | +4 BPM or 5%, after 3 clean takes; start at 60% of marked tempo |
| Clean take | pitch ≥ 90%, rhythm ≥ 85%, completeness 100% |
| Bias report | median ≥ 8 cents, ≥ 6 samples, ≥ 3 takes, ≥ 70% same sign |
| Takes keeping audio | last 10 per piece range, capped by storage estimate |

## Appendix B: just-intonation adjustments (cents relative to equal temperament, major-key degrees, tonic-centred)

| Degree | Just ratio | Adjustment |
|---|---|---|
| 1 | 1/1 | 0 |
| 2 | 9/8 | +4 |
| 3 | 5/4 | -14 |
| 4 | 4/3 | -2 |
| 5 | 3/2 | +2 |
| 6 | 5/3 | -16 |
| 7 | 15/8 | -12 (leading tone is often played higher in melody: make this a player setting, default 0) |

Minor keys and chromatic notes use ET unless the owner adds more rows. Keep this table in `js/core/intonation.js` and test it. When the evaluator cannot tell the key (modulations), fall back to equal temperament and say so.

## Appendix C: inputs needed from the owner (defaults used if not answered)

1. Which devices the players use (phone, tablet, laptop, and iOS or Android). Default: test on all three; assume Safari on iOS is the strictest.
2. Where repertoire comes from (teacher PDFs, books, IMSLP). Default: MusicXML from MuseScore, with the Phase 7 workflow.
3. Whether the teacher will label about 10 takes for gate T2. Default: the owner labels them and the gate's confidence is lower; ask the teacher as soon as takes exist.
4. Headphones: Bluetooth or wired. Default: calibrate per setup and recommend wired.
