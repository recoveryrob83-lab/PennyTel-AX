# PennyTel Slice 2 — Model Configuration Identity Context Map

## Status and authority

- Repository: `recoveryrob83-lab/PennyTel-AX`
- Authoritative slice contract: GitHub Issue #7 — **Slice 2 — Model Configuration Identity**
- Companion version contract: GitHub Issue #4 — **Always-visible app version and slice versioning**
- Context-map baseline: `main` at `f2ed8f02236220f04eaca97afe55c7b12490cdc5`
- Durable repository map: root `MASTER_INDEX.md`

This file is an advisory context map for Slice 2. The GitHub Issue remains authoritative for behavior, acceptance criteria, scope, and non-goals. If repository reality or the Issue conflicts with this map, follow the Issue and current code, then report the mismatch.

Before implementation begins, freeze the actual Slice 2 base SHA. If it differs from the baseline above, reconcile this map against current `main` and `MASTER_INDEX.md`, then place the reconciled packet at the top level of the Slice 2 worktree as `SLICE_CONTEXT_PACKET.md`.

## Slice objective

Make **Model Configuration** a first-class comparison identity so PennyTel can distinguish configurations such as:

- GPT-6 Astra — Low
- GPT-6 Astra — ExtraHigh / XHigh
- GPT-5.6 Luna — Max
- GPT-5.6 Sol — High

without losing model-family rollups or rewriting historical source telemetry.

The existing source evidence already contains the two important pieces:

- canonical/exact model identity evidence (`Run.model`, optional stable `Run.modelId`); and
- recorded thinking level (`Run.thinking`).

The central implementation problem is therefore downstream derivation, grouping, filtering, labeling, and export—not inventing a new telemetry source.

## Core architectural reading

### Persisted run evidence

Primary file: `src/shared/types.ts`

Relevant types:

- `Thinking = 'Low' | 'Medium' | 'High' | 'ExtraHigh' | 'Max'`
- `Run.model`
- `Run.modelId`
- `Run.provider`
- `Run.providerId`
- `Run.modelFamily`
- `Run.thinking`
- `Dataset.registry`

Important observation:

`Run` does **not** currently persist a separate Model Configuration field. The existing evidence needed to derive configuration identity is already present. Prefer a derived analytical identity unless implementation evidence proves persistence is necessary.

Do not backfill missing thinking levels. Missing `Run.thinking` is Unknown.

### Registry identity and alias resolution

Primary file: `src/shared/registry.ts`

Relevant types/symbols:

- `ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`
- `RegistryModel`
- `RegistryIdentity`
- `identityCandidates()`
- `resolveIdentity()`
- `backfillRegistry()`

Identity behavior already established by Slice 1:

- stable `modelId` takes precedence when present;
- otherwise exact case-insensitive registry canonical/API/alias/provider evidence may resolve identity;
- ambiguous identity remains unresolved rather than guessed;
- registered identity backfill attaches stable IDs only when resolution is unambiguous.

The Slice 2 implementation should reuse these semantics rather than create a parallel alias-resolution system.

Important vocabulary hazard:

- telemetry thinking uses `ExtraHigh`;
- registry capability metadata uses `xhigh`.

Do not silently rewrite recorded telemetry. Any normalization between these vocabularies should be explicit, narrow, and only where the registry contract already establishes equivalence. The Issue does not authorize guessing a thinking level from registry capability metadata.

### Current grouping implementation

Primary file: `src/shared/metrics.ts`

Relevant symbols:

- `GroupBy`
- `groupLabels`
- `groupRuns()`
- `summarize()`

Current `GroupBy` supports independent `model` and `thinking` dimensions. `groupRuns()` reads one dimension at a time and groups by `run[groupBy]` for run-level dimensions.

This is the main seam for adding a Model Configuration grouping while retaining model-only and thinking-only rollups.

High-value implementation direction:

- add a single shared configuration-identity derivation/accessor rather than duplicating model+thinking composition across metrics, filters, UI, and export;
- preserve `model` and `thinking` groupings;
- make Unknown explicit when thinking evidence is absent.

### Current comparison/filter implementation

Primary file: `src/shared/comparison.ts`

Relevant symbols:

- `runFilterLabels`
- `FilterKey`
- `ComparisonFilters`
- `ComparisonContext`
- `validateComparisonRequest()`
- `selectCohort()`
- `compareData()`
- comparison export derivation

Current run filters are direct `Run` properties:

- `model`
- `thinking`
- `role`
- `sessionMode`
- `contextMode`

`selectCohort()` currently compares active run filters using direct property lookup (`run[key]`). A derived Model Configuration filter therefore cannot safely be added by label alone; the filter path needs a shared way to evaluate virtual/derived comparison dimensions.

This is an important dependency: do not implement configuration grouping in `metrics.ts` while leaving filter/export semantics with a separate ad hoc identity rule.

The comparison export serializes `ComparisonContext`, so any new grouping/filter dimension must remain valid through `validateComparisonRequest()` and be reproduced consistently in main-process export derivation.

### Compare UI

Primary file: `src/renderer/src/pages/Compare.tsx`

Relevant behavior:

- initial `groupBy` is currently `model`;
- group selector is driven by `groupLabels`;
- filter UI is built from `sliceFilterLabels` and `runFilterLabels`;
- run filter options are currently derived by direct access to raw run properties;
- group labels, selected group state, underlying runs, accepted economics, and export all share the same comparison context.

A derived Model Configuration filter/group must therefore use the same canonical derivation as the shared comparison layer. Do not build configuration labels independently in the renderer.

Likely UI acceptance checks:

- Astra Low and Astra ExtraHigh/XHigh appear as separate configuration choices/groups;
- Luna Max and Sol High remain distinct;
- model-family/model-only rollup is still available;
- missing thinking evidence renders as Unknown rather than being dropped or inferred;
- existing comparison interactions continue to work.

### Field catalog and validation boundary

Primary files:

- `src/shared/fields.ts`
- `src/shared/data.ts`

Relevant facts:

- `fields.ts` already defines `model`, `modelId`, `modelFamily`, `provider`, and `thinking` as source telemetry fields;
- `thinking` is constrained to `Low`, `Medium`, `High`, `ExtraHigh`, `Max`;
- `data.ts` validates records using the field catalog and rejects unknown persisted fields;
- raw dataset import/export is schema-v1 source evidence.

Expected default for Slice 2: these files should need little or no product-contract change if Model Configuration remains derived.

Hazard: adding a persisted `configuration` field would require coordinated schema/field/import validation behavior and historical migration policy. The Issue does not require that. Avoid introducing redundant persisted truth unless a concrete implementation constraint makes it necessary and Engineering explicitly accepts the expansion.

## Likely working set

### Primary

1. `src/shared/metrics.ts`
   - Model Configuration grouping identity
   - `GroupBy`
   - `groupLabels`
   - `groupRuns()`

2. `src/shared/comparison.ts`
   - configuration filter identity/accessor
   - filter labels/types
   - cohort filtering
   - request validation
   - comparison/export consistency

3. `src/renderer/src/pages/Compare.tsx`
   - group/filter options and labels
   - configuration presentation
   - comparison state using shared semantics

4. `src/shared/types.ts`
   - only if a non-persisted shared derived type/helper contract is useful
   - avoid changing the persisted `Run` schema merely to store configuration identity

### Secondary / inspect as needed

5. `src/shared/registry.ts`
   - reuse `resolveIdentity()` / stable model identity semantics
   - canonical model labels and alias equivalence
   - do not alter pricing behavior for this slice

6. `src/shared/fields.ts`
   - inspect to preserve thinking/model source-field semantics
   - change only if UI/editor wording must be aligned; no new persisted configuration field by default

7. `src/shared/data.ts`
   - inspect for compatibility and import/export invariants
   - should remain unchanged unless persistence/schema is intentionally expanded

8. `src/renderer/src/components/RunTable.tsx` and shared presentation components
   - only if comparison evidence needs a clearer combined model+thinking label
   - do not broaden into unrelated UI cleanup

### Version companion, if completed in this slice

Issue #7 targets `0.1.1` and coordinates with Issue #4.

Potential narrow version working set:

- `package.json` — currently `0.1.0`, canonical package version
- `src/renderer/src/App.tsx` — likely always-visible application chrome surface
- main/preload/build metadata path only if needed to expose the canonical package/app version without hard-coded duplication

Keep this subtask separate from Model Configuration identity internally. Do not invent a second version constant.

Issue #5 (visible Accept Slice control) is not part of this map unless Engineering explicitly bundles it later.

## Dependency map

```text
Run source evidence
  ├─ model / modelId
  ├─ provider / providerId
  ├─ modelFamily
  └─ thinking
       │
       ▼
Registry identity semantics (when registry evidence exists)
  ├─ identityCandidates()
  └─ resolveIdentity()
       │
       ▼
Shared derived Model Configuration identity
       │
       ├─ metrics.groupRuns() / GroupBy
       ├─ comparison run-filter evaluation
       ├─ compareData() groups
       ├─ comparison request validation/export
       └─ Compare.tsx labels/options/selection
```

The shared derived identity should be the single semantic seam. UI and export should consume it rather than recompute it independently.

## Configuration identity rules to preserve

These are constraints from Issue #7 and existing architecture, not a mandate for one exact helper API.

1. Prefer stable registry `modelId` when valid/available.
2. Use existing registry canonical/alias resolution only when it is unambiguous.
3. Preserve exact legacy model evidence where no canonical registry identity is available; do not silently merge merely similar names.
4. Combine model identity with the **recorded** thinking level.
5. Missing thinking stays Unknown.
6. Do not infer thinking from registry-supported reasoning capabilities.
7. Do not mutate historical price snapshots or costs when deriving configuration identity.
8. Model-only and model-family analysis must remain available.
9. Raw dataset import/export remains source evidence; derived comparison export may include the new grouping/filter context.

## Key hazards

### 1. Duplicated derivation

If `metrics.ts`, `comparison.ts`, and `Compare.tsx` each build their own configuration key/label, they can drift on Unknowns, aliases, or registry identity. Prefer one shared derivation/accessor.

### 2. Virtual filter through direct property lookup

`selectCohort()` currently assumes every run filter maps directly to `Run[key]`. Model Configuration is derived. Adding only a new filter label/type without changing evaluation will fail or encourage a fake persisted field.

### 3. Historical mutation

Do not backfill thinking or rewrite run model strings simply to make grouping prettier. Existing production telemetry is evidence.

### 4. Registry capability vs recorded effort

Registry `ReasoningEffort` names are capability metadata, not proof of what a run used. `xhigh` support does not mean an unrecorded run used ExtraHigh.

### 5. Alias collapse beyond registry authority

Only aliases already proven canonically equivalent by the existing registry resolution contract may collapse. Similar display names alone are insufficient.

### 6. Pricing regression

Configuration identity is analytical. `priceSnapshot`, registry pricing precedence, legacy reconciliation, and cost formulas are outside the behavioral objective. Tests should prove they remain unchanged.

### 7. Accepted economics scope creep

Current accepted-slice economics already exists, but Slice 4 owns the richer Accepted Outcome feature. Slice 2 should not redesign lifecycle aggregation while adding configuration identity.

### 8. Slice 3 scope creep

Do not turn the existing single selected group interaction into the future 2+ multi-candidate workspace. Slice 3 owns that behavior.

## Primary tests

### `tests/metrics.test.ts`

Add/adjust focused cases for:

- grouping by Model Configuration;
- same model + different thinking -> different groups;
- same model + missing thinking -> explicit Unknown configuration state;
- model grouping still rolls configurations together;
- deterministic labels/keys.

### `tests/comparison.test.ts`

Add/adjust cases for:

- filtering by Model Configuration;
- configuration filter cohort qualification;
- model filter still includes multiple thinking levels for that model;
- Unknown thinking remains Unknown and is not matched as a known level;
- comparison request validation accepts the new dimension and rejects invalid values/keys;
- comparison export reproduces the same grouping/filter state;
- accepted-slice lifecycle economics remains unchanged by the new comparison dimension.

### `tests/compare-ui.test.tsx`

Add/adjust cases for:

- Model Configuration appears in group/filter UI;
- Astra Low and Astra XHigh are distinct visible choices/groups using real-shaped fixtures;
- Unknown configuration presentation;
- export payload contains the selected configuration context;
- existing model/thinking grouping remains usable.

### Compatibility/regression suites

Run, and change only if required:

- `tests/data.test.ts`
- `tests/registry.test.ts`
- `tests/registry-store.test.ts`
- `tests/export.test.ts`

These protect raw schema compatibility, identity resolution, frozen snapshots, persisted backfill, and export separation.

## Useful fixtures

Primary fixture files:

- `tests/fixtures.ts`
- `tests/registry-fixtures.ts`

High-value real-shaped fixture combinations should include:

- Astra Low
- Astra ExtraHigh/XHigh
- Luna Max
- Sol High
- at least one run with known model but unknown thinking
- at least one legacy/unregistered exact model identity if existing fixtures support it

Do not make a test pass by silently filling unknown thinking.

## Focused verification order

Start narrow and widen only when evidence requires it.

1. Focused deterministic tests:

   `npx vitest run tests/metrics.test.ts tests/comparison.test.ts tests/compare-ui.test.tsx`

2. If registry identity helper behavior is touched:

   `npx vitest run tests/registry.test.ts tests/registry-store.test.ts`

3. Compatibility/export checks:

   `npx vitest run tests/data.test.ts tests/export.test.ts`

4. Full repository gates:

   `npm run typecheck`

   `npm test`

   `npm run lint -- --max-warnings=0`

   `npm run build`

   `git diff --check`

5. Electron runtime QA for affected comparison UI:

   `npm run test:electron`

Keep the Electron window visible/unminimized when visible-surface interaction is active. Treat host/window-state failures separately from product defects.

6. If Issue #4 is completed in the same slice, build/package the Linux target needed to verify the AppImage visibly reports `0.1.1` from the canonical version source.

## Runtime QA scenarios

At minimum verify in the actual Electron application:

1. Load production-shaped data containing Astra Low and Astra XHigh.
2. Group by Model Configuration and confirm they appear separately.
3. Group by model and confirm both roll back under the same model identity where appropriate.
4. Filter by one configuration and verify the cohort contains only matching configuration runs/slices under the existing cohort rules.
5. Inspect a run with missing thinking and confirm it remains visibly Unknown.
6. Export the current comparison and verify the derived JSON records the active configuration grouping/filter context.
7. Restart and verify source telemetry, registry snapshots, and costs are unchanged.

## Ruled-safe areas unless evidence requires reopening

Do not spend context re-auditing these from scratch unless the implementation touches their invariants or a focused test fails:

- `src/main/store.ts` persistence/recovery machinery;
- `src/main/export.ts` filesystem destination safety;
- registry pricing history/reconciliation rules;
- pricing snapshot immutability;
- raw import transaction semantics;
- acceptance timestamp UX;
- Slice 1 backup provenance repairs;
- registry management UI;
- legacy pricing management UI.

## Explicit non-goals

- No Slice 3 multi-candidate workspace.
- No Slice 4 accepted-outcome redesign.
- No recommendation engine or winner score.
- No workload taxonomy redesign.
- No model execution/harness work.
- No registry pricing redesign.
- No historical thinking inference.
- No broad schema migration merely to persist a derived configuration identity.
- No unrelated UI cleanup.

## Expected completion report

Return:

- exact configuration identity semantics implemented;
- files/symbols changed;
- whether configuration remained derived or required persisted schema changes, with justification;
- alias/canonical-resolution behavior;
- Unknown behavior;
- data/import/export compatibility evidence;
- pricing/snapshot regression evidence;
- focused/full tests and Electron QA performed;
- Issue #4/version work performed, if any;
- Master Index surfaces that materially changed and may need reconciliation;
- git status / commit state;
- Codex telemetry footer: fresh input, cached input, output, reasoning, displayed total, worked wall time, and visible weekly usage if available.

## Known uncertainty

The exact internal shape of the derived configuration helper is intentionally not prescribed here. The implementation should choose the smallest existing-architecture-compatible seam that keeps identity semantics centralized and testable.

If current code proves that a persisted configuration field is unavoidable, stop and report why before introducing a schema migration or historical rewrite.