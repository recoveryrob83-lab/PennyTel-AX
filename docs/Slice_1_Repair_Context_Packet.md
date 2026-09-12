# PennyTel Slice 1 — Repair Context Packet

## Candidate

Baseline:
67466fd15c9c25cb719bda26020436bc01bc3bc4

Current candidate:
working-tree implementation

Critic:
GPT-5.6 Luna Max, fresh session

Critic disposition:
REPAIR REQUIRED

## Repair Objective

Correct the existing-profile recovery-file race and stale legacy-history reconciliation before
technical acceptance. Registry installation/update must fail closed when recovery evidence changes,
and later authored pricing history must continue to own the dates and intervals promised by the
migration policy. Preserve all existing telemetry, frozen snapshots, legacy rows, and storage
provenance while doing so.

## Blocking / Material Findings

### [P0] Existing-profile registry seeding can overwrite a backup that appears after the initial read

Observed behavior:

For a valid existing live profile without an installed registry, after the store has read and cached
the live file, creating `telemetry.backup.json` before registry seeding does not block the write. The
registry transaction replaces the newly appearing backup with the cached live dataset. No error is
reported and the new backup contents are lost.

Expected behavior:

An external live or backup change detected after the initial read and before the transaction must
fail closed before either dataset path is replaced. The live file, backup bytes, in-memory dataset,
revision, and recovery evidence must remain unchanged. Ordinary first migration with no external
change must still rotate the expected prior live dataset into the backup.

Reproduction:

1. Create a temporary directory and write a valid schemaVersion 1 dataset with `revision: 4` and no
   `registry` to `telemetry.json`.
2. Construct `TelemetryStore` and call `await store.load()` to establish the existing-profile
   cached-read state.
3. Write a different valid recovery dataset, for example `revision: 99` with a `recovery` slice,
   to `telemetry.backup.json`.
4. Call `await store.initializeRegistry()`.
5. Observe success, a seeded live file, and a backup containing the old live dataset (`revision: 4`)
   rather than the externally appearing recovery dataset (`revision: 99`).

This was independently reproduced in the critic-only temporary probe
`/tmp/critic-adversarial.test.ts`; the focused test failed with the backup diff above. The same
sequence is equivalent to the `initializeRegistry()` startup read completing before an external
recovery file appears.

Evidence:

- `src/main/store.ts:79-96` starts registry seeding after the initial `load()`.
- `src/main/store.ts:124-142` only invokes `requireNewProfile(true)` for
  `awaitingFirstWrite` and compares only the live file for an existing profile.
- `src/main/store.ts:144-149` writes `telemetry.backup.json` without checking whether its entry or
  bytes changed after the cached read.
- The existing/new-profile late-file cases pass, but they exercise the `awaitingFirstWrite` guard;
  they do not cover an existing live profile in this path.

Violated invariant / contract:

- External live/backup files appearing during startup must be handled safely.
- Recovery and provenance evidence must not be silently overwritten.
- Registry installation and backfill must use the guarded atomic storage path without data loss.

Likely relevant files:

- `src/main/store.ts`
- `tests/registry-store.test.ts`
- `tests/store.test.ts`
- `scripts/electron-new-profile-qa.mjs` (neighboring runtime provenance coverage)

Likely relevant symbols/functions/components:

- `TelemetryStore.readFromDisk`
- `TelemetryStore.initializeRegistry`
- `TelemetryStore.mutate`
- `TelemetryStore.requireNewProfile`
- `TelemetryStore.atomicWrite`

Relevant tests:

- `tests/registry-store.test.ts` existing/new-profile late `live`/`backup`/`both` cases
- `tests/store.test.ts` live-change, recovery, and atomic replacement cases
- Add a focused existing-profile late-backup case matching the reproduction above.

Neighboring behavior that must not regress:

- New profiles must continue to reject live/backup entries that appear after the empty read.
- Live-file byte/revision checks, backup-only recovery blocking, serialized writes, and atomic
  replacement must remain intact.
- A normal existing-profile registry seed must still create the prior live dataset as the backup.
- Invalid registry updates and failed live replacement must leave both files and memory unchanged.

Repair acceptance condition:

The reproduction rejects before rotating either path and preserves exact live/backup bytes and the
cached dataset. A normal existing-profile seed with no external change still succeeds with one
revision increment and the expected prior-live backup. The focused regression and existing storage,
provenance, import/export, and Electron suites pass.

### [P1] Previously migrated legacy pricing is not re-bounded when authored registry history changes

Observed behavior:

When an offer initially has no authored `pricingHistory`, a unique earlier legacy row is migrated as
an open-ended registry history entry. On a later registry update that adds authored pricing, the
existing migrated entry is found by `effectiveFrom` and reported as already migrated, but its old
open interval is not re-evaluated. It can therefore remain applicable after a finite authored
interval, or override a newly authored entry that starts before it.

Expected behavior:

Migration must remain consistent with the documented rule on every explicit registry update. A
migrated legacy row may extend history only before the offer's first authored registry entry; its
exclusive end is the first authored date or the next eligible legacy date, whichever comes first.
After authored history changes, a legacy row must not become the selected price outside that allowed
historical interval. Existing legacy records and already frozen run snapshots remain preserved.

Reproduction:

1. Start with a valid registry fixture whose Luna offer has an empty `pricingHistory`.
2. Add one valid legacy pricing row `p` for model `Luna`, provider `OpenAI`, effective `2026-07-01`,
   with input rate `9` (and valid cached/output rates).
3. Install the registry. Observe a migrated Luna history row at `2026-07-01` with
   `effectiveTo: null` and `legacyPricingIds: ["p"]`.
4. Submit a new valid registry based on that installed registry and add an authored Luna price with
   `effectiveFrom: "2026-07-30"`, `effectiveTo: "2026-08-30"`, and different rates.
5. Observe that the migrated row still has `effectiveTo: null`; `priceAt(offer, "2026-09-01")`
   returns the old legacy rate instead of remaining unpriced after the finite authored interval.

The critic probe observed exactly this history and selected price. A related variant adds authored
pricing beginning before `2026-07-01`; the later-starting migrated row can then win at dates after
that authored start because `priceAt` correctly selects the newest applicable `effectiveFrom`.

Evidence:

- `src/shared/registry.ts:523-535` returns early when an existing history row has the legacy row's
  `effectiveFrom`, so no new interval boundary is calculated.
- `src/shared/registry.ts:537-558` computes `first` only for non-migrated (`!legacyPricingIds`)
  rows and only when inserting a new legacy history row.
- `src/shared/registry.ts:426-429` then selects the stale migrated row whenever its open interval
  covers the reference date.
- `src/shared/data.ts:405-426` makes this reconciliation the registry-import path used for both
  installation and later updates.
- `docs/model-registry.md` states that earlier legacy history ends at the first authored registry
  date and that migration must remain safe across updates; it is implementation-authored context,
  while the canonical seed remains the authority for the registry shape and policy.

Violated invariant / contract:

- Registry offers are authoritative for registered pairs.
- A migrated legacy rate may extend only the historical gap before authored registry pricing.
- Effective pricing windows and historical pricing evidence must remain deterministic and correct.
- Future runs must not be silently mispriced by stale legacy provenance.

Likely relevant files:

- `src/shared/registry.ts`
- `src/shared/data.ts`
- `tests/registry.test.ts`
- `tests/registry-store.test.ts`
- `docs/model-registry.md` (migration/precedence context)

Likely relevant symbols/functions/components:

- `reconcileLegacyPricing`
- `priceAt`
- `backfillRegistry`
- `applyMutation` (`registry-import` branch)
- `registrySnapshot`

Relevant tests:

- `tests/registry.test.ts` migration, precedence, conflict, and input-order cases
- Add a two-step migrated-open-history → authored-history update regression, including authored
  pricing both after and before the migrated row.

Neighboring behavior that must not regress:

- Equivalent legacy rates must not create duplicate history.
- Conflicting aliases/rates must remain retained and unresolved rather than guessed.
- Original `pricing` rows and their notes/sources must remain readable.
- Existing Registry/Catalog/Override snapshots and calculated costs must remain byte/value stable.
- Input-order determinism and exclusive `effectiveTo` behavior must remain intact.

Repair acceptance condition:

After a later authored-history update, migrated legacy rows are bounded or otherwise prevented from
being selected outside the allowed pre-authored interval. New runs at dates inside/outside each
boundary select the expected registry rate or remain unpriced; no stale legacy rate wins. Repeating
the same update is idempotent, reversed legacy-row order remains deterministic, legacy originals are
retained, and all existing snapshot-immutability and registry-precedence tests pass.

## Likely Working Set

This is an advisory starting set; the repair worker remains free to inspect other repository
surfaces when evidence requires it.

- `src/main/store.ts`
  - `TelemetryStore.readFromDisk`, `initializeRegistry`, `mutate`, `requireNewProfile`
  - reason: startup seeding and every guarded dataset write converge here; the backup provenance
    check must be added without weakening existing live-file and recovery behavior.
- `src/shared/registry.ts`
  - `reconcileLegacyPricing`, `priceAt`, `backfillRegistry`, `registrySnapshot`
  - reason: legacy migration boundaries, registry authority, historical price selection, and
    registry snapshots converge here.
- `src/shared/data.ts`
  - `applyMutation`, `snapshotRun`, `mergeImport`
  - reason: registry installation/update, telemetry transactions, explicit corrections, and
    backfill invocation determine when the affected resolver is used.
- `tests/registry-store.test.ts`
  - registry startup, atomic write, and late-file regression coverage
  - reason: the existing test file has the closest storage setup and should gain the existing-profile
    backup race case.
- `tests/registry.test.ts`
  - migration, precedence, boundary, and deterministic identity cases
  - reason: the stale migrated-history sequence is a domain-level regression missing from the suite.
- `tests/store.test.ts`
  - existing storage provenance and atomic replacement behavior
  - reason: storage changes must preserve the pre-Slice persistence contract.
- `scripts/electron-new-profile-qa.mjs`, `scripts/electron-registry-qa.mjs`
  - isolated runtime, profile-copy, restart, and UI/operator flows
  - reason: use these only for targeted end-to-end confirmation after domain/storage regressions are
    repaired; do not treat QA-window scheduling workarounds as product behavior.
- `docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json`
  - read-only authority
  - reason: confirm repaired behavior still accepts and bundles the unchanged canonical contract;
    do not edit this file.

## Known Invariants

- Historical price snapshots remain frozen across registry metadata, alias, name, status, rate,
  migration, restart, and backfill changes.
- Ambiguous identity, missing identity evidence, unknown explicit IDs, missing dates, and missing
  applicable rates remain unresolved rather than guessed.
- Existing telemetry, legacy pricing rows, sources, notes, and relationships are not lost.
- Storage provenance and recovery evidence remain intact; external live/backup changes fail closed.
- Registry updates plus migration/backfill publish atomically as one dataset transaction.
- SchemaVersion 1 telemetry and raw import/export compatibility remain intact.
- Registry offers own registered model/provider pricing; exact legacy fallback remains only for
  unregistered pairs under the agreed policy.
- UTC `startAt` → `pricingReferenceDate` → `slice.startDate` precedence and exclusive `effectiveTo`
  remain unchanged.
- Cost remains fresh input × input rate + cached input × cached rate + output × output rate; reasoning
  is not charged twice and cache-write metadata is not inferred as a charge.
- Comparer behavior and existing analysis boundaries remain unchanged.
- The canonical seed and its benchmark values remain unchanged and no runtime dependency on
  repository `docs/` is introduced.

## Suggested Verification Focus

Run the smallest targeted checks first:

1. Existing-profile backup provenance: read a valid live/no-registry profile, create or alter the
   backup before seeding, attempt `initializeRegistry()`, and assert a rejection, unchanged exact
   bytes, unchanged memory/revision, and recovery evidence preserved. Also confirm a normal existing
   profile with no race still seeds and rotates the expected prior live dataset.
2. Migrated-history update: install an empty-history offer with an earlier legacy row, add authored
   history after the migrated row, and test dates before, inside, at the exclusive end, and after the
   authored interval. Repeat with authored history beginning before the migrated row. Verify selected
   prices, snapshot provenance, and no stale legacy selection.
3. Repeat the migration cases with reversed legacy-row order, equivalent aliases, conflicting rates,
   and a second identical registry update. Verify deterministic history and idempotence.
4. Verify existing frozen Registry, Catalog, and Override snapshots remain unchanged in both domain
   and persisted-store paths.
5. Run the existing focused registry/storage suites, then the broader unit suite, typecheck, lint,
   build, diff check, and exact Electron QA command. Keep Electron QA isolated and visible; a
   minimized-window actionability failure is a host/harness issue unless native window state is
   confirmed healthy.

## Ruled-Safe Areas

- The canonical seed is unchanged, validates successfully, and is embedded in `out/main/index.js`;
  the built bundle contains registry data without a runtime `docs/` path.
- Canonical model/provider identity, case/trim matching, first-party maker compatibility, explicit
  ID precedence, ambiguous-alias refusal, and stale/unknown-ID non-guessing passed targeted tests.
- UTC start-date preference, pricing-reference fallback, slice-date fallback, missing-date behavior,
  exclusive `effectiveTo`, canonical Luna/Astra rates, reasoning-inclusive output cost, and
  cache-write noncharging passed targeted/unit tests.
- Ordinary registry metadata/rate/alias updates preserve existing snapshots and costs; eligible
  unpriced Luna/Astra runs backfill, and slice-date backfill works.
- Equivalent/conflicting legacy rows, one-shot earlier-history migration, reversed alias order,
  legacy retention, registered precedence, v1 import/export, and raw export idempotence passed the
  current suite and targeted runtime/domain checks within the covered authored-history shape.
- Invalid registry updates, failed atomic live replacement, new-profile late live/backup races,
  backup-only recovery, restart persistence, and current operator-profile-copy preservation passed
  the existing tests/QA. The real profile remained unchanged by hash.
- The bounded registry UI visibly exposes model, maker, provider offer, aliases, reasoning levels,
  pricing/history, benchmarks, status, validation errors, update preview, and restart persistence;
  the 900px registry view had no page-level horizontal overflow.

## Open Questions / Uncertainty

- Existing unpriced runs for an unregistered model/provider pair remain unpriced during registry
  installation; exact legacy fallback is applied on a new import or interactive save. The documents
  describe this as a compatibility path, but the authoritative wording does not unambiguously state
  whether legacy-only pairs must also be frozen by automatic installation backfill. Do not change
  this behavior without resolving that product-policy question.
- `legacyPricingIds` provenance is validated for shape but not globally for uniqueness or references
  across all offers. No canonical migration path produced a duplicate ID, so this was not treated as
  a blocking finding; hardening it may affect deliberately imported registry history.
- Stable IDs are intentionally authoritative during manual run correction. If an operator changes a
  display model/provider without correcting or clearing the attached IDs, the old stable identity
  remains authoritative. The UI documents this, but the desired operator UX for that correction
  remains a product decision.
- Offer/model status is displayed and historical price applicability is preserved. Whether retired or
  inactive offers should be excluded from new automatic resolution is not specified by the canonical
  seed and was not changed.
- Packaged AppImage installation and non-Linux operating systems were not exercised. Electron Linux
  production output, preload/IPC, isolated profile, restart, and visible-window QA were exercised.

## Explicit Non-Goals

- Do not redesign the Compare/comparer or add recommendation/ranking behavior.
- Do not build a parallel storage or pricing subsystem.
- Do not delete or silently rewrite legacy pricing rows, telemetry, or existing snapshots.
- Do not alter the canonical seed or benchmark evidence.
- Do not add network price fetching, provider connections, dependencies, deployment, or packaging
  scope.
- Do not infer cache-write token charges or alter the established cost formula.
- Do not broaden the repair into unrelated acceptance-time, export-safety, or analysis redesign work.
- Do not treat QA-only window foregrounding/background-throttling controls as production fixes.
