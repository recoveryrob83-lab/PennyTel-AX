# S15 Re-Critic 01 — Codex Discovery Horizon Hotfix

Project: PennyTel  
Slice: S15  
Issue: #29 — 0.3.1 Hotfix — selectable 1/3/5-day Codex discovery horizon  
Role: Re-Critic  
Reviewed candidate: `fce0b008addeb7ccfc6850ed90dd35699f3b3d28`  
Disposition: **REPAIR REQUIRED**  
Penny Reporter receipt: `pr1_20260919T224033601Z_8cdf8957dadfd7d92bfd87d87e5b6b2f`

> Historical note: this summary was reconstructed during S15 post-flight from the original Re-Critic return because the durable-review-summary SOP rule was adopted after these S15 review runs.

## Prior finding status

The original timezone-authority P1 from Critic 01 was **closed** in exercised cases. Producer timestamp behavior passed the 11h active + 23h archived duplicate case, filename disagreement, exact boundaries, DST cases, host timezone changes, and fixed preview/commit cutoff checks.

## Material finding

### P1 — Opening-record reads bypassed the 128 MB operation budget

The Repair Cycle 1 implementation moved authority classification to the bounded opening `session_meta` record, but `rolloutProducerTimestamp()` read source bytes before the shared byte budget was initialized. Inventory revalidation also performed an unbudgeted classification pass.

Concrete reproduction:

- one valid target plus 199 eligible metadata-only files;
- each opening record approximately 199,916 bytes;
- discovery read 159,145,576 bytes and still returned ready;
- commit independently read the same amount and published one Run.

Impact: Issue #29's retained total-byte operation bound could be exceeded while the operation still succeeded.

Required repair: create the shared operation budget before enumeration and charge all source bytes read for classification, ordinary scan, source verification, and inventory revalidation. Discovery and commit may each have their own fresh operation budget; no secondary classification budget may bypass the total limit.

P0: none.  
P2: none.

## Verification / observations

- 47 Codex intake tests passed.
- Typecheck, build, and isolated Electron Codex intake QA passed.
- Historical exclusion and the 200/201 eligible-file boundary passed.
- Independent probes confirmed malformed/missing/non-opening metadata blocks.
- Source changes/new duplicates after the commit seal did not retroactively invalidate the reviewed Run under the accepted S13 sealed-observation semantics.
- 66 real Codex 0.155.1 opening records were inspected and all were `session_meta`.
- Public version-pinned producer source was unavailable; producer verification rested on observed rollout records.

## Final state

No product repair or candidate mutation was performed by the Re-Critic.
