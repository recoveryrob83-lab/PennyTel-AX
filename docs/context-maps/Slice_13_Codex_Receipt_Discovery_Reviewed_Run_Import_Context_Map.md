# S13 Context Map — Codex Receipt Discovery + Reviewed Run Import

Issue: #27 — **S13 — Codex Receipt Discovery + Reviewed Run Import**

Prepared from accepted PennyTel main:
`a76bfae930ea8e8764cb16bfc8ba58135ff9f908`

This map is repository geography only. GitHub Issue #27 owns S13 behavior and acceptance. `AGENTS.md` owns worker behavior. `MASTER_INDEX.md` is broader fallback context.

## Start here

Follow this dependency chain:

1. `docs/pennyreporter-integration.md`
2. `src/shared/types.ts`
3. `src/shared/execution-evidence.ts`
4. `src/shared/data.ts`
5. `src/shared/registry.ts`
6. `src/main/index.ts`
7. `src/main/production-store.ts`
8. `src/preload/index.ts` and `src/preload/index.d.ts`
9. `src/renderer/src/pages/Data.tsx`
10. existing execution-evidence/data/storage/Electron QA

Read broader `MASTER_INDEX.md` only if those surfaces do not answer a material dependency.

## Accepted pennyReporter seam

### `docs/pennyreporter-integration.md`

PennyTel already documents the accepted consumer boundary:

- installed external CLI: `pennyReporter`;
- human alias: Penny Reporter;
- project identity: `pennyos/project.json`;
- slice identity: `pennyos/slices/<sliceId>.json`;
- project-local receipts: `.pennyos/runtime/receipts/`;
- canonical terminal protocol: `PENNYOS_TURN_REPORT_V1`;
- public Reporter validation concepts:
  - receipt validation;
  - terminal ↔ receipt matching;
- receipts are workflow evidence, not PennyTel telemetry;
- S13 owns session discovery, turn matching, review, and import.

The pennyReporter implementation lives in the sibling repository:

`/home/rob/dev/PennyOS-Reporter`

GitHub:

`recoveryrob83-lab/PennyOS-Reporter`

Accepted v0.1 implementation head at S13 preparation:

`728290bbb0f89190f0faef7aa0fc2c5725f6ede0`

Relevant Reporter public source seam:

- `src/protocol.js`
  - `validateReceipt`
  - `extractTerminalBlock`
  - `matchTerminalBlockToReceipt`
- receipt root semantics:
  `.pennyos/runtime/receipts/<receiptId>.json`

Do not copy Reporter implementation into PennyTel.

## PennyTel raw telemetry contract

### `src/shared/types.ts`

Relevant existing `Run` fields already support the target output:

Required:

- `id`
- `sliceId`
- `runType`
- `role`

Source-derivable optional fields include:

- `candidate`
- `model`
- `modelId`
- `providerId`
- `modelFamily`
- `thinking`
- `provider`
- `sessionMode`
- `contextMode`
- `startAt`
- `endAt`
- `wallMinutes`
- `inputTokens`
- `cachedInputTokens`
- `outputTokens`
- `reasoningTokens`
- `result`
- `executionEvidence`

Do not assume every optional field is derivable from Codex.

The accepted `Role` vocabulary is:

- Orchestrator
- Context Steward
- Implementer
- Critic
- Repair

Reporter already emits that same bounded role vocabulary.

### Existing token semantics

PennyTel already defines:

- `inputTokens` = fresh/noncached input;
- `cachedInputTokens` = additional cached input;
- `outputTokens` includes reasoning;
- `reasoningTokens` is a subset of output;
- output reasoning must never be billed again;
- known zero and Unknown are distinct.

Existing metrics/pricing code depends on those semantics.

## Normalized execution-evidence seam

### `src/shared/execution-evidence.ts`

The existing `CodexExecutionEvidence` shape is already the target normalized source evidence.

Current fields:

- `kind: 'codex-rollout'`
- `formatVersion: 1`
- `sourceLog.fileName`
- optional SHA-256 exact-source hash
- `sessionId`
- `turnId`
- `runtimeVersion`
- `originator`
- `workingDirectory`
- repository URL/branch/baseline
- `timeToFirstTokenMs`
- `modelInvocationCount`
- `toolCallCount`
- `modelContextWindowTokens`
- `peakInvocation`
- `quotaWindows`
- execution environment

Validation is strict:

- unknown fields rejected;
- bounded strings/numbers;
- sourceLog file name cannot contain paths;
- reasoning/source metadata remains normalized only;
- peak invocation input is cache-inclusive;
- peak cached input cannot exceed peak input;
- quota windows have independent attribution semantics.

S13 should derive into this existing shape before proposing a `Run`.

Do not add a parallel source-evidence object unless source inspection proves an unavoidable gap.

## Run validation / pricing / persistence

### `src/shared/data.ts`

This remains the central Run-validation and mutation seam.

Relevant behavior:

- `validateRecord('runs', ...)` admits `executionEvidence` as the nested exception to the flat field catalog.
- Unknown record fields fail.
- run relationships must reference an existing same-dataset Slice.
- reasoning tokens cannot exceed output.
- pricing snapshots must match model/provider and existing pricing authority.
- ordinary `save` mutation remains revision-checked.
- run mutation flows through existing snapshot/registry reconciliation logic.

A valid S13 import should produce an ordinary `Run` and use the existing mutation path rather than constructing canonical artifacts directly.

### `src/shared/registry.ts`

Registry identity/pricing is downstream of the derived Run.

Relevant facts:

- reasoning registry vocabulary includes `xhigh`;
- PennyTel `Run.thinking` uses `ExtraHigh` for the XHigh presentation identity;
- model/provider identity is resolved from explicit Run evidence;
- pricing history is date-aware;
- snapshots freeze historical evidence.

Do not fabricate registry identity when Codex source evidence is absent or ambiguous.

### `src/shared/configuration.ts`

Existing presentation maps `Run.thinking === 'ExtraHigh'` to:

`ExtraHigh / XHigh`

Use existing semantics rather than creating another XHigh representation.

## Production persistence

### `src/main/production-store.ts`

After S11:

- `ProductionStore` is the normal production facade;
- canonical JSON artifacts are authority;
- SQLite is rebuildable downstream state;
- `TelemetryStore` is legacy-only.

S13 should enter persistence through the ordinary `ProductionStore.mutate()` Run-save path after review.

Do not write directly to:

- canonical artifact files;
- projection SQLite;
- legacy telemetry files.

## Electron main / IPC seam

### `src/main/index.ts`

Current main process:

- creates one `ProductionStore`;
- owns all filesystem dialogs and persistence;
- validates IPC caller is the primary renderer main frame;
- already implements a useful ephemeral preview/token pattern for batch import:
  - main stores preview state;
  - renderer receives opaque token;
  - commit consumes token;
  - stale dataset revision blocks commit.

That batch-import pattern is the closest existing transaction shape for S13 preview/commit race protection.

S13 discovery should remain main-process-owned and add only narrow IPC operations.

Do not expose Codex-home filesystem authority to renderer.

## Preload boundary

### `src/preload/index.ts`
### `src/preload/index.d.ts`
### `src/shared/types.ts` — `PennyTelAPI`

These three surfaces must stay synchronized when adding narrow discovery/review/commit calls.

Current bridge deliberately exposes typed application operations rather than generic IPC/filesystem access.

Keep:

- sandbox enabled;
- context isolation enabled;
- Node integration disabled;
- no renderer-visible fs/database handles.

## Renderer review surface

### `src/renderer/src/pages/Data.tsx`

Data & portability already owns:

- raw dataset import;
- batch ingestion;
- preview-before-commit interaction;
- local storage truth.

This is the intended S13 operator-review page.

A new bounded Codex-intake section can reuse existing:

- panel layout;
- busy/error/message state;
- preview patterns;
- explicit commit action.

Do not move raw rollout parsing into React.

### `src/renderer/src/App.tsx`

App already owns:

- loaded Dataset snapshot/revision;
- page routing;
- mutation result replacement.

Data-page Codex import should return normal `LoadedData` after successful commit so App continues to own the detached snapshot.

## Existing execution-evidence display

S7 already made execution evidence inspectable after import.

Relevant existing surfaces:

- `src/renderer/src/components/ExecutionEvidenceDetails.tsx`
- selected Run modal in `src/renderer/src/App.tsx`
- evidence analytics/comparison code

S13 review UI need not duplicate the full post-import analysis experience. It should show enough normalized candidate evidence for informed import.

## Current Codex rollout source facts

Verified against current OpenAI Codex source during S13 preparation.

Canonical rollout recorder source:

`https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs`

Current recorder documents session JSONL under Codex home and stores canonical session metadata including:

- session/thread identity;
- timestamp;
- cwd;
- originator;
- CLI version;
- model provider.

Current Codex rollout locations observed/documented by Codex itself and current issue evidence include:

- `$CODEX_HOME/sessions/**/rollout-*.jsonl`
- normally `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- archived rollouts under Codex archived-session storage.

Current rollout event evidence publicly observed includes:

- `session_meta`
- `turn_context`
- assistant `response_item` messages
- `event_msg.task_started`
- `event_msg.token_count`
- `event_msg.task_complete`

Current `token_count.info` publicly observed includes:

- `total_token_usage`
- `last_token_usage`
- `model_context_window`

Current token usage fields include:

- `input_tokens` (cache-inclusive)
- `cached_input_tokens`
- `output_tokens`
- `reasoning_output_tokens`
- `total_tokens`

Current Codex TUI code explicitly derives noncached input as:

`input_tokens - cached_input_tokens`

Publicly reported Codex behavior also shows that rate-limit-only updates can repeat stale `last_token_usage`, so naïve summation is unsafe.

Current turn completion records can contain:

- `turn_id`
- completion timestamp
- `duration_ms`
- `time_to_first_token_ms`

Current `turn_context` carries model/effective reasoning settings and environment context, but source/version compatibility must be verified by S13 fixtures rather than assumed across every historical Codex release.

## External-source hazards

### Huge rollouts

Public Codex issue evidence includes rollout files in multi-GB ranges and individual JSONL lines containing very large inline image/base64 content.

Implication:

- never `readFile(..., 'utf8')` an arbitrary rollout;
- use bounded streaming;
- keep strict file/line/record/total-byte limits;
- large unsupported evidence must fail/skip safely.

### Rollout mutation

Active rollouts are append-only in normal operation, but:

- sessions may resume after pennyReporter closes a worker run;
- future turns may append after the matched terminal report;
- malformed/cross-version tails have been observed.

A closed run boundary must therefore be anchored to the first valid matching terminal report/turn, not “current EOF”.

### Token rebroadcast

`last_token_usage` is not safe to blindly sum because rate-limit updates may rebroadcast stale values.

Cumulative advancement and explicit turn boundaries are the safer starting evidence.

### Sensitive raw content

Rollouts can contain:

- user prompts;
- developer/system instructions;
- assistant prose;
- commands;
- tool output;
- source excerpts;
- images/base64.

Only normalized metadata needed by Issue #27 should cross the main-process adapter.

## Receipt discovery geography

Tracked factory identity:

- `pennyos/project.json`
- `pennyos/slices/S13.json` after pre-flight

Ignored workflow runtime:

- `.pennyos/runtime/receipts/`

The receipt set is the natural intake queue.

Do not use broad `~/.codex/**/*.json*` searches: those can ingest large historical transcripts and unrelated Codex state.

## Tests to extend

Existing deterministic foundations:

- `tests/execution-evidence.test.ts`
  - evidence shape/bounds;
  - zero/Unknown;
  - quota isolation;
  - source provenance.
- `tests/data.test.ts`
  - Run validation;
  - relationship checks;
  - stale revisions;
  - pricing snapshots;
  - import conflicts.
- `tests/registry.test.ts`
  - model/provider identity;
  - reasoning/pricing history.
- `tests/store.test.ts` / `tests/production-store.test.ts`
  - persistence authority/recovery.
- renderer tests around Data/import interaction.
- Electron QA scripts under `scripts/`.

Likely S13-specific additions:

- sanitized Codex rollout fixtures;
- Codex source parser/discovery tests;
- pennyReporter receipt/terminal matching adapter tests;
- Run derivation/token-accounting tests;
- Data-page intake review tests;
- isolated Electron intake smoke.

Do not commit real operator rollout contents.

## Likely new source seams

Exact names are implementation-owned, but the natural geography is:

- one shared/main Codex-intake contract/types module;
- one main-process rollout discovery/parser;
- one main-process intake coordinator;
- narrow preload/API methods;
- Data-page review UI;
- focused tests and synthetic fixtures.

Avoid building a generic plugin framework.

## Genuine unresolved implementation facts

These require source inspection/implementation evidence rather than guessing in pre-flight:

1. **pennyReporter programmatic validation access.**
   S12 documents the public protocol module, but PennyTel does not currently declare `PennyOS-Reporter` as a package dependency. Determine the narrow reproducible way to consume accepted validation semantics. Do not copy the implementation silently.

2. **Rob's current installed Codex version and exact emitted field names.**
   Verify locally and create sanitized fixtures from the current shape. Never commit raw private rollout content.

3. **Turn-bound cumulative token baseline.**
   Confirm the exact event ordering needed to isolate one Reporter-closed turn from session-cumulative counters, including first-turn and resumed-turn cases.

4. **Recognized tool-call variants.**
   Count only explicit current rollout records that unambiguously represent tool invocations. Unknown variants remain uncounted/Unknown rather than guessed.

5. **Repository metadata location in current rollouts.**
   Populate branch/baseline only from explicit source evidence; do not infer from current Git state at import time.

6. **Packaged Linux access to Codex home.**
   Verify whether the packaged main process has the same filesystem access as development. If behavior differs, Issue #27 requires packaged QA.

7. **Exact safe rollout/line limits.**
   Choose bounds from real current evidence and QA rather than arbitrary unlimited reads. Oversized evidence must remain safely blocked.

8. **Post-closure source append handling.**
   Preview/commit must distinguish safe append after the matched closure from mutation of evidence used to derive the run.

These are implementation decisions/evidence questions, not permission to change Issue #27 semantics.
