# PennyTel Repository Guidance

## Purpose

This file gives repository-level operating guidance to engineering workers.

Keep this guidance small and durable. Slice-specific requirements belong in the assigned GitHub Issue and the worktree-local context packet, not here.

## Context-First Rule

Before broad repository exploration, use the prepared context in this order:

1. Read `MASTER_INDEX.md` in the repository root.
2. Read `SLICE_CONTEXT_PACKET.md` in the top level of the current worktree.
3. Read the assigned GitHub Issue. The Issue is the authoritative slice contract for objective, required behavior, acceptance criteria, constraints, and non-goals.
4. Start repository inspection with the files, symbols, tests, invariants, and neighboring surfaces identified by the Master Index and Slice Context Packet.
5. Expand into the rest of the repository only when the current evidence shows that more context is needed.

The needed context packet is in the top-level worktree folder.

This is a context-efficiency rule, not a file-access restriction. The Slice Context Packet is an advisory starting working set. If implementation evidence, dependencies, tests, call sites, runtime behavior, or architecture require additional files, inspect them.

### Why this rule exists

The goal is to keep context trawl low and input tokens efficient.

Avoid reading the whole repository by default. Broad reads create unnecessary input-token cost, truncated tool output, repeated file reads, and reconstruction work. Start from the repo map and slice-specific working set, then widen only when needed.

## Context and Authority

Use these sources for different purposes:

- `AGENTS.md` — durable repository operating guidance.
- `MASTER_INDEX.md` — durable repository map: major components, ownership, important files/symbols, tests, and architectural relationships.
- `SLICE_CONTEXT_PACKET.md` — slice-specific likely working set, relevant symbols, neighboring invariants, tests, hazards, and known unknowns.
- Assigned GitHub Issue — authoritative Engineering slice contract.
- Authoritative Design/contracts referenced by the Issue — product intent and behavior.
- Source code, tests, git state, and runtime evidence — implementation reality.

Do not treat the Master Index or Slice Context Packet as authority to change product behavior.

If the context packet conflicts with the assigned Issue or another authoritative contract, follow the authoritative contract and report the mismatch.

If the packet appears stale or incomplete, verify against repository reality and expand discovery as needed.

## Worker Boundaries

- Implement the assigned slice; do not silently expand scope.
- Do not redesign approved product behavior to make implementation easier.
- Preserve existing data, compatibility, authority, and storage invariants unless the assigned Issue explicitly changes them.
- Prefer existing architecture and extension seams over parallel subsystems.
- Do not fabricate missing telemetry, identity, timestamps, pricing, or other unknown data. Unknown remains unknown.
- Worker completion is a claim. Return evidence sufficient for independent verification.

## PennyTel Runtime and Storage Invariants

Unless an authoritative slice explicitly changes them:

- The Electron main process owns authoritative dataset persistence.
- Persistence must remain validated, revision-aware, serialized, and atomic.
- Existing storage provenance and recovery protections must not be weakened.
- Import/update operations must fail safely rather than partially corrupt existing data.
- Historical evidence must not be silently rewritten by unrelated catalog/metadata changes.
- Electron runtime behavior is authoritative for desktop QA; do not substitute a standalone renderer browser when Electron behavior is under test.
- Missing telemetry remains unknown rather than being interpreted as zero or inferred without evidence.
- Output token accounting must not double-count reasoning when reasoning is already included in provider-priced output.

## Verification

Inspect `package.json`, the assigned Issue, and the Slice Context Packet before deciding the exact verification depth.

Current repository commands include:

```bash
npm run typecheck
npm test
npm run lint -- --max-warnings=0
npm run build
npm run test:electron
```

Use targeted checks during implementation where appropriate, then run the verification required by the slice contract.

Do not invent command names when the repository already defines them.

A green test suite is evidence, not proof. Runtime or independent critic verification may still be required.

## Electron QA Environment

Headful Electron QA requires a working desktop surface.

While Electron runtime QA is active:

- keep the QA window visible and unminimized when visible-surface interaction or screenshots are required;
- if actionability or screenshot waits occur, inspect native window visibility/minimized/focus state early;
- distinguish host/window-state failures from application defects before changing product code;
- use isolated QA profiles for destructive, migration, or persistence tests;
- never use Rob's real PennyTel profile as disposable QA state.

## Slice Workflow

Normal production slices should use a dedicated branch and local worktree.

Each slice worktree should contain `SLICE_CONTEXT_PACKET.md` at its top level before implementation begins.

The packet should provide a starting map, not a cage. Workers should begin there and expand only when evidence requires more repository context.

When architecture materially changes, report the Master Index surfaces that may need reconciliation. Do not update the Master Index merely because files changed.

## Guiding Principle

Start narrow, follow evidence, and widen deliberately.

The purpose of repository guidance is to help capable workers reach the right context faster without preventing discovery when reality proves the initial map incomplete.
