# Slice 9 — Storage Service + node:sqlite Projection Foundation Context Map

Purpose: repository geography for GitHub Issue #23 only. The Issue owns required behavior and acceptance; `AGENTS.md` owns worker behavior; `MASTER_INDEX.md` is broader fallback context.

Prepared against accepted `main` baseline `f776f9f50a5cc38ffa4a5dd412b6d57d21e91716` (PennyTel 0.2.2 / Slice 8 merged).

## Current working-tree fact

The local PennyTel working tree used for the preceding `node:sqlite` feasibility spike contains uncommitted spike changes that are **not represented by this accepted-main map**. Before editing, inspect `git status` and the full diff. The spike report is `docs/node-sqlite-feasibility-spike.md`; the operator reported changes in `package.json`, the main entry point, a probe, a runner, and that report. Preserve useful spike evidence, convert reusable smoke coverage deliberately, and remove the temporary production hook before S9 completion.

## Primary main-process surfaces

### `src/main/store.ts`
- `TelemetryStore` is the current production persistence authority.
- Owns `telemetry.json`, `telemetry.backup.json`, revision checks, write serialization, provenance guards, backup rotation, and atomic replacement.
- `load()`, `initializeRegistry()`, `preview()`, and `mutate()` define the current persistence seam.
- S9 must coexist with this authority; do not silently reroute production load/mutate behavior to SQLite.

### `src/main/index.ts`
- Electron main-process composition root.
- Applies `PENNYTEL_DATA_DIR` to Electron `userData`, constructs `TelemetryStore`, creates the sandboxed window, and registers trusted main-frame IPC handlers.
- Likely composition seam for a main-only Storage Service / projection adapter.
- Current security checks on IPC callers and BrowserWindow settings are part of the boundary.
- The feasibility spike temporarily touched this file; inspect the local diff before implementation and remove any spike-only hook before candidate freeze.

### New S9 storage-service / SQLite modules
- No accepted production module exists yet on main.
- New code should live in the main-process layer and expose a replaceable service/repository boundary above `node:sqlite`.
- Keep SQL/driver imports below that boundary. Renderer, analytics, comparison, and ingestion code should not acquire direct SQLite knowledge.

## Canonical Dataset / validation surfaces

### `src/shared/types.ts`
- Owns `Dataset`, `Slice`, `Run`, `Finding`, `Discovery`, `Pricing`, `PriceSnapshot`, `TABLES`, mutation types, and IPC-facing API types.
- Current Dataset envelope: schemaVersion 2, revision, five entity arrays, optional registry.
- S9 projection/reconstruction should preserve this semantic shape rather than introducing a competing domain model.

### `src/shared/data.ts`
- Canonical record/dataset validation and mutation/import semantics.
- `validateRecord()`, `validateDataset()`, and `normalizeDataset()` are the existing truth gates for Dataset shape and relationships.
- Reuse these validators at projection/reconstruction boundaries; do not create a second set of field semantics in SQL code.
- `applyMutation()` owns current revision-changing mutation semantics. S9 should not casually redesign those semantics.

### `src/shared/registry.ts`
- Owns canonical model/provider registry validation, identity resolution, snapshots, and reconciliation.
- Registry is nested Dataset state rather than one of the five ordinary tables. If S9 stores registry projection state as JSON or another compact representation, preserve it exactly enough to reconstruct/validate without semantic drift.

### `src/shared/execution-evidence.ts`
- Owns the nested `Run.executionEvidence` contract and bounded validation.
- This is a strong candidate for validated JSON storage inside the SQLite projection rather than gratuitous relational normalization.

## Renderer / preload boundary

### `src/preload/index.ts`
- Exposes the narrow typed `window.pennytel` API through `contextBridge`.
- Renderer access is IPC-only.
- S9 should not expose SQL, database paths, arbitrary query execution, or filesystem primitives here.

### Renderer surfaces
- Existing renderer code consumes detached `Dataset` snapshots and sends typed operations through preload.
- No renderer refactor is expected unless source evidence proves a necessary compile/type consequence.
- A new SQLite-backed projection is not permission to move persistence authority into React state.

## Build / packaging surfaces

### `package.json`
- Source of truth for Electron version and verification commands.
- Current main is 0.2.2; the local feasibility spike may contain uncommitted changes.
- `test:electron` is the established real Electron QA chain.
- The spike observed default parallel-test timeouts but 356/356 with one worker; treat recurrence as timing evidence unless S9 causally changes it.

### `electron.vite.config.ts`
- Main, preload, and renderer are bundled separately.
- Main-process `node:sqlite` imports must remain compatible with this build path.

### `electron-builder.yml`
- Packaged app uses ASAR and excludes source/tests/docs/scripts from normal package contents; `resources/**` is unpacked.
- Runtime databases must live under writable user data / QA data locations, never inside ASAR or packaged application resources.
- `npmRebuild: false` is consistent with the approved no-native-addon `node:sqlite` path.

## Tests and runtime verification

### `tests/store.test.ts`
- Current authority for durable JSON storage/recovery behavior.
- Covers exact-byte backup rotation, malformed UTF-8, external-change detection, v1->v2 behavior, atomic-write failure, stale writers, and recovery states.
- Existing store tests should stay green; S9 should add focused projection/service coverage rather than weakening these invariants.

### Shared fixtures
- `tests/fixtures.ts`
- `tests/registry-fixtures.ts`
- `tests/configuration-fixtures.ts`
- Reuse representative canonical Dataset fixtures where practical for round-trip tests rather than inventing a weak toy shape.

### Electron QA
- `scripts/electron-smoke.mjs` and the scripts chained by `npm run test:electron` exercise the real main/preload/renderer/filesystem path with isolated profiles.
- Fresh Codex sessions have a known Electron sandbox denial unless the configured approval/elevation path is used; `AGENTS.md` owns that execution rule.
- The feasibility spike proved Linux unpacked ASAR runtime; Windows/macOS and installer formats remain unverified.

## Data/control flow to preserve

Current production path:

`Renderer -> preload -> trusted Electron IPC -> TelemetryStore -> validated Dataset mutation -> atomic telemetry.json + backup -> LoadedData -> renderer`

S9 adds a main-process storage-service/projection seam without replacing that production authority.

Target S9 shape:

`main composition -> Storage Service contract -> node:sqlite projection adapter`

The service may project/reconstruct validated Dataset state for tests/future use, but ordinary production `telemetry:load` / `telemetry:mutate` remain backed by `TelemetryStore` until a later explicit cutover slice.

## Hazards / invariants

- Main process remains the only filesystem/database authority.
- `node:sqlite` is synchronous; keep individual main-thread operations bounded.
- Explicit connection settings must be applied and verified at open; do not assume foreign keys or other connection behavior.
- Projection schema/version migration must be deterministic and testable.
- Dataset revision must survive projection/reconstruction without accidental mutation.
- Omitted optional fields represent Unknown; do not collapse omission into zero or inferred values.
- Nested evidence and price snapshots are historical/provenance-bearing data; preserve semantics exactly.
- Registry state is part of Dataset reconstruction even though it is not a normal `TABLES` array.
- Do not over-normalize structures that PennyTel never needs to query relationally.
- SQLite corruption/error paths must fail deterministically and must not threaten the existing JSON authority in S9.
- Database/QA paths must be isolated from Rob's real PennyTel profile.
- Preserve `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and main-frame IPC caller validation.
- Local feasibility-spike changes are pre-existing work. Distinguish them from S9 edits in the final diff.

## Likely focused working set

Start with:
- `src/main/store.ts`
- `src/main/index.ts`
- `src/shared/types.ts`
- `src/shared/data.ts`
- `src/shared/registry.ts`
- `src/shared/execution-evidence.ts`
- `package.json`
- `electron.vite.config.ts`
- `electron-builder.yml`
- `tests/store.test.ts`
- shared test fixtures
- the local feasibility-spike files identified by `git status`

Expected new surface: one small main-process Storage Service and one `node:sqlite` projection adapter plus focused tests/QA. Names should follow actual source evidence; do not create speculative abstraction layers.

Consult `MASTER_INDEX.md` only if this map or source evidence leaves a material dependency unresolved.
