# Slice 5 — Comparison Analytics and Filters — Repository Context Map

Repository: `recoveryrob83-lab/PennyTel-AX`

Authoritative executable contract: GitHub Issue #10 — **Slice 5: Comparison Analytics and Filters**

Frozen product baseline: `bcca9a972dd1060bb275cb3ce75d66298c020dd7` (`0.1.3`, accepted/merged Slice 4)

This map is repository geography only. It does not restate the Slice 5 contract or worker-role instructions.

## Primary comparison derivation path

### `src/shared/comparison.ts`

This is the central comparison/cohort/export seam and the first place to inspect for Slice 5 analytical behavior.

Important existing symbols and behavior:

- `sliceFilterLabels`
  - Current slice-backed exact filters: `project`, `taskShape`, `ambiguity`, `risk`, `productionModel`, `experiment`, `disposition`, `qualityGrade`.

- `runFilterLabels`
  - Current run-backed exact filters: derived Model Configuration / canonical model / model family plus exact `model`, `thinking`, `role`, `sessionMode`, and `contextMode`.
  - Current filter values are scalar exact-match strings.

- `stageScopeOptions()` / `StageScope`
  - Stage scope is separate from ordinary filters.
  - Structured `Implementer`, `Critic`, and `Repair` roles are available as role scopes.
  - Exact recorded free-text `runType` values are also available and are not normalized into new roles.

- `ComparisonContext`
  - Current ephemeral state: `filters`, `groupBy`, `sort`, optional `selectedGroup`, optional `selectedCandidates`, optional `stageScopes`.
  - There is currently no date-range field, multi-value ordinary-filter field, accepted-outcome filter object, or analytics-view configuration object.

- `validateComparisonRequest()`
  - Main shared trust boundary for comparison/export requests.
  - Whitelists `ComparisonContext` keys and validates current exact filters, group, sort, candidate keys, and stage scopes.
  - Any new context/filter state that is exported must remain bounded here rather than being trusted from the renderer.

- `selectCohort(data, filters, stageScopes)`
  - Applies slice filters first.
  - Applies all active run filters to the same run.
  - Applies selected stage scopes as OR within stage selection and AND with run filters.
  - Matching runs qualify slices when run filters/stage scopes are active.
  - Returns eligible slices, qualifying slices, and matching/scoped runs separately.
  - This is the current cohort-integrity seam. Slice 5 filter work that changes qualification belongs here or immediately adjacent to it.

- `compareData(data, context)`
  - Uses `selectCohort()` for observed evidence.
  - Derives summary, groups, selected candidates, findings, discoveries, shown runs, and accepted outcomes from the same context.
  - `accepted` is derived from qualifying slices and then reopens each accepted slice’s full relevant lifecycle with `acceptedEconomics()`.

- `acceptedEconomics(data, slice)` / `acceptedOutcomeEvidence(...)`
  - Slice 4 accepted-outcome seam.
  - Preserves full same-slice lifecycle through acceptance.
  - Exposes exact stage composition, coverage/evidence gaps, conservative first-pass `Yes` / `No` / `Unknown`, explicit-link-aware repair evidence, reasoning share, runtime evidence through metrics, and source run IDs.
  - Accepted-outcome filters/analytics should reuse this derived state rather than reimplementing first-pass or repair semantics in the renderer.

- `comparisonMetrics(runs)`
  - Coverage-aware bundle: run count, measured cost, mean priced-run cost, measured wall time, usage burn, cache ratio/coverage, structured Repair count, role-cost measurements, and `runEvidence()`.

- `ComparisonAnalysis` / `comparisonExport(...)`
  - Shared non-importable analysis-v1 export.
  - Main process derives export from authoritative dataset state after revision/context validation.
  - Current export already carries context, cohort IDs, summary, groups, candidate evidence, accepted outcomes, and conventions.
  - UI and export should continue to share derivation rather than calculating parallel analytics independently.

## Metrics / aggregation layer

### `src/shared/metrics.ts`

Current deterministic primitives used by comparison:

- `runCost(run)` — frozen saved price snapshot + fresh input + cached input + output; reasoning is not billed separately.
- `runMinutes(run)` — explicit `wallMinutes` first, otherwise timestamp elapsed time.
- `measured(...)` — coverage-aware known/complete totals.
- `recordedCounts(...)` — categorical recorded counts with missing coverage preserved.
- `runEvidence(runs)` — measured token/file/test evidence plus build/runtime/result/role counts.
- `summarize(runs)` — known aggregate cost/time, role cost components, Repair-role count, cache ratio/coverage, usage burn/coverage.
- `roleSummary(runs, role)` — role cost with priced/total coverage.
- `timeToAccepted(...)` / `acceptanceRuns(...)` — accepted-lifecycle timing boundary.
- `qualitySummary(...)` is in `comparison.ts`, not this file.

Current `GroupBy` dimensions are:

- derived `modelConfiguration`, `canonicalModel`, `modelFamily`;
- exact `model`, `thinking`, `role`;
- `slice`, `candidate`, `productionModel`, `sessionMode`, `contextMode`, `localHour`, `dayOfWeek`.

`groupRuns()` is the shared grouping seam. It currently produces groups of runs, not higher-level accepted-outcome groups.

There is currently no shared median, percentile, variance/spread, trend-series, first-pass-rate, or accepted-outcome aggregate helper. If Slice 5 adds those, the shared deterministic layer should own the math used by both UI and export.

## Model/configuration identity

### `src/shared/configuration.ts`

Owns current derived Model Configuration, canonical model, and model-family identities/labels.

Use this seam for identity-sensitive filtering/grouping rather than rebuilding model + thinking composition in the renderer.

### `src/shared/registry.ts`

Broader provider/model/offer registry graph and identity/pricing history.

Open this only if provider/offer analytics need registry-backed display/identity beyond already-recorded Run/PriceSnapshot fields. Do not infer a provider/offer relationship that the saved run evidence does not establish.

## Source schema / evidence available

### `src/shared/types.ts`

#### `Slice`

Structured fields relevant to Slice 5 filtering/analytics include:

- `project`
- `repository`
- `taskShape`
- `productionModel`
- `factoryVersion`
- `ambiguity`
- `risk`
- `experiment`
- `startDate`
- `acceptedAt`
- `disposition`
- `qualityGrade`
- `preferredCandidate`
- `timeToAcceptedMinutes`

#### `Run`

Structured fields relevant to Slice 5 include:

- identity: `model`, `modelId`, `modelFamily`, `thinking`, `provider`, `providerId`, saved `priceSnapshot.offerId`;
- role/stage: structured `role`, free-text `runType`;
- session/context: `sessionMode`, `contextMode`, orchestration fields;
- time: `startAt`, `endAt`, `localHour`, `dayOfWeek`, `wallMinutes`;
- cost/token evidence: fresh/cached/output/reasoning tokens plus frozen `priceSnapshot`;
- build/runtime: `buildResult`, `runtimeTested`;
- intervention/friction counts: `humanInterventions`, `clarifications`, `toolIncidents`, `scopeViolations`, `autonomousDefects`;
- result: `Completed`, `Accepted`, `Needs repair`, `Rejected`, `Blocked`, `Aborted`.

#### `Finding` / `Discovery`

- Findings carry severity, category, status, repair flags/links, and optional run link.
- Discoveries carry type, prompt/self-initiation, validation/adoption, downstream-value, and optional run link.

### Important schema absences

Current schema v1 has **no dedicated structured fields** for:

- technical-stack tags;
- generic difficulty score;
- coupling score;
- generic evidence-class label;
- explicit context-preparation state;
- operator QA verdict separate from per-run `runtimeTested`;
- lifecycle-completeness assertion.

Do not treat `taskShape`, `ambiguity`, `risk`, `contextMode`, role/runType, notes, or other neighboring fields as silent substitutes for those absent concepts. If the Issue says “where present,” absence remains absence/Unknown.

## Filter-shape seams and hazards

Current ordinary filters are exact scalar equality filters. Several Slice 5 concepts are not yet representable by that shape:

- date/time range requires a bounded range representation and explicit timestamp field/boundary semantics;
- runtime QA can use recorded per-run `runtimeTested`, but it is not currently in `runFilterLabels`;
- provider can be sourced from recorded Run provider evidence, but is not currently an ordinary comparison filter;
- offer identity is saved in `priceSnapshot.offerId` when present rather than as a top-level Run field;
- repair presence/burden and first-pass state are derived at accepted-outcome level, not ordinary Run fields;
- accepted-outcome filters must preserve the existing “qualify cohort, then retain full lifecycle economics” rule rather than filtering lifecycle stages away after qualification.

`validateComparisonRequest()` and `selectCohort()` are coupled to any extension of comparison-context filter shape.

## Compare renderer

### `src/renderer/src/pages/Compare.tsx`

Owns the entire current Compare workspace and is the primary Slice 5 UI surface.

Existing sections already include:

- exact slice/run cohort filters;
- Group By and sort controls;
- multi-candidate Model Configuration selection;
- exact stage scopes;
- candidate evidence table and source-run drilldown;
- top-level cohort metrics;
- HTML/CSS role-cost bar visualization by current group;
- group summary table;
- underlying-run table;
- Slice 4 accepted-outcome table;
- accepted-outcome lifecycle/token/stage/source-run details;
- comparison export action.

Current UI already contains an inspectable bar-chart pattern (`comparison-bars` / `bar-row`) implemented with React + CSS rather than a chart dependency.

Slice 5 visual analytics can therefore inspect this surface before adding a new charting subsystem.

## Styling / layout

### `src/renderer/src/assets/main.css`

Owns comparison bars, tables, candidate tables, sticky cells, horizontal overflow, panels, responsive/narrow-window behavior, and shared visual primitives.

Slice 4 required narrow-window/horizontal-scroll QA. Any denser analytics surface should reuse or extend these rules carefully rather than assuming desktop width.

## Export/documentation boundary

### `docs/comparison-export.md`

Canonical documentation for analysis-v1 comparison semantics.

Already documents:

- configuration/stage/candidate context;
- cohort qualification;
- coverage/Unknown semantics;
- accepted-outcome lifecycle evidence;
- first-pass/repair/reasoning semantics;
- raw dataset export remaining separate and importable.

Update this when exported filter/analytics context or derived metric shape changes.

### `src/main/index.ts` / `src/main/export.ts`

Main process remains authoritative for comparison export and filesystem safety. Slice 5 should continue sending bounded context from renderer and deriving export from main-owned dataset state.

### `src/preload/index.ts` / `src/preload/index.d.ts`

Typed `exportComparison(request)` bridge already exists. A new generic filesystem/IPC channel is not implied by the current Slice 5 geography.

## Deterministic test surfaces

### `tests/comparison.test.ts`

Central tests for:

- filter/group composition;
- stage scopes;
- selected candidates;
- cohort qualification/full accepted-lifecycle retention;
- request validation;
- comparison export;
- Unknown/partial/zero evidence.

Primary test surface for new filter/context/aggregation semantics.

### `tests/accepted-outcome.test.ts`

Slice 4 accepted-outcome contract tests, including first-pass, repair, partial/zero evidence, frozen pricing, reasoning share, export, and raw-data stability.

Useful regression boundary when new filters/analytics consume accepted-outcome state.

### `tests/accepted-outcome-fixture.json`

Reusable production-shaped synthetic dataset with multiple accepted-outcome states and a six-stage cross-model lifecycle. Prefer extending/reusing evidence from this fixture where suitable instead of creating a contradictory duplicate semantic fixture.

### `tests/metrics.test.ts`

Metric primitives and coverage semantics. Relevant if Slice 5 adds shared statistical/aggregation helpers.

### `tests/compare-ui.test.tsx`

Current Compare renderer behavior: filter controls, grouping, candidate/state handling, accepted-outcome presentation, export payload, and operator-visible coverage.

Primary renderer test surface for analytics controls and visual/coverage presentation.

## Electron QA surfaces

### `scripts/electron-accepted-outcome-qa.mjs`

Production-path Electron QA over an isolated synthetic profile using the accepted-outcome fixture.

Already exercises:

- accepted-outcome summaries;
- cross-model six-stage lifecycle retention;
- first-pass/repair/Unknown/known-zero states;
- source-run/lifecycle inspection;
- comparison export;
- raw-data/restart stability;
- narrow-window horizontal-scroll behavior.

Strong candidate runtime extension point for Slice 5 accepted-outcome analytics.

### `scripts/electron-configuration-qa.mjs`

Existing comparison/configuration runtime QA for identity/group/filter/candidate/stage behavior and partial coverage.

Useful for broader run-level analytics/filter regression.

### `scripts/electron-smoke.mjs`

General smoke path contains presentation-sensitive comparison assertions. If the Compare layout changes, inspect this script for stale UI expectations before a broad Electron run.

### `package.json`

Current product version: `0.1.3`.

`npm run test:electron` currently runs build plus smoke, repair, new-profile, registry, configuration, and accepted-outcome QA scripts.

No charting library is currently listed in dependencies/devDependencies.

## Known runtime directive

Repository `AGENTS.md` contains the current required Codex/Electron route:

- in fresh Codex worker sessions, use the configured approved/elevated Electron execution path first;
- do not intentionally attempt the known-bad ordinary sandboxed route first;
- classify the known `sandbox_host_linux.cc:41` / `shutdown: Operation not permitted (1)` signature as environment denial;
- never weaken PennyTel/Chromium security to work around it;
- return `BLOCKED BY ENVIRONMENT` if approved execution cannot be obtained or also fails.

## Existing data flow

Observed comparison path:

`Dataset`
→ validated `ComparisonContext`
→ `selectCohort()`
→ qualifying `runs` / `slices`
→ `compareData()`
→ shared group/candidate/summary evidence
→ Compare UI and `comparisonExport()`

Accepted-outcome path:

qualified `Slice`
→ `acceptedEconomics()`
→ full same-slice lifecycle through acceptance
→ `AcceptedOutcomeEvidence`
→ accepted-outcome UI / export

Any Slice 5 visualization or aggregate intended for export should remain traceable to these shared derivations and source IDs/coverage.

## Broader fallback surfaces

Use `MASTER_INDEX.md` only if implementation evidence expands beyond this map, for example into:

- persistence/recovery;
- registry mutation/pricing authority;
- ingestion/schema validation;
- packaging outside the mapped Electron QA path;
- renderer/application routing outside Compare.
