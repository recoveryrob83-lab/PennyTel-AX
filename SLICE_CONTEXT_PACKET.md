# PennyTel Slice 1 — Re-Critic Context Packet

## Candidate

Repository: `recoveryrob83-lab/PennyTel-AX`

Slice branch: `eng/pennytel-slice-1-model-registry`

Original Slice 1 baseline: `67466fd15c9c25cb719bda26020436bc01bc3bc4`

Code candidate reviewed for this packet: `b287e9b32c7ad18f82c126a5f0ebd970c1902352`

The code candidate contains the full Slice 1 Model Registry implementation plus the bounded Astra Low repair. This context-packet commit is documentation only and is not part of the product-code repair.

## Re-Critic Objective

Independently verify that the two material findings from the first Luna Max critic pass are repaired without introducing regressions:

1. **P0 storage provenance:** an existing-profile backup that appears, changes, disappears, or is replaced after initial load must block mutation before cached state is published or recovery evidence is rotated away.
2. **P1 pricing authority:** previously migrated legacy pricing must be re-bounded or removed when later authored registry history takes authority; migrated legacy history must never reappear after authored history or win inside authored history.

If both repairs hold and no repair-induced material defect is found, this candidate may proceed toward Engineering acceptance.

## Context Discipline

Start with this packet.

Then inspect **only the repair working set below** and the named tests. Prefer symbol-scoped reads and focused test execution.

Do **not** broadly re-crawl the repository or re-audit first-pass ruled-safe areas unless:

- repair behavior points to another dependency;
- a focused test fails outside the named surfaces;
- an invariant cannot be verified from the working set; or
- runtime evidence conflicts with the first critic pass.

If additional context is required, expand deliberately and report why.

Purpose: minimize context trawl, fresh input-token load, repeated reads, and wall-clock time without restricting necessary discovery.

For the original defect reproductions and broader first-pass evidence, deeper context is available at:

`docs/Slice_1_Repair_Context_Packet.md`

Read that file only when the concise reproduction/acceptance information below is insufficient.

## Repair Working Set

### P0 — Storage provenance

Primary file:

- `src/main/store.ts`

Primary symbols:

- `TelemetryStore.readBackupState`
- `TelemetryStore.readFromDisk`
- `TelemetryStore.initializeRegistry`
- `TelemetryStore.mutate`
- `TelemetryStore.requireNewProfile`
- `TelemetryStore.atomicWrite`

Repair shape visible in the candidate:

- `readFromDisk()` now captures the loaded live-file bytes and backup state.
- `readBackupState()` fingerprints backup filesystem identity/state plus exact bytes.
- `mutate()` rechecks both live bytes and backup state before backup rotation.
- External backup appearance/change/disappearance/replacement rejects before publishing the mutation.
- After PennyTel performs its own backup rotation, the stored backup state is refreshed so a later live replacement failure can be retried without mistaking PennyTel's own rotation for an external change.

Primary tests:

- `tests/registry-store.test.ts`
- neighboring persistence behavior in `tests/store.test.ts` only if needed

New/repair-focused coverage includes:

- existing-profile backup **appears** after load;
- existing-profile backup **changes** after load;
- existing-profile backup **disappears** after load;
- existing-profile backup is **replaced** after load;
- persisted repair behavior while preserving Registry/Catalog/Override snapshots.

Highest-value adversarial checks:

1. Reproduce all four backup-state changes and verify rejection occurs before either live or recovery evidence is overwritten.
2. Verify exact live/backup bytes and cached in-memory data remain unchanged after rejection.
3. Verify an ordinary existing-profile registry seed still succeeds and rotates the prior live dataset into backup.
4. Verify new-profile provenance guards still reject late live/backup appearance.
5. Verify a failed live replacement after PennyTel's own backup rotation remains recoverable/retryable and does not create a false external-change condition.

### P1 — Migrated legacy pricing authority

Primary file:

- `src/shared/registry.ts`

Primary symbols:

- `reconcileLegacyPricing`
- `priceAt`
- `registrySnapshot`
- `backfillRegistry`

Integration file only if needed:

- `src/shared/data.ts` — registry-import mutation path

Repair shape visible in the candidate:

- Before normal reconciliation, existing migrated history is re-evaluated against the earliest authored history entry.
- A migrated row starting on/after the first authored entry is removed.
- A migrated row beginning before authored history is clipped so its exclusive `effectiveTo` is no later than the first authored date.
- Authored history owns every date from its first entry onward, including gaps after a finite authored interval; legacy history must not resume afterward.

Primary tests:

- `tests/registry.test.ts`
- persisted integration coverage in `tests/registry-store.test.ts`

New/repair-focused coverage includes:

- authored history beginning **after** the migrated legacy row;
- authored history beginning **before** the migrated legacy row;
- before/inside/exclusive-end/after boundary checks;
- repeated update idempotence;
- reversed equivalent alias order determinism;
- preservation of frozen Registry/Catalog/Override snapshots.

Highest-value adversarial checks:

1. Start with an empty-history registered offer, migrate an earlier legacy rate, then add finite authored history later. After the authored interval ends, the stale legacy rate must **not** return; the run should remain unpriced unless another authored rate applies.
2. Add authored history beginning before the migrated row; the migrated row must not override it at later dates.
3. Repeat the same registry update and reverse equivalent legacy alias input order; resulting registry history must remain deterministic/idempotent.
4. Confirm original legacy pricing records remain preserved.
5. Confirm existing frozen price snapshots and calculated costs remain unchanged.

## Repair-Specific Files Reported Changed

The Astra Low repair session reported modifications only to:

- `src/main/store.ts`
- `src/shared/registry.ts`
- `tests/registry-store.test.ts`
- `tests/registry.test.ts`

The branch as a whole contains the full Slice 1 implementation across additional files. Those broader files were already independently inspected during the first Luna Max critic pass. Reopen them only when repair evidence requires it.

## First-Pass Ruled-Safe Areas

The first critic pass independently exercised and found no blocking issue in these areas. Do not spend context re-proving them from scratch unless the repair touches their invariant or new evidence contradicts the prior result:

- canonical seed validation, embedding, and runtime reload;
- duplicate/reference/date/rate/enum/benchmark validation;
- ambiguous identity and stale/unknown-ID refusal;
- pricing reference precedence and exclusive `effectiveTo` semantics;
- frozen snapshot immutability across metadata, alias, rename, rate, restart, and backfill changes;
- cost calculation, reasoning-token handling, and cache-write noncharging;
- schema v1 loading, legacy readability, import/export;
- ordinary new-profile provenance and backup-only recovery;
- registry UI, update preview, invalid-update rejection, restart persistence, and 900px layout;
- Comparer behavior, which remains outside Slice 1 scope;
- canonical registry seed contents, which must remain unchanged.

## Hard Invariants

- External live/backup changes fail closed before recovery evidence or cached data is silently overwritten.
- PennyTel's normal atomic backup rotation still works.
- Registry update plus reconciliation/backfill remains one atomic dataset transaction.
- Authored registry history owns registered pricing from its first authored date onward; migrated legacy history may only fill an earlier historical gap.
- Original legacy rows remain readable/preserved.
- Frozen historical snapshots remain unchanged.
- Missing or ambiguous identity/date/rate evidence remains unresolved rather than guessed.
- Existing telemetry and schema-v1 compatibility remain intact.
- Canonical seed remains unchanged.
- Comparer remains out of scope.

## Suggested Verification Order

Run the smallest useful checks first.

1. Focused registry/storage tests:

   `npx vitest run tests/registry-store.test.ts tests/registry.test.ts`

2. If focused checks pass, run broader unit verification:

   `npm test`

3. Then run repository gates as warranted:

   `npm run typecheck`

   `npm run lint -- --max-warnings=0`

   `npm run build`

   `git diff --check`

4. Run exact Electron QA when needed for final runtime confidence:

   `npm run test:electron`

Keep headful Electron QA visible/unminimized. If actionability or screenshot waits occur, inspect host/native window state before inferring a product defect.

## Prior Repair Report — Evidence, Not Proof

The Astra Low repair worker reported:

- focused registry/storage suites: 77 passed;
- full unit suite: 152 passed;
- typecheck/lint/build/diff check passed;
- exact Electron QA passed;
- canonical seed unchanged;
- no commit created during the repair session.

Treat these as worker claims to verify, not as acceptance evidence by themselves.

## Remaining Known Non-Blocking Uncertainty

Do not broaden this re-critic into policy design unless a repair depends on it:

- automatic backfill policy for legacy-only unregistered pairs;
- manual correction UX when stable IDs remain attached;
- global `legacyPricingIds` uniqueness policy;
- inactive/retired-offer applicability policy;
- packaged installers and non-Linux runtime environments.

## Explicit Non-Goals

- Do not redesign Comparer.
- Do not redesign Model Registry architecture unless a material repair defect proves it necessary.
- Do not alter the canonical seed.
- Do not add provider/network pricing.
- Do not add dependencies or packaging scope.
- Do not repair unrelated findings in this critic session.
- Do not commit product-code changes during criticism.

## Re-Critic Output

Return:

- verification performed;
- P0 repair verdict;
- P1 repair verdict;
- any new P0/P1/P2 findings with concrete evidence;
- any repair-induced regression;
- remaining uncertainty;
- final disposition: `ACCEPT REPAIR`, `REPAIR REQUIRED`, or `REJECT`;
- git status and confirmation that no product-code changes were made;
- Codex telemetry footer values: fresh input, cached input, output, reasoning, displayed total, worked wall time, and visible weekly usage if available.

If no material issue remains, say so directly and stop rather than searching for additional scope.