import type { Dataset, Discovery, Pricing, Role, Run, Slice } from './types'
import type { ExecutionEvidence } from './execution-evidence'
import {
  derivedRunIdentity,
  derivedRunLabels,
  derivedPresentationLabels,
  type DerivedRunDimension
} from './configuration'

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
})
export const money = (value: number | null): string =>
  value === null ? 'Unknown' : usdFormatter.format(value)
export const duration = (minutes: number | null): string =>
  minutes === null
    ? 'Unknown'
    : minutes < 60
      ? `${Number(minutes.toFixed(1))}m`
      : `${Number((minutes / 60).toFixed(2))}h`
export const percent = (ratio: number | null): string =>
  ratio === null ? 'Unknown' : `${(ratio * 100).toFixed(1)}%`
export function applicablePrice(run: Run, pricing: Pricing[]): Pricing | undefined {
  if (!run.model || !run.provider || !run.startAt) return undefined
  const date = new Date(run.startAt).toISOString().slice(0, 10)
  return pricing
    .filter((p) => p.model === run.model && p.provider === run.provider && p.effectiveDate <= date)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]
}
export function costIssues(run: Run): string[] {
  const issues: string[] = []
  if (!run.priceSnapshot) issues.push('No saved pricing snapshot')
  if (run.inputTokens === undefined) issues.push('Input tokens unknown')
  if (run.cachedInputTokens === undefined) issues.push('Cached input tokens unknown')
  if (run.outputTokens === undefined) issues.push('Output tokens unknown')
  return issues
}
export function runCost(run: Run): number | null {
  if (costIssues(run).length) return null
  const rates = run.priceSnapshot!
  return (
    (run.inputTokens! * rates.inputRate +
      run.cachedInputTokens! * rates.cachedRate +
      run.outputTokens! * rates.outputRate) /
    1_000_000
  )
}
export function runMinutes(run: Run): number | null {
  if (run.wallMinutes !== undefined) return run.wallMinutes
  return run.startAt && run.endAt
    ? (Date.parse(run.endAt) - Date.parse(run.startAt)) / 60_000
    : null
}
export function roleSummary(
  runs: Run[],
  role: Role
): { cost: number | null; priced: number; total: number } {
  const matching = runs.filter((run) => run.role === role)
  const costs = matching.map(runCost).filter((cost): cost is number => cost !== null)
  return {
    cost: matching.length > 0 && !costs.length ? null : costs.reduce((a, b) => a + b, 0),
    priced: costs.length,
    total: matching.length
  }
}
export function usageBurn(run: Run): number | null {
  if (run.usageBurn !== undefined) return run.usageBurn
  if (
    run.usageReset === true ||
    run.usageBefore === undefined ||
    run.usageAfter === undefined ||
    run.usageAfter > run.usageBefore
  )
    return null
  return run.usageBefore - run.usageAfter
}
export function cacheRatio(run: Run): number | null {
  if (run.inputTokens === undefined || run.cachedInputTokens === undefined) return null
  const total = run.inputTokens + run.cachedInputTokens
  return total > 0 ? run.cachedInputTokens / total : null
}
/** Cache-inclusive occupancy paired with the window of that same invocation. */
export function peakContextUtilization(evidence?: ExecutionEvidence): number | null {
  const peak = evidence?.peakInvocation
  return peak?.contextWindowTokens !== undefined
    ? peak.inputTokens / peak.contextWindowTokens
    : null
}
export function validatedDiscovery(discovery: Discovery): boolean {
  return (
    discovery.selfInitiated === true &&
    discovery.inPrompt === false &&
    discovery.validation === 'Yes'
  )
}
export interface MeasuredTotal {
  knownTotal: number | null
  completeTotal: number | null
  recorded: number
  total: number
  complete: boolean
}
export function measured(
  known: number,
  recorded: number,
  total: number,
  emptyIsZero = false
): MeasuredTotal {
  const knownTotal = recorded > 0 || (emptyIsZero && total === 0) ? known : null
  const complete = recorded === total && (total > 0 || emptyIsZero)
  return { knownTotal, completeTotal: complete ? knownTotal : null, recorded, total, complete }
}

export const numericEvidenceLabels = {
  inputTokens: 'Fresh input tokens',
  cachedInputTokens: 'Cached input tokens',
  outputTokens: 'Output tokens',
  reasoningTokens: 'Reasoning tokens (within output)',
  filesChanged: 'Files changed',
  testsAdded: 'Tests added',
  testsPassed: 'Tests passed',
  testsFailed: 'Tests failed',
  testsSkipped: 'Tests skipped'
} as const
export interface RecordedCounts {
  counts: { value: string | boolean; count: number }[]
  recorded: number
  total: number
  complete: boolean
}
export function recordedCounts(values: (string | boolean | undefined)[]): RecordedCounts {
  const known = values.filter((value) => value !== undefined)
  return {
    counts: [...new Set(known)]
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map((value) => ({ value, count: known.filter((v) => v === value).length })),
    recorded: known.length,
    total: values.length,
    complete: values.length > 0 && known.length === values.length
  }
}
export function runEvidence(runs: Run[]): {
  numeric: Record<keyof typeof numericEvidenceLabels, MeasuredTotal>
  buildResult: RecordedCounts
  runtimeTested: RecordedCounts
  result: RecordedCounts
  role: RecordedCounts
} {
  return {
    numeric: Object.fromEntries(
      (Object.keys(numericEvidenceLabels) as (keyof typeof numericEvidenceLabels)[]).map((key) => {
        const values = runs.flatMap((run) => (run[key] === undefined ? [] : [run[key]]))
        return [
          key,
          measured(
            values.reduce((a, b) => a + b, 0),
            values.length,
            runs.length
          )
        ]
      })
    ) as Record<keyof typeof numericEvidenceLabels, MeasuredTotal>,
    buildResult: recordedCounts(runs.map((run) => run.buildResult)),
    runtimeTested: recordedCounts(runs.map((run) => run.runtimeTested)),
    result: recordedCounts(runs.map((run) => run.result)),
    role: recordedCounts(runs.map((run) => run.role))
  }
}
export function summarize(runs: Run[]): {
  cost: number
  priced: number
  total: number
  minutes: number
  timed: number
  repairCost: number
  criticCost: number
  implementationCost: number
  repairRuns: number
  cacheRatio: number | null
  cacheKnown: number
  burn: number
  burnKnown: number
} {
  let cost = 0,
    priced = 0,
    minutes = 0,
    timed = 0,
    repairCost = 0,
    criticCost = 0,
    implementationCost = 0,
    input = 0,
    cached = 0,
    cacheKnown = 0,
    burn = 0,
    burnKnown = 0
  for (const run of runs) {
    const value = runCost(run)
    if (value !== null) {
      cost += value
      priced++
      if (run.role === 'Repair') repairCost += value
      if (run.role === 'Critic') criticCost += value
      if (run.role === 'Implementer') implementationCost += value
    }
    const elapsed = runMinutes(run)
    if (elapsed !== null) {
      minutes += elapsed
      timed++
    }
    if (run.inputTokens !== undefined && run.cachedInputTokens !== undefined) {
      input += run.inputTokens
      cached += run.cachedInputTokens
      cacheKnown++
    }
    const usage = usageBurn(run)
    if (usage !== null) {
      burn += usage
      burnKnown++
    }
  }
  return {
    cost,
    priced,
    total: runs.length,
    minutes,
    timed,
    repairCost,
    criticCost,
    implementationCost,
    repairRuns: runs.filter((r) => r.role === 'Repair').length,
    cacheRatio: input + cached > 0 ? cached / (input + cached) : null,
    cacheKnown,
    burn,
    burnKnown
  }
}
export function timeToAccepted(slice: Slice, runs: Run[]): number | null {
  if (slice.disposition !== 'Accepted') return null
  if (slice.timeToAcceptedMinutes !== undefined) return slice.timeToAcceptedMinutes
  const starts = runs.flatMap((r) => (r.startAt ? [Date.parse(r.startAt)] : []))
  if (!slice.acceptedAt || !starts.length) return null
  const elapsed = (Date.parse(slice.acceptedAt) - Math.min(...starts)) / 60_000
  return elapsed >= 0 ? elapsed : null
}
export function acceptanceRuns(slice: Slice, runs: Run[]): Run[] {
  // Undated runs remain included: excluding them would silently understate total cost.
  return slice.acceptedAt
    ? runs.filter((r) => !r.startAt || Date.parse(r.startAt) <= Date.parse(slice.acceptedAt!))
    : runs
}
export type GroupBy =
  | DerivedRunDimension
  | 'model'
  | 'thinking'
  | 'role'
  | 'slice'
  | 'candidate'
  | 'productionModel'
  | 'sessionMode'
  | 'contextMode'
  | 'localHour'
  | 'dayOfWeek'
  | keyof typeof recordedRunLabels
  | keyof typeof recordedSliceLabels
export const recordedRunLabels = {
  evidenceSourceKind: 'Evidence source kind',
  runtimeVersion: 'Runtime / Codex version',
  provider: 'Recorded provider',
  providerId: 'Recorded provider ID',
  offerId: 'Saved offer ID',
  runType: 'Recorded stage',
  runtimeTested: 'Runtime tested',
  result: 'Run result'
} as const
export const recordedSliceLabels = {
  project: 'Project',
  ambiguity: 'Ambiguity',
  risk: 'Risk',
  disposition: 'Slice disposition',
  qualityGrade: 'Product quality grade'
} as const
// A recorded group key wraps one maximum-size source string, including JSON escaping.
export const MAX_RECORDED_GROUP_KEY_LENGTH = 100_000 * 6 + 32
export function recordedRunValue(
  run: Run,
  key: keyof typeof recordedRunLabels
): string | undefined {
  const value =
    key === 'evidenceSourceKind'
      ? run.executionEvidence?.kind
      : key === 'runtimeVersion'
        ? run.executionEvidence?.runtimeVersion
        : key === 'offerId'
          ? run.priceSnapshot?.offerId
          : run[key]
  return value === undefined || value === '' ? undefined : String(value)
}
export const groupLabels: Record<GroupBy, string> = {
  ...derivedRunLabels,
  ...recordedRunLabels,
  ...recordedSliceLabels,
  model: 'Exact model',
  thinking: 'Thinking level',
  role: 'Factory role',
  slice: 'Slice',
  candidate: 'Candidate',
  productionModel: 'Factory production model',
  sessionMode: 'Session mode',
  contextMode: 'Context mode',
  localHour: 'Local hour',
  dayOfWeek: 'Day of week'
}
export function groupRuns(
  data: Dataset,
  runs: Run[],
  groupBy: GroupBy
): { key: string; label: string; runs: Run[] }[] {
  const groups = new Map<string, { key: string; label: string; runs: Run[] }>()
  const labels =
    groupBy in derivedRunLabels
      ? derivedPresentationLabels(data, groupBy as DerivedRunDimension)
      : undefined
  for (const run of runs) {
    if (groupBy in derivedRunLabels) {
      const identity = derivedRunIdentity(data, run, groupBy as DerivedRunDimension)
      if (!groups.has(identity.key))
        groups.set(identity.key, { ...identity, label: labels!.get(identity.key)!, runs: [] })
      groups.get(identity.key)!.runs.push(run)
      continue
    }
    const slice = data.slices.find((s) => s.id === run.sliceId)!
    if (groupBy in recordedRunLabels || groupBy in recordedSliceLabels) {
      const value =
        groupBy in recordedRunLabels
          ? recordedRunValue(run, groupBy as keyof typeof recordedRunLabels)
          : slice[groupBy as keyof typeof recordedSliceLabels]
      // Explicit null identity keeps missing evidence separate from literal text "Unknown".
      const key = JSON.stringify(['recorded', value ?? null])
      const label = value === undefined ? 'Unknown (not recorded)' : String(value)
      if (!groups.has(key)) groups.set(key, { key, label, runs: [] })
      groups.get(key)!.runs.push(run)
      continue
    }
    const value =
      groupBy === 'slice'
        ? slice.id
        : groupBy === 'productionModel'
          ? slice.productionModel
          : groupBy === 'candidate'
            ? run.candidate
              ? `${slice.id} / ${run.candidate}`
              : undefined
            : run[
                groupBy as Exclude<
                  GroupBy,
                  | DerivedRunDimension
                  | 'slice'
                  | 'productionModel'
                  | keyof typeof recordedRunLabels
                  | keyof typeof recordedSliceLabels
                >
              ]
    const key = String(value ?? 'Unknown')
    const label = groupBy === 'slice' ? slice.title : key
    if (!groups.has(key)) groups.set(key, { key, label, runs: [] })
    groups.get(key)!.runs.push(run)
  }
  return [...groups.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true })
  )
}
