### 0. Header & Delta
- **Version / Commit:** `tuner-v93 | c24463a | 2026-11-28`
- **Mode:** Deep Scan (baseline)
- **Changes Since Last Audit:** first audit. Recent work: sample sounds (`js/app/sampler.js`), grader rules (`js/core/evaluation.js:25-27`), time-based attempts (`js/core/scoring.js:42`), re-strike repeats (`js/core/segmenter.js:111`), short-note rule (`js/core/scoring.js:58`).

### 1. Pipeline Map
- **Scales:** `scales.js:55 buildTimeline -> profiles.js:93 loop -> segmenter.js:100 AttemptDetector -> practice-engine.js:105 onAttempt -> practice.js:149 finalizeHold -> evaluation.js:46 evaluateRun -> scale-history.js:35 runsAdd`
- **Pieces:** `piece-practice.js:110 timelineFromPart -> profiles.js:93 loop -> AttemptDetector -> piece-engine.js:160 peOnAttempt -> piece-engine.js:118 peFinalize -> evaluateRun -> piece-engine.js:245 peSaveRun`
- **Divergence:** same detector, grader, history record. Different: code is duplicated (`practice-engine.js` vs `piece-engine.js`; `scale-visual.js` 309 lines vs `piece-visual.js` 290); piece repeats use level rules (`piece-engine.js:224`), scales never do (`profiles.js:146`); scale runs in IndexedDB, piece runs in localStorage.

### 2. Mic, DSP & Hardware Tuning
| Layer | Current Implementation | Key Parameters |
|---|---|---|
| Mic & Filters | `audio.js:17` getUserMedia, `:22` high-pass, `:25` two low-pass | echo/noise/AGC off, mono; HP 70 Hz (20-lo*0.7 if lo<50, `profiles.js:118`); LP 6 kHz max, Q 0.5412/1.3066; analyser 4096 (`audio.js:23`) |
| Threading | `profiles.js:94` `requestAnimationFrame(loop)`; recording tap `audio.js:30` ScriptProcessor | YIN on main thread; no AudioWorklet; frame gate `scoring.js:55` fixedRate 12 ms (about 40-60 fps measured) |
| Pitch & Repeated-Note Onsets | `pitch.js:10` YIN; `segmenter.js:111` re-strike, `:118` bow dip | threshold 0.15, harmonic check d0>0.04 (`pitch.js:41`); rise >1.7x min of 0.12 s, >0.4 peak; dip <0.3 peak, back in 0.25 s; pieces only, only where next note repeats |
| Gates, Clarity & Latency | `profiles.js:102` gate, `:126` clarity, `:122` drillListen, `scoring.js:42` listenFor | gate hysteresis 0.6; clarity > user `conf` (0.85); window 1024-4096 from 15th-percentile gap; need 3-6 frames by time; latency: constant lag forgiven (`evaluation.js:30`), no measured round trip |
| Web MIDI / Drone / Backing | MIDI: none (`requestMIDIAccess` 0 hits). Drone `reference.js:56`; backing `piece-practice.js:231` piano samples `:236` | drone 0.07 gain; backing Tempo mode only |

### 3. Alignment, Scoring & History
- **Alignment:** fixed click grid (Tempo) or Wait; no elastic tempo. Skip when `el > start+dur+0.5 beat` (`practice-engine.js:85`, `piece-engine.js:139`). Look-ahead max 2 notes (`practice-engine.js:121`). Attack trim `min(3, frames/4)` (`practice.js:154`). Retries counted (`practice-engine.js:114`).
- **Formulas:** Pitch 50%: per-note curve, wrong note -3 (cap 30), fault >=30c -2 (cap 20) (`evaluation.js:22-25,56`). Fluency 30%: 0.6 pulse (half pulse, half evenness) + 0.4 continuity; **note duration scored only for bowed Tempo, as `shorts`** (`evaluation.js:62`). Tone 20%: wobble 0.5, entry 0.3, clarity vs own run 0.2 (`:72-80`); **vibrato not modelled**. Weights `:12`, bands 87/75/60 `:13`, pillar caps `:27`.
- **Strict vs Practical:** `scorer-strict.js` / `scorer-practical.js`: free 6c vs 12c (zone 7c), offset forgiven max 12c (`:12`), tone cap x1.25.
- **Persistence & Coach:** scale IndexedDB `tuner-runs` (`scale-history.js:15`), 400 runs (`history.js:4`); piece localStorage `tuner-piece-runs-v1` (`piece-engine.js:241`), 120 runs, per-note kept for newest 12 (`:244`). Coach `coach.js:35`, recurring notes by pitch (scale) or by place (piece) (`:22`).
- **Visual & MusicXML:** `.mxl` and multi-part work (`musicxml.js:95`, `summariseParts`); tempo marks parsed (`musicxml.js:48`) but timeline uses one BPM (`piece-practice.js:111`); bar range loop exists (From/To); repeats not expanded (`musicxml.js:3`); GitHub streaming removed (0 hits); visuals duplicated, not shared.

### 4. Performance & Hardcoded Limits
- **Main-thread risks:** YIN O(N*tau) every frame on 2048-4096 samples (`profiles.js:124`); deprecated ScriptProcessor (`audio.js:30`); piece audio decode of 3.8 MB banks on first use (`sampler.js:12`).
- **Magic numbers:** hold gate 65c `practice.js:146`; silent frames 8 `practice.js:86`; PP_MAX_NOTES=400 `piece-practice.js:11`; CARD_MAX=150 `practice.js:109`; HIST_MAX=400 `history.js:4`; TOO_SHORT_MS=120 `scoring.js:58`; MAX_SPAN=3 `instruments.js:42`; PE_KEEP_NOTES=12 `piece-engine.js:244`; fixedRate 0.012 `profiles.js:141`.

### 5. Ranked Gaps & Risks
| Severity | Type | Area | Exact Gap Today | File(s) |
|---|---|---|---|---|
| High | Missing | Validation | No real-microphone clips and no teacher marks; speaker test run on 3 of 14 pieces | `tests/mic-loopback.js`, `TODO.md` |
| Med | Bug | Pieces | Mozart K.155 84% found; Joplin 3 good notes called wrong, 18 missed | `piece-engine.js:160`, `pitch.js:41` |
| Med | Missing | Tone | No vibrato rate/depth; wobble only; Wait mode stores no clarity or coverage | `evaluation.js:72`, `practice-engine.js:151` |
| Med | Missing | Alignment | No elastic tempo, no tempo map, constant BPM, repeats not expanded | `piece-practice.js:111`, `musicxml.js:3` |
| Med | Debt | History | Strict and Practical runs mixed in one trend; piece runs not in Progress or backup | `history.js:32`, `piece-engine.js:241` |
| Low | Missing | Input | No Web MIDI; cello, bass, viola have no recordings; Recorder and Tuner still use plain tone | `audio.js`, `sampler.js:7` |
| Low | Debt | Code | Scale and piece engines and visuals duplicated; pieces stop at 400 notes | `practice-engine.js`, `piece-engine.js`, `piece-practice.js:11` |
| Low | Debt | Threading | YIN and ScriptProcessor on main thread | `profiles.js:94`, `audio.js:30` |

Caveats: no file was truncated; UI bodies, CSS, data and `node_modules` were not read (grep only). Stash `pre-update` (settings changes) is not applied.
