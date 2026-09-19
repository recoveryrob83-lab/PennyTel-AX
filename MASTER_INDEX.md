# PennyTel repository map

Evidence-based map of the repository at accepted PennyTel `0.2.2` product
candidate `34e2b539eb2cb0d745506ada81bc9ae5f6b3b874`. This
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
- Active Slice 11 legacy-migration/canonical-production-cutover context map: [`docs/context-maps/Slice_11_Legacy_Dataset_Migration_Canonical_Production_Cutover_Context_Map.md`](docs/context-maps/Slice_11_Legacy_Dataset_Migration_Canonical_Production_Cutover_Context_Map.md)
- Historical schema reconciliation: [`docs/schema-reconciliation.md`](docs/schema-reconciliation.md)
- Canonical registry input: [`docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json`](docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json)
- Runtime/verification record: [`docs/verification.md`](docs/verification.md) and [`docs/bounded-repair-verification.md`](docs/bounded-repair-verification.md)

Slice-specific repository maps live under [`docs/context-maps/`](docs/context-maps/).
The assigned GitHub Issue is the executable slice contract and points to its
companion map. `AGENTS.md` owns worker-role behavior. Start from the companion
map and use this master index when broader repository geography is needed.

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
  `telemetry:export-comparison`, and `telemetry:run-comparison-plan`. Each handler checks that the caller is the
  primary window's main frame before acting.
- [`src/main/batch-import.ts`](src/main/batch-import.ts) owns bounded recursive discovery of `.pennytel.json` batch artifacts in an operator-selected folder, including containment/stability checks and file/count/depth/byte limits. It does not own persistence.
- [`src/main/store.ts`](src/main/store.ts) is the authoritative in-memory and
  on-disk dataset owner. Registry seeding, validation, mutation serialization,
  revision checks, recovery guards, and backfill all pass through
  `TelemetryStore`.
- [`src/main/storage-service.ts`](src/main/storage-service.ts) defines the
  main-process `PennyTelStorageService` and replaceable
  `DatasetProjectionRepository` boundary. `MainProcessStorageService` validates
  and detaches Dataset values before delegating to an adapter; driver details
  stay below this service/repository seam. S9 does not wire this projection
  service into normal production load or mutation.
- [`src/main/sqlite-projection.ts`](src/main/sqlite-projection.ts) implements
  the `node:sqlite` `SqliteProjectionRepository` behind that seam. It is a
  rebuildable SQLite projection, not canonical persistence: `TelemetryStore`
  and `telemetry.json` remain the sole normal production authority, and normal
  startup/load/mutate do not use SQLite. The adapter admits only its
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
  is the isolated S10 main-process canonical JSON store and publish coordinator.
  It sits above `PennyTelStorageService`: canonical artifacts are authoritative
  within this subsystem and SQLite is a rebuildable downstream projection. The
  store uses durable pending receipts with `prepared`, `publishing`, and
  `published` states, direct-child staging/tombstone/receipt files under a
  flattened store root, metadata-last publication, and bounded idempotent
  recovery. Normal PennyTel startup/load/mutate remains on `TelemetryStore` /
  `telemetry.json`; S11 owns migration, reconciliation, and production cutover.
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
  boundary for both raw dataset and derived comparison exports. It protects
  live/backup paths and uses an atomic destination replacement.

### Preload bridge

- [`src/preload/index.ts`](src/preload/index.ts) exposes exactly one typed
  `window.pennytel` API through `contextBridge`: open/commit batch import, load,
  mutate, preview/open single import, export dataset, export comparison, and run
  comparison plan.
- [`src/preload/index.d.ts`](src/preload/index.d.ts) supplies the renderer's
  global `Window.pennytel` type. There is no generic IPC or filesystem API in
  the renderer.

### Renderer

- [`src/renderer/src/main.tsx`](src/renderer/src/main.tsx) mounts React in
  `StrictMode` and imports the application stylesheet.
- [`src/renderer/src/App.tsx`](src/renderer/src/App.tsx) loads the main-owned
  snapshot, holds page/selection/modal state, routes mutations with the
  loaded dataset revision, and coordinates the page components and shared
  editors/details. Startup errors remain a non-writable error state; there is
  no browser-storage fallback. It imports the canonical package version and
  displays it in the sidebar/header so UI version routing stays aligned with
  the main-process comparison export metadata.
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

### `TelemetryStore`

Important symbols in [`src/main/store.ts`](src/main/store.ts):

- `readFromDisk()` reads and validates `telemetry.json`, preserves the
  existing files on failure, decodes UTF-8 with fatal error handling, runs
  `normalizeDataset()` for v1/v2 compatibility, and caches the exact loaded
  live bytes plus a fingerprint of `telemetry.backup.json`.
- `requireNewProfile()` distinguishes a genuinely empty profile from late
  live/backup appearance and blocks unsafe writes.
- `initializeRegistry()` loads existing data and, when the registry is absent,
  installs the bundled seed through the ordinary revision-checked mutation
  path. Registry reconciliation, identity attachment, and pricing backfill
  publish as one transaction.
- `mutate()` queues operations, applies the validated mutation to detached
  state, rechecks live and backup provenance immediately before writing,
  rotates the prior live revision to `telemetry.backup.json`, then atomically
  replaces the live file. Reading a v1 file does not rewrite it, create a
  backup, or increment revision; the first ordinary mutation publishes v2 and
  rotates the exact original live bytes into the backup. PennyTel refreshes
  its own backup fingerprint after rotation so a failed live replacement can
  be retried safely.
- `atomicWrite()` writes a unique mode-600 temporary file, flushes it, and
  renames it into place. The queue is retained after failures so a later
  operation can retry without publishing the failed candidate.

Storage files are in the Electron app-data directory by default, or the
absolute directory named by `PENNYTEL_DATA_DIR`. A live file with any backup
evidence is treated as recovery-sensitive; a missing live file plus backup
evidence blocks loading/writing rather than silently starting empty.

### SQLite projection (S9, extended by S10)

- The SQLite projection file is `pennytel-projection.sqlite`, created by
  [`src/main/sqlite-projection.ts`](src/main/sqlite-projection.ts) in an
  absolute isolated user-data/QA directory. It is a rebuildable relational
  projection for future storage work, not a second source of truth or a cutover
  of the JSON authority.
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
  publication interruption and restart recovery. [`scripts/electron-storage-qa.mjs`](scripts/electron-storage-qa.mjs)
  runs those phases in an isolated temporary directory for built and packaged
  Electron, then checks packaged restart behavior, writable artifact paths
  outside ASAR, and the unchanged renderer
  sandbox/context-isolation/no-node-integration and preload API boundary.

### Canonical JSON artifact store (S10)

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
- Recovery is receipt-driven and idempotent. Prepared transactions are checked
  against the prior canonical state and discarded; publishing or published
  transactions finish canonical publication, verify the canonical digest, and
  reproject before clearing durable state. Missing or contradictory artifacts,
  unsafe substitutions, or projection-only state fail closed rather than
  inferring authority. This subsystem does not perform S11's full artifact
  scan/rebuild or legacy migration.

### Import and export paths

- Native single-file import uses `src/main/index.ts`'s open-file dialog, a 10 MB limit, and
  `TelemetryStore.preview()`/`mergeImport()` before the renderer confirms the
  additive transaction.
- Batch import uses the main-process folder picker plus `discoverBatch()` to find only bounded `.pennytel.json` artifacts, previews the combined source set through `mergeBatchImport()`, then consumes one opaque preview token and publishes through one revision-checked `TelemetryStore.mutate({ kind: 'batch-import', ... })` transaction. Identical records skip; conflicting stable IDs or invalid relationships fail closed without partial publication.
- Raw dataset import accepts `schemaVersion: 1` or `2`, normalizes v1 before
  additive merge/relationship validation, and ignores imported revisions in
  favor of the local transaction revision. Registry seed JSON and comparison-
  analysis JSON are explicitly rejected from telemetry import.
- Raw dataset export reads the main-owned snapshot and always emits schema v2.
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

The bundled seed is statically imported by `src/main/store.ts` from
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
  the storage path, exports raw JSON, accepts pasted/file JSON, previews counts
  and skips, and commits only after the user confirms. It presents the v2
  import contract while explaining automatic v1 normalization and v2 raw
  exports.
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
| Durable storage and recovery | [`tests/store.test.ts`](tests/store.test.ts), [`tests/registry-store.test.ts`](tests/registry-store.test.ts) | New/existing profiles, strict UTF-8/original-byte preservation, v1 read-without-rewrite and first-mutation migration, live/backup recovery evidence, external changes, atomic replacement failure, serialized/stale writers, registry startup and persisted backfill |
| SQLite projection/service | [`tests/sqlite-projection.test.ts`](tests/sqlite-projection.test.ts) | Main-process service/adapter round trips, deterministic admission and schema/settings, strict relationships/indexes, rollback, close/reopen, bounded record/byte work, physical-reality checks, relational/JSON reconciliation, serialized metadata, nested evidence, registry, Unknown/known-zero preservation, and hostile valid-ID relational identity/relationship regression coverage |
| Canonical artifact store/publish recovery | [`tests/canonical-artifact-store.test.ts`](tests/canonical-artifact-store.test.ts) | Self-describing canonical identity/path safety, artifact-before-projection authority, staged metadata-last publication, durable receipt phases, interruption/recovery idempotency, tombstoned deletes, malformed/foreign admission, bounded work, root/nested substitution checks, and hostile valid IDs |
| Filesystem-safe export | [`tests/export.test.ts`](tests/export.test.ts) | Regular destinations, live/backup aliases, links, dangling/unresolvable identities, raw and comparison output |
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
  plus the isolated `sqlite-projection-qa` Electron entry, which now exercises
  both S9 projection and S10 canonical artifact publish/recovery, and the
  renderer alias is `@renderer`.
- [`electron-builder.yml`](electron-builder.yml) packages app ID
  `com.pennyos.pennytel` as PennyTel for Windows, macOS, and Linux targets.
  It excludes source/tests/docs from the packaged app and unpacks
  `resources/**`.
- `npm start` previews the production build. `npm run dev` launches Electron
  through electron-vite. Build output is under `out/`; packaged artifacts use
  `dist/` when produced.
- `npm run test:storage-electron` runs the focused built Electron projection
  and canonical artifact publish/recovery create/restart/security smoke in
  [`scripts/electron-storage-qa.mjs`](scripts/electron-storage-qa.mjs).
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
  uses isolated profiles and the real Electron path to verify v1 load without
  rewrite, first-mutation v2 migration with exact-byte backup, v2 raw
  export/import, additive child compatibility, run-editor evidence edits and
  clearing, strict privacy/quota validation without publication, restart
  persistence, and malformed UTF-8 preservation/blocking. It invokes the Slice 7
  child [`scripts/electron-evidence-analysis-qa.mjs`](scripts/electron-evidence-analysis-qa.mjs),
  which exercises a realistic evidence-bearing dataset through read-only run
  detail, evidence distributions/coverage, exact and missing filters/groups,
  ordinary comparison export, comparison-plan result parity, raw/live/backup
  stability, narrow-window layout, and Electron security invariants.
- [`scripts/electron-batch-import-qa.mjs`](scripts/electron-batch-import-qa.mjs) uses an isolated profile and the real Electron path to prove nested artifact discovery, mixed v1/v2 batch preview, one atomic revision/backup publication, duplicate skips, failed-commit preservation/token invalidation, late malformed rejection, restart persistence, and the unchanged renderer security boundary.
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

- The main process owns authoritative dataset persistence; renderer state is a
  detached view/draft and every mutation is revision-checked.
- SQLite projection state is not normal production authority: `TelemetryStore`
  and `telemetry.json` remain the live persistence path, and the
  renderer/preload/IPC boundary has no SQLite, database-path, SQL, artifact-path,
  or general filesystem authority. Inside the isolated S10 subsystem, canonical
  JSON artifacts outrank SQLite, which remains rebuildable projection state.
  Future storage work should enter through the main-process
  `PennyTelStorageService`/`DatasetProjectionRepository` seam rather than
  importing `node:sqlite` into application or renderer code.
- Writes are validated, serialized, flushed, and atomically replaced. Existing
  live data and recovery evidence are preserved on invalid/corrupt/failed
  operations. External live or backup changes fail closed before backup
  rotation or cached-state publication.
- The canonical raw dataset is schema v2. `normalizeDataset()` is detached
  and deterministic: v1 reads/imports become in-memory v2 without rewriting
  storage, and only the first ordinary mutation publishes v2 while preserving
  the exact original v1 live bytes in the backup rotation.
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
  explicitly non-importable. Export destinations may not alias live/backup
  storage.
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
  `TelemetryStore.mutate` remaining the transaction gates.
- Future replaceable persistence adapters belong behind
  `src/main/storage-service.ts`; the accepted S9 SQLite implementation is
  `src/main/sqlite-projection.ts`, and the S10 canonical publish coordinator is
  `src/main/canonical-artifact-store.ts`. Keep `node:sqlite` and all artifact
  filesystem authority main-process-only, keep projection/artifact/receipt data
  outside ASAR, preserve `TelemetryStore` / `telemetry.json` as normal
  production authority until S11's explicit cutover, and rerun the
  built/packaged Linux Electron storage smoke when the Electron/runtime version
  changes. S10 does not introduce legacy migration, full rebuild/reconciliation,
  Reporter/Codex ingestion, or a new renderer persistence path; those remain
  later-slice responsibilities.
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

- The repository documents and verifies local Linux Electron workflows; packaged
  installers and non-Linux runtime environments are configured but not verified
  here. S9/S10 built and unpacked/ASAR storage evidence is Linux-only; Windows,
  macOS, and installer-format storage behavior remain unverified.
- Native file-picker interaction itself is harness-routed rather than manually
  exercised. Physical power-loss behavior is not directly tested. The S10
  flattened layout and repeated identity checks reduce pathname substitution
  exposure but cannot eliminate the narrow portable pathname check-to-kernel-use
  race; neither limitation is claimed solved.
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
