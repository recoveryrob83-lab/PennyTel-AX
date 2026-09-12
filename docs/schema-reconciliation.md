# Authoritative Sheet reconciliation · acceptance repair

## Access and authority

Before any repair writes, both [GitHub Issue #1](https://github.com/recoveryrob83-lab/PennyTel-AX/issues/1) and its [linked Sheet](https://docs.google.com/spreadsheets/d/11U6HKqnbNN0NsE-y8CKrg6P4KOXlei0MhQXJaUdD6s4/edit) loaded successfully. The connected Google Drive / Google Sheets capability returned the workbook **PennyTel — Model & Factory Telemetry v0.1**, locale en_US, timezone America/Chicago. The review read all populated header columns and available validation metadata for Slices, Runs, Findings, Discoveries, and Pricing, plus the populated Data Dictionary (16 definitions). The Sheet was not modified and is not a runtime dependency.

Issue #1 governs the bounded repair and explicitly permits direct correction of schema v1 because no production dataset exists. No legacy migration, permissive coercion of old test exports, spreadsheet adapter, or synchronization was added.

## Material reconciliation decisions

- Fresh input and cached input are separate additive counts. The Sheet dictionary agrees with the corrected cache denominator. Reasoning remains a subset of output, never separately billed.
- Remaining meter endpoints are percentages; consumed burn is percentage points. Added optional `usageReset` because endpoints cannot reliably identify a replenishment. Explicit `usageBurn` is authoritative, even across a reported reset. An increase without an explicit burn remains unknown.
- Quality is a numeric integer 1–5, not text and not a synthetic score. Comparisons support grade filtering, accepted-slice grade displays, and exported grade distributions.
- Findings retain Title, Description, Evidence, Contract / Invariant, Impact, Confidence, and Notes independently. No confidence or impact scale is specified for findings, so these review judgments remain text. Finding Title is optional; Description remains required.
- The Data Dictionary's discovery adoption vocabulary is **Yes / No / Deferred**, which a boolean cannot preserve. Adoption now uses that enum, independently of validation.
- Pricing **Source** and **Notes** are separate. New catalog snapshots freeze source as `rateSource`, so subsequent catalog edits do not rewrite historical provenance. The snapshot's existing `source` distinguishes Catalog from Override.
- The dictionary marks ambiguity, risk, factory topology, session/context mode, and certain discovery answers required. Those remain optional in the application to support the brief's incomplete-telemetry workflow. Unknown is explicit; validation/credit is never inferred. Factory Role and necessary identity/relationship fields remain required.
- Totals, run costs, and discovery counts are derived, not independently editable copies. This avoids drift and preserves pricing/measurement coverage. Measured wall time, acceptance time, and burn can still be explicitly supplied where their measurement cannot be recovered from evidence.
- The Sheet's local timestamp columns map to ISO timestamps with mandatory zone/offset. Display is human readable in the operator's local timezone; stored/exported values retain their exact ISO representation. Date-only fields stay on the original calendar day.

The following tables map **every populated entity header**. A derived mapping intentionally has no duplicate stored column. Raw JSON uses field names, not Sheet header aliases; unrecognized import fields are rejected rather than silently discarded. See [data contract](data-contract.md) for types, required fields, validation, and acceptance-window semantics.

## Slices · 23 columns

| Sheet header                     | Runtime field / handling                                                          |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Slice ID                         | `id`                                                                              |
| Title                            | `title`                                                                           |
| Project                          | `project`                                                                         |
| Repo                             | `repository`                                                                      |
| Task Shape                       | `taskShape`                                                                       |
| Factory Production Model         | `productionModel`                                                                 |
| Factory Model Version            | `factoryVersion`                                                                  |
| Ambiguity Level                  | `ambiguity`                                                                       |
| Risk Level                       | `risk`                                                                            |
| Starting Commit / Baseline       | `baseline`                                                                        |
| Contract / Prompt Version        | `contractVersion`                                                                 |
| Prompt Hash                      | `promptHash`                                                                      |
| Experiment ID                    | `experiment`                                                                      |
| Start Date                       | `startDate`                                                                       |
| Final Disposition                | `disposition`                                                                     |
| Final User Quality Grade (1-5)   | `qualityGrade`, numeric 1–5                                                       |
| Winning Candidate / Model        | `preferredCandidate`, text                                                        |
| Total Time to Accepted (min)     | `timeToAcceptedMinutes` override, otherwise earliest recorded run to `acceptedAt` |
| Total API-Equivalent Cost        | Derived from saved run prices; acceptance panel uses the full relevant lifecycle  |
| Total Usage Meter Burn (pp)      | Derived sum of known run burns, with coverage; not assumed complete               |
| Total Repair Passes              | Derived count of Repair-role runs                                                 |
| Validated Autonomous Discoveries | Derived from linked discovery evidence                                            |
| Notes                            | `notes`                                                                           |

## Runs · 48 columns

| Sheet header                         | Runtime field / handling                                             |
| ------------------------------------ | -------------------------------------------------------------------- |
| Run ID                               | `id`                                                                 |
| Slice ID                             | `sliceId`                                                            |
| Run Type                             | `runType`, text                                                      |
| Factory Role                         | `role`                                                               |
| Candidate                            | `candidate`                                                          |
| Exact Model                          | `model`                                                              |
| Model Family                         | `modelFamily`                                                        |
| Thinking Level                       | `thinking`                                                           |
| Provider                             | `provider`                                                           |
| Session Mode                         | `sessionMode`                                                        |
| Context Mode                         | `contextMode`                                                        |
| Orchestrated?                        | `orchestrated`, boolean or unknown                                   |
| Orchestrator Model                   | `orchestratorModel`                                                  |
| Orchestrator Thinking Level          | `orchestratorThinking`                                               |
| Start Timestamp Local                | `startAt`, ISO with zone                                             |
| End Timestamp Local                  | `endAt`, ISO with zone                                               |
| Local Hour                           | `localHour`, optional explicit operator-local hour                   |
| Day of Week                          | `dayOfWeek`, optional explicit operator-local day                    |
| Wall Clock Min                       | `wallMinutes` override, otherwise end minus start                    |
| Input Tokens                         | `inputTokens`, fresh/noncached                                       |
| Cached Input Tokens                  | `cachedInputTokens`, additional cached                               |
| Output Tokens                        | `outputTokens`, includes reasoning                                   |
| Reasoning Tokens                     | `reasoningTokens`, subset of output                                  |
| Usage Meter Before %                 | `usageBefore`, remaining percentage                                  |
| Usage Meter After %                  | `usageAfter`, remaining percentage                                   |
| Usage Meter Burn pp                  | `usageBurn` override, otherwise reset-aware before minus after       |
| Input $/M                            | `inputRate` override / saved `priceSnapshot.inputRate`               |
| Cached Input $/M                     | `cachedRate` override / saved `priceSnapshot.cachedRate`             |
| Output $/M                           | `outputRate` override / saved `priceSnapshot.outputRate`             |
| API-Equivalent Run Cost              | Derived; unknown unless all three token counts and saved rates exist |
| Files Changed                        | `filesChanged`                                                       |
| Implementation LOC Added             | `implementationAdded`                                                |
| Implementation LOC Deleted           | `implementationDeleted`                                              |
| Test LOC Added                       | `testAdded`                                                          |
| Test LOC Deleted                     | `testDeleted`                                                        |
| Tests Added                          | `testsAdded`                                                         |
| Tests Passed                         | `testsPassed`                                                        |
| Tests Failed                         | `testsFailed`                                                        |
| Tests Skipped                        | `testsSkipped`                                                       |
| Build/Check Result                   | `buildResult`                                                        |
| Runtime Testing Performed            | `runtimeTested`                                                      |
| Human Intervention Count             | `humanInterventions`                                                 |
| Clarification Requests               | `clarifications`                                                     |
| Autonomous Defects Discovered        | `autonomousDefects`; self-found defects, not critic-fed repairs      |
| Scope Violations / Unrelated Changes | `scopeViolations`                                                    |
| Environment / Tool Incidents         | `toolIncidents`                                                      |
| Final Run Result                     | `result`                                                             |
| Notes                                | `notes`                                                              |

Local Hour and Day of Week are preserved measurements, not recalculated from the computer's current timezone. Pricing overrides require all three rates; saved snapshots are resolved only in the main process.

## Findings · 17 columns

| Sheet header         | Runtime field / handling                     |
| -------------------- | -------------------------------------------- |
| Finding ID           | `id`                                         |
| Slice ID             | `sliceId`                                    |
| Found During Run ID  | `runId`, optional same-slice reference       |
| Severity             | `severity`                                   |
| Category             | `category`                                   |
| Title                | `title`, optional short heading              |
| Description          | `description`                                |
| User Visible?        | `userVisible`                                |
| Reproducible?        | `reproducible`                               |
| Repair Required?     | `repairRequired`                             |
| Repair Run ID        | `repairRunId`, optional same-slice reference |
| Status               | `status`                                     |
| Evidence             | `evidence`, text/links                       |
| Contract / Invariant | `contractInvariant`, separate text           |
| Impact               | `impact`, separate review text               |
| Confidence           | `confidence`, separate review text           |
| Notes                | `notes`, separate from evidence              |

Severity and category remain distinct, including in comparison JSON cross-counts. A P1 Product defect is not flattened into the same evidence as a P1 Harness defect. Repaired defects remain historical burden; dismissed findings and observations are reported separately.

## Discoveries · 17 columns

| Sheet header              | Runtime field / handling                                           |
| ------------------------- | ------------------------------------------------------------------ |
| Discovery ID              | `id`                                                               |
| Slice ID                  | `sliceId`                                                          |
| Run ID                    | `runId`, optional same-slice reference                             |
| Model                     | `model`, source identity; linked run drives comparison attribution |
| Thinking Level            | `thinking`                                                         |
| Discovery Type            | `discoveryType`                                                    |
| Was In Prompt / Contract? | `inPrompt`, boolean or unknown                                     |
| Self-Initiated?           | `selfInitiated`, boolean or unknown                                |
| Description               | `description`                                                      |
| Impact Level              | `impact`, Low / Medium / High                                      |
| Independent Validation    | `validation`, Pending / Yes / No                                   |
| Validated By              | `validatedBy`                                                      |
| Adopted?                  | `adopted`, Yes / No / Deferred                                     |
| Disposition               | `disposition`, text                                                |
| Downstream Value          | `downstreamValue`                                                  |
| Evidence / Link           | `evidence`                                                         |
| Notes                     | `notes`                                                            |

Validated autonomous credit requires self-initiated, explicitly absent from the prompt, and independently validated. Adoption is not a precondition for credit. Slice-only records are preserved but cannot be attributed to a run/model without a run link.

## Pricing · 8 columns

| Sheet header     | Runtime field / handling           |
| ---------------- | ---------------------------------- |
| Exact Model      | `model`                            |
| Provider         | `provider`                         |
| Effective Date   | `effectiveDate`, UTC calendar date |
| Input $/M        | `inputRate`                        |
| Cached Input $/M | `cachedRate`                       |
| Output $/M       | `outputRate`                       |
| Source           | `source`, reference/link           |
| Notes            | `notes`, separate context          |

PennyTel additionally needs a stable Pricing `id` for edits and snapshot provenance. This is a local identity, not a new economic metric. A snapshot freezes model, provider, effective date, rates, origin, catalog ID, and available source. It does not copy catalog notes; notes stay with the catalog record. Source survives catalog changes/deletion via the snapshot.

## Non-applicable spreadsheet structures and local additions

The Data Dictionary is documentation/validation vocabulary, not an editable runtime table. Its definitions inform the above contracts and derived measures. Empty grid columns, row formatting, spreadsheet formulas, and validation cells are not telemetry and are not persisted. No meaningful populated entity header is silently dropped: direct fields are retained and the explicitly listed summary columns are derived.

Local additions are limited to stable pricing IDs, `acceptedAt` for acceptance-window boundaries, historical `priceSnapshot`, `usageReset` for safe burn inference, and envelope schema/revision metadata for validated atomic persistence. Comparison JSON is a separate non-importable derived artifact, documented in [comparison export](comparison-export.md).

Remaining intentional constraints: optional incomplete telemetry; no automatic Sheet import/sync; no automatic conversion of ambiguous legacy test tokens or grades; no inference of unreported meter resets; no single blended model/quality score.
