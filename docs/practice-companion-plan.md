# Practice Companion: build plan (v5, for Claude Code)

v5 changes (read these first): (1) accuracy is the first priority, so a new **Phase A** measures the current pitch front end on real recordings and replaces components by evidence (section 3 decisions 12-14, Appendix D, Appendix E); (2) instrument scope is **violin first, then guitar, ukulele and piano**; nothing else; (3) all inputs go through **one "Add a piece" screen** (section 7); (4) VioPTT and Demucs are now evaluated as import engines in the local helper, never used for scoring a live take.

Status: design only. Nothing here is built unless marked "(exists)". Written for the existing PWA in this repo (`note-recorder`, deployed to GitHub Pages). Background on the detector and Basic Pitch is in `docs/intelligence-plan.md`; working rules are in `CLAUDE.md`. Read both first. Where this plan and `CLAUDE.md` disagree, `CLAUDE.md` wins.

## 0. How to use this document

Work one phase at a time (section 9). Each phase ends with a gate. Do not start a phase until the previous gate passes. After each phase: run the tests listed, bump `CACHE` in `sw.js`, list new files in `index.html` and `FILES` in `sw.js`, commit, push (see `CLAUDE.md`).

Suggested first prompt: "Read CLAUDE.md, docs/intelligence-plan.md and docs/practice-companion-plan.md. Implement Phase 0 only, then stop and report."

Hard constraints (all from the existing repo, repeated because breaking them is expensive):
- No build step for the app. Vanilla JS, classic scripts, shared scope in `js/app/`. Pure logic in `js/core/` (no `document`, `window`, `localStorage`, `indexedDB`), loaded by Node tests through `tests/lib/load.js`.
- Until the owner approves the Phase A decision memo, `yin()` in `js/core/pitch.js` stays the only pitch detector inside the app. Phase A may add candidate detectors under `tests/` and `tools/lab/` for measurement only. After approval, `js/core/f0.js` becomes the single front-end interface (decision 12) and the "one detector" rule in `CLAUDE.md` is updated to say so. Do not change that rule without the owner's approval.
- Never make detection worse: `tests/bench.js`, `tests/strings.js`, `tests/detailed-strings.js`, `tests/pitch-sweep.js`, `tests/resample.js` and their baselines in `tests/baselines/` must not regress.
- Everything must work offline after install. Anything heavy is vendored under `vendor/` and cached by the service worker.
- No Python or native modules in the critical path. This PC's Application Control policy blocks some native Python modules; do not try to work around it (see `CLAUDE.md`). Python/Node helper tools stay optional and live under `tools/lab/`.
- The repo and the site are public. Never commit recordings, exported practice data, or copyrighted scores. Test fixtures must be self-written or public domain. Add `backups/` and `*.practice.json` to `.gitignore` in Phase 0.

## 1. Product

**One sentence.** An offline PWA that shows a piece as sheet music, plays an accompaniment and click, listens to a violin student play, and says which bars to fix next, how far off each note was (in cents and milliseconds), and whether practice is working over time.

**Instruments.** Violin first (the accuracy bar is set here), then guitar, ukulele and piano. No other instruments. Violin, guitar and ukulele single-note lines use the monophonic evaluator; chords (guitar, ukulele) and piano use score-informed polyphonic verification (decision 14). Piano also accepts a MIDI keyboard, which is exact.

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

1. **Browser-only core.** GitHub Pages is static hosting, so a FastAPI/Celery/Postgres backend is out. Evaluation runs in the page, in `js/core/`, testable in Node. The pitch front end (decision 12) is chosen by measurement in Phase A. Heavy, offline, import-only models (VioPTT, Demucs) run in the local helper on the PC (decision 13).
2. **Evaluate note events, not raw frames.** Align the `Segmenter` note events (`{midi, note, hz, cents, start, dur, lvl, pts, vib}`) to the reference notes with a dynamic-programming alignment. Hundreds of notes, so it runs instantly and a looped bar scores in well under a second. The cost is that segmentation errors become scoring errors, which is why segmentation is gated by tests (section 10) and low-confidence notes become "unsure".
3. **Reference is a timeline, not an audio file.** MusicXML is parsed into a flat list of notes with beats, a tempo map and a bar table (repeats expanded). Everything downstream (display, scoring, accompaniment, metronome sync, bar loops) reads this one structure.
4. **Sheet display: OpenSheetMusicDisplay (BSD-3-Clause), vendored and lazy-loaded.** Needs a spike (Phase 3 gate: three sample scores render in under 3 s on the phone and tablet; coloured per note; tap a bar to select). Fallback: VexFlow (MIT), or the existing Sheet renderer in `chart.js` for simple pieces. MIDI-only imports use the existing Falling view and are not engraved.
5. **Accompaniment is synthesised from the score**, not time-stretched from a recording. Render the chosen range with `OfflineAudioContext` into an `AudioBuffer` (accompaniment plus click), then play it on the audio clock. This gives exact tempo changes, exact metronome sync and exact bar loops. Simple additive piano-like synth first; better sounds are optional later.
6. **Timing is measured against the audio clock with calibrated latency.** Capture moves from `ScriptProcessor` to `AudioWorklet` so every block has a sample-accurate time. A per-"setup" latency offset (for example "iPad + AirPods") is measured once and subtracted. Without a click (free mode), timing is judged by interval ratios and tempo drift, never by absolute time.
7. **DTW is for alignment only, never for measuring timing.** Timing is measured from matched onsets after alignment, against the click grid (click mode) or a fitted local tempo (free mode). Do not read rhythm error out of how far the alignment path bent.
8. **Storage: IndexedDB for takes and pieces; `localStorage` stays for settings.** Request `navigator.storage.persist()`. Keep raw audio for only the last N takes per piece range (default 10, capped by `navigator.storage.estimate()`), because recordings are about 5 MB per minute at 16-bit mono 44.1 kHz. Always keep note events and results so old takes remain viewable. Provide Export/Import of everything as one file.
9. **Players, not accounts.** A profile picker (names, per-player tolerance, A4, intonation reference, setups). No passwords, no network identity.
10. **Intonation reference is selectable.** Default equal temperament. Option "Just (key-aware)" adjusts targets by scale degree (appendix B) because expressive intonation on violin differs from piano tuning by up to about 14 cents on thirds. Tolerances apply after the adjustment and after the per-take tuning offset.
11. **Dropped from earlier plans:** Celery/Redis/Postgres/Docker/JWT, GPU, MuScriptor, LilyPond (use OSMD SVG and `window.print`), custom notation editor (use MuseScore), time-stretched backing tracks. VioPTT and Demucs are no longer dropped; see decision 13.
12. **Pitch front end is a replaceable provider, chosen by data (Phase A).** Interface in `js/core/f0.js`: `{ name, sampleRate, hop, range, estimate(samples) -> [{t, hz, conf}] }`. Candidates measured on the gold set: the current YIN path, pYIN, McLeod (MPM), CREPE, **SwiftF0**, PESTO, and heavier ones (RMVPE, FCPE) only if the light ones fall short. Reasons to expect YIN to be beaten (evidence in Appendix D): on a published 19-tracker benchmark, pYIN scores 0.506 pitch F1 against SwiftF0 0.781, CREPE 0.689, PESTO 0.680; SwiftF0 degrades much less with background noise and room reverb. Reasons not to adopt blindly: that benchmark scores at 50 cents, mostly on speech and singing, with no violin-specific corpus, and your target is intonation within 10-15 cents. Design to test: **coarse neural pitch, fine classical refinement** (the neural result sets the octave and voicing; YIN or an equivalent refines cents inside a narrow window around it, as `refineEvents` already does for Basic Pitch notes). Add **score-informed constraint**: when a reference is loaded, only pitches within about one semitone of the expected note (plus the take's tuning offset) are accepted as that note, and anything else is flagged "unexpected", which removes octave and harmonic errors almost entirely. Also test the input chain (Phase A hypotheses H1-H7).
13. **Import engines (offline, local helper, PC only).** Used only to build a draft reference from audio; never to score a take (scoring against a known reference does not need transcription). Candidates, compared in the Lab on the gold clips: Basic Pitch (exists), SwiftF0 plus the segmenter, **VioPTT** (Apache-2.0 code; weights licence not stated, check before use; PyTorch, offline 16 kHz mono, semitone-level MIDI plus four technique labels; reported note F1 84.5 on URMP and 69.9 on Bach10 professional solo violin; not evaluated on mic recordings, beginners or noise; no ONNX build found), **Demucs** (the Lab already runs `htdemucs` 4-stem; `htdemucs_6s` adds guitar and piano stems but no violin stem, so violin falls in "other"; the 6-stem guitar and piano stems are described as experimental with bleeding). Adopt an engine for import only if it beats the others on the owner's own gold clips. Everything audio-derived is a **Draft** (decision 15).
14. **Instrument evaluators.** (a) *Monophonic* (violin; single-note guitar and ukulele lines): section 6. (b) *Score-informed polyphonic verification* (guitar and ukulele chords, piano from audio): do not transcribe; for each expected chord or note at its expected time, test whether the expected pitches are present and no wrong ones are strongly present, using Basic Pitch frame activations plus chroma. Verifying is far more accurate than transcribing. (c) *Piano with a MIDI keyboard*: Web MIDI gives exact notes and velocities (works in Chrome and Edge and on Android, not in iOS Safari); piano is judged on note correctness, timing, evenness and dynamics, with no intonation. Dedicated piano transcribers (for example the ByteDance high-resolution model, about 20 million parameters; no browser build found) are an optional local-helper engine, to be measured before use.
15. **Draft and Verified references.** A reference built from audio is a Draft. Scoring against a Draft is allowed but every result is labelled "provisional" until the player marks the piece Verified after checking it (A/B listen of the draft against the source, low-confidence bars highlighted, correction in MuseScore or quick fixes). MusicXML and MIDI imports are Verified by default. This prevents the app from teaching wrong notes with confidence.

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
- **Pieces (library):** list with last practised, tempo reached, share of bars "learned", a Draft/Verified badge. One "+ Add a piece" button, which opens the screen below. Also shown on first run.
- **Add a piece (the only input screen).** All sources go through here; nothing else imports anything. Layout, top to bottom:
  1. **Instrument** chips: Violin, Guitar, Ukulele, Piano (remembered per player).
  2. **One smart drop zone**: "Drop a file, paste a link, or press Record". It detects what it was given (YouTube URL, `.musicxml`/`.mxl`, `.mid`, audio file) and routes it. Under it, four explicit tiles for the same thing, each with a quality badge so the player knows what to expect:
     - **Score file** (MusicXML, MXL, MIDI): "Best quality, exact notes".
     - **Audio file** (mp3, wav, m4a, flac): "Good for a solo recording, becomes a Draft".
     - **YouTube link**: "Becomes a Draft; needs the helper on your PC".
     - **Record**: "Record a demo (teacher or you playing the piece)". It runs a **mic check first** (level, noise, clipping, grade Good/Fair/Poor, reusing the existing calibration code) because a poor recording limits accuracy no matter the model. Takes of the student's own practice are recorded inside the Piece view, not here.
  3. **Questions that appear after a source is chosen** (only what is needed): what is it (solo instrument, instrument with accompaniment, full song); which part is yours (MusicXML with several parts); melody only or chords (guitar, ukulele, piano); title and composer (autofilled from the file or link).
  4. **One progress stepper** with the real stage names and a Cancel button: Fetching audio, Separating (only for mixed audio), Detecting notes, Building the score, Checking. It runs in a Web Worker so the screen never freezes. The engine used and its confidence are shown at the end.
  5. **Helper chip**: "Helper connected / not connected" with a one-line fix. YouTube, separation and VioPTT need the local helper on `127.0.0.1`, so they work from desktop Chrome or Edge on the PC. Phones and tablets cannot reach it; import on the PC, then move the piece to the phone with the backup file (Phase 0). Say this on screen instead of failing silently.
  6. **Review draft** (audio-derived sources only): the sheet with low-confidence bars highlighted (bars where engines disagree or the tracker was unsure), a play button that plays the draft next to the source audio for A/B listening, and three actions: Fix in MuseScore (download MusicXML or MIDI and re-import), Quick fixes (shift an octave for a range, set key, time signature or tempo), Mark Verified. Until Verified, results are labelled provisional.
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

Sizes: S = a day or two, M = about a week, L = one to two weeks of part-time work. Order: 0, A, 1, 2, 3, 4, 5, 6, 7, then 9 and 10 (other instruments, only after the violin gates pass), then 11. Phase A comes before the evaluator spike because the evaluator is only as good as the pitch front end under it.

### Phase 0: Foundations (S)
- `js/core/schema.js` (shapes, `SCHEMA_VERSION`), `js/app/store.js` (IndexedDB: players, setups, pieces, takes, audio, ladders, sessions), `js/app/players.js` (profile picker), `js/app/backup.js` (export/import one JSON file, optionally with audio), `navigator.storage.persist()`, storage-usage display.
- `.gitignore`: `backups/`, `*.practice.json`.
- Migrate nothing yet; existing `localStorage` settings and scale passes keep working.
- Tests: `tests/structure.js`, `tests/smoke.js` still pass; a new `tests/store.js` smoke through headless Edge (create player, write/read a take, export, import).
- Gate: backup round-trips; the app loads offline; no regression in the existing benchmarks.

### Phase A: Accuracy foundation (L). Do this before Phase 1.
Why: today's benchmarks (`tests/bench.js`) score 1.00 on every case because they use synthetic audio, and the real clip in `tests/audio` (`violin1.f32`) is a sustained-note tuner recording with no ground truth, so nothing in the repo can measure the "bad microphone output" problem. Fix the measurement first, then fix the cause.
- **A1 Gold set (Appendix E).** Record and label real clips in the conditions the students actually use. Audio stays in git-ignored `tests/audio/`; only a metadata manifest without audio may be committed.
- **A2 Harness `tests/gold.js`.** Runs each candidate front end and import engine over the gold set and prints one table: voiced precision/recall, raw pitch accuracy at 50, 20 and 10 cents, octave-error rate, note-level F1 (onset 50 ms, pitch 50 cents, as in the VioPTT paper, so numbers are comparable), coverage, and seconds of compute per minute of audio. Candidates: current live path, current offline `analyseSamples`, pYIN, MPM, CREPE (Lab), SwiftF0 (ONNX; `onnxruntime-node` in tests, `onnxruntime-web` in the page), PESTO, Basic Pitch; for import: Basic Pitch, SwiftF0 plus segmenter, VioPTT, and each with and without Demucs. Save a ratcheted baseline on the gold set (a new `tests/baselines/gold.json`, no audio in it).
- **A3 Diagnose the input chain.** Test these hypotheses one at a time on the gold set and keep only changes that help: H1 analysis window and hop (the live window is 4096 samples, about 93 ms at 44.1 kHz, which is slow and smears fast passages); H2 the 70 Hz high-pass and 6 kHz low-pass filters in `audio.js`; H3 gate and boost calibration; H4 device-level processing that stays on despite the constraints (the app already reads the actual track settings; add the result to the diagnostics); H5 YIN threshold, harmonic check and the octave logic; H6 segmenter heuristics (confirm, `maxMiss`, re-articulation); H7 room reverb, bow noise and accompaniment. Also test a better microphone (a clip-on or USB mic) on the same clips: if hardware moves accuracy more than software, say so in the report.
- **A4 Decision memo `docs/accuracy-report.md`.** Tables from A2, the root causes found in A3, the chosen front end and import engines with reasons, and what is still unproven. The owner approves it before any detector is added to the app.
- **A5 Implement.** `js/core/f0.js` interface, the chosen provider(s) vendored under `vendor/` (SwiftF0 ONNX is MIT and about 14 thousand parameters in the current release; check the file size and `onnxruntime-web` size, lazy-load, cache in the service worker), the coarse-neural plus fine-classical refinement, and the score-informed constraint hooks used later by the evaluator. Update `CLAUDE.md`'s detector rule.
- **Gate (targets to be confirmed against the baseline measured in A2):** on solo-violin gold clips in the students' real conditions, raw pitch accuracy within 20 cents of the silver truth in at least 95% of voiced frames; octave and harmonic errors at most 0.5% of voiced frames; note-level F1 at least 0.95 when a score is known (score-informed) and at least 0.85 without one; no regression on the existing ratchet. If a target cannot be met with software alone, the report must say what hardware or recording practice would meet it. Do not proceed to Phase 2 on a front end that misses the gate.

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
- `js/app/add-piece.js` (the single "Add a piece" screen, section 7): build the whole shell now with all four tiles, the instrument chips, the smart drop zone, the mic check and the stepper. Active tiles in this phase: Score file (MusicXML, MXL, MIDI), Audio file and Record, using the client-side pipeline only. The YouTube tile and the Separating step show "needs the helper" until Phase 7.
- `js/app/pieces.js`, `js/app/piece-view.js`, `js/app/feedback.js`: library, sheet, bar-range selection, record a take with the existing audio path, run the evaluator, colour the notes, bar heat strip, weak-bar list, note detail on tap.
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

### Phase 7: Audio import engines in the helper (M)
- Wire the helper (`tools/lab/server.js`) to the "Add a piece" screen: YouTube fetch (yt-dlp, already there), Demucs separation (the Lab's `htdemucs` script exists; add `htdemucs_6s` for guitar and piano stems only if Phase A shows it helps), and the import engine(s) chosen in the Phase A memo (VioPTT only if it wins on the gold clips and its weights licence permits use; otherwise SwiftF0 plus segmenter and Basic Pitch).
- Per-bar confidence from engine agreement (the `consensus` logic in `compare.js`), the Draft/Verified flow and the A/B listen in the Review screen, and a documented MuseScore workflow (`docs/musescore-workflow.md`).
- Optional and experimental: PDF to MusicXML via Audiveris through the helper if Java is available.
- Gate: on the gold import clips, a Draft's note-level F1 against the corrected score is at least the value recorded in the Phase A memo, and a YouTube clip becomes a correctable piece in under ten minutes of the owner's time.

### Phase 9: Guitar and ukulele (M, only after the violin gate passes)
- Single-note lines: the monophonic evaluator with the instrument's range and tuning profile (these profiles exist in `profiles.js` and `music.js`).
- Chords: score-informed verification (decision 14b): expected chord tones present, wrong tones absent, strum timing; per-string detail is out of scope unless the gold set shows it is reliable.
- Gold clips for these instruments are added to Appendix E before work starts; the gate uses chord-verification precision and recall measured on them, set from the baseline.

### Phase 10: Piano (M)
- Web MIDI keyboard input first (exact notes, timing and velocity); evaluate note correctness, timing, evenness and dynamics. The gold set can be recorded as audio and MIDI together, which gives exact truth for audio-based piano evaluation.
- Audio-only piano: score-informed verification (decision 14b) with Basic Pitch frames; a dedicated piano transcriber in the helper only if the gold set shows verification is not accurate enough.
- Gate: on the gold piano clips, note-level F1 against the exact MIDI truth meets the target recorded in the report.

### Phase 11: Polish (S)
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
| T10 | Front-end accuracy on real recordings | `tests/gold.js` on the gold set (Appendix E) | Phase A gate; baseline ratcheted |

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

Accounts, login, cloud sync, sharing service, legal text; any instrument other than violin, guitar, ukulele and piano; LilyPond; a notation editor; violin double-stop evaluation; tone, bow and phrasing judgement; violin technique labels (VioPTT's détaché, spiccato, pizzicato and flageolet classes reach only about 77% macro accuracy and confuse détaché with spiccato, so use them at most as an import hint); real-time whole-piece colouring; running VioPTT or Demucs inside the page or on a phone.

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

## Appendix D: framework evaluation (what is known, what is not)

Sources: SwiftF0 paper and benchmark ([arXiv 2508.18440](https://arxiv.org/abs/2508.18440), [pitch-benchmark](https://github.com/lars76/pitch-benchmark)); VioPTT ([arXiv 2509.23759](https://arxiv.org/abs/2509.23759), [repo](https://github.com/y10ab1/VioPTT)); PESTO ([arXiv 2508.01488](https://arxiv.org/abs/2508.01488)); Demucs 6-stem model cards on Hugging Face (for example [htdemucs-6s-onnx](https://huggingface.co/StemSplitio/htdemucs-6s-onnx)). Figures are the authors' own; treat them as hints until Phase A reproduces them on the gold set.

| Option | What it is | Evidence | Fit for this app | Unknowns to settle in Phase A |
|---|---|---|---|---|
| YIN (current, with harmonic check) | Classical autocorrelation detector, live | Not in the benchmark; its probabilistic cousin pYIN scores 0.506 pitch F1 versus SwiftF0 0.781, CREPE 0.689, PESTO 0.680 (50-cent tolerance, 19 trackers, 10 corpora, 8 recording conditions) | Very precise in cents on clean tones; weak in noise and reverb | How it does on the students' real recordings; window, filters and gating (H1-H3) |
| SwiftF0 | Tiny neural monophonic tracker, ONNX, MIT, 16 kHz, 16 ms hop, range 46.9 Hz to 2093.75 Hz (covers G3 to C7), runs in the browser with `onnxruntime-web`, 176 ms lookahead | On URMP (chamber music) 0.838 versus CREPE 0.750 and pYIN 0.671; room reverb costs it about 0.15 F1; octave errors about 0.4% | Strong candidate for voicing and octave decisions; monophonic only; top range ends at C7 | Cents precision (the benchmark is at 50 cents), model and runtime file sizes, behaviour on real mics, notes above C7 |
| CREPE, torchcrepe, PESTO, RMVPE, FCPE | Other neural trackers | CREPE 0.689, PESTO 0.680, RMVPE 0.768, FCPE 0.728 in the same benchmark | CREPE is heavy for a phone; PESTO is light but no browser build was found; RMVPE and FCPE are heavier | Only measure the ones the light candidates fail to beat |
| Basic Pitch | Polyphonic transcriber (exists, bundled) | On monophonic noisy pitch tracking it scored 29.5 harmonic mean at 10 dB against SwiftF0's 91.8 (paper table; different task, indicative only) | Right tool for chords and onsets, not for precise single-line intonation | Role limited to polyphony and the Detailed path |
| VioPTT | Violin transcription plus four technique labels, PyTorch, offline, 16 kHz | Note F1 84.5 on URMP violin, 69.9 on Bach10 violin; technique macro accuracy 77.2% on RWC; semitone-level output, no cents; weights licence not stated; no ONNX; no tests on microphones, beginners or noise | Possible engine for building a draft from a solo violin recording, on the PC helper only; cannot score live takes | Whether it beats SwiftF0 plus segmenter and Basic Pitch on the gold import clips; weights licence; runs on this PC under Application Control |
| Demucs (`htdemucs`, `htdemucs_6s`) | Source separation | 6-stem has drums, bass, other, vocals, guitar, piano and no violin stem; "other" about 5.5 dB SDR on MUSDB18 (pop and rock); guitar and piano stems described as experimental with bleeding; no violin or orchestral numbers | Helps import from mixed audio (YouTube, violin with piano); adds artifacts | Net effect on transcription accuracy per clip type, measured by comparing with and without separation |
| Dedicated piano transcribers (for example ByteDance high-resolution, about 20M parameters) | Piano-specific transcription | Strong on piano in the literature; no browser build found | Optional helper engine for piano audio | Only if score-informed verification is not accurate enough; MIDI keyboard makes it unnecessary for live practice |

Principles drawn from this: (1) verification against a known score is more accurate than open-ended transcription, so scoring uses the score; (2) use a robust neural estimate for octave and voicing and a precise classical estimate for cents, and prove the combination on real clips; (3) nothing in this table is adopted on a paper's word.

## Appendix E: gold set (the measurement that did not exist)

Goal: ground truth good enough to judge cents-level intonation and note-level correctness on the students' real recordings. Audio stays in git-ignored `tests/audio/`; commit only a manifest of metadata (no audio, no names).

- **Violin, 12-20 clips of 15-40 s.** Both students, the teacher or an adult player, on each device they use (phone, tablet, laptop), in their normal room, with and without accompaniment, with vibrato and without, legato, détaché, spiccato, fast passages, shifts, and a few deliberate mistakes. Each clip is a known piece with a MusicXML score.
- **Truth.** (a) Notes: the score, with the actual played notes hand-corrected (marked on paper by the teacher or in MuseScore). (b) Cents: record a second, clean close-microphone take at the same time (a second device held close, or a better microphone); treat the agreement of the best trackers on that clean signal, refined with YIN, as silver truth, and measure how far the practice-condition estimate falls from it. (c) Synthetic clips from `tests/lib/synth.js` stay as regression tests but are never the quality number.
- **Import clips, 8-10.** Solo violin recordings, violin with piano, and a few full songs, each with a corrected MusicXML or MIDI as truth.
- **Guitar and ukulele (Phase 9), piano (Phase 10).** 8-10 clips each: single lines, strummed chords with a known chord sheet, piano with the MIDI keyboard capturing exact truth alongside the audio.
- **Rules.** Record at the device's native rate (the app already keeps this), note the device, mic and room in the manifest, include "bad" clips on purpose (noise, reverb, clipping), and never edit a clip after labelling it.

## Appendix C: inputs needed from the owner (defaults used if not answered)

1. Which devices the players use (phone, tablet, laptop, and iOS or Android). Default: test on all three; assume Safari on iOS is the strictest.
2. Where repertoire comes from (teacher PDFs, books, IMSLP). Default: MusicXML from MuseScore, with the Phase 7 workflow.
3. Whether the teacher will label about 10 takes for gate T2. Default: the owner labels them and the gate's confidence is lower; ask the teacher as soon as takes exist.
4. Headphones: Bluetooth or wired. Default: calibrate per setup and recommend wired.
5. Which microphones are available (built-in only, or a clip-on or USB mic). Default: test built-in first, then a better mic on the same clips; the Phase A report states the difference.
6. Whether a MIDI keyboard is available for piano. Default: build audio-based piano evaluation second and treat MIDI as the accurate path.
7. Who can help record and mark the gold clips (students, teacher). Without them Phase A cannot start; it is the most important input in this plan.
