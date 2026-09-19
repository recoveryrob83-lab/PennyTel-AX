# S12 Context Map — Reporter + Canonical Turn Receipt Protocol

Issue: #26 — **S12 — Reporter + Canonical Turn Receipt Protocol**

Prepared against accepted `main` baseline `e02a6a9fcfd1260fb73438eacfb68c6c730ba419` after S11 closure.

This map is repository geography only. GitHub Issue #26 owns the executable slice contract. `AGENTS.md` owns worker behavior; `MASTER_INDEX.md` is broader fallback context.

## Existing Reporter contract hooks

### `AGENTS.md`
- Repository guidance already declares canonical factory identity:
  - `projectId: pennytel`;
  - `project: PennyTel`.
- It already names `pennyos/project.json` and `pennyos/slices/<sliceId>.json` as machine-readable mirrors of factory identity.
- It already names `PENNYOS_TURN_REPORT_V1` as the canonical bounded-worker terminal protocol.
- Current behavior says:
  - Reporter generates the canonical block;
  - workers must not hand-author or counterfeit a `receiptId`;
  - Reporter-unavailable is a BLOCK unless Chief Engineering explicitly waives it.
- No Reporter executable/module currently exists, so every S9–S11 worker required an explicit waiver.
- S12 should update this durable guidance only enough to point workers at the actual invocation and terminal-copy behavior once implementation exists. Do not copy the whole Reporter schema into `AGENTS.md`.

## Canonical repository identity

### `pennyos/project.json`
Current content:
- `projectId: "pennytel"`;
- `project: "PennyTel"`.

This is already canonical identity input. S12 should consume/validate it, not redesign it.

### `pennyos/slices/`
Current files:
- `S9.json`;
- `S10.json`;
- `S11.json`.

Each current slice file is a small repository identity mirror with:
- `sliceId`;
- `title`;
- `issue`.

S12 adds the corresponding `S12.json` during pre-flight. Reporter should validate the requested slice against this repository file rather than accepting caller-authored project/slice semantics.

## PennyTel telemetry semantics Reporter must align with

### `src/shared/types.ts`
Relevant existing `Run` semantics:
- required:
  - `id`;
  - `sliceId`;
  - `runType`;
  - `role`.
- optional:
  - `candidate`;
  - model/provider/thinking/context/session fields;
  - timestamps/tokens/usage;
  - execution evidence;
  - verification/test/build metrics;
  - `result`.

Existing factory-role vocabulary:
- `Orchestrator`;
- `Context Steward`;
- `Implementer`;
- `Critic`;
- `Repair`.

Existing Run result vocabulary:
- `Completed`;
- `Accepted`;
- `Needs repair`;
- `Rejected`;
- `Blocked`;
- `Aborted`.

Reporter should align to these accepted semantics. More specific workflow distinctions such as re-criticism, mapping, or QA can remain explicit `runType` values rather than creating a competing role taxonomy.

Important boundary:
- Reporter does not have enough source evidence to create a durable PennyTel `Run.id` safely.
- S13 owns integrated Codex discovery/turn matching/import and can create or preserve telemetry Run identity in that ingestion context.

### `src/shared/execution-evidence.ts`
- Codex `sessionId`, `turnId`, runtime version, token/context evidence, quota readings, environment, and source-log provenance live in normalized execution evidence.
- Reporter must not fabricate or infer any of these values.
- S13 is the intended integration point where validated Reporter semantics can be paired with actual Codex turn/session evidence.
- Raw prompts, hidden reasoning, commands/tool output, and arbitrary transcript content remain outside normal PennyTel telemetry.

### `docs/data-contract.md` / `docs/schema-reconciliation.md`
- Missing evidence stays Unknown.
- Run identity and workflow metadata are distinct from execution-source provenance.
- `runType` is free workflow text; `role` is the bounded factory role.
- Candidate/result values are explicit telemetry, not inferred from output prose.

## Current tool/runtime surfaces

### `package.json`
- Node 24 / npm 11 is the supported repository toolchain.
- No Reporter npm script exists yet.
- Normal build/test scripts are already established.
- A Reporter CLI should be callable without Electron startup and without a network service.
- Adding a small repository-local npm script is the natural operator/worker invocation seam.

### `.gitignore`
- Build/test/log artifacts are ignored.
- There is not yet a dedicated Reporter runtime receipt path.
- S12 will need a repository-local ignored runtime location for durable receipts so worker execution does not dirty Git status.

### `scripts/`
- Existing scripts are primarily Electron/runtime QA.
- There is no current Reporter or turn-report parser.
- A repository-local CLI/helper under `scripts/` is a plausible implementation shape, but exact module split should follow implementation evidence.
- Reporter should remain independent of Playwright/Electron QA machinery.

## Production persistence is a boundary, not a Reporter dependency

### `src/main/production-store.ts`
- After S11, canonical JSON artifacts are normal PennyTel production storage authority.
- Reporter must **not** write directly into ProductionStore merely because PennyTel owns the Reporter feature.
- Reporter receipt generation is repository-local workflow evidence, separate from the operator's canonical PennyTel Dataset.
- S13 will own reviewed ingestion of Reporter + Codex evidence into telemetry.

### `src/main/canonical-artifact-store.ts`
- Canonical Dataset publication/recovery is unrelated to receipt publication.
- Do not reuse canonical telemetry artifact naming or pending-transaction state for Reporter receipts.
- Keeping receipt runtime files outside PennyTel production storage prevents an unreviewed worker report from silently becoming telemetry authority.

## Expected Reporter data flow

Repository-local S12 flow:

```
explicit worker completion fields
        +
pennyos/project.json
        +
pennyos/slices/<sliceId>.json
        ↓
Reporter validation
        ↓
Reporter-generated receiptId
        ↓
durable local ignored receipt
        ↓
canonical PENNYOS_TURN_REPORT_V1 stdout block
        ↓
worker copies block verbatim as final terminal report
```

Future S13 flow (not implemented here):

```
Codex session/turn evidence
        +
matching final terminal report
        +
matching local Reporter receipt
        ↓
review / Run identity assignment or backfill
        ↓
PennyTel canonical telemetry import
```

## Reporter authority hazards

- **Caller-forged project identity:** `projectId` / project must come from repository context, never CLI override.
- **Slice mismatch:** requested `sliceId` must match the selected canonical slice file.
- **Fake receipt IDs:** callers/models must not supply `receiptId`.
- **Receipt-before-output ordering:** terminal success output without a durable local receipt would make later matching untrustworthy.
- **Receipt path escape:** receipt IDs and runtime paths must not permit traversal or symlink redirection outside the intended repository-local runtime root.
- **Git pollution:** running Reporter should not leave ordinary Git status dirty.
- **Duplicate/unknown arguments:** automation-friendly CLI parsing should reject ambiguity rather than silently choosing one value.
- **Nondeterministic payload formatting:** S13 needs a canonical representation to compare final-session terminal output to the local receipt.
- **stdout ambiguity:** canonical block should be mechanically extractable; diagnostics should not masquerade as report content.
- **Over-collection:** Reporter is workflow closure evidence, not a transcript/log collector.
- **Premature ingestion:** a worker-generated report is not automatically canonical PennyTel telemetry.
- **Role drift:** AGENTS role names are operationally richer than PennyTel's persisted `Role` enum; use `runType` for workflow specificity unless an explicit schema change is separately justified.
- **Resumed turns:** Reporter cannot decide session/turn ownership. S13 will enforce first-valid-terminal-report closure semantics using actual Codex logs.

## Relevant tests and fixtures

Existing useful semantic references:
- `tests/execution-evidence.test.ts` — bounded metadata/source evidence validation patterns.
- `tests/execution-evidence-fixture.json` — session/turn/execution evidence example that Reporter must not fabricate.
- `tests/data.test.ts` and field validation tests — accepted Run role/result semantics.
- S12 should add focused Reporter tests and CLI subprocess tests rather than stretching Electron tests into a repository-CLI problem.

## Likely S12 changed surface

Likely:
- one Reporter CLI entry in `scripts/` or an equivalent repository-local CLI location;
- one reusable turn-report/receipt validation helper or contract module;
- focused Reporter tests;
- one ignored local runtime-receipt path in `.gitignore`;
- `package.json` Reporter command;
- a narrow `AGENTS.md` update documenting invocation and verbatim terminal block behavior;
- possibly one concise Reporter contract doc if code/tests alone do not make the external protocol sufficiently auditable.

Do not modify:
- ProductionStore/canonical telemetry authority;
- renderer/preload;
- Codex execution-evidence schema;
- session discovery/import;
unless direct source evidence proves an unavoidable S12 consequence, in which case stop and escalate rather than silently widening scope.

## Genuine implementation choices

Engineering may settle these from source evidence:

1. Exact hidden runtime receipt directory name under the repository.
2. Whether the reusable validator is a single module shared by CLI/tests or split into a contract helper plus thin CLI wrapper.
3. Exact receipt envelope metadata beyond the required canonical report payload and integrity/version fields.
4. Exact CLI flag names/invocation spelling, provided it remains deterministic, non-interactive, bounded, and future-GunSmoke friendly.
5. Whether repository-root discovery is explicit or discovered from the current working directory/git root, provided it fails closed on ambiguity.

These choices do not require product escalation unless they conflict with Issue #26 authority/trust rules.
