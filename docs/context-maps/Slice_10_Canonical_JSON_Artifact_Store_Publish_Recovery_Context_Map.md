# Slice 10 — Canonical JSON Artifact Store + Publish/Recovery Transaction Path Context Map

Purpose: repository geography for GitHub Issue #24 only. The Issue owns required behavior and acceptance; `AGENTS.md` owns worker behavior; `MASTER_INDEX.md` is broader fallback context.

Prepared against accepted `main` baseline `62901adb74c96de2991e97d7493582e1df8bf8f3` after S9 closure. Accepted S9 product code is commit `2e8a5d1f78c147ca449d4c99d02e3cb3edabf293`; the later S9 commit reconciles `MASTER_INDEX.md` only.

## Current authority split

### `src/main/store.ts`
- `TelemetryStore` remains the live production persistence authority at S10 start.
- Owns `telemetry.json`, `telemetry.backup.json`, exact-byte provenance, revision-checked mutation serialization, backup rotation, and atomic replacement.
- Its private `atomicWrite()` is useful evidence for PennyTel's existing same-filesystem temporary-file + flush + rename pattern.
- S10 must not silently reroute normal `TelemetryStore` load/mutate behavior. S11 owns legacy migration and production cutover.
- Avoid refactoring this class merely to share a helper unless source evidence proves reuse is cheaper/safer than a narrow new artifact-store primitive.

### `src/main/storage-service.ts`
- Accepted S9 main-process seam.
- `DatasetProjectionRepository` currently exposes complete-snapshot `replace(dataset)`, `load()`, and `close()`.
- `MainProcessStorageService` validates/detaches a complete Dataset before delegating to the projection repository.
- S10 should build above/alongside this seam rather than putting filesystem authority into the SQLite adapter.
- Current service naming/shape is projection-oriented. S10 may need a higher-level canonical publish coordinator or a carefully bounded extension, but `DatasetProjectionRepository` should remain a projection abstraction rather than becoming owner of canonical artifacts.

### `src/main/sqlite-projection.ts`
- Accepted S9 `node:sqlite` projection implementation.
- `SqliteProjectionRepository.replace()` replaces one complete validated Dataset snapshot transactionally; it does not currently expose incremental per-record writes.
- Projection metadata owns Dataset schema version, revision, registry JSON, physical record count, and serialized-byte count.
- `load()` reconstructs one complete Dataset and validates exact schema identity, physical limits, relational/JSON agreement, record ordering, and serialized metadata.
- S10 publish logic therefore has two viable source-backed integration directions:
  1. construct the post-publish complete Dataset and continue using `replace()`; or
  2. change the projection contract only if evidence shows complete replacement cannot satisfy S10 safely/boundedly.
- Do not casually add raw SQL or artifact-aware semantics to this adapter. SQLite remains downstream projection state.
- Accepted bounds: 50,000 records and 10,000,000 serialized/payload bytes.

## Canonical domain and transaction semantics

### `src/shared/types.ts`
- Owns `Dataset`, the five entity families (`slices`, `runs`, `findings`, `discoveries`, `pricing`), optional `registry`, `Mutation`, and IPC-facing types.
- Current `Dataset` has global `schemaVersion: 2` and `revision`; those are not properties of individual records.
- S10 individual artifacts therefore require a minimal explicit representation of artifact type/version/stable identity plus a deterministic home for dataset-level revision/registry state. Do not hide those semantics in folder names or SQLite-only metadata.

### `src/shared/data.ts`
Important existing truth gates:
- `validateRecord()` owns strict record shape/field semantics.
- `validateDataset()` owns cross-record relationships and whole-Dataset invariants.
- `normalizeDataset()` / envelope normalization own v1→v2 compatibility semantics.
- `applyMutation()` validates the caller revision, computes the complete next Dataset, performs relationship-safe save/delete/import/registry semantics, backfills registry identity/pricing, increments Dataset revision exactly once, and validates the result.
- `mergeImport()` / `mergeBatchImport()` establish current duplicate/conflict and source-attribution behavior.
- `snapshotRun()` preserves pricing snapshots/provenance on record updates.

S10 should reuse these semantics rather than reimplementing field or relationship rules in the artifact layer.

Architectural hazard:
- A single existing mutation can affect more than one durable record (batch import, registry update/backfill, pricing snapshots, relationship-safe delete consequences).
- An individual-artifact store therefore needs a transaction boundary capable of publishing a coherent multi-file Dataset change even though individual filesystem renames are only atomic one path at a time.
- Durable pending transaction evidence is the recovery bridge across that multi-file publication and the later SQLite projection update.
- Do not claim multi-file filesystem atomicity that the platform does not provide.

## Filesystem safety references

### `src/main/export.ts`
- `writeExport()` demonstrates existing target canonicalization, protected-path checks, regular-file checks, mode-600 temp creation, flush/sync, second safety check, and atomic rename.
- Useful reference for safe replace semantics and symlink/identity hazards.
- Export remains non-authoritative; do not turn it into the artifact store merely because some primitives overlap.

### `src/main/batch-import.ts`
- `discoverBatch()` demonstrates bounded recursive discovery, realpath containment checks, symlink avoidance, `O_NOFOLLOW`, inode stability checks, UTF-8 rejection, file/depth/count/aggregate-byte bounds, and deterministic ordering.
- S10 may reuse the safety lessons for bounded pending-transaction recovery or artifact path validation.
- Full canonical-store scanning/rebuild belongs primarily to S11; do not make normal S10 startup recursively scan the entire artifact tree.
- Current batch-import file naming (`.pennytel.json`) is useful compatibility context but imported dataset files are not yet canonical per-record artifacts.

### `src/main/index.ts`
- Current composition root instantiates only `TelemetryStore` for normal product behavior.
- Current renderer-facing persistence/import/export channels all route through the legacy store.
- S10's no-cutover boundary means normal startup/load/mutate should remain unchanged unless a compile-only or isolated-QA consequence is unavoidable.
- Any S10 QA entry should remain separate from normal application startup, as S9's SQLite QA entry does.

## Accepted S9 QA / packaging surfaces

### `src/main/sqlite-projection-qa.ts`
- Dedicated Electron main entry for create/restart projection verification.
- Good extension/reference point if S10 needs real Electron evidence for canonical artifact → projection publication/recovery.
- Keep QA profiles isolated from Rob's real PennyTel profile.

### `scripts/electron-storage-qa.mjs`
- Runs built and packaged Electron storage QA in isolated temporary data directories.
- Already verifies packaged ASAR execution, projection restart, and unchanged renderer security boundary.
- S10 should extend this route rather than inventing a competing packaged-storage harness if artifact filesystem behavior must be proven in packaged Electron.

### `electron.vite.config.ts`
- Emits the normal Electron main entry plus the isolated `sqlite-projection-qa` entry.
- Likely build surface if S10 adds/extends a storage QA entry.

### `electron-builder.yml`
- Production packaging uses ASAR.
- Canonical artifacts, SQLite, pending receipts/journal state, staging files, and recovery material must live in writable external data/QA paths, never in application resources/ASAR.
- S9 verified Linux unpacked/ASAR behavior only; Windows/macOS/installers remain unverified.

### `package.json`
- `test:storage-electron` is the focused storage runtime gate and is included in `test:electron`.
- Existing typecheck/lint/build/test commands remain the verification entrypoints.
- Do not add native-addon rebuild machinery; accepted S9 uses embedded `node:sqlite`.

## Existing tests relevant to S10

### `tests/sqlite-projection.test.ts`
- Strong baseline for projection admission, exact schema/settings, full-Dataset round trip, rollback, bounds, physical reality, relational/JSON reconciliation, and restart.
- S10 should keep this suite green and add artifact→projection/recovery tests rather than weakening projection checks.

### `tests/store.test.ts`
- Production-authority regression surface.
- Covers exact-byte preservation, malformed UTF-8, external-change provenance, recovery-only state, atomic replacement failure/retry, stale writers, detached snapshots, and durable restart.
- Key S10 regression requirement: these tests should stay green because normal production authority has not cut over.

### `tests/export.test.ts`
- Filesystem destination/alias/symlink safety patterns useful to canonical artifact path design.

### Batch-import tests
- `tests/batch-import.test.ts` covers bounded file discovery, deterministic ordering, symlink avoidance, source attribution, additive conflicts, and one-transaction legacy persistence.
- Useful evidence for path/discovery hazards, but canonical artifact admission should not inherit dataset-import semantics blindly.

### Shared fixtures
- `tests/fixtures.ts`
- `tests/registry-fixtures.ts`
- `tests/configuration-fixtures.ts`
- Reuse representative Dataset records, nested execution evidence, registry data, zero/Unknown distinctions, and historical snapshots in artifact round-trip/recovery QA.

## Expected new S10 surfaces

No accepted canonical artifact-store module exists yet.

Likely new main-process responsibilities:
- canonical artifact codec/envelope validation;
- deterministic artifact path derivation from validated type + stable ID;
- dataset-level canonical metadata needed outside individual records (at minimum schema/revision and registry or an equivalent source-backed design);
- same-filesystem staging + durable publish primitives;
- durable pending transaction/receipt state;
- publish coordinator that orders artifact durability before SQLite projection;
- bounded idempotent recovery of interrupted transactions.

Names and exact file split should follow implementation evidence. Prefer a small number of explicit main-process modules over a framework.

## Data/authority flow to preserve

S10 subsystem target:

```
validated current Dataset + requested change
        ↓
existing shared mutation/validation semantics
        ↓
post-change Dataset
        ↓
derive canonical artifact transaction
        ↓
durable pending intent + staged bytes
        ↓
publish canonical JSON artifact state
        ↓
S9 Storage Service / SQLite projection
        ↓
clear pending transaction state
```

Authority rule inside the new subsystem:
- once canonical artifact publication is durably established, artifacts outrank a stale/missing SQLite projection;
- SQLite must never make a failed/missing canonical artifact "true";
- a crash between artifact publication and projection completion must be replayable without inventing or duplicating semantic mutations.

Production rule during S10:
- normal PennyTel still reads/writes `TelemetryStore`;
- no permanent dual write;
- S11 performs migration and explicit cutover.

## Specific hazards to inspect before coding

- **Global revision:** current revision is Dataset-level. Individual records alone cannot reconstruct it unless S10 stores canonical dataset-level metadata.
- **Registry:** registry is nested Dataset state, not one of `TABLES`; it needs canonical durable representation outside SQLite.
- **Multi-record mutation:** batch imports and registry/backfill operations can change many records in one logical revision.
- **Deletes:** durable recovery must distinguish intentional canonical deletion from a missing/corrupt artifact. A simple unlink without durable transaction evidence is ambiguous after a crash.
- **Partial multi-file publish:** do not pretend multiple renames are one filesystem transaction; pending state must make replay deterministic.
- **Idempotency:** recovery must be safe after zero, one, or repeated restart attempts.
- **Path identity:** record IDs are currently validated for trim/length but are not filesystem-safe names by definition. Path derivation must encode/hash/sanitize deterministically rather than interpolate arbitrary IDs directly.
- **Symlink/path substitution:** canonical-store writes need containment and regular-file identity rules comparable to existing export/batch safety.
- **Directory durability:** file-content `fsync` alone may not prove a rename/directory entry durable on all filesystems. Use the strongest practical Node-supported same-filesystem durability sequence and document platform limits rather than claiming impossible guarantees.
- **SQLite replacement cost:** current projection update replaces the complete Dataset synchronously. Keep accepted S9 bounds in mind before introducing repeated projection work inside one logical artifact transaction.
- **Artifact corruption:** canonical artifacts must fail closed independently of SQLite.
- **Recovery scope:** S10 recovery should process its bounded durable pending transaction state, not perform the full store scan/rebuild reserved for S11.
- **Artifact versioning:** distinguish artifact-format version from Dataset schema version; do not overload one number with both meanings.
- **Unknown vs zero:** omitted optional fields must remain omitted; explicit `false`/0 remain known values.
- **Generated/temporary material:** staged files and pending receipts are recovery mechanics, not canonical records and must never be discovered as ordinary artifacts.

## Likely focused working set

Start with:
- `src/main/storage-service.ts`
- `src/main/sqlite-projection.ts`
- `src/main/store.ts` as production-authority/reference evidence
- `src/main/export.ts`
- `src/main/batch-import.ts`
- `src/main/index.ts`
- `src/shared/types.ts`
- `src/shared/data.ts`
- `src/shared/registry.ts`
- `src/shared/execution-evidence.ts`
- `src/main/sqlite-projection-qa.ts`
- `scripts/electron-storage-qa.mjs`
- `electron.vite.config.ts`
- `electron-builder.yml`
- `package.json`
- `tests/sqlite-projection.test.ts`
- `tests/store.test.ts`
- `tests/export.test.ts`
- `tests/batch-import.test.ts`
- shared fixtures

Expected new surface: a small canonical artifact codec/store + publish/recovery coordinator and focused tests/QA. Do not build S11 migration/rebuild, S12 Reporter, S13 Codex ingestion, or S14 operator UX here.

Consult `MASTER_INDEX.md` only if this map or direct source evidence leaves a material dependency unresolved.
