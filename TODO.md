# To do (later)

- [ ] **Engines screen: rename "Test" to "Self-check" and add a short explanation.** The button (in `js/app/engines/ui.js`, `data-test`) runs `engineContract()`: a quick software check on made-up sound (A4 then C5, plus silence). It checks silence gives no notes, output format, same result twice, pitches inside the range, A4/C5 within 20 cents, and speed. It does not use the microphone and does not say which algorithm is better. Suggested line under the buttons: "Self-check: a quick test on a made-up sound to confirm the algorithm works. It does not use your microphone." The passed/failed messages (also in `ui.js`) should use the same word.
- [ ] Tuner: make the in-tune beep re-arm when the target note changes (today it only re-arms after about 1 s of silence).
- [ ] Optional: time-to-settle measurement in `tests/mic-loopback.js` for comparing against other tuner apps.
- [ ] Try MPM on real noisy-room recordings before suggesting it as a default.
- [ ] Engines screen: consider the label "Tuner & live pitch algorithm", because that choice also drives Practice and the Recorder's pitch.
- [ ] SwiftF0 (neural pitch): code exists but is switched off. Needs an ONNX runtime and the model file vendored under `vendor/`, then enabling `caps.live`/`caps.offline`.
- [ ] CREPE: not built (needs a model download). Only worth it if noisy rooms stay a problem.
- [ ] Compare the Tuner against SoundCorset (Android) on the same notes: settle time and steadiness.
