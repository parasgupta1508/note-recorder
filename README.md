# Tuner & Scale Trainer

An offline-capable web app (installable on phone, tablet and laptop) with a chromatic tuner, scale practice with scoring, progress analysis, and a note recorder that turns playing into sheet or falling-note views. Built for violin, guitar and ukulele. Live at https://parasgupta1508.github.io/note-recorder/

There is no build step. Open `index.html` through any web server, or push to `main` and GitHub Pages serves it.

## Folder map

```
index.html            page markup only; lists every script in load order
css/app.css           all styling (css/lab.css: the Lab page)
js/core/              pure logic, no screen code (also runs in Node for tests)
  pitch.js              YIN pitch detector with harmonic check   <- every module uses this
  music.js              note names and maths, tunings, scales, tuner target picking
  segmenter.js          pitch readings -> notes; vibrato; practice attempt detector
  listening.js          listening modes, Auto mode, per-frame gate, offline analysis
  detailed.js           Basic Pitch helpers: resample, notes, attacks, pitch refine, melody
  midi.js               read and write .mid files
  compare.js            match two note lists: precision, recall, F1, timing, why notes were missed
js/app/               the screens (scripts share one scope, loaded in the order index.html lists)
  base.js tuner.js practice.js analysis.js metronome.js selftest.js settings-ui.js
  practice-engine.js recorder.js chart.js audio.js profiles.js lab.js main.js install.js
icons/                app icons
vendor/               Basic Pitch model + TensorFlow.js for Detailed analysis (built from tools/)
tools/                builds vendor/; tools/lab/ is the Lab helper (YouTube -> mp3 -> MIDI)
sw.js                 service worker (offline cache); manifest.webmanifest
tests/                benchmarks, browser tests, shared helpers (tests/lib), saved scores (tests/baselines)
docs/                 design notes and roadmap
CLAUDE.md             working rules for the AI assistant (tests, backup, conventions)
```

## Where does the microphone and file audio go?

Microphone (`js/app/audio.js`) and recordings both reach the same detector, `yin()` in `js/core/pitch.js`:

- Tuner and Practice call it on each microphone frame.
- The Recorder's Live mode feeds it through `Segmenter` (`recPitchCore` decides which frames count).
- The Recorder's Detailed mode runs Basic Pitch after Stop, then `markAttacks`, `refineEvents` (which calls `yin` again on the original sound) and `extractMelody`.
- Offline analysis of a whole recording uses `analyseSamples` in `js/core/listening.js`.

## Add a feature

- **A new instrument:** add a line to `INST_PROFILES` in `js/app/profiles.js` (pitch range) and its tunings to `PRESETS` in `js/core/music.js`. Add it to `PROF` in `tests/strings.js` to benchmark it.
- **A change to how notes are detected:** edit the file in `js/core/`, run the matching benchmark from `CLAUDE.md`, and keep it only if nothing got worse.
- **A new screen:** add its markup to `index.html`, put its code in a new `js/app/<name>.js`, list the file in `index.html` (before `main.js`) and in `FILES` in `sw.js`, then run `node tests/structure.js` and `node tests/smoke.js`.
- **New logic that does not touch the screen:** put it in `js/core/` so it can be tested in Node without a browser.

## Lab (YouTube or audio file -> reference MIDI -> compare with the app)

The Lab tab checks the app's note detection against other open-source tools. The downloading and the other tools run in a small helper on your computer (the page itself stays an offline PWA).

```
node tools/lab/setup.js      once: checks ffmpeg, installs Basic Pitch for Node, makes tools/lab/.venv (yt-dlp, librosa)
node tools/lab/server.js     every time: starts the helper on http://localhost:8787, leave it open
```

Then open the Lab tab, press Connect, paste a YouTube link (or pick an audio file), press **Get audio**, then **Make MIDI**, then **Run app and compare**. Clips and MIDI are saved in `tools/lab/data` (git-ignored), so you pick them from "Saved clips" next time. **Find best Live settings** tries 15 listening/confidence combinations and **What it has learned** keeps the averages over all your clips; "Use" applies a setting to the Recorder.

Tools used: Basic Pitch (Spotify, Apache-2.0, many notes at once), McLeod pitch method via `pitchy` (MIT, one melody line), pYIN via librosa (ISC, one melody line, needs the Python environment), CREPE via torchcrepe (MIT, optional: `node tools/lab/setup.js --crepe`), yt-dlp (Unlicense) and ffmpeg for the audio. A score is agreement with a reference, not the truth. Only use audio you have the right to use.

To add an engine: write `tools/lab/engines/<name>.js` (or a Python script) that reads a 22,050 Hz mono WAV and writes `{notes:[{midi,start,dur,vel}]}`, then add it to `ENGINES` in `tools/lab/server.js` and `LAB_NAMES` in `js/app/lab.js`.

## Tests

`node tests/midi-compare.js` (MIDI reader/writer and note matching), `node tests/lab-engines.js` (each Lab engine against known notes), `node tests/smoke-lab.js` (the whole Lab flow in headless Edge, with its own helper).

`node tests/structure.js`, `node tests/smoke.js`, `node tests/bench.js`, `node tests/strings.js` run in seconds. `node tests/detailed-strings.js` takes about 5 minutes. See `CLAUDE.md` for what each one checks.

## Licenses of what it builds on

- Basic Pitch (Spotify, Apache-2.0) and TensorFlow.js (Apache-2.0) are bundled in `vendor/`.
- The Lab helper (not part of the offline app) uses pitchy (MIT), librosa (ISC), torchcrepe (MIT, optional), yt-dlp (Unlicense) and ffmpeg.
- The pitch detector follows the YIN paper (de Cheveigné and Kawahara, 2002) and the idea of confirming the fundamental in the spectrum from fgnass/tuner (MIT). aubio (GPL-3.0) was studied but no code was copied.
