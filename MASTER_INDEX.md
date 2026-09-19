# PennyTel repository map

Evidence-based map of the repository at accepted PennyTel `0.2.2` repository
candidate `908f67bc8b055ef94f7874339a3551f5742ebdaf`. This
is a navigation aid for future slices, not a replacement for the assigned
GitHub Issue or the authoritative contracts in `docs/`.

## Start here

- Product/runtime overview: [`README.md`](README.md)
- v2 data contract and field semantics: [`docs/data-contract.md`](docs/data-contract.md)
- Registry contract and update behavior: [`docs/model-registry.md`](docs/model-registry.md)
- Comparison analysis contract: [`docs/comparison-export.md`](docs/comparison-export.md)
- Comparison plan contract: [`docs/comparison-plan.md`](docs/comparison-plan.md)
- Accepted Slice 4 context map: [`docs/context-maps/Slice_4_Accepted_Outcome_Economics_Context_Map.md`](docs/context-maps/Slice_4_Accepted_Outcome_Economics_Context_Map.md)
- Slice 5 comparison analytics/filtering context map: [`docs/context-maps/Slice_5_Comparison_Analytics_and_Filters_Context_Map.md`](docs/context-maps/Slice_5_Comparison_Analytics_and_Filters_Context_Map.md)
- Slice 6 telemetry evidence context map: [`docs/context-maps/Slice_6_Telemetry_Evidence_Contract_Context_Map.md`](docs/context-maps/Slice_6_Telemetry_Evidence_Contract_Context_Map.md)
- Slice 7 telemetry evidence surfaces/analysis context map: [`docs/context-maps/Slice_7_Telemetry_Evidence_Surfaces_and_Analysis_Context_Map.md`](docs/context-maps/Slice_7_Telemetry_Evidence_Surfaces_and_Analysis_Context_Map.md)
- Accepted Slice 8 batch-import context map: [`docs/context-maps/Slice_8_Batch_Telemetry_Import_Context_Map.md`](docs/context-maps/Slice_8_Batch_Telemetry_Import_Context_Map.md)
- Accepted Slice 9 storage-service/SQLite context map: [`docs/context-maps/Slice_9_Storage_Service_SQLite_Projection_Context_Map.md`](docs/context-maps/Slice_9_Storage_Service_SQLite_Projection_Context_Map.md)
- Accepted Slice 10 canonical-artifact/publish-recovery context map: [`docs/context-maps/Slice_10_Canonical_JSON_Artifact_Store_Publish_Recovery_Context_Map.md`](docs/context-maps/Slice_10_Canonical_JSON_Artifact_Store_Publish_Recovery_Context_Map.md)
- Accepted Slice 11 legacy-migration/canonical-production-cutover context map: [`docs/context-maps/Slice_11_Legacy_Dataset_Migration_Canonical_Production_Cutover_Context_Map.md`](docs/context-maps/Slice_11_Legacy_Dataset_Migration_Canonical_Production_Cutover_Context_Map.md)
- Accepted Slice 12 pennyReporter integration/adoption context map: [`docs/context-maps/Slice_12_Reporter_Integration_Adoption_Context_Map.md`](docs/context-maps/Slice_12_Reporter_Integration_Adoption_Context_Map.md)
- Accepted Slice 13 Codex receipt-discovery/reviewed-import context map: [`docs/context-maps/Slice_13_Codex_Receipt_Discovery_Reviewed_Run_Import_Context_Map.md`](docs/context-maps/Slice_13_Codex_Receipt_Discovery_Reviewed_Run_Import_Context_Map.md)
- S13 architecture escalation report: [`pennyos/worker-reports/S13/S13_Architecture_Escalation_01.md`](pennyos/worker-reports/S13/S13_Architecture_Escalation_01.md)
- pennyReporter consumer contract and S13 handoff: [`docs/pennyreporter-integration.md`](docs/pennyreporter-integration.md)
- Historical schema reconciliation: [`docs/schema-reconciliation.md`](docs/schema-reconciliation.md)
- Canonical registry input: [`docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json`](docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json)
- Runtime/verification record: [`docs/verification.md`](docs/verification.md) and [`docs/bounded-repair-verification.md`](docs/bounded-repair-verification.md)

Slice-specific repository maps live under [`docs/context-maps/`](docs/context-maps/).
The assigned GitHub Issue is the executable slice contract and points to its
companion map. `AGENTS.md` owns worker-role behavior. Start from the companion
map and use this master index when broader repository geography is needed.

## Factory reporting integration

- PennyTel consumes the independently installed `pennyReporter` CLI; Reporter implementation remains owned by the sibling `PennyOS-Reporter` repository and is not vendored into PennyTel.
- Canonical project/slice identity remains tracked in `pennyos/project.json` and `pennyos/slices/<sliceId>.json`. pennyReporter derives identity from those files rather than accepting caller overrides.
- Worker-close receipts are local workflow evidence under `.pennyos/runtime/receipts/`. `.gitignore` ignores `.pennyos/runtime/` while leaving tracked `pennyos/` identity visible to Git.
- The canonical worker-close protocol is `PENNYOS_TURN_REPORT_V1`. Workers invoke pennyReporter and copy its generated block verbatim as the terminal block of their final response; hand-authored receipt IDs or blocks are non-authoritative.
- Reporter receipts do not directly become PennyTel telemetry. Accepted S13 pairs a validated receipt and exact final terminal report with independently sourced Codex rollout evidence, presents a sanitized operator review, and only then publishes the approved Run through ordinary PennyTel mutation.
- Consumer-side receipt validation/matching uses pennyReporter's public `validateReceipt` and `matchTerminalBlockToReceipt` seam; PennyTel should not reimplement the protocol.

## Runtime ownership and boundaries

### Electron main process

- [`src/main/index.ts`](src/main/index.ts) is the Electron entry point. It
  selects `PENNYTEL_DATA_DIR` as the Electron `userData` directory when set,
  sets the app identity, takes a single-instance lock, creates the main
  `BrowserWindow`, and loads the dev renderer URL or packaged
  `renderer/index.html`.
- The window is configured with `sandbox: true`, `contextIsolation: true`,
  and `nodeIntegration: false`. Navigation, new windows, and permission
  requests are denied.
- The main process registers the only application IPC handlers:
  `telemetry:open-batch`, `telemetry:commit-batch`, `telemetry:load`,
  `telemetry:mutate`, `telemetry:preview`, `telemetry:open`, `telemetry:export`,
  `telemetry:export-comparison`, `telemetry:run-comparison-plan`, and the narrow Codex-intake discover/commit channels. Each handler checks that the caller is the
  primary window's main frame before acting.
- [`src/main/batch-import.ts`](src/main/batch-import.ts) owns bounded recursive discovery of `.pennytel.json` batch artifacts in an operator-selected folder, including containment/stability checks and file/count/depth/byte limits. It does not own persistence.
- [`src/main/codex-intake.ts`](src/main/codex-intake.ts) owns S13's operator-triggered Codex receipt/rollout intake boundary. It validates project-local pennyReporter receipts through the installed Reporter protocol, enumerates only fixed active/archive Codex roots, performs bounded streaming rollout capture, reduces receipt authority monotonically (`none -> unique -> multiple`), freezes the first valid closure's measured Run, seals a bounded commit-time authority observation, and shares one eligibility evaluator between discovery and commit. Raw rollout content remains main-process-only and transient.
- [`src/main/production-store.ts`](src/main/production-store.ts) is the normal
  PennyTel production storage facade. It admits startup authority deterministically,
  migrates a valid legacy live Dataset once into canonical JSON artifacts, preserves
  exact legacy live and backup bytes in archive evidence, and records restart-safe
  migration state. After canonical publication is verified, legacy files are archive
  or recovery evidence only and receive no application writes. `load()`, registry
  initialization, preview, mutation, batch import, raw export, comparison reads, and
  comparison-plan reads all use canonical artifacts through this facade.
- [`src/main/store.ts`](src/main/store.ts) remains the bounded legacy
  `TelemetryStore` reader/compatibility implementation. Its `telemetry.json` and
  `telemetry.backup.json` paths are migration input or preserved evidence; normal
  production composition no longer routes writes through this store.
- [`src/main/storage-files.ts`](src/main/storage-files.ts) owns the fixed production
  storage and migration filesystem geography. `StorageFiles` pins absolute directory
  identity, rejects ancestor or entry links, bounds direct-child names, preserves
  exact evidence bytes, and provides checked atomic moves and durable directory/file
  synchronization for legacy archives, migration receipts, and projection recovery;
  `ProductionStore` uses the same admission surface to distinguish a genuinely new
  profile from unresolved legacy or rejected-projection evidence.
- [`src/main/production-projection.ts`](src/main/production-projection.ts) adapts the
  SQLite repository for normal production. It opens or rebuilds projection state only
  after canonical authority admission and canonical-driven reconciliation, quarantines
  safely replaceable invalid databases and SQLite sidecars as recovery evidence, and
  fails closed for unsafe identities. Projection contents never establish authority
  or initialize a new profile.
- [`src/main/index.ts`](src/main/index.ts) composes one `ProductionStore` for the
  Electron app. Existing IPC, preload, and renderer channel semantics remain in
  place while normal load, preview, mutation, import, export, and comparison paths
  use the canonical production facade.
- [`src/main/storage-service.ts`](src/main/storage-service.ts) defines the
  main-process `PennyTelStorageService` and replaceable
  `DatasetProjectionRepository` boundary. `MainProcessStorageService` validates
  and detaches Dataset values before delegating to an adapter; driver details
  stay below this service/repository seam. `ProductionStore` uses this service
  only for the rebuildable downstream projection after canonical admission.
- [`src/main/sqlite-projection.ts`](src/main/sqlite-projection.ts) implements
  the `node:sqlite` `SqliteProjectionRepository` behind that seam. It is a
  rebuildable SQLite projection, not canonical persistence: canonical JSON
  artifacts remain the normal production authority, and normal startup/load/
  mutate use SQLite only as a downstream projection. `TelemetryStore` and
  `telemetry.json` remain bounded legacy migration/compatibility surfaces. The
  adapter admits only its
  deterministic application identity/schema version and exact expected schema;
  it refuses forged foreign identities, unsupported/future versions, ambiguous
  unversioned files, and structural mismatches. Its STRICT five-table schema
  stores canonical record JSON plus only query-supporting relational fields,
  foreign keys, and indexes, with verified WAL, foreign keys, NORMAL
  synchronous mode, `trusted_schema=OFF`, and a 500 ms busy timeout.
- [`src/main/canonical-artifacts.ts`](src/main/canonical-artifacts.ts) defines
  the version-1 self-describing canonical record and dataset envelopes. Record
  and dataset contents, validated stable IDs, and dataset metadata carry
  semantics; folder placement remains organizational. Record paths use a
  table-specific prefix plus a deterministic SHA-256 of the UTF-16 code units
  of the stable ID, preserving distinct valid IDs including lone surrogates and
  escape-prefixed IDs.
- [`src/main/canonical-artifact-store.ts`](src/main/canonical-artifact-store.ts)
  is the main-process canonical JSON store and publish coordinator. It sits above
  `PennyTelStorageService`: canonical artifacts are normal production authority and
  SQLite is a rebuildable downstream projection. Its S11 `inspectStartup()` performs
  read-only canonical layout, receipt, and source consistency admission before
  mutating S10 `recover()` is allowed to clean work, finish publication, or reconcile
  the projection. S10 durable pending receipts, metadata-last publication, staged
  artifacts/tombstones, and idempotent recovery remain the publication authority.
- The projection adapter owns bounded synchronous replacement/load transactions
  and rollback, preserves Dataset revision, nested evidence, registry state,
  optional-field Unknown semantics, and historical snapshots, and reconciles
  redundant relational columns against each JSON record during reconstruction.
  It enforces 50,000 records and 10,000,000 serialized/payload bytes, checks
  physical counts and measured payload rather than trusting metadata, and
  reconstructs through the shared normalization/validation path. It requires
  an absolute service-owned path, so projection databases remain main-process
  only and outside ASAR/application resources.
- [`src/main/export.ts`](src/main/export.ts) is the main-process file-writing
  boundary for both raw dataset and derived comparison exports. It protects the
  canonical artifact root, projection database and sidecars, migration receipts and
  legacy archive/evidence paths as a live storage surface, then uses an atomic
  destination replacement.

### Preload bridge

- [`src/preload/index.ts`](src/preload/index.ts) exposes exactly one typed
  `window.pennytel` API through `contextBridge`: open/commit batch import, load,
  mutate, preview/open single import, export dataset, export comparison, run
  comparison plan, and sanitized Codex-intake discover/commit operations.
- [`src/preload/index.d.ts`](src/preload/index.d.ts) supplies the renderer's
  global `Window.pennytel` type. There is no generic IPC or filesystem API in
  the renderer.

### Renderer

- [`src/renderer/src/main.tsx`](src/renderer/src/main.tsx) mounts React in
  `StrictMode` and imports the application stylesheet.
- [`src/renderer/src/pages/Data.tsx`](src/renderer/src/pages/Data.tsx) now includes the S13 Codex-intake review surface. It can trigger main-process discovery, display only sanitized receipt/Run/evidence coverage and blocked reasons, and explicitly commit an eligible preview token; it never receives raw Codex rollout contents or generic filesystem authority.
- [`src/renderer/src/App.tsx`](src/renderer/src/App.tsx) loads the main-owned
  snapshot, holds page/selection/modal state, routes mutations with the
  loaded dataset revision, and coordinates the page components and shared
  editors/details. Startup errors remain a non-writable error state; there is
  no browser-storage fallback. It imports the canonical package version and
  displays it in the sidebar/header so UI version routing stays aligned with
  the main-process comparison export metadata. Delete notices report that the
  canonical save completed and make no legacy backup claim.
- Renderer code receives a `Dataset` snapshot and asks the preload API for
  mutations. It does not become authoritative for persistence or pricing
  snapshots.

## Domain, schema, and data flow

- [`src/shared/types.ts`](src/shared/types.ts) defines the current v2 envelope and
  domain records:
  `Dataset` contains `schemaVersion`, `revision`, five arrays (`slices`,
  `runs`, `findings`, `discoveries`, `pricing`), and optional `registry`;
  `Slice`, `Run`, `Finding`, `Discovery`, `Pricing`, `PriceSnapshot`,
  `Mutation`, and `PennyTelAPI` are the central types. `Run.executionEvidence`
  is the optional structured execution-source evidence relationship; it is
  attached to a run rather than promoted into separate tables or semantic
  workflow fields.
- [`src/shared/fields.ts`](src/shared/fields.ts) is the shared field catalog
  for editor rendering and record validation metadata. It also defines table
  names, relationships, required fields, numeric bounds, enums, and user
  hints. Execution evidence is a nested run exception, so its shape is owned
  by `execution-evidence.ts` and `data.ts`, not flattened into this catalog.
- [`src/shared/execution-evidence.ts`](src/shared/execution-evidence.ts) owns
  the normalized `codex-rollout` evidence format (format version 1), source
  provenance, session/turn/runtime metadata, context occupancy, quota-window,
  and execution-environment types plus strict bounded nested validation. It
  accepts normalized metrics/provenance only; raw rollout payloads remain
  external source evidence.
- [`src/shared/data.ts`](src/shared/data.ts) is the transaction and ingestion
  boundary:
  `validateRecord` and `validateDataset` enforce the canonical v2 shape, types, IDs,
  timestamps, snapshot provenance, relationships, acceptance constraints, and
  legacy pricing uniqueness;
  `normalizeDataset` is the explicit detached v1 compatibility path: it
  validates the original v1 envelope/records and changes only
  `schemaVersion: 1` to `2`, preserving IDs, relationships, omissions,
  registry data, and historical price snapshots;
  `mergeImport` accepts one v1/v2 input, normalizes before relationship checks,
  skips identical records, rejects conflicts, checks relationships, and backfills new runs;
  `mergeBatchImport` validates named sources as one combined additive dataset,
  resolves cross-file relationships independent of file ordering, preserves duplicate/conflict semantics, and attributes failures to source paths;
  `applyMutation` handles save/delete/import/batch-import/registry-import and increments
  the dataset revision;
  `snapshotRun` is the main-process pricing snapshot selector. The same file's
  `PennyTelAPI` type includes the analysis-only `runComparisonPlan` bridge.
- Record relationships are intentionally same-slice: runs belong to slices;
  findings and discoveries may link to runs in their own slice; referenced
  slices/runs cannot be deleted until their children/links are removed.
- Unknown values are represented by omitted optional fields. `false` and `0`
  are meaningful recorded values, not unknowns.
- [`docs/data-contract.md`](docs/data-contract.md) is the navigational field
  and ingestion reference. It documents the corrected v1 conventions:
  fresh versus additional cached input, reasoning as a subset of output,
  numeric quality 1–5, remaining-meter readings, and Yes/No/Deferred adoption.

## Persistence, recovery, import, and export

### `ProductionStore` and S11 migration

- `ProductionStore.start()` admits the profile through a read-only state machine:
  legacy live/backup, migration receipt, archive, and projection-recovery evidence are
  validated first; canonical authority is then inspected read-only before mutating
  recovery or projection reconciliation. A valid legacy live Dataset is accepted as
  migration input only when that authority state is legal; a genuinely empty profile
  may initialize canonical state, while backup-only, malformed, unsafe, contradictory,
  orphaned, or projection-only evidence fails closed without guessing an authority.
- The migration receipt `legacy-migration.json` records the exact SHA-256 identity of
  `telemetry.json` and optional `telemetry.backup.json`. `legacy-migration.next.json`
  makes receipt publication restart-safe. Canonical publication and semantic reload
  are verified before the live and backup files move to
  `telemetry.legacy-archive.json` and `telemetry.backup.legacy-archive.json`.
  Archive bytes remain exact and archived legacy files are never promoted back to
  production authority.
- Migration recovery accepts only legal receipt transitions and matching file
  identities. Changes to legacy evidence, receipts, canonical targets, or retirement
  state preserve the evidence and block startup. Registry seeding after migration or
  on a new profile uses the ordinary canonical `mutate()` path.
- `load()`, `initializeRegistry()`, `preview()`, and `mutate()` are queue-serialized
  over one canonical store instance. `mutate()` retains revision checks and the
  shared `applyMutation`/import semantics through `CanonicalArtifactStore`; returned
  `LoadedData.path` identifies the canonical artifact directory.

### `TelemetryStore`

Important symbols in [`src/main/store.ts`](src/main/store.ts):

- `readFromDisk()` remains the bounded migration/compatibility reader: it reads and
  validates `telemetry.json`, preserves the existing files on failure, decodes UTF-8
  with fatal error handling, and runs `normalizeDataset()` for v1/v2 compatibility.
- Exact live/backup byte identity and legacy recovery semantics are admitted by
  `ProductionStore` before canonical publication. `TelemetryStore` is not the normal
  production write authority after S11.
- `requireNewProfile()` distinguishes a genuinely empty profile from late
  live/backup appearance and blocks unsafe writes.
- Its registry and mutation methods remain available for legacy tests and bounded
  compatibility paths. Normal production registry initialization now installs the
  bundled seed through `ProductionStore` and canonical `mutate()`.
- `mutate()` queues operations, applies the validated mutation to detached
  state, rechecks legacy provenance, rotates the prior live revision to
  `telemetry.backup.json`, then atomically replaces the live file. This remains the
  legacy compatibility behavior and is not reachable from normal post-cutover
  production writes.
- `atomicWrite()` writes a unique mode-600 temporary file, flushes it, and
  renames it into place. The queue is retained after failures so a later
  operation can retry without publishing the failed candidate.

Storage files are in the Electron app-data directory by default, or the absolute
directory named by `PENNYTEL_DATA_DIR`. Canonical artifacts, projection state,
migration receipts, and legacy archive evidence remain outside ASAR. A live file with
any backup evidence is treated as recovery-sensitive; a missing live file plus backup
evidence blocks loading/writing rather than silently starting empty.

### SQLite projection (S9, extended by S10 and S11)

- The SQLite projection file is `pennytel-projection.sqlite`, created by
  [`src/main/sqlite-projection.ts`](src/main/sqlite-projection.ts) in an
  absolute isolated user-data/QA directory. It is a rebuildable relational
  projection under canonical production authority, not a second source of truth
  or a migration authority.
- `SqliteProjectionRepository` uses deterministic application/schema admission,
  STRICT tables for the five current Dataset arrays, relationship foreign keys,
  query indexes, and JSON retention for fields that do not need relational
  querying. `replace()` writes the complete normalized snapshot in one
  `BEGIN IMMEDIATE` transaction; failed writes roll back without publishing a
  partial projection. `load()` uses a read transaction and fails closed on
  missing metadata, non-contiguous rows, forged metadata, physical over-limit
  data, invalid JSON, relational/JSON divergence, or serialized-size mismatch.
- Relational identity columns and foreign-key values pass through the local
  `projectionIdentity()` encoding for valid IDs that SQLite's binding would
  alias, including lone UTF-16 surrogates and IDs beginning with the escape
  prefix. The original JSON/domain IDs remain unchanged; encoded values are
  implementation details of the projection and are never canonical identity.
- [`src/main/sqlite-projection-qa.ts`](src/main/sqlite-projection-qa.ts) is a
  separate Electron main entry for durable adapter evidence. It exercises
  representative create/restart round trips, known-zero versus omitted
  telemetry, nested evidence, registry reconstruction, connection settings,
  and an outside-ASAR path. S10 extends the same entry with canonical artifact
  publication interruption and restart recovery; S11 extends it with legacy
  migration/archive, startup refusal, projection quarantine/rebuild, canonical
  mutation, and no-dual-write evidence. [`scripts/electron-storage-qa.mjs`](scripts/electron-storage-qa.mjs)
  runs those phases in an isolated temporary directory for built and packaged
  Electron, then checks packaged restart behavior, writable artifact paths
  outside ASAR, and the unchanged renderer
  sandbox/context-isolation/no-node-integration and preload API boundary.

### Canonical JSON artifact store (S10, production authority used by S11)

- `CanonicalArtifactStore` validates the current Dataset through the shared
  validation/normalization path, bounds record and byte work, and publishes a
  coherent artifact set under an absolute writable `canonical-artifact-store`
  root. The dataset metadata artifact records revision, registry state, and the
  ordered stable IDs for each table; individual record artifacts retain the
  full validated record.
- A publish first writes and flushes staged artifacts and a durable pending
  receipt, then applies direct-root artifact renames and tombstoned deletes,
  publishes dataset metadata last, projects the resulting canonical Dataset to
  SQLite, and clears the receipt. Root/layout identity is revalidated before
  pathname-sensitive writes and between publish phases. The flattened layout
  reduces the replaceable nested-parent risk, while the narrow portable
  pathname check-to-kernel-use race remains an explicit limitation.
- `inspectStartup()` is the S11 read-only admission step. It checks canonical root
  identity, pending receipt shape/state, and any supplied legacy migration Dataset
  before S10 recovery is allowed to remove work, complete publication, or project.
- Recovery is receipt-driven and idempotent. Prepared transactions are checked
  against the prior canonical state and discarded; publishing or published
  transactions finish canonical publication, verify the canonical digest, and
  reproject before clearing durable state. Missing or contradictory artifacts,
  unsafe substitutions, or projection-only state fail closed rather than
  inferring authority. `ProductionStore` owns the surrounding legacy migration,
  retirement, normal IPC composition, and safe projection-open/rebuild path; the
  canonical store remains the single artifact publication/recovery authority.

### Import and export paths

- Native single-file import uses `src/main/index.ts`'s open-file dialog, a 10 MB limit, and
  `ProductionStore.preview()`/`mergeImport()` before the renderer confirms the
  additive transaction.
- Batch import uses the main-process folder picker plus `discoverBatch()` to find only bounded `.pennytel.json` artifacts, previews the combined source set through `mergeBatchImport()`, then consumes one opaque preview token and publishes through one revision-checked `ProductionStore.mutate({ kind: 'batch-import', ... })` transaction. Identical records skip; conflicting stable IDs or invalid relationships fail closed without partial publication.
- Raw dataset import accepts `schemaVersion: 1` or `2`, normalizes v1 before
  additive merge/relationship validation, and ignores imported revisions in
  favor of the local transaction revision. Registry seed JSON and comparison-
  analysis JSON are explicitly rejected from telemetry import.
- Batch commit, raw dataset export, comparison export, and comparison-plan reads use
  the same canonical `ProductionStore` snapshot and mutation authority. Raw dataset
  export reads the main-owned canonical snapshot and always emits schema v2.
  Comparison export is a distinct derived artifact with
  `kind: "pennytel-comparison"` and is not importable. Slice 5 adds bounded
  filter context and shared analytics to that derived artifact without
  changing raw dataset import/export semantics.
- `sourceLog.contentHash` is validated as a SHA-256 representation of exact
  external source-file bytes; PennyTel neither reads external logs nor stores
  raw JSONL, prompts, instructions, reasoning, source excerpts, tool commands,
  tool output, or arbitrary message text in the normal dataset.
- [`src/shared/comparison-plan.ts`](src/shared/comparison-plan.ts) validates and
  executes declarative comparison plans against one loaded dataset snapshot;
  [`src/main/comparison-plan.ts`](src/main/comparison-plan.ts) owns the
  choose/load/save orchestration. Plan inputs and result bundles are analysis
  artifacts, not telemetry, and `mergeImport()` rejects both kinds.
- [`docs/comparison-plan.md`](docs/comparison-plan.md) documents the current
  plan/results shape and the authority/security boundary. The runner embeds
  ordinary comparison analyses and remains separate from raw dataset
  export/import.
- [`docs/comparison-export.md`](docs/comparison-export.md) documents the
  additive analysis-v1 configuration, date/outcome filter, and analytics
  dimensions, including identity-key versus presentation-label semantics.
  Comparison export receives only revision and context from the renderer; the
  main process derives the view from its own snapshot and records the package
  app version.
- `writeExport()` resolves aliases and protected identities, rejects live or
  backup destinations and unsafe filesystem identities, writes through a
  temporary file, and atomically replaces a regular destination.

## Model Registry and pricing

### Registry model

- [`src/shared/registry.ts`](src/shared/registry.ts) defines the registry
  graph: makers, providers, models, provider offers, benchmarks, and dated
  pricing histories. It also defines `ReasoningEffort`, statuses, provider
  types, and `ModelRegistry`.
- `validateRegistry()` is strict and recursive: it rejects unknown fields,
  invalid references, duplicate IDs/offers/dates, malformed dates, invalid
  context/reasoning/modalities/benchmark data, and invalid exclusive pricing
  intervals. `parseRegistry()` applies the size and JSON parsing boundary.
- `identityCandidates()` and `resolveIdentity()` match stable IDs first and
  then exact case-insensitive canonical/API/alias/provider names. Ambiguous
  identity, missing provider evidence, and unknown explicit IDs remain
  unresolved rather than guessed.
- `pricingReference()` chooses `run.startAt`'s UTC date, then
  `run.pricingReferenceDate`, then `slice.startDate`.
  `priceAt()` chooses the newest covering history row, with `effectiveTo`
  exclusive.
- `registrySnapshot()` records registry model/provider/offer IDs, registry
  revision, reference date and source, effective date, rates, and source text
  into a frozen run snapshot.
- `backfillRegistry()` attaches stable IDs and prices only to eligible
  unresolved runs; it does not replace an existing snapshot.
- `reconcileLegacyPricing()` keeps the legacy `pricing` rows readable and
  preserved, migrates only safe historical gaps, records legacy IDs/source
  provenance, and lets authored registry history own dates from its first
  authored entry onward.

The bundled seed is statically imported by `src/main/store.ts` for legacy
compatibility and by `src/main/production-store.ts` for normal canonical
production initialization from
[`docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json`](docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json), so packaged runtime does not require a repository `docs/` directory. A registry update replaces the installed registry document but must retain model/provider identities referenced by existing runs; retirement is supported where deletion would break provenance.

### Legacy catalog and cost

- [`src/shared/metrics.ts`](src/shared/metrics.ts) contains the legacy exact
  model/provider/date lookup in `applicablePrice()`, complete-cost checks in
  `costIssues()`, and the cost formula in `runCost()`:
  `(fresh input × input rate + cached input × cached rate + output × output rate) /
  1,000,000`.
- `snapshotRun()` in `src/shared/data.ts` gives explicit all-three-rate
  overrides highest correction authority, then registered identity/pricing,
  then exact legacy catalog lookup only when the registered path does not
  apply. Existing snapshots survive note/token edits and catalog/registry
  changes unless pricing identity/date/rates are deliberately corrected.
- Reasoning tokens are validated as no greater than output and are never
  charged separately. Missing tokens/rates/snapshots make cost unknown;
  explicit zero remains a known value. Registry cache-write metadata is
  retained but no cache-write token charge is inferred because the telemetry
  schema has no such measurement.
- [`src/renderer/src/pages/Registry.tsx`](src/renderer/src/pages/Registry.tsx)
  validates and previews complete registry documents, displays model metadata,
  offers, pricing, benchmarks, context, capabilities, and modalities, then
  delegates installation to the main mutation path.
- [`src/renderer/src/pages/Pricing.tsx`](src/renderer/src/pages/Pricing.tsx)
  edits the retained legacy catalog, shows reconciliation status and snapshot
  counts, and explains that registered offers take precedence.

## Metrics, comparison, and aggregation

- [`src/shared/metrics.ts`](src/shared/metrics.ts) is the deterministic
  calculation layer:
  `runMinutes()` prefers operator wall minutes over timestamp elapsed time;
  `usageBurn()` handles explicit burn, resets, replenishment/increases, and
  unknown readings;
  `cacheRatio()` and `summarize()` calculate token-weighted cache coverage and
  partial aggregate coverage;
  `roleSummary()` preserves unknown role burden instead of displaying an
  all-unpriced role as zero;
  `acceptanceRuns()` includes runs starting by acceptance plus undated runs;
  `timeToAccepted()` uses an operator measurement or first recorded run start;
  `groupRuns()` supports derived `modelConfiguration`, `canonicalModel`, and
  `modelFamily` dimensions, plus recorded provider/provider ID, saved offer ID,
  stage, runtime-tested, result, project, ambiguity, risk, disposition, and
  quality-grade dimensions, exact nested `evidenceSourceKind` and
  `runtimeVersion`, in addition to model, thinking, role, slice, candidate,
  workflow, session/context, local hour, and weekday groupings. Missing recorded
  evidence uses bounded keyed identities and remains distinct from literal
  source text such as `Unknown`.
- [`src/shared/analytics.ts`](src/shared/analytics.ts) is the shared
  descriptive-analytics layer. `distribution()` reports mean, median, min,
  max, sample standard deviation, and known/unknown coverage; `runAnalytics()`
  adds cost composition, wall-time, reasoning-share, and source run IDs;
  `executionEvidenceAnalytics()` adds independent source-kind attachment and
  runtime-version coverage plus TTFT, model-invocation, tool-call, peak-input,
  and paired peak-context-utilization distributions; `temporalAnalytics()`
  groups recorded run starts by UTC calendar day and retains undated IDs and
  paired time/cost points. These results are consumed by both the Compare UI,
  ordinary comparison export, and comparison-plan results.
- [`src/shared/configuration.ts`](src/shared/configuration.ts) owns the shared
  derived comparison identity path. `modelIdentity()` uses a valid recorded
  registry model ID first, otherwise the existing evidence-based
  `resolveIdentity()` rules; unresolved IDs and exact recorded model text stay
  distinct rather than being guessed into a registered identity.
  `modelConfiguration()` combines that canonical-or-unresolved model identity
  with the recorded `Run.thinking` value. Missing thinking is displayed as
  `Unknown` and is never inferred from registry capabilities. Recorded
  `ExtraHigh` remains the raw/key value and is presented as `ExtraHigh / XHigh`.
  `derivedRunIdentity()` and `derivedRunLabels` also define the canonical-model
  rollup and exact recorded-family dimension.
- `derivedPresentationLabels()` gives dataset-wide, deterministic collision-safe
  operator labels (including ordinal suffixes where necessary). Labels are not
  identities: derived JSON keys are used for grouping, filtering, selected
  evidence, and export. `MAX_DERIVED_IDENTITY_LENGTH` gives derived keys a
  bounded request-validation budget without changing ordinary source-field
  limits.
- [`src/shared/comparison.ts`](src/shared/comparison.ts) is the comparison
  orchestration layer:
  `runFilterIdentity()`/`runFilterOptions()` share the configuration derivation
  and keyed presentation options with the renderer; `selectCohort()` compares
  derived filter keys as well as source fields;
  `ComparisonContext` additionally carries bounded UTC run-start `dateRange`
  and accepted-outcome `outcomeFilters`; recorded filters include provider,
  saved offer ID, runtime-tested, result, exact execution-evidence source kind,
  and exact runtime/Codex version alongside the existing source and derived
  dimensions. `selectCohort()` applies all active run conditions to the same run
  and keeps accepted-outcome qualification separate from lifecycle reopening;
  `compareDataBase()` derives group summaries, analytics, temporal data,
  accepted aggregates, coverage-aware evidence, findings, validated
  discoveries, and accepted economics; `applyComparisonSelection()` then adds
  ephemeral candidate/group selection for the full `compareData()` view;
  `selectedCandidates` is a separate bounded collection of canonical Model
  Configuration keys, independent of ordinary filters and `selectedGroup`;
  `stageScopes` match exact recorded structured roles (`Implementer`, `Critic`,
  `Repair`) or exact `runType` text, with multiple scopes ORed together and
  combined with ordinary filters on the same run;
  `modelConfiguration` is the default Compare grouping while `canonicalModel`,
  `modelFamily`, existing exact `model`, and `thinking` preserve useful rollups;
  `acceptedAnalytics()` counts each accepted slice once, groups exact recorded
  role/runType stages, preserves complete-versus-partial outcome coverage, and
  keeps known full-lifecycle cost separate from complete per-outcome
  distributions; `validateComparisonRequest()` bounds the date/outcome and
  recorded/derived filter state plus limits of eight candidates and sixteen
  stage scopes; `comparisonExport()` derives the same analytics, temporal, and
  accepted-aggregate view in the main process from current authoritative
  dataset state after checking the request revision and emits a reproducible
  non-importable analysis object. Comparison-plan execution embeds the same
  evidence analytics, filter/group context, and conventions for each ordered
  result, preserving ordinary-export parity.
- Defect counts exclude dismissed findings and observations but preserve
  repaired defects. Findings attribute discovery to a linked run, not blame to
  a model. Validated autonomous discovery requires
  `selfInitiated === true`, `inPrompt === false`, and `validation === "Yes"`.
- Accepted-slice cost includes every relevant role/candidate run in the
  acceptance window, including undated runs. Missing acceptance time means all
  runs are included and the UI marks that boundary as unknown. A run crossing
  acceptance is rejected by dataset validation.
- `comparisonMetrics()` and `runEvidence()` expose coverage for numeric and
  categorical evidence. Unknown, known zero, partial, and empty measurements
  remain distinguishable in both UI and analysis JSON. Reasoning tokens remain
  a subset of output and are not separately billed.
- Analytics remains descriptive evidence: distributions use known measurements,
  cost composition uses the fully priced subset, date trends use recorded UTC
  starts without zero-filling missing days, and quality/cost points require
  paired recorded evidence. No confidence, causal, or combined-winner score is
  derived.
- `acceptedEconomics()` derives Slice 4 accepted-outcome evidence while
  preserving full-lifecycle behavior: cohort filters and stage scopes qualify
  a slice, then economics reopen its full relevant same-slice lifecycle.
  `outcome` exposes exact stage composition, acceptance/evidence gaps,
  conservative first-pass `Yes`/`No`/`Unknown`, explicit-link-aware repair
  burden, paired reasoning/output share, runtime evidence, sample count, and
  source run IDs. Candidate selection does not narrow accepted economics.
- No automated ranking, blended quality score, causal claim, or blame inference
  is implemented.

## Renderer pages and shared components

- [`src/renderer/src/pages/Slices.tsx`](src/renderer/src/pages/Slices.tsx)
  provides the slice notebook list/search/disposition filter and slice detail
  tabs for runs, findings, discoveries, and provenance. It shows cost/time,
  repair and critic burden, acceptance, quality, meter burn, and linked
  evidence.
- [`src/renderer/src/pages/Compare.tsx`](src/renderer/src/pages/Compare.tsx)
  owns comparison view controls: group-by, sort, cohort filters, separate
  multi-candidate Model Configuration selection, exact stage scopes, group
  selection, side-by-side observed-run evidence, accepted-outcome economics,
  date-range and accepted-outcome filters, evidence-source-kind and
  runtime-version filters/groups, and comparison export. It computes a shared
  base view before applying ephemeral candidate/group selection.
  [`src/renderer/src/components/AnalyticsWorkspace.tsx`](src/renderer/src/components/AnalyticsWorkspace.tsx)
  renders the shared descriptive statistics, cost composition, time/reasoning
  bars, source-linked SVG scatter plots, UTC cost trend, accepted aggregates,
  lifecycle stage composition, quality/cost points, and evidence distributions
  with independent coverage. Accepted outcomes expose summary rows plus expandable
  lifecycle stages, token/reasoning evidence, runtime coverage, repair evidence,
  and source runs. It defaults to Model Configuration and uses shared keyed
  options so collision-safe labels remain stable through filtering and export.
- [`src/renderer/src/components/ExecutionEvidenceDetails.tsx`](src/renderer/src/components/ExecutionEvidenceDetails.tsx)
  is the selected-run modal's read-only structured evidence surface. It renders
  normalized provenance, session/runtime identifiers, TTFT, invocation/tool
  counts, paired context occupancy/utilization, quota snapshots/attribution,
  and environment constraints as inert text; absent and partial values remain
  visibly Unknown and raw payloads are not exposed.
- [`src/renderer/src/pages/Data.tsx`](src/renderer/src/pages/Data.tsx) shows
  the canonical artifact storage path, exports raw JSON, accepts pasted/file JSON,
  previews counts and skips, and commits only after the user confirms. Its storage
  copy explains canonical JSON artifacts, preserved migrated legacy archive evidence,
  and separate operator exports; it no longer describes `telemetry.backup.json` as
  the live previous-revision mechanism. It presents the v2 import contract while
  explaining automatic v1 normalization and v2 raw exports.
- [`src/renderer/src/components/RecordEditor.tsx`](src/renderer/src/components/RecordEditor.tsx)
  is the generic field-driven editor for all five tables. It keeps drafts
  local, validates before save, preserves failed drafts, and requires explicit
  discard for dirty forms. Run records additionally expose an optional
  normalized execution-evidence JSON section; blank clears the relationship to
  Unknown, ordinary edits preserve it, and evidence edits use the same main
  validation/persistence path without changing the pricing snapshot.
- [`src/renderer/src/components/AcceptanceTime.tsx`](src/renderer/src/components/AcceptanceTime.tsx)
  handles local date/time conversion, exact ISO-with-timezone correction,
  daylight-saving ambiguity/nonexistence feedback, clear, and one-time
  `Accept now` behavior.
- [`src/renderer/src/components/RunTable.tsx`](src/renderer/src/components/RunTable.tsx)
  is the shared run list used by slice detail and comparison evidence.
- [`src/renderer/src/components/ui.tsx`](src/renderer/src/components/ui.tsx)
  contains common empty states, badges, metrics, modal, record details, and
  run metrics presentation. [`src/renderer/src/assets/main.css`](src/renderer/src/assets/main.css)
  defines the fixed sidebar/workspace layout, analytics grid/bar/scatter styles,
  tables, forms, responsive rules, dialogs, status styles, and narrow-window
  behavior. Analytics uses React/CSS/SVG; no charting dependency was added.
- [`src/renderer/src/pages/Pricing.tsx`](src/renderer/src/pages/Pricing.tsx),
  [`src/renderer/src/pages/Registry.tsx`](src/renderer/src/pages/Registry.tsx),
  and [`src/renderer/src/pages/Data.tsx`](src/renderer/src/pages/Data.tsx) are
  deliberately separate management surfaces for legacy prices, registry
  documents, and portability.
- [`src/renderer/src/App.tsx`](src/renderer/src/App.tsx) and the main-process
  package metadata share the `package.json` version source; the sidebar/header
  display and `comparisonExport()` app metadata therefore remain aligned at
  version `0.2.2` for the accepted schema-v2 product candidate.

## Tests by architectural area

All unit tests are Vitest tests matched by [`vitest.config.ts`](vitest.config.ts)
under `tests/**/*.test.{ts,tsx}`.

| Area | Primary tests | What they cover |
| --- | --- | --- |
| Deterministic metrics | [`tests/metrics.test.ts`](tests/metrics.test.ts), [`tests/presentation.test.ts`](tests/presentation.test.ts) | Cost, cached input, reasoning, unknown/zero/partial data, time, acceptance, roles, burn/reset, cache ratios, autonomous credit, dates and quality display |
| Dataset validation and transactions | [`tests/data.test.ts`](tests/data.test.ts) | Canonical v2 shape, v1/v2 normalization and import, enums/bounds, relationships, stale revisions, snapshot immutability/reselection, protected deletion, additive import, conflicts and malformed/oversized input |
| Execution evidence contract | [`tests/execution-evidence.test.ts`](tests/execution-evidence.test.ts), [`tests/execution-evidence-fixture.json`](tests/execution-evidence-fixture.json) | Deterministic v1 migration, v2 round-trip, strict nested bounds/unknown-field and privacy rejection, omitted/partial/zero evidence, provenance IDs/hash handling, token semantics, quota attribution isolation, malformed timestamp/number/count/percentage rejection, and price/relationship/revision preservation |
| Registry contract and pricing authority | [`tests/registry.test.ts`](tests/registry.test.ts), [`tests/registry-fixtures.ts`](tests/registry-fixtures.ts) | Canonical seed, strict registry validation, identity ambiguity, dated/exclusive pricing, backfill, v1 portability, legacy migration/precedence, referenced identity retention |
| Durable storage and recovery | [`tests/store.test.ts`](tests/store.test.ts), [`tests/registry-store.test.ts`](tests/registry-store.test.ts), [`tests/production-store.test.ts`](tests/production-store.test.ts) | Legacy reader compatibility plus canonical production authority, genuinely new profiles, v1/v2 one-way migration, registry present/absent seeding, exact live/backup archives, receipt and restart recovery, contradiction and unsafe evidence refusal, no dual writes, projection-only recovery refusal, and serialized/stale writer protection |
| SQLite projection/service | [`tests/sqlite-projection.test.ts`](tests/sqlite-projection.test.ts) | Main-process service/adapter round trips, deterministic admission and schema/settings, strict relationships/indexes, rollback, close/reopen, bounded record/byte work, physical-reality checks, relational/JSON reconciliation, serialized metadata, nested evidence, registry, Unknown/known-zero preservation, and hostile valid-ID relational identity/relationship regression coverage |
| Canonical artifact store/publish recovery | [`tests/canonical-artifact-store.test.ts`](tests/canonical-artifact-store.test.ts) | Self-describing canonical identity/path safety, artifact-before-projection authority, staged metadata-last publication, durable receipt phases, interruption/recovery idempotency, tombstoned deletes, malformed/foreign admission, bounded work, root/nested substitution checks, and hostile valid IDs |
| Filesystem-safe export | [`tests/export.test.ts`](tests/export.test.ts), [`tests/production-store.test.ts`](tests/production-store.test.ts) | Regular destinations, canonical/projection/migration/archive surfaces, live/backup aliases, links, dangling/unresolvable identities, raw and comparison output |
| Configuration identity and comparison | [`tests/configuration.test.ts`](tests/configuration.test.ts), [`tests/configuration-fixtures.ts`](tests/configuration-fixtures.ts), [`tests/comparison.test.ts`](tests/comparison.test.ts) | Canonical/alias identity, recorded thinking and Unknown behavior, ExtraHigh/XHigh presentation, collision-safe labels and bounded derived requests, multi-candidate/stage selection, grouping/filtering/export, raw import and historical cost/snapshot stability |
| Comparison calculations/export | [`tests/comparison.test.ts`](tests/comparison.test.ts) | Cohort qualification, ORed stage scopes, full lifecycle retention, source and derived filters/grouping/order/selection, candidate evidence coverage, quality, unknown/zero/partial measurements, stale/untrusted export requests |
| Comparison plan runner | [`tests/comparison-plan.test.ts`](tests/comparison-plan.test.ts), [`tests/compare-ui.test.tsx`](tests/compare-ui.test.tsx), [`tests/export.test.ts`](tests/export.test.ts) | Strict plan validation, bounded IDs/entries, ordered multi-comparison execution, shared revision/context analysis, cancellation/failure UI state, and safe derived-result export |
| Descriptive analytics | [`tests/analytics.test.ts`](tests/analytics.test.ts) | Known/unknown distributions, median/spread, cost-component reconciliation, reasoning share, UTC temporal grouping, date/provider/offer/runtime/outcome filters, accepted aggregate coverage, source IDs, and non-importable export stability |
| Execution-evidence analysis | [`tests/evidence-analytics.test.ts`](tests/evidence-analytics.test.ts), [`tests/evidence-ui.test.tsx`](tests/evidence-ui.test.tsx) | TTFT, invocation/tool-call, peak-input and paired-context-utilization distributions; independent attachment/runtime coverage; zero versus Unknown; quota isolation; exact evidence filters/groups; read-only detail presentation; ordinary export/plan parity and legacy-run compatibility |
| Accepted-outcome economics | [`tests/accepted-outcome.test.ts`](tests/accepted-outcome.test.ts), [`tests/accepted-outcome-fixture.json`](tests/accepted-outcome-fixture.json) | Multi-stage/cross-model lifecycle economics, first-pass Yes/No/Unknown, repair-link deduplication, partial/zero evidence, frozen pricing, reasoning coverage, export and raw-data stability |
| Renderer comparison and analytics | [`tests/compare-ui.test.tsx`](tests/compare-ui.test.tsx), [`tests/analytics-ui.test.tsx`](tests/analytics-ui.test.tsx), [`tests/evidence-ui.test.tsx`](tests/evidence-ui.test.tsx) | Shared cohort context, 2+/3+ configuration selection, exact stage controls, date/outcome/Unknown filters, evidence source/runtime filters and groups, collision labels, keyed export payload, source-linked charts, evidence detail/statistics, export failure state, canonical version display across pages |
| Renderer editors/startup | [`tests/editor.test.tsx`](tests/editor.test.tsx) | Execution-evidence preservation/validation/clearing, acceptance editing, local/exact timestamps, drafts, failed saves, unknown booleans, discard, same-slice relationship choices, startup failure |
| Renderer registry | [`tests/registry-ui.test.tsx`](tests/registry-ui.test.tsx) | Metadata/benchmark display, invalid-update rejection, editable failed draft, preview/install handoff |

Fixtures live in [`tests/fixtures.ts`](tests/fixtures.ts) and
[`tests/registry-fixtures.ts`](tests/registry-fixtures.ts), with configuration
fixtures in [`tests/configuration-fixtures.ts`](tests/configuration-fixtures.ts).
The store tests
mock selected filesystem operations to exercise failure windows; the Electron
scripts exercise the real main/preload/renderer/filesystem path.

## Build, package, and runtime QA paths

- [`package.json`](package.json) is the source of truth for commands. Common
  gates are `npm run typecheck`, `npm test`, `npm run lint -- --max-warnings=0`,
  and `npm run build`.
- [`electron.vite.config.ts`](electron.vite.config.ts) builds separate main,
  preload, and renderer bundles; the main build emits the normal `index` entry
  plus the isolated `sqlite-projection-qa` Electron entry, which exercises S9
  projection, S10 canonical artifact publish/recovery, and S11 production
  migration/cutover, and the renderer alias is `@renderer`.
- [`electron-builder.yml`](electron-builder.yml) packages app ID
  `com.pennyos.pennytel` as PennyTel for Windows, macOS, and Linux targets.
  It excludes source/tests/docs from the packaged app and unpacks
  `resources/**`.
- `npm start` previews the production build. `npm run dev` launches Electron
  through electron-vite. Build output is under `out/`; packaged artifacts use
  `dist/` when produced.
- `npm run test:storage-electron` runs the focused built Electron projection,
  canonical artifact publish/recovery, and S11 legacy migration/archive/cutover
  create/restart/security smoke in [`scripts/electron-storage-qa.mjs`](scripts/electron-storage-qa.mjs).
- [`scripts/canonical-qa.mjs`](scripts/canonical-qa.mjs) is the read-only QA helper
  that reconstructs canonical snapshots and Datasets from artifact metadata and
  record files. Normal Electron QA scripts use it to assert canonical state after
  load, mutation, import/export, comparison, and restart.
- `npm run test:electron` runs a build followed by the actual Electron QA
  scripts, beginning with that storage smoke and then [`scripts/electron-smoke.mjs`](scripts/electron-smoke.mjs),
  [`scripts/electron-repair-qa.mjs`](scripts/electron-repair-qa.mjs),
  [`scripts/electron-new-profile-qa.mjs`](scripts/electron-new-profile-qa.mjs),
  [`scripts/electron-registry-qa.mjs`](scripts/electron-registry-qa.mjs),
  [`scripts/electron-configuration-qa.mjs`](scripts/electron-configuration-qa.mjs),
  [`scripts/electron-accepted-outcome-qa.mjs`](scripts/electron-accepted-outcome-qa.mjs),
  and [`scripts/electron-comparison-plan-qa.mjs`](scripts/electron-comparison-plan-qa.mjs),
  which invokes [`scripts/electron-analytics-qa.mjs`](scripts/electron-analytics-qa.mjs),
  followed by [`scripts/electron-execution-evidence-qa.mjs`](scripts/electron-execution-evidence-qa.mjs)
  and [`scripts/electron-batch-import-qa.mjs`](scripts/electron-batch-import-qa.mjs).
  They use Playwright's Electron driver, isolated temporary
  `test-results/electron-qa-*`/repair/new-profile/registry/configuration-runtime-*
  profiles, real IPC,
  disk, restart, import/export, registry, recovery, and narrow-window checks.
  The normal smoke, repair, new-profile, registry, configuration, accepted-outcome,
  comparison-plan, execution-evidence, and batch-import scripts inspect canonical
  artifacts through `canonical-qa.mjs`; legacy fixtures are migration inputs and
  assertions target preserved archives and absence of post-cutover live/backup
  writes.
- `electron-configuration-qa.mjs` uses a synthetic isolated profile and the
  real Electron path to prove known configurations, aliases, thinking
  `Unknown`, `ExtraHigh / XHigh` presentation, canonical/family/model rollups,
  collision-safe keyed filtering, 2+/3+ candidate selection, structured and
  exact stage scopes, coverage-aware Unknown/zero evidence, authoritative
  comparison export, frozen raw bytes/costs across raw export and restart, and
  visible package version behavior.
- `electron-accepted-outcome-qa.mjs` exercises the production Electron path
  against an isolated synthetic profile, proving accepted-outcome summaries,
  six-stage cross-model lifecycle retention, first-pass states, known zero
  versus Unknown, stage/source-run inspection, export, restart/raw-data
  stability, narrow-window horizontal-scroll behavior, and the nested analytics
  verification path.
- [`scripts/electron-comparison-plan-qa.mjs`](scripts/electron-comparison-plan-qa.mjs)
  uses an isolated profile and real Electron IPC/dialogs to run a multi-entry
  plan, verify ordered result identities and shared source revision, confirm
  ordinary comparison export remains distinct, and check the plan-result
  artifact's non-importable boundary.
- [`scripts/electron-execution-evidence-qa.mjs`](scripts/electron-execution-evidence-qa.mjs)
  uses isolated profiles and the real Electron path to verify v1 startup migration
  with exact-byte legacy archiving, canonical v2 raw export/import, additive child
  compatibility, run-editor evidence edits and clearing, strict privacy/quota
  validation without publication, restart persistence, and malformed UTF-8
  preservation/blocking. It invokes the Slice 7
  child [`scripts/electron-evidence-analysis-qa.mjs`](scripts/electron-evidence-analysis-qa.mjs),
  which exercises a realistic evidence-bearing dataset through read-only run
  detail, evidence distributions/coverage, exact and missing filters/groups,
  ordinary comparison export, comparison-plan result parity, canonical/archive
  stability, narrow-window layout, and Electron security invariants.
- [`scripts/electron-codex-intake-qa.mjs`](scripts/electron-codex-intake-qa.mjs) exercises S13 with an isolated PennyTel profile and synthetic Codex home: discover/review, duplicate-authority rejection without publication, safe resumed activity, explicit import, restart, and idempotency. [`tests/codex-intake.test.ts`](tests/codex-intake.test.ts) carries the deterministic current-Codex fixture, bounded parsing/privacy cases, token-boundary derivation, monotonic conflict accumulation, source/inventory capture interleavings, and discovery/commit eligibility equivalence.
- [`scripts/electron-batch-import-qa.mjs`](scripts/electron-batch-import-qa.mjs) uses an isolated profile and the real Electron path to prove nested artifact discovery, mixed v1/v2 batch preview, one canonical revision publication without legacy live/backup writes, duplicate skips, failed-commit preservation/token invalidation, late malformed rejection, restart persistence, and the unchanged renderer security boundary.
- `electron-analytics-qa.mjs` remains the general legacy analytics runtime
  helper. Against its isolated profile it verifies descriptive distributions and coverage,
  source-linked charts, UTC date trends, missing-versus-literal-Unknown
  filtering, provider/offer/runtime/stage/outcome filters, full accepted
  lifecycle retention, authoritative export, and 900px layout behavior. It is
  complementary to the evidence-analysis child: execution-evidence QA owns the
  evidence-bearing detail/aggregate/export/plan-parity scenario, while the
  accepted-outcome QA path continues to consume the general analytics helper
  and retains the raw-data/restart stability checks.
- Fresh Codex worker sandboxes are known to deny ordinary Electron launch
  before PennyTel startup. For Electron QA in this worker environment, use the
  configured approved/elevated execution path first rather than attempting the
  known-bad sandboxed route. If an unexpected launch failure still occurs,
  `DEBUG=pw:browser` may expose `sandbox_host_linux.cc:41` and
  `shutdown: Operation not permitted (1)`; classify that as environment denial,
  not a PennyTel defect. Never weaken application/Chromium security to bypass
  it. If approved execution is unavailable or also fails, report
  `BLOCKED BY ENVIRONMENT` with diagnostics.
- [`scripts/electron-qa-capture.mjs`](scripts/electron-qa-capture.mjs) restores
  and focuses the isolated native QA window before screenshots. A working
  desktop surface is required; Electron runtime behavior is authoritative for
  desktop QA.

## Cross-component invariants and extension seams

### Invariants future workers must preserve

- S13 Codex intake uses sealed commit-time observation semantics: every claimed inspected byte horizon is classified within one bounded observation; authority conflicts accumulate monotonically; discovery and commit apply the same eligibility rules; changes during capture block/retry the observation; and writes occurring after a complete approved observation cutoff do not retroactively invalidate publication. The observation is explicitly not an atomic cross-file filesystem snapshot.
- `pennyos/` is tracked factory identity; `.pennyos/runtime/` is ignored local workflow evidence. pennyReporter receipts and `PENNYOS_TURN_REPORT_V1` closure signals are not PennyTel Dataset authority and must not be silently promoted into telemetry without the explicit ingestion/review path.
- The main process owns authoritative dataset persistence through
  `ProductionStore`; canonical JSON artifacts are normal production authority,
  renderer state is a detached view/draft, and every mutation is revision-checked.
- SQLite projection state is downstream and rebuildable: `ProductionProjection`
  can quarantine and recreate safe invalid projection files only after canonical
  authority is admitted. `TelemetryStore` and `telemetry.json` remain bounded
  legacy migration/compatibility surfaces, not the normal live persistence path.
  The renderer/preload/IPC boundary has no SQLite, database-path, SQL,
  artifact-path, migration-control, or general filesystem authority.
  Future storage work should enter through the main-process
  `PennyTelStorageService`/`DatasetProjectionRepository` seam rather than
  importing `node:sqlite` into application or renderer code.
- Writes are validated, serialized, flushed, and atomically published. Existing
  canonical data and migration/projection recovery evidence are preserved on
  invalid, corrupt, contradictory, or failed operations. External legacy,
  receipt, canonical, projection, or archive changes fail closed before
  retirement, reconciliation, or cached-state publication.
- The canonical raw dataset is schema v2. `normalizeDataset()` is detached and
  deterministic: v1 reads/imports become in-memory v2, S11 migration publishes
  canonical v2 while preserving exact original legacy bytes in archive evidence,
  and external raw import/export compatibility remains available.
- `Run.executionEvidence` is optional normalized source evidence, not a second
  run identity or a source of PennyOS workflow labels. Session/turn IDs and
  source hashes are provenance; table record IDs remain the import/conflict
  identity. Unknown or partial evidence stays unknown, and explicit zeroes
  remain observed zeroes. Runs without schema-v2 execution evidence remain
  valid legacy records and participate in comparison/economics with evidence
  fields reported as Unknown.
- Evidence analytics has independent coverage semantics: source-kind counts are
  attachment coverage, runtime-version coverage is separate, and every
  TTFT/invocation/tool-call/peak-input/utilization distribution includes all
  runs in its sample count while missing measurements remain Unknown. Literal
  recorded `Unknown` remains distinct from missing evidence.
- `peakInvocation` occupancy is cache-inclusive and is paired only with its own
  positive `contextWindowTokens`; validation requires
  `0 <= inputTokens <= contextWindowTokens` when that paired window exists.
  Utilization is the unweighted distribution of paired per-run ratios, with no
  fallback to the model window, registry limits, or cumulative run tokens.
- Codex quota-window `usedPercent`, reset/plan snapshots, and attribution are
  descriptive structured evidence only. They must not be mapped to the legacy
  `usageBefore`/`usageAfter` remaining-percent meter, `usageBurn`, pricing, or
  per-run burn analytics. Attribution is recorded explicitly and is never
  inferred from endpoint differences or timestamps.
- The normal dataset stores normalized metrics/provenance only. Raw source
  logs and payloads—including prompts, system instructions, hidden reasoning,
  source excerpts, commands, tool output, and arbitrary message text—remain
  outside PennyTel; the source-log hash describes exact external bytes and is
  not fetched or recomputed by the app.
- Registry installation/update plus legacy reconciliation, stable identity
  attachment, and eligible backfill are one atomic dataset transaction.
- Existing `priceSnapshot` evidence is historical and immutable across catalog,
  registry, metadata, alias, rate, and restart changes. Explicit correction is
  through model/provider/date/identity changes or all three rate overrides.
- Registered identity and pricing never silently fall back through ambiguity;
  missing telemetry remains unknown rather than zero or inferred.
- Model Configuration is derived analysis identity, not a persisted Run field:
  canonical model identity and recorded thinking are combined without schema
  migration, source rewriting, snapshot mutation, or price recalculation.
  Missing thinking remains Unknown even when registry capabilities list an
  effort; `ExtraHigh / XHigh` is presentation only. Derived labels must not
  replace the collision-safe keys used by grouping/filtering/export.
- Comparison candidate and stage selections are ephemeral analysis context, not
  persisted telemetry. Candidate keys use canonical Model Configuration
  identity; role-backed stage scopes and exact recorded `runType` scopes remain
  separate evidence types, and absent/unrecognized stage evidence stays
  unknown rather than inferred.
- Analytics and filters are derived from the current validated dataset snapshot;
  date bounds qualify a matching run by inclusive UTC `startAt`, while accepted
  outcome analytics reopen the full relevant lifecycle. Null explicitly selects
  missing evidence, empty filter values mean cleared state, and literal
  recorded `Unknown` remains ordinary source text. Evidence source kind and
  runtime version use exact nested recorded values; null filters and recorded
  null group keys select missing evidence without inference from model,
  environment, filename, or provenance. Evidence filters qualify a cohort run,
  while accepted-outcome economics reopens the full relevant lifecycle.
- Raw dataset export is canonical/importable; comparison export is derived and
  explicitly non-importable. Export destinations may not alias canonical,
  projection, migration, archive, or legacy recovery storage.
- Comparison plans and their result bundles are derived analysis artifacts;
  they do not mutate telemetry, are not raw export substitutes, and are not
  importable through the telemetry merge path.
- Relationship deletion protection prevents orphaned runs, findings, or
  discoveries. Same-slice links are validated before persistence.
- Acceptance economics and comparison cohorts must retain the full relevant
  lifecycle and distinguish known, partial, and unknown measurements.
- Electron sandbox/context isolation/no-node-integration and main-frame IPC
  caller checks are part of the security boundary.

### Existing seams for future slices

- New telemetry ingestion should enter through the typed `Mutation` union and
  `applyMutation`/`mergeImport`, with `validateRecord`/`validateDataset` and
  `ProductionStore.mutate`/`CanonicalArtifactStore` remaining the normal
  transaction gates. `TelemetryStore` remains only for bounded legacy reading,
  migration compatibility, and legacy-focused tests.
- Future replaceable persistence adapters belong behind
  `src/main/storage-service.ts`; the accepted S9 SQLite implementation is
  `src/main/sqlite-projection.ts`, S10's canonical publish coordinator is
  `src/main/canonical-artifact-store.ts`, and S11's normal authority/migration
  coordinator is `src/main/production-store.ts` with filesystem safety in
  `src/main/storage-files.ts`. Keep `node:sqlite`, canonical artifacts, migration
  receipts, archives, and all filesystem authority main-process-only and outside
  ASAR. Preserve canonical JSON as production authority, keep SQLite rebuildable,
  and rerun the built/packaged Linux Electron storage smoke when the
  Electron/runtime version changes. Do not add a renderer persistence path or a
  fallback that writes retired legacy files.
- The schema-v2 execution-evidence contract is split deliberately:
  `src/shared/types.ts` relates optional evidence to `Run`,
  `src/shared/execution-evidence.ts` owns its nested types and strict
  validation, `src/shared/data.ts` admits it as a run exception and owns the
  detached v1 normalization/import gates, and `RecordEditor.tsx` is the
  operator JSON edit surface. Preserve the main-owned load/mutate/preview/
  export flow; `fields.ts` remains the editor/catalog extension point for flat
  record fields.
- Registry evolution should use the complete JSON parse/validate/update path
  in `src/shared/registry.ts` and `registry-import`; referenced IDs and frozen
  snapshot provenance constrain replacement documents.
- New model-identity-derived comparison dimensions should extend the shared
  derivation in `src/shared/configuration.ts` first, then `GroupBy`/filter
  labels, keyed cohort selection, shared `compareData`, and the corresponding
  analysis export, with UI and unit-test coverage kept on the same path. Other
  comparison dimensions should continue to use their existing source or
  analytical ownership. Do not duplicate model/thinking identity composition
  in the renderer or persist a redundant configuration field without an
  authoritative schema change.
- New descriptive metrics belong in `src/shared/analytics.ts` or the shared
  comparison/metrics layer, then in `ComparisonView`/`ComparisonAnalysis` so
  UI and main-process export share the same calculations, coverage, and source
  IDs. New filters must extend the shared labels/types, request validation,
  `selectCohort()`, and renderer context together; do not filter accepted
  lifecycle stages after cohort qualification.
- New analytics visuals should extend `AnalyticsWorkspace.tsx` and the shared
  CSS/SVG patterns, retain source-inspection callbacks and Unknown/partial
  states, and add deterministic unit/UI/runtime coverage rather than creating a
  renderer-only calculation or chart subsystem.
- New pages should be routed in `App.tsx` and consume the loaded `Dataset`
  through existing callbacks; persistence authority should not move into page
  components.
- The five-table field catalog in `fields.ts` is the current editor/validation
  extension point. Adding a table requires coordinated changes to
  `types.ts`, `TABLES`/`EntityMap`, field metadata, validation/relationships,
  import/export behavior, UI routing, and tests.
- JSON import is the only implemented ingestion seam. CSV, Google Sheet
  adapters, live provider prices, model execution, cloud sync, authentication,
  and multi-user/high-volume storage are not present and remain explicit
  non-goals in [`README.md`](README.md).

## Known uncertainties and verification limits

- S13 deterministic fixtures and Electron QA cover the observed Codex CLI 0.155.1 rollout shape. Unknown future authority/turn/token variants fail closed or remain Unknown rather than being interpreted optimistically. Packaged Linux Codex-intake equivalence remains unverified because the attempted package build failed in Electron Builder dependency collection before a usable package existed; this is retained as a verification/environment limitation, not an accepted S13 product defect.

- The repository documents and verifies local Linux Electron workflows; packaged
  installers and non-Linux runtime environments are configured but not verified
  here. S9/S10/S11 built and packaged/ASAR storage evidence is Linux-only;
  Windows, macOS, and installer-format storage behavior remain unverified.
- Native file-picker interaction itself is harness-routed rather than manually
  exercised. Physical power-loss behavior is not directly tested. The S10
  flattened layout, S11 migration receipts, and repeated identity checks reduce
  pathname substitution exposure but cannot eliminate the narrow portable
  pathname check-to-kernel-use race; neither limitation is claimed solved.
- There is no production dataset, network price fetch, model execution, cloud
  or Sheet synchronization, or statistical-significance machinery in this
  repository. Unknown telemetry is intentionally not reconstructed.
- The v2 contract still has no raw Codex JSONL parser or external source-log
  adapter in PennyTel. External tooling must supply normalized evidence through
  the local JSON import seam; PennyTel validates source-log provenance fields
  but does not fetch, hash, or retain the external log.
- The authoritative behavioral contract for any future slice remains its
  assigned GitHub Issue. Begin slice-specific source discovery from the Issue's
  companion context map. Use this index only when broader repository geography
  is needed or when source evidence proves the companion map stale or incomplete.
