import { describe, expect, it } from 'vitest'
import {
  compareData,
  comparisonExport,
  comparisonMetrics,
  MAX_COMPARISON_CANDIDATES,
  MAX_COMPARISON_STAGE_SCOPES,
  MAX_RUN_TYPE_SCOPE_LENGTH,
  stageScopeOptions,
  selectCohort,
  validateComparisonRequest,
  type ComparisonContext,
  type StageScope
} from '../src/shared/comparison'
import { mergeImport, validateDataset } from '../src/shared/data'
import { emptyDataset } from '../src/shared/types'
import { comparisonFixture, runFixture } from './fixtures'
import { MAX_DERIVED_IDENTITY_LENGTH, modelConfiguration } from '../src/shared/configuration'
import { configurationFixture } from './configuration-fixtures'
import { version } from '../package.json'

const context: ComparisonContext = {
  filters: { model: 'QA Astra', role: 'Implementer' },
  groupBy: 'role',
  sort: 'cost'
}
const workspace: ComparisonContext = { filters: {}, groupBy: 'modelConfiguration', sort: 'label' }
describe('real comparison workspace', () => {
  it('partitions canonical configurations in selection order, independently of ordinary filters and group navigation', () => {
    const data = configurationFixture()
    const selectedCandidates = [0, 4, 2, 5, 3].map(
      (index) => modelConfiguration(data, data.runs[index]).key
    )
    const base = compareData(data, workspace)
    const context = {
      ...workspace,
      selectedCandidates,
      groupBy: 'role' as const,
      sort: 'cost' as const,
      selectedGroup: 'Repair'
    }
    const view = compareData(data, context)
    expect(view.candidates.map((c) => c.runs.map((r) => r.id))).toEqual([
      ['low', 'alias-low'],
      ['luna'],
      ['xhigh'],
      ['sol'],
      ['unknown']
    ])
    expect(view.candidates.map((c) => c.key)).toEqual(selectedCandidates)
    expect(view.candidates[2].key).toContain('ExtraHigh')
    expect(view.candidates[2].label).toContain('ExtraHigh / XHigh')
    expect(view.candidates[4].label).toContain('Unknown')
    expect(view.candidates[4].key).toContain('null')
    expect(view.runs).toEqual(base.runs)
    expect(view.accepted).toEqual(base.accepted)
    expect(view.shownRuns.map((r) => r.id)).toEqual(['sol'])
    const filtered = compareData(data, { ...context, filters: { role: 'Critic' } })
    expect(filtered.candidates.map((c) => c.metrics.runCount)).toEqual([0, 1, 0, 0, 0])
    expect(filtered.candidates[0].metrics.costUSD.knownTotal).toBeNull()
    expect(filtered.accepted).toEqual(base.accepted)
    expect(compareData(data, context)).toEqual(view)
  })
  it.each([
    ['Implementer', ['low', 'alias-low', 'xhigh', 'unknown']],
    ['Critic', ['luna']],
    ['Repair', ['sol']]
  ] as const)('scopes %s using structured role evidence, not run type text', (value, ids) => {
    const data = configurationFixture() // all recorded run types are Implementation
    const view = compareData(data, { ...workspace, stageScopes: [{ kind: 'role', value }] })
    expect(view.runs.map((r) => r.id)).toEqual(ids)
    expect(view.accepted[0].lifecycle).toEqual(data.runs)
  })
  it('ORs stage scopes and ANDs them with same-run filters, qualifying only scoped slices', () => {
    const data = comparisonFixture()
    const stageScopes: StageScope[] = [
      { kind: 'role', value: 'Implementer' },
      { kind: 'role', value: 'Repair' }
    ]
    const view = compareData(data, { ...workspace, stageScopes, filters: { model: 'QA Astra' } })
    expect(view.runs.map((r) => r.id)).toEqual(['astra-impl'])
    expect(view.slices.map((s) => s.id)).toEqual(['mixed'])
    expect(view.accepted[0].stats.cost).toBe(6)
    const scoped = compareData(data, { ...workspace, stageScopes })
    expect(scoped.runs.every((r) => r.role === 'Implementer' || r.role === 'Repair')).toBe(true)
    expect(scoped.runs.some((r) => r.role === 'Repair')).toBe(true)
    expect(scoped.slices.some((s) => s.id === 'empty')).toBe(false)
    expect(compareData(data, workspace).slices.some((s) => s.id === 'empty')).toBe(true)
  })
  it('offers only recorded exact run types, preserving spelling, whitespace and mixed scope semantics', () => {
    const data = configurationFixture()
    expect(stageScopeOptions(data).filter((s) => s.kind === 'runType')).toEqual([
      { kind: 'runType', value: 'Implementation' }
    ])
    data.runs[0].runType = 'Re-critic'
    data.runs[1].runType = 'Verification'
    data.runs[2].runType = 'verification'
    data.runs[3].runType = ' Verification '
    validateDataset(data)
    const scopes: StageScope[] = [
      { kind: 'runType', value: 'Verification' },
      { kind: 'runType', value: 'Re-critic' }
    ]
    const view = compareData(data, { ...workspace, stageScopes: scopes })
    expect(view.runs.map((r) => r.id)).toEqual(['low', 'alias-low'])
    expect(stageScopeOptions(data)).toEqual(
      expect.arrayContaining([...scopes, { kind: 'runType', value: ' Verification ' }])
    )
    expect(
      compareData(data, {
        ...workspace,
        stageScopes: [...scopes, { kind: 'role', value: 'Critic' }]
      }).runs.map((r) => r.id)
    ).toEqual(['low', 'alias-low', 'luna'])
    expect(
      compareData(data, { ...workspace, stageScopes: scopes, filters: { role: 'Repair' } }).runs
    ).toEqual([])
  })
  it('exports colliding identities separately, complete workspace state and shared evidence without changing source', () => {
    const data = configurationFixture()
    data.runs.push(
      ...['a', 'b'].map((id) => ({
        ...data.runs[0],
        id,
        modelId: `missing-${id}`,
        model: 'Same',
        priceSnapshot: undefined,
        runType: 'Verification'
      }))
    )
    const selectedCandidates = data.runs.slice(-2).map((run) => modelConfiguration(data, run).key)
    data.findings = [
      {
        id: 'found',
        sliceId: 'slice-test',
        runId: 'a',
        severity: 'P1',
        category: 'Test Gap',
        description: 'Recorded finding'
      }
    ]
    data.discoveries = [
      {
        id: 'discovery',
        sliceId: 'slice-test',
        runId: 'a',
        description: 'Pending observation',
        validation: 'Pending'
      }
    ]
    validateDataset(data)
    const bytes = JSON.stringify(data)
    const context: ComparisonContext = {
      filters: { role: 'Implementer' },
      groupBy: 'role',
      sort: 'time',
      selectedGroup: 'Implementer',
      selectedCandidates,
      stageScopes: [{ kind: 'runType', value: 'Verification' }]
    }
    const view = compareData(data, context)
    const output = comparisonExport(
      data,
      { revision: data.revision, context },
      version,
      '2026-09-13T00:00:00Z'
    )
    expect(output.context).toEqual(context)
    expect(output.candidates.map((c) => c.key)).toEqual(selectedCandidates)
    expect(output.candidates.map((c) => c.label)).toEqual(['Same — Low [1]', 'Same — Low [2]'])
    expect(output.candidates.map((c) => c.runIds)).toEqual([['a'], ['b']])
    expect(output.candidates.map((c) => c.metrics)).toEqual(view.candidates.map((c) => c.metrics))
    expect(output.candidates[0].findings).toEqual(data.findings)
    expect(output.candidates[0].discoveries).toEqual(data.discoveries)
    expect(output.candidates[1].findings).toEqual([])
    expect(output.candidates[0].sliceDispositions.counts).toEqual([{ value: 'Accepted', count: 1 }])
    expect(output.acceptedSlices[0].lifecycleRunIds).toHaveLength(data.runs.length)
    expect(JSON.stringify(data)).toBe(bytes)
    expect(() =>
      comparisonExport(
        data,
        { revision: data.revision + 1, context },
        version,
        '2026-09-13T00:00:00Z'
      )
    ).toThrow('changed')
    expect(() => mergeImport(emptyDataset(), JSON.stringify(output))).toThrow(
      'not importable telemetry'
    )
    expect(mergeImport(emptyDataset(), bytes).data.runs).toEqual(data.runs)
    expect(output.app.version).toBe('0.1.5')
  })
  it('keeps empty candidates and partially priced/timed/cache/meter measurements honest', () => {
    const data = configurationFixture()
    const known = { ...data.runs[0], wallMinutes: 0, usageBefore: 90, usageAfter: 87 }
    const partial = {
      ...known,
      id: 'partial',
      inputTokens: undefined,
      reasoningTokens: undefined,
      wallMinutes: undefined,
      startAt: undefined,
      endAt: undefined,
      usageReset: true
    }
    const metrics = comparisonMetrics([known, partial])
    expect(metrics.costUSD).toMatchObject({
      knownTotal: comparisonMetrics([known]).costUSD.knownTotal,
      completeTotal: null,
      recorded: 1,
      total: 2
    })
    expect(metrics.meanPricedRunCostUSD).toBe(metrics.costUSD.knownTotal)
    expect(metrics.wallMinutes).toMatchObject({
      knownTotal: 0,
      completeTotal: null,
      recorded: 1,
      total: 2
    })
    expect(metrics.usageBurnPercentagePoints).toMatchObject({
      knownTotal: 3,
      recorded: 1,
      complete: false
    })
    expect(metrics.cache).toMatchObject({ knownRuns: 1, totalRuns: 2, complete: false })
    expect(comparisonMetrics([{ ...known, reasoningTokens: 0 }]).costUSD).toEqual(
      comparisonMetrics([known]).costUSD
    )
    expect(
      comparisonMetrics([
        { ...known, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }
      ]).costUSD.knownTotal
    ).toBe(0)
    expect(
      comparisonMetrics([{ ...known, inputTokens: 0, cachedInputTokens: 0 }]).cache.ratio
    ).toBeNull()
    expect(
      comparisonMetrics([{ ...known, usageAfter: 99 }, partial]).usageBurnPercentagePoints
        .knownTotal
    ).toBeNull()
    expect(
      comparisonMetrics([{ ...partial, usageBurn: 0 }]).usageBurnPercentagePoints.knownTotal
    ).toBe(0)
    const selectedCandidates = [modelConfiguration(data, data.runs[4]).key]
    const empty = compareData(data, {
      ...workspace,
      selectedCandidates,
      stageScopes: [{ kind: 'role', value: 'Repair' }]
    }).candidates[0]
    expect(empty.label).toBe('GPT-5.6 Luna — Max')
    expect(empty.metrics.runCount).toBe(0)
    for (const value of [
      empty.metrics.costUSD,
      empty.metrics.wallMinutes,
      ...Object.values(empty.metrics.evidence.numeric)
    ])
      expect(value).toMatchObject({ knownTotal: null, recorded: 0, total: 0, complete: false })
  })
  it('validates bounded canonical keys and stage unions, including duplicate, malformed and oversized state', () => {
    const candidate = (id: string): string => JSON.stringify([JSON.stringify(['model', id]), 'Low'])
    const request = (state: Record<string, unknown>): unknown => ({
      revision: 0,
      context: { ...workspace, ...state }
    })
    const candidates = Array.from({ length: MAX_COMPARISON_CANDIDATES }, (_, i) =>
      candidate(String(i))
    )
    const stages = Array.from({ length: MAX_COMPARISON_STAGE_SCOPES }, (_, i) => ({
      kind: 'runType',
      value: String(i)
    }))
    expect(() =>
      validateComparisonRequest(request({ selectedCandidates: candidates, stageScopes: stages }))
    ).not.toThrow()
    for (const selectedCandidates of [
      null,
      'x',
      [null],
      [''],
      ['Astra — Low'],
      [candidate('a'), candidate('a')],
      [...candidates, candidate('extra')],
      ['x'.repeat(MAX_DERIVED_IDENTITY_LENGTH + 1)],
      [JSON.stringify([JSON.stringify(['model', 'a']), 'XHigh'])],
      [JSON.stringify([JSON.stringify(['family', 'a']), 'Low'])],
      [candidate('a'.repeat(100_001))],
      Array(1)
    ])
      expect(() => validateComparisonRequest(request({ selectedCandidates }))).toThrow('candidate')
    for (const stageScopes of [
      null,
      'Critic',
      [null],
      [{}],
      [{ kind: 'role', value: 'Verification' }],
      [{ kind: 'role', value: 'toString' }],
      [{ kind: 'runType', value: '' }],
      [{ kind: 'runType', value: ' ' }],
      [{ kind: 'runType', value: 1 }],
      [{ kind: 'runType', value: 'x', extra: true }],
      [{ kind: 'stage', value: 'Repair' }],
      [stages[0], { value: '0', kind: 'runType' }],
      [...stages, { kind: 'runType', value: 'extra' }],
      [{ kind: 'runType', value: 'x'.repeat(MAX_RUN_TYPE_SCOPE_LENGTH + 1) }],
      Array(1)
    ])
      expect(() => validateComparisonRequest(request({ stageScopes }))).toThrow('stage')
    expect(() =>
      validateComparisonRequest(
        request({
          stageScopes: [{ kind: 'runType', value: 'x'.repeat(MAX_RUN_TYPE_SCOPE_LENGTH) }],
          selectedCandidates: [candidate('a'.repeat(100_000))]
        })
      )
    ).not.toThrow()
  })
})
describe('bounded comparison and non-importable analysis export', () => {
  it('bounds derived requests separately while retaining source field limits', () => {
    for (const [dimension, limit] of [
      ['modelConfiguration', MAX_DERIVED_IDENTITY_LENGTH],
      ['canonicalModel', MAX_DERIVED_IDENTITY_LENGTH],
      ['modelFamily', MAX_DERIVED_IDENTITY_LENGTH],
      ['model', 100_000]
    ] as const) {
      const request = {
        revision: 0,
        context: {
          filters: { [dimension]: 'x'.repeat(limit) },
          groupBy: dimension,
          sort: 'label',
          selectedGroup: 'x'.repeat(limit)
        }
      }
      expect(() => validateComparisonRequest(request)).not.toThrow()
      expect(() =>
        validateComparisonRequest({
          ...request,
          context: { ...request.context, selectedGroup: 'x'.repeat(limit + 1) }
        })
      ).toThrow('selection')
      expect(() =>
        validateComparisonRequest({
          ...request,
          context: { ...request.context, filters: { [dimension]: 'x'.repeat(limit + 1) } }
        })
      ).toThrow('filter')
    }
  })
  it('qualifies only matching slices while retaining other models’ full acceptance lifecycle', () => {
    const data = comparisonFixture()
    validateDataset(data)
    const view = compareData(data, context)
    expect(view.slices.map((s) => s.id)).toEqual(['mixed'])
    expect(view.runs.map((r) => r.id)).toEqual(['astra-impl'])
    expect(view.summary.cost).toBe(1)
    expect(view.accepted[0].lifecycle.map((r) => r.id)).toEqual([
      'astra-impl',
      'luna-critic',
      'luna-repair'
    ])
    expect(view.accepted[0].stats.cost).toBe(6)
    expect(view.accepted[0].repair.cost).toBe(3)
    expect(view.accepted[0].critic.cost).toBe(2)
    expect(view.accepted[0].elapsedMinutes).toBe(60)
  })
  it('intersects slice filters, preserves empty slices without run filters, and supports 1–5 quality filters', () => {
    const data = comparisonFixture()
    expect(selectCohort(data, {}).slices).toHaveLength(4)
    expect(selectCohort(data, { model: 'QA Astra' }).slices.map((s) => s.id)).toEqual([
      'mixed',
      'cross-role'
    ])
    expect(selectCohort(data, { model: 'QA Astra', qualityGrade: '3' }).slices).toEqual([])
    expect(selectCohort(data, { qualityGrade: '5' }).slices.map((s) => s.id)).toEqual(['mixed'])
    expect(selectCohort(data, { project: 'different' }).runs).toEqual([])
  })
  it('exports reproducible context, complete lifecycle, quality, evidence categories and independent discovery counts', () => {
    const data = comparisonFixture(),
      generatedAt = '2026-09-12T04:00:00Z'
    const original = structuredClone(data)
    const output = comparisonExport(
      data,
      { revision: data.revision, context: { ...context, selectedGroup: 'Implementer' } },
      '0.1.0',
      generatedAt
    )
    expect(output.kind).toBe('pennytel-comparison')
    expect(output.analysisFormatVersion).toBe(1)
    expect(output.source).toEqual({ datasetSchemaVersion: 1, datasetRevision: 0 })
    expect(output.generatedAt).toBe(generatedAt)
    expect(output.app.version).toBe('0.1.0')
    expect(output.context).toMatchObject(context)
    expect(output.cohort.sliceIds).toEqual(['mixed'])
    expect(output.cohort.evidenceRunIds).toEqual(['astra-impl'])
    expect(output.summary.costUSD.completeTotal).toBe(1)
    const accepted = output.acceptedSlices[0]
    expect(accepted.costUSD.completeTotal).toBe(6)
    expect(accepted.roles.Repair.completeTotal).toBe(3)
    expect(accepted.roles.Critic.completeTotal).toBe(2)
    expect(accepted.qualityGrade).toBe(5)
    expect(accepted.defects.bySeverity).toEqual({ P0: 0, P1: 2, P2: 0 })
    expect(accepted.defects.bySeverityAndCategory.P1.Product).toBe(1)
    expect(accepted.defects.bySeverityAndCategory.P1.Harness).toBe(1)
    expect(accepted.defects.observations).toBe(1)
    expect(accepted.defects.dismissed).toBe(1)
    expect(accepted.validatedAutonomousDiscoveries).toBe(1)
    expect(output.summary.validatedAutonomousDiscoveries).toBe(1)
    expect(output.summary.acceptedSliceQuality.byGrade[5]).toBe(1)
    expect(data).toEqual(original)
    expect(() => mergeImport(emptyDataset(), JSON.stringify(output))).toThrow(
      'not importable telemetry'
    )
  })
  it('keeps unknown, zero, and partial measurements distinct through JSON serialization', () => {
    const data = comparisonFixture()
    data.runs.push(
      runFixture({
        id: 'unknown',
        sliceId: 'mixed',
        startAt: undefined,
        endAt: undefined,
        inputTokens: undefined,
        cachedInputTokens: undefined,
        outputTokens: undefined,
        reasoningTokens: undefined,
        role: 'Context Steward'
      })
    )
    const output = JSON.parse(
      JSON.stringify(
        comparisonExport(data, { revision: 0, context }, '0.1.0', '2026-09-12T04:00:00Z')
      )
    )
    const accepted = output.acceptedSlices[0]
    expect(accepted.costUSD).toEqual({
      knownTotal: 6,
      completeTotal: null,
      recorded: 3,
      total: 4,
      complete: false
    })
    expect(accepted.roles['Context Steward'].knownTotal).toBeNull()
    expect(accepted.roles.Orchestrator.knownTotal).toBe(0)
    expect(accepted.usageBurnPercentagePoints.completeTotal).toBeNull()
    expect(accepted.acceptanceWindow.undatedRunIds).toEqual(['unknown'])
    const empty = comparisonExport(
      emptyDataset(),
      { revision: 0, context: { filters: {}, groupBy: 'model', sort: 'label' } },
      '0.1.0',
      '2026-09-12T04:00:00Z'
    )
    expect(empty.summary.costUSD.knownTotal).toBeNull()
    expect(empty.summary.cache.ratio).toBeNull()
  })
  it('uses matching sort order and selection without narrowing the lifecycle cohort', () => {
    const data = comparisonFixture()
    const output = comparisonExport(
      data,
      {
        revision: 0,
        context: { filters: {}, groupBy: 'model', sort: 'cost', selectedGroup: 'QA Astra' }
      },
      '0.1.0',
      '2026-09-12T04:00:00Z'
    )
    expect(output.groups.map((g) => g.label)).toEqual(['QA Luna', 'QA Astra'])
    expect(output.cohort.evidenceRunIds).toEqual(['astra-impl', 'cross-astra'])
    expect(output.acceptedSlices).toHaveLength(4)
    const found = output.groups.find((g) => g.label === 'QA Luna')!.defectsFound
    expect(found.bySeverity.P1).toBe(2)
    expect(found.byCategory.Product).toBe(1)
    expect(found.byCategory.Harness).toBe(1)
  })
  it('rejects stale revisions and untrusted export context or payload fields', () => {
    expect(() =>
      comparisonExport(
        comparisonFixture(),
        { revision: 10, context },
        '0.1.0',
        '2026-09-12T04:00:00Z'
      )
    ).toThrow('changed')
    for (const request of [
      null,
      { revision: 0, context: { ...context, groupBy: 'path' } },
      { revision: 0, context: { ...context, filters: { arbitrary: 'x' } } },
      { revision: 0, context, derivedCost: 0 },
      { revision: 0, context: { ...context, sort: 'wrong' } }
    ])
      expect(() => validateComparisonRequest(request)).toThrow()
  })
})
