# S15 Critic 01 — Codex Discovery Horizon Hotfix

Project: PennyTel  
Slice: S15  
Issue: #29 — 0.3.1 Hotfix — selectable 1/3/5-day Codex discovery horizon  
Role: Independent Critic  
Reviewed candidate: `aa8ddcb37e4ab0918dcc0d2cc9378413c6c8e3d1`  
Disposition: **REPAIR REQUIRED**  
Penny Reporter receipt: `pr1_20260919T222251079Z_2c7f6840d75ec1e4616eb197b9d39164`

> Historical note: this summary was reconstructed during S15 post-flight from the original Critic return because the durable-review-summary SOP rule was adopted after these S15 review runs.

## Material finding

### P1 — UTC interpretation silently excluded eligible authority

`rolloutTimestamp()` interpreted timezone-free rollout filenames with `Date.UTC`. Actual Codex 0.155.1 evidence contradicted that assumption: a filename clock of `2026-09-19T17-18-58` accompanied session timestamp `2026-09-19T22:18:58.188Z`, consistent with America/Chicago local wall time.

Independent reproduction used a 1-day horizon with active and archived duplicate closures whose authoritative creation times were 11 and 23 hours earlier. Their filenames used corresponding Chicago local times. The 1-day discovery incorrectly excluded the archived duplicate and returned ready; a 3-day discovery included both and correctly reported multiple matching terminal closures.

Impact: complete authority coverage and duplicate blocking inside the selected horizon could be violated.

Required repair: derive horizon classification from verified timezone-aware producer semantics and fail closed when trustworthy classification is unavailable. Do not substitute host timezone, filesystem timestamps, or another filename-timezone guess.

P0: none.  
P2: none.

## Verification / observations

- 79 focused tests passed after approved rerun of the intake suite; initial failures were fixture subprocess EPERM errors.
- Electron Codex intake QA passed, including selector/IPC checks, historical exclusion, tracked Slice creation, explicit import, duplicate rejection, privacy, and restart.
- Source inspection confirmed exact 1/3/5 validation, frozen preview cutoff reused at commit, unchanged resource bounds, and preserved S13/S14 mechanisms.
- Existing boundary tests and Electron fixtures incorrectly encoded UTC filename assumptions and therefore did not catch the defect.
- DST and timezone-change cases remained unverified at this stage.

## Final state

No product repair or candidate mutation was performed by the Critic.
