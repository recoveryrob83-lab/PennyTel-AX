# S12 Context Map — Reporter Integration + Canonical Turn Receipt Adoption

Issue: #26 — **S12 — Reporter Integration + Canonical Turn Receipt Adoption**

Prepared after S11 against PennyTel accepted baseline `e02a6a9fcfd1260fb73438eacfb68c6c730ba419`.

S12 is a **consumer integration slice**. Reporter implementation is external and owned by:

- repository: `recoveryrob83-lab/PennyOS-Reporter`
- Reporter contract: that repository's Issue #1
- expected local source repo: `/home/rob/dev/PennyOS-Reporter`
- expected installed command: `pennyos-reporter`

Do not implement or vendor Reporter inside PennyTel.

## Local repository topology

Real operator layout:

```text
/home/rob/dev/
├── PennyOS-Reporter/
├── PennyTel-AX/
├── PennyViz/
├── GunSmoke/
└── ...
```

Reporter and PennyTel are sibling repositories.

Reporter executable/source belongs to PennyOS-Reporter.

PennyTel-owned identity/evidence remains inside PennyTel.

## Existing PennyTel identity

### `pennyos/project.json`
Canonical project identity:

- `projectId: pennytel`
- `project: PennyTel`

### `pennyos/slices/S12.json`
S12 repository identity mirror.

The installed Reporter must read these PennyTel-owned files when targeting PennyTel. PennyTel must not copy project identity into Reporter configuration.

## `AGENTS.md`

Current guidance already:

- names `PENNYOS_TURN_REPORT_V1`;
- forbids hand-authored/fake `receiptId`;
- requires Reporter unless Chief Engineering explicitly waives it.

Current limitation:
- guidance assumes Reporter may be unavailable and every S9–S11 run used a waiver.

S12 should update only the invocation/runtime details needed after Reporter v0.1 is installed:

- exact installed command;
- target repo/slice arguments;
- worker copies terminal block verbatim;
- failure remains BLOCK unless explicitly waived.

Do not duplicate Reporter protocol implementation details here.

## Git/runtime geography

### `.gitignore`
PennyTel currently ignores build/test/log output but does not yet own a Reporter runtime ignore rule.

S12 expected project-local runtime surface:

`.pennyos/runtime/receipts/`

Recommended tracked/untracked distinction:

- `pennyos/` = tracked canonical identity;
- `.pennyos/runtime/` = ignored local runtime evidence.

Reporter should create receipt directories/files; PennyTel should only establish Git hygiene and verify locality.

## PennyTel telemetry compatibility

### `src/shared/types.ts`
Reporter v1 integration must remain compatible with current Run semantics:

- `sliceId`
- `runType`
- `role`
- optional `candidate`
- optional `result`

Current role vocabulary:

- Orchestrator
- Context Steward
- Implementer
- Critic
- Repair

Current result vocabulary:

- Completed
- Accepted
- Needs repair
- Rejected
- Blocked
- Aborted

S12 should verify compatibility, not rewrite the schema.

Workflow specificity such as re-criticism, QA, or mapping stays in `runType`.

## Execution-evidence boundary

### `src/shared/execution-evidence.ts`
Session/turn/model/runtime/token/quota/environment facts remain execution evidence.

Reporter does not know or fabricate these.

S12 does not change this schema.

S13 will pair:

- real Codex session/turn evidence;
- final matching Reporter terminal block;
- local matching Reporter receipt.

## Production storage boundary

### `src/main/production-store.ts`
Canonical JSON artifacts remain PennyTel production telemetry authority.

Reporter receipts are **not** PennyTel telemetry.

S12 must prove Reporter invocation does not mutate:

- ProductionStore;
- canonical telemetry artifacts;
- SQLite projection;
- legacy migration/archive evidence.

Receipt storage belongs only under PennyTel's ignored `.pennyos/runtime/receipts/`.

## External Reporter seam to verify

Once Reporter v0.1 is accepted/installed, inspect its documented CLI and supported validation/matching seam rather than guessing invocation syntax.

S12 should verify from PennyTel:

1. installed command is discoverable;
2. targeting PennyTel resolves PennyTel repository identity;
3. requested S12 identity is validated;
4. receipt is written under PennyTel runtime path;
5. stdout terminal block is canonical;
6. receipt and block match through Reporter's supported validator;
7. Git status remains clean except intentional S12 source edits;
8. no PennyTel production data changes.

## Likely PennyTel changed surface

Small integration-only surface, likely:

- `.gitignore`;
- `AGENTS.md`;
- focused integration test/script if needed;
- concise docs/context updates.

Do not expect changes to:

- `src/main/production-store.ts`;
- canonical artifact store;
- renderer/preload;
- execution-evidence schema;
- Electron packaging.

If real integration proves one of those necessary, stop and escalate rather than widening scope silently.

## S13 handoff

S13 needs only stable consumer facts from S12:

- command used to invoke Reporter;
- receipt location;
- protocol name `PENNYOS_TURN_REPORT_V1`;
- Reporter's public receipt/block validation seam;
- PennyTel project/slice identity locations.

S13 owns:

- Codex session discovery;
- terminal-turn matching;
- first-valid-report closure;
- review/import;
- Run identity;
- execution evidence.

## Start condition

Do not dispatch PennyTel S12 implementation until PennyOS Reporter Issue #1 is accepted and the CLI is installed locally.

Until then, Reporter bootstrap/development runs require the explicit Chief Engineering waiver.
