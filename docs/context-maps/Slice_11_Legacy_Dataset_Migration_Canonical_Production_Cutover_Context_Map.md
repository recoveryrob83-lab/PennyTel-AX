# S11 Context Map — Legacy Dataset Migration + Canonical Production Cutover

Issue: #25 — **S11 — Legacy Dataset Migration + Canonical Production Cutover**

Prepared against accepted `main` baseline `58939cfabb3ee0d5a724df456158b83ebaecbbf5` after S10 closure.

This map is repository geography only. GitHub Issue #25 owns the executable slice contract. `AGENTS.md` owns worker behavior; `MASTER_INDEX.md` is broader fallback context.

## Production composition today

### `src/main/index.ts`
- Normal Electron startup still constructs exactly one `TelemetryStore(app.getPath('userData'))`.
- Every live persistence-facing IPC path currently routes through that legacy store:
  - batch preview loads the current Dataset from `store.load()`;
  - batch commit calls `store.mutate()`;
  - `telemetry:load` calls `store.initializeRegistry()`;
  - `telemetry:mutate` calls `store.mutate()`;
  - single-import preview calls `store.preview()`;
  - raw/comparison export and comparison-plan execution load through the same store.
- `saveExport()` currently protects only `store.path` and `telemetry.backup.json`; after cutover those are not the complete live-storage surface.
- S11's production cutover should stay main-process-only. The existing IPC channel set does not inherently require a renderer/preload redesign.

### `src/main/store.ts` — legacy source
- `TelemetryStore` remains the accepted legacy monolith implementation.
- Live files:
  - `telemetry.json`;
  - `telemetry.backup.json`.
- `readFromDisk()` uses fatal UTF-8 decode and `normalizeDataset()`, so valid schema-v1/v2 legacy data already has a trusted normalization path.
- `load()` is read-only and returns a detached Dataset plus `path`.
- `initializeRegistry()` is **not** read-only when registry is missing: it publishes a legacy mutation. A migration path that must preserve the exact source should not casually call it before canonicalization.
- `mutate()` owns legacy provenance checks, backup rotation, and live replacement. After S11 cutover it must not remain reachable as normal production write authority.
- Exact live/backup byte provenance is private state. If S11 uses `TelemetryStore` as the migration reader but must archive exact bytes/revalidate source identity, implementation may need a narrow migration-facing helper or a separate bounded migration reader rather than reaching into private state.

## Accepted canonical authority surfaces from S10

### `src/main/canonical-artifacts.ts`
- `canonicalArtifactStorePath(dataDirectory)` resolves the writable `canonical-artifact-store` directory.
- `artifact-dataset.json` is dataset-level canonical metadata containing revision, ordered stable IDs, and optional registry.
- Record artifacts use deterministic type + SHA-256(UTF-16 code units of stable ID) filenames.
- Artifact contents/stable IDs are semantic truth; filenames/folder placement are organization.

### `src/main/canonical-artifact-store.ts`
Public S11-relevant methods:
- `initialize(dataset)`;
- `loadCanonical()`;
- `recover()`;
- `mutate(command)`.

Important accepted behavior:
- `initialize()` first runs recovery, refuses if canonical state already exists, and refuses initialization if `storage.loadProjection()` already returns projected data.
- `recover()` without a pending receipt cleans transaction work, loads/validates canonical artifacts, and calls `reconcileProjection()`.
- `reconcileProjection()` reprojects when projection is missing or differs and can recover from `storage.loadProjection()` errors **only after the projection repository/service has been successfully constructed**.
- Publication already provides artifact-before-SQLite ordering, metadata-last publication, tombstoned deletes, bounded pending receipts, and restart-safe idempotent recovery.
- `loadCanonicalInternal()` already performs a bounded root-file check against dataset metadata and reconstructs a complete Dataset. S11 should not create a competing canonical scanner/rebuild engine.
- The store remains queue-serialized per instance. Production composition should avoid multiple independently writable canonical-store instances for one profile.

### `src/main/storage-service.ts`
- `PennyTelStorageService` is projection-only:
  - `project(dataset)`;
  - `loadProjection()`;
  - `close()`.
- `MainProcessStorageService` validates/detaches complete Dataset snapshots.
- Do not expand this interface into legacy migration or canonical filesystem authority merely to reduce the number of modules.

### `src/main/sqlite-projection.ts`
- `projectionDatabasePath(dataDirectory)` returns `pennytel-projection.sqlite`.
- `SqliteProjectionRepository` constructor performs database identity/schema admission before S10 recovery can reconcile content.
- Missing/fresh projection is easy: the adapter initializes its schema and later canonical recovery can project into it.
- A foreign/malformed/unsupported existing database can throw **during constructor admission**, before `CanonicalArtifactStore.recover()` exists to rebuild it. This is the S11-specific projection-rebuild seam.
- Projection is non-authoritative by contract. A safe rebuild path may replace/recreate invalid projection state only after canonical authority is established and only when path identity is safe.
- Account for SQLite `-wal` / `-shm` sidecars and close/reopen ordering when designing replacement.
- Existing hard bounds remain 50,000 records / 10,000,000 serialized bytes.

## Shared semantic gates to reuse

### `src/shared/data.ts`
- `normalizeDataset()`: trusted v1→v2 compatibility path.
- `validateDataset()` / `validateRecord()`: canonical shape and relationship gates.
- `applyMutation()`: revision-checked save/delete/import/batch/registry transaction semantics.
- `mergeImport()` / `mergeBatchImport()`: current additive import duplicate/conflict behavior.
- Registry backfill/pricing snapshot semantics live here and should not be reimplemented in migration code.

### `src/shared/types.ts`
- `LoadedData = { data, path, warning? }` remains the renderer-facing storage result shape.
- `PennyTelAPI` already expresses load/mutate/import/export without naming `TelemetryStore`.
- The storage implementation can change behind this shape if `path` remains truthful.

## Renderer consequences already in repo

### `src/renderer/src/App.tsx`
- Uses only `LoadedData` + `window.pennytel`; no direct filesystem authority.
- The delete-success notice currently says: “The previous revision is in the local backup.” That becomes false after canonical cutover unless S11 deliberately implements that guarantee.

### `src/renderer/src/pages/Data.tsx`
- Displays `LoadedData.path` as “Local storage.”
- Current footnote explicitly claims every prior revision is retained as `telemetry.backup.json` alongside the live Dataset.
- S11 needs bounded wording/path-semantic reconciliation here; no broader Data-page redesign is indicated.
- Import UI itself depends on current API semantics rather than legacy storage layout.

### Preload / shared API
- `src/preload/index.ts`, `src/preload/index.d.ts`, and `PennyTelAPI` are expected regression boundaries.
- No generic filesystem/SQL capability should be added.

## Export / import filesystem surfaces

### `src/main/export.ts`
- `writeExport(destination, contents, protectedPaths)` protects exact live/backup paths using canonicalized path and inode checks.
- Current API protects files, not a whole canonical storage root.
- After cutover, exporting onto a canonical artifact, pending receipt, projection DB/sidecar, migration evidence, or legacy archive must not be possible.
- S11 may need a bounded extension of export protection semantics rather than enumerating unstable filenames incorrectly.

### `src/main/batch-import.ts`
- Bounded external file discovery remains source-backed and storage-agnostic.
- No migration/cutover redesign is indicated; batch commit should simply reach the new production store.

## Migration-state hazards

- **Authority transition:** canonical publication must become durably provable before legacy live authority is retired.
- **Crash after canonical initialization:** restart may see valid canonical artifacts plus still-live `telemetry.json`; this can be a legitimate interrupted migration, not automatically a contradiction.
- **Partial archival:** live and backup are separate directory entries; migration recovery must distinguish incomplete retirement from two active stores.
- **Legacy contradiction:** once canonical authority is established, a differing live monolith must not overwrite or merge into canonical state.
- **Backup-only legacy state:** current `TelemetryStore` deliberately treats this as recovery-sensitive rather than a new profile; migration should preserve that fail-closed meaning.
- **Registry seeding:** `TelemetryStore.initializeRegistry()` writes legacy state; canonical seeding should occur through canonical mutation after migration/new-profile initialization.
- **Exact legacy bytes:** v1 files may normalize semantically to v2 while their exact bytes still need archival preservation.
- **Projection constructor failure:** S10 reconciliation cannot help if `SqliteProjectionRepository` cannot be admitted/opened in the first place.
- **Projection sidecars:** rebuilding SQLite must not leave stale WAL/SHM state attached to a replacement database.
- **Export clobbering:** current exact-path protection is insufficient for the new multi-file canonical authority surface.
- **Multiple production instances:** app single-instance locking exists, but storage composition should still avoid opening competing writable services during migration/cutover.
- **No fallback writes:** keeping `TelemetryStore` source code for migration compatibility must not accidentally preserve a normal write route after cutover.
- **UI recovery claims:** legacy backup copy becomes misleading unless changed with the authority model.

## Tests / QA to start from

### Existing focused tests
- `tests/canonical-artifact-store.test.ts`
  - canonical initialization/mutation;
  - interruption matrix;
  - tombstone recovery;
  - partial multi-artifact publication;
  - projection lag/recovery;
  - filesystem substitution;
  - hostile valid identities.
- `tests/sqlite-projection.test.ts`
  - DB admission/schema/settings;
  - complete Dataset replacement/load;
  - rollback;
  - physical bounds;
  - relational/JSON reconciliation;
  - hostile identity encoding.
- `tests/store.test.ts`
  - v1/v2 legacy loading;
  - exact-byte backup preservation;
  - malformed UTF-8;
  - backup-only recovery;
  - external-change provenance;
  - first-write/new-profile behavior.
- Import/export regression surfaces:
  - `tests/batch-import.test.ts`;
  - `tests/export.test.ts`;
  - shared import/data tests referenced from `MASTER_INDEX.md`.

### Electron/runtime
- `src/main/sqlite-projection-qa.ts` + `scripts/electron-storage-qa.mjs`
  already exercise S9/S10 storage in built/packaged Linux Electron and are the preferred storage-runtime extension point.
- `scripts/electron-new-profile-qa.mjs`, `scripts/electron-smoke.mjs`, registry QA, batch-import QA, and comparison-plan QA exercise normal production composition and should be inspected for assumptions about `telemetry.json`.
- `electron.vite.config.ts` already emits normal `index` plus the storage QA entry.
- `electron-builder.yml` uses ASAR; canonical/projection/migration/archive state belongs in writable external user data.

## Likely S11 changed surface

Likely:
- one small production storage / migration coordinator in `src/main/`;
- `src/main/index.ts` composition and export-protection wiring;
- possible narrow legacy migration support in `src/main/store.ts`;
- possible safe projection-open/rebuild helper around `src/main/sqlite-projection.ts`;
- storage QA/test additions;
- bounded storage-copy updates in `App.tsx` and `Data.tsx`.

Do not assume exact new module names before implementation evidence. Prefer one explicit authority/migration coordinator over spreading cutover state across IPC handlers.

## Genuine unresolved implementation choices

These are Engineering choices for the implementer to settle from source evidence; they are not product ambiguity:

1. Whether restart-safe legacy retirement is simplest as a small durable migration receipt or a deterministic file-state machine.
2. Whether exact legacy migration bytes are exposed through a narrow `TelemetryStore` helper or read by a dedicated bounded migration reader.
3. Whether invalid projection rebuild is best represented as a repository factory/reset helper or a production-storage coordinator operation.
4. What truthful `LoadedData.path` should represent after cutover (canonical store root vs dataset metadata path), provided the Data UI remains accurate.

Escalate only if one of these choices reveals an authority conflict not covered by Issue #25.
