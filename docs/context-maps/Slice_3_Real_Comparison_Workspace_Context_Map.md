# PennyTel Slice 3 — Real Comparison Workspace Context Map

## Status and authority

- Repository: `recoveryrob83-lab/PennyTel-AX`, worktree `/home/rob/dev/PennyTel-AX-slice-3`.
- Assigned contract: [GitHub Issue #8 — Slice 3: Real Comparison Workspace](https://github.com/recoveryrob83-lab/PennyTel-AX/issues/8), parent Issue #11.
- Frozen Slice 3 base: `a02729f05a6345831ca4509c1cdcad1d3e48a0d4`.
- The worktree is on `eng/pennytel-slice-3-real-comparison-workspace` at that SHA; Slice 2 is accepted/merged.
- `MASTER_INDEX.md` is the durable repository navigation map. This document is a Slice 3 advisory map and should not replace or silently rewrite the index.
- Issue #8 is authoritative for Slice 3 behavior, acceptance, scope, and non-goals. Current source, tests, and runtime evidence describe implementation reality; this map is not authority to change product behavior.
- Current package version is `0.1.1`; Issue #8 targets `0.1.2` when Slice 3 ships.

The inherited top-level `SLICE_CONTEXT_PACKET.md` was a historical Slice 1 re-critic packet. It is replaced by the compact Slice 3 packet in this worktree.

## Slice objective

Turn the existing comparison page into a true multi-candidate workspace. The operator must be able to select two or more derived Model Configurations, optionally scope the observed stage/run evidence, and inspect trustworthy side-by-side production evidence while retaining current cohort filters, grouping, ordering, identity semantics, source provenance, and non-importable comparison export behavior.

The unit being compared is observed run evidence. This slice does not create a new telemetry source, persisted configuration field, universal score, recommendation, or accepted-outcome economic unit.

## Accepted Slice 2 foundation

### Model Configuration identity

`src/shared/types.ts` defines `Run.model`, optional stable `Run.modelId`, optional `Run.modelFamily`, and recorded `Run.thinking`. There is no persisted `Run.configuration` field. `Thinking` is the source vocabulary `Low | Medium | High | ExtraHigh | Max`.

`src/shared/configuration.ts` is the single derived identity path:

- `modelIdentity(data, run)` prefers a valid recorded registry model ID, otherwise uses the existing evidence-based `resolveIdentity()` rules. Ambiguous or unknown identity remains an unresolved tuple containing the explicit ID/text rather than being guessed into a registered model.
- `modelConfiguration(data, run)` combines the model identity key with the recorded thinking value. Missing thinking is a distinct `null` component presented as `Unknown`; it is never inferred from registry capabilities.
- Recorded `ExtraHigh` remains the raw/key value and is presented as `ExtraHigh / XHigh`. `XHigh` is not a telemetry import value.
- Configuration keys are JSON tuples of the form `[model-key-string, recorded-thinking-or-null]`; canonical model keys and unresolved model keys are also JSON tuples. Provider and offer are not configuration dimensions.
- `derivedRunIdentity()` supplies `modelConfiguration`, `canonicalModel`, and recorded `modelFamily` dimensions. `derivedPresentationLabels()` gives deterministic, dataset-wide collision-safe labels, including ordinals where equal labels represent distinct keys. Labels are presentation only.

### Existing metrics and rollups

`src/shared/metrics.ts` provides `GroupBy`, `groupLabels`, `groupRuns()`, `summarize()`, `roleSummary()`, `runCost()`, `runMinutes()`, `usageBurn()`, `cacheRatio()`, and `acceptanceRuns()`.

- Grouping already supports `modelConfiguration` by default in the current `Compare` page, plus `canonicalModel`, `modelFamily`, exact `model`, `thinking`, role, candidate, slice, workflow, session/context, local hour, and weekday dimensions.
- `summarize()` sums known run costs and wall minutes while retaining `priced`, `timed`, cache-known, and burn-known counts. Aggregate cache ratio is token-weighted across runs with both input counts.
- `runCost()` uses saved `priceSnapshot` rates and fresh input + cached input + output. Missing any required token count or snapshot makes that run cost unknown.
- `reasoningTokens` is validated as a subset of `outputTokens`; it is not an additional charge. No future aggregate may add reasoning to output for billing.
- Usage burn is explicit when recorded, otherwise safely inferred only from comparable remaining-meter readings without a reset/increase. Unknown readings remain unknown.

### Current comparison orchestration

`src/shared/comparison.ts` owns the shared comparison contract:

- `ComparisonContext` currently contains `filters`, `groupBy`, `sort`, and optional single `selectedGroup`.
- `runFilterIdentity()` and `runFilterOptions()` use the configuration derivation for virtual dimensions and source access for ordinary run fields.
- `selectCohort()` applies slice filters, then requires one run to satisfy all active run filters when run filters are present. With no run filters, empty eligible slices remain visible.
- `compareData()` derives groups, summaries, linked findings, validated autonomous discoveries, group quality distributions, displayed evidence runs, and accepted-slice economics.
- A selected group is a key lookup into the already-derived groups. It changes only `shownRuns`; it does not narrow the comparison cohort or accepted-slice lifecycle economics.
- Accepted-slice economics retains all relevant lifecycle runs, including other models/roles, and is an existing descriptive surface. Slice 4 owns any accepted-outcome lifecycle economics redesign.
- `validateComparisonRequest()` bounds and validates the revision, context keys, derived keys, filters, selected group, grouping, and sort. It rejects renderer-supplied derived metric payloads.

### UI, export, and persistence boundaries

- `src/renderer/src/pages/Compare.tsx` owns local UI state for `groupBy`, `filters`, one selected group key, sort, and export status. It calls `compareData(data, context)` for display and sends only `{ revision, context }` to the preload API.
- The renderer creates slice filter options locally and obtains run options from `runFilterOptions()`. It must not reconstruct model/configuration identity or labels.
- `src/main/index.ts` receives `telemetry:export-comparison`, validates the request, loads the main-owned snapshot, checks the revision, and calls `comparisonExport()`. The main process derives all metrics from authoritative data and writes through `src/main/export.ts`.
- `src/preload/index.ts`, `src/preload/index.d.ts`, and `src/shared/types.ts` expose the typed `PennyTelAPI.exportComparison(ComparisonRequest)` boundary. A context-shape change may require shared type updates, but it should not require a new IPC channel.
- `docs/comparison-export.md` defines analysis format v1 as non-importable. Raw dataset export/import remains schema-v1 source-of-truth behavior; the importer rejects comparison-analysis JSON.
- Dataset persistence remains owned by `src/main/store.ts`; comparison state is ephemeral renderer state and export context, not persisted telemetry.

## Likely working set

Primary implementation seams to inspect/change only as Issue #8 requires:

| File | Relevant symbols / evidence | Expected role |
| --- | --- | --- |
| `src/renderer/src/pages/Compare.tsx` | local comparison state, controls, group rows, evidence table, export request | Multi-selection and stage-scope controls/presentation; preserve existing filters, grouping, sort, and export status behavior. |
| `src/shared/comparison.ts` | `ComparisonContext`, `ComparisonRequest`, `runFilterIdentity`, `runFilterOptions`, `validateComparisonRequest`, `selectCohort`, `compareData`, `ComparisonView`, `comparisonExport`, `exportMetrics` | Shared candidate/stage selection, cohort derivation, coverage-aware side-by-side view, request validation, and analysis export. |
| `src/shared/configuration.ts` | `modelIdentity`, `modelConfiguration`, `derivedRunIdentity`, `derivedPresentationLabels` | Canonical identity/key/label path; do not create a second candidate identity system. |
| `src/shared/metrics.ts` | `GroupBy`, `groupRuns`, `summarize`, `runCost`, `runMinutes`, `usageBurn`, `cacheRatio`, `roleSummary` | Reuse/extend deterministic aggregates and coverage semantics. |
| `src/shared/types.ts` | `Run`, `ComparisonRequest` import, `PennyTelAPI` | Inspect for shared request/view contracts; do not add persisted fields without proof and explicit authority. |
| `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts` | `telemetry:export-comparison`, typed export bridge | Change only if the shared request contract requires it; main remains authoritative. |
| `docs/comparison-export.md` | analysis-v1 context/cohort/metric conventions | Document selected configuration keys and stage scope without repurposing raw export/import. |
| `tests/comparison.test.ts` | cohort, export, measured totals, unknown/partial data, stale request tests | Shared candidate/stage/metric/export proof. |
| `tests/compare-ui.test.tsx` | keyed UI selection and export payload tests | Renderer behavior for 2+, 3+, identity collisions, unknowns, and context capture. |
| `tests/configuration.test.ts`, `tests/configuration-fixtures.ts` | canonical/alias identity, Unknown, ExtraHigh, collision-safe labels, raw stability | Identity regression protection and real-shaped candidates. |
| `tests/metrics.test.ts`, `tests/fixtures.ts` | cost, tokens, time, cache, burn, role summaries and synthetic run evidence | Aggregate semantics and reasoning/cost regression coverage. |
| `scripts/electron-configuration-qa.mjs` | isolated real Electron configuration/filter/export/restart QA | Extend for multi-candidate and stage scope if needed. |
| `scripts/electron-smoke.mjs` | isolated end-to-end record creation, comparison, export, raw export/import separation | Existing production-shaped comparison/export path and unknown coverage. |
| `package.json` | canonical version `0.1.1`, scripts and `test:electron` order | Version target is `0.1.2`; do not alter during context preparation. |

`src/shared/data.ts`, `src/main/store.ts`, `src/main/export.ts`, `src/shared/registry.ts`, and `src/shared/fields.ts` are compatibility/invariant surfaces to inspect if evidence requires, not presumed Slice 3 modifications. In particular, adding a persisted configuration or stage field would expand validation, import, migration, and storage scope.

## Current comparison-state architecture

```text
main-owned Dataset snapshot
        │
        ▼
Compare.tsx local state: groupBy · filters · selectedGroup key · sort
        │                         │
        │ context                 └─ runFilterOptions / slice options
        ▼
shared compareData()
  ├─ selectCohort()                 (filters affect cohort)
  ├─ groupRuns() + summarize()      (group/order affect presentation)
  ├─ selectedGroup key lookup        (shownRuns only)
  └─ acceptedEconomics()             (full lifecycle for qualified slices)
        │
        ├─ renderer view
        └─ exportComparison() in main after revision check
             └─ non-importable analysis JSON with context/cohort/metrics
```

- `groupBy` is renderer state serialized in `ComparisonContext`; `GroupBy` and labels are shared in `metrics.ts`.
- `filters` are renderer state serialized in context. Slice filters compare source slice fields. Run filters use `runFilterIdentity()`, so derived configuration filters already compare keys rather than labels.
- The current selected group is a single optional key. `selectedGroup` is not a filter and does not alter `slices`, `runs`, or accepted lifecycle economics; it only chooses `shownRuns` and the resolved export evidence run IDs.
- Group sort is renderer state serialized as `label`, `cost`, or `time`; `compareData()` applies it deterministically with label tie-breaking.
- Cohort is derived in `selectCohort()`. With active run filters, all active run conditions must match the same run for a slice to qualify; after qualification, accepted economics retains its full relevant lifecycle.
- Model Configuration keys are derived by `configuration.ts`. Labels from `derivedPresentationLabels()` are stable display strings only. Filters, groups, selection, and export membership must use the same canonical keys.
- Comparison export receives only revision and context through main/preload. The main process reloads its authoritative data and derives the analysis, preserving raw source bytes and revision.

## Candidate-selection seam

The cleanest seam is an extension of `ComparisonContext` and `ComparisonView` around the existing `modelConfiguration` group keys, not a new persisted candidate/configuration field.

- Current selection is one `selectedGroup?: string` key. The key comes from `groupRuns()`/`derivedRunIdentity()` and is presentation-independent; `Compare.tsx` uses it for `aria-pressed`, evidence display, and export context.
- Multi-candidate selection should be a separate collection of canonical Model Configuration keys, so selecting candidates does not silently replace the existing per-field filter semantics or confuse a presentation label with an identity. The exact property name/shape is an implementation decision for Issue #8; it must be validated as bounded keys and carried through main-process export.
- Candidate membership should resolve through `modelConfiguration(data, run).key` / `derivedRunIdentity()`. `derivedPresentationLabels()` supplies labels, including collision ordinals, but must never be used as the selection value.
- `compareData()` is the shared place to derive selected candidate run cohorts/evidence and side-by-side summaries. The renderer should consume that view rather than filter independently.
- Likely shared changes are `ComparisonContext`, request validation, the comparison view’s selected-candidate representation, and `comparisonExport()` context/cohort output. The IPC channel remains structurally reusable because it already transports the shared `ComparisonRequest`.
- Preserve the existing selected-group behavior where it remains useful: selected-group evidence is presentation-only, while active filters continue to govern cohort qualification. Do not turn a candidate selection into accepted-lifecycle attribution or a winner/ranking score.

## Stage-scope seam

The current schema has two related but non-identical fields:

- `Run.runType` is required free text. The data contract and editor hint give examples such as `Implementation`, criticism, repair, verification, and context loading. Repository fixtures/scripts contain `Implementation`, `Criticism`, `Repair`, `Other implementation`, `Other repair`, `Context loading`, and synthetic QA text. It is not an enum and there is no canonical Re-critic/Verification vocabulary enforced by validation.
- `Run.role` is required and enum-like: `Orchestrator`, `Context Steward`, `Implementer`, `Critic`, or `Repair`. The existing comparison filter exposes `role`; `runType` is shown in run details/tables but is not a comparison filter or `GroupBy` dimension.

This means current evidence can be scoped directly where it is recorded, but it cannot justify a universal normalized stage taxonomy without policy:

- `role: Implementer`, `role: Critic`, and `role: Repair` provide structured role evidence corresponding broadly to implementation/critic/repair work.
- Exact `runType` text preserves invocation/stage labels and is the only existing place that could represent a distinct Re-critic or Verification label, if such a record is present.
- A `Criticism` run type is not automatically identical to a `Critic` stage, and role is not proof of an invocation subtype. Do not infer Re-critic from result, finding status, repair links, timestamps, or later runs.
- No current repository data/fixture scan found explicit Re-critic or Verification run records. They should remain unavailable/Unknown rather than fabricated. Missing or unrecognized stage evidence must not be converted to a known stage or zero counts.

The likely comparison seam is an explicit stage-scope control over existing recorded run evidence, with role-backed scopes and/or exact `runType` values kept semantically distinct. Whether Issue #8 wants a normalized presentation mapping for the free-text values is an architecture/product decision if the current evidence does not resolve it; a new persisted stage field is not proven necessary by the current schema.

## Side-by-side evidence

### Reliably available from current fields/helpers

- Sample/run count: `Run[]` length from the selected candidate/stage cohort.
- Total and mean API-equivalent cost: `runCost()` from each saved `priceSnapshot`; `summarize()` tracks priced count; `exportMetrics()` wraps known/complete coverage. Missing snapshot or any token count makes that run unknown, while explicit zero remains known.
- Wall time: `runMinutes()` prefers `wallMinutes`, otherwise timestamp elapsed time. Aggregates are summed recorded minutes with timed-run coverage, not elapsed cohort duration.
- Fresh input, cached input, output, reasoning: `Run.inputTokens`, `cachedInputTokens`, `outputTokens`, and `reasoningTokens` are stored and validated. Fresh and cached input are separate; reasoning is a subset of output.
- Cache ratio: `cacheRatio()` per run and token-weighted `summarize()` ratio across runs with both input counts. Denominator zero is unknown.
- Usage movement: explicit `usageBurn` or safely inferred `usageBefore - usageAfter` is available per run; `summarize()` tracks known burn coverage. It is percentage-point burn, not a provider-global balance.
- Repair/result/disposition evidence: `roleSummary()` and `repairRuns` cover recorded Critic/Repair roles; `Run.result`, linked findings/discoveries, and `Slice.disposition` are source evidence. Findings preserve severity/category/status and discovery attribution.
- Files/tests/verification evidence: run fields support numeric file/LOC/test counts, `buildResult`, and `runtimeTested`; they can only be aggregated where recorded.

### Current comparison gaps or limits

- The current UI/export metric bundle does not expose aggregate fresh-input, cached-input, output, or reasoning token totals even though the raw schema supports them. Slice 3 likely needs to extend shared aggregation/export/display with coverage objects; it must not infer omitted tokens.
- There is no weekly time-series usage table or meter identity. Safe per-run burn can be summed for the selected evidence, but a weekly movement claim, missing week, reset boundary, or provider balance cannot be reconstructed without inference. Preserve unknown coverage.
- There is no file list, test name/list, verification artifact, or stage field. Numeric test/file counts and `buildResult`/`runtimeTested` are available; names and unrecorded verification remain unknown.
- Findings with no `runId` are not part of the current run-group attribution; accepted-slice economics separately includes slice findings. Do not invent candidate blame from finding linkage.
- Current groups expose aggregate defects/discoveries/quality but not all `Run.result`, build, test, file, or disposition dimensions. Extend only where Issue #8 asks for evidence the schema actually supports.
- `acceptedSlices` is a separate lifecycle analysis and intentionally includes other models/roles. It must not be narrowed into a per-candidate winner/economics result in this slice.

## Export contract

The existing export is analysis-only format v1. `comparisonExport()` validates the request, checks the local dataset revision, calls the same `compareData()` path as the UI, and writes context plus derived cohort IDs/metrics from the main-owned snapshot.

Slice 3 context must capture enough state to reproduce the workspace, at minimum:

- selected Model Configuration identity keys (not labels);
- stage scope using the existing recorded evidence semantics, with absent/unknown stage evidence preserved;
- active filters, `groupBy`, and sort/order exactly as applied.

Likely additive changes belong in the shared `ComparisonContext`/analysis contract and `validateComparisonRequest()`, with selected-key membership and resolved evidence IDs in the derived cohort/groups. Keep the revision check, main-process derivation, bounded request validation, deterministic collision-safe labels, and `analysisFormatVersion`/raw schema separation. Do not put derived metrics or a new persisted configuration/stage field into raw dataset export.

`docs/comparison-export.md` must remain explicit that comparison JSON is not importable telemetry, while raw dataset export/import remains unchanged and source-of-truth. Export is read-only with respect to telemetry and must not mutate snapshots, costs, registry data, or the dataset revision.

## Tests and runtime QA

Extend the existing narrow surfaces rather than creating a parallel test harness:

- `tests/configuration.test.ts`: select two and three-plus real-shaped configurations; prove Astra Low and Luna Max are independent; retain alias/canonical equivalence, unresolved-ID collision resistance, Unknown thinking, ExtraHigh/XHigh presentation, and unchanged raw identity/cost evidence.
- `tests/comparison.test.ts`: prove selected keys resolve to the intended runs, 2+ and 3+ selection is deterministic, stage scope changes only the comparison cohort, filters/grouping/sort semantics remain intact, partial/unknown metrics retain coverage, reasoning is not billed twice, and export round-trips the complete context without mutating the source dataset.
- `tests/compare-ui.test.tsx`: prove usable 2-candidate and 3+-candidate selection, collision-safe labels/keys, stage controls where evidence exists, Unknown display, existing filters/grouping, and exported context.
- `tests/metrics.test.ts`: cover any new token/file/test/usage/stage aggregates, including known zero, partial coverage, empty sets, resets, and reasoning-subset billing.
- Configuration fixtures should retain Astra Low, Astra ExtraHigh/XHigh, Luna Max, Sol High, known-model/unknown-thinking, and distinct unresolved IDs. `tests/fixtures.ts` already has mixed-model, role, acceptance, priced/unpriced, usage, finding, and discovery evidence.
- `scripts/electron-configuration-qa.mjs` is the best existing real Electron seam for multi-configuration selection, collision resistance, Unknown, export, raw-byte stability, restart, and narrow layout. `scripts/electron-smoke.mjs` already exercises real IPC, run creation, cost/cache/reasoning/usage, cohort filtering, lifecycle export, raw export, and import separation.
- Runtime QA must use isolated temporary `PENNYTEL_DATA_DIR` profiles and the actual Electron path. Do not use the operator profile or substitute a standalone browser when desktop behavior is under test.

Real-shaped scenario matrix:

1. Select Astra Low + Luna Max independently; verify both side-by-side and exact keyed export context.
2. Select 3+ configurations including Astra ExtraHigh/XHigh and Sol High; verify deterministic ordering and usable controls.
3. Use two unresolved runs with the same display label but different IDs; verify labels remain distinguishable and selection/export follows keys.
4. Scope to Implementation, Critic, Repair, and any explicitly recorded Re-critic/Verification values; verify no absent stage is fabricated.
5. Mix priced/unpriced, timed/untimed, known/unknown token, cache, meter, file/test, and result evidence; verify Unknown/partial coverage.
6. Include reasoning tokens inside output and verify cost is unchanged by reasoning aggregation.
7. Export comparison and raw dataset separately; compare source bytes/revision before and after and restart the isolated profile.

## Integration hazards

- Using collision-safe presentation labels as identities, especially when selecting, filtering, or exporting candidates.
- Replacing canonical Model Configuration keys with exact model, model family, provider, or model+thinking display text.
- Duplicating `modelIdentity()`/`modelConfiguration()` logic in `Compare.tsx`, metrics, or export.
- Turning multi-selection into a normal single-value filter and thereby losing existing all-active-filter cohort semantics.
- Narrowing accepted-slice lifecycle economics to selected candidates or accidentally implementing Slice 4's accepted-outcome economic unit.
- Treating free-text `runType` and enum-like `role` as interchangeable, or inferring Re-critic/Verification from role/result/finding evidence.
- Converting missing token, time, usage, file/test, stage, or pricing evidence to zero.
- Adding `reasoningTokens` to output tokens for billing or otherwise double-charging reasoning.
- Aggregating weekly usage or verification claims beyond the fields actually recorded.
- Mutating source telemetry, price snapshots, registry identity, or revision while deriving comparison views/exports.
- Changing raw schema/import behavior merely to persist ephemeral candidate or stage UI state.
- Breaking export reproducibility by allowing renderer-derived metrics, unvalidated keys, stale revisions, or labels that change after filtering.

## Explicit non-goals

Issue #8 boundaries remain:

- no accepted-outcome lifecycle economics redesign (Slice 4 / Issue #9);
- no recommendation engine;
- no universal winner score or ranking;
- no workload classification redesign;
- no new telemetry collection or model-execution harness;
- no broad schema migration unless authoritative evidence proves an existing field cannot support the required behavior and Chief Engineering explicitly expands scope.

## Suggested focused verification order

1. Run targeted shared/UI suites first: `npx vitest run tests/configuration.test.ts tests/comparison.test.ts tests/compare-ui.test.tsx tests/metrics.test.ts`.
2. If request/export or identity contracts changed, run compatibility suites: `npx vitest run tests/data.test.ts tests/export.test.ts tests/registry.test.ts tests/registry-store.test.ts`.
3. Run `npm run typecheck`.
4. Run `npm test` and `npm run lint -- --max-warnings=0`.
5. Run `npm run build`.
6. Run `npm run test:electron` with the visible, unminimized Electron window and isolated QA profiles; distinguish host/window failures from application defects.
7. Finish with `git diff --check`, `git status --short`, and an explicit check that raw source files/bytes and package version changes are within the Issue scope.
