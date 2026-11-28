# COMPACT AUDIT SPECIFICATION

## Token-Saving Execution Rules (Strict)
1. **Read-Only on App Code:** Never edit application code. Only update `docs/audits/LATEST_AUDIT.md`.
2. **Delta Mode First:** If `docs/audits/LATEST_AUDIT.md` exists and the user did NOT ask for a "deep report":
   - Run `git diff --name-only <last_audited_commit>..HEAD` (or `git status -s` if uncommitted).
   - Read **ONLY** the changed files. Carry forward unchanged sections verbatim from `LATEST_AUDIT.md`.
3. **Scope Lock (Skip Noise):** Never read `node_modules`, build artifacts, CSS, static assets, or MusicXML data files. For UI views, inspect only their props/imports via grep/head—do not read full rendering bodies.
4. **Evidence & Brevity:** Cite `file:line` for every claim. Use compact tables and 1-line bullets. Target **under 900 words** total. Zero filler prose.

## Required Report Structure (Overwrite `docs/audits/LATEST_AUDIT.md`)

### 0. Header & Delta
- **Version / Commit:** `<version> | <short-hash> | <YYYY-MM-DD>`
- **Mode:** `Delta (X files changed)` or `Deep Scan`
- **Changes Since Last Audit (max 5 bullets):** Fixed, regressed, or newly added.

### 1. Pipeline Map (Compact)
- 1-line flow for **Scales** (`file -> file -> file`) and **Pieces** (`file -> file -> file`).
- Explicitly note any divergence between Scale and Piece pipelines.

### 2. Mic, DSP & Hardware Tuning (Table)
| Layer | Current Implementation (`file:line`) | Key Parameters / Thresholds |
|---|---|---|
| Mic & Filters | | |
| Threading (`rAF` vs `AudioWorklet`) | | |
| Pitch & Repeated-Note Onsets | | |
| Gates, Clarity & Latency | | |
| Web MIDI / Drone / Backing | | |

### 3. Alignment, Scoring & History (Compact Bullets)
- **Alignment:** Grid / Wait / Elastic; attack trim; skips & retries (`file:line`).
- **Formulas:** Pitch, Fluency (note if duration is scored), Tone (wobble vs vibrato), Total weights & bands (`file:line`).
- **Persistence & Coach:** Scale vs Piece storage (`IndexedDB`/`localStorage`), per-note retention, coach logic (`file:line`).
- **Visual & MusicXML Sync:** Shared timeline status; `.mxl`, multi-part, tempo-map, bar-loop, GitHub streaming status.

### 4. Performance & Hardcoded Limits
- **Main-thread risks:** 1–3 bullets max.
- **Magic numbers / caps:** Inline list (`name=value @ file:line`).

### 5. Ranked Gaps & Risks (Max 8 Rows)
| Severity | Type | Area | Exact Gap Today | File(s) |
|---|---|---|---|---|
| High/Med/Low | Bug / Missing / Debt | | | |

*(If any file was truncated or skipped by the file reader, add a 1-line `Caveats:` note at the bottom.)*
