# Slice 6 — Telemetry Evidence Contract — Repository Context Map

Repository: `recoveryrob83-lab/PennyTel-AX`

Authoritative executable contract: GitHub Issue #15 — **Slice 6: Telemetry Evidence Contract & Schema v2**

Frozen preparation baseline: `e6a690ad26272f6236ae674595a693a95dbc544c` (`0.1.5`)

This map records repository geography only. It is a starting surface for the
slice implementation and does not duplicate the Issue contract or worker-role
instructions.

## Starting surface

Begin with the shared raw-data contract and follow its callers outward:

1. [`src/shared/types.ts`](../../src/shared/types.ts)
2. [`src/shared/fields.ts`](../../src/shared/fields.ts)
3. [`src/shared/data.ts`](../../src/shared/data.ts)
4. [`src/main/store.ts`](../../src/main/store.ts)
5. [`src/main/index.ts`](../../src/main/index.ts) and the typed preload bridge
6. raw-data/export tests and isolated Electron smoke/recovery scripts

The current raw dataset is schema v1. The accepted baseline contains no
normalized execution-source evidence object and no v1-to-v2 migration helper;
these are the principal seams to establish or extend.

## Raw schema and validation

### `src/shared/types.ts`

`Dataset` is the authoritative TypeScript envelope: five table arrays,
`schemaVersion: 1`, a nonnegative local `revision`, and optional `registry`.
`Run` is the record that currently carries model/session/time, token/meter,
pricing, test/build, intervention, and result evidence. Its existing token
semantics are consumed by the metrics and pricing layers; `priceSnapshot` is a
nested run property even though most run fields are flat.

`EntityMap`, `TABLES`, `Mutation`, `LoadedData`, `ImportPreview`, and
`PennyTelAPI` define the table/transaction/bridge interfaces used by the rest
of the application. `PennyTelAPI` also exposes the separate
`runComparisonPlan()` analysis action added in `0.1.5`; that action is not a
raw telemetry mutation.

### `src/shared/fields.ts`

The `fields` catalog describes the five editable tables and is used by
`RecordEditor` as well as validation metadata: required fields, field types,
enums, numeric bounds, relationships, and user hints. The current catalog has
no structured execution-evidence field. `priceSnapshot` is intentionally not
in the catalog and is admitted/validated as a nested exception in
`data.ts`. A nested evidence object should account for this existing split
between flat editor fields and explicit nested validation.

### `src/shared/data.ts`

This is the central schema, normalization, relationship, and transaction seam.

- `validateRecord()` rejects unknown record keys, enforces field metadata,
  nonnegative finite numbers, safe integer constraints, string limits, dates,
  timestamps, enum values, run token relationships, rate-override completeness,
  and nested `priceSnapshot` provenance.
- `validateDataset()` currently requires `schemaVersion === 1`, validates the
  envelope and registry, enforces unique IDs, same-slice links, acceptance
  boundaries, and unique legacy pricing dates.
- `mergeImport()` is the additive import/preview path. It parses bounded local
  JSON, rejects registry and derived comparison artifacts, currently requires
  schema v1, resets imported revision authority to the local transaction,
  validates incoming records and combined relationships, skips identical
  records, rejects conflicts, then snapshots/backfills newly imported runs.
- `applyMutation()` is the revision-checked save/delete/import/registry-import
  transaction builder. It clones current state, applies the operation, and
  finishes with dataset validation before `TelemetryStore` publishes it.
- `snapshotRun()` is coupled to run identity/date/rate changes and preserves or
  creates immutable historical pricing evidence. Evidence-schema work must not
  accidentally route through pricing reselection.

The same module imports registry resolution/backfill from
[`src/shared/registry.ts`](../../src/shared/registry.ts) and legacy cost lookup
from [`src/shared/metrics.ts`](../../src/shared/metrics.ts). Those are
neighboring dependencies for preserving registry identity, snapshots, and
token economics, not alternative telemetry authorities.

## Persistence and authority

### `src/main/store.ts` — `TelemetryStore`

`readFromDisk()` parses `telemetry.json` and calls `validateDataset()`; invalid
or corrupt files remain in place and do not become an empty profile.
`load()` returns a detached clone. `preview()` delegates to `mergeImport()`.
`initializeRegistry()` loads existing data and may publish the bundled
registry through the ordinary revision-checked mutation path.

`mutate()` serializes writes, applies `applyMutation()`, checks live/backup
provenance immediately before publication, rotates the previous live file to
`telemetry.backup.json`, and atomically replaces `telemetry.json`. Failed
writes retain the queue and cached authoritative state for retry. New schema
normalization must preserve this main-process authority and the existing
recovery-sensitive behavior.

Storage is under Electron `userData`, or the absolute `PENNYTEL_DATA_DIR`
override used by QA. Live and backup files are not renderer-accessible.

### IPC and preload

[`src/main/index.ts`](../../src/main/index.ts) registers main-frame-checked
handlers for `telemetry:load`, `telemetry:mutate`, `telemetry:preview`,
`telemetry:open`, `telemetry:export`, `telemetry:export-comparison`, and
`telemetry:run-comparison-plan`. Raw import is read through the main-process
file dialog with a 10 MB bound. Raw export and comparison export both use the
main-owned snapshot; the plan runner independently loads a dataset and saves
derived results through the same trusted export helper.

[`src/preload/index.ts`](../../src/preload/index.ts) is the narrow
`contextBridge` implementation. [`src/preload/index.d.ts`](../../src/preload/index.d.ts)
is the renderer-facing type declaration. `sandbox: true`, context isolation,
no Node integration, denied navigation/new windows/permissions, and the
main-frame sender checks are part of this boundary.

### `src/main/export.ts`

`writeExport()` is the shared filesystem boundary for raw datasets, ordinary
comparison analysis, and comparison-plan result bundles. It resolves the
destination, rejects regular-file/link/parent aliases of live or backup
storage, writes mode-600 temporary output, flushes it, and atomically renames
the destination. New raw export formats must continue to use this path and
must remain distinguishable from derived analysis output.

## Deterministic comparison-plan runner (accepted `0.1.5` surface)

This is the main materially new interface adjacent to Slice 6 and must not be
mistaken for telemetry ingestion.

- [`src/shared/comparison-plan.ts`](../../src/shared/comparison-plan.ts)
  owns `ComparisonPlan`, `ComparisonPlanEntry`, `ComparisonPlanResults`,
  `validateComparisonPlan()`, `parseComparisonPlan()`, and
  `executeComparisonPlan()`. It bounds plan names/IDs/entry count, rejects
  unknown plan fields, validates each embedded `ComparisonContext` through
  `validateComparisonRequest()`, and derives ordered ordinary comparison
  analyses from one `Dataset` snapshot.
- [`src/main/comparison-plan.ts`](../../src/main/comparison-plan.ts) owns the
  choose/load/save operation interface. It parses and validates before dataset
  access or the save dialog, then saves one result bundle with one source
  revision and generated timestamp.
- [`src/renderer/src/pages/Compare.tsx`](../../src/renderer/src/pages/Compare.tsx)
  supplies the `Run comparison plan` action and reports cancellation, success,
  or failure without mutating current comparison controls or telemetry.
- [`docs/comparison-plan.md`](../comparison-plan.md) is the contract-facing
  documentation for this analysis artifact. `src/shared/data.ts` explicitly
  rejects both plan inputs and plan-result bundles in telemetry import.

## Renderer/editor surfaces

- [`src/renderer/src/pages/Data.tsx`](../../src/renderer/src/pages/Data.tsx)
  displays the storage path, raw export, JSON paste/file import, preview counts,
  and explicit import confirmation.
- [`src/renderer/src/components/RecordEditor.tsx`](../../src/renderer/src/components/RecordEditor.tsx)
  is generic and field-catalog-driven for the five current tables. It keeps
  drafts local, validates before save, preserves failed drafts, and does not
  currently provide a specialized nested evidence editor.
- [`src/renderer/src/App.tsx`](../../src/renderer/src/App.tsx) owns startup
  loading/error state, detached dataset state, revision-bearing mutations, and
  page routing. It does not own persistence.
- [`src/renderer/src/components/RunTable.tsx`](../../src/renderer/src/components/RunTable.tsx)
  and [`src/renderer/src/components/ui.tsx`](../../src/renderer/src/components/ui.tsx)
  are the shared run/detail display surfaces if new structured evidence is
  made inspectable in the existing UI.

## Tests and runtime surfaces

### Deterministic unit/UI tests

- [`tests/data.test.ts`](../../tests/data.test.ts) — schema v1 validation,
  field bounds/enums, relationships, revisions, snapshots, additive import,
  conflicts, malformed/oversized input, and analysis-artifact rejection.
- [`tests/store.test.ts`](../../tests/store.test.ts) — detached reads,
  persistence, serialized/stale writers, live/backup recovery evidence,
  external-change detection, atomic replacement failure, and retry behavior.
- [`tests/registry.test.ts`](../../tests/registry.test.ts) and
  [`tests/registry-store.test.ts`](../../tests/registry-store.test.ts) —
  registry validation, identity/pricing backfill, v1 portability, and startup
  persistence coupled to run snapshots.
- [`tests/export.test.ts`](../../tests/export.test.ts) — raw, comparison, and
  plan-result safe export destinations and live/backup alias protection.
- [`tests/comparison-plan.test.ts`](../../tests/comparison-plan.test.ts) —
  strict plan shape/bounds, embedded comparison request validation, ordered
  execution, shared revision/context output, operation sequencing, and
  failure/cancellation behavior.
- [`tests/compare-ui.test.tsx`](../../tests/compare-ui.test.tsx) — Compare
  controls, export behavior, and the plan-runner UI state. Other comparison
  derivation regressions remain in [`tests/comparison.test.ts`](../../tests/comparison.test.ts)
  and [`tests/analytics.test.ts`](../../tests/analytics.test.ts).
- [`tests/fixtures.ts`](../../tests/fixtures.ts) and the registry fixtures are
  the reusable production-shaped synthetic inputs. They currently describe
  schema-v1 records and have no source-log evidence fixture.

### Electron/runtime

`package.json` defines `npm run test:electron` as a production build followed
by the real Electron scripts. Relevant existing scripts are:

- [`scripts/electron-smoke.mjs`](../../scripts/electron-smoke.mjs) — core UI,
  raw/comparison export, import, revision, and startup behavior;
- [`scripts/electron-repair-qa.mjs`](../../scripts/electron-repair-qa.mjs) —
  recovery and filesystem-safe export behavior;
- [`scripts/electron-new-profile-qa.mjs`](../../scripts/electron-new-profile-qa.mjs)
  — first-write/new-profile behavior;
- [`scripts/electron-registry-qa.mjs`](../../scripts/electron-registry-qa.mjs)
  — registry startup/update/backfill and raw round-trip;
- [`scripts/electron-configuration-qa.mjs`](../../scripts/electron-configuration-qa.mjs)
  and [`scripts/electron-accepted-outcome-qa.mjs`](../../scripts/electron-accepted-outcome-qa.mjs)
  — comparison/lifecycle regressions; and
- [`scripts/electron-comparison-plan-qa.mjs`](../../scripts/electron-comparison-plan-qa.mjs)
  — isolated-profile multi-entry plan execution, result identity/revision,
  ordinary comparison separation, and plan-result import rejection.

QA writes isolated temporary profiles/artifacts below `test-results/`; the
repository's real operator profile is not a disposable test target. The
approved/elevated Electron launch route documented in `AGENTS.md` and
`MASTER_INDEX.md` is required in fresh Codex sessions.

Packaging is configured by [`electron.vite.config.ts`](../../electron.vite.config.ts)
and [`electron-builder.yml`](../../electron-builder.yml). The registry seed is
statically imported by `store.ts`; packaged runtime does not require a
repository `docs/` directory. Build output is under `out/`.

## Documentation and neighboring contracts

- [`docs/data-contract.md`](../data-contract.md) is the current field/evidence
  dictionary and records v1 token, meter, timestamp, quality, and pricing
  semantics.
- [`docs/schema-reconciliation.md`](../schema-reconciliation.md) records the
  historical spreadsheet-to-runtime naming and semantic corrections.
- [`docs/model-registry.md`](../model-registry.md) documents registry identity,
  pricing history, snapshot immutability, and v1 portability behavior.
- [`docs/comparison-export.md`](../comparison-export.md) documents the separate
  non-importable analysis-v1 artifact and its source/context semantics.
- [`docs/comparison-plan.md`](../comparison-plan.md) documents the separate
  non-importable plan/results artifacts added in `0.1.5`.

## Hazards and extension seams

- `schemaVersion`, `validateDataset()`, `mergeImport()`, `emptyDataset()`,
  fixtures, and the Electron synthetic profiles all currently encode v1. A
  schema change must update these consistently; changing only the TypeScript
  type will not change runtime acceptance.
- Unknown record and envelope fields are rejected. The nested pricing
  exception is manually whitelisted, so nested evidence cannot be assumed to
  be covered by the flat `fields` catalog automatically.
- Main-process persistence, revision checks, atomic writes, backup provenance,
  and detached renderer reads are coupled. Read-time normalization must not
  publish a rewritten live file as a side effect of loading.
- Raw dataset export/import, comparison export, and comparison-plan results
  use different artifact identities. Derived artifacts are explicitly rejected
  by `mergeImport()`; extending that discriminator list is part of the import
  boundary whenever a new derived artifact is added.
- Existing `priceSnapshot` records are immutable historical evidence. Run
  token fields retain fresh input, additional cached input, output including
  reasoning, and reasoning-as-subset semantics. Existing usage-meter fields
  are remaining-percentage operator evidence, and should not be repurposed by
  a new source-specific meter.
- There is no raw JSONL reader, Codex adapter, cloud sync, or external telemetry
  ingestion subsystem in this repository. Incoming normalized source evidence
  must enter through the local JSON contract and the existing validation/
  import/persistence path.

## Genuine unresolved repository facts

These are implementation facts not answered by the current source geography:

1. The canonical v2 nested evidence type/name, discriminator vocabulary, and
   field-level bounds do not exist in the baseline.
2. No migration/normalization location or API exists yet for a v1 dataset;
   whether normalization is shared by disk load, preview, merge, and raw
   export must be settled while preserving the existing revision/write rules.
3. No repository code defines source-log content canonicalization or hash
   algorithm, nor how external adapter records will be supplied to the local
   import contract.
4. The current editor has no nested evidence UI, and no decision is encoded
   about whether v2 evidence is display/editable in the existing five-table
   editor or is import/export-only.
5. No current test fixture establishes partial/omitted structured evidence,
   quota-window attribution, source provenance, or execution-environment
   state. Those are genuine test-surface gaps, not evidence that the values
   are zero or absent in real source logs.
