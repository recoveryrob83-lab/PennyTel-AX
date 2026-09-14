import type { Dataset, Discovery, Finding, Role, Run, Slice } from './types'
import {
  distribution,
  reasoningShare,
  runAnalytics,
  temporalAnalytics,
  type RunAnalytics
} from './analytics'
import {
  derivedRunIdentity,
  derivedRunLabels,
  derivedPresentationLabels,
  MAX_DERIVED_IDENTITY_LENGTH,
  type ComparisonIdentity,
  type DerivedRunDimension
} from './configuration'
import {
  acceptanceRuns,
  groupLabels,
  groupRuns,
  measured,
  recordedCounts,
  recordedRunLabels,
  recordedSliceLabels,
  MAX_RECORDED_GROUP_KEY_LENGTH,
  recordedRunValue,
  roleSummary,
  runEvidence,
  summarize,
  timeToAccepted,
  validatedDiscovery,
  type GroupBy,
  type MeasuredTotal
} from './metrics'

export interface AcceptedOutcomeEvidence {
  sampleCount: 1
  stages: (AnalysisMetrics & { role: Role; runType: string; runIds: string[] })[]
  acceptanceWindow: { bounded: boolean; undatedRunIds: string[]; completeTiming: boolean }
  evidenceGaps: string[]
  firstPassAcceptance: {
    state: 'Yes' | 'No' | 'Unknown'
    basis: string
    runIds: string[]
    findingIds: string[]
  }
  repair: {
    recordedRunCount: number
    runIds: string[]
    requiredRunIds: string[]
    findingIds: string[]
    costUSD: MeasuredTotal
    toImplementationCostRatio: number | null
  }
  reasoningShare: { ratio: number | null; knownRuns: number; totalRuns: number; complete: boolean }
}

function acceptedOutcomeEvidence(
  slice: Slice,
  lifecycle: Run[],
  findings: Finding[]
): AcceptedOutcomeEvidence {
  const ids = new Set(lifecycle.map((run) => run.id))
  // Later evaluations stay available in slice findings, but cannot rewrite this acceptance.
  // Unlinked findings have no timestamp in schema v1 and therefore remain possible evidence.
  const relevantFindings = findings.filter((f) => !f.runId || ids.has(f.runId))
  const repairFindings = relevantFindings.filter(
    (f) =>
      (f.repairRunId !== undefined && ids.has(f.repairRunId)) ||
      (f.status !== 'Dismissed' && (f.repairRequired === true || f.status === 'Repaired'))
  )
  const linkedRepairs = new Set(
    repairFindings.flatMap((f) => (f.repairRunId ? [f.repairRunId] : []))
  )
  const repairs = lifecycle.filter((run) => run.role === 'Repair' || linkedRepairs.has(run.id))
  const requiredRuns = lifecycle.filter((run) => run.result === 'Needs repair')
  const implementations = lifecycle.filter(
    (run) => run.role === 'Implementer' && !linkedRepairs.has(run.id)
  )
  const acceptingRuns = lifecycle.filter((run) => run.result === 'Accepted')
  const acceptanceWindow = {
    bounded: !!slice.acceptedAt,
    undatedRunIds: lifecycle.filter((run) => !run.startAt).map((run) => run.id),
    completeTiming:
      !!slice.acceptedAt &&
      lifecycle.length > 0 &&
      lifecycle.every((run) => !!run.startAt && !!run.endAt)
  }
  const gaps: string[] = []
  if (!lifecycle.length) gaps.push('No lifecycle runs recorded.')
  if (!slice.acceptedAt) gaps.push('Acceptance timestamp unknown; all related runs included.')
  if (lifecycle.some((run) => !run.startAt || !run.endAt))
    gaps.push('Run timestamps incomplete; lifecycle ordering is uncertain.')
  if (!implementations.length) gaps.push('Implementation evidence missing.')
  if (!acceptingRuns.length) gaps.push('No run explicitly records an Accepted result.')
  if (lifecycle.some((run) => run.result === undefined)) gaps.push('Run results incomplete.')
  const explicitRepair = repairs.length > 0 || requiredRuns.length > 0 || repairFindings.length > 0
  // A positive claim needs direct acceptance of the single implementation, not just the
  // slice disposition or an empty repair list. Completed + later review is not an assertion
  // that the original implementation was accepted without any unrecorded repair.
  const directAcceptance = implementations.length === 1 && implementations[0].result === 'Accepted'
  const successfulResults = lifecycle.every(
    (run) => run.result === 'Completed' || run.result === 'Accepted'
  )
  const uncertainFindings = relevantFindings.some(
    (f) => f.status !== 'Dismissed' && f.severity !== 'Observation' && f.repairRequired !== false
  )
  const firstPassState = explicitRepair
    ? 'No'
    : directAcceptance && !gaps.length && successfulResults && !uncertainFindings
      ? 'Yes'
      : 'Unknown'
  const repairMetrics = comparisonMetrics(repairs)
  if (!repairs.length && firstPassState === 'Yes') repairMetrics.costUSD = measured(0, 0, 0, true)
  const implementationCost = comparisonMetrics(implementations).costUSD.completeTotal
  const missingRepairRun =
    (requiredRuns.length > 0 && !repairs.length) ||
    repairFindings.some((f) => !f.repairRunId || !ids.has(f.repairRunId))
  const repairRatio =
    !missingRepairRun &&
    implementationCost !== null &&
    implementationCost > 0 &&
    repairMetrics.costUSD.completeTotal !== null
      ? repairMetrics.costUSD.completeTotal / implementationCost
      : null
  const stages = new Map<string, { role: Role; runType: string; runs: Run[] }>()
  for (const run of lifecycle) {
    const key = JSON.stringify([run.role, run.runType])
    if (!stages.has(key)) stages.set(key, { role: run.role, runType: run.runType, runs: [] })
    stages.get(key)!.runs.push(run)
  }
  return {
    sampleCount: 1,
    stages: [...stages.values()].map(({ role, runType, runs }) => ({
      role,
      runType,
      runIds: runs.map((run) => run.id),
      ...comparisonMetrics(runs)
    })),
    acceptanceWindow,
    evidenceGaps: gaps,
    firstPassAcceptance: {
      state: firstPassState,
      basis:
        firstPassState === 'No'
          ? 'Recorded repair work or an explicit repair requirement.'
          : firstPassState === 'Yes'
            ? 'Single implementation explicitly Accepted, with bounded, dated, successful recorded lifecycle evidence and no conflicting repair evidence.'
            : 'The recorded evidence does not establish acceptance of the first implementation without repair.',
      runIds:
        firstPassState === 'No'
          ? [...new Set([...repairs, ...requiredRuns].map((run) => run.id))]
          : implementations.filter((run) => run.result === 'Accepted').map((run) => run.id),
      findingIds: repairFindings.map((f) => f.id)
    },
    repair: {
      recordedRunCount: repairs.length,
      runIds: repairs.map((run) => run.id),
      requiredRunIds: requiredRuns.map((run) => run.id),
      findingIds: repairFindings.map((f) => f.id),
      costUSD: repairMetrics.costUSD,
      toImplementationCostRatio: repairRatio
    },
    reasoningShare: reasoningShare(lifecycle)
  }
}

export type { MeasuredTotal } from './metrics'

// Bounded, ephemeral analysis state. Eight columns support a small working set;
// sixteen scopes allow combinations of broad roles and exact recorded run types.
export const MAX_COMPARISON_CANDIDATES = 8
export const MAX_COMPARISON_STAGE_SCOPES = 16
export const MAX_RUN_TYPE_SCOPE_LENGTH = 100_000
export const structuredStageLabels = {
  Implementer: 'Implementation',
  Critic: 'Critic',
  Repair: 'Repair'
} as const
export type StageScope =
  { kind: 'role'; value: keyof typeof structuredStageLabels } | { kind: 'runType'; value: string }

export function stageScopeKey(scope: StageScope): string {
  return JSON.stringify([scope.kind, scope.value])
}
export function stageScopeLabel(scope: StageScope): string {
  return scope.kind === 'role'
    ? `${structuredStageLabels[scope.value]} (role: ${scope.value})`
    : `Recorded run type: ${scope.value}`
}
export function stageScopeOptions(data: Dataset): StageScope[] {
  return [
    ...(Object.keys(structuredStageLabels) as (keyof typeof structuredStageLabels)[]).map(
      (value): StageScope => ({ kind: 'role', value })
    ),
    ...[...new Set(data.runs.map((run) => run.runType))]
      .sort()
      .map((value): StageScope => ({ kind: 'runType', value }))
  ]
}

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
  ...derivedRunLabels,
  ...recordedRunLabels,
  model: 'Exact model',
  thinking: 'Thinking level',
  role: 'Factory role',
  sessionMode: 'Session mode',
  contextMode: 'Context mode'
} as const
export type FilterKey = keyof typeof sliceFilterLabels | keyof typeof runFilterLabels
// null explicitly selects missing evidence; empty string retains the legacy cleared-filter meaning.
export type ComparisonFilters = Partial<Record<FilterKey, string | null>>
export interface ComparisonDateRange {
  from?: string
  to?: string
  includeUnknown: boolean
}
export const outcomeFilterOptions = {
  firstPass: ['Yes', 'No', 'Unknown'],
  repairPresence: ['Yes', 'No', 'Unknown'],
  repairBurden: ['Zero', 'Positive', 'Unknown']
} as const
export type OutcomeFilters = {
  [K in keyof typeof outcomeFilterOptions]?: (typeof outcomeFilterOptions)[K][number]
}
export type ComparisonSort = 'label' | 'cost' | 'time'
export interface ComparisonContext {
  filters: ComparisonFilters
  groupBy: GroupBy
  sort: ComparisonSort
  selectedGroup?: string
  selectedCandidates?: string[]
  stageScopes?: StageScope[]
  dateRange?: ComparisonDateRange
  outcomeFilters?: OutcomeFilters
}
export interface ComparisonRequest {
  revision: number
  context: ComparisonContext
}
const sliceKeys = Object.keys(sliceFilterLabels) as (keyof typeof sliceFilterLabels)[]
const runKeys = Object.keys(runFilterLabels) as (keyof typeof runFilterLabels)[]
export function runFilterIdentity(
  data: Dataset,
  run: Run,
  key: keyof typeof runFilterLabels
): ComparisonIdentity {
  if (key in derivedRunLabels) return derivedRunIdentity(data, run, key as DerivedRunDimension)
  const value =
    key in recordedRunLabels
      ? (recordedRunValue(run, key as keyof typeof recordedRunLabels) ?? '')
      : (run[
          key as Exclude<
            keyof typeof runFilterLabels,
            DerivedRunDimension | keyof typeof recordedRunLabels
          >
        ] ?? '')
  return {
    key: value,
    label:
      key === 'runtimeTested'
        ? value === 'true'
          ? 'Yes'
          : value === 'false'
            ? 'No'
            : 'Unknown'
        : value
  }
}

function activeFilter(value: string | null | undefined): boolean {
  return value !== undefined && value !== ''
}
function matchesFilter(value: string | undefined, filter: string | null | undefined): boolean {
  return (
    !activeFilter(filter) ||
    (filter === null ? value === undefined || value === '' : value === filter)
  )
}
export function missingRunFilter(
  data: Dataset,
  run: Run,
  key: keyof typeof runFilterLabels
): boolean {
  if (key === 'modelFamily') return !run.modelFamily
  if (key === 'modelConfiguration' || key === 'canonicalModel') {
    // Unresolved recorded identities remain selectable evidence, not fabricated missing models.
    return !run.model && !run.modelId
  }
  return runFilterIdentity(data, run, key).key === ''
}

export function runFilterOptions(
  data: Dataset,
  key: keyof typeof runFilterLabels
): ComparisonIdentity[] {
  const labels =
    key in derivedRunLabels
      ? derivedPresentationLabels(data, key as DerivedRunDimension)
      : undefined
  return [
    ...new Map(
      data.runs.map((run) => {
        const identity = runFilterIdentity(data, run, key)
        return [
          identity.key,
          { ...identity, label: labels?.get(identity.key) ?? identity.label }
        ] as const
      })
    ).values()
  ]
    .filter((identity) => identity.key !== '')
    .sort((a, b) => a.label.localeCompare(b.label))
}
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
function validConfigurationKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_DERIVED_IDENTITY_LENGTH) return false
  try {
    const configuration = JSON.parse(value)
    if (
      !Array.isArray(configuration) ||
      configuration.length !== 2 ||
      typeof configuration[0] !== 'string' ||
      JSON.stringify(configuration) !== value ||
      ![null, 'Low', 'Medium', 'High', 'ExtraHigh', 'Max'].includes(configuration[1])
    )
      return false
    const model = JSON.parse(configuration[0])
    const sourceText = (v: unknown): boolean => typeof v === 'string' && v.length <= 100_000
    return (
      Array.isArray(model) &&
      JSON.stringify(model) === configuration[0] &&
      ((model.length === 2 && model[0] === 'model' && sourceText(model[1])) ||
        (model.length === 3 &&
          model[0] === 'unresolved-model' &&
          model.slice(1).every((v) => v === null || sourceText(v))))
    )
  } catch {
    return false
  }
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
      (k) =>
        ![
          'filters',
          'groupBy',
          'sort',
          'selectedGroup',
          'selectedCandidates',
          'stageScopes',
          'dateRange',
          'outcomeFilters'
        ].includes(k)
    ) ||
    typeof context.groupBy !== 'string' ||
    !Object.keys(groupLabels).includes(context.groupBy) ||
    !['label', 'cost', 'time'].includes(String(context.sort)) ||
    !isObject(context.filters)
  )
    throw new Error('Invalid comparison context.')
  if (context.dateRange !== undefined) {
    const range = context.dateRange
    const validDate = (v: unknown): boolean =>
      typeof v === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString() === v
    if (
      !isObject(range) ||
      Object.keys(range).some((k) => !['from', 'to', 'includeUnknown'].includes(k)) ||
      typeof range.includeUnknown !== 'boolean' ||
      (range.from === undefined && range.to === undefined) ||
      (range.from !== undefined && !validDate(range.from)) ||
      (range.to !== undefined && !validDate(range.to)) ||
      (typeof range.from === 'string' && typeof range.to === 'string' && range.from > range.to)
    )
      throw new Error('Invalid comparison date range.')
  }
  if (
    context.outcomeFilters !== undefined &&
    (!isObject(context.outcomeFilters) ||
      Object.entries(context.outcomeFilters).some(
        ([key, value]) =>
          !Object.hasOwn(outcomeFilterOptions, key) ||
          !(outcomeFilterOptions[key as keyof OutcomeFilters] as readonly unknown[]).includes(value)
      ))
  )
    throw new Error('Invalid accepted outcome filters.')
  if (
    context.selectedCandidates !== undefined &&
    (!Array.isArray(context.selectedCandidates) ||
      context.selectedCandidates.length > MAX_COMPARISON_CANDIDATES ||
      !Array.from(context.selectedCandidates).every(validConfigurationKey) ||
      new Set(context.selectedCandidates).size !== context.selectedCandidates.length)
  )
    throw new Error('Invalid comparison candidate selection.')
  if (context.stageScopes !== undefined) {
    const scopes = context.stageScopes
    if (
      !Array.isArray(scopes) ||
      scopes.length > MAX_COMPARISON_STAGE_SCOPES ||
      !Array.from(scopes).every(
        (scope) =>
          isObject(scope) &&
          Object.keys(scope).length === 2 &&
          Object.keys(scope).every((key) => key === 'kind' || key === 'value') &&
          typeof scope.value === 'string' &&
          ((scope.kind === 'role' && Object.hasOwn(structuredStageLabels, scope.value)) ||
            (scope.kind === 'runType' &&
              scope.value.trim().length > 0 &&
              scope.value.length <= MAX_RUN_TYPE_SCOPE_LENGTH))
      ) ||
      new Set(scopes.map((scope) => stageScopeKey(scope as StageScope))).size !== scopes.length
    )
      throw new Error('Invalid comparison stage scope selection.')
  }
  if (
    context.selectedGroup !== undefined &&
    (typeof context.selectedGroup !== 'string' ||
      context.selectedGroup.length >
        (context.groupBy in derivedRunLabels
          ? MAX_DERIVED_IDENTITY_LENGTH
          : context.groupBy in recordedRunLabels || context.groupBy in recordedSliceLabels
            ? MAX_RECORDED_GROUP_KEY_LENGTH
            : 100_000))
  )
    throw new Error('Invalid comparison group selection.')
  for (const [key, v] of Object.entries(context.filters))
    if (
      ![...sliceKeys, ...runKeys].includes(key as FilterKey) ||
      (v !== null &&
        (typeof v !== 'string' ||
          v.length > (key in derivedRunLabels ? MAX_DERIVED_IDENTITY_LENGTH : 100_000)))
    )
      throw new Error(`Invalid comparison filter: ${key}.`)
}
export function selectCohort(
  data: Dataset,
  filters: ComparisonFilters,
  stageScopes: StageScope[] = [],
  dateRange?: ComparisonDateRange,
  outcomeFilters: OutcomeFilters = {}
): { eligibleSlices: Slice[]; slices: Slice[]; runs: Run[] } {
  const eligibleSlices = data.slices.filter(
    (slice) =>
      sliceKeys.every((key) =>
        matchesFilter(slice[key] === undefined ? undefined : String(slice[key]), filters[key])
      ) &&
      (!Object.keys(outcomeFilters).length ||
        (slice.disposition === 'Accepted' &&
          matchesOutcome(acceptedEconomics(data, slice), outcomeFilters)))
  )
  const eligibleIds = new Set(eligibleSlices.map((slice) => slice.id))
  const runs = data.runs.filter(
    (run) =>
      eligibleIds.has(run.sliceId) &&
      runKeys.every((key) =>
        filters[key] === null
          ? missingRunFilter(data, run, key)
          : matchesFilter(runFilterIdentity(data, run, key).key, filters[key])
      ) &&
      (!dateRange ||
        (!run.startAt
          ? dateRange.includeUnknown
          : (!dateRange.from || Date.parse(run.startAt) >= Date.parse(dateRange.from)) &&
            (!dateRange.to || Date.parse(run.startAt) <= Date.parse(dateRange.to)))) &&
      (!stageScopes.length || stageScopes.some((scope) => run[scope.kind] === scope.value))
  )
  const matchingSliceIds = new Set(runs.map((run) => run.sliceId))
  // All active run conditions must be satisfied by the same run. With no run filters or stages,
  // empty slices remain visible; their costs are unknown rather than silently dropped.
  const slices =
    stageScopes.length || dateRange || runKeys.some((key) => activeFilter(filters[key]))
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
  metrics: AnalysisMetrics
  outcome: AcceptedOutcomeEvidence
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
  const outcome = acceptedOutcomeEvidence(slice, lifecycle, findings)
  return {
    slice,
    lifecycle,
    stats,
    metrics: comparisonMetrics(lifecycle),
    outcome,
    repair: roleSummary(lifecycle, 'Repair'),
    critic: roleSummary(lifecycle, 'Critic'),
    repairRatio: outcome.repair.toImplementationCostRatio,
    elapsedMinutes: timeToAccepted(slice, lifecycle),
    findings,
    defects: defectSummary(findings),
    discoveries: data.discoveries.filter((d) => d.sliceId === slice.id && validatedDiscovery(d))
  }
}
type AcceptedEconomics = ReturnType<typeof acceptedEconomics>
function completeRepairCost(a: AcceptedEconomics): number | null {
  const repair = a.outcome.repair
  const missingLink = a.findings.some(
    (finding) =>
      repair.findingIds.includes(finding.id) &&
      (!finding.repairRunId || !repair.runIds.includes(finding.repairRunId))
  )
  if (missingLink || (repair.requiredRunIds.length > 0 && !repair.runIds.length)) return null
  return repair.costUSD.completeTotal
}
function matchesOutcome(a: AcceptedEconomics, filters: OutcomeFilters): boolean {
  const firstPass = a.outcome.firstPassAcceptance.state
  const presence = firstPass === 'No' ? 'Yes' : firstPass === 'Yes' ? 'No' : 'Unknown'
  const cost = completeRepairCost(a)
  const burden = cost === null ? 'Unknown' : cost === 0 ? 'Zero' : 'Positive'
  return (
    (!filters.firstPass || filters.firstPass === firstPass) &&
    (!filters.repairPresence || filters.repairPresence === presence) &&
    (!filters.repairBurden || filters.repairBurden === burden)
  )
}
export interface AcceptedAnalytics {
  sampleCount: number
  sliceIds: string[]
  lifecycleRunIds: string[]
  knownLifecycleCostUSD: MeasuredTotal
  costUSD: ReturnType<typeof distribution>
  wallMinutes: ReturnType<typeof distribution>
  firstPass: { yes: number; no: number; unknown: number; determinable: number; rate: number | null }
  repair: {
    recordedRunCount: number
    costUSD: ReturnType<typeof distribution>
    toImplementationCostRatio: ReturnType<typeof distribution>
  }
  quality: ReturnType<typeof qualitySummary>
  stages: (Omit<RunAnalytics, 'costUSD' | 'wallMinutes'> & {
    key: string
    role: Role
    runType: string
    costUSD: MeasuredTotal
    wallMinutes: MeasuredTotal
  })[]
  outcomes: {
    sliceId: string
    title: string
    lifecycleRunIds: string[]
    acceptedAt: string | null
    implementationCostUSD: MeasuredTotal
    acceptedCostUSD: MeasuredTotal
    wallMinutes: MeasuredTotal
    qualityGrade: NonNullable<Slice['qualityGrade']> | null
    firstPass: 'Yes' | 'No' | 'Unknown'
    repairCostUSD: number | null
  }[]
}
export function acceptedAnalytics(accepted: AcceptedEconomics[]): AcceptedAnalytics {
  const lifecycle = accepted.flatMap((a) => a.lifecycle)
  const yes = accepted.filter((a) => a.outcome.firstPassAcceptance.state === 'Yes').length
  const no = accepted.filter((a) => a.outcome.firstPassAcceptance.state === 'No').length
  const stages = new Map<string, Run[]>()
  for (const run of lifecycle) {
    const key = JSON.stringify([run.role, run.runType])
    stages.set(key, [...(stages.get(key) ?? []), run])
  }
  return {
    sampleCount: accepted.length,
    sliceIds: accepted.map((a) => a.slice.id),
    lifecycleRunIds: lifecycle.map((run) => run.id),
    knownLifecycleCostUSD: comparisonMetrics(lifecycle).costUSD,
    costUSD: distribution(accepted.map((a) => a.metrics.costUSD.completeTotal)),
    wallMinutes: distribution(accepted.map((a) => a.metrics.wallMinutes.completeTotal)),
    firstPass: {
      yes,
      no,
      unknown: accepted.length - yes - no,
      determinable: yes + no,
      rate: yes + no ? yes / (yes + no) : null
    },
    repair: {
      recordedRunCount: accepted.reduce((sum, a) => sum + a.outcome.repair.recordedRunCount, 0),
      costUSD: distribution(accepted.map(completeRepairCost)),
      toImplementationCostRatio: distribution(accepted.map((a) => a.repairRatio))
    },
    quality: qualitySummary(accepted.map((a) => a.slice)),
    stages: [...stages.entries()].map(([key, runs]) => ({
      key,
      role: runs[0].role,
      runType: runs[0].runType,
      ...runAnalytics(runs),
      costUSD: comparisonMetrics(runs).costUSD,
      wallMinutes: comparisonMetrics(runs).wallMinutes
    })),
    outcomes: accepted.map((a) => ({
      sliceId: a.slice.id,
      title: a.slice.title,
      lifecycleRunIds: a.lifecycle.map((run) => run.id),
      acceptedAt: a.slice.acceptedAt ?? null,
      implementationCostUSD: comparisonMetrics(
        a.lifecycle.filter(
          (run) => run.role === 'Implementer' && !a.outcome.repair.runIds.includes(run.id)
        )
      ).costUSD,
      acceptedCostUSD: a.metrics.costUSD,
      wallMinutes: a.metrics.wallMinutes,
      qualityGrade: a.slice.qualityGrade ?? null,
      firstPass: a.outcome.firstPassAcceptance.state,
      repairCostUSD: completeRepairCost(a)
    }))
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
  analytics: RunAnalytics
}
export interface ComparisonView {
  eligibleSlices: Slice[]
  slices: Slice[]
  runs: Run[]
  summary: ReturnType<typeof summarize>
  groups: ComparisonGroup[]
  candidates: ComparisonCandidate[]
  findings: Finding[]
  defects: ReturnType<typeof defectSummary>
  discoveries: Discovery[]
  selectedGroup: ComparisonGroup | undefined
  shownRuns: Run[]
  accepted: ReturnType<typeof acceptedEconomics>[]
  analytics: RunAnalytics
  temporal: ReturnType<typeof temporalAnalytics>
  acceptedAnalytics: ReturnType<typeof acceptedAnalytics>
}
export type ComparisonBaseView = Omit<ComparisonView, 'candidates' | 'selectedGroup' | 'shownRuns'>
export interface ComparisonCandidate {
  key: string
  label: string
  runs: Run[]
  metrics: AnalysisMetrics
  findings: Finding[]
  defects: ReturnType<typeof defectSummary>
  discoveries: Discovery[]
  sliceDispositions: ReturnType<typeof recordedCounts>
}
export function compareDataBase(data: Dataset, context: ComparisonContext): ComparisonBaseView {
  const cohort = selectCohort(
    data,
    context.filters,
    context.stageScopes,
    context.dateRange,
    context.outcomeFilters
  )
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
        analytics: runAnalytics(group.runs),
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
  const accepted = cohort.slices
    .filter((s) => s.disposition === 'Accepted')
    .map((slice) => acceptedEconomics(data, slice))
  return {
    ...cohort,
    analytics: runAnalytics(cohort.runs),
    temporal: temporalAnalytics(cohort.runs),
    acceptedAnalytics: acceptedAnalytics(accepted),
    summary: summarize(cohort.runs),
    groups,
    findings,
    defects: defectSummary(findings),
    discoveries,
    accepted
  }
}
function selectedCandidates(
  data: Dataset,
  view: ComparisonBaseView,
  keys: string[]
): ComparisonCandidate[] {
  const candidateLabels = derivedPresentationLabels(data, 'modelConfiguration')
  const candidateGroups = new Map(
    groupRuns(data, view.runs, 'modelConfiguration').map((g) => [g.key, g.runs])
  )
  return keys.map((key): ComparisonCandidate => {
    const runs = candidateGroups.get(key) ?? []
    const ids = new Set(runs.map((run) => run.id))
    const sliceIds = new Set(runs.map((run) => run.sliceId))
    const candidateFindings = view.findings.filter((finding) => ids.has(finding.runId!))
    return {
      key,
      label: candidateLabels.get(key) ?? 'Unknown configuration (unavailable in dataset)',
      runs,
      metrics: comparisonMetrics(runs),
      findings: candidateFindings,
      defects: defectSummary(candidateFindings),
      discoveries: data.discoveries.filter((d) => d.runId !== undefined && ids.has(d.runId)),
      sliceDispositions: recordedCounts(
        view.slices.filter((s) => sliceIds.has(s.id)).map((s) => s.disposition)
      )
    }
  })
}
export function applyComparisonSelection(
  data: Dataset,
  view: ComparisonBaseView,
  context: ComparisonContext
): ComparisonView {
  const selectedGroup = view.groups.find((g) => g.key === context.selectedGroup)
  return {
    ...view,
    candidates: context.selectedCandidates?.length
      ? selectedCandidates(data, view, context.selectedCandidates)
      : [],
    selectedGroup,
    shownRuns: selectedGroup?.runs ?? view.runs
  }
}
export function compareData(data: Dataset, context: ComparisonContext): ComparisonView {
  return applyComparisonSelection(data, compareDataBase(data, context), context)
}
export interface AnalysisMetrics {
  analytics: RunAnalytics
  runCount: number
  costUSD: MeasuredTotal
  meanPricedRunCostUSD: number | null
  wallMinutes: MeasuredTotal
  usageBurnPercentagePoints: MeasuredTotal
  cache: { ratio: number | null; knownRuns: number; totalRuns: number; complete: boolean }
  repairPasses: number
  roles: Record<Role, MeasuredTotal>
  evidence: ReturnType<typeof runEvidence>
}
export interface ComparisonAnalysis {
  kind: 'pennytel-comparison'
  analysisFormatVersion: 1
  app: { name: string; version: string }
  source: { datasetSchemaVersion: number; datasetRevision: number }
  generatedAt: string
  context: ComparisonContext
  analytics: RunAnalytics
  temporal: ReturnType<typeof temporalAnalytics>
  acceptedAnalytics: ReturnType<typeof acceptedAnalytics>
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
  candidates: (Omit<ComparisonCandidate, 'runs'> & { runIds: string[]; sliceIds: string[] })[]
  acceptedSlices: (AnalysisMetrics & {
    outcome: AcceptedOutcomeEvidence
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
export function comparisonMetrics(runs: Run[]): AnalysisMetrics {
  const stats = summarize(runs)
  return {
    analytics: runAnalytics(runs),
    evidence: runEvidence(runs),
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
    analytics: view.analytics,
    temporal: view.temporal,
    acceptedAnalytics: view.acceptedAnalytics,
    cohort: {
      eligibleSliceIds: view.eligibleSlices.map((s) => s.id),
      sliceIds: view.slices.map((s) => s.id),
      runIds: view.runs.map((r) => r.id),
      evidenceRunIds: view.shownRuns.map((r) => r.id),
      selectedGroup: view.selectedGroup?.key ?? null
    },
    summary: {
      ...comparisonMetrics(view.runs),
      defectsFound: view.defects,
      validatedAutonomousDiscoveries: view.discoveries.length,
      acceptedSliceQuality: qualitySummary(view.accepted.map((a) => a.slice))
    },
    groups: view.groups.map((group) => ({
      key: group.key,
      label: group.label,
      runIds: group.runs.map((r) => r.id),
      sliceIds: [...new Set(group.runs.map((r) => r.sliceId))],
      ...comparisonMetrics(group.runs),
      defectsFound: group.defects,
      findingIds: group.findings.map((f) => f.id),
      validatedAutonomousDiscoveries: group.discoveries.length,
      discoveryIds: group.discoveries.map((d) => d.id),
      acceptedSliceQuality: group.quality
    })),
    candidates: view.candidates.map(({ runs, ...candidate }) => ({
      ...candidate,
      runIds: runs.map((run) => run.id),
      sliceIds: [...new Set(runs.map((run) => run.sliceId))]
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
      ...a.metrics,
      outcome: a.outcome,
      timeToAcceptedMinutes: a.elapsedMinutes,
      timeBasis:
        a.slice.timeToAcceptedMinutes !== undefined
          ? 'Operator measured'
          : a.elapsedMinutes !== null
            ? 'First recorded run to acceptance'
            : 'Unknown',
      acceptanceWindow: a.outcome.acceptanceWindow,
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
        'Slice and accepted-outcome filters select eligible slices. A run must match every active run filter, the run-start date range, and at least one selected stage scope (if any) to qualify its slice. Full relevant lifecycle cost is retained for each qualifying accepted slice.',
      filterUnknowns:
        'A null filter explicitly selects missing evidence, distinct from false, zero, empty/cleared filters, or literal source text Unknown. Provider text/ID and saved offer ID use recorded fields only. No inferred evidence-class, technical-stack, difficulty/coupling, or context-preparation fields exist in schema v1.',
      dateRange:
        'Inclusive canonical UTC timestamp bounds apply to run.startAt on the same qualifying run. Undated runs match only when includeUnknown is true. Lifecycle reopening remains independent of these bounds.',
      outcomeFilters:
        'Active outcome filters limit the entire cohort to accepted slices. Repair presence Yes uses explicit repair evidence; No requires established first-pass Yes. Repair cost burden Zero/Positive requires complete recorded repair cost without unresolved repair links or missing required work; otherwise Unknown.',
      analytics:
        'Run distributions use known run measurements. Accepted distributions use complete recorded per-slice totals only; knownLifecycleCostUSD separately sums known run costs across all qualifying accepted lifecycles. Each distribution includes sample count, known/unknown coverage, mean, median, min/max, and sample standard deviation (n-1; null below two known samples). These are descriptive statistics, not confidence or causal estimates.',
      charts:
        'Cost composition partitions the fully priced subset into fresh input, cached input, and output, reconciling to known run cost without adding reasoning. Time/cost points require both values; quality/cost points require recorded operator grade and complete recorded outcome cost. Missing points remain null in exported inputs. Date trends use recorded run starts in UTC with undated IDs listed separately and no zero-filled missing days.',
      candidates:
        'Selected Model Configuration keys partition scoped observed runs in selection order; they do not filter the base cohort or attribute accepted economics. Empty candidates have no evidence, not free work.',
      stages:
        'Role scopes match structured role exactly. Run type scopes match exact recorded text, without normalization or inferred Re-critic/Verification. No scopes means all otherwise matching runs.',
      acceptance:
        'Runs starting by acceptance, plus undated runs; without a cutoff, all runs. Evidence includes later evaluation.',
      acceptedOutcome:
        'One sample per accepted slice. Stage composition groups exact recorded role/runType pairs. Coverage describes recorded runs, not proof that all work was captured. First-pass Yes requires a single explicitly Accepted implementation and bounded, dated, successful lifecycle evidence without conflicting repair evidence; absent repair rows alone never imply success.',
      acceptedRepair:
        'Recorded repair runs are the union of Repair-role runs and explicit same-lifecycle repair links. Counts are recorded runs, not inferred cycles. Zero recorded runs does not prove zero repairs. Repair burden is unknown when required repair evidence is unlinked or unpriced.',
      reasoningShare:
        'Reasoning / output over runs with both counts, with paired-run coverage; a zero denominator is unknown. Reasoning is never charged independently.',
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
