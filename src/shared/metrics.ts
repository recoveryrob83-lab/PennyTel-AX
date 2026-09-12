import type { Dataset, Discovery, Pricing, Role, Run, Slice } from './types'

export const money = (value: number | null): string =>
  value === null
    ? 'Unknown'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 4
      }).format(value)
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
export function validatedDiscovery(discovery: Discovery): boolean {
  return (
    discovery.selfInitiated === true &&
    discovery.inPrompt === false &&
    discovery.validation === 'Yes'
  )
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
export const groupLabels: Record<GroupBy, string> = {
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
  for (const run of runs) {
    const slice = data.slices.find((s) => s.id === run.sliceId)!
    const value =
      groupBy === 'slice'
        ? slice.id
        : groupBy === 'productionModel'
          ? slice.productionModel
          : groupBy === 'candidate'
            ? run.candidate
              ? `${slice.id} / ${run.candidate}`
              : undefined
            : run[groupBy]
    const key = String(value ?? 'Unknown')
    const label = groupBy === 'slice' ? slice.title : key
    if (!groups.has(key)) groups.set(key, { key, label, runs: [] })
    groups.get(key)!.runs.push(run)
  }
  return [...groups.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true })
  )
}
