# Security and privacy

PennyTel is a local-first engineering telemetry application. Security-sensitive behavior is treated as part of the product contract, not as an optional deployment concern.

## Data boundary

PennyTel stores its normal dataset locally. Schema-v2 execution evidence is intentionally normalized and bounded; raw prompts, hidden/encrypted reasoning, source excerpts, tool commands, full tool output, and arbitrary raw rollout payloads are not part of the normal telemetry schema.

Do not post real telemetry datasets, raw Codex rollout logs, credentials, private repository URLs, or other sensitive source material in public GitHub issues or pull requests. Use reduced/synthetic reproductions.

## Reporting a vulnerability

If a report would require publishing credentials, private telemetry, raw logs, or another user's data, do not include that material in a public issue. Contact the repository owner privately through an appropriate trusted channel and provide the minimum reproduction needed.

For ordinary non-sensitive defects, a GitHub issue with a synthetic reproduction is appropriate.

## Build trust

You do not need to trust a binary supplied by the repository owner. PennyTel is source-available under the MIT License and can be audited and built locally. See the README for reproducible source-build commands.

## Current limits

PennyTel is a local single-user engineering workbench. It does not provide authentication, multi-user authorization, cloud tenancy, or remote execution. Those are outside the current product boundary and should not be assumed.
