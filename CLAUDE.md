# Tuner & Scale Trainer (note-recorder)

Installable offline PWA: a single `index.html` (inline CSS/JS), `sw.js`, `manifest.webmanifest` and icons. It is deployed with GitHub Pages from `main` at https://parasgupta1508.github.io/note-recorder/ (the repo is public for this reason). Pushing to `main` redeploys it within about a minute.

## Automatic GitHub backup

Backup repo: https://github.com/parasgupta1508/note-recorder (public, branch `main`). The GitHub CLI is installed and signed in as `parasgupta1508`.

Whenever you change any file in this project, back it up to GitHub without being asked:

1. Run `git add -A`, then `git commit` with a short message describing the change, then `git push`, all from this folder.
2. Do this once at the end of each set of changes, not after every single edit.
3. End the commit message with the attribution line from the session's system reminder, if there is one.
4. Tell the user the backup is done, or say why it failed. If the push fails because the login expired, run `gh auth login --hostname github.com --git-protocol https --web` and ask the user to approve the code. Don't pipe that command's output.

## Never make detection worse (ratchet)

`tests/bench.js` runs the real detector (loaded from `index.html`) on synthetic violin cases (legato, détaché, staccato, fast runs, noise, violin over piano) and compares with `tests/baseline.json`.

1. Before committing any change to `yin`, `Segmenter`, `recPitchCore`, `analyseSamples` or `REC_MODES`, run `node tests/bench.js`.
2. If it prints REGRESSION, the change made something worse. Fix it or drop it. Do not commit it.
3. If it improved, run `node tests/bench.js --update`. The baseline only ever goes up.
4. When you add a new detection feature, add a benchmark case for it first.

## String-instrument accuracy (violin, guitar, ukulele)

Known-truth synthetic phrases (`tests/synth.js`: bowed, plucked, nylon; with vibrato, scoops, detune, reverb, hum, chatter, clipping, ringing, beating):

- `node tests/strings.js` is the Live path. Ratchet like `bench.js` (`--update` only when nothing got worse). It reads each instrument's pitch range from `INST_PROFILES`.
- `node tests/detailed-strings.js` is the Detailed path with the real Basic Pitch model in Node (needs `tools/node_modules`, takes about 5 min). It scores notes and cents error. `KIND=repeat`, `ONLY=ukulele` and `DBG="guitar mid clean"` narrow or print a run.
- `node tests/pitch-sweep.js` checks raw YIN accuracy per semitone and sample rate.
- Run the Live one after any change to `yin`, `Segmenter`, `recPitchCore`, `AutoMode` or the Recorder loop, and the Detailed one after any change to `bpToEvents`, `markAttacks`, `refineEvents`, `extractMelody` or `BP_PARAMS`.
- Basic Pitch pitch bends in this build are centred on 1 (1.0 = exactly on the note), not 0. `bpToEvents` subtracts 1. `refineEvents` then re-measures every note's pitch with YIN, because the model's bends only have 1/3-semitone steps.

## Detailed analysis (Basic Pitch) and tests

- `vendor/` holds the offline Detailed-analysis files (Basic Pitch model + TensorFlow.js, Apache-2.0). Rebuild with `cd tools && npm install && npm run build`. They are loaded only when Detailed mode is used, and cached by the service worker in its own `tuner-vendor-v1` cache.
- `node tests/smoke-detailed.js` runs a synthetic recording through the Detailed path in headless Edge (about 30 s). Run it after changing `analyseDetailed`, `extractMelody` or `vendor/`.
- `node tests/shot.js <folder>` renders the Recorder (Falling, Sheet, full screen; phone and tablet sizes) with sample notes and saves screenshots. Look at them after any display change.
- Audio test clips (`tests/audio/`, `*.mp3`) are copyrighted and git-ignored. Never commit them.
- Design background and roadmap: `docs/intelligence-plan.md`.

## Other conventions

- When you change `index.html` or any other cached file, bump `CACHE` in `sw.js` (currently `tuner-v35`) so installed copies update.
- Netlify is no longer used and its folder was deleted. GitHub Pages is the only host.
- Before committing, run `node tests/smoke.js` (loads the page in headless Edge, checks for script errors and clicks through the Recorder). A script error at load silently kills every button.
