# PennyTel JSON contract · v1

The brief's schema is authoritative for v0.1; the linked working Google Sheet could not be opened during implementation. It is not a runtime dependency. Authoritative code: `src/shared/types.ts` (types), `src/shared/fields.ts` (fields/enums), `src/shared/data.ts` (validation/transactions), and `src/shared/metrics.ts` (calculations).

## Envelope and ingestion

```json
{
  "schemaVersion": 1,
  "revision": 0,
  "slices": [],
  "runs": [],
  "findings": [],
  "discoveries": [],
  "pricing": []
}
```

Exports always contain all arrays. Imports require `schemaVersion: 1` and may omit empty arrays and revision. Imported revisions are ignored; local revision increments on a successful transaction. Records have stable string IDs unique within their table (1–200 characters, no surrounding whitespace). Unknown fields, null, blank strings, invalid enum values, nonfinite/negative numbers, duplicate IDs within a batch, and missing/cross-slice references are rejected. Optional fields should be omitted when unknown. String fields are limited to 100,000 characters; imports to 10 MB.

Import merges all arrays as one transaction. A child may refer to a parent already stored or supplied in the same batch. Identical records are skipped by value, independent of JSON key order. Conflicting existing IDs reject the entire import. Use the record editor for corrections; imports never overwrite stored history. Reimporting an exported dataset is idempotent. Raw batches that omit subsequently attached price snapshots may conflict with their stored versions; use the current export when retrying such records.

Synthetic minimal example (illustration only; not real telemetry):

```json
{
  "schemaVersion": 1,
  "slices": [{ "id": "example-slice", "title": "Example work" }],
  "runs": [
    {
      "id": "example-run",
      "sliceId": "example-slice",
      "runType": "Implementation",
      "role": "Implementer"
    }
  ]
}
```

## Slice fields

Required: `id`, `title`.

Optional strings: `project`, `repository`, `taskShape`, `factoryVersion`, `baseline`, `contractVersion`, `promptHash`, `experiment`, `qualityGrade`, `preferredCandidate`, `notes`.

| Field                   | Values / units                                     |
| ----------------------- | -------------------------------------------------- |
| `productionModel`       | Solo, Orchestrated, Full Pipeline, Custom          |
| `ambiguity`, `risk`     | Low, Medium, High                                  |
| `disposition`           | In progress, Accepted, Rejected, Abandoned         |
| `startDate`             | YYYY-MM-DD                                         |
| `acceptedAt`            | ISO timestamp with timezone                        |
| `timeToAcceptedMinutes` | Nonnegative number; measured elapsed time override |

Cost, meter burn, repair passes, and validated autonomous discovery count are derived from related records. There is no manually stored total that can drift from its evidence. Quality grades and preferred candidate/model are operator-defined strings.

## Run fields

Required: `id`, `sliceId`, `runType` (free text), `role`.

Optional strings: `candidate`, `model`, `modelFamily`, `provider`, `orchestratorModel`, `notes`.

| Field                                    | Values / units                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `role`                                   | Orchestrator, Context Steward, Implementer, Critic, Repair             |
| `thinking`, `orchestratorThinking`       | Low, Medium, High, ExtraHigh, Max                                      |
| `sessionMode`                            | Fresh, Resumed                                                         |
| `contextMode`                            | Full Repo, Compact Packet, Resumed Context, Orchestrated Packet, Other |
| `orchestrated`, `runtimeTested`          | true / false; omitted means unknown                                    |
| `startAt`, `endAt`                       | ISO timestamp with timezone, e.g. 2026-09-11T10:00:00-05:00            |
| `localHour`                              | Integer 0–23; explicitly operator-local                                |
| `dayOfWeek`                              | Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday         |
| `wallMinutes`                            | Nonnegative number; overrides end minus start                          |
| `usageBefore`, `usageAfter`, `usageBurn` | Nonnegative meter units; explicit burn overrides difference            |
| `inputRate`, `cachedRate`, `outputRate`  | All three together, or all omitted; USD / million token overrides      |
| `buildResult`                            | Passed, Failed, Not run                                                |
| `result`                                 | Completed, Accepted, Needs repair, Rejected, Blocked, Aborted          |

Nonnegative whole-number fields: `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningTokens`, `filesChanged`, `implementationAdded`, `implementationDeleted`, `testAdded`, `testDeleted`, `testsAdded`, `testsPassed`, `testsFailed`, `testsSkipped`, `humanInterventions`, `clarifications`, `autonomousDefects`, `scopeViolations`, `toolIncidents`.

Cached input must not exceed total input, and reasoning must not exceed total output when both counts are present. End may not precede start. Decimal values are supported for rates, minutes, and meter units. Booleans have three meaningful states: true, false, omitted.

### Saved run pricing

`priceSnapshot` is optional in imported runs and present in priced exports. When omitted for a new run, the app attaches applicable catalog pricing or the three explicit overrides. It never retroactively attaches prices to unrelated existing runs when a catalog entry is added.

Snapshot fields: `model`, `provider`, `effectiveDate`, `inputRate`, `cachedRate`, `outputRate`, `source` (`Catalog` or `Override`), and optional `pricingId`. Snapshot model/provider must match the run (empty only when an override has no model/provider recorded). Catalog snapshots require a run date and cannot have an effective date after it. `pricingId` is historical provenance, not a live foreign key: deleting a catalog entry leaves its snapshots intact. Imported snapshots retain original rates even when the catalog has changed.

Interactive save always resolves snapshots in the main process. An existing snapshot stays fixed on token-count or note edits. Model, provider, start timestamp, or override changes cause re-selection. All three overrides are the explicit correction route. Undated overrides omit `effectiveDate`; the UI identifies the date as unknown. Catalog snapshots always require an effective date.

```
cost = ((inputTokens - cachedInputTokens) * inputRate
        + cachedInputTokens * cachedRate
        + outputTokens * outputRate) / 1,000,000
```

All three token counts and a snapshot are needed for complete cost. Calculations retain JS number precision; dollar display rounds to at most four decimals. Dates use calendar validation; timestamps must include `Z` or an explicit offset. A pricing effective date starts at midnight UTC.

## Finding fields

Required: `id`, `sliceId`, `severity`, `category`, `description`.

Optional: `runId` (discovered in), `repairRunId`, `userVisible`, `reproducible`, `repairRequired`, `status`, `evidence`.

- Severity: P0, P1, P2, Observation.
- Category: Product, UX, Architecture, State, Test Gap, Harness, Environment, Scope, Other.
- Status: Open, Repaired, Accepted risk, Dismissed.
- The three question fields are booleans. Evidence is plain text, including links when useful.
- Both run links must point to runs in this finding's slice. A finding may be slice-level when the discovery run is unknown. Repair run linkage does not require a particular role; a combined-role run may perform a repair.

Defects repaired still contribute to historical defect burden. Dismissed findings and observations do not count as defects. A discovered-in link measures which run found an issue; it is not blame attribution.

## Discovery fields

Required: `id`, `sliceId`, `description`.

Optional strings: `runId`, `model`, `discoveryType`, `validatedBy`, `disposition`, `evidence`, `notes`.

| Field                                  | Values                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `thinking`                             | Low, Medium, High, ExtraHigh, Max                                                       |
| `inPrompt`, `selfInitiated`, `adopted` | true / false, omitted means unknown                                                     |
| `impact`                               | Low, Medium, High                                                                       |
| `validation`                           | Pending, Yes, No                                                                        |
| `downstreamValue`                      | Prevented Defect, Improved UX, Reduced Cost, Reduced Risk, Improved Verification, Other |

`runId`, when present, must be in the same slice. Linked run identity drives group attribution; optional discovery model/thinking fields preserve source notes. Slice-level discoveries count in the slice summary, but are excluded from run/model comparisons until linked. Validated autonomous credit requires all of `selfInitiated === true`, `inPrompt === false`, and `validation === "Yes"`; adoption and impact are shown separately. Record the independent reviewer and evidence for auditability.

## Pricing fields

Required: `id`, `model`, `provider`, `effectiveDate`, `inputRate`, `cachedRate`, `outputRate`. Optional: `notes` (source/context).

Rates are nonnegative USD per million tokens. Only one price may exist for the same exact model, provider, and UTC effective date. Strings match exactly, including case. The operator supplies historical prices; the app does not fetch or guess them.

## Analysis boundaries

Acceptance totals include all candidates, failed work, orchestration/context overhead, critics, and repairs in the acceptance window. An undated run is included to avoid silent understatement. With no acceptance timestamp, all runs are included and the UI marks that assumption. A run spanning acceptance is rejected as ambiguous until timestamps are corrected. Post-acceptance evidence remains visible separately from the cost window.

Role subtotals report pricing coverage. No recorded role work is a zero subtotal; recorded but wholly unpriced role work is unknown. Summed run minutes are not elapsed acceptance minutes. Slice-level filters affect accepted-slice comparisons; model/role/session filters apply only to run comparisons so they cannot hide downstream costs. No automated model ranking, blame inference, quality normalization, or causal correlation claim is made.
