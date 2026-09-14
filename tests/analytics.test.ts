import { describe, expect, it } from 'vitest'
import { distribution, runAnalytics, temporalAnalytics } from '../src/shared/analytics'
import {
  compareData,
  comparisonExport,
  validateComparisonRequest,
  type ComparisonContext
} from '../src/shared/comparison'
import { groupRuns, runCost, MAX_RECORDED_GROUP_KEY_LENGTH } from '../src/shared/metrics'
import { validateDataset, mergeImport } from '../src/shared/data'
import { emptyDataset, type Dataset } from '../src/shared/types'
import { fixture, runFixture } from './fixtures'
import acceptedFixture from './accepted-outcome-fixture.json'

const context: ComparisonContext = { filters: {}, groupBy: 'project', sort: 'label' }
function acceptedData(): Dataset {
  const data: unknown = structuredClone(acceptedFixture)
  validateDataset(data)
  return data
}
describe('descriptive comparison analytics', () => {
  it('computes odd/even medians and sample spread over known evidence, preserving zero and small sample uncertainty', () => {
    expect(distribution([0, 2, null, 4])).toEqual({
      sampleCount: 4,
      knownCount: 3,
      unknownCount: 1,
      mean: 2,
      median: 2,
      min: 0,
      max: 4,
      sampleStandardDeviation: 2
    })
    expect(distribution([9, 1, 3, 5]).median).toBe(4)
    expect(distribution([0, null])).toMatchObject({
      mean: 0,
      median: 0,
      sampleStandardDeviation: null,
      knownCount: 1
    })
    for (const values of [[], [null]])
      expect(distribution(values)).toMatchObject({
        mean: null,
        median: null,
        min: null,
        max: null,
        sampleStandardDeviation: null
      })
  })
  it('reconciles cost components with saved pricing without charging reasoning; partial costs use the same priced subset', () => {
    const data = fixture()
    const run = data.runs[0]
    const unknown = {
      ...run,
      id: 'unknown',
      outputTokens: undefined,
      wallMinutes: undefined,
      startAt: undefined,
      endAt: undefined
    }
    const stats = runAnalytics([run, unknown])
    expect(stats.costComposition.freshInputUSD.knownTotal).toBe(0.2)
    expect(stats.costComposition.cachedInputUSD.knownTotal).toBe(0.02)
    expect(stats.costComposition.outputUSD.knownTotal).toBe(0.2)
    expect(
      Object.values(stats.costComposition).reduce(
        (sum, component) => sum + component.knownTotal!,
        0
      )
    ).toBeCloseTo(runCost(run)!)
    expect(stats.costComposition.outputUSD).toMatchObject({
      recorded: 1,
      total: 2,
      completeTotal: null
    })
    expect(stats.wallMinutes).toMatchObject({
      mean: 30,
      median: 30,
      knownCount: 1,
      unknownCount: 1
    })
    expect(stats.reasoningShare).toMatchObject({
      ratio: 0.5,
      knownRuns: 1,
      totalRuns: 2,
      complete: false
    })
    expect(runAnalytics([{ ...run, reasoningTokens: 0 }]).costComposition).toEqual(
      runAnalytics([run]).costComposition
    )
    expect(runAnalytics([]).costComposition.outputUSD.knownTotal).toBeNull()
  })
  it('composes run evidence and date filters on the same run, then retains the qualified accepted lifecycle', () => {
    const data = acceptedData()
    data.runs.find((r) => r.id === 'astra-implementation')!.priceSnapshot!.offerId =
      'recorded-offer'
    const scoped: ComparisonContext = {
      ...context,
      filters: {
        project: 'Synthetic accepted outcome QA',
        provider: 'OpenAI',
        offerId: 'recorded-offer',
        runtimeTested: 'false',
        result: 'Completed'
      },
      stageScopes: [{ kind: 'role', value: 'Implementer' }],
      dateRange: {
        from: '2026-09-11T10:02:00.000Z',
        to: '2026-09-11T10:02:00.000Z',
        includeUnknown: false
      },
      outcomeFilters: { repairPresence: 'Yes', repairBurden: 'Positive', firstPass: 'No' }
    }
    validateComparisonRequest({ revision: data.revision, context: scoped })
    const view = compareData(data, scoped)
    expect(view.runs.map((r) => r.id)).toEqual(['astra-implementation'])
    expect(view.accepted[0].lifecycle).toHaveLength(6)
    expect(view.acceptedAnalytics.knownLifecycleCostUSD.completeTotal).toBeCloseTo(2.524834)
    expect(view.acceptedAnalytics.stages).toHaveLength(6)
    expect(view.acceptedAnalytics.outcomes[0].implementationCostUSD.completeTotal).toBeCloseTo(
      2.418034
    )
    expect(
      compareData(data, { ...scoped, filters: { ...scoped.filters, runtimeTested: 'true' } }).runs
    ).toEqual([])
    expect(
      compareData(data, { ...scoped, filters: { ...scoped.filters, role: 'Critic' } }).slices
    ).toEqual([])
  })
  it('keeps unknown booleans, providers, offers, slice fields, and literal Unknown values distinct', () => {
    const data = fixture()
    data.slices[0].project = undefined
    data.runs = [
      { ...data.runs[0], id: 'yes', runtimeTested: true, provider: 'Unknown' },
      { ...data.runs[0], id: 'no', runtimeTested: false, provider: '__missing__' },
      { ...data.runs[0], id: 'unknown', runtimeTested: undefined, provider: undefined }
    ]
    const ids = (filters: ComparisonContext['filters']): string[] =>
      compareData(data, { ...context, filters }).runs.map((r) => r.id)
    expect(ids({ runtimeTested: null })).toEqual(['unknown'])
    expect(ids({ runtimeTested: 'false' })).toEqual(['no'])
    expect(ids({ runtimeTested: 'true' })).toEqual(['yes'])
    expect(ids({ provider: 'Unknown' })).toEqual(['yes'])
    expect(ids({ provider: null })).toEqual(['unknown'])
    expect(ids({ offerId: null, project: null })).toHaveLength(3)
    expect(ids({ project: 'Unknown' })).toEqual([])
    expect(groupRuns(data, data.runs, 'provider')).toHaveLength(3)
    expect(groupRuns(data, data.runs, 'runtimeTested').map((g) => g.runs.length)).toEqual([1, 1, 1])
    const exported = comparisonExport(
      data,
      { revision: data.revision, context: { ...context, filters: { provider: null } } },
      '0.1.4',
      '2026-09-14T00:00:00Z'
    )
    expect(JSON.parse(JSON.stringify(exported)).context.filters).toEqual({ provider: null })
  })
  it('handles timezone date boundaries and missing starts without inventing trend dates', () => {
    const data = fixture()
    data.runs = [
      { ...data.runs[0], id: 'boundary', startAt: '2026-09-10T19:00:00-05:00' },
      { ...data.runs[0], id: 'next-day', startAt: '2026-09-12T00:00:00Z' },
      {
        ...data.runs[0],
        id: 'undated',
        startAt: undefined,
        endAt: undefined,
        priceSnapshot: undefined
      }
    ]
    const dateRange = {
      from: '2026-09-11T00:00:00.000Z',
      to: '2026-09-11T23:59:59.999Z',
      includeUnknown: false
    }
    expect(compareData(data, { ...context, dateRange }).runs.map((r) => r.id)).toEqual(['boundary'])
    expect(
      compareData(data, { ...context, dateRange: { ...dateRange, includeUnknown: true } }).runs.map(
        (r) => r.id
      )
    ).toEqual(['boundary', 'undated'])
    const temporal = temporalAnalytics(data.runs)
    expect(temporal.days.map((day) => day.date)).toEqual(['2026-09-11', '2026-09-12'])
    expect(temporal.undatedRunIds).toEqual(['undated'])
    expect(temporal.timeCost[2]).toMatchObject({ startAt: null, costUSD: null, wallMinutes: null })
  })
  it('counts each accepted outcome once, reports known-subset coverage and does not turn absent repairs into zero', () => {
    const data = acceptedData()
    const view = compareData(data, context)
    expect(view.acceptedAnalytics).toMatchObject({
      sampleCount: 5,
      firstPass: { yes: 2, no: 1, unknown: 2, determinable: 3, rate: 2 / 3 },
      costUSD: { knownCount: 3, unknownCount: 2 },
      wallMinutes: { knownCount: 3, unknownCount: 2 },
      repair: { recordedRunCount: 1, costUSD: { knownCount: 3, unknownCount: 2 } },
      quality: { graded: 1, ungraded: 4 }
    })
    const selected = (outcomeFilters: ComparisonContext['outcomeFilters']): string[] =>
      compareData(data, { ...context, outcomeFilters }).slices.map((s) => s.id)
    expect(selected({ repairPresence: 'Unknown' })).toEqual(['incomplete', 'empty'])
    expect(selected({ repairPresence: 'No', repairBurden: 'Zero' })).toEqual(['one-shot', 'zero'])
    expect(selected({ repairBurden: 'Positive' })).toEqual(['mixed'])
    const repairRun = data.runs.find((r) => r.id === 'luna-repair')!
    repairRun.priceSnapshot = undefined
    expect(selected({ repairPresence: 'Yes', repairBurden: 'Unknown' })).toEqual(['mixed'])
  })
  it('keeps repair burden unknown for explicitly required but unlinked work and excludes linked repairs from implementation bars', () => {
    const data = acceptedData()
    const repair = data.runs.find((r) => r.id === 'luna-repair')!
    repair.role = 'Implementer'
    expect(
      compareData(data, context).acceptedAnalytics.outcomes[0].implementationCostUSD.completeTotal
    ).toBeCloseTo(2.418034)
    data.findings.push({
      id: 'unlinked',
      sliceId: 'mixed',
      severity: 'P1',
      category: 'Product',
      description: 'More repair required',
      repairRequired: true
    })
    const view = compareData(data, {
      ...context,
      outcomeFilters: { repairBurden: 'Unknown', repairPresence: 'Yes' }
    })
    expect(view.slices.map((s) => s.id)).toEqual(['mixed'])
    expect(view.acceptedAnalytics.repair.costUSD.knownCount).toBe(0)
  })
  it('exports the same chart inputs and source IDs as the workspace, without changing raw data or importability', () => {
    const data = acceptedData()
    const bytes = JSON.stringify(data)
    const scoped: ComparisonContext = {
      ...context,
      filters: { role: 'Implementer' },
      outcomeFilters: { repairPresence: 'Yes' },
      dateRange: { from: '2026-09-11T00:00:00.000Z', includeUnknown: true }
    }
    const view = compareData(data, scoped)
    const exported = comparisonExport(
      data,
      { revision: data.revision, context: scoped },
      '0.1.4',
      '2026-09-14T00:00:00Z'
    )
    expect(exported.context).toEqual(scoped)
    expect(exported.analytics).toEqual(view.analytics)
    expect(exported.temporal).toEqual(view.temporal)
    expect(exported.acceptedAnalytics).toEqual(view.acceptedAnalytics)
    expect(exported.groups.map((g) => g.analytics)).toEqual(view.groups.map((g) => g.analytics))
    expect(exported.acceptedAnalytics.lifecycleRunIds).toEqual(
      exported.acceptedSlices[0].lifecycleRunIds
    )
    expect(JSON.stringify(data)).toBe(bytes)
    expect(() => mergeImport(emptyDataset(), JSON.stringify(exported))).toThrow(
      'not importable telemetry'
    )
  })
  it('rejects malformed, oversized, reversed, impossible and untrusted filter state at the export boundary', () => {
    const request = (extra: Record<string, unknown>): unknown => ({
      revision: 0,
      context: { ...context, ...extra }
    })
    for (const dateRange of [
      null,
      {},
      { from: '2026-09-11', includeUnknown: false },
      { from: '2026-02-30T00:00:00.000Z', includeUnknown: false },
      { from: '2026-09-12T00:00:00.000Z', to: '2026-09-11T00:00:00.000Z', includeUnknown: false },
      { from: '2026-09-11T00:00:00.000Z', includeUnknown: 'true' },
      { from: '2026-09-11T00:00:00.000Z', includeUnknown: false, path: '/tmp' }
    ])
      expect(() => validateComparisonRequest(request({ dateRange }))).toThrow('date range')
    for (const outcomeFilters of [
      null,
      [],
      { firstPass: 'Always' },
      { repairPresence: false },
      { repairBurden: 0 },
      { fabricated: 'Yes' },
      { toString: 'Yes' }
    ])
      expect(() => validateComparisonRequest(request({ outcomeFilters }))).toThrow(
        'outcome filters'
      )
    for (const filters of [
      { runtimeTested: false },
      { contextPrepared: 'Yes' },
      { provider: 'x'.repeat(100_001) }
    ])
      expect(() => validateComparisonRequest(request({ filters }))).toThrow('filter')
    expect(() =>
      validateComparisonRequest(request({ filters: { runtimeTested: null } }))
    ).not.toThrow()
    expect(compareData(emptyDataset(), context).acceptedAnalytics.firstPass.rate).toBeNull()
    expect(runAnalytics([runFixture()]).costUSD.mean).toBeNull()
  })
  it('exports selected recorded groups whose valid source text expands through JSON escaping', () => {
    const data = fixture()
    data.slices[0].project = 'project' + '\\'.repeat(99_993)
    validateDataset(data)
    const group = groupRuns(data, data.runs, 'project')[0]
    expect(group.key.length).toBeGreaterThan(100_000)
    expect(() =>
      comparisonExport(
        data,
        { revision: data.revision, context: { ...context, selectedGroup: group.key } },
        '0.1.4',
        '2026-09-14T00:00:00Z'
      )
    ).not.toThrow()
    expect(() =>
      validateComparisonRequest({
        revision: 0,
        context: { ...context, selectedGroup: 'x'.repeat(MAX_RECORDED_GROUP_KEY_LENGTH + 1) }
      })
    ).toThrow('group selection')
  })
})
