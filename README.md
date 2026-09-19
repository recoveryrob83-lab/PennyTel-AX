# PennyTel 0.3.1

PennyTel is a local-first engineering telemetry workbench for comparing real LLM-assisted software work.

It records bounded work slices, model runs, critic/repair passes, findings, discoveries, token usage, historical pricing, acceptance outcomes, and normalized execution evidence. The goal is not to produce a magic model score; it is to preserve enough evidence to ask useful questions about cost, time, quality, workflow, and reliability without turning missing data into invented certainty.

PennyTel is built with Electron, React, TypeScript, and electron-vite.

## Trust model

PennyTel is designed to be auditable and local-first.

- No account is required.
- No API key is required.
- No cloud backend is required.
- Normal telemetry is stored locally in Electron's per-user PennyTel data directory.
- Canonical JSON artifacts are the source of truth; the main process maintains a rebuildable SQLite projection.
- Raw Codex logs are not ingested wholesale into the PennyTel dataset; schema-v2 execution evidence stores normalized metrics and provenance only.
- Missing evidence stays Unknown. Recorded zero stays zero.
- The Electron renderer remains sandboxed with a narrow typed preload/IPC surface.

If you do not want to run a binary built by someone else, fork the repository, inspect it, and build it yourself.

## Build from source

Requirements:

- Node.js 24 (see `.nvmrc`)
- npm 11
- Git

Clone and install:

```bash
git clone https://github.com/recoveryrob83-lab/PennyTel-AX.git
cd PennyTel-AX
npm ci
```

Run in development:

```bash
npm run dev
```

Build and run the production application locally:

```bash
npm run build
npm start
```

Use Electron rather than opening the renderer URL in a standalone browser. The renderer deliberately has no browser-storage fallback.

### Windows installer

On Windows, PennyTel already includes `electron-builder` configuration for an NSIS installer:

```bash
npm ci
npm run build:win
```

The configured installer artifact is named like:

```text
pennytel-0.3.1-setup.exe
```

Windows code signing is not configured, so self-built or unsigned release binaries may trigger Windows publisher/SmartScreen warnings.

Linux and macOS packaging scripts also exist in `package.json`; packaged-platform acceptance is separate from the verified development/runtime workflow.

## First workflow

1. Inspect **Model Registry** for canonical models, provider offers, reasoning levels, benchmarks, and dated pricing.
2. In **Slice notebook**, create a bounded piece of work, or use **Data & portability → Discover Codex runs** to review a pennyReporter receipt and explicitly create its missing tracked Slice parent.
3. Add implementation, critic, repair, verification, or support runs. Record only evidence you actually have.
4. Add findings and discoveries, keeping criticism, repair, and validation links explicit.
5. Use **Accept Slice** on the Slice detail when the product outcome is actually accepted; quality remains an operator judgment on a 1–5 scale. The editor supports corrections.
6. Use **Compare** to inspect run cohorts and full accepted-slice lifecycle economics.
7. Use **Export dataset** for canonical importable telemetry and **Export comparison** for non-importable derived analysis.

Every record can be edited. Deletion protects referenced slices/runs. Failed saves retain the draft. Imports are additive and atomic: identical records are skipped, conflicts are rejected, and existing records are not silently overwritten.

## Schema v2 and execution evidence

PennyTel 0.3.1 uses raw dataset schema v2. Valid schema-v1 datasets remain loadable/importable through deterministic normalization; simply reading an old dataset does not rewrite it.

A run may contain optional structured `executionEvidence` for normalized Codex rollout facts such as source provenance, session/turn identity, runtime version, TTFT, invocation/tool-call counts, paired peak context occupancy, coarse quota-window readings, and execution-environment constraints.

Execution evidence does **not** infer PennyOS workflow semantics such as slice, run type, role, result, or context mode. Those remain explicit operator/orchestrator metadata.

For Codex work, pennyReporter produces a local receipt. **Data & portability** searches the selected last 1, 3, or 5 days of Codex rollouts (default 1 day) and shows a sanitized proposal. The selected window stays bound to review and import. Import is always an explicit operator action. If the Dataset lacks the tracked Slice, **Create Slice** saves only its explicit ID, title, and project; discover again before importing the Run. No separate parser or manual JSON handoff is needed for this workflow. Generic JSON import remains available. `Run.verification` records only explicit worker verification (`Passed`, `Failed`, `Partial`, `Not run`, or `Unknown`); it is independent of result, build checks, and runtime testing. Omitted historical verification remains Unknown.

Quota `usedPercent` evidence is descriptive source evidence and is not converted into legacy remaining-percentage usage burn. Raw prompts, hidden reasoning, source excerpts, tool commands, and full tool output are outside the normal PennyTel dataset contract.

See:

- [Data contract](docs/data-contract.md)
- [Model Registry](docs/model-registry.md)
- [Comparison export contract](docs/comparison-export.md)
- [Comparison plan contract](docs/comparison-plan.md)

## Measurement conventions

- `inputTokens` = fresh/noncached input.
- `cachedInputTokens` = additional cached input.
- `outputTokens` includes reasoning.
- `reasoningTokens` is a subset of output and is never billed twice.
- Cost is derived from frozen historical price snapshots when the required token/rate evidence exists.
- Missing measurements remain Unknown rather than becoming zero/free.
- Subscription meter evidence remains separate from API-equivalent dollar cost.
- Accepted-outcome economics use the recorded lifecycle through acceptance rather than pretending one visible run explains the whole outcome.
- Findings record where a defect was discovered; they do not automatically assign blame to that model.
- Final product quality is an operator-assigned integer from 1–5, not an automated composite score.

## Persistence and portability

The Electron main process owns the dataset and Model Registry. Writes are validated, serialized, provenance-checked, flushed, and atomically replaced. When a live revision exists, the previous revision is preserved as `telemetry.backup.json`.

**Data & portability** shows the active storage path. Set `PENNYTEL_DATA_DIR=/absolute/path` to use another directory for an isolated or portable dataset. Close PennyTel before manually replacing data files.

Raw dataset exports are canonical/importable. Comparison exports and comparison-plan results are derived analysis artifacts and are deliberately non-importable.

## Verification

```bash
npm run typecheck
npm test
npm run lint -- --max-warnings=0
npm run build
npm run test:electron
```

The repository includes unit, integration, persistence/recovery, import/export, analytics, comparison-plan, schema-v2 execution-evidence, and real Electron QA. Electron QA uses isolated synthetic profiles and verifies the sandbox/context-isolation security boundary.

See [verification.md](docs/verification.md) for recorded verification details and limits.

## Repository map

- `src/shared` — domain types, schema validation, pricing/metrics, comparison and analytics logic.
- `src/main` — authoritative local persistence, import/export dialogs, comparison-plan execution, IPC authority.
- `src/preload` — narrow typed bridge into the renderer.
- `src/renderer/src` — notebook, evidence inspection, comparisons, analytics, registry and portability UI.
- `tests` — deterministic unit/integration coverage.
- `scripts` — Electron runtime QA.
- `docs` — contracts, context maps, verification records and engineering notes.
- `MASTER_INDEX.md` — evidence-based repository navigation for engineering work.

## Scope

PennyTel is currently a local engineering workbench, not a cloud observability platform. It intentionally does not provide authentication, cloud sync, model execution, generic terminal control, automatic causal claims, or automatic model-routing recommendations.

## License

MIT. See [LICENSE](LICENSE).
