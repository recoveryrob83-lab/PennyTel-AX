# Slice 4 — Accepted Outcome Economics — Repository Context Map

Repository: `recoveryrob83-lab/PennyTel-AX`

Authoritative executable contract: GitHub Issue #9 — **Slice 4: Accepted Outcome Economics**

Frozen product baseline referenced by the Issue: `03639ba863ed5461ac72aa14cdcd61c2d173b65b` (`0.1.2`, merged Slice 3)

This map was reconciled against the accepted Slice 3 repository plus the documentation-only `AGENTS.md` preparation update. It is repository geography only.

## Primary derivation path

### `src/shared/comparison.ts`

Central comparison orchestration and the existing accepted-outcome seam.

Important symbols:

- `selectCohort(data, filters, stageScopes)`
  - Applies slice filters first.
  - Applies all run-filter conditions to the same run.
  - Applies stage scopes as OR within stage selection, AND with run filters.
  - Uses matching runs only to decide which eligible slices qualify when run filters/stage scopes are active.
  - Returns `eligibleSlices`, qualified `slices`, and matching/scoped `runs` separately.

- `acceptedEconomics(data, slice)`
  - Current full-lifecycle accepted-slice derivation entry point.
  - Builds lifecycle from every run with the same `sliceId`, passed through `acceptanceRuns()`.
  - Derives `stats` with `summarize()`.
  - Derives separate Repair and Critic role summaries with `roleSummary()`.
  - Derives repair/implementation cost ratio only when lifecycle pricing is complete and implementation cost is greater than zero.
  - Derives elapsed acceptance time with `timeToAccepted()`.
  - Attaches all slice findings, defect summary, and validated discoveries.

- `compareData(data, context)`
  - Calls `selectCohort()` for observed comparison evidence.
  - Builds group and selected-candidate evidence from scoped `cohort.runs`.
  - Builds `accepted` separately from qualified `cohort.slices` by calling `acceptedEconomics(data, slice)`.
  - Selected candidates partition observed runs but do not alter the accepted lifecycle.

- `comparisonMetrics(runs)`
  - Coverage-aware analysis bundle over an arbitrary run set.
  - Includes run count, measured cost, mean priced-run cost, measured wall time, measured usage burn, cache coverage, repair-pass count, role-cost measurements, and `runEvidence()` output.
  - `runEvidence()` exposes measured fresh/cached/output/reasoning tokens plus file/test counts and recorded categorical evidence including `runtimeTested`, `result`, and `role`.

- `ComparisonAnalysis.acceptedSlices`
  - Export shape already receives `comparisonMetrics(a.lifecycle)` for every accepted lifecycle.
  - Currently adds slice identity/context, `lifecycleRunIds`, elapsed acceptance time/basis, acceptance-window timing metadata, repair/implementation ratio, defects/findings, and validated discoveries.

- `comparisonExport(...)`
  - Main shared derived-export builder used after request validation/revision check.
  - Builds export from `compareData()` rather than accepting renderer-derived metrics.
  - `acceptedSlices` therefore follows the same lifecycle path used by the UI.

Existing neighboring types/constants in this file:

- `ComparisonContext`
- `ComparisonView`
- `AnalysisMetrics`
- `ComparisonAnalysis`
- `StageScope`
- `structuredStageLabels`
- `stageScopeOptions()`
- `validateComparisonRequest()`

## Metrics and coverage layer

### `src/shared/metrics.ts`

Deterministic economic/evidence primitives used by comparison and accepted economics.

Important symbols:

- `runCost(run)`
  - Requires saved price snapshot plus fresh input, cached input, and output token counts.
  - Bills fresh input + cached input + output only.
  - Reasoning tokens are not added as a separate charge.

- `runMinutes(run)`
  - Prefers explicit `wallMinutes`.
  - Falls back to `startAt`/`endAt` elapsed time.

- `measured(known, recorded, total, emptyIsZero?)`
  - Produces `{ knownTotal, completeTotal, recorded, total, complete }`.
  - Distinguishes partial coverage, complete coverage, empty evidence, and known zero.

- `runEvidence(runs)`
  - Numeric measured totals: `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningTokens`, `filesChanged`, `testsAdded`, `testsPassed`, `testsFailed`, `testsSkipped`.
  - Categorical recorded-count evidence: `buildResult`, `runtimeTested`, `result`, `role`.

- `summarize(runs)`
  - Accumulates priced cost, timed minutes, Repair/Critic/Implementer cost subtotals, repair-run count, cache ratio/coverage, and usage burn/coverage.
  - Returns raw known sums plus counts rather than a full `MeasuredTotal` bundle.

- `roleSummary(runs, role)`
  - Returns role cost plus priced/total counts.
  - Distinguishes no matching role runs from matching-but-unpriced role work.

- `acceptanceRuns(slice, runs)`
  - If `acceptedAt` exists, includes runs without `startAt` plus runs whose `startAt` is at/before acceptance.
  - If `acceptedAt` is absent, returns all supplied slice runs.

- `timeToAccepted(slice, runs)`
  - Applies only to accepted slices.
  - Prefers explicit `slice.timeToAcceptedMinutes`.
  - Otherwise calculates from earliest recorded run start to `slice.acceptedAt` when both exist.

- `recordedCounts(values)`
  - Used by categorical evidence bundles; missing values remain outside the recorded count rather than becoming false/zero.

## Source schema / evidence relationships

### `src/shared/types.ts`

Relevant source types:

#### `Slice`

Fields directly adjacent to accepted-outcome derivation:

- `id`
- `title`
- `project`
- `repository`
- `productionModel`
- `baseline`
- `startDate`
- `acceptedAt`
- `disposition`
- `qualityGrade`
- `preferredCandidate`
- `timeToAcceptedMinutes`

#### `Run`

Every run has:

- `id`
- `sliceId`
- free-text `runType`
- structured `role`

Structured `Role` vocabulary is currently:

- `Orchestrator`
- `Context Steward`
- `Implementer`
- `Critic`
- `Repair`

There is no structured `Re-critic` or `Verification` role. Those lifecycle labels can currently exist only through exact recorded `runType` text or another already-recorded role.

Relevant optional Run evidence includes:

- model/configuration identity fields;
- `startAt`, `endAt`, `wallMinutes`;
- `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningTokens`;
- remaining-meter / explicit burn fields;
- frozen `priceSnapshot`;
- file/test/build evidence;
- `runtimeTested`;
- `humanInterventions`, `clarifications`, `toolIncidents`;
- `result`.

#### `Finding`

Same-slice evidence can link to a run with `runId` and can record:

- severity/category/status;
- `repairRequired`;
- `repairRunId`;
- evidence / contract / impact fields.

`repairRunId` provides an explicit repair link where present; it is optional.

#### `Discovery`

Can link to a same-slice run through `runId`; validated-autonomous discovery filtering is implemented in metrics/comparison helpers.

## Relationship / validation boundary

### `src/shared/data.ts`

Repository validation and mutation layer.

Relevant established relationships from current repository map/source behavior:

- Runs belong to slices by `Run.sliceId`.
- Findings/discoveries may link to runs in their own slice.
- A run crossing a recorded acceptance timestamp is rejected by dataset validation.
- Optional evidence stays optional; absent numeric/boolean evidence is not rewritten as zero/false.
- Frozen pricing snapshots persist with historical run evidence.

This file is the boundary to inspect if Slice 4 work would require any source-schema or relationship assumption beyond existing derivation. Current Issue #9 does not itself imply a new persisted table or parallel storage path.

## Compare renderer surface

### `src/renderer/src/pages/Compare.tsx`

Owns the visible Compare workspace.

Current accepted-outcome surface:

- Section heading: `Accepted slice economics`.
- Uses `accepted` returned by shared `compareData()`.
- Current table columns show:
  - accepted slice/workflow;
  - preferred candidate / quality;
  - cost to accepted with priced-run coverage;
  - time to accepted / acceptance timestamp;
  - Repair / Critic cost and repair/implementation ratio;
  - repair passes;
  - defect evidence;
  - validated discoveries.
- Current footnote documents acceptance-window behavior and inclusion of undated runs.

Existing reusable UI evidence helpers in the same file:

- `measurement(MeasuredTotal, formatter)` renders known total plus recorded/total completeness.
- `counts(RecordedCounts)` renders categorical counts and completeness.
- Candidate comparison already renders measured token evidence, runtime-tested counts, result counts, roles/repair evidence, cache coverage, and usage burn.

The current accepted-outcome table does not yet expose all evidence already available through `comparisonMetrics(a.lifecycle)`.

## Comparison export documentation

### `docs/comparison-export.md`

Documents analysis-v1 export semantics.

Current accepted-slice documentation already states:

- `acceptedSlices` are qualified accepted slices with relevant lifecycle run IDs and derived evidence.
- acceptance economics qualify slices from active filters/stage scopes and then retain full lifecycle economics.
- candidate selection does not narrow accepted lifecycle cost.
- undated runs remain included.
- missing acceptance timestamp produces an unbounded acceptance window.
- known cost coverage and acceptance-timing completeness are distinct.
- raw telemetry remains separate/importable; comparison analysis remains derived/non-importable.

This document is coupled to the exported `ComparisonAnalysis` shape when that shape changes.

## Main-process comparison export boundary

### `src/main/index.ts`

Main process owns the `telemetry:export-comparison` IPC handler and authoritative dataset snapshot used for export.

The renderer sends request context/revision through the preload API; main validates caller/revision and derives the export from main-owned data.

### `src/main/export.ts`

Owns filesystem output safety/atomic write behavior shared by export paths. Slice 4 derivation should not require a parallel filesystem export path unless repository evidence proves otherwise.

### `src/preload/index.ts` / `src/preload/index.d.ts`

Expose the typed `exportComparison(request)` bridge. Current Slice 4 geography is primarily inside the existing request/analysis derivation rather than a new generic IPC surface.

## Automated test surfaces

### `tests/comparison.test.ts`

Highest-value current comparison/accepted-lifecycle coverage.

Current tests include:

- selected-candidate partitioning independent of accepted economics;
- exact structured role stage scopes;
- OR stage scopes combined with same-run filters;
- exact `runType` scopes including Re-critic/Verification spellings;
- comparison export state and accepted `lifecycleRunIds`;
- partial cost/time/cache/meter evidence;
- bounded request validation;
- multi-slice cohort qualification while retaining other models' full accepted lifecycle.

Likely central test file for new accepted-outcome derivation cases.

### `tests/metrics.test.ts`

Covers metric primitives and acceptance/cost/time behavior. Relevant when extending or composing `measured`, `summarize`, `roleSummary`, `acceptanceRuns`, `timeToAccepted`, `runEvidence`, token accounting, or coverage semantics.

### `tests/compare-ui.test.tsx`

Renderer-level Compare tests. Relevant to accepted-outcome table presentation, completeness labels, stage/lifecycle inspection, and operator-visible Unknown/known-zero distinctions.

### `tests/fixtures.ts` / configuration fixture files

Existing comparison fixtures include mixed-model/mixed-role accepted slice evidence and are used by comparison tests. Inspect before creating duplicate synthetic fixture builders.

## Electron runtime QA surface

### `scripts/electron-configuration-qa.mjs`

Existing real Electron comparison QA suite using an isolated synthetic `PENNYTEL_DATA_DIR`.

Current fixture characteristics:

- one accepted synthetic slice;
- multiple model configurations;
- mixed known/unknown token/time/meter evidence;
- Critic and Repair roles;
- exact `runType` examples `Re-critic` and `Verification`;
- no operator profile access.

Current assertions already cover:

- configuration grouping/filter/export;
- comparison candidate selection and zero-evidence candidates;
- stage scopes;
- partial coverage presentation;
- accepted export retaining the full lifecycle (`lifecycleRunIds` currently spans all fixture runs);
- raw telemetry remaining unchanged.

This is the existing Electron comparison-runtime extension point.

### `scripts/electron-qa-capture.mjs`

Shared Electron screenshot/window capture helper used by runtime QA scripts.

### `package.json`

`npm run test:electron` currently builds and runs:

1. `scripts/electron-smoke.mjs`
2. `scripts/electron-repair-qa.mjs`
3. `scripts/electron-new-profile-qa.mjs`
4. `scripts/electron-registry-qa.mjs`
5. `scripts/electron-configuration-qa.mjs`

Current package/app version is `0.1.2` on the frozen product baseline.

## Styles / layout

### `src/renderer/src/assets/main.css`

Contains Compare workspace/table styling, including multi-candidate horizontal scrolling and sticky headers introduced by Slice 3. Inspect only if accepted-outcome presentation changes require layout work.

## Existing cross-surface flow

Current accepted-outcome path:

`Dataset`
→ `selectCohort()` qualifies slices from slice/run/stage evidence
→ `compareData()`
→ qualified accepted slices
→ `acceptedEconomics(data, slice)`
→ `acceptanceRuns()` + `summarize()` / `roleSummary()` / `timeToAccepted()`
→ Compare UI

The export path shares the same derivation:

`ComparisonRequest { revision, context }`
→ main-process dataset/revision validation
→ `comparisonExport()`
→ `compareData()`
→ `acceptedSlices[]`
→ atomic comparison JSON export

## Current architecture seams / hazards

- Observed-run candidate/stage scope and accepted-outcome lifecycle are intentionally different layers: scoped evidence qualifies a slice; accepted economics then reopens the slice's full acceptance lifecycle.
- `selectedCandidates` does not qualify or narrow accepted slices.
- `Role` and `runType` are distinct evidence fields. Re-critic/Verification text is not normalized into a structured role.
- `acceptanceRuns()` deliberately retains undated runs; removing them would understate known lifecycle cost.
- Missing `acceptedAt` leaves the acceptance boundary unbounded.
- `timeToAcceptedMinutes` is an explicit Slice measurement and outranks timestamp-derived elapsed time.
- `runtimeTested` is optional per Run. The schema has no separate dedicated operator-acceptance record/table.
- `Finding.repairRunId` is optional; absence does not establish that no repair existed.
- `summarize()` exposes raw known sums/counts, while `comparisonMetrics()` wraps them into coverage-aware `MeasuredTotal` structures.
- `acceptedSlices` export already receives full `comparisonMetrics(a.lifecycle)` evidence; UI presentation currently exposes only a subset of it.
- Historical price authority lives in each Run's frozen `priceSnapshot`; accepted-outcome derivation calls `runCost()` over those saved snapshots.
- Raw dataset schema remains version 1 at the Slice 3 baseline.
- Comparison analysis remains format version 1 at the Slice 3 baseline.

## Broader fallback surfaces

If source evidence expands outside this mapped path, the current `MASTER_INDEX.md` contains the wider repository map for:

- persistence/recovery (`src/main/store.ts`);
- registry identity/pricing (`src/shared/registry.ts`, `src/shared/configuration.ts`);
- ingestion/validation (`src/shared/data.ts`);
- renderer/application ownership (`src/renderer/src/App.tsx` and page/component map);
- packaging/runtime scripts and broader test suites.
