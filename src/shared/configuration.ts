import { resolveIdentity } from './registry'
import type { Dataset, Run } from './types'

export interface ComparisonIdentity {
  key: string
  label: string
}

// Model identity is independent of provider pricing. A recorded stable model ID
// is sufficient; resolving names still uses the registry's full evidence rules.
export function modelIdentity(data: Dataset, run: Run): ComparisonIdentity {
  const model = data.registry
    ? run.modelId
      ? data.registry.models.find((model) => model.id === run.modelId)
      : resolveIdentity(run, data.registry)?.model
    : undefined
  if (model) return { key: JSON.stringify(['model', model.id]), label: model.canonicalName }
  // Preserve explicit unresolved IDs as well as exact legacy text. Similar names
  // and unknown IDs must not accidentally collapse into a registered identity.
  return {
    key: JSON.stringify(['unresolved-model', run.modelId ?? null, run.model ?? null]),
    label: run.model ?? 'Unknown model'
  }
}

export function modelConfiguration(data: Dataset, run: Run): ComparisonIdentity {
  const model = modelIdentity(data, run)
  return {
    key: JSON.stringify([model.key, run.thinking ?? null]),
    label: `${model.label} — ${run.thinking === 'ExtraHigh' ? 'ExtraHigh / XHigh' : (run.thinking ?? 'Unknown')}`
  }
}

export const derivedRunLabels = {
  modelConfiguration: 'Model Configuration',
  canonicalModel: 'Model (canonical)',
  modelFamily: 'Model family'
} as const
export type DerivedRunDimension = keyof typeof derivedRunLabels

// Two source strings of at most 100,000 UTF-16 units, JSON-encoded twice.
// Allow conservative escaping expansion plus tuple syntax without truncating or
// hashing evidence. Ordinary source-field request limits remain unchanged.
export const MAX_DERIVED_IDENTITY_LENGTH = 2 * 100_000 * 6 * 2 + 100

export function derivedPresentationLabels(
  data: Dataset,
  dimension: DerivedRunDimension
): Map<string, string> {
  const identities = new Map(
    data.runs.map((run) => {
      const identity = derivedRunIdentity(data, run, dimension)
      return [identity.key, identity] as const
    })
  )
  const counts = new Map<string, number>()
  for (const { label } of identities.values()) counts.set(label, (counts.get(label) ?? 0) + 1)
  const used = new Set(counts.keys())
  const labels = new Map<string, string>()
  // Dataset-wide ordering keeps labels stable across filtering and run ordering.
  const next = new Map<string, number>()
  for (const key of [...identities.keys()].sort()) {
    const { label } = identities.get(key)!
    let display = label
    if (counts.get(label)! > 1) {
      let ordinal = next.get(label) ?? 1
      do {
        display = `${label} [${ordinal++}]`
      } while (used.has(display))
      next.set(label, ordinal)
    }
    used.add(display)
    labels.set(key, display)
  }
  return labels
}

export function derivedRunIdentity(
  data: Dataset,
  run: Run,
  dimension: DerivedRunDimension
): ComparisonIdentity {
  if (dimension === 'modelConfiguration') return modelConfiguration(data, run)
  if (dimension === 'canonicalModel') return modelIdentity(data, run)
  // Family is recorded telemetry; do not infer it from a model's spelling.
  return {
    key: JSON.stringify(['family', run.modelFamily ?? null]),
    label: run.modelFamily ?? 'Unknown'
  }
}
