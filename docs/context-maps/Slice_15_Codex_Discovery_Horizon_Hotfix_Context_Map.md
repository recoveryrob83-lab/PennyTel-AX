# S15 Context Map — Codex Discovery Horizon Hotfix

Issue: #29 — **0.3.1 Hotfix — selectable 1/3/5-day Codex discovery horizon**

Production finding baseline:

`05c3e29bb7e6a7bd591e8059ff3d77ecd50eedf7`

This is a narrow production hotfix. Issue #29 owns WHAT. This map owns WHERE. `AGENTS.md` owns HOW.

## Mission boundary

PennyTel 0.3.0 correctly fails closed when the relevant Codex authority set exceeds its 200-rollout safety limit, but it currently defines that authority set as all active + archived Codex history.

S15 adds the missing operator-selected **1 / 3 / 5 day discovery horizon** and binds that horizon to review/commit.

Do not fix this by merely increasing `MAX_FILES`.

Do not reopen unrelated PennyTel 0.3.0 behavior.

## Primary dependency chain

### 1. Main-process intake authority

`src/main/codex-intake.ts`

Key current seams:

- `MAX_FILES = 200`
- `rolloutPaths(home, directories)`
- `CodexIntake.capture()`
- `CodexIntake.discover()`
- `CodexIntake.commit()`
- `Preview` / authority-observation state

Current `rolloutPaths()`:

- resolves the fixed Codex home;
- walks only `sessions` and `archived_sessions`;
- rejects symlink/containment escape;
- bounds depth and directory entries;
- accepts only `rollout-*.jsonl`;
- currently enforces `MAX_FILES` across the entire historical tree.

S15 must narrow the eligible source set by the selected horizon **before** the 200-file limit is applied.

Preserve all S13/S14 authority invariants:

- fixed source roots only;
- no arbitrary filesystem search;
- no mtime-as-semantic-authority shortcut;
- bounded reads;
- receipt authority monotonicity;
- duplicate closure detection inside the selected authority domain;
- inventory/source identity capture;
- sealed commit-time observation;
- raw content stays main-process-only;
- ordinary revision-checked canonical publication.

### 2. Source timestamp classification

Observed layouts already supported by the fixed roots include:

`sessions/YYYY/MM/DD/rollout-YYYY-MM-DDT...`

and

`archived_sessions/rollout-YYYY-MM-DDT...`

Use the bounded opening `session_meta.timestamp` from Codex 0.155.1 for horizon classification. It carries an explicit timezone; the filename clock is local wall time and remains structural identity only.

The implementation should have one explicit parser/classifier for source timestamp identity rather than spreading date parsing through traversal code.

Important questions the worker must settle from source reality:

- exact accepted rollout filename timestamp grammar;
- timezone interpretation of the timestamp embedded by current Codex;
- inclusive/exclusive horizon boundary semantics;
- malformed filename behavior.

Issue #29 requires malformed/ambiguous source identity to fail closed when it prevents trustworthy classification.

### 3. Shared typed API

`src/shared/types.ts`

Current:

`PennyTelAPI.discoverCodexRuns: () => Promise<CodexIntakeCandidate[]>`

S15 needs a narrow exact discovery-horizon type/value set.

Prefer an explicit union such as:

`1 | 3 | 5`

or an equally bounded semantic type.

Do not use arbitrary numeric durations or free-form strings.

The selected horizon is execution/review state, not canonical Dataset telemetry.

No Dataset schema change is required.

### 4. Main IPC authority

`src/main/index.ts`

Current handler:

`telemetry:discover-codex -> codexIntake.discover()`

S15 must validate the renderer-supplied horizon at the trusted main-process boundary before passing it into intake.

Never trust TypeScript alone for IPC validation.

The renderer must not gain generic filesystem or date-query authority.

### 5. Preload bridge

`src/preload/index.ts`
`src/preload/index.d.ts`

Expose only the bounded typed horizon argument for discovery.

Do not add generic IPC access.

### 6. Operator UI

`src/renderer/src/pages/Data.tsx`

The existing **Codex receipt intake** panel owns:

- Discover Codex runs;
- candidate review;
- Create Slice;
- explicit Run import.

Add a compact horizon selector beside/near discovery:

- Last 1 day
- Last 3 days
- Last 5 days

Recommended default from Issue #29: **1 day**.

The UI should make the active horizon obvious when displaying discovery results.

Changing the selector after a discovery does not mutate an existing preview. A new discovery establishes a new reviewed authority domain.

Avoid unrelated Data & portability redesign.

## Preview / commit state

The selected horizon must be bound to the preview/review state produced by discovery.

Current S13 preview state already binds:

- authority observation;
- match;
- Dataset revision.

S15 should additionally bind the exact discovery horizon or an equivalent normalized cutoff/authority descriptor.

Commit must recapture with the same authority domain that produced the reviewed proposal.

Do not read the renderer's current selector during commit.

A changed selector affects only the next `discover()`.

## Time semantics

Issue #29 describes a rolling recent horizon.

Engineering implementation must define one deterministic cutoff per discovery.

Recommended shape:

- normalize allowed horizon;
- capture `now` once at discovery start;
- derive a cutoff;
- classify every candidate source against that same cutoff;
- preserve the normalized horizon/cutoff needed for commit-time revalidation.

Do not let per-file traversal time shift the boundary.

Use deterministic injected/fake clock seams in tests rather than sleeping.

If the accepted S13 sealed-observation model requires commit to use a fresh current-time cutoff rather than the original cutoff, STOP and reconcile with Issue #29 before implementation. The intended contract is the **same reviewed authority horizon**, not a silently drifting one.

## Resource bounds

Existing limits remain meaningful:

- `MAX_FILES = 200`
- 32 MB per rollout
- 128 MB per discovery operation
- 256 KB per line
- 100,000 lines per file
- existing directory/depth bounds

Old rollouts outside the chosen horizon should be excluded before `MAX_FILES`.

If more than 200 eligible rollouts exist **inside** the selected horizon, discovery must fail closed and tell the operator to choose a smaller window.

Do not silently keep only the newest 200.

## Tests

### Primary deterministic suite

`tests/codex-intake.test.ts`

Add focused cases for:

- 1, 3, 5 day horizons;
- exact cutoff boundary;
- old files excluded before `MAX_FILES`;
- 218+ historical files with <200 eligible recent files succeeds;
- > 200 eligible recent files blocks;
- active and archived layouts;
- malformed/ambiguous rollout timestamps;
- same horizon/cutoff bound through preview and commit;
- selector change requires rediscovery;
- duplicate authority inside horizon blocks;
- duplicate outside horizon is out of the explicitly reviewed authority set;
- existing symlink/containment/privacy/byte limits remain intact.

Prefer small synthetic filename trees and an injected clock/cutoff over giant fixture payloads.

### API/UI tests

Likely affected:

- `tests/data-ui.test.tsx`
- preload/shared type compile coverage
- any IPC-focused test seam already used by the repo

Prove:

- default 1 day;
- only 1/3/5 options;
- selected value sent to discovery;
- active window visible;
- arbitrary IPC value fails closed.

### Runtime QA

`scripts/electron-codex-intake-qa.mjs`

Exercise:

selector -> discover -> review/create parent if needed -> rediscover -> import

and preserve:

- sandbox;
- context isolation;
- no node integration;
- restart/idempotency expectations already owned by the script.

## Version/docs

Patch target:

`0.3.1`

Likely durable updates:

- `package.json`
- `package-lock.json`
- `README.md`
- `docs/pennyreporter-integration.md`
- post-acceptance `MASTER_INDEX.md`

Do not reconcile `MASTER_INDEX.md` during implementation unless source reality requires a pre-acceptance correction. Normal map delta happens post-acceptance.

## Explicit non-goals

- no file-limit increase as the primary fix;
- no background watcher;
- no automatic import;
- no arbitrary custom date range;
- no calendar/date-picker UI;
- no receipt cleanup/deletion;
- no Codex-history migration;
- no canonical Dataset schema migration;
- no change to S13 sealed-observation semantics beyond binding the new horizon;
- no change to S14 tracked-Slice creation;
- no pennyReporter change;
- no unrelated PennyTel backlog.

## Known production evidence

Real operator Codex home currently contains **218 rollout files**, enough to block 0.3.0's all-history scan at the 200-file bound.

That observation is the production reproduction for this hotfix.

## Acceptance focus

The hotfix is successful when a normal real-world Codex home can contain arbitrarily older history without poisoning recent discovery, while the explicitly selected recent authority window remains complete, bounded, reviewable, and fail-closed.
