# PennyTel JSON contract · v2

[Issue #1](https://github.com/recoveryrob83-lab/PennyTel-AX/issues/1) is the bounded acceptance-repair contract. The [authoritative Sheet](https://docs.google.com/spreadsheets/d/11U6HKqnbNN0NsE-y8CKrg6P4KOXlei0MhQXJaUdD6s4/edit) was read through connected Google Drive/Sheets, including Slices, Runs, Findings, Discoveries, Pricing, and Data Dictionary. See [field reconciliation](schema-reconciliation.md). The Sheet is not a runtime dependency. Code authority: `src/shared/types.ts`, `fields.ts`, `data.ts`, `metrics.ts`, and `comparison.ts`.

PennyTel 0.2.0 advances the raw dataset to v2 under [Issue #15](https://github.com/recoveryrob83-lab/PennyTel-AX/issues/15). Existing valid v1 datasets remain compatible through explicit deterministic normalization. The earlier Issue #1 corrections still apply: `inputTokens` means fresh input, `qualityGrade` is numeric 1–5, usage readings are percent remaining, and discovery adoption is a Yes/No/Deferred enum. Pre-correction test exports still need explicit correction; migration does not reinterpret old semantics.

## Envelope and ingestion

```json
{
  "schemaVersion": 2,
  "revision": 0,
  "slices": [],
  "runs": [],
  "findings": [],
  "discoveries": [],
  "pricing": []
}
```

Exports always emit schema v2, all arrays, and the installed optional `registry` object. The [Model Registry contract](model-registry.md) defines validated registry import/update, stable run IDs and pricing precedence; the registry's own schema version remains 1. Imports accept `schemaVersion: 1` or `2` and may omit empty arrays and revision. Imported revisions are ignored; local revision increments on a successful transaction. Records have stable string IDs unique within their table (1–200 characters, no surrounding whitespace). Unknown fields, null, blank strings, invalid enum values, nonfinite/negative numbers, duplicate IDs within a batch, and missing/cross-slice references are rejected. Optional fields should be omitted when unknown. Existing flat string fields are limited to 100,000 characters; execution metadata has tighter bounds below. Imports remain limited to 10 MB.

### V1 compatibility and persistence

`normalizeDataset()` validates the original version's envelope and records, returns a detached schema-v2 dataset, and validates relationships. For v1, the only migration change is `schemaVersion: 1 → 2`: revision, IDs, links, registry, historical price snapshots, all existing values and all omissions are preserved exactly. V1 cannot contain the new `executionEvidence` property. Unsupported versions and invalid historical data fail safely. `validateDataset()` validates canonical v2 only; callers handling external historical data must normalize first.

Loading v1 does not rewrite the live file, create a backup, increment revision, backfill pricing, or fabricate execution evidence. Main retains the original live bytes for provenance checks. The next ordinary mutation writes v2 and backs up the exact previous live bytes, including its original schema version. Existing registry startup behavior is separate: a missing registry still triggers the established guarded registry-install transaction and its normal backfill. A profile with a registry needs no startup write. Failed mutations retain live bytes, authoritative memory and revision; failed live replacement may rotate the backup to the exact previous live bytes, as before.

V1 import batches use the same envelope/record normalization before merging, with relationships validated against combined stored/imported rows. Normal import snapshot attachment and registry backfill still apply; migration itself never reselects historical prices. Source hashes/session/turn IDs are provenance, not alternate record identity: only table IDs control additive merge/conflicts. Multiple turns may share one source file/hash. There is no silent hash-based dropping of runs.

Import merges all arrays as one transaction. A child may refer to a parent already stored or supplied in the same batch. Identical records are skipped by value, independent of JSON key order. Conflicting existing IDs reject the entire import. Use the record editor for corrections; imports never overwrite stored history. Reimporting an exported dataset is idempotent. Raw batches that omit subsequently attached price snapshots may conflict with their stored versions; use the current export when retrying such records.

Synthetic minimal example (illustration only; not real telemetry):

```json
{
  "schemaVersion": 2,
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

Optional strings: `project`, `repository`, `taskShape`, `factoryVersion`, `baseline`, `contractVersion`, `promptHash`, `experiment`, `preferredCandidate`, `notes`. Optional `qualityGrade` is a numeric integer **1–5**, reflecting final operator judgment.

| Field                   | Values / units                                     |
| ----------------------- | -------------------------------------------------- |
| `productionModel`       | Solo, Orchestrated, Full Pipeline, Custom          |
| `ambiguity`, `risk`     | Low, Medium, High                                  |
| `disposition`           | In progress, Accepted, Rejected, Abandoned         |
| `startDate`             | YYYY-MM-DD                                         |
| `acceptedAt`            | ISO timestamp with timezone                        |
| `timeToAcceptedMinutes` | Nonnegative number; measured elapsed time override |

Cost, meter burn, repair passes, and validated autonomous discovery count are derived from related records. There is no manually stored total that can drift from its evidence. The preferred candidate/model remains free text. Quality is the operator's 1–5 judgment, not an automated or combined score.

## Run fields

Required: `id`, `sliceId`, `runType` (free text), `role`.

Optional strings: `candidate`, `model`, `modelFamily`, `provider`, `orchestratorModel`, `notes`. Optional stable identity: `modelId`, `providerId` (1–200 characters, no surrounding whitespace). Optional `pricingReferenceDate` is a valid `YYYY-MM-DD` date.

| Field                                   | Values / units                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `role`                                  | Orchestrator, Context Steward, Implementer, Critic, Repair                   |
| `thinking`, `orchestratorThinking`      | Low, Medium, High, ExtraHigh, Max                                            |
| `sessionMode`                           | Fresh, Resumed                                                               |
| `contextMode`                           | Full Repo, Compact Packet, Resumed Context, Orchestrated Packet, Other       |
| `orchestrated`, `runtimeTested`         | true / false; omitted means unknown                                          |
| `startAt`, `endAt`                      | ISO timestamp with timezone, e.g. 2026-09-11T10:00:00-05:00                  |
| `localHour`                             | Integer 0–23; explicitly operator-local                                      |
| `dayOfWeek`                             | Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday               |
| `wallMinutes`                           | Nonnegative number; overrides end minus start                                |
| `usageBefore`, `usageAfter`             | Percent remaining, 0–100; comparable readings from the same meter            |
| `usageBurn`                             | Explicit nonnegative percentage points consumed; authoritative when supplied |
| `usageReset`                            | Optional boolean; true disables inferred burn across reset/replenishment     |
| `inputRate`, `cachedRate`, `outputRate` | All three together, or all omitted; USD / million token overrides            |
| `buildResult`                           | Passed, Failed, Not run                                                      |
| `result`                                | Completed, Accepted, Needs repair, Rejected, Blocked, Aborted                |

Nonnegative whole-number fields: `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningTokens`, `filesChanged`, `implementationAdded`, `implementationDeleted`, `testAdded`, `testDeleted`, `testsAdded`, `testsPassed`, `testsFailed`, `testsSkipped`, `humanInterventions`, `clarifications`, `autonomousDefects`, `scopeViolations`, `toolIncidents`.

Input tokens are fresh/noncached input. Cached input is additional and may exceed fresh input. Reasoning must not exceed output when both are known. End may not precede start. Decimal values are supported for rates, minutes, and percentage measurements. Booleans have three meaningful states: true, false, omitted.

Inferred burn is `usageBefore - usageAfter` when both are known, after is no greater than before, and no reset is reported. `94 → 92` means 2 percentage points consumed. An increase or `usageReset: true` makes inferred burn unknown; explicit `usageBurn`, including zero, remains authoritative. An unreported reset cannot be identified from endpoints alone. A run's explicit burn may exceed 100 across known replenishments; before/after percentages cannot.

### Saved run pricing

`priceSnapshot` is optional in imported runs and present in priced exports. When omitted for a new run, the app attaches applicable registry pricing or the three explicit overrides. Registry installation/update and telemetry transactions backfill eligible existing unpriced runs. Existing snapshots are never replaced by registry changes. Exact legacy catalog pricing remains a compatibility fallback only for model/provider pairs absent from the registry.

Snapshot fields: `model`, `provider`, `effectiveDate`, `inputRate`, `cachedRate`, `outputRate`, `source` (`Catalog`, `Override` or `Registry`), optional `pricingId`, and optional `rateSource` (the catalog entry's source at attachment time). Snapshot model/provider must match the run (empty only when an override has no model/provider recorded). Catalog snapshots require a run date and cannot have an effective date after it. `pricingId` is historical provenance, not a live foreign key: deleting a catalog entry leaves its snapshots intact. Imported snapshots retain original rates/source even when the catalog has changed.

Interactive save always resolves snapshots in the main process. An existing snapshot stays fixed on token-count or note edits. Explicit model, provider, stable ID, start timestamp, pricing reference date, or override corrections cause re-selection. All three overrides are the explicit correction route. Undated overrides omit `effectiveDate`; the UI identifies the date as unknown. Catalog snapshots always require an effective date. Registry snapshots additionally retain `modelId`, `providerId`, `offerId`, `registryRevision`, `referenceDate`, `referenceDateSource`, `rateSource`, and optional `cacheWriteRate`. They do not require a run timestamp: the reference can come from `pricingReferenceDate` or `slice.startDate`. See the registry contract for exclusive pricing end dates and immutable evidence rules.

```
cost = (inputTokens * inputRate
        + cachedInputTokens * cachedRate
        + outputTokens * outputRate) / 1,000,000
```

All three token counts and a snapshot are needed for complete cost. Calculations retain JS number precision; dollar display rounds to at most four decimals. Dates use calendar validation; timestamps must include `Z` or an explicit offset. A pricing effective date starts at midnight UTC.

Cache ratio is `cachedInputTokens / (inputTokens + cachedInputTokens)` when both counts are known and their sum is nonzero. Aggregate ratios use the sum of known cached tokens over the sum of fresh plus cached input for the same eligible runs. Normal UI timestamp displays are locale-aware with a timezone label; saved/exported values stay ISO. Calendar-only dates stay on their original calendar day.

### Structured execution evidence (v2)

`Run.executionEvidence` is optional. The currently supported source is `kind: "codex-rollout"`, `formatVersion: 1`. These two discriminators are required when the object is present. The evidence format version is independent of the dataset, registry, and CLI/runtime versions. Other kinds/versions require an explicit future contract change; they are rejected today. Every other property is optional and must be omitted when unobserved. An absent object, partial object or empty quota array does not establish zero activity or complete observation coverage. Explicit numerical zero means an observed zero.

All nested objects reject unknown properties, nulls and invalid types. Metadata strings must be nonempty, have no surrounding whitespace or control/format characters, and fit the limits below. No catch-all metadata/payload property exists. Counts are finite nonnegative safe integers (maximum `Number.MAX_SAFE_INTEGER`); window sizes/lengths are positive safe integers. TTFT may be fractional, finite, nonnegative and no greater than `Number.MAX_SAFE_INTEGER`.

| Property                                | Contract                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceLog`                             | Optional object; required `fileName` is a basename (1–255 characters, no `/` or `\`, not `.` or `..`). The raw log remains external.                                                                                                                                                                                                |
| `sourceLog.contentHash`                 | Optional object with required `algorithm: "sha256"` and `value`: exactly 64 lowercase hexadecimal characters. Hash exact source-file bytes, without decoding, newline normalization, redaction, or JSON reserialization. Never guess a digest. PennyTel validates representation; it does not read/hash/verify external logs.       |
| `sessionId`, `turnId`                   | Recorded source IDs, 1–200 characters without any whitespace; preserved verbatim, not required to be UUIDs and not used as run IDs automatically.                                                                                                                                                                                   |
| `runtimeVersion`                        | Recorded Codex CLI/runtime version, at most 100 characters.                                                                                                                                                                                                                                                                         |
| `originator`                            | Recorded source/originator identifier, at most 200 characters.                                                                                                                                                                                                                                                                      |
| `workingDirectory`                      | Recorded path, at most 4096 characters; inert metadata, never opened or used for filesystem authority.                                                                                                                                                                                                                              |
| `repository`                            | Optional object with optional `url` (2048 characters), `branch` (255), `baselineCommitSha` (full 40- or 64-character lowercase hex commit ID). No URL is fetched; omit credentials or sensitive URL components. No local HEAD/branch inference.                                                                                     |
| `timeToFirstTokenMs`                    | Observed latency in milliseconds. Omit if source boundaries cannot establish it.                                                                                                                                                                                                                                                    |
| `modelInvocationCount`, `toolCallCount` | Observed normalized counts for the run's identified execution scope. Missing events/uncertain scope must not become a fabricated complete count.                                                                                                                                                                                    |
| `modelContextWindowTokens`              | Recorded model context-window size. Never derive it from model naming.                                                                                                                                                                                                                                                              |
| `peakInvocation`                        | Optional object with required `inputTokens`: maximum observed input/context occupancy for an invocation, **including cached input**. Optional `cachedInputTokens` is a subset and cannot exceed that input. Optional `contextWindowTokens` is the window recorded for that same peak invocation. No raw invocation trace is stored. |
| `quotaWindows`                          | Optional array of at most 16 coarse window observations, as defined below.                                                                                                                                                                                                                                                          |
| `environment`                           | Optional recorded execution constraints, as defined below.                                                                                                                                                                                                                                                                          |

Peak context utilization is `peakInvocation.inputTokens / peakInvocation.contextWindowTokens` only when both are known for the same invocation. When the paired window is present, it must be positive and `0 <= inputTokens <= contextWindowTokens`; equality represents utilization 1. Above-window input is rejected by shared validation, never clamped or normalized. Do not substitute the top-level model window when its association is unknown, use cumulative run token totals, or add cached input again. A changed window size can mean the maximum occupancy invocation is not the maximum utilization invocation; this contract does not claim otherwise. No utilization percentage is stored or guessed. Unknown sampling coverage does not imply a whole-session maximum.

Each `quotaWindows` entry has required `attribution: "Clean" | "Contaminated" | "Unknown"`, plus optional:

- `windowName`: recorded identifier (100 characters).
- `windowMinutes`: observed window length, positive safe integer minutes.
- `planType`: recorded plan identifier (100 characters).
- `first` / `last`: first/last observed reading objects. Each requires `usedPercent` (finite number 0–100, fractions allowed), with optional `recordedAt` and `resetsAt` ISO timestamps including timezone. Each endpoint keeps its own observed reset boundary, so replenishment or a reset change is representable. Calendar/time rollover, invalid offsets and missing zones are rejected; milliseconds support 1–3 decimal digits. If both reading times exist, last cannot precede first. A lone endpoint is partial evidence.
- `note`: concise attribution reason (500 characters); never a pasted source message or tool output.

`Clean` means explicit evidence supports attribution of these coarse readings to the identified execution scope; `Contaminated` records known other activity; `Unknown` means attribution has not been established. Attribution must be supplied, never inferred by PennyTel from timestamps or endpoint differences. Even `Clean` does not automatically establish per-run burn. Endpoint decreases/reset changes remain representable. Quota `usedPercent` is not remaining percent and is never mapped to `usageBefore`, `usageAfter`, `usageBurn`, pricing, or analytics.

`environment` accepts only these optional recorded values:

- `sandboxMode`: `read-only`, `workspace-write`, `danger-full-access`, `external-sandbox`, `unknown`.
- `approvalPolicy`: `untrusted`, `on-failure`, `on-request`, `never`, `unknown`.
- `approvalReviewer`: `user`, `auto_review`, `unknown`.
- `networkAccess`: `enabled`, `restricted`, `disabled`, `unknown`.

These describe source execution constraints; they grant no permissions to PennyTel. Omit unavailable state. A literal `unknown` is supported when explicitly recorded. Unrecognized future source values require contract reconciliation, not arbitrary strings or inferred capabilities.

The run editor's **Execution evidence** section accepts/inspects this normalized JSON, validates corrections through the existing save path, preserves failed drafts, and allows intentional clearing to Unknown. Ordinary run edits preserve evidence. An evidence-only edit preserves the saved pricing snapshot. No dedicated analytics or parsing UI is introduced.

#### Privacy and semantic authority

The accepted schema contains no prompt, AGENTS/system instructions, hidden/encrypted reasoning, source excerpts, tool commands/output, arbitrary messages, raw JSONL, or per-invocation trace fields. Unknown payload keys are rejected at every nested level. Do not hide payloads or secrets in permitted metadata/note fields; bounded string validation cannot determine a string's real-world meaning. The adapter is responsible for supplying only observed normalized metrics/provenance, with raw logs remaining external.

`sliceId`, `runType`, `role`, `result`, and `contextMode` remain explicit operator/orchestrator metadata on the run. Source session/turn/repository identity must never manufacture those labels. Run input remains fresh input plus separately counted additional cached input; output includes reasoning and reasoning is never billed twice. `peakInvocation.inputTokens` deliberately has the different, cache-inclusive occupancy definition above.

The complete [synthetic evidence fixture](../tests/execution-evidence-fixture.json) illustrates the accepted shape; its IDs, digest, repository, measurements and environment are test data, not real source telemetry.

## Finding fields

Required: `id`, `sliceId`, `severity`, `category`, `description`.

Optional: `runId` (discovered in), `repairRunId`, `userVisible`, `reproducible`, `repairRequired`, `status`, `title`, `evidence`, `contractInvariant`, `impact`, `confidence`, `notes`. The review/evidence fields are separate text fields; confidence/impact have no fixed Sheet scale, so the app preserves the reviewer's wording. Title is optional to support concise, description-only records without losing richer imported review evidence.

- Severity: P0, P1, P2, Observation.
- Category: Product, UX, Architecture, State, Test Gap, Harness, Environment, Scope, Other.
- Status: Open, Repaired, Accepted risk, Dismissed.
- The three question fields are booleans. Evidence is plain text, including links when useful.
- Both run links must point to runs in this finding's slice. A finding may be slice-level when the discovery run is unknown. Repair run linkage does not require a particular role; a combined-role run may perform a repair.

Defects repaired still contribute to historical defect burden. Dismissed findings and observations do not count as defects. A discovered-in link measures which run found an issue; it is not blame attribution.

## Discovery fields

Required: `id`, `sliceId`, `description`.

Optional strings: `runId`, `model`, `discoveryType`, `validatedBy`, `disposition`, `evidence`, `notes`.

| Field                       | Values                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `thinking`                  | Low, Medium, High, ExtraHigh, Max                                                       |
| `inPrompt`, `selfInitiated` | true / false, omitted means unknown                                                     |
| `adopted`                   | Yes, No, Deferred; omitted means unknown                                                |
| `impact`                    | Low, Medium, High                                                                       |
| `validation`                | Pending, Yes, No                                                                        |
| `downstreamValue`           | Prevented Defect, Improved UX, Reduced Cost, Reduced Risk, Improved Verification, Other |

`runId`, when present, must be in the same slice. Linked run identity drives group attribution; optional discovery model/thinking fields preserve source notes. Slice-level discoveries count in the slice summary, but are excluded from run/model comparisons until linked. Validated autonomous credit requires all of `selfInitiated === true`, `inPrompt === false`, and `validation === "Yes"`; adoption and impact are shown separately. Record the independent reviewer and evidence for auditability.

## Pricing fields

Required: `id`, `model`, `provider`, `effectiveDate`, `inputRate`, `cachedRate`, `outputRate`. Optional: `source` (provider reference/link) and separate `notes` (context). Source is also retained as `rateSource` in new catalog snapshots.

Rates are nonnegative USD per million tokens. Only one price may exist for the same exact model, provider, and UTC effective date. Strings match exactly, including case. The operator supplies historical prices; the app does not fetch or guess them. This table is now the retained legacy pricing archive/compatibility path; Model Registry is authoritative for registered offers. See [migration and precedence](model-registry.md#legacy-pricing-precedence-and-migration).

## Analysis boundaries

Acceptance totals include all candidates, failed work, orchestration/context overhead, critics, and repairs in the acceptance window. An undated run is included to avoid silent understatement. With no acceptance timestamp, all runs are included and the UI marks that assumption. A run spanning acceptance is rejected as ambiguous until timestamps are corrected. Post-acceptance evidence remains visible separately from the cost window.

Role subtotals report pricing coverage. No recorded role work is a zero subtotal; recorded but wholly unpriced role work is unknown. Summed run minutes are not elapsed acceptance minutes. Slice filters first select eligible slices. When run filters are active, at least one run in a slice must satisfy all active run filters for that slice to qualify. Once qualified, the slice's full relevant lifecycle is used for acceptance economics, even when other models performed criticism/repair. With no run filters, eligible slices without runs remain visible with unknown costs. No automated model ranking, blame inference, quality normalization, or causal correlation claim is made.

The separate [comparison-analysis export](comparison-export.md) contains derived metrics and context, not raw records. It is marked `kind: "pennytel-comparison"` and has no telemetry `schemaVersion`; import explicitly rejects it. **Export dataset** remains the canonical raw importable export.
