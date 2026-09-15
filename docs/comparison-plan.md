# Comparison plans

PennyTel 0.1.5 accepts a declarative JSON comparison plan through **Run comparison plan** on the Compare page. PennyTel validates the complete plan, binds every request to one current authoritative telemetry snapshot, and writes one derived results bundle through the trusted save dialog.

## Plan schema

The top-level object has exactly these fields:

- `kind`: the literal `pennytel-comparison-plan`.
- `planVersion`: the number `1`.
- `name`: nonempty display text, at most 200 characters.
- `comparisons`: 1–50 comparison entries.

Each comparison has exactly `id`, `name`, and `context`. `id` is unique within the plan, at most 80 characters, begins with a letter or number, and otherwise contains only letters, numbers, `.`, `_`, or `-`. Paths, slashes, and `..` are rejected. Entry names are nonempty display text of at most 200 characters.

`context` is the current `ComparisonContext`: `filters`, `groupBy`, `sort`, and the optional `selectedGroup`, `selectedCandidates`, `stageScopes`, `dateRange`, and `outcomeFilters`. It is validated by PennyTel's ordinary comparison-request validator, so exact-model and canonical model/configuration identities retain their existing distinct semantics.

The plan does not contain a dataset revision. At execution, PennyTel obtains one authoritative dataset snapshot and supplies its revision to every ordinary comparison. Entries execute independently in declared order; filters, stage scopes, selections, and Compare-page UI state never carry between them.

```json
{
  "kind": "pennytel-comparison-plan",
  "planVersion": 1,
  "name": "PennyTel engineering analysis",
  "comparisons": [
    {
      "id": "accepted-outcomes-by-slice",
      "name": "Accepted outcomes by slice",
      "context": {
        "filters": { "project": "PennyTel" },
        "groupBy": "slice",
        "sort": "label"
      }
    },
    {
      "id": "implementation-by-config",
      "name": "Implementation by model configuration",
      "context": {
        "filters": { "project": "PennyTel" },
        "groupBy": "modelConfiguration",
        "sort": "label",
        "stageScopes": [{ "kind": "role", "value": "Implementer" }]
      }
    }
  ]
}
```

## Results bundle

One run writes one `pennytel-comparison-plan-results` object with `resultsFormatVersion: 1`, explicit PennyTel app version, source dataset schema/revision, one shared `generatedAt`, plan identity, and an ordered `results` array. Each result preserves its `id` and `name` and embeds the complete ordinary `pennytel-comparison` analysis, including its normalized reconstructable context and source revision. Results are never reduced to summaries or omitted.

PennyTel 0.2.1 also accepts `evidenceSourceKind` and `runtimeVersion` as ordinary
filter/group dimensions, including `null` filters for missing evidence. Every
embedded analysis includes the shared `analytics.executionEvidence` distributions
and source/runtime coverage described in [comparison export](comparison-export.md).
The plan/result format versions and one-snapshot execution semantics are unchanged.

Plans are executable analysis requests, and results are derived analysis. Neither is telemetry and neither can be imported through Data & portability.

## Security boundary

A plan is data only. It cannot contain commands, JavaScript, code, network resources, or an output path. The renderer receives only a narrow `runComparisonPlan()` API; the main process owns file selection, the authoritative dataset snapshot, execution, the save dialog, and the existing atomic export writer. Running a plan does not mutate telemetry.
