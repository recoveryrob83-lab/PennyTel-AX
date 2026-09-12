# Model Registry implementation verification · 2026-09-12

Implemented from local `main` / `origin/main` at `67466fd15c9c25cb719bda26020436bc01bc3bc4` (the canonical seed commit). No implementation commit was created, following the README workflow. The canonical seed and its benchmarks are unchanged. See [architecture and compatibility contract](model-registry.md).

## Architecture delivered

- Strict registry domain types and runtime validation, with nested field-path errors.
- Optional v1 `Dataset.registry`, bundled seed, and startup installation through the existing guarded atomic transaction path. Registry, migration and eligible backfill publish as one dataset revision.
- Stable optional run `modelId` / `providerId`, deterministic canonical-name/API-ID/alias matching, and first-party maker-name compatibility for legacy OpenAI runs. Ambiguous or missing identities remain unresolved.
- Reference-date preference: UTC `startAt` → explicit `pricingReferenceDate` → `slice.startDate`. Newest covering price, with exclusive `effectiveTo`.
- Immutable existing snapshots during registry updates and backfill, with rate/date/offer/revision/source provenance for new snapshots.
- Retained legacy pricing records: registry precedence, equivalence reconciliation, safe earlier-history migration with original record IDs, visible conflicts, and exact legacy fallback only for unregistered pairs.
- Bounded Model Registry inspection and validated import/update view. Existing comparison UI/calculations remain unchanged.

## Files changed

| Area                        | Files                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry domain             | `src/shared/registry.ts` (new), `src/shared/types.ts`, `src/shared/data.ts`, `src/shared/fields.ts`                                                                                                   |
| Persistence / runtime entry | `src/main/store.ts`, `src/main/index.ts`                                                                                                                                                              |
| UI                          | `src/renderer/src/pages/Registry.tsx` (new), `src/renderer/src/pages/Pricing.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/components/RecordEditor.tsx`, `src/renderer/src/components/ui.tsx`   |
| Automated tests             | `tests/registry-fixtures.ts`, `tests/registry.test.ts`, `tests/registry-store.test.ts`, `tests/registry-ui.test.tsx` (all new)                                                                        |
| Electron QA                 | `scripts/electron-registry-qa.mjs` and `scripts/electron-qa-capture.mjs` (new), `scripts/electron-new-profile-qa.mjs`, `scripts/electron-smoke.mjs`, `scripts/electron-repair-qa.mjs`, `package.json` |
| Documentation               | `docs/model-registry.md` (new), this verification record (new), `docs/data-contract.md`, `README.md`                                                                                                  |

## Automated verification

- `npm test`: **145 passed across 11 test files**, including the original 87 cases and 58 new cases.
- `npm run typecheck`: main/preload/shared, renderer, and test typechecks pass.
- `npm run lint -- --max-warnings=0`: passes.
- `npm run build`: passes, including typechecks and all Electron/renderer bundles. The seed is embedded in the main bundle.
- `npm run test:electron`: **passes end to end** on the final build: existing smoke, repair QA, new-profile QA and registry QA.
- `git diff --check`: passes.

New tests cover canonical validation, all ID/reference classes, invalid rates/dates/policy/efforts/benchmarks/unknown fields, historical price windows, each reference-date fallback, UTC rollover, ambiguous identity, missing dates, Luna/Astra cost math, snapshot immutability, eligible backfill after updates/imports/slice edits, retained legacy records, safe migration and conflict handling, input-order determinism, v1 portability and raw export round trips. Store cases cover new-profile initialization, existing-profile migration, restart, failed validation/write atomicity, concurrent initialization and pre-seed late-file provenance. UI cases cover metadata visibility, accessible editable input, validation errors, preview and failed-save draft retention.

The old low-level new-profile provenance tests remain unchanged. The Electron new-profile script now starts at revision 1 because canonical seeding is the first guarded write; it checks external-byte replacement after that write. Additional store tests exercise live/backup/both appearing between the initial empty read and the seed transaction.

## Actual Electron QA

The scripts launch the production Electron output with sandbox=true, contextIsolation=true and nodeIntegration=false. Native file dialog return paths are supplied by Playwright, while preload, IPC, validation, storage writes and browser interaction are real. No renderer exceptions were observed. Registry QA launches with a working directory outside the repository root, proving it does not need `docs/` beside the running application. Screenshots of metadata, invalid-import errors and 900px layout were visually inspected.

Existing smoke covers pricing creation and frozen cost, remaining-meter math, record/evidence editing, protected deletion, comparison lifecycle economics, comparison/raw exports, import rejection, restart and narrow layout. Repair QA covers acceptance time/DST, protected export filesystem aliases, backup-only recovery, restored writes and sandbox preferences. New-profile QA covers IPC/UI save rejection, recovery byte preservation and restored restart.

Registry QA covers:

1. Existing profile opens with all original telemetry fields retained and canonical registry available.
2. Luna/Astra maker, provider offers, aliases/status, reasoning levels, current pricing and benchmarks are visible.
3. Already-existing unpriced Luna/Astra runs resolve from slice dates, without fabricated timestamps.
4. Existing snapshots survive registry metadata/rate updates unchanged.
5. Invalid file import is rejected in the UI and independently through main-process IPC; live and backup bytes remain identical.
6. A valid registry update persists and newly eligible aliases backfill.
7. Raw dataset export/import remains idempotent; registry and telemetry survive restart; 900px viewport has no page-level horizontal overflow.

Successful evidence directories:

- `test-results/electron-qa-4dN6Oy/` — existing smoke.
- `test-results/repair-runtime-UR2SlA/` — existing repair QA.
- `test-results/new-profile-runtime-5PGKOF/` — new-profile QA.
- `test-results/registry-runtime-aWp1mV/` — complete synthetic registry QA.
- `test-results/registry-runtime-kxF0kL/` — complete existing operator profile copy QA, screenshots, raw export and `report.json`.

The existing operator profile was read from `/home/rob/.config/PennyTel/telemetry.json` and copied into an isolated repository QA directory. Its original bytes were checked unchanged after the test. All **5 slices, 22 runs, 20 findings, 3 discoveries and 6 legacy pricing rows** were preserved. **8** previously unpriced runs resolved using **2026-09-05** slice dates; all **12** prior snapshots were unchanged. The two human-operator runs remained unpriced.

Example API-equivalent costs from that copy: `pvui05-luna-impl-001` **$0.05548756** and `pvui05-astra-impl-001` **$2.297676**. Synthetic reference counts (138,187 fresh input, 2,902,400 cached input, 69,046 output including 11,505 reasoning) produce Luna **$0.1685406** and Astra **$7.73657**.

## Verification incidents and limits

The initial sandboxed Electron launch was blocked. The configured approval reviewer permitted the normal desktop QA commands; application security settings were not weakened. An initial exact-label selector failure exposed an input label containing the textarea; separating the label fixed its accessible name and added UI regression coverage. Intermittent animation-frame actionability waits also affected the existing smoke suite and a profile-copy run. QA startup now foregrounds each window, disables background animation/timer throttling for that QA WebContents only, and uses the installed Playwright Chromium harness’s renderer/occluded-window scheduling flags; normal click checks and production/security preferences remain unchanged. A diagnostic at the repeated screenshot failure confirmed the native QA window was hidden and minimized. Restoring it before capture completed the smoke suite; the shared QA capture helper now restores/focuses only the test window before screenshots. The registry harness retains failure evidence. Initial test-authoring failures (an import revision expectation and an unsupported test-library option) were corrected before final checks.

No package/dependency installation, production-profile writes, network fetching, git publication or deployment was performed. Packaged AppImage installers and other operating systems were not exercised; production bundles were run in actual Linux Electron. The original profile will migrate when opened with this implementation. Current comparison grouping still uses its existing display fields. Registry revisions remain operator-supplied labels. Cache-write rates are preserved but not charged separately because current telemetry has no cache-write token count. Legacy fallback remains only for unregistered pairs, under documented registry precedence.

## Implementation token telemetry

This session does not expose authoritative fresh-input, cached-input, output or reasoning token counts. Those values and implementation API-equivalent cost are **unknown**, not zero; no counts or timestamps were invented. An importable telemetry stub is retained at `test-results/model-registry-implementation-telemetry.json` with unknown usage fields omitted for later completion from authoritative session telemetry.
