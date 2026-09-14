# PennyTel repository map

Evidence-based map of the repository at accepted Slice 3 candidate
`0e66af3c6972ccc5727d2403b601d678a77c5817` (product version `0.1.2`). This
is a navigation aid for future slices, not a replacement for the assigned
GitHub Issue or the authoritative contracts in `docs/`.

## Start here

- Product/runtime overview: [`README.md`](README.md)
- v1 data contract and field semantics: [`docs/data-contract.md`](docs/data-contract.md)
- Registry contract and update behavior: [`docs/model-registry.md`](docs/model-registry.md)
- Comparison analysis contract: [`docs/comparison-export.md`](docs/comparison-export.md)
- Active Slice 4 repository map: [`docs/context-maps/Slice_4_Accepted_Outcome_Economics_Context_Map.md`](docs/context-maps/Slice_4_Accepted_Outcome_Economics_Context_Map.md)
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
  `telemetry:load`, `telemetry:mutate`, `telemetry:preview`, `telemetry:open`,
  `telemetry:export`, and `telemetry:export-comparison`. Each handler checks
  that the caller is the primary window's main frame before acting.
- [`src/main/store.ts`](src/main/store.ts) is the authoritative in-memory and
  on-disk dataset owner. Registry seeding, validation, mutation serialization,
  revision checks, recovery guards, and backfill all pass through
  `TelemetryStore`.
- [`src/main/export.ts`](src/main/export.ts) is the main-process file-writing
  boundary for both raw dataset and derived comparison exports. It protects
  live/backup paths and uses an atomic destination replacement.

### Preload bridge

- [`src/preload/index.ts`](src/preload/index.ts) exposes exactly one typed
  `window.pennytel` API through `contextBridge`: load, mutate, preview import,
  open import, export dataset, and export comparison.
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

- [`src/shared/types.ts`](src/shared/types.ts) defines the v1 envelope and
  domain records:
  `Dataset` contains `schemaVersion`, `revision`, five arrays (`slices`,
  `runs`, `findings`, `discoveries`, `pricing`), and optional `registry`;
  `Slice`, `Run`, `Finding`, `Discovery`, `Pricing`, `PriceSnapshot`,
  `Mutation`, and `PennyTelAPI` are the central types.
- [`src/shared/fields.ts`](src/shared/fields.ts) is the shared field catalog
  for editor rendering and record validation metadata. It also defines table
  names, relationships, required fields, numeric bounds, enums, and user
  hints.
- [`src/shared/data.ts`](src/shared/data.ts) is the transaction and ingestion
  boundary:
  `validateRecord` and `validateDataset` enforce shape, types, IDs,
  timestamps, snapshot provenance, relationships, acceptance constraints, and
  legacy pricing uniqueness;
  `applyMutation` handles save/delete/import/registry-import and increments
  the dataset revision;
  `mergeImport` validates an additive batch, skips identical records,
  rejects conflicts, checks combined relationships, and backfills new runs;
  `snapshotRun` is the main-process pricing snapshot selector.
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
  existing files on failure, and caches the exact loaded live bytes plus a
  fingerprint of `telemetry.backup.json`.
- `requireNewProfile()` distinguishes a genuinely empty profile from late
  live/backup appearance and blocks unsafe writes.
- `initializeRegistry()` loads existing data and, when the registry is absent,
  installs the bundled seed through the ordinary revision-checked mutation
  path. Registry reconciliation, identity attachment, and pricing backfill
  publish as one transaction.
- `mutate()` queues operations, applies the validated mutation to detached
  state, rechecks live and backup provenance immediately before writing,
  rotates the prior live revision to `telemetry.backup.json`, then atomically
  replaces the live file. PennyTel refreshes its own backup fingerprint after
  rotation so a failed live replacement can be retried safely.
- `atomicWrite()` writes a unique mode-600 temporary file, flushes it, and
  renames it into place. The queue is retained after failures so a later
  operation can retry without publishing the failed candidate.

Storage files are in the Electron app-data directory by default, or the
absolute directory named by `PENNYTEL_DATA_DIR`. A live file with any backup
evidence is treated as recovery-sensitive; a missing live file plus backup
evidence blocks loading/writing rather than silently starting empty.

### Import and export paths

- Native import uses `src/main/index.ts`'s open-file dialog, a 10 MB limit, and
  `TelemetryStore.preview()`/`mergeImport()` before the renderer confirms the
  additive transaction.
- Raw dataset import is accepted only for `schemaVersion: 1`. Registry seed
  JSON and comparison-analysis JSON are explicitly rejected from telemetry
  import. Imported revisions are ignored; the local transaction revision is
  authoritative.
- Raw dataset export reads the main-owned snapshot. Comparison export is a
  distinct derived artifact with `kind: "pennytel-comparison"` and is not
  importable. Slice 3 does not change raw dataset import/export semantics.
- [`docs/comparison-export.md`](docs/comparison-export.md) documents the
  additive analysis-v1 configuration dimensions and their identity-key versus
  presentation-label semantics. Comparison export receives only revision and
  context from the renderer; the main process derives the view from its own
  snapshot and records the package app version.
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
  recorded `modelFamily` dimensions in addition to model, thinking, role,
  slice, candidate, workflow, session/context, local hour, and weekday
  groupings.
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
  when any run filter is active, one run must satisfy all active run filters for
  a slice to qualify, but qualifying accepted slices retain their full
  acceptance lifecycle across models and roles;
  `compareData()` derives group summaries, candidate columns, coverage-aware
  evidence, findings, validated discoveries, quality distributions, selected
  evidence, and accepted economics using the same keys and labels;
  `selectedCandidates` is a separate bounded collection of canonical Model
  Configuration keys, independent of ordinary filters and `selectedGroup`;
  `stageScopes` match exact recorded structured roles (`Implementer`, `Critic`,
  `Repair`) or exact `runType` text, with multiple scopes ORed together and
  combined with ordinary filters on the same run;
  `modelConfiguration` is the default Compare grouping while `canonicalModel`,
  `modelFamily`, existing exact `model`, and `thinking` preserve useful rollups;
  `validateComparisonRequest()` admits the derived dimensions and bounds their
  encoded selections/filters separately, including limits of eight candidates
  and sixteen stage scopes; `comparisonExport()` derives the same view in the
  main process from current authoritative dataset state after checking the
  request revision and emits a reproducible non-importable analysis object.
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
- `acceptedEconomics()` remains full-lifecycle behavior: candidate selection
  and stage scoping qualify comparison evidence but do not attribute accepted
  outcomes to a candidate or narrow lifecycle economics.
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
  selection, side-by-side observed-run evidence, accepted-slice economics, and
  comparison export. It defaults to Model Configuration and uses shared keyed
  options so collision-safe labels remain stable through filtering and export.
- [`src/renderer/src/pages/Data.tsx`](src/renderer/src/pages/Data.tsx) shows
  the storage path, exports raw JSON, accepts pasted/file JSON, previews counts
  and skips, and commits only after the user confirms.
- [`src/renderer/src/components/RecordEditor.tsx`](src/renderer/src/components/RecordEditor.tsx)
  is the generic field-driven editor for all five tables. It keeps drafts
  local, validates before save, preserves failed drafts, and requires explicit
  discard for dirty forms.
- [`src/renderer/src/components/AcceptanceTime.tsx`](src/renderer/src/components/AcceptanceTime.tsx)
  handles local date/time conversion, exact ISO-with-timezone correction,
  daylight-saving ambiguity/nonexistence feedback, clear, and one-time
  `Accept now` behavior.
- [`src/renderer/src/components/RunTable.tsx`](src/renderer/src/components/RunTable.tsx)
  is the shared run list used by slice detail and comparison evidence.
- [`src/renderer/src/components/ui.tsx`](src/renderer/src/components/ui.tsx)
  contains common empty states, badges, metrics, modal, record details, and
  run metrics presentation. [`src/renderer/src/assets/main.css`](src/renderer/src/assets/main.css)
  defines the fixed sidebar/workspace layout, tables, forms, responsive rules,
  dialogs, status styles, and narrow-window behavior.
- [`src/renderer/src/pages/Pricing.tsx`](src/renderer/src/pages/Pricing.tsx),
  [`src/renderer/src/pages/Registry.tsx`](src/renderer/src/pages/Registry.tsx),
  and [`src/renderer/src/pages/Data.tsx`](src/renderer/src/pages/Data.tsx) are
  deliberately separate management surfaces for legacy prices, registry
  documents, and portability.
- [`src/renderer/src/App.tsx`](src/renderer/src/App.tsx) and the main-process
  package metadata share the `package.json` version source; the sidebar/header
  display and `comparisonExport()` app metadata therefore remain aligned at
  version `0.1.2` for this candidate.

## Tests by architectural area

All unit tests are Vitest tests matched by [`vitest.config.ts`](vitest.config.ts)
under `tests/**/*.test.{ts,tsx}`.

| Area | Primary tests | What they cover |
| --- | --- | --- |
| Deterministic metrics | [`tests/metrics.test.ts`](tests/metrics.test.ts), [`tests/presentation.test.ts`](tests/presentation.test.ts) | Cost, cached input, reasoning, unknown/zero/partial data, time, acceptance, roles, burn/reset, cache ratios, autonomous credit, dates and quality display |
| Dataset validation and transactions | [`tests/data.test.ts`](tests/data.test.ts) | v1 shape, enums/bounds, relationships, stale revisions, snapshot immutability/reselection, protected deletion, additive import, conflicts and malformed/oversized input |
| Registry contract and pricing authority | [`tests/registry.test.ts`](tests/registry.test.ts), [`tests/registry-fixtures.ts`](tests/registry-fixtures.ts) | Canonical seed, strict registry validation, identity ambiguity, dated/exclusive pricing, backfill, v1 portability, legacy migration/precedence, referenced identity retention |
| Durable storage and recovery | [`tests/store.test.ts`](tests/store.test.ts), [`tests/registry-store.test.ts`](tests/registry-store.test.ts) | New/existing profiles, live/backup recovery evidence, external changes, atomic replacement failure, serialized/stale writers, registry startup and persisted backfill |
| Filesystem-safe export | [`tests/export.test.ts`](tests/export.test.ts) | Regular destinations, live/backup aliases, links, dangling/unresolvable identities, raw and comparison output |
| Configuration identity and comparison | [`tests/configuration.test.ts`](tests/configuration.test.ts), [`tests/configuration-fixtures.ts`](tests/configuration-fixtures.ts), [`tests/comparison.test.ts`](tests/comparison.test.ts) | Canonical/alias identity, recorded thinking and Unknown behavior, ExtraHigh/XHigh presentation, collision-safe labels and bounded derived requests, multi-candidate/stage selection, grouping/filtering/export, raw import and historical cost/snapshot stability |
| Comparison calculations/export | [`tests/comparison.test.ts`](tests/comparison.test.ts) | Cohort qualification, ORed stage scopes, full lifecycle retention, source and derived filters/grouping/order/selection, candidate evidence coverage, quality, unknown/zero/partial measurements, stale/untrusted export requests |
| Renderer comparison | [`tests/compare-ui.test.tsx`](tests/compare-ui.test.tsx) | Shared cohort context, 2+/3+ configuration selection, exact stage controls, collision labels, keyed export payload, export failure state, canonical version display across pages |
| Renderer editors/startup | [`tests/editor.test.tsx`](tests/editor.test.tsx) | Acceptance editing, local/exact timestamps, drafts, failed saves, unknown booleans, discard, same-slice relationship choices, startup failure |
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
  preload, and renderer bundles; the renderer alias is `@renderer`.
- [`electron-builder.yml`](electron-builder.yml) packages app ID
  `com.pennyos.pennytel` as PennyTel for Windows, macOS, and Linux targets.
  It excludes source/tests/docs from the packaged app and unpacks
  `resources/**`.
- `npm start` previews the production build. `npm run dev` launches Electron
  through electron-vite. Build output is under `out/`; packaged artifacts use
  `dist/` when produced.
- `npm run test:electron` runs a build followed by the actual Electron QA
  scripts in this order: [`scripts/electron-smoke.mjs`](scripts/electron-smoke.mjs),
  [`scripts/electron-repair-qa.mjs`](scripts/electron-repair-qa.mjs),
  [`scripts/electron-new-profile-qa.mjs`](scripts/electron-new-profile-qa.mjs),
  [`scripts/electron-registry-qa.mjs`](scripts/electron-registry-qa.mjs), and
  [`scripts/electron-configuration-qa.mjs`](scripts/electron-configuration-qa.mjs).
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
- Fresh Codex worker sandboxes may deny Electron before application startup
  with `Process failed to launch!`. Running with `DEBUG=pw:browser` may expose
  `sandbox_host_linux.cc:41` and `shutdown: Operation not permitted (1)`.
  Treat that signature as a worker-environment denial rather than a PennyTel
  product defect. Use the configured approval/escalation path for isolated QA;
  do not modify application code to work around the sandbox denial. If
  escalation also fails, report the blocker.
- [`scripts/electron-qa-capture.mjs`](scripts/electron-qa-capture.mjs) restores
  and focuses the isolated native QA window before screenshots. A working
  desktop surface is required; Electron runtime behavior is authoritative for
  desktop QA.

## Cross-component invariants and extension seams

### Invariants future workers must preserve

- The main process owns authoritative dataset persistence; renderer state is a
  detached view/draft and every mutation is revision-checked.
- Writes are validated, serialized, flushed, and atomically replaced. Existing
  live data and recovery evidence are preserved on invalid/corrupt/failed
  operations. External live or backup changes fail closed before backup
  rotation or cached-state publication.
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
- Raw dataset export is canonical/importable; comparison export is derived and
  explicitly non-importable. Export destinations may not alias live/backup
  storage.
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
  here.
- Native file-picker interaction itself is harness-routed rather than manually
  exercised. Physical power-loss behavior is not directly tested, although
  atomic replacement failure is covered.
- There is no production dataset, network price fetch, model execution, cloud
  or Sheet synchronization, or statistical-significance machinery in this
  repository. Unknown telemetry is intentionally not reconstructed.
- The authoritative behavioral contract for any future slice remains its
  assigned GitHub Issue. Begin slice-specific source discovery from the Issue's
  companion context map. Use this index only when broader repository geography
  is needed or when source evidence proves the companion map stale or incomplete.
