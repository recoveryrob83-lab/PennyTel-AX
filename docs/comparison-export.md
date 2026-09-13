# Comparison-analysis JSON · format v1

Use **Export comparison** on Compare. Use **Export dataset** on Data & portability for the canonical raw telemetry backup. They are separate artifacts with different purposes. Analysis exports are not importable telemetry and the importer explicitly rejects them.

The renderer sends only `{ revision, context }` through the typed preload API. The main process validates the request, reads its own authoritative dataset, rejects a stale revision, and builds analysis using `src/shared/comparison.ts`, also used by the UI. It never trusts derived metrics supplied by the renderer. Native save dialogs and the live-file/backup protection are shared with raw export. Export is read-only with respect to the dataset and its revision. App version comes from bundled package metadata, including when launching the built Electron entry file directly.

| Field                   | Meaning                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`                  | `pennytel-comparison`                                                                                                                                                                       |
| `analysisFormatVersion` | `1`; distinct from dataset schema version                                                                                                                                                   |
| `app`                   | PennyTel name and actual running app version                                                                                                                                                |
| `source`                | Raw dataset schema version and revision at export                                                                                                                                           |
| `generatedAt`           | ISO timestamp with timezone                                                                                                                                                                 |
| `context`               | Active filters, `groupBy`, sort (`label`, `cost`, `time`), optional selected group, selected Model Configuration keys, and stage scopes                                                     |
| `cohort`                | Eligible slice IDs, qualified slice IDs, matching run IDs, displayed evidence run IDs, resolved selected group                                                                              |
| `summary`               | Overall matching-run metrics, recorded defect counts, validated autonomous discoveries, accepted-slice quality distribution                                                                 |
| `groups`                | Ordered groups, membership IDs, run metrics, findings/discovery IDs and counts, distinct accepted-slice grade distributions                                                                 |
| `candidates`            | Selected configuration keys/labels in selection order, scoped membership, coverage-aware metrics, linked evidence, and touched-slice dispositions                                         |
| `acceptedSlices`        | Qualified accepted slices with all relevant lifecycle run IDs, outcome judgment, elapsed acceptance time/basis, role cost, severity/category evidence, discoveries, and timing completeness |
| `conventions`           | Interpretation of tokens, meter, cohort, acceptance, evidence attribution, quality, and unknown values                                                                                      |

Context filters use the same keys as the UI: project, taskShape, ambiguity, risk, productionModel, experiment, disposition, qualityGrade, modelConfiguration, canonicalModel, modelFamily, model, thinking, role, sessionMode, contextMode. Cleared filters are omitted. Grouping supports modelConfiguration (the default), canonicalModel, modelFamily, model, thinking, role, slice, candidate, productionModel, sessionMode, contextMode, localHour, dayOfWeek. A selected group only narrows the underlying-evidence list, as in the UI; it does not change the comparison cohort or acceptance costs.

Slice 3 adds optional `context.selectedCandidates` and `context.stageScopes`. Omitted collections mean empty selection, preserving older analysis-v1 requests. This state is ephemeral: it travels with the analysis request/export and is not written into telemetry or restored on app restart. Keep the context and the matching raw dataset revision to reproduce the workspace through `compareData()`.

- `selectedCandidates` contains up to **8 unique canonical Model Configuration keys**, in column/selection order. Eight is an explicit small-workspace limit; larger datasets remain accessible through the existing groups and filters. Each key must be a canonical JSON configuration tuple with a valid model-identity tuple and recorded thinking vocabulary, within `MAX_DERIVED_IDENTITY_LENGTH` and the existing source-string limits. Presentation labels and `XHigh` are not key values.
- Candidate selection is separate from ordinary filters and `selectedGroup`. Selected keys match alternative candidates (OR); each candidate partitions the already-qualified observed runs. Selection does not remove runs/slices from the base cohort or assign accepted economics to candidates. A candidate with no scoped runs stays present, with count 0 and unknown cost/time/token totals.
- `stageScopes` contains up to **16 unique scopes**. `{ "kind": "role", "value": "Implementer" }` is Implementation; `Critic` and `Repair` match their exact structured roles. `{ "kind": "runType", "value": "Verification" }` matches that exact recorded source text. Scope objects have exactly those two fields; run-type text is nonblank and bounded to 100,000 UTF-16 units. Duplicates are rejected regardless of object property order.
- The UI offers exact run types present in the dataset, preserving case and whitespace. Re-critic/Verification have no inferred role mapping or built-in normalized stage. Unknown or unavailable stage identity is never assigned from chronology, result, tests, findings, or links.
- Multiple stage scopes OR together, then AND with all ordinary run-filter conditions on the same run. Active stages qualify only slices containing scoped matching evidence. No stage selection preserves all-run behavior, including eligible empty slices. Qualified accepted slices still retain their full relevant lifecycle across stages and candidates.

The additive top-level `candidates` array follows selected-key order. Every entry includes `key`, dataset-wide collision-safe `label`, `runIds`, `sliceIds`, `metrics`, linked `findings`, `defects`, linked `discoveries`, and `sliceDispositions`. Candidate discoveries include all linked records, with their recorded validation status; the existing group/summary validated-autonomous counts retain their established stricter predicates. Dispositions count distinct touched slices and do not attribute the slice outcome to the candidate. Run IDs resolve to inspectable source records in the matching raw export. The existing `groups`, `cohort.evidenceRunIds`, and `selectedGroup` keep their presentation semantics independently of candidate columns.

Model Configuration is derived by `src/shared/configuration.ts`: a valid recorded registry model ID wins; otherwise the existing registry resolver must resolve canonical/API/alias names with provider evidence unambiguously. Unresolved identity keeps the exact recorded model text and any explicit unresolved model ID. No new alias matching is introduced. Provider and offer are not configuration dimensions, and pricing resolution is unchanged.

The canonical model key is the JSON tuple `["model", modelId]`; unresolved model keys are `["unresolved-model", modelId-or-null, exact-model-or-null]`. Configuration keys are JSON tuples `[model-key-string, recorded-thinking-or-null]`. Missing thinking is a distinct null key component displayed as **Unknown**; it is never inferred from capabilities. Recorded `ExtraHigh` displays as **ExtraHigh / XHigh**, but the key and raw telemetry retain `ExtraHigh`. This does not add `XHigh` or registry `xhigh` to the telemetry import vocabulary. Display labels are not identities: filters and selected groups use the keys, so equal labels cannot merge different IDs.

`canonicalModel` rolls configurations together by that same model identity. `modelFamily` groups exact recorded family evidence with keys `["family", family-or-null]`; missing family remains Unknown. Existing `model` (Exact model) and `thinking` dimensions retain their source-field semantics. None of these derivations persists new fields, migrates data, changes snapshots, or recalculates historical prices. The format remains additive analysis v1; raw telemetry remains schema v1.

Each metric bundle reports run count, cost in USD, mean cost of priced runs, summed wall-clock minutes, usage burn in percentage points, weighted cache ratio/coverage, repair pass count, and role cost totals. Numeric measurements are not display-rounded.

Each bundle also includes `evidence.numeric` measured totals for `inputTokens` (fresh), `cachedInputTokens`, `outputTokens`, `reasoningTokens`, `filesChanged`, `testsAdded`, `testsPassed`, `testsFailed`, and `testsSkipped`. Reasoning remains a subset of output and never enters pricing independently. File and test totals sum recorded run counts; they do not assert unique files or tests across runs. `evidence.buildResult`, `runtimeTested`, `result`, and `role` report `{ counts: [{ value, count }], recorded, total, complete }`. Missing booleans are unknown; recorded `false` remains No. Candidate `sliceDispositions` uses the same count shape with a distinct-slice denominator.

Cost means cover priced runs only, with the denominator in `costUSD.recorded`. Cache coverage counts runs with both input counts; even complete input-pair coverage can yield a null ratio when the summed denominator is zero. Burn uses existing reset/increase/explicit-override semantics and includes coverage. There is no weekly usage series or meter identity in schema v1. File lists, test names, and verification artifacts are likewise unavailable and are not synthesized.

Totals use:

```json
{
  "knownTotal": 6,
  "completeTotal": null,
  "recorded": 3,
  "total": 4,
  "complete": false
}
```

This means 3 of 4 relevant runs have that measurement and sum to 6; the complete total is unknown. A wholly unknown measurement has `knownTotal: null`. Known zero is `0`. A role with no recorded runs has a zero subtotal; a role with recorded but wholly unpriced work has an unknown subtotal. Empty comparison/run sets are not represented as known free work. Ratio denominators of zero are unknown. Empty role subtotals do not assert there was no unrecorded work.

Defects preserve separate `bySeverity`, `byCategory`, and `bySeverityAndCategory` counts. Dismissed findings and observations are counted separately and excluded from defects. These are counts of recorded evidence; zero does not prove defect-free work. Run/group finding counts attribute where findings were discovered, not fault. Accepted-slice counts retain all slice evidence, including later evaluation.

Quality remains operator judgment on the integer 1–5 scale. Distributions include graded/ungraded counts and counts for each grade. A group’s quality distribution concerns distinct accepted slices touched by its matching runs; it does not assign the whole outcome to a single model. No synthetic weighted score is created.

Acceptance economics qualify slices using all active filters and stage scopes, then include their full relevant lifecycle through acceptance, including other models' critics, repairs, and overhead. Candidate selection does not affect qualification or lifecycle cost. Undated runs remain included and listed. Missing acceptance timestamps are flagged as unbounded. Known costs can be complete for recorded runs even when acceptance timing is incomplete; those two coverage dimensions are kept separate.

Retain the matching raw dataset export to inspect source evidence and saved pricing. A revision is local to one dataset, not a globally unique experiment ID. Prices are not fetched or recalculated from current market rates during export.
