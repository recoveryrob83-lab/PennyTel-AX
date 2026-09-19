# pennyReporter integration

PennyTel consumes the independently installed `pennyReporter` CLI (human-facing
alias: Penny Reporter). Invoke it against this checkout with the worker's
authoritative slice and run values:

```bash
pennyReporter --repo /home/rob/dev/PennyTel-AX --slice S12 --run-type Integration \
  --role Implementer --result Completed --verification Passed --findings 0
```

The command reads PennyTel-owned identity from `pennyos/project.json` and
`pennyos/slices/<sliceId>.json`, writes the matching receipt under
`.pennyos/runtime/receipts/`, and emits the `PENNYOS_TURN_REPORT_V1` terminal
block. Runtime receipts are workflow evidence, not PennyTel telemetry, and are
ignored by Git.

For consumer validation, pennyReporter exposes `validateReceipt` and
`matchTerminalBlockToReceipt` from its public protocol module. Accepted S13 now
uses those semantics to pair the durable receipt and final terminal block with
independently sourced Codex rollout evidence before sanitized operator review and
canonical PennyTel import.

## Codex intake (S13)

Data & portability can discover project-local receipts and matching closed Codex
turns. Start PennyTel from the project checkout, or set `PENNYTEL_REPO_DIR` to
the checkout path. `CODEX_HOME` selects an explicit Codex home; otherwise intake
uses the user's `.codex` directory. Only `sessions` and `archived_sessions`
rollouts are searched. The installed `pennyReporter` v0.1.0 public package main
validates receipts and final terminal blocks. It must be on `PATH` when
discovery runs.

Discovery is operator-triggered and read-only. It considers at most 100 receipts,
200 rollout files across the fixed roots, 32 MB per rollout, 256 KB per line, 100,000 lines per
file, and 128 MB per operation. Unsupported or changing sources block review
with a bounded reason. Matching requires a Codex assistant `final_answer` and
its explicit `task_complete`. Only normalized Run and execution evidence reach
the renderer; no rollout content is persisted. Import consumes a preview token,
rechecks the receipt, rollout closure and Dataset revision, and uses the ordinary
Run save mutation.

The deterministic fixture and Electron smoke cover Codex CLI `0.155.1`'s
observed JSONL event shape. Unknown future authority fields or turn/usage
semantics are not interpreted as telemetry.

S13 seals a bounded authority observation at commit. It freezes the first valid
closure's measured Run separately from receipt authority, which advances only
from none to unique to multiple. Conflicts accumulate across receipts and files.
Discovery and commit use the same eligibility evaluator and receipt-independent
source inventory; timestamps and filenames cannot exclude conflicting authority.

Capture fingerprints every inspected byte, including post-closure suffixes,
then checks the file identities, receipt digests and directory inventory. Changes
detected during capture block import and require rediscovery; there are no automatic
retries. Verification rereads count against the same 128 MB operation budget.
Unparseable or unread bytes cannot establish uniqueness. Fully inspected independent
later activity remains legal and never extends the measured Run.

A complete sealed commit-time observation is the approved external authority
cutoff (Issue #27). Later producer writes do not retroactively invalidate the
ordinary revision-checked ProductionStore mutation. This bounded observation set
is not an atomic live-filesystem snapshot, and it does not promise coordination
with Codex writers through physical canonical publication. Raw bytes are transient;
only normalized Run evidence crosses the bridge or enters canonical storage.
