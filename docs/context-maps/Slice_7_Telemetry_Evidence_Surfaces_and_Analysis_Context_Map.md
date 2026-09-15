# Slice 7 — Telemetry Evidence Surfaces and Analysis — Repository Context Map

Repository: `recoveryrob83-lab/PennyTel-AX`

Authoritative executable contract: GitHub Issue #16 — **Slice 7: Telemetry Evidence Surfaces & Analysis**

Frozen preparation baseline: `0b92aae68116458e5df8f5f1f60c3b0a72e4a443` (`0.2.0`, Slice 6 reconciled)

This map records repository geography only. It identifies the existing display,
derivation, filtering, export, test, and runtime seams for the slice. It does
not restate the Issue contract or worker-role instructions.

## Starting surface

Start at the existing selected-run flow and follow the same `Run[]` snapshot
outward:

1. [`src/renderer/src/App.tsx`](../../src/renderer/src/App.tsx) — `selectedRun`, `openRun`, and the wide run modal.
2. [`src/renderer/src/components/ui.tsx`](../../src/renderer/src/components/ui.tsx) — `RunMetrics` and `RecordDetails`, the reusable run-detail presentation primitives.
3. [`src/renderer/src/components/RunTable.tsx`](../../src/renderer/src/components/RunTable.tsx) — run links used by slice history, comparison candidates, analytics points, and accepted lifecycles.
4. [`src/shared/types.ts`](../../src/shared/types.ts) and [`src/shared/execution-evidence.ts`](../../src/shared/execution-evidence.ts) — the `Run.executionEvidence` attachment and its normalized evidence shape/validator.
5. [`src/shared/metrics.ts`](../../src/shared/metrics.ts), [`src/shared/analytics.ts`](../../src/shared/analytics.ts), and [`src/shared/comparison.ts`](../../src/shared/comparison.ts) — existing aggregation, cohort, grouping, and export derivation.
6. [`src/renderer/src/pages/Compare.tsx`](../../src/renderer/src/pages/Compare.tsx) and [`src/renderer/src/components/AnalyticsWorkspace.tsx`](../../src/renderer/src/components/AnalyticsWorkspace.tsx) — active comparison controls and analytics display.

The existing editor/import path is useful only as an adjacent evidence
boundary: [`RecordEditor.tsx`](../../src/renderer/src/components/RecordEditor.tsx)
accepts normalized evidence JSON through the ordinary run mutation path; Slice
7's operator display and analysis should consume the resulting `Run` snapshot,
not add a second evidence store.

## Run-detail execution-evidence surfaces

### Selected run modal

[`src/renderer/src/App.tsx`](../../src/renderer/src/App.tsx) (`selectedRun` and
the modal near the run-detail render) is the central run-detail route. It is
opened from `RunTable`, analytics scatter/trend source links, candidate evidence,
and accepted lifecycle tables. The modal currently composes:

- `RunMetrics` for cost, wall clock, cache ratio, meter burn, and pricing-snapshot notes;
- `RecordDetails table="runs"` for the flat field catalog;
- a linked-evidence section for findings/discoveries;
- edit, delete, and open-slice actions.

This is the narrowest place for a clear read-only structured evidence panel
because all run-detail entry points converge here. It already has the complete
`Run` object and the selected dataset snapshot. No raw log reader or external
file access is present or implied.

### Detail and table primitives

- [`src/renderer/src/components/ui.tsx`](../../src/renderer/src/components/ui.tsx), `RunMetrics` and `RecordDetails`: `RecordDetails` only renders keys in the flat [`fields`](../../src/shared/fields.ts) catalog, so nested `executionEvidence` is intentionally absent from its generic output. `RunMetrics` is the existing location for compact run-level metrics and Unknown/coverage wording.
- [`src/renderer/src/components/RunTable.tsx`](../../src/renderer/src/components/RunTable.tsx), `RunTable`: renders run type/candidate, model/thinking/session, role, API-equivalent cost, wall time, and result; each row opens the shared modal. It does not currently signal nested evidence presence or provenance.
- [`src/renderer/src/pages/Slices.tsx`](../../src/renderer/src/pages/Slices.tsx), `SliceDetail`: filters and sorts all runs for a slice, then sends them to `RunTable`; its accepted-slice metrics use `acceptanceRuns()` and existing economics. This route is the run-history entry point for detail inspection.
- [`src/renderer/src/components/RecordEditor.tsx`](../../src/renderer/src/components/RecordEditor.tsx), run `Execution evidence` section: evidence is edited as validated JSON, failed drafts are retained, and ordinary run edits pass through the same `onSave`/main mutation route. The evidence-only edit path deliberately preserves the pricing snapshot.

### Evidence authority and available fields

- [`src/shared/types.ts`](../../src/shared/types.ts), `Run.executionEvidence`: optional nested `ExecutionEvidence`; source identity remains attached to the run and is not promoted to a table or allowed to manufacture `sliceId`, `runType`, `role`, or other workflow metadata.
- [`src/shared/execution-evidence.ts`](../../src/shared/execution-evidence.ts), `CodexExecutionEvidence`, `CodexQuotaWindow`, and `validateExecutionEvidence()`: current discriminator is `kind: "codex-rollout"`, `formatVersion: 1`. Available nested evidence includes source-log basename/hash, session/turn IDs, runtime/originator/working-directory/repository provenance, TTFT, invocation/tool counts, model context window, paired peak invocation occupancy, quota windows, and recorded environment constraints.
- [`src/shared/data.ts`](../../src/shared/data.ts), `validateRecord()`/`validateDataset()`/`normalizeDataset()`/`mergeImport()`/`applyMutation()`: nested evidence is validated at raw record, migration, import, and mutation boundaries. V1 runs remain valid after detached normalization and retain omitted evidence as omitted.

## Comparison and analytics derivation seams

### Shared run metrics

[`src/shared/metrics.ts`](../../src/shared/metrics.ts) is the existing deterministic
primitive layer:

- `measured()` represents known total, complete total, recorded count, total count, and completeness without converting missing values to zero.
- `runEvidence()` aggregates the current flat numeric evidence (`inputTokens`, cached/output/reasoning tokens, files/tests) and categorical `buildResult`, `runtimeTested`, `result`, and `role` counts.
- `summarize()` supplies cost, timing, cache, role-cost, and existing meter-burn totals.
- `groupRuns()` and `groupLabels` define group dimensions and preserve explicit missing identities with an `Unknown (not recorded)` group.
- `recordedRunLabels`/`recordedRunValue()` are the existing seam for stable run-backed dimensions such as provider, provider ID, saved offer ID, run type, runtime-tested, and result.

Nested execution evidence is not included in `runEvidence()` or `summarize()` at
this baseline. Do not confuse `peakInvocation.inputTokens` (cache-inclusive
maximum occupancy for one invocation) with run `inputTokens` plus
`cachedInputTokens` (cost/token accounting).

### Descriptive analytics

[`src/shared/analytics.ts`](../../src/shared/analytics.ts) owns the higher-level
run analytics used by both the workspace and comparison artifact:

- `distribution()` calculates known-sample mean/median/min/max/sample SD and retains Unknown counts.
- `runAnalytics()` returns cost distribution, wall-time distribution, cost composition, reasoning share, and source run IDs.
- `temporalAnalytics()` groups recorded run starts by UTC date and retains undated run IDs; each time/cost point retains its source run ID.

This is the natural home for evidence-specific descriptive distributions or
coverage bundles when they need to be shared by UI and export. There is no
current helper for TTFT, invocation/tool counts, paired context utilization,
quota-window summaries, evidence source coverage, or per-evidence-source
grouping.

### Cohort, lifecycle, and export view

[`src/shared/comparison.ts`](../../src/shared/comparison.ts) is the central
comparison seam:

- `ComparisonContext`, `ComparisonFilters`, `ComparisonDateRange`, and `OutcomeFilters` are the bounded ephemeral state passed from the renderer.
- `validateComparisonRequest()` is the trust boundary for context keys, filters, group selection, candidate keys, stage scopes, date ranges, and accepted-outcome filters.
- `selectCohort()` applies slice filters, all active run conditions to the same run, date bounds, stage scopes, and accepted-outcome filters. If run-level conditions are active, only slices with a qualifying run remain in the visible cohort; once an accepted slice qualifies, its full relevant lifecycle is reopened by `acceptedEconomics()`.
- `compareDataBase()` derives the cohort, groups, `runAnalytics`, temporal analytics, accepted aggregates, findings, and discoveries from one dataset snapshot. `applyComparisonSelection()` adds selected group/candidate presentation state without changing the base analytical cohort.
- `comparisonMetrics()` combines `summarize()` and `runEvidence()` into the metrics shape consumed by group, candidate, and accepted-lifecycle views.
- `comparisonExport()` validates the request and revision, derives the same view, and emits the non-importable `ComparisonAnalysis` containing context, run IDs, groups, candidates, analytics, accepted aggregates, and conventions.

`acceptedEconomics()`/`acceptedAnalytics()` are the lifecycle boundary for
accepted-slice analysis. Evidence added to run-level aggregates must not
silently narrow accepted lifecycle cost or erase support/repair stages.

## Filtering and grouping seams

### Shared identity and grouping

Current stable dimensions are declared and resolved in two neighboring layers:

- [`src/shared/comparison.ts`](../../src/shared/comparison.ts), `runFilterLabels`, `runFilterIdentity()`, `runFilterOptions()`, `missingRunFilter()`, and `selectCohort()` handle exact filter values, including an explicit `null` missing-value selection.
- [`src/shared/metrics.ts`](../../src/shared/metrics.ts), `GroupBy`, `groupLabels`, `groupRuns()`, and `recordedRunValue()` handle group keys, labels, and missing-vs-literal-`Unknown` identity.
- [`src/renderer/src/pages/Compare.tsx`](../../src/renderer/src/pages/Compare.tsx) builds filter/group state, offers an Unknown option for missing values, resets selection when scope changes, and sends only revision plus context for export.

Evidence-source kind and runtime version are not current ordinary filter/group
dimensions. If introduced, they need aligned entries in the shared labels,
identity/options, cohort matching, group key/label, request validation, and
renderer control paths. A renderer-only filter would diverge from export and
comparison-plan results.

### Existing analytics presentation

[`src/renderer/src/components/AnalyticsWorkspace.tsx`](../../src/renderer/src/components/AnalyticsWorkspace.tsx)
is a memoized consumer of `ComparisonView`. It displays:

- known distributions by current group;
- cost composition and wall-time/reasoning bars;
- time-versus-cost source points;
- UTC-date cost trend with source-run links;
- accepted outcome aggregate tables and lifecycle stage composition.

[`src/renderer/src/pages/Compare.tsx`](../../src/renderer/src/pages/Compare.tsx)
also renders candidate comparison columns, run economics bars, underlying
`RunTable`, and accepted outcome/lifecycle detail. These are existing extension
surfaces for evidence coverage and source-run inspection; no chart dependency
or parallel analytics workspace exists.

## Export and comparison-plan result paths

### Ordinary comparison export

The path is:

`Compare.exportComparison()` → `window.pennytel.exportComparison()` → preload
`telemetry:export-comparison` → [`src/main/index.ts`](../../src/main/index.ts)
main-frame-checked handler → `TelemetryStore.initializeRegistry()` →
`comparisonExport()` over the main-owned dataset → `saveExport()` →
[`src/main/export.ts`](../../src/main/export.ts), `writeExport()`.

The renderer sends no dataset records. The main process revalidates context and
revision and writes a distinct `kind: "pennytel-comparison"` artifact. Raw
dataset export remains the importable source-of-truth path and must not be
collapsed into derived comparison output.

### Comparison-plan results

The plan path is:

`Compare.runComparisonPlan()` → preload `telemetry:run-comparison-plan` →
[`src/main/index.ts`](../../src/main/index.ts) dialog/load/save orchestration →
[`src/main/comparison-plan.ts`](../../src/main/comparison-plan.ts),
`runComparisonPlanOperation()` → [`src/shared/comparison-plan.ts`](../../src/shared/comparison-plan.ts),
`parseComparisonPlan()`/`validateComparisonPlan()`/`executeComparisonPlan()` →
one `comparisonExport()` per ordered context → `writeExport()`.

`validateComparisonPlan()` delegates each embedded context to
`validateComparisonRequest()`. Any new evidence filter/group or exported
analytics field therefore needs to remain valid and reproducible in both an
ordinary comparison artifact and every plan-result analysis. Both analysis
artifact kinds are rejected by telemetry import in [`src/shared/data.ts`](../../src/shared/data.ts).

The typed bridge is limited to the existing API in
[`src/preload/index.ts`](../../src/preload/index.ts),
[`src/preload/index.d.ts`](../../src/preload/index.d.ts), and
[`src/shared/types.ts`](../../src/shared/types.ts), `PennyTelAPI`. No generic
renderer filesystem or IPC authority is available.

## Relevant deterministic tests and fixtures

- [`tests/execution-evidence.test.ts`](../../tests/execution-evidence.test.ts) — v1 normalization, v2 round-trip/additive import, evidence-only edit economics, omitted/partial/zero evidence, strict nested bounds/privacy rejection, quota attribution, peak occupancy validation, and environment fields. This is the contract/compatibility baseline, not Slice 7 display/aggregate coverage.
- [`tests/execution-evidence-fixture.json`](../../tests/execution-evidence-fixture.json) — complete synthetic normalized evidence object; [`tests/fixtures.ts`](../../tests/fixtures.ts) exposes `evidenceFixture()` and production-shaped run/dataset fixtures.
- [`tests/analytics.test.ts`](../../tests/analytics.test.ts) — distributions, cost composition, date grouping, Unknown/zero/partial measurements, accepted-outcome aggregates, filter composition, and export parity. It is the primary target for new deterministic evidence analytics.
- [`tests/comparison.test.ts`](../../tests/comparison.test.ts) — cohort qualification, same-run filter/stage composition, grouping, selected candidates/groups, lifecycle retention, Unknown/zero/partial semantics, request validation, and non-importable comparison export.
- [`tests/comparison-plan.test.ts`](../../tests/comparison-plan.test.ts) — whole-plan validation, ordered one-snapshot execution, parity between plan analyses and ordinary `comparisonExport()`, save/cancel sequencing, and import guards.
- [`tests/compare-ui.test.tsx`](../../tests/compare-ui.test.tsx) — Compare controls, candidate/group selection, accepted lifecycle source links, export context, and plan-runner UI state.
- [`tests/analytics-ui.test.tsx`](../../tests/analytics-ui.test.tsx) — analytics charts, source-point inspection, filters/date/Unknown behavior, accepted aggregates, authoritative export, and narrow-window layout.
- [`tests/export.test.ts`](../../tests/export.test.ts) — atomic derived/raw export destination safety and live/backup alias protection.
- [`tests/data.test.ts`](../../tests/data.test.ts) and [`tests/store.test.ts`](../../tests/store.test.ts) — validation/import rejection, detached snapshots, revision/persistence, migration publication, backup/recovery, and retry invariants that evidence analysis must not weaken.

## Electron/runtime QA surfaces

`package.json` defines `npm run test:electron` as the production build plus
the real Electron smoke/recovery/profile/registry/configuration/accepted-
outcome/comparison-plan/evidence scripts. Relevant existing entry points are:

- [`scripts/electron-execution-evidence-qa.mjs`](../../scripts/electron-execution-evidence-qa.mjs) — isolated schema-v2 profile, v1 startup/export normalization, UI preview/import, strict rejection without publication, run-editor evidence correction, pricing preservation, raw round-trip/reload, and `sandbox`/`contextIsolation`/`nodeIntegration` assertions. It currently does not assert a dedicated read-only evidence panel or evidence-derived analytics.
- [`scripts/electron-analytics-qa.mjs`](../../scripts/electron-analytics-qa.mjs) — shared by accepted-outcome QA; exercises analytics charts/source links, filters/grouping, Unknown date/runtime behavior, accepted lifecycle retention, comparison export fields, narrow-window layout, and screenshots. Its current synthetic dataset covers existing economics/accepted-outcome analytics rather than nested execution-evidence aggregates.
- [`scripts/electron-comparison-plan-qa.mjs`](../../scripts/electron-comparison-plan-qa.mjs) — isolated-profile plan selection/execution, ordered results, revision/context parity, ordinary comparison separation, and result import rejection; it is the runtime parity surface for new exported analysis fields.
- [`scripts/electron-smoke.mjs`](../../scripts/electron-smoke.mjs) — broad local UI, raw/comparison export/import, revision, and startup smoke coverage; useful regression boundary for unchanged persistence and export behavior.
- [`scripts/electron-qa-capture.mjs`](../../scripts/electron-qa-capture.mjs) — screenshot helper used by runtime QA; artifacts belong under isolated `test-results/` rather than product commits.

Runtime QA must exercise the actual Electron artifact with an isolated
`PENNYTEL_DATA_DIR` profile. The current window boundary in
[`src/main/index.ts`](../../src/main/index.ts) is `sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`, denied navigation/new
windows/permissions, and main-frame-checked IPC. These are runtime invariants
for any new display/export path.

## Hazards and genuine unresolved repository facts

- **Nested evidence has no aggregate contract yet.** `runEvidence()` and `RunAnalytics` currently cover legacy flat run metrics only. The repository does not define the result shape for evidence coverage, TTFT, invocation/tool counts, paired context utilization, quota summaries, or source-log coverage.
- **Peak occupancy pairing is easy to misread.** `peakInvocation.inputTokens` already includes cached input and may carry its own `contextWindowTokens`; a future utilization derivation must not add cached input again, substitute the top-level window when association is unknown, or derive a maximum from cumulative run tokens.
- **Quota readings are not burn.** `quotaWindows[].attribution` is explicit evidence (`Clean`, `Contaminated`, or `Unknown`). The existing `usageBurn()` path operates on legacy `usageBefore`/`usageAfter`/`usageBurn` fields and must not consume quota endpoint deltas as per-run cost or usage burn.
- **Unknown versus zero remains a cross-layer invariant.** Omitted evidence, an evidence object with omitted metrics, partial quota endpoints, and empty quota arrays do not establish zero or complete coverage. Explicit numeric zero is recorded evidence. `measured()`/`recordedCounts()` are the existing semantic patterns.
- **Source provenance is inert metadata.** `sourceLog` content is external; PennyTel validates a SHA-256 representation but does not read, fetch, hash, or display raw JSONL/prompts/reasoning/tool payloads. `workingDirectory` and repository fields do not grant filesystem/network authority.
- **Filter/group changes are multi-seam changes.** New evidence dimensions must stay aligned across `ComparisonContext`, `validateComparisonRequest()`, `selectCohort()`, `groupRuns()`, renderer options/state, ordinary comparison export, and plan validation/execution. A renderer-only implementation would create export/plan drift.
- **Accepted lifecycle retention is coupled.** Run-level evidence filters qualify slices through `selectCohort()`, but accepted economics intentionally reopens the full same-slice lifecycle. Filtering must not accidentally erase critic/repair/support runs from accepted-outcome cost or evidence.
- **Nested evidence is outside the flat field catalog.** `RecordDetails` and `fields.ts` will not discover nested keys automatically. Specialized display must use the validated `ExecutionEvidence` shape and preserve the generic editor's ordinary save/persistence path.
- **Current QA has a seam gap.** The evidence Electron script verifies editing/persistence/security and the analytics script verifies legacy analytics/export, but no current runtime scenario combines a realistic evidence-bearing dataset with run-detail evidence display, evidence filters/groups, derived aggregates, ordinary export, and plan-result parity.
- **Baseline identity differs in the atlas header.** The dispatch freezes `0b92aae…`, while [`MASTER_INDEX.md`](../../MASTER_INDEX.md) still names `3a68d1d19e631711dd99b1d6fdd221021629d476` as its accepted `0.2.0` candidate. This preparation treats the dispatch baseline and current branch HEAD as authoritative; `MASTER_INDEX.md` was intentionally not modified.

## Surfaces likely needing post-acceptance atlas reconciliation

If implementation changes the mapped geography, reconcile only the accepted
delta in [`MASTER_INDEX.md`](../../MASTER_INDEX.md): renderer run-detail and
analytics responsibilities, shared evidence-analysis types/helpers, comparison
context/group dimensions, derived comparison/plan artifact fields, focused
tests, and Electron QA scripts. This preparation does not modify the atlas.
