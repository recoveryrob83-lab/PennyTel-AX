# PennyTel v0.1 · Issue #1 verification

Verified September 11, 2026 (America/Chicago), in `/home/rob/dev/PennyTel-AX`, against [Issue #1](https://github.com/recoveryrob83-lab/PennyTel-AX/issues/1). Baseline: `dd623a6e3fc371cee3a6b085db56cf402214a09d`. This supersedes the first-pass record's token/meter/grade assumptions and earlier unsuccessful Sheet access.

## Source access gate

Both the issue and authoritative Sheet loaded **before repair writes**. Connected Google Drive/Sheets returned **PennyTel — Model & Factory Telemetry v0.1**. Slices, Runs, Findings, Discoveries, Pricing, and Data Dictionary were reviewed. The Sheet was not modified. See [field reconciliation](schema-reconciliation.md).

## Automated checks

| Check                                         | Result                                                    |
| --------------------------------------------- | --------------------------------------------------------- |
| `npm test`                                    | 63 tests passed across 7 files                            |
| `npm run typecheck`                           | Node/main/preload/shared, renderer, and tests passed      |
| `npm run lint -- --max-warnings=0`            | Passed, zero lint errors/warnings                         |
| `npm run build`                               | Passed, production main/preload/renderer output generated |
| `git diff --check`                            | Passed                                                    |
| `node scripts/electron-smoke.mjs` after build | Passed in actual Electron                                 |

Existing npm mirror settings emit npm configuration warnings, not ESLint warnings or test/build failures. No dependencies were installed or changed.

Regression coverage:

- Fresh plus additional cached token pricing, cached greater than fresh, no double reasoning charge, zero/missing counts, weighted cache ratios.
- Remaining-meter decrease, increase/reset, explicit burn including zero, missing readings, endpoint bounds.
- Numeric integer 1–5 grades; invalid grades rejected.
- Multiple slices; model/role filters must match the same run; downstream critic/repair retained; post-acceptance work excluded; empty slices without run filters.
- Separate finding evidence/judgment fields, adoption Deferred, pricing-source snapshot round trips.
- Readable timestamps, winter/summer timezone behavior, date-only timezone safety.
- Shared UI/export context, grouping/order/selection, lifecycle membership, severity/category cross-counts, validated discoveries, grade distributions, non-mutating analysis.
- Export unknown/zero/partial coverage, JSON serialization, stale/untrusted request rejection, analysis-import rejection, visible export failures.
- Existing relationship protection, historical snapshots, atomic persistence, detached reads, stale writes, failed atomic replacement, corrupt-data refusal.
- Existing editor draft retention/discard, unknown versus false, relationship choices, load failure handling.

## Actual Electron workflows

Production-built Electron was driven through real UI controls with isolated synthetic telemetry, not an operator profile.

1. Created a historical price with separate source, then a slice with workflow, ambiguity, and risk.
2. Entered the issue's actual-shaped counts unchanged: **138,187 fresh / 2,902,400 cached / 69,046 output / 11,505 reasoning**. At synthetic QA rates **$2 / $0.50 / $10 per million**, cost is **$2.418034** and cache displays **95.5%**. These are test rates, not claimed provider prices.
3. Rejected reasoning greater than output without losing the draft, then corrected it.
4. Recorded **94% remaining → 92% remaining**, displaying **2 pp**. Marked a reset and observed Unknown; explicit burn restored 2 pp.
5. Verified readable run timestamps and acceptance time, with exact ISO retained in export.
6. Created a P1 Product finding with discovering/repair run links and distinct Title, Description, Evidence, Contract / Invariant, Impact, Confidence, Notes.
7. Created a self-initiated, absent-from-prompt, independently validated discovery with **Adopted = Deferred**.
8. Accepted the slice and selected quality **5**; verified Unknown/1/2/3/4/5 options and **5 / 5** display.
9. Attempted referenced-critic deletion and observed protected rejection without data loss.
10. Created a second accepted slice containing only another model's incomplete/unpriced run.
11. Changed the catalog rate to 999; saved run rates and cost remained unchanged.
12. Filtered by implementation model, role, and thinking. The second slice disappeared. The first retained other-model Critic/Repair work: **$3.258034** accepted cost, including **$0.42 critic + $0.42 repair**.
13. Exported filtered analysis; checked actual app version, format/revision/timestamp, filters/group/sort/cohort, lifecycle, role costs, grade, P1 Product count, validated discovery, burn.
14. Cleared filters and exported all-cohort analysis; verified partial overall coverage and null unknown cost for the other slice.
15. Exported raw JSON; checked ISO, exact tokens, richer evidence, adoption, revision, historical source snapshot. Reimport preview skipped all 9 identical records. Comparison JSON was rejected as non-importable.
16. Imported a new slice from a real file through preview/save. Conflicting IDs and malformed JSON were rejected.
17. Closed and restarted Electron. Records, links, adoption, burn, and historical cost persisted.
18. Checked 900px layout with no document-level horizontal overflow and no renderer exceptions.

Native dialog return paths were supplied by Playwright. UI actions, preload/IPC, validation, serialization, and filesystem persistence were real. Desktop/narrow screenshots were visually inspected. Linux process restrictions required the configured approval-reviewed execution environment; renderer sandbox, context isolation, and host settings were not weakened or changed.

Successful runtime artifacts: `test-results/electron-qa-GwWU5j/`

- `01-empty.png`, `02-slice.png`, `03-compare.png`, `03-filtered-cohort.png`, `04-narrow.png`
- `telemetry.json`, `telemetry.backup.json`
- `qa-export.json`, `qa-comparison.json`, `qa-comparison-all.json`, `qa-import.json`

Earlier attempts remain under ignored `test-results`; all are synthetic and isolated.

## Additional material discoveries

- Adoption includes Deferred; the old boolean lost meaning. Corrected to Yes/No/Deferred.
- Pricing Source is distinct from Notes; both are preserved, and source is frozen in new catalog snapshots.
- Electron `app.getVersion()` returned **0.0** on direct built-entry launch, causing incorrect new-export provenance. Export now uses bundled package metadata; runtime QA asserts it matches `package.json`.
- Meter resets cannot be recovered from endpoints alone. Explicit reset reporting prevents unsafe inference when known; hidden resets remain documented as unknowable.

An ambiguous harness label was also corrected; it was not an application defect.

## Remaining limits

No known unresolved material defect from this bounded pass. Schema v1 is directly corrected under the issue's no-production-dataset instruction; older synthetic exports require explicit correction/regeneration, not automatic migration. The Sheet is a reviewed schema source, not a runtime integration. Incomplete telemetry stays optional; an unreported meter reset cannot be inferred.

Packaged installers and other operating systems were not tested. Verification covers local Linux Electron. Native picker interaction itself was not automated. Physical power-loss recovery was not tested; atomic replacement failure is covered. Unsaved drafts do not persist after quitting. Local JSON remains intended for personal datasets, not concurrent multi-user/high-volume ingestion.

Exact final model token telemetry is not exposed by this environment. No git commit was created.
