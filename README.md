# Tuner & Scale Trainer

An offline-capable web app (installable on phone, tablet and laptop) with a chromatic tuner, scale practice with scoring, progress analysis, and a note recorder that turns playing into sheet or falling-note views. Built for violin, guitar and ukulele. Live at https://parasgupta1508.github.io/note-recorder/

There is no build step. Open `index.html` through any web server, or push to `main` and GitHub Pages serves it.

## Folder map

```
index.html            page markup only; lists every script in load order
css/app.css           all styling
js/core/              pure logic, no screen code (also runs in Node for tests)
  pitch.js              YIN pitch detector with harmonic check   <- every module uses this
  music.js              note names and maths, tunings, scales, tuner target picking
  segmenter.js          pitch readings -> notes; vibrato; practice attempt detector
  listening.js          listening modes, Auto mode, per-frame gate, offline analysis
  detailed.js           Basic Pitch helpers: resample, notes, attacks, pitch refine, melody
js/app/               the screens (scripts share one scope, loaded in the order index.html lists)
  base.js tuner.js practice.js analysis.js metronome.js selftest.js settings-ui.js
  practice-engine.js recorder.js chart.js audio.js profiles.js main.js install.js
icons/                app icons
vendor/               Basic Pitch model + TensorFlow.js for Detailed analysis (built from tools/)
tools/                builds vendor/
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

## Tests

`node tests/structure.js`, `node tests/smoke.js`, `node tests/bench.js`, `node tests/strings.js` run in seconds. `node tests/detailed-strings.js` takes about 5 minutes. See `CLAUDE.md` for what each one checks.

## Licenses of what it builds on

- Basic Pitch (Spotify, Apache-2.0) and TensorFlow.js (Apache-2.0) are bundled in `vendor/`.
- The pitch detector follows the YIN paper (de Cheveigné and Kawahara, 2002) and the idea of confirming the fundamental in the spectrum from fgnass/tuner (MIT). aubio (GPL-3.0) was studied but no code was copied.
