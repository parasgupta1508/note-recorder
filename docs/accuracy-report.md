# Phase A decision memo (draft for owner approval)

Status: **draft, nothing approved.** `auto` still resolves to `yin`, `classic`, `basicpitch` (`AUTO_ENGINES` in `js/core/engines/registry.js`). This memo reports what was built and measured so far and what could not be measured. Date of measurements: 2026-11-26.

## 1. Bottom line

1. **Real-microphone accuracy is not measured.** There are no gold clips yet, so every gate number below is untested. The only real violin clip (`violin1.f32`) is a sustained tuner clip with no truth.
2. The measuring tool now exists (`tests/gold.js`). It scores any engine on any clip that has a truth file, and it ran end to end on synthetic fixtures with two f0 engines plus the classic segmenter.
3. SwiftF0 is plugged in as a candidate f0 engine and passes the engine contract. It is switched off in the app. On synthetic audio it is about level with YIN, not better, and it is about five times slower. That says nothing yet about real microphones.
4. **Recommendation: do not change `auto` yet.** Record the gold clips first, then rerun `tests/gold.js` on YIN and SwiftF0 and decide from those numbers. Section 6 lists what I need from you.

## 2. What was built

| Item | File | State |
|---|---|---|
| Gold harness | `tests/gold.js` (format in its header) | Works. Self-test of its metrics: `node tests/gold.js --selftest`. Not a ratchet; nothing is compared with `tests/baselines/`. |
| SwiftF0 candidate engine | `js/core/engines/f0-swiftf0.js` | Registered, `caps.offline` and `caps.live` false, so Settings does not list it and `getEngine` never picks it. |
| Node runner for it | `tests/lib/swiftf0-node.js` | Uses onnxruntime-web (wasm), the runtime a browser would use. Looks for `ORT_WEB` and `SWIFTF0_MODEL`, else `tools/node_modules/onnxruntime-web` and `vendor/swiftf0/model.onnx`. Nothing is vendored in the repo. |
| Async contract check | `engineContractAsync` in `js/core/engines/contract.js`, used by `tests/engine-contract.js` | SwiftF0 passes all 9 checks when the runtime is found. Without it the test prints a SKIP. |
| Agreement view | `node tests/gold.js --agree violin1.f32` | Runs every f0 engine over a clip with no truth and prints how often they agree. **Agreement is not accuracy.** |

## 3. SwiftF0 facts (measured here, 0.3.0 wheel and onnxruntime-web 1.31.1)

| Question | Answer |
|---|---|
| Licence | MIT (LICENSE in the wheel). |
| Model | `model.onnx`, 135,090 bytes (94 KB gzipped). 14,386 parameters. |
| Runtime | onnxruntime-web: `ort-wasm-simd-threaded.wasm` 14,848,852 bytes plus `ort.min.js` 371,810 plus a 24,738-byte loader. About **15.4 MB** in the offline cache, about 4.0 MB over the network when gzipped. The model is tiny; the runtime is the cost. |
| Sample rate | 16 kHz in. The engine requires 16 kHz audio and the harness resamples with the app's own `resample`. |
| Range | 46.875 Hz to 2093.75 Hz (about F#1 to C7). Violin notes above C7 (E7 is 2637 Hz) are out of range. Intermediate repertoire rarely goes there, but the gold clips should include the highest notes the students play. |
| Frames | One per 256 samples (16 ms). Voiced when confidence is 0.5 or more. A hop with a peak below 0.001 is forced unvoiced. The model does not normalise level; the upstream docs say to scale up recordings quieter than about -35 dBFS. The engine has a "scale quiet recordings up first" switch, default off. |
| Speed in Node (wasm, one thread) | About 9 to 12 s of compute per minute of audio. YIN is about 2 s per minute. Fine for offline analysis, too slow to be sure about live listening. |
| Call shape | `audio` [1,N], `fmin`, `fmax` in; `pitch`, `confidence` out. Python reference windows long audio in 1875-frame blocks with 11 frames of context before and 10 after; the engine does the same. |

Published numbers (pitch F1 at 50 cents: pYIN 0.506, SwiftF0 0.781, CREPE 0.689, PESTO 0.680) are from the SwiftF0 paper and were **not reproduced** here.

## 4. Measured so far

### 4.1 Synthetic fixtures (regression only, never the quality number)

Six clips: two phrases (scale and leaps; high register) times three conditions (clean, high-pass plus reverb, noisy). Truth is the nominal pitch plus the injected detune, so the vibrato in the synthetic violin is not part of truth. Command: `node tests/gold.js --synthetic` (with `ORT_WEB` and `SWIFTF0_MODEL` set for SwiftF0).

| Mean over the 6 clips | YIN | SwiftF0 |
|---|---|---|
| Frames within 20 cents (rpa20) | 99.7% | 99.4% |
| Frames within 10 cents (rpa10) | 96.4% | 97.3% |
| Octave errors | 0.0% | 0.5% (0.9%, 1.7% and 0.4% on the three wide-range scale-and-leaps clips, 0% on the high-register clips) |
| Note F1, 50 ms, no score | 0.91 | 0.88 |
| Note F1 after the best constant time shift | 0.985 | 0.985 |
| False alarms on silent frames, reverb clips | 24% and 12% | 45% and 49% |
| Compute per minute of audio | 2 s | 10 s |

What this says: on clean, noisy and reverberant synthetic violin the two are close. SwiftF0 makes a few octave errors on the wide-range phrase (above the 0.5% gate target on two of three clips) and reports pitch in the reverb tail more often than YIN does (that tail is real sound, but it is not a played note). The F1 differences between the two engines come mostly from timing: against truth, YIN's note starts are about 10 to 40 ms late and SwiftF0's about 10 to 50 ms early (the `shift` column), and a constant offset is recovered by the time shift, which is why F1 after the shift is equal at 0.985. Whether SwiftF0's early timestamps are a frame-labelling convention or a real effect is not settled. None of this predicts real-microphone behaviour.

### 4.2 Real clips with no truth (agreement only)

`node tests/gold.js --agree <file>`:

| Clip | YIN voiced | SwiftF0 voiced | Within 20 cents where both voiced | Octave apart |
|---|---|---|---|---|
| `violin1.f32` (63 s, sustained tuner clip) | 89.3% | 91.7% | 99.6% | 0.1% |
| `taegukgi.f32` (111 s, a recorded song, not solo) | 37.9% | 71.0% | 66.7% | 17.5% |

On the clean solo clip the two agree almost exactly. On the song, they disagree a lot, and with no truth I cannot say who is right. That clip is the kind of input (accompaniment, mixed sound) where an f0 tracker choice matters, and it is the reason the gold set needs accompaniment clips and a clean close-mic reference take.

### 4.3 Regression

Unchanged and passing: `structure`, `engine-contract`, `library`, `piece-import`, `midi-compare`, `bench`, `strings`, `pitch-sweep`, `resample`, `smoke`, `smoke-nav`, `smoke-lab`. `detailed-strings.js` (5 minutes) was not rerun and nothing it covers was touched.

## 5. Not measured, and why

- Real-microphone accuracy of any engine (no gold clips).
- The hypotheses H1 to H7 in the plan (4096-sample window, the 70 Hz high-pass and 6 kHz low-pass in `audio.js`, built-in versus clip-on mic). They need the same clips recorded in different conditions.
- VioPTT (Apache-2.0 code, weights licence not stated, PyTorch, offline only) and Demucs (`htdemucs_6s` has no violin stem): not run. They stay "only if proven". Neither belongs in the critical path while Python native modules may be blocked on this PC.
- Basic Pitch on gold clips: `node tests/gold.js --bp` is wired but was not run on any clip (none exist).
- The "with a known score" F1 (`f1k`) is a stand-in: it snaps found notes to the nearest score note within one semitone and 150 ms. The real evaluator (Phase 1 and 2) does not exist, so this number measures detection and timing only.

## 6. What I need from you

1. **Approve recording the gold clips.** Minimum useful set: 12 to 20 violin clips of 15 to 40 s, solo and with accompaniment, legato and détaché, a fast passage, the highest notes the students play, on the phones or tablet they actually use, plus a clean close-mic take of the same passage where you can. For truth, the score with hand-corrected played notes is enough to start (`<name>.truth.json`, format in the header of `tests/gold.js`). No names in files; keep clips in `tests/audio/gold/` (git-ignored).
2. **Confirm or change the gate targets** (to be set against the measured baseline): at least 95% of voiced frames within 20 cents, octave and harmonic errors at most 0.5%, note F1 at least 0.95 with a known score and at least 0.85 without.
3. **Decide whether SwiftF0 may be vendored** (about 15.4 MB, of which 14.8 MB is the runtime) so the app could run it. I have not added it to the repo. I recommend waiting until the gold clips show it beats YIN by a margin that matters for the gates, because it is five times slower, 15 MB heavier, and silent on notes above C7.
4. Decide whether `auto` may ever change. My recommendation stays: **no change to `auto` until the gold numbers exist.** If SwiftF0 wins, the likely shape is YIN for live listening (low latency) and SwiftF0 as an offline second opinion, chosen in Settings > Engines.

## 7. Files touched

New: `tests/gold.js`, `tests/lib/swiftf0-node.js`, `js/core/engines/f0-swiftf0.js`, this memo. Changed: `js/core/engines/contract.js` (async check, shared f0 assertions), `tests/engine-contract.js`, `index.html` (one script line), `sw.js` (file list, cache `tuner-v45`).
