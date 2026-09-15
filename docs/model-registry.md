# Model Registry integration

The authoritative seed is [PennyTel Model Registry v0.2](PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json). Its `schemaVersion` is **1** and its initial `registryRevision` is **1**. The seed and benchmark values are unchanged.

## Persistence and startup

`Dataset.registry` is an optional envelope extension, retained in schema v2. Existing schemaVersion 1 telemetry is normalized to v2 without altering the registry or historical snapshots; the registry's own schema remains version 1. See [dataset migration](data-contract.md#v1-compatibility-and-persistence). The Electron main bundle statically imports the canonical JSON; installed applications need no repository or `docs/` runtime directory. The renderer receives the stored registry through the existing preload API.

On startup, `TelemetryStore.initializeRegistry()` reads and validates the existing dataset. If registry is absent, it performs an ordinary revision-checked `registry-import` transaction: seed, safe legacy reconciliation, stable identity attachment and eligible pricing backfill are saved together to `telemetry.json`. Existing slices, findings, discoveries, pricing records and run evidence remain. An existing profile gets its prior revision in `telemetry.backup.json`. A genuinely new profile's first transaction creates the live file only. Startup advances dataset revision once; the supplied registry revision remains its source revision. Later launches retain the installed registry, including operator updates, without reseeding.

The low-level store `load()` still performs a read only; application startup uses `initializeRegistry()`. This keeps absence-at-read provenance available to the first write guard. Concurrent initialization shares one operation. Registry validation failures and live-write failures never publish candidate memory state. The existing serialized writes, file flush, atomic replacement, revision checks, single-instance lock, recovery blocking and protected export paths remain. Live-file comparison now checks original bytes, so a same-value external rewrite is detected as well.

## Supported update workflow

Open **Model Registry → Import / update registry**. Choose a JSON file or paste a complete registry, then **Validate registry & preview**. Preview reports models, newly identified runs, newly priced runs, and each legacy pricing reconciliation. **Install registry update** validates again in the main process and commits registry plus backfill atomically. Invalid updates leave live data, backup, revision and memory unchanged; errors identify the field path. The UI retains the input after failure.

Updates replace the registry document. IDs already referenced by runs must remain, including their model/provider offer; use retired or deprecated status instead of deleting identity. Unknown explicit IDs in historical telemetry may remain unresolved pending a future registry update. Increment `registryRevision` when publishing registry changes for useful provenance; the application's dataset revision separately protects local transactions. Registry revisions are provenance labels, not an enforced monotonic counter, so deliberate rollback is possible.

Raw dataset exports include registry and frozen snapshots. Reimporting the current export is idempotent. Telemetry import will not silently replace a different installed registry: install that export's `registry` object through Model Registry first, or omit `registry` when importing telemetry alone. Existing v1 experiment files without registry work unchanged. Comparison exports remain analysis only.

## Contract validation

`src/shared/registry.ts` contains domain types and strict runtime validation. Required objects/arrays, kind/version, nonnegative integer revisions, calendar dates, unique IDs, maker/provider references, unique model/provider offers, rates, reasoning settings, modalities, context limits and benchmark records are checked. Unknown fields are rejected at every object level. Pricing effective dates are unique within an offer; end dates must be strictly after start dates. Rates are finite, nonnegative USD per million tokens. Percent benchmarks must be within 0–100. Benchmark categories, units, capabilities and source text remain deliberately open nonempty text; reasoning, status and provider type use explicit enums.

Reasoning values: `none`, `low`, `medium`, `high`, `xhigh`, `max`. Status values: `active`, `preview`, `deprecated`, `retired`, `inactive`. Provider types: `first_party_api`, `third_party_api`, `gateway`, `local`, `subscription`. The policy flags must both be true and the reference preference order must match the seed. Rule/notes are descriptive; structured policy fields and the resolver define behavior.

Bounded optional extensions are recognized: maker/provider `aliases`, price `legacyPricingIds`, and optional cache-write rates (unknown in legacy records). `effectiveTo` may be absent or null. Other seed fields retain their declared shape. No unknown reusable metadata is silently discarded, and imports retain the existing 10 MB limit.

## Run identity and prices

Runs may add `modelId`, `providerId`, and `pricingReferenceDate` (`YYYY-MM-DD`). Human-readable `model` and `provider` are preserved. Explicit IDs take precedence over display text. When correcting a run's identity, correct its stable IDs too, or clear them to reconcile the corrected names.

For legacy runs, matching trims whitespace and ignores case, using canonical name, model/API IDs, model aliases, and provider model ID for the particular offer. Provider names, IDs and aliases are recognized. A maker's name/ID is a compatibility alias only for that model's first-party API offers: **GPT-5.6 Luna / OpenAI** and **GPT-6 Astra / OpenAI** therefore resolve to `openai-api`. Exactly one model/offer combination must match. Missing provider information, unknown explicit IDs, and multiple matching aliases/offers never trigger a guess. Successful reconciliation adds IDs without rewriting display names.

Pricing reference preference:

1. `run.startAt`, converted to a UTC calendar date.
2. Explicit `run.pricingReferenceDate`.
3. `slice.startDate`.

A known preferred date that has no applicable rate does not fall through to a different date. Among records satisfying `effectiveFrom <= date` and no end or `date < effectiveTo`, choose the newest `effectiveFrom`. The end is exclusive, as the seed specifies. Overlapping records with different starts are deterministic under this rule; duplicate starts are rejected. Status is descriptive and does not erase historical price applicability.

Registry snapshots include saved display names, stable IDs, offer ID, source registry revision, effective date, reference date and its source, source text, and input/cached/output rates. Cache-write rate is retained when supplied. These are historical evidence, not live foreign keys. Updating registry metadata, prices, aliases, status or dates never rewrites an existing snapshot. Slice-date edits also retain snapshots. The existing explicit run correction workflow (identity/start/reference date or three rate overrides) may select a corrected snapshot; ordinary token/note edits preserve it. There is no bulk repricing operation.

Registry installation and subsequent telemetry transactions run deterministic backfill. Only runs without a snapshot, with unambiguous identity, a usable date, and a covering rate gain a registry snapshot. Unknown rates/dates remain unknown. Existing complete explicit rate overrides are not replaced by registry backfill; new imports and interactive saves freeze those overrides through the existing path. Identity may still be attached to an unpriced run whose date is unknown, or to a previously priced run, without changing its evidence.

Cost remains `(fresh input × input rate + cached input × cached rate + output × output rate) / 1,000,000`. Reasoning is included in output. Registry cache-write rates are inspectable/snapshotted metadata; the existing telemetry contract has no separate cache-write token measurement, so this slice adds no inferred cache-write charge. All three existing token counts are still required for complete cost.

## Legacy pricing precedence and migration

The `pricing` table is retained, exported and editable in **Pricing history**; it is not deleted during migration. That view labels equivalence, conflicts, migration availability and fallback status.

- A registered model/provider offer owns new automatic resolution. Missing registry prices or dates do **not** fall back to a conflicting legacy row.
- A matching legacy row on the same effective date with equal input/cached/output rates is equivalent and creates no duplicate.
- A unique, nonconflicting legacy rate earlier than the offer's first authored registry entry can extend history. Its exclusive end is the next legacy date or the first authored registry date, whichever comes first. An offer with no authored prices can receive legacy history. Migration retains original rows and sources, and adds `legacyPricingIds`; no cache-write rate is fabricated.
- Conflicting legacy aliases on one offer/date are not migrated. Existing registry history wins over overlapping/differing legacy rates. All original rows remain available for operator reconciliation.
- Migration occurs on registry installation/update. Subsequent edits/deletion of legacy rows do not rewrite migrated registry history or snapshots; explicitly update the registry to correct it.
- Only model/provider pairs with **no** registry offer retain the old exact-text, `run.startAt`-based legacy lookup. Ambiguous registry matches and explicit unresolved registry IDs do not use that fallback. This is a compatibility path for unregistered historical models, with explicit registry precedence.

No provider connections, online price/benchmark fetching, comparer redesign, new dependencies, or benchmark edits are included.
