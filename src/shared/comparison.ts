import type { Dataset, Discovery, Finding, Role, Run, Slice } from './types'
import {
  acceptanceRuns,
  groupLabels,
  groupRuns,
  roleSummary,
  summarize,
  timeToAccepted,
  validatedDiscovery,
  type GroupBy
} from './metrics'

export const sliceFilterLabels = {
  project: 'Project',
  taskShape: 'Task shape',
  ambiguity: 'Ambiguity',
  risk: 'Risk',
  productionModel: 'Workflow',
  experiment: 'Study',
  disposition: 'Slice disposition',
  qualityGrade: 'Product quality grade'
} as const
export const runFilterLabels = {
  model: 'Exact model',
  thinking: 'Thinking level',
  role: 'Factory role',
  sessionMode: 'Session mode',
  contextMode: 'Context mode'
} as const
export type FilterKey = keyof typeof sliceFilterLabels | keyof typeof runFilterLabels
export type ComparisonFilters = Partial<Record<FilterKey, string>>
export type ComparisonSort = 'label' | 'cost' | 'time'
export interface ComparisonContext {
  filters: ComparisonFilters
  groupBy: GroupBy
  sort: ComparisonSort
  selectedGroup?: string
}
export interface ComparisonRequest {
  revision: number
  context: ComparisonContext
}
const sliceKeys = Object.keys(sliceFilterLabels) as (keyof typeof sliceFilterLabels)[]
const runKeys = Object.keys(runFilterLabels) as (keyof typeof runFilterLabels)[]
const roles = ['Orchestrator', 'Context Steward', 'Implementer', 'Critic', 'Repair'] as const
const severities = ['P0', 'P1', 'P2'] as const
const categories = [
  'Product',
  'UX',
  'Architecture',
  'State',
  'Test Gap',
  'Harness',
  'Environment',
  'Scope',
  'Other'
] as const

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function validateComparisonRequest(value: unknown): asserts value is ComparisonRequest {
  if (
    !isObject(value) ||
    Object.keys(value).some((k) => !['revision', 'context'].includes(k)) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  )
    throw new Error('Invalid comparison request revision.')
  const context = value.context
  if (
    !isObject(context) ||
    Object.keys(context).some(
      (k) => !['filters', 'groupBy', 'sort', 'selectedGroup'].includes(k)
    ) ||
    typeof context.groupBy !== 'string' ||
    !Object.keys(groupLabels).includes(context.groupBy) ||
    !['label', 'cost', 'time'].includes(String(context.sort)) ||
    !isObject(context.filters)
  )
    throw new Error('Invalid comparison context.')
  if (
    context.selectedGroup !== undefined &&
    (typeof context.selectedGroup !== 'string' || context.selectedGroup.length > 100_000)
  )
    throw new Error('Invalid comparison group selection.')
  for (const [key, v] of Object.entries(context.filters))
    if (
      ![...sliceKeys, ...runKeys].includes(key as FilterKey) ||
      typeof v !== 'string' ||
      v.length > 100_000
    )
      throw new Error(`Invalid comparison filter: ${key}.`)
}
export function selectCohort(
  data: Dataset,
  filters: ComparisonFilters
): { eligibleSlices: Slice[]; slices: Slice[]; runs: Run[] } {
  const eligibleSlices = data.slices.filter((slice) =>
    sliceKeys.every((key) => !filters[key] || String(slice[key] ?? '') === filters[key])
  )
  const eligibleIds = new Set(eligibleSlices.map((slice) => slice.id))
  const runs = data.runs.filter(
    (run) =>
      eligibleIds.has(run.sliceId) &&
      runKeys.every((key) => !filters[key] || run[key] === filters[key])
  )
  const matchingSliceIds = new Set(runs.map((run) => run.sliceId))
  // All active run conditions must be satisfied by the same run. With no run filters,
  // empty slices remain visible; their costs are unknown rather than silently dropped.
  const slices = runKeys.some((key) => !!filters[key])
    ? eligibleSlices.filter((slice) => matchingSliceIds.has(slice.id))
    : eligibleSlices
  return { eligibleSlices, slices, runs }
}
export function defectSummary(findings: Finding[]): {
  reportedFindings: number
  defectCount: number
  observations: number
  dismissed: number
  bySeverity: Record<'P0' | 'P1' | 'P2', number>
  byCategory: Record<Finding['category'], number>
  bySeverityAndCategory: Record<'P0' | 'P1' | 'P2', Record<Finding['category'], number>>
} {
  const defects = findings.filter(
    (finding) => finding.status !== 'Dismissed' && finding.severity !== 'Observation'
  )
  const countCategories = (rows: Finding[]): Record<Finding['category'], number> =>
    Object.fromEntries(
      categories.map((category) => [category, rows.filter((f) => f.category === category).length])
    ) as Record<Finding['category'], number>
  return {
    reportedFindings: findings.length,
    defectCount: defects.length,
    observations: findings.filter((f) => f.status !== 'Dismissed' && f.severity === 'Observation')
      .length,
    dismissed: findings.filter((f) => f.status === 'Dismissed').length,
    bySeverity: Object.fromEntries(
      severities.map((severity) => [
        severity,
        defects.filter((f) => f.severity === severity).length
      ])
    ) as Record<'P0' | 'P1' | 'P2', number>,
    byCategory: countCategories(defects),
    bySeverityAndCategory: Object.fromEntries(
      severities.map((severity) => [
        severity,
        countCategories(defects.filter((f) => f.severity === severity))
      ])
    ) as Record<'P0' | 'P1' | 'P2', Record<Finding['category'], number>>
  }
}
export function qualitySummary(slices: Slice[]): {
  graded: number
  ungraded: number
  byGrade: Record<number, number>
} {
  return {
    graded: slices.filter((s) => s.qualityGrade !== undefined).length,
    ungraded: slices.filter((s) => s.qualityGrade === undefined).length,
    byGrade: Object.fromEntries(
      [1, 2, 3, 4, 5].map((grade) => [grade, slices.filter((s) => s.qualityGrade === grade).length])
    )
  }
}
export function acceptedEconomics(
  data: Dataset,
  slice: Slice
): {
  slice: Slice
  lifecycle: Run[]
  stats: ReturnType<typeof summarize>
  repair: ReturnType<typeof roleSummary>
  critic: ReturnType<typeof roleSummary>
  repairRatio: number | null
  elapsedMinutes: number | null
  findings: Finding[]
  defects: ReturnType<typeof defectSummary>
  discoveries: Discovery[]
} {
  const lifecycle = acceptanceRuns(
    slice,
    data.runs.filter((run) => run.sliceId === slice.id)
  )
  const stats = summarize(lifecycle)
  const findings = data.findings.filter((f) => f.sliceId === slice.id)
  return {
    slice,
    lifecycle,
    stats,
    repair: roleSummary(lifecycle, 'Repair'),
    critic: roleSummary(lifecycle, 'Critic'),
    repairRatio:
      stats.priced === stats.total && stats.implementationCost > 0
        ? stats.repairCost / stats.implementationCost
        : null,
    elapsedMinutes: timeToAccepted(slice, lifecycle),
    findings,
    defects: defectSummary(findings),
    discoveries: data.discoveries.filter((d) => d.sliceId === slice.id && validatedDiscovery(d))
  }
}
interface ComparisonGroup {
  key: string
  label: string
  runs: Run[]
  stats: ReturnType<typeof summarize>
  repair: ReturnType<typeof roleSummary>
  critic: ReturnType<typeof roleSummary>
  findings: Finding[]
  defects: ReturnType<typeof defectSummary>
  discoveries: Discovery[]
  quality: ReturnType<typeof qualitySummary>
}
export interface ComparisonView {
  eligibleSlices: Slice[]
  slices: Slice[]
  runs: Run[]
  summary: ReturnType<typeof summarize>
  groups: ComparisonGroup[]
  findings: Finding[]
  defects: ReturnType<typeof defectSummary>
  discoveries: Discovery[]
  selectedGroup: ComparisonGroup | undefined
  shownRuns: Run[]
  accepted: ReturnType<typeof acceptedEconomics>[]
}
export function compareData(data: Dataset, context: ComparisonContext): ComparisonView {
  const cohort = selectCohort(data, context.filters)
  const runIds = new Set(cohort.runs.map((r) => r.id))
  const findings = data.findings.filter((f) => f.runId !== undefined && runIds.has(f.runId))
  const discoveries = data.discoveries.filter(
    (d) => d.runId !== undefined && runIds.has(d.runId) && validatedDiscovery(d)
  )
  const groups = groupRuns(data, cohort.runs, context.groupBy)
    .map((group) => {
      const groupRunIds = new Set(group.runs.map((r) => r.id))
      const groupSliceIds = new Set(group.runs.map((r) => r.sliceId))
      const groupFindings = findings.filter((f) => groupRunIds.has(f.runId!))
      return {
        ...group,
        stats: summarize(group.runs),
        repair: roleSummary(group.runs, 'Repair'),
        critic: roleSummary(group.runs, 'Critic'),
        findings: groupFindings,
        defects: defectSummary(groupFindings),
        discoveries: discoveries.filter((d) => groupRunIds.has(d.runId!)),
        quality: qualitySummary(
          cohort.slices.filter((s) => s.disposition === 'Accepted' && groupSliceIds.has(s.id))
        )
      }
    })
    .sort(
      (a, b) =>
        (context.sort === 'cost'
          ? b.stats.cost - a.stats.cost
          : context.sort === 'time'
            ? b.stats.minutes - a.stats.minutes
            : 0) || a.label.localeCompare(b.label)
    )
  const selectedGroup = groups.find((g) => g.key === context.selectedGroup)
  return {
    ...cohort,
    summary: summarize(cohort.runs),
    groups,
    findings,
    defects: defectSummary(findings),
    discoveries,
    selectedGroup,
    shownRuns: selectedGroup?.runs ?? cohort.runs,
    accepted: cohort.slices
      .filter((s) => s.disposition === 'Accepted')
      .map((slice) => acceptedEconomics(data, slice))
  }
}
export interface MeasuredTotal {
  knownTotal: number | null
  completeTotal: number | null
  recorded: number
  total: number
  complete: boolean
}
function measured(
  known: number,
  recorded: number,
  total: number,
  emptyIsZero = false
): MeasuredTotal {
  const knownTotal = recorded > 0 || (emptyIsZero && total === 0) ? known : null
  const complete = recorded === total && (total > 0 || emptyIsZero)
  return { knownTotal, completeTotal: complete ? knownTotal : null, recorded, total, complete }
}
interface AnalysisMetrics {
  runCount: number
  costUSD: MeasuredTotal
  meanPricedRunCostUSD: number | null
  wallMinutes: MeasuredTotal
  usageBurnPercentagePoints: MeasuredTotal
  cache: { ratio: number | null; knownRuns: number; totalRuns: number; complete: boolean }
  repairPasses: number
  roles: Record<Role, MeasuredTotal>
}
export interface ComparisonAnalysis {
  kind: 'pennytel-comparison'
  analysisFormatVersion: 1
  app: { name: string; version: string }
  source: { datasetSchemaVersion: number; datasetRevision: number }
  generatedAt: string
  context: ComparisonContext
  cohort: {
    eligibleSliceIds: string[]
    sliceIds: string[]
    runIds: string[]
    evidenceRunIds: string[]
    selectedGroup: string | null
  }
  summary: AnalysisMetrics & {
    defectsFound: ReturnType<typeof defectSummary>
    validatedAutonomousDiscoveries: number
    acceptedSliceQuality: ReturnType<typeof qualitySummary>
  }
  groups: (AnalysisMetrics & {
    key: string
    label: string
    runIds: string[]
    sliceIds: string[]
    defectsFound: ReturnType<typeof defectSummary>
    findingIds: string[]
    validatedAutonomousDiscoveries: number
    discoveryIds: string[]
    acceptedSliceQuality: ReturnType<typeof qualitySummary>
  })[]
  acceptedSlices: (AnalysisMetrics & {
    sliceId: string
    title: string
    productionModel: Slice['productionModel'] | null
    ambiguity: Slice['ambiguity'] | null
    preferredCandidate: string | null
    qualityGrade: Slice['qualityGrade'] | null
    acceptedAt: string | null
    lifecycleRunIds: string[]
    timeToAcceptedMinutes: number | null
    timeBasis: string
    acceptanceWindow: { bounded: boolean; undatedRunIds: string[]; completeTiming: boolean }
    repairToImplementationCostRatio: number | null
    defects: ReturnType<typeof defectSummary>
    findingIds: string[]
    validatedAutonomousDiscoveries: number
    discoveryIds: string[]
  })[]
  conventions: Record<string, string | boolean>
}
function exportMetrics(runs: Run[]): AnalysisMetrics {
  const stats = summarize(runs)
  return {
    runCount: runs.length,
    costUSD: measured(stats.cost, stats.priced, runs.length),
    meanPricedRunCostUSD: stats.priced ? stats.cost / stats.priced : null,
    wallMinutes: measured(stats.minutes, stats.timed, runs.length),
    usageBurnPercentagePoints: measured(stats.burn, stats.burnKnown, runs.length),
    cache: {
      ratio: stats.cacheRatio,
      knownRuns: stats.cacheKnown,
      totalRuns: runs.length,
      complete: runs.length > 0 && stats.cacheKnown === runs.length
    },
    repairPasses: stats.repairRuns,
    roles: Object.fromEntries(
      roles.map((role) => {
        const summary = roleSummary(runs, role)
        return [role, measured(summary.cost ?? 0, summary.priced, summary.total, true)]
      })
    ) as Record<Role, MeasuredTotal>
  }
}
// Both UI and this export derive from compareData. The renderer sends context only;
// the main process builds the export from its own authoritative dataset snapshot.
export function comparisonExport(
  data: Dataset,
  request: ComparisonRequest,
  appVersion: string,
  generatedAt: string
): ComparisonAnalysis {
  validateComparisonRequest(request)
  if (request.revision !== data.revision)
    throw new Error('The dataset changed. Reload the comparison before exporting.')
  const view = compareData(data, request.context)
  const context: ComparisonContext = {
    ...request.context,
    filters: Object.fromEntries(
      Object.entries(request.context.filters).filter(([, value]) => value !== '')
    )
  }
  return {
    kind: 'pennytel-comparison' as const,
    analysisFormatVersion: 1 as const,
    app: { name: 'PennyTel', version: appVersion },
    source: { datasetSchemaVersion: data.schemaVersion, datasetRevision: data.revision },
    generatedAt,
    context,
    cohort: {
      eligibleSliceIds: view.eligibleSlices.map((s) => s.id),
      sliceIds: view.slices.map((s) => s.id),
      runIds: view.runs.map((r) => r.id),
      evidenceRunIds: view.shownRuns.map((r) => r.id),
      selectedGroup: view.selectedGroup?.key ?? null
    },
    summary: {
      ...exportMetrics(view.runs),
      defectsFound: view.defects,
      validatedAutonomousDiscoveries: view.discoveries.length,
      acceptedSliceQuality: qualitySummary(view.accepted.map((a) => a.slice))
    },
    groups: view.groups.map((group) => ({
      key: group.key,
      label: group.label,
      runIds: group.runs.map((r) => r.id),
      sliceIds: [...new Set(group.runs.map((r) => r.sliceId))],
      ...exportMetrics(group.runs),
      defectsFound: group.defects,
      findingIds: group.findings.map((f) => f.id),
      validatedAutonomousDiscoveries: group.discoveries.length,
      discoveryIds: group.discoveries.map((d) => d.id),
      acceptedSliceQuality: group.quality
    })),
    acceptedSlices: view.accepted.map((a) => ({
      sliceId: a.slice.id,
      title: a.slice.title,
      productionModel: a.slice.productionModel ?? null,
      ambiguity: a.slice.ambiguity ?? null,
      preferredCandidate: a.slice.preferredCandidate ?? null,
      qualityGrade: a.slice.qualityGrade ?? null,
      acceptedAt: a.slice.acceptedAt ?? null,
      lifecycleRunIds: a.lifecycle.map((r) => r.id),
      ...exportMetrics(a.lifecycle),
      timeToAcceptedMinutes: a.elapsedMinutes,
      timeBasis:
        a.slice.timeToAcceptedMinutes !== undefined
          ? 'Operator measured'
          : a.elapsedMinutes !== null
            ? 'First recorded run to acceptance'
            : 'Unknown',
      acceptanceWindow: {
        bounded: !!a.slice.acceptedAt,
        undatedRunIds: a.lifecycle.filter((r) => !r.startAt).map((r) => r.id),
        completeTiming:
          !!a.slice.acceptedAt &&
          a.lifecycle.length > 0 &&
          a.lifecycle.every((r) => !!r.startAt && !!r.endAt)
      },
      repairToImplementationCostRatio: a.repairRatio,
      defects: a.defects,
      findingIds: a.findings.map((f) => f.id),
      validatedAutonomousDiscoveries: a.discoveries.length,
      discoveryIds: a.discoveries.map((d) => d.id)
    })),
    conventions: {
      inputTokens: 'Fresh / noncached input; cached input is additional.',
      outputTokens: 'Includes reasoning; reasoning is never added to cost twice.',
      cacheRatio:
        'cachedInputTokens / (inputTokens + cachedInputTokens), token-weighted across known runs.',
      usageMeter:
        'Percentage points consumed: remaining before minus remaining after; explicit burn overrides. Increases or a reported reset make inferred burn unknown.',
      cohort:
        'Slice filters select eligible slices. When run filters are active, at least one run must match all run filters to qualify its slice. Full relevant lifecycle cost is retained for each qualifying accepted slice.',
      acceptance:
        'Runs starting by acceptance, plus undated runs; without a cutoff, all runs. Evidence includes later evaluation.',
      findings:
        'Counts reflect recorded evidence, exclude dismissed findings and observations from defects, and attribute discovery rather than fault to linked runs.',
      quality:
        'Operator judgment, integer 1–5. Group distributions refer to distinct accepted slices touched by the group; they do not assign the entire outcome to one model.',
      unknowns:
        'Null means unknown. Partial known totals include coverage; completeTotal is null when any constituent is unknown. No matching role runs is a zero role subtotal.',
      importable: false
    }
  }
}
