# Slice 8 — Batch Telemetry Import Context Map

Purpose: repository geography for Issue #17 only. The Issue owns behavior; `AGENTS.md` owns worker behavior; `MASTER_INDEX.md` is broader fallback context.

Prepared against product/docs baseline `c0176007294356e00d5e7d908364d9da7bd29b87` (PennyTel 0.2.1 behavior).

## Primary surfaces

### Electron main process

`src/main/index.ts`
- Owns trusted Electron dialogs and filesystem reads.
- Current single-file seam: `telemetry:open` opens one JSON file, enforces a 10 MB file bound, and returns UTF-8 text.
- New folder selection/discovery belongs here (or a narrowly extracted main-process helper), not in the renderer.
- Existing BrowserWindow security: sandbox enabled, contextIsolation enabled, nodeIntegration disabled; preserve unchanged.

`src/main/store.ts`
- `TelemetryStore` owns the live dataset, write queue, revision authority, recovery evidence, backup rotation, and atomic persistence.
- `preview(text)` delegates to canonical merge logic without writing.
- `mutate(command)` is the authoritative persistence transaction and must remain the only path that publishes imported telemetry.
- Batch import must not become N independent store mutations if Issue #17 requires one atomic batch.

### Shared import contract

`src/shared/data.ts`
- `mergeImport(current, text)` owns current additive import parsing/normalization/validation/duplicate/conflict behavior.
- `normalizeDataset`, `validateDataset`, `validateRecord`, registry/pricing snapshot reconciliation, and relationship checks are canonical contract logic.
- Extend/reuse this path for batch aggregation; do not fork a second schema validator.

`src/shared/types.ts`
- Owns `Dataset`, `Mutation`, `ImportPreview`, `PennyTelAPI`, and related IPC-facing types.
- Likely narrow extension seam for batch request/preview/result types and/or one new mutation kind.

### Preload / renderer boundary

`src/preload/index.ts`
- Exposes the narrow typed renderer API over IPC.
- Current import calls: `previewImport`, `openImport`, `mutate`.
- Add only the minimum batch surface needed; do not expose filesystem primitives or arbitrary paths/read APIs.

`src/renderer/src/App.tsx`
- Owns loaded dataset/revision state and canonical mutation wiring.
- Current Data page receives `onImport(text)` which routes through the normal `import` mutation.
- Batch completion must update the same loaded state/revision authority rather than maintaining renderer-only shadow data.

`src/renderer/src/pages/Data.tsx`
- Existing single-file/paste import UI lives here.
- Current flow: choose/paste -> `previewImport(text)` -> aggregate record preview -> `onImport(text)` -> success message.
- Batch folder selection and aggregate preview should fit beside this flow without replacing it.

## Tests / runtime verification

`tests/data.test.ts`
- Primary shared import/validation regression surface.
- Extend for batch aggregate semantics if shared batch logic is introduced.

Relevant renderer tests under `tests/*.test.tsx`
- Add focused Data-page batch-import UI coverage rather than broad unrelated UI churn.

`scripts/electron-smoke.mjs` and the existing Electron QA scripts referenced by `package.json`
- Runtime security/persistence precedent.
- Add or extend a bounded Electron QA path that selects/feeds a realistic nested batch and verifies persistence after restart.

`package.json`
- Version authority (`0.2.1` at preparation time) and verification command chain.
- Issue #17 targets `0.2.2`.

## Data/control flow to preserve

Current single import:

`Data.tsx -> preload -> trusted IPC -> TelemetryStore preview/mutate -> shared merge/validation -> atomic store write + backup -> LoadedData back to renderer`

Slice 8 should add folder discovery/aggregation around this seam, not bypass it.

## Hazards / invariants

- Main process remains filesystem authority; renderer stays sandboxed.
- Import is additive: identical records may skip, conflicting stable IDs fail, existing records are never overwritten.
- Schema v1 compatibility normalizes into v2; schema-v2 execution evidence validation remains strict.
- Import relationships are validated against stored + imported evidence; batch semantics must not accidentally become dependent on file ordering.
- `telemetry.json` and `telemetry.backup.json` recovery/provenance checks in `TelemetryStore` are security/data-integrity behavior, not incidental implementation detail.
- Registry JSON and derived comparison/plan artifacts are intentionally rejected by ordinary telemetry import; batch import must preserve those exclusions.
- Existing 10 MB single-file import bound is deliberate. Folder discovery also needs an aggregate bound per Issue #17.
- Generated historical directories may contain `.jsonl`, manifests, role subfolders, and `.pennytel.json` outputs together; batch discovery should target the intended PennyTel artifacts only.

## Expected implementation footprint

Most likely bounded to:
- `src/main/index.ts` and/or one small main-process batch-discovery helper;
- `src/main/store.ts` only if a dedicated atomic batch transaction helper is needed;
- `src/shared/data.ts` / `src/shared/types.ts` for aggregate batch merge/types;
- `src/preload/index.ts`;
- `src/renderer/src/App.tsx`;
- `src/renderer/src/pages/Data.tsx`;
- focused tests/runtime QA;
- `package.json` version.

Widen discovery only if source evidence requires it.