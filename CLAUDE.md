# Tuner & Scale Trainer (note-recorder)

Installable offline PWA, no build step: `index.html` (markup only), `css/`, `js/core/` (pure logic), `js/app/` (the screens), `icons/`, `sw.js`, `manifest.webmanifest`. It is deployed with GitHub Pages from `main` at https://parasgupta1508.github.io/note-recorder/ (the repo is public for this reason). Pushing to `main` redeploys it within about a minute. `README.md` has the folder map and "how to add a feature" recipes.

## Automatic GitHub backup

Backup repo: https://github.com/parasgupta1508/note-recorder (public, branch `main`). The GitHub CLI is installed and signed in as `parasgupta1508`.

Whenever you change any file in this project, back it up to GitHub without being asked:

1. Run `git add -A`, then `git commit` with a short message describing the change, then `git push`, all from this folder.
2. Do this once at the end of each set of changes, not after every single edit.
3. End the commit message with the attribution line from the session's system reminder, if there is one.
4. Tell the user the backup is done, or say why it failed. If the push fails because the login expired, run `gh auth login --hostname github.com --git-protocol https --web` and ask the user to approve the code. Don't pipe that command's output.

## Layout rules

- `js/core/*.js` is pure (no `document`, `window`, `localStorage`). Tests load these exact files in Node through `tests/lib/load.js`. Anything that touches the screen or the microphone goes in `js/app/`.
- `js/app/*.js` are classic scripts that share one scope, loaded in the order `index.html` lists them. A top-level statement may only call things from files loaded earlier. Calls inside functions are fine. `main.js` loads last.
- `yin()` in `js/core/pitch.js` is the single pitch detector. The tuner, Practice, the Recorder, the self-test, file analysis and the Detailed refinement all call it, so improve it there and every module benefits. Do not write a second detector. Screens and tests reach it through the engine registry (`getEngine('f0')`, `engineFor('f0','live')` in the app); `"auto"` always means `yin`, `classic`, `basicpitch` until the owner approves a change. New engines are added by registering a file in `js/core/engines/` or `js/app/engines/` and must pass `tests/engine-contract.js`.
- When you add, rename or remove a file under `js/`, `css/` or `icons/`: list it in `index.html` AND in `FILES` in `sw.js` (otherwise the app breaks offline). `node tests/structure.js` checks both.
- No loose images in the project root. Icons live in `icons/`.

## Never make detection worse (ratchet)

Each benchmark runs the real code and compares with a saved baseline in `tests/baselines/`. The baseline only ever goes up: `--update` saves it only when nothing got worse.

| Command | What it checks | When to run it |
|---|---|---|
| `node tests/bench.js` | Violin cases: legato, détaché, staccato, fast runs, noise, violin over piano | Any change to `yin`, `Segmenter`, `recPitchCore`, `analyseSamples`, `REC_MODES` |
| `node tests/strings.js` | Live path on violin, guitar, ukulele with known notes, cents, detune, reverb, hum, chatter, clipping, ringing, beating (`tests/lib/synth.js`) | Same as above, and any change to the Recorder loop or `AutoMode` |
| `node tests/detailed-strings.js` | Detailed path with the real Basic Pitch model in Node (about 5 min; needs `tools/node_modules`) | Any change to `bpToEvents`, `markAttacks`, `refineEvents`, `extractMelody`, `resample`, `BP_PARAMS` |
| `node tests/pitch-sweep.js` | Raw YIN error per semitone and sample rate | Any change to `yin` |
| `node tests/resample.js` | The resampler keeps pitch and level and does not alias | Any change to `resample` |
| `node tests/library.js` | Library model: packs to category tree, search, generated scales, transposition and range, bar grid | Any change to `library.js` |
| `node tests/piece-import.js` | MIDI / MusicXML / .mxl importers and the input detector (fixtures are built in `tests/lib/fixtures.js`) | Any change to `midi.js`, `musicxml.js`, `piece.js` |
| `node tests/piece-practice.js` | Piece practice, the pure parts: instrument scan of `<part-list>`, one melodic line, the scale-style timeline, bars, accompaniment events, GitHub link parsing and file lists | Any change to `piece-practice.js`, `github-library.js`, `musicxml.js` or the beat/position maps in `visual.js` |
| `node tests/smoke-piece.js` | Piece practice end to end in headless Edge: source picker, locked badge or part list, the four displays, Wait and Tempo runs, result and history, bar range, back to scales | Any change to `js/app/piece-practice.js` or to the practice engine / views it plugs into |
| `node tests/engine-contract.js` | Every engine in the registry (`js/core/engines/`): shape, silence, determinism, range, time budget | Adding or changing an engine, or the registry |

### Real-sound tests (speaker → microphone)

Not a ratchet and not part of CI: they need a person at the PC, because the notes are played out loud and recorded with the real microphone (headed Edge with `--use-fake-ui-for-media-stream`, which only auto-accepts the permission prompt). Raise the speaker volume first; the run prints "TOO QUIET / INCONCLUSIVE" (exit 2) when the mic barely hears the speaker. WAV recordings go to `tests/_mic/` (git-ignored).

| Command | What it does |
|---|---|
| `node tests/mic-loopback.js` | Plays the notes of the MusicXML scores in `tests/samples/` through the speaker and reads them back with the app's own detector, next to a synthesised control |
| `node tests/mic-loopback.js --mode app` | Same through the real Tuner screen: note shown, offset, and whether the in-tune beep fires |
| `node tests/mic-loopback.js --mode listen --sec 10` | Records the mic while you play/sing and prints the notes heard (use for any real-sound check; `--lo/--hi` set the Hz range) |
| `node tests/tuner-musicxml.js` | Synthesised-only version of the above (no speaker, runs anywhere) |

If a benchmark prints REGRESSION, fix the change or drop it. Do not commit it. When you add a detection feature, add a benchmark case for it first. `DBG="guitar mid clean auto" node tests/strings.js` prints expected versus found notes; `KIND=repeat`, `ONLY=ukulele` narrow the Detailed run.

## Detection facts worth remembering

- YIN finds a half or a third of the true period when a harmonic is strong (a bowed violin note swelling). `yin` checks the spectrum: if there is a clear peak at f/2 or f/3 and the signal repeats more cleanly at 2x or 3x the period, that is the pitch. This idea comes from fgnass/tuner (MIT). aubio is GPL-3.0, so never copy its code; use its ideas only.
- Basic Pitch only ends a note after 11 quiet frames (about 128 ms), so a repeated note can merge into one long note. `markAttacks` finds the fresh attack in the audio and `extractMelody` then keeps those notes apart.
- Basic Pitch pitch bends in this build are centred on 1 (1.0 = exactly on the note). `bpToEvents` subtracts 1. `refineEvents` then re-measures every note's pitch with `yin`, because the model's bends only have 1/3-semitone steps.
- Recordings are kept at the device's own sample rate (16-bit). `resample` converts to 22,050 Hz for Basic Pitch with a proper low-pass filter.

## Detailed analysis (Basic Pitch) and browser tests

- `vendor/` holds the offline Detailed-analysis files (Basic Pitch model + TensorFlow.js, Apache-2.0). Rebuild with `cd tools && npm install && npm run build`. They are loaded only when Detailed mode is used, and cached by the service worker in its own `tuner-vendor-v1` cache.
- `node tests/smoke.js`: loads the page in headless Edge, checks for script errors, clicks through the Recorder. A script error at load silently kills every button, so run it before every commit.
- `node tests/structure.js`: file layout, offline cache list, core purity.
- `node tests/smoke-detailed.js` runs a synthetic recording through the Detailed path in headless Edge (about 30 s). Run it after changing `analyseDetailed` or `vendor/`.
- `node tests/shot.js <folder>` renders the Recorder (Falling, Sheet, full screen; phone and tablet sizes) with sample notes and saves screenshots. Look at them after any display change.
- Audio test clips (`tests/audio/`, `*.mp3`) are copyrighted or personal and git-ignored. Never commit them. `tests/realclip.js <file.f32>` runs the Live detector over a decoded clip (`ffmpeg -i x.mp3 -ac 1 -ar 44100 -f f32le x.f32`).
- Design background and roadmap: `docs/intelligence-plan.md`.
- UI correction and pluggable engine registry (build this first, work packages UI0-UI6): `docs/ui-and-engines-plan.md`.
- Practice Companion build plan (pieces, scoring against a reference score, tempo ladder, teacher report): `docs/practice-companion-plan.md`. Work one phase at a time and stop at each gate.

## Scale evaluation, history, coach and visuals

- Pure code in `js/core/`: `evaluation.js` (Trinity-style 100-point rubric: 50% pitch, 30% fluency and pulse, 20% tone and steadiness; bands Distinction 87+, Merit 75+, Pass 60+), `history.js` (the compact record of a run, trend, personal best, day streak), `coach.js` (rule-based teacher feedback from the run plus earlier runs), `visual.js` (staff, key signature, ledger lines, slurs, neck and keyboard geometry). Tested by `node tests/evaluation.js`.
- App code: `scale-visual.js` draws the notation, the neck or keys and the cursor (custom SVG, built once per scale, only classes and one cursor change while playing); `scale-history.js` evaluates a finished pass, stores it (IndexedDB `tuner-runs`, localStorage fallback, in-memory list `RUNS`), shows the result card and the Progress tab's "Scale scores" view. Runs are part of the backup file.
- Scale-drill graders are `scorer` engines (`js/core/engines/scorer-strict.js`, `scorer-practical.js`; Settings > Engines > "Scale drills: grading"). Auto = Practical (owner approved): human tolerance (full marks within 12 cents of the target zone, zero 32 cents beyond it), just/Pythagorean intonation allowed on bowed strings only, the player's overall offset forgiven 70% and reported, timing tolerance 12% of a beat, wrong notes cost the same as in Strict. Strict is the exam-style 6-cent view. An engine has `dev(cents, ctx)` (applied to every stored frame), `shift(devs, ctx)` (live offset forgiveness), `tol(T, ctx)`, `evaluate(slots, opts)`; the app calls them through `scaleDev/scaleShift/scaleTol/scoreRun` in `practice.js`. `node tests/scale-scorers.js` simulates human playing and checks both graders; `node tests/scale-f0.js` compares the pitch engines at the note level (all within 0.4 cents: the grader, not the pitch engine, limits scale drills). "Scale drills: pitch algorithm" picks the f0 engine used while a drill runs (`f0Engine()` in `js/app/engines/settings.js`).
- One run = one pass up and down. `endPass()` queues it; it is evaluated once the last note's hold has been scored (`finalizeHold`). A steady timing lag is reported but not punished (only unevenness is), so microphone or Bluetooth latency does not cost marks.
- The rubric constants (6 cents full marks, 3 points per wrong note, wobble allowance per instrument in `js/core/instruments.js`) are this app's model, not an official Trinity mark scheme. Tune them against real recordings once gold clips exist.

## Piece practice (a MusicXML piece in the Scale drills)

- The Scale drills screen has a **Scales | Pieces** switch. A piece is not a second player: it is another source for the same plan. `planNow()` (`practice.js`) returns `ppPlan()` while a piece is open, in the same shape as a scale plan (`tl`, `inst`, `pc`, `type: 'piece'`, `bpm`, `bow`, `pos`) plus `beats` (loop length), `timeSig`, `posList` (violin hand position per note), `sid` (history identity) and `key` (cache key for the drawings). Everything below the plan is shared: the four displays, Tempo and Wait modes, both graders, the result card, the run history, the scorecard.
- Pure code: `js/core/piece-practice.js` (instrument scan, `monoLine` top/bottom voice, `timelineFromPart`, `backingEvents`, `keyInfo`), `js/core/github-library.js` (link parsing, tree to file list, folder browsing, error wording). `parseMusicXml` also returns each part's instrument name and MIDI program, staves, measure start positions (`bars`), the key, note spelling (`name`) and length in quarters (`dq`). App code: `js/app/piece-practice.js` (source picker, GitHub box, part picker, plan, accompaniment); markup in `index.html` (`#ppPanel`, `#ppGh`), styles in `css/piece.css`.
- A timeline note has `beat` (quarter notes from the first bar line of the range) and `bar`. For a scale a beat and a note are the same number; for a piece they are not. `visBeatAt / visPosOf / visBeatOf` (`visual.js`) map between them, and `scale-visual.js` scrolls Tab and Piano roll by beat and moves the staff cursor by note. `visLayout` takes bar lines from `tl[i].bar` when present.
- `SCALE_DEFS.piece` exists but is **not enumerable** (so the Scale list, built with `for...in`, does not show it). Do not make it enumerable.
- Instrument: one `<score-part>` that is recognised (violin, guitar, ukulele, piano) loads at once with a locked "Detected instrument" badge and that instrument's scoring (vibrato allowance, hold time) and Staff + instrument display. Several parts show the part list and nothing is practised until one is chosen. An unrecognised instrument (cello, flute ...) is scored with the piano rule and the instrument select stays open.
- The drills hear one note at a time, so chords and inner voices are reduced to the top (or bottom) line. At most 400 notes per run: a longer part opens on the first bars that fit, and the player moves the range.
- Sources: a local file (picker or drop) or GitHub, read straight into memory (`api.github.com` tree, `raw.githubusercontent.com` file; both allow cross-origin reads). Nothing is saved: no IndexedDB, no localStorage, no cache. `sw.js` now sends every cross-origin request straight to the network (it used to cache them and answer a failed one with index.html). Only those two hosts are used, every path segment is checked and encoded, files over 25 MB and unzipped scores over 80 MB are refused. GitHub allows 60 unauthenticated API requests an hour per network.
- A history run of a piece carries `sid` (hash of title, part and bars), so a piece is only compared with itself (`histScaleKey`).
- In Wait mode a repeated note needs a pause before it counts again (`sc.needGap`); in Tempo mode a sound nearer in time to the note after next than to the one just played is that later note, not a retry (A B A).
- Not done: repeats and grace notes are not expanded, slurs and ties are not drawn, no beams. See `TODO.md`.

## Lab page (reference MIDI and comparison)

- `js/app/lab.js` + `css/lab.css` (the Lab tab) talk to the local helper `tools/lab/server.js` (zero-dependency Node, 127.0.0.1 only, runs programs with argument lists, never a shell). It fetches YouTube audio with yt-dlp (`python -m yt_dlp` from `tools/lab/.venv`; the `yt-dlp.exe` launcher is blocked by this PC's Application Control policy) and ffmpeg, and makes reference MIDI with the engines in `tools/lab/engines/`. Setup: `node tools/lab/setup.js`.
- `js/core/midi.js` (read/write .mid) and `js/core/compare.js` (matching, F1, why notes were missed, consensus) are pure and tested by `node tests/midi-compare.js`. The helper loads the same files through `tools/lab/core.js`.
- `detailedNotes()` in `recorder.js` is the one Detailed pipeline; the Recorder and the Lab both call it.
- Run `node tests/smoke-lab.js` after changing `lab.js`, `tools/lab/` or `compare.js`; `node tests/lab-engines.js` after changing an engine. A Lab score is agreement with another tool, not truth, and is not a ratchet baseline.
- Python native modules (scipy) can be blocked on this PC by Application Control, which is why the McLeod engine (pure JS) exists. Do not try to work around that policy.

## Other conventions

- `TODO.md` is the running list of pending work. When something is deferred ("later", "add to the to-do list"), a follow-up is spotted, or an item is finished, update it in the same change.

- When you change any cached file, bump `CACHE` in `sw.js` (currently `tuner-v44`) so installed copies update.
- Netlify is no longer used. GitHub Pages is the only host.
