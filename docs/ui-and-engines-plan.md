# UI/UX correction and pluggable engines (work plan for Claude Code)

Read `CLAUDE.md`, then `docs/practice-companion-plan.md` (the product plan, v5). This document is the **first thing to build**: fix the app's structure and screens, and put every detection algorithm behind a registry that Settings can switch, so new algorithms from Phase A can be plugged in one at a time without touching screens. Do the work packages in order (UI0 to UI6). Each ends with a gate. Behaviour of existing detection must not change until an engine is deliberately switched (the ratchet stays green).

## 1. Audit of the current app (as deployed, checked on a 375 px phone and a desktop window)

What works and must be kept: dark theme, bottom tab bar on phones, drill-in Settings list, tuner needle, scale practice card, offline install, the benchmark ratchet.

Problems found, with where they live:

| # | Problem | Evidence | Why it matters |
|---|---|---|---|
| 1 | The mic is started by a global "Start listening" button in the header, separate from each screen's own Record or Start | `#start` in the header; the Recorder's Record button is disabled with the message "Start listening, the..." until the global button is pressed | Two-step start on every screen; kids press the wrong one |
| 2 | Tabs are organised by tool, not by what a student wants to do: Tuner, Practice (really scales), Analysis, Recorder, Lab, Settings | `index.html` tab list | Pieces and "Add a piece" have no place; "Practice" will clash with piece practice; Lab (a developer tool) sits beside student screens |
| 3 | Player names are hard-coded in the page and in code | `index.html` (the `#profile` options) and `js/app/practice.js` contain the two children's names, and the repository is **public** | Children's names are published on the web, and they stay in git history |
| 4 | Recorder screen is dense and technical | Live/Detailed switch, Listening preset, Replay mode, colour mode, BPM, display size, all visible at once; jargon such as "Detailed (Basic Pitch + refine)" | Students cannot tell what to press; settings that belong in Settings are on the working screen |
| 5 | Algorithm choice is scattered | Live vs Detailed in the Recorder, `#detSeg` presets and `#conf`/`#mindur` in Settings, `ENGINES` only inside `tools/lab/server.js`, Lab "Use" buttons | No single place to choose or compare algorithms; no way to add one cleanly |
| 6 | Instrument list is wider than the scope | Tuner chips include Chromatic, Bass, Viola, Cello, Mandolin besides Guitar, Violin, Ukulele | Scope is violin, guitar, ukulele, piano; piano is missing |
| 7 | Tuner chips overflow on a phone (the row is cut off after Violin) and the tuner card has a large empty area below the meter | phone screenshot | Wasted space, hidden options |
| 8 | Accessibility gaps | Tabs carry only a CSS class "on", no `aria-selected` or roles; `data-g="data"` is reused for four different Settings groups | Screen readers and keyboard users; fragile code |
| 9 | Title mismatch | page title "Tuner & Scale Trainer", home-screen name "Tuner" | Will be wrong once it is a practice companion |
| 10 | No home that answers "what should I practise now?" | App opens on the Tuner | The product loop starts from a piece, not a tuner |

## 2. Target information architecture

Five bottom tabs on phones (side rail on desktop and tablet), in this order:

1. **Practice** (home): continue the last piece and bar range, today's tempo-ladder step, quick start buttons (Tuner, Scale drill), practice time this week. Replaces the current "open on Tuner".
2. **Pieces**: library, **+ Add a piece** (the single input screen from the product plan, section 7), Piece view and Feedback.
3. **Tuner**: unchanged behaviour, trimmed instrument list.
4. **Progress**: merges today's Analysis tab (scale progress, compare players) with piece trends, tempo ladder and bias profile.
5. **Settings**: as today, plus the **Engines** group (section 4) and a **Developer** group that holds the Lab and diagnostics (shown only when a "Developer tools" switch is on).

Scale practice becomes **Scale drills**, reached from Practice. The Recorder becomes **Free record** under Practice (quick "what did I just play" view), and its recording-on-demo role moves into Add a piece. Nothing is deleted; features move.

Header: remove the global Start button. Show a compact **mic chip** (state dot, level bar, tap to open mic check and device choice) and a **player chip** (initial plus name; tap to switch). Every screen's primary button starts the microphone itself and stops it when the screen leaves or the app is backgrounded. One shared mic manager owns the stream, gate and calibration (`js/app/audio.js`), so screens never fight over it.

Desktop and tablet: two panes (sheet or chart on the left, controls on the right); phone: single column with a sticky bottom action bar for Record, Stop and Loop.

## 3. Screen-by-screen changes

- **Practice (new home).** Cards: "Continue: <piece>, bars 12-16, at 72 BPM" (one tap to the Piece view), "Today": ladder step and clean-rep goal, "Quick": Tuner, Scale drill, Free record. Empty state for a new player: "Add your first piece".
- **Tuner.** Instrument chips: Violin, Guitar, Ukulele, Piano (chromatic is a toggle, not a chip). Chips wrap instead of overflowing. Move the meter up and show the last note names and cents history in the empty area.
- **Scale drills.** Keep the engine; rename the tab content; collapse the options block by default as now; add a "Strict / Normal" tolerance switch bound to the player's setting; write `Take`-shaped records so progress is unified (product plan, section 8).
- **Free record.** Reduce the visible controls to Record, Stop, Replay, view (Sheet or Falling) and a "More" disclosure holding Listening, Replay mode, colour, BPM and size. Replace "Live / Detailed" with a single **Analysis** chooser that reads from the engine registry (section 4) and shows plain labels ("Instant", "Careful (slower)").
- **Pieces, Add a piece, Piece view, Feedback.** As specified in the product plan, sections 7 and 9.
- **Progress.** One screen with a segmented control: Pieces, Scales, Compare players. Reuse `chart.js`.
- **Settings.** Keep the list-and-drill pattern. Groups: Players, Instrument, Tuning, Microphone, **Engines** (new), Checks, Data and backup, Appearance, Install, Developer (Lab, diagnostics, reset). Give every group a unique `data-g`. Players is where names are entered.
- **Names out of the repository.** Players are created in the app and stored locally. Remove the hard-coded names from `index.html` and `practice.js`, add a first-run "Who is practising?" step. Existing saved data keyed by the old names must be migrated by name on first load, not lost. Tell the owner the names remain in git history and offer (do not do) a history rewrite.
- **Accessibility.** Tabs get `role="tablist"`, `role="tab"`, `aria-selected`; the mic chip and player chip are buttons with labels; touch targets at least 44 px; visible focus; colour is never the only signal (shape and text too).
- **Naming.** Title and home-screen name become "Practice Companion" (manifest `name` and `short_name`, `index.html` title and apple title); bump the service worker cache.

## 4. Pluggable engines

**Goal.** Any algorithm can be added by writing one file and registering it. Screens, tests and Settings only talk to the registry.

### 4.1 Roles (the kinds of engine)

| Role id | Input to output | Runs | Existing implementations to wrap |
|---|---|---|---|
| `f0` | audio frames to `[{t, hz, conf}]` | live and offline | `yin` (js/core/pitch.js), McLeod (tools/lab/engines/mpm.js), pYIN and CREPE (Lab Python) |
| `segmenter` | f0 frames to notes `{midi, start, dur, cents, lvl, pts, vib, ...}` | live and offline | `Segmenter` and `analyseSamples` (listening.js) |
| `transcriber` | audio to notes (mono or polyphonic) | offline | Basic Pitch plus `refineEvents` (detailed.js), Lab engines |
| `separator` | audio to stems | offline, helper only | Demucs `separate.py` |
| `aligner` | reference plus events to alignment | offline | new (product plan, section 6) |
| `scorer` | alignment to note results and bar scores | offline | new |
| `verifier` | reference plus audio to "expected notes present?" for chords and piano | offline | new (product plan, decision 14) |

Frame and note shapes are fixed in `js/core/schema.js` (the shared note shape already in `docs/intelligence-plan.md`). An engine may add fields; consumers must not require them.

### 4.2 Engine descriptor

```js
// js/core/engines/<role>-<name>.js  (pure) or js/app/engines/<name>.js (needs browser APIs)
registerEngine({
  id: 'swiftf0', role: 'f0', label: 'SwiftF0 (neural)', version: '1',
  caps: { live: false, offline: true, polyphonic: false, instruments: ['violin','guitar','ukulele'],
          needsHelper: false, needsDownloadMB: 0.0 /* fill in measured size */, license: 'MIT', sampleRate: 16000, hop: 0.016 },
  params: { minConf: { type: 'range', min: 0.3, max: 0.9, step: 0.05, default: 0.5, label: 'Confidence' } },
  async init(env)       { /* lazy-load model; resolve when ready */ },
  async run(input, opts){ /* returns the role's output shape */ },
  dispose()             { /* free memory */ },
});
```

Rules:
- A registry (`js/core/engines/registry.js`, pure) offers `register`, `list(role)`, `get(role, instrument, mode)` and `resolve(settings)`. It never imports an implementation by name.
- Heavy engines load lazily from `vendor/<name>/`, are listed in the service worker's vendor cache, run in a Web Worker host (`js/app/engine-host.js`), and report `needsDownloadMB` honestly so Settings can show it. Engines that need the local helper declare `needsHelper: true`; the helper exposes `GET /engines` listing its engines with the same descriptor fields, and the page merges them into the registry when the helper is connected.
- Every engine has a **contract test** run by `tests/engine-contract.js` over the whole registry: output shape, silence gives no notes, determinism, stays inside its declared range and sample rate, time budget per minute of audio. Adding an engine without passing the contract test is not allowed.
- The Phase A harness (`tests/gold.js`) iterates the registry, so a new engine is measured on the gold set automatically.
- No screen, no other core module and no test imports `yin`, `Segmenter` or Basic Pitch directly after UI1; they ask the registry. (The wrappers themselves may.)
- Every saved Take stores the engine ids, versions and parameter values used (`engines` snapshot), so results can be re-scored or compared later.

### 4.3 Settings: the Engines group

Stored under one key (`settings.engines`), per instrument profile, with a global default:

```
engines: {
  default: { f0: 'auto', segmenter: 'auto', transcriber: 'auto', separator: 'none' },
  perInstrument: { violin: { f0: 'yin' }, ... },
  params: { 'swiftf0': { minConf: 0.5 }, ... }
}
```

`auto` means "the engine the Phase A decision memo recommended for this role and instrument"; until that memo exists, `auto` resolves to today's behaviour (`yin`, `Segmenter`, Basic Pitch), so nothing changes silently.

The screen is generated from the registry, not hand-written:
- One row per role: a dropdown of available engines for the current instrument, each with its caps shown as small chips (Live, Offline, Needs helper, 2.4 MB, MIT). Unavailable ones (helper not connected, not downloaded) are greyed with the reason.
- Beneath each dropdown, the parameters from the engine's `params` schema as sliders and switches, with a "Reset to default" link.
- A **Test this engine** button: runs the selected engine on a bundled test tone and on the last saved clip and shows notes found, time taken and a pass or fail from the contract check.
- A **Compare** link that opens the Lab's A/B view with the chosen engines preselected.
- Live and offline choices are separate for `f0` and `segmenter` (live needs real-time speed; offline can be slower and better).
- The existing Settings controls (Detection presets, confidence, minimum duration, pitch range) become the parameters of the classic engines, so nothing is lost.

## 5. Work packages (in order)

Each package: small commits, run `node tests/structure.js`, `node tests/smoke.js` and the ratchet suite from `CLAUDE.md`, bump `CACHE`, list new files in `index.html` and `sw.js`, push.

**UI0. Safety net (S).** Add `tests/smoke-nav.js`: headless Edge at 375 px and 1280 px, visits every tab, asserts no script errors, no horizontal overflow, tab roles present. Capture "before" screenshots with `tests/shot.js`-style script into a git-ignored folder. Gate: runs green on the current app.

**UI1. Engine registry, no behaviour change (M).** Create `registry.js` and `schema.js`; wrap `yin`, `Segmenter`/`analyseSamples`, Basic Pitch plus refine, and the Lab engines as registered engines; route the Tuner, Practice, Recorder and Lab through `resolve()`; write `tests/engine-contract.js`. Gate: `bench.js`, `strings.js`, `pitch-sweep.js`, `resample.js` and the smoke tests are byte-for-byte unchanged in their results; `detailed-strings.js` unchanged.

**UI2. Shell and navigation (M).** New tab set and names, mic chip, player chip, per-screen start, shared mic manager, desktop side rail, accessible tabs, new title and manifest name, unique `data-g`. Move Lab and diagnostics under Settings > Developer. Gate: `smoke-nav.js` green; the old flows (tuner, scale practice, recorder, Lab) still work; no global Start button remains; keyboard-only navigation reaches every tab.

**UI3. Players and privacy (S).** Player creation and first-run step; migrate saved data from the two old keys by name; remove the hard-coded names from `index.html` and `practice.js`; add the backup export for players. Gate: existing scores and progress still show for each child after the update; a search of the repository's current files finds no child names.

**UI4. Settings > Engines (M).** Generate the Engines group from the registry as in 4.3, with Test and Compare. Move today's Detection controls into the classic engines' parameters. Gate: switching the `f0` or `segmenter` choice in Settings changes what the Tuner and Recorder use (verified by a smoke test that selects a stub test engine); an engine that fails its contract test cannot be selected.

**UI5. Screen declutter (M).** Practice home, Tuner chips and layout, Free record simplification with "More", Scale drills naming, Progress merge. Gate: screenshot review on phone, tablet and desktop; one-hand reachability of the primary action on a phone; no screen needs more than two taps to start.

**UI6. Add a piece shell (M).** The single input screen with the four tiles, instrument chips, drop zone, mic check and stepper (product plan, section 7), wired to the engines it can already run (score file, audio file, Record). YouTube and Separating show "needs the helper" until the helper engines are plugged in. Gate: a MusicXML fixture and a MIDI fixture import end to end into the library (this depends on Phase 1 of the product plan, so build the shell and a stubbed importer first and connect it when Phase 1 lands).

**Then plug in as we go.** When Phase A produces a candidate (for example SwiftF0), adding it is: one engine file, its vendor files, one registry call, contract test passes, appears in Settings. Nothing else changes.

## 6. Prompts to give Claude Code

1. "Read CLAUDE.md, docs/practice-companion-plan.md and docs/ui-and-engines-plan.md. Implement UI0 only, then stop and report."
2. After UI0 passes: "Implement UI1 only. Do not change any detection behaviour. Show me the unchanged benchmark output."
3. Then UI2, UI3, UI4, UI5, UI6 one at a time, each with: "Implement UIn only, run the listed gate, stop and report with screenshots."

## 7. Risks and decisions for the owner

- The two names are already in public git history. Removing them from the current files stops further exposure; fully removing them needs a history rewrite and a force push, which is the owner's call.
- Moving the Lab under Settings changes how it is opened; the Lab itself is untouched.
- The `auto` engine setting must keep resolving to today's behaviour until the Phase A memo is approved, so a UI release can never silently change accuracy.
