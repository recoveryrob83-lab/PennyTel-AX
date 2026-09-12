# PennyTel v0.1

A local PennyOS Engineering telemetry workbench. Record slices, runs, findings, discoveries, and historical pricing; compare accepted work by cost, time, quality, role, and workflow. Electron + React + TypeScript, using the supplied electron-vite scaffold. No additional dependencies were needed.

## Run locally

With the scaffold's installed dependencies:

```bash
npm run dev
```

Or run the production build:

```bash
npm run build
npm start
```

Use Electron, not the renderer URL in a standalone browser. The renderer deliberately has no browser-storage fallback. No account, network connection, Google Sheet access, or API key is required. The notebook starts empty; there is no generated production telemetry or assumed model pricing.

## First workflow

1. In **Pricing history**, add the provider's historical USD rates with an effective date, exact model, and provider.
2. In **Slice notebook**, create a bounded piece of work. Only an ID and title are required. Add project, task shape, ambiguity, risk, and workflow when known.
3. Add implementation, criticism, repair, or other runs. A run needs an ID, slice, run type, and factory role. Record the model/provider, timestamps, and token counts to calculate cost. Enter explicit zeroes when usage is known to be zero.
4. Add findings with distinct severity/category and links to discovery/repair runs. Add autonomous discoveries and update independent validation when evidence arrives.
5. Use **Accept now** in an in-progress slice's editor to set Accepted and stamp the current time, then **Save slice**. Quality grade and preferred candidate remain your separate judgments. Edit acceptance with the local date/time control (timezone shown), or choose the explicit exact ISO-with-timezone option. Existing acceptance times disable Accept now until explicitly cleared; changing disposition retains acceptance history. Operator-measured time to acceptance is also supported.
6. In **Compare**, group and filter runs, inspect the underlying evidence, and compare full accepted-slice economics. A slice must contain a run matching all active run filters to qualify; its cost still includes the full relevant lifecycle across all models and roles. Use **Export comparison** to save the current derived analysis separately from the raw dataset.

Every record can be edited. Deletion asks for confirmation and protects referenced slices/runs. Deleting a price retains run snapshots. Closing an edited form requires explicit discard; a failed save keeps the draft open. Unsaved drafts do not persist after quitting the application.

## Persistence and portability

The Electron main process owns the dataset. It validates every transaction, serializes writes, checks revisions, writes a temporary file, flushes it, and atomically replaces `telemetry.json`. When a live revision exists, the previous revision is saved as `telemetry.backup.json`; the first save in a genuinely new profile creates only the live file. A single-instance lock prevents competing application instances from editing the same profile.

**Data & portability** shows the exact storage path. Default storage is Electron's per-user PennyTel application-data directory. `PENNYTEL_DATA_DIR=/absolute/path` selects another directory, useful for a portable dataset or isolated QA. Close PennyTel before manually replacing its data files. If a dataset cannot be read or validated, the app preserves it and refuses writes. To recover, close the app and restore a valid export or its previous-revision backup to `telemetry.json`.

A missing live file with any backup entry (including damaged or dangling recovery evidence) also blocks loading and writes. Before restoring, preserve a separate copy of the backup, then copy a valid dataset to `telemetry.json` while PennyTel is closed. Saves recheck the live file before rotating backups; external changes require reopening the app.

Both exports reject live/backup filesystem aliases, including hard links and paths through linked directories. Symlink destinations and indeterminate file identities are rejected conservatively. Choose a regular export file; it is written through atomic replacement rather than truncating a followed link.

Export a JSON dataset through the native save dialog. Import a JSON file or pasted batch, validate/preview, and then add its records. Import is atomic and additive: identical records are skipped; conflicts and invalid relationships are rejected. No existing records are silently overwritten. Export regularly to retain more than one revision. See [the data contract](docs/data-contract.md).

## Measurement conventions

- Input tokens mean **fresh / noncached** input. Cached input is additional and may exceed fresh input. Cost is `(fresh × input rate + cached × cached rate + output × output rate) / 1,000,000`. Output tokens **include** reasoning tokens; reasoning is not billed twice.
- Automatic pricing uses the latest effective date on or before the run's start date in UTC and an exact model/provider match. A run stores a price snapshot; catalog edits do not recalculate history. Edit/save an unpriced run after adding a matching price. All three rate overrides allow an explicit historical correction.
- Missing data remains unknown. Partial totals show known cost and record coverage. No-rate or unknown-token runs are not treated as free. Cache ratio is `cached / (fresh + cached)`, token-weighted across runs with both counts known. A zero denominator stays unknown.
- Run time is the sum of recorded wall times. Time to acceptance is operator-measured or elapsed from the first recorded run to the acceptance timestamp; concurrent runs are not summed into elapsed acceptance time.
- Accepted-slice cost includes all candidates and roles that started by acceptance, plus undated runs. Without an acceptance timestamp it includes all runs and says so. A run crossing the acceptance boundary must have its timestamps corrected. Post-acceptance findings/discoveries remain in the slice evidence.
- Subscription burn is separate from dollar cost. Record **remaining percentages** from 0–100: `94 → 92` burns **2 percentage points**. An increase or `usageReset: true` makes inferred burn unknown. Explicit measured `usageBurn` overrides these rules. Endpoints alone cannot detect a hidden reset; mark one when known. Local hour and weekday remain explicit operator-local telemetry.
- Validated autonomous discovery means `selfInitiated: true`, `inPrompt: false`, and `validation: "Yes"`. Unknown prompt presence does not earn credit. Adoption is separately recorded as Yes, No, or Deferred.
- A finding's run link identifies where it was discovered, not which model caused it. P0/P1/P2 counts exclude dismissed findings and observations but retain repaired defects. Findings preserve title, description, evidence, contract/invariant, impact, confidence, and separate notes.
- Final product quality is an **operator-assigned integer 1–5**. Compare can filter by grade; the analysis export provides grade distributions without a synthetic combined score.
- Normal timestamp displays use human-readable local dates/times with a timezone label. Persisted timestamps and exported timestamps remain ISO with timezone. Calendar-only dates are displayed without timezone shifts.
- Acceptance edits use the computer's local timezone and persist ISO UTC (`Z`); unchanged timestamps keep their original offset and precision. Nonexistent daylight-saving times are rejected, and repeated local times require the exact timestamp option with an explicit offset.

## Authoritative schema and analysis export

[Issue #1](https://github.com/recoveryrob83-lab/PennyTel-AX/issues/1) and all six relevant tabs in the [PennyTel Sheet](https://docs.google.com/spreadsheets/d/11U6HKqnbNN0NsE-y8CKrg6P4KOXlei0MhQXJaUdD6s4/edit) were read through the connected GitHub and Google Drive/Sheets capabilities before repairs began. See the [complete reconciliation](docs/schema-reconciliation.md) for each field and the intentional differences. Per the issue, there is no production dataset; the v1 contract is corrected directly, without migration. Old synthetic exports with inclusive input semantics or letter grades must be regenerated or explicitly corrected before use.

**Export dataset** remains canonical, raw, importable JSON. **Export comparison** creates `kind: "pennytel-comparison"`, analysis format v1 JSON containing app version, source revision, generated timestamp, active context, cohort/evidence IDs, group summaries, full acceptance economics, severity/category counts, validated discoveries, grade distributions, and coverage. It is explicitly rejected by telemetry import. The main process derives it from its authoritative snapshot using the same calculations as the UI. Partial totals and unknowns remain distinguishable; no PDF/CSV/reporting infrastructure is added. See [the analysis contract](docs/comparison-export.md).

## Verification

```bash
npm run typecheck
npm test
npm run lint -- --max-warnings=0
npm run build
npm run test:electron
```

Unit tests cover costing, pricing history, missing data, role subtotals, acceptance, discovery credit, schema validation, relationship protection, imports, storage recovery behavior, stale writers, and editor drafts. `test:electron` builds and runs Playwright against the actual Electron app. It creates **synthetic QA records only** in a new `test-results/electron-qa-*` directory. It exercises record creation/editing, pricing snapshots, comparison/filtering, protected deletion, JSON import/export, restart persistence, and narrow-window layout. Screenshots are retained there. Native file dialog return paths are supplied by the harness; application IPC, validation, and filesystem operations are real. A working desktop display is required. Linux sandbox restrictions may require your normal approved execution environment; the app itself does not disable its renderer sandbox.

See the [verification record](docs/verification.md) for results, runtime evidence, and verification limits.

## Implementation map and limits

- `src/shared`: explicit typed contract, form field metadata, validation/transactions, and deterministic metrics.
- `src/main`: durable local store, native import/export dialogs, and narrowly scoped IPC.
- `src/preload`: typed API only; no generic IPC or filesystem access in the renderer.
- `src/renderer/src`: modular notebook, comparisons, pricing, portability, and shared editor/detail components.
- `tests` and `scripts/electron-smoke.mjs`: automated and actual Electron verification.

v0.1 loads one JSON dataset into memory and rewrites it per transaction. It is intended for personal engineering datasets, not high-volume event streams or multi-user editing. JSON import is the ingestion seam; CSV/Sheet adapters, live prices, multiple currencies, model execution, integrations, cloud sync, authentication, inference of missing telemetry, and statistical significance claims are deliberate non-goals. Packaged installers are configured but are separate from the verified local development/production workflow. No commit is created as part of implementation.
