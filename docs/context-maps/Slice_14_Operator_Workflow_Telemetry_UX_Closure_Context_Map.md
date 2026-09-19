# S14 Context Map — Operator Workflow + Telemetry UX Closure

Issue: #28 — **S14 — Operator Workflow + Telemetry UX Closure**

Prepared from accepted PennyTel main:

`ec7152073cbd7378feff5f25464a7f4f8b136e4b`

This map records repository geography only. Issue #28 owns required behavior and acceptance. `AGENTS.md` owns worker behavior. `MASTER_INDEX.md` is broader fallback context.

## Start here

Follow these four narrow dependency chains.

### A. Verification telemetry

1. `src/shared/types.ts` — `Run`
2. `src/shared/fields.ts` — Run field catalog / editor metadata
3. `src/shared/data.ts` — `validateRecord`, import/save validation
4. `src/main/codex-intake.ts` — Reporter metadata -> proposed Run
5. `src/renderer/src/components/RunTable.tsx`
6. `src/renderer/src/components/ui.tsx` / selected-run detail
7. `src/renderer/src/components/RecordEditor.tsx`
8. `docs/data-contract.md`
9. Run/data/editor/intake tests

### B. Missing-Slice resolution

1. `src/main/codex-intake.ts`
2. `pennyos/project.json`
3. `pennyos/slices/<sliceId>.json`
4. `src/shared/types.ts` — `Slice`, `CodexIntakeCandidate`, `PennyTelAPI`
5. `src/main/index.ts`
6. `src/preload/index.ts` and `src/preload/index.d.ts`
7. `src/renderer/src/pages/Data.tsx`
8. `src/shared/data.ts` / ordinary Slice save mutation
9. Codex-intake/Data UI/Electron QA

### C. Compare evidence UX

1. `src/renderer/src/pages/Compare.tsx`
2. `src/shared/comparison.ts`
3. `src/shared/metrics.ts`
4. `src/shared/analytics.ts`
5. `src/shared/configuration.ts`
6. `tests/compare-ui.test.tsx`
7. comparison/analytics/export tests

### D. Slice acceptance UI

1. `src/renderer/src/pages/Slices.tsx`
2. `src/renderer/src/App.tsx`
3. `src/renderer/src/components/RecordEditor.tsx`
4. `src/shared/acceptance-time.ts`
5. `src/shared/data.ts`
6. `tests/editor.test.tsx` and slice/UI/Electron coverage

Use `MASTER_INDEX.md` only if those surfaces do not answer a material dependency.

## Accepted S13 intake seam

### `src/main/codex-intake.ts`

S13 now owns integrated Codex discovery/review/import.

Relevant existing behavior:

- receipt discovery begins under `.pennyos/runtime/receipts/`;
- repository identity comes from tracked `pennyos/project.json`;
- receipt slice identity must exist in tracked `pennyos/slices/<sliceId>.json`;
- bounded active/archive Codex rollouts are captured in the main process;
- receipt authority is reduced monotonically;
- the first valid closure freezes measured Run telemetry;
- a sealed commit-time authority observation is the approved external cutoff;
- discovery and commit share the same eligibility evaluator;
- accepted import publishes through ordinary `ProductionStore.mutate({ kind: 'save', table: 'runs' })`.

The current review metadata already carries:

- `sliceId`
- `runType`
- `role`
- `result`
- `verification`
- `findings`
- optional `candidate`

Current `CodexIntakeCandidate.report.verification` is a string copied from validated Reporter evidence, but the proposed `Run` has no first-class verification field yet.

### Missing-Dataset-Slice boundary

The repository slice check and the Dataset relationship check are distinct:

- `receipts()` verifies tracked repository slice identity;
- `eligibility(...)` checks whether the corresponding Slice exists in the loaded PennyTel Dataset before the proposed Run can be imported.

This gives S14 an explicit source of semantic parent identity without inferring it from telemetry.

Tracked repository identity currently uses:

`pennyos/project.json`

with explicit:

- `projectId`
- `project`

and per-slice files such as:

`pennyos/slices/S13.json`

with explicit:

- `sliceId`
- `title`
- GitHub Issue number

Issue number is repository workflow identity and is not currently a PennyTel `Slice` field.

Do not invent additional Slice telemetry from the repository file.

## Run verification schema seam

### `src/shared/types.ts`

`Run` currently has:

- `result`
- `buildResult`
- `runtimeTested`

but no `verification`.

Keep these meanings separate.

### `src/shared/fields.ts`

Run fields are grouped into:

- identity/workflow;
- session/context;
- time/usage;
- tokens/cost;
- implementation/verification;
- factory behavior.

`result` already has canonical result vocabulary.

`buildResult` and `runtimeTested` live under Implementation & verification but are not worker verification dispositions.

This file is the ordinary editor/catalog location for a first-class flat `verification` field.

### `src/shared/data.ts`

`validateRecord('runs', ...)` uses the field catalog for flat Run fields and separately admits only nested `priceSnapshot` and `executionEvidence`.

Adding a normal verification field through the catalog automatically places it on the ordinary save/import validation path, subject to explicit options and compatibility tests.

Existing schema v1 -> v2 normalization is detached and should not manufacture verification.

### Documentation

`docs/data-contract.md` owns Run field semantics and currently explains that result, runtime-tested state, build evidence, and execution evidence have distinct meanings.

S14 should extend that existing dictionary rather than create a separate verification contract document.

## pennyReporter upstream seam

Sibling repository:

`/home/rob/dev/PennyOS-Reporter`

GitHub:

`recoveryrob83-lab/PennyOS-Reporter`

Current `src/protocol.js` defines:

`VERIFICATIONS = Passed | Failed | Not run`

Reporter Issue #2 now tracks expansion to:

- Passed
- Failed
- Partial
- Not run
- Unknown

PennyTel must not copy or locally override Reporter protocol validation.

The current S13 adapter consumes the installed package's public protocol seam.

## Missing-Slice operator workflow seam

### Main process

`src/main/index.ts` already owns narrow trusted IPC actions and one `ProductionStore`.

S13 added narrow Codex discover/import handlers.

Any explicit create-parent operation should remain a narrow main-process action or reuse the ordinary typed mutation path without exposing filesystem authority.

### Shared API

`src/shared/types.ts` owns:

- `CodexIntakeCandidate`
- `PennyTelAPI`
- `Slice`
- `Mutation`

A sanitized missing-Slice proposal belongs here if renderer review needs it.

Do not send raw repository file contents to React merely to create a Slice.

### Renderer

`src/renderer/src/pages/Data.tsx` already owns S13's Codex intake panel and explicit review/import action.

This is the natural place for a blocked candidate to expose a sanitized explicit parent-Slice proposal and an operator action.

The page already has a common busy/error/message wrapper and receives current Dataset revision through `data`.

### Ordinary Slice persistence

`src/renderer/src/App.tsx` / `save()` and `src/shared/data.ts` already implement normal Slice save semantics through revision-checked `mutate({ kind: 'save' })`.

Do not create a side-channel canonical writer.

## Slice acceptance seam

### `src/renderer/src/pages/Slices.tsx`

`SliceDetail` currently displays:

- disposition badge;
- acceptance timestamp when present;
- Edit slice action.

It does **not** expose the existing acceptance action.

The component currently receives edit/delete/open callbacks but no direct Slice save callback.

### `src/renderer/src/components/RecordEditor.tsx`

The editor already owns tested acceptance semantics:

- `Accept now`;
- sets `disposition: Accepted`;
- stamps current time;
- preserves existing acceptance history;
- explicit clearing is required before restamping;
- local-time display and exact timestamp correction are supported.

Do not duplicate divergent acceptance rules in `Slices.tsx`.

### `src/shared/acceptance-time.ts`

This module owns acceptance-time conversion/presentation helpers used by the editor.

Inspect and reuse the existing timestamp semantics rather than creating a second formatter/parser.

### `src/renderer/src/App.tsx`

App already owns revision-bearing save/mutate behavior and updates the detached loaded Dataset after persistence.

A first-class Accept action should flow through the same save path.

## Compare accepted-outcome seam

### `src/renderer/src/pages/Compare.tsx`

The relevant section is **Accepted slice economics**.

Current row identity uses slice title as the clickable primary label. Stable `slice.id` is not prominent.

The table currently includes:

- cost to accepted;
- lifecycle wall time;
- time to accepted;
- first-pass acceptance;
- repair burden;
- Runtime QA evidence.

Runtime QA evidence is currently:

`counts(metrics.evidence.runtimeTested)`

with the explicit note:

`Recorded runtime tested; no separate QA verdict`

This is a useful neighboring surface after first-class Run verification exists, but worker verification must not be conflated with runtime-tested evidence.

### Evidence coverage

`Run.executionEvidence` is optional and already has explicit Unknown/partial semantics.

S14 can classify a slice's relevant runs by observed attachment count:

- none of relevant runs carry `executionEvidence`;
- some carry it;
- all relevant runs carry it.

That is attachment coverage only. It does not mean every nested evidence field is complete.

Do not call a row “complete telemetry” merely because every run has an executionEvidence object.

### Comparison calculations

`src/shared/comparison.ts`, `metrics.ts`, `analytics.ts`, and accepted-outcome calculations own reproducible data derivation.

Issue #20 is principally a presentation/navigability problem.

Avoid changing cohort/economics semantics unless a UI requirement truly needs a shared derivation helper.

If an evidence-coverage filter changes the displayed accepted-slice cohort, put the derivation in the shared comparison layer so exported comparison context/results remain reproducible rather than implementing an unexported renderer-only semantic filter.

## Existing tests

### Verification/data

- `tests/data.test.ts`
- `tests/editor.test.tsx`
- fixtures under `tests/fixtures.ts`
- raw import/export and execution-evidence tests

These prove unknown-field rejection, flat Run validation, nested evidence preservation, ordinary edits, v1/v2 compatibility, and pricing snapshot stability.

### Codex intake

`tests/codex-intake.test.ts` now contains 32 focused S13 tests for:

- Reporter matching;
- bounded source capture;
- authority reduction;
- token semantics;
- missing/contradictory evidence;
- privacy;
- discovery/commit equivalence;
- one-shot preview tokens;
- canonical Run publication.

Extend this seam for verification transfer and missing-Slice resolution.

### Data UI

`tests/data-ui.test.tsx` covers Data & portability, batch import, and S13 intake presentation/action behavior.

### Compare UI

`tests/compare-ui.test.tsx` covers:

- comparison controls;
- filters;
- model configuration presentation;
- accepted-slice economics;
- export context;
- package-version visibility.

### Acceptance UI

`tests/editor.test.tsx` already proves editor `Accept now`, local timestamp handling, explicit clearing, and failed-save draft preservation.

New first-class Slice-page acceptance should reuse those semantics and add page/runtime coverage.

### Electron

`scripts/electron-codex-intake-qa.mjs` is the S13 isolated-profile/synthetic-Codex-home runtime route.

The broader `npm run test:electron` chain also covers storage, ordinary app flows, registry, comparison, execution evidence, and batch import.

S14 likely needs either extension of existing scripts or a bounded new closure QA script; do not duplicate the whole harness.

## Backlog relationship

Issue #28 is the executable S14 contract.

Backlog issues being reconciled by this slice:

- #5 — Accept Slice
- #19 — parent Slice support-file friction
- #20 — Compare evidence-aware rows
- #21 — verification telemetry
- #22 — integrated Codex parser/operator path

Do not implement requirements that exist only in stale backlog prose when Issue #28 has deliberately narrowed or superseded them.

## Genuine unresolved implementation facts

1. **Reporter Partial/Unknown emission**
   - pennyReporter v0.1 does not currently emit those values.
   - Reporter Issue #2 owns the upstream expansion.
   - PennyTel should support the final vocabulary without forking Reporter.

2. **Best shape for explicit missing-Slice proposal**
   - determine the smallest typed/sanitized API shape that lets Data & portability offer explicit creation without exposing raw repo files.
   - source semantics must remain limited to tracked project/slice identity.

3. **Compare evidence coverage filter ownership**
   - if filtering changes exported comparison context, implement it in shared comparison types/validation/export.
   - if the change is only compact row rendering with no cohort change, keep it presentation-only.

4. **Acceptance callback reuse**
   - identify the cleanest way for SliceDetail to invoke existing acceptance semantics without coupling it directly to storage or duplicating editor logic.

5. **Package version tests**
   - current UI tests assert package version `0.2.2`.
   - Issue #28 targets `0.3.0`; update all version assertions and runtime/export expectations coherently.

6. **Old parser references**
   - locate README/docs text that still describes the separate Codex parser as the normal path before deleting/changing anything.
   - generic JSON/batch import remains supported.

These are implementation questions, not permission to broaden S14.
