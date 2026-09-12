# PennyTel v0.1 verification

Verified on September 11, 2026 (America/Chicago), in `/home/rob/dev/PennyTel-AX`.

## Automated checks

| Check                                                   | Result                                               |
| ------------------------------------------------------- | ---------------------------------------------------- |
| `npm test`                                              | 44 tests passed across 4 files                       |
| `npm run typecheck:node`                                | Passed                                               |
| `npm run typecheck:web`                                 | Passed                                               |
| `npm run typecheck:tests`                               | Passed                                               |
| `npm run lint -- --max-warnings=0`                      | Passed, zero errors/warnings                         |
| `npm run build`                                         | Passed; main, preload, and renderer output generated |
| `git diff --check`                                      | Passed                                               |
| `node scripts/electron-smoke.mjs` after the final build | Passed in the running Electron application           |

The repository's preexisting npm mirror configuration emits npm deprecation/config warnings. Those do not represent lint, test, or build failures. No dependencies were installed or changed.

## Actual Electron workflows

The final smoke run drove UI controls in the production-built Electron application. It created isolated synthetic QA records, never production telemetry.

- Empty notebook and historical price creation.
- Slice creation with task shape, workflow, ambiguity, and risk.
- Implementation, Critic, and Repair runs, including incomplete telemetry.
- Expected $0.34 run cost with cached input discounted and reasoning not billed twice.
- Invalid cached token count rejection, draft correction, and successful save.
- P1 Product finding linked to the discovering Critic and repairing run.
- Self-initiated discovery absent from the prompt, independently validated and counted.
- Slice acceptance time, quality grade, and preferred candidate editing.
- Protected deletion of a run referenced by a finding; no data loss.
- Catalog rate changes with original run snapshots and costs retained.
- Model and role grouping, thinking/role filters, and retained full slice acceptance cost despite filtering to Implementers.
- JSON export, real file import with preview, and atomic save.
- Conflicting import ID and malformed JSON rejection.
- Full Electron process close and relaunch, retaining records, relationships, and historical prices.
- 900px window layout with no document-level horizontal overflow.
- No renderer exceptions.

The native file pickers' return paths were supplied by Playwright for deterministic testing. The application's UI actions, IPC, validation, export/import code, and disk persistence were exercised. Screenshots were visually inspected at desktop and narrow widths. Linux process sandbox restrictions required the configured approval-reviewed execution environment for Electron; no host configuration or app sandbox settings were changed.

Final runtime evidence is retained in the ignored local directory:

`test-results/electron-qa-aPihn8/`

- `01-empty.png`
- `02-slice.png`
- `03-compare.png`
- `04-narrow.png`
- `telemetry.json`, `telemetry.backup.json`, `qa-export.json`, `qa-import.json`

Earlier QA attempts are also retained under `test-results`. All are labeled synthetic and separate from the default operator profile.

## Material verification findings

Role subtotals initially risked displaying zero when all runs of that role were unpriced. This was corrected: an unpriced Critic/Repair role reports unknown, with pricing coverage. An absent role reports zero. Regression tests cover this distinction.

Undated runs with explicit rate overrides calculate cost without inventing a pricing effective date. Their snapshot omits the date and the UI reports it as unknown. Regression tests cover this behavior.

Storage tests also cover rejected stale revisions, failure to replace the live file, detached read snapshots, and preservation/refusal to overwrite corrupt data. UI tests cover draft retention on save failure, explicit discard, unknown vs false booleans, same-slice relationship choices, and load failure without a writable empty fallback.

## Limits of verification

Packaged Windows/macOS/Linux installers were not produced or tested. The verified target is the local Electron application on this Linux desktop. This is a personal JSON dataset, not a high-volume or concurrent multi-user database. Disk-full behavior is represented by an atomic replacement failure test; physical power-loss recovery was not tested. Native file chooser interaction itself was not automated. Unsaved drafts do not persist after quitting the application.

The Google Sheet could not be opened, so implementation follows the supplied brief. Exact final model token telemetry was not exposed by this environment. No git commit was created.
