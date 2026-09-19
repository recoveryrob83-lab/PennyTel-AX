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
`matchTerminalBlockToReceipt` from its public protocol module. S13 should pair
that matching receipt and terminal block with independently sourced session
evidence; session discovery, turn matching, review, and PennyTel import remain
outside this integration.
