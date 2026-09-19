# S13 Architecture Escalation Report

## Disposition and review identity

**REPAIR REQUIRED — two unresolved findings: one P1 and one P2.**

Another closure-prefix check will not resolve the authority boundary. The implementation needs one explicit receipt-authority model and an agreed point at which external source evidence becomes fixed for import.

| Field | Value |
| --- | --- |
| Project | PennyTel (`pennytel`) |
| Slice | S13 |
| Repository | `/home/rob/dev/PennyTel-AX` |
| Branch reviewed | `s13-codex-receipt-reviewed-import` |
| Candidate reviewed | `033614c211cc817e7b5589bb98d96a00170e209a` |
| Analysis date | 2026-09-19 |
| Assignment | Architecture Escalation; read-only product analysis |
| Authoritative contract | [GitHub Issue #27](https://github.com/recoveryrob83-lab/PennyTel-AX/issues/27) |
| Context Map | [S13 Context Map](../../../docs/context-maps/Slice_13_Codex_Receipt_Discovery_Reviewed_Run_Import_Context_Map.md) |

This report records the completed architecture analysis after two repair cycles. It is advisory evidence, not a replacement for Issue #27 and not authorization to change its contract. No product repair was performed.

## Evidence inspected and verification performed

Read `AGENTS.md`, Issue #27, the S13 Context Map, the supplied Re-Critic findings, and the relevant implementation and tests:

- [`src/main/codex-intake.ts`](../../../src/main/codex-intake.ts)
- [`tests/codex-intake.test.ts`](../../../tests/codex-intake.test.ts)
- [`src/main/production-store.ts`](../../../src/main/production-store.ts)
- [`src/main/canonical-artifact-store.ts`](../../../src/main/canonical-artifact-store.ts)

Verification results:

- `npm test -- tests/codex-intake.test.ts`: **14/14 tests passed**.
- Both findings reproduced using unchanged intake code with an in-memory filesystem adapter and a publication spy. These reproductions did not exercise actual disk concurrency or actual canonical publication.
- `git diff --check`: passed.
- Candidate identity matched the dispatch; the working tree was clean at the conclusion of the analysis.

No Electron or real canonical-publication exercise was performed for this architecture analysis. Passing existing tests does not rule out the reproduced interleavings.

## Reconstructed current state machine

The effective sequence is:

`receipt validation → bounded enumeration → streaming parse/derive → closure-prefix verification → aggregate matches/errors → preview → repeat validation → queued publication`

1. Discovery validates receipts and loads the dataset revision.
2. `scanFile` reads up to the file size captured before opening.
3. Session and task events establish mutable turn state. A matching assistant final report followed by `task_complete` produces a `Match`.
4. That match freezes derived telemetry and a hash of bytes through task completion.
5. Parsing continues to identify later closures and errors.
6. A verification loop rereads closure prefixes, bracketed by file-stat checks. It can accept a larger file than the parser inspected.
7. Discovery combines matches and affected-receipt errors, then creates preview tokens.
8. Commit consumes the token, revalidates receipts, enumerates/scans sources again, and compares source identity, closure prefix, and derived Run.
9. `ProductionStore.mutate` queues ordinary canonical publication. It carries no source-authority precondition.

**Measurement ends at the first closure; uniqueness requires examining additional authority evidence.** The current state representation does not bind those two decisions to one verified observation.

## Findings

### P1 — verified source boundary excludes authority that can invalidate publication

Affected surface: `scanFile`, especially the verification loop around candidate line 724, and the transition from `CodexIntake.commit` to publication around line 1080.

Parsing stops at `before.size`. The verification loop permits subsequent growth while verifying only stored closure prefixes. A duplicate appended after parsing starts can remain unparsed while verification succeeds.

Reproduction:

1. Discover a source containing one valid closure; preview is `ready`.
2. During commit terminal matching, append a second valid closure for the same receipt in the in-memory source adapter.
3. Allow commit to continue.
4. Observe one publication call.
5. Rescan the identical final source bytes.
6. Observe rejection: `Multiple terminal closures match this receipt.`

This violates Issue #27's duplicate-authority and stale-source requirements. Existing tests exercise concurrent prefix rewrites and safe append before commit, but not a duplicate appended during parsing.

The defect is broader than growth alone: closure-prefix verification does not establish that all evidence used for the uniqueness decision belongs to the same inspected generation.

### P2 — later receipt conflicts overwrite earlier conflicts

Affected surface: `recordError` around candidate line 455 and affected-receipt calculation around line 789.

`recordError` replaces `scanError` whenever another `ReceiptConflictError` arrives. The affected-receipt calculation later constructs a singleton from the surviving exception.

Reproduction sequence:

`A closure → B closure → duplicate A → duplicate B`

The scanner retained both original matches but returned only B in `affected`, with `canUseMatches: true`. Discovery consequently has enough information to offer A incorrectly. Target-only commit scanning still rejects A, so this finding concerns review eligibility rather than a separate demonstrated publication bypass.

Existing tests cover a duplicate for one receipt, not accumulating independent conflicts.

## Connecting root cause

P1 and P2 share an architectural cause but have distinct immediate mechanisms.

Authority is reconstructed from `results`, one exception, `mentioned`, `untrustedMatches`, and prefix hashes instead of being represented as explicit, monotonic, versioned state. P1 loses evidence across time; P2 loses evidence across receipts. Fixing either mechanism alone leaves the other intact.

## Check/use race at publication

Under a literal live-source contract, the current sequence has an unavoidable check/use race.

After intake's final source observation, `commit` calls `ProductionStore.mutate`. Canonical mutation performs additional asynchronous preparation and publication through the storage queues.

Consider two executions identical through the last source read:

- In one, the source remains unchanged.
- In the other, a writer appends contradictory authority before canonical publication.

Without another observation or writer coordination, PennyTel cannot distinguish them. Adding another observation merely moves the last observation. A fingerprint, repeated stat checks, a quiet period, or a PennyTel-only lock cannot eliminate this race.

This is the broader architectural extent of P1, not a third finding.

## Recommended corrected state machine

`capture bounded source observation → reduce authority → seal immutable verification result → evaluate eligibility → bind review → recapture/reduce at commit → publish approved result`

### 1. Separate measurement state from receipt-authority state

Keep the existing turn parser and telemetry derivation, but introduce an explicit reducer keyed by receipt identity:

- closure cardinality: `none`, `unique`, or `multiple`;
- immutable first valid closure and derived Run;
- accumulated conflicts;
- scoped uncertainties;
- inspection coverage.

Cardinality can saturate at `multiple`; retaining every duplicate is unnecessary. Diagnostic details can also be capped without discarding blocking flags.

Turn-local errors may reset parsing state when justified. They must never clear previously established receipt conflicts.

### 2. Seal a bounded authority observation, not merely a closure prefix

An internal immutable verification result should bind:

- receipt content digest and protocol/adapter version;
- enumerated source inventory and search coverage;
- source identities and exact inspected byte horizons;
- fingerprints covering those inspected bytes;
- target closure identity, boundary, and prefix digest;
- accumulated authority state and uncertainty;
- exact sanitized Run proposed for publication.

The closure fingerprint protects measured telemetry. The larger authority observation protects the uniqueness decision. Neither replaces the other.

Parsing and verification must describe the same inspected generation. Never accept a larger stat result as verified while leaving its added bytes unclassified. Changes during capture require a bounded retry that reclassifies the changed authority horizon, or a stale/incomplete rejection.

Across multiple live files, this is an explicitly bounded observation set. It must not be advertised as an atomic filesystem snapshot without a mechanism providing that guarantee.

### 3. Use one eligibility evaluator for discovery and commit

Both should consume the same reducer output and apply the same rules for uniqueness, conflicts, source uncertainty, slice existence, and deterministic Run identity.

Commit recaptures current evidence and compares it with the reviewed candidate:

| Evidence at commit | Outcome |
| --- | --- |
| Changed receipt, source identity, measured prefix, or proposed Run | Reject |
| Additional valid closure for the target | Reject |
| Independently scoped later activity | Permit |
| Insufficient inspection coverage | Reject as unverifiable |
| Safe append preserving the unique target closure | Permit |

Publication consumes the immutable verified result through the existing revision-checked storage path. No new persistence subsystem is needed.

## Contract decisions requiring Rob / Chief Engineering

### Publication validity boundary

Two materially different contracts are possible:

| Contract | Consequence |
| --- | --- |
| Authority is evaluated against an explicitly sealed commit-time observation | Publication uses that fixed observation. Later writes fall outside it, even if disk publication has not finished. |
| Authority must remain valid against the live source until durable publication | Requires coordination with the authority producer, covering relevant receipt/source writes and new conflicting sources. A reader-only snapshot is insufficient. |

**Recommendation:** adopt the first as the smallest architecture, conditional on explicit approval of the cutoff. It does not satisfy a literal requirement that every duplicate appended anywhere during the wall-clock commit operation must prevent publication.

If the second interpretation is required, escalate a producer-supported immutable authority version or cooperative transaction protocol. An advisory lock that Codex does not honor offers no guarantee. A global lock is not inherently necessary, but coordination must cover the complete authority domain, including conflicting evidence in newly created files.

The repair must not silently treat snapshot semantics as approval to weaken a live-source guarantee.

### Unread or malformed later tails

Preserving a closed Run's telemetry does not prove uniqueness when potentially contradictory authority cannot be inspected. The repair should distinguish historical measurement validity from current import verifiability.

Later unrelated activity must not retroactively change the measured Run. However, incomplete bounded inspection cannot be treated as proof that a conflicting closure does not exist.

## Exact invariants

1. One observation produces one deterministic authority result, independent of which other receipts are requested.
2. A valid first closure freezes telemetry; later records cannot extend or replace it.
3. Every additional valid closure for that receipt makes its authority conflicting.
4. Conflicts accumulate monotonically within an observation and across its source files.
5. Error scope follows demonstrated receipt/turn/source dependencies. Raw receipt-text occurrence is only a conservative locator.
6. An unrelated later failure cannot invalidate established telemetry. Incomplete coverage is reported as inability to verify uniqueness where applicable.
7. Every byte horizon claimed as verified has actually been inspected under the same capture rules.
8. Discovery and commit use identical authority predicates.
9. Publication uses the exact reviewed Run and verified receipt/source identity, with ordinary dataset revision and idempotency protection.
10. Raw source content remains transient and main-process-only. No raw snapshot is persisted or sent to the renderer.
11. Existing file, line, receipt, record, and total-byte limits apply to all reads and retries. Exhaustion never becomes evidence of uniqueness.

Without a trusted authority index, detecting a duplicate anywhere in an eligible suffix requires inspecting that suffix. This justifies bounded authority scanning, not unlimited rereads or whole-file string allocation.

## Smallest affected functions and surfaces

| Surface | Required responsibility |
| --- | --- |
| `Match`, `Preview`, scanner result types | Represent the immutable closure and authority observation explicitly |
| `scanFile`, `recordError`, affected-receipt calculation | Accumulate receipt authority and scoped uncertainty; verify the actual inspected generation |
| `rolloutPaths` | Expose bounded inventory and coverage as part of the observation |
| `CodexIntake.discover` and `CodexIntake.commit` | Share authority evaluation; bind review and commit to explicit observations |
| `tests/codex-intake.test.ts` | Exercise deterministic capture interleavings and discovery/commit equivalence |

`derive` should retain its existing measurement semantics. A main-process internal verification type should suffice under snapshot-cutoff semantics. No renderer, execution-evidence schema, or storage rewrite is presently justified.

## Regression matrix for the final repair

| Scenario | Required result |
| --- | --- |
| Unique closure, unchanged source | Ready; one revision-checked import |
| Safe resumed activity before commit capture | Import identical measured Run |
| Duplicate already present at commit capture | Block; no publication |
| Duplicate appended during parse or capture verification | Include and reject, or fail capture; never silently accept |
| Existing suffix rewritten into conflicting authority | Reject or fail capture |
| Append after the approved observation cutoff | Explicitly test the chosen contract |
| A, B, duplicate A, duplicate B; reverse duplicate order | Both blocked |
| Earlier conflict followed by unrelated errors or another conflict | Earlier conflict remains |
| Later malformed/unrelated turn followed by target duplicate | Preserve earlier telemetry; still detect duplicate |
| Same observation evaluated for A alone versus A and B | Identical eligibility for A |
| Duplicate in another file; inventory changes during capture | Detect or report incomplete/stale coverage under the chosen inventory contract |
| Receipt rewrite, prefix rewrite, replacement inode, symlink, truncation | Fail closed |
| Capture retries exhaust byte/record/file limits | Visible blocked result; bounded resource use |
| Stale revision, reused token, existing deterministic ID | No duplicate or partial publication |
| Privacy assertions | No raw transcript in preview, persistence, or diagnostics |

## Repository actions and remaining uncertainty

No product source was modified during the analysis. No commit, push, merge, reset, or stash was performed. The requested Penny Reporter receipt was generated. The analysis ended with a clean tracked/untracked working tree; adding this report is a subsequent documentation-only action authorized by the user.

Remaining uncertainty is the required temporal scope of authority validity and the policy for incomplete later-tail coverage. The proposed architecture has not been implemented or runtime-verified. Final repair acceptance must exercise the agreed boundary explicitly.

## Authentic analysis receipt

The following block is copied verbatim from the Penny Reporter invocation for the completed architecture analysis. It identifies that analysis, not a separate implementation or acceptance run.

```text
PENNYOS_TURN_REPORT_V1
{"reportVersion":1,"receiptId":"pr1_20260919T164050707Z_33f5b25e314580cfa82aed5a261776eb","projectId":"pennytel","project":"PennyTel","sliceId":"S13","runType":"Architecture Analysis","role":"Context Steward","result":"Needs repair","verification":"Failed","findings":2,"candidate":"033614c211cc817e7b5589bb98d96a00170e209a"}
END_PENNYOS_TURN_REPORT
```
