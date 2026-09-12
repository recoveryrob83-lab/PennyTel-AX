# Final bounded repair verification

September 12, 2026, America/Chicago. Fresh implementation from clean reviewed candidate `e3a91b2aad457c926a0ba9bb320d19fe86cbc4c1`. Read Issue #1 and both current comments before editing. Immediate contract: [Final bounded repair packet](https://github.com/recoveryrob83-lab/PennyTel-AX/issues/1#issuecomment-5643642094). No commit created.

## Repairs

- **F-001:** Missing live telemetry is considered a new profile only when both live and backup directory entries are absent. Existing valid, corrupt, or dangling backup entries block startup and all mutations with recovery guidance. No automatic recovery or deletion occurs. Each save rechecks disk state before backup rotation, protecting a backup that appears after an empty load and protecting against missing/changed live data during a session. A new profile's first save writes only the live dataset; later saves retain the previous live revision as before.
- **F-002:** Raw and comparison exports share one main-process writer. It resolves parent directories, rejects canonical paths and symlink/non-file destinations, and compares device/inode identities against the actual live and backup targets. Unresolvable identities fail closed. Exports use exclusive temporary files, flush, recheck safety, then atomic replacement, avoiding truncation through destination links. Valid regular export files can still be replaced.
- **Acceptance editing:** Default local date/time control, visible IANA timezone and readable timestamp; edited local values serialize to ISO UTC with `Z`. Untouched original timestamps retain offset and millisecond precision. Explicit exact timestamp mode retains ISO-with-timezone validation. DST gaps are rejected; repeated local times require an explicit offset through exact mode.
- **Accept now:** Available for In progress slices, stamps current time and sets Accepted in the editor draft; Save slice persists through the existing mutation path. It does not assign quality or preferred candidate. Existing timestamps disable the action. Explicit clear/correction remains available; switching away from Accepted retains acceptance history.

Architecture, typed preload/IPC, schema/Sheet reconciliation, analysis calculations, pricing snapshots, and unknown-versus-zero rules remain intact. F-003 predicates were not changed.

## Regression coverage

`npm test`: **84 passed across 8 files**, up from 63. Added 21 cases, and updated the existing unreadable-live-path test for the earlier safety guard.

- Store: valid/corrupt/dangling backup-only states, rejected mutations and unchanged bytes, backup appearing after empty load, live disappearance/change, genuinely new profile, manual recovery, failed atomic live replacement with backup/memory preservation and successful retry.
- Exports: both payload types against direct, symlink, hard-link and parent-directory aliases of both protected files; ordinary new/replaced files; absent backup; dangling destination/protected target and non-file rejection.
- Editor: local-to-ISO persistence, timezone hint, existing exact precision, advanced correction and missing-timezone validation, Accept now timing, unknown judgments, history retention and explicit clearing.
- `scripts/electron-smoke.mjs` uses the new explicit exact timestamp option for its existing acceptance fixtures.
- New `scripts/electron-repair-qa.mjs` is included in `npm run test:electron` alongside the existing smoke suite.

## Verification

- Full unit suite: 84/84 passed.
- `npm run typecheck`: main/preload/shared, renderer, tests passed.
- `npm run lint -- --max-warnings=0`: passed. ESLint now ignores `test-results/**`, matching its artifact role and existing Git exclusion; old untracked critic scripts there were preserved.
- `npm run build`: passed.
- Both actual Electron scripts: passed using production output and isolated synthetic profiles. Native dialog return values were supplied by the harness; actual preload, IPC, serialization and filesystem writes were exercised. Local process sandbox initially blocked Electron launch; configured approval review allowed runtime verification without changing application sandbox settings.
- Existing smoke suite verified Codex token math, usage burn, multi-slice filtered lifecycle economics, raw/comparison exports, import rejection of analysis, historical prices, richer evidence, restart and 900px layout.
- Repair runtime verified summer/winter Chicago offsets, DST gap/overlap validation and exact correction, millisecond persistence, Accept now with unknown and known judgments, explicit clearing, history and restart. It rejected all 16 combinations of export kind × protected file × direct/symlink/hard-link/parent-directory alias, checking protected bytes after every attempt. Ordinary new/replaced exports succeeded. Backup-only startup, Retry load and direct mutation refusal preserved recovery bytes; manual restore followed by save retained recovered history.
- Runtime security preferences remained sandbox=true, contextIsolation=true, nodeIntegration=false. No renderer exceptions.
- Acceptance and recovery screenshots visually inspected.

Successful artifacts:

- `test-results/electron-qa-VbmlHK/` — existing full smoke, exports and screenshots.
- `test-results/repair-runtime-DEmq0f/` — bounded repair runtime, exports, preserved recovery evidence, `accept-now.png`, `backup-only.png`.

## Material observations and limitations

No additional unresolved material product defect was found. DST discontinuities were handled as part of the acceptance repair. Initial verification exposed harness issues (a fill identical to the existing wall time did not trigger a change event; ESM filesystem mocking needed an explicit module mock), both corrected. Existing npm mirror configuration emits npm warnings; these are not lint failures. No dependencies were installed or changed.

Recovery is deliberately manual and fail-closed; keep a separate recovery copy before restoring. All symlink export destinations are conservatively rejected, including harmless ones. Filesystems without usable identity information are rejected. Validation covers Linux Electron, not packaged installers or other operating systems; native picker interaction and physical power-loss recovery were not tested. The local editor uses the host timezone; repeated-time detection checks a three-hour window around the entered instant (modern DST), while unusual historical timezone transitions can use explicit ISO offsets. Concurrent hostile external filesystem mutation is outside the single-operator storage contract; close the app before external file changes. Unsaved acceptance drafts still require Save slice.

Final model token telemetry is not exposed by this environment.
