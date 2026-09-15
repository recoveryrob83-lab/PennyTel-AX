import { describe, expect, it } from 'vitest'
import { executionEvidenceAnalytics, runAnalytics } from '../src/shared/analytics'
import {
  compareData,
  comparisonExport,
  runFilterOptions,
  validateComparisonRequest,
  type ComparisonContext
} from '../src/shared/comparison'
import { executeComparisonPlan } from '../src/shared/comparison-plan'
import { modelConfiguration } from '../src/shared/configuration'
import { mergeImport, normalizeDataset, validateDataset } from '../src/shared/data'
import { groupRuns, peakContextUtilization, runCost, usageBurn } from '../src/shared/metrics'
import { evidenceFixture, fixture } from './fixtures'

function evidenceData(): ReturnType<typeof fixture> {
  const data = fixture()
  const run = data.runs[0]
  data.runs = [
    { ...run, id: 'complete', executionEvidence: evidenceFixture() },
    {
      ...run,
      id: 'zero',
      executionEvidence: {
        kind: 'codex-rollout',
        formatVersion: 1,
        runtimeVersion: 'Unknown',
        timeToFirstTokenMs: 0,
        modelInvocationCount: 0,
        toolCallCount: 0
      }
    },
    {
      ...run,
      id: 'partial',
      role: 'Critic',
      executionEvidence: {
        kind: 'codex-rollout',
        formatVersion: 1,
        modelContextWindowTokens: 500,
        peakInvocation: { inputTokens: 0, contextWindowTokens: 1000 }
      }
    },
    { ...run, id: 'legacy' }
  ]
  validateDataset(data)
  return data
}

describe('execution evidence in shared comparison analytics', () => {
  it('uses recorded paired peak occupancy only, including zero and full occupancy', () => {
    const e = evidenceFixture()
    e.modelContextWindowTokens = 1_000_000
    expect(peakContextUtilization(e)).toBe(0.45) // cached 80k is already inside 90k
    delete e.peakInvocation!.contextWindowTokens
    expect(peakContextUtilization(e)).toBeNull() // no fallback to top-level window
    e.peakInvocation = { inputTokens: 0, contextWindowTokens: 200_000 }
    expect(peakContextUtilization(e)).toBe(0)
    e.peakInvocation = { inputTokens: 200_000, contextWindowTokens: 200_000 }
    expect(peakContextUtilization(e)).toBe(1)
    delete e.peakInvocation
    expect(peakContextUtilization(e)).toBeNull()
    expect(peakContextUtilization()).toBeNull()
  })

  it('aggregates known samples with independent coverage, preserving zero, missing metrics and missing attachments', () => {
    const stats = runAnalytics(evidenceData().runs).executionEvidence
    expect(stats.sourceKinds).toEqual({
      counts: [{ value: 'codex-rollout', count: 3 }],
      recorded: 3,
      total: 4,
      complete: false
    })
    expect(stats.runtimeVersions).toMatchObject({ recorded: 2, total: 4, complete: false })
    expect(stats.timeToFirstTokenMs).toEqual({
      sampleCount: 4,
      knownCount: 2,
      unknownCount: 2,
      mean: 61.75,
      median: 61.75,
      min: 0,
      max: 123.5,
      sampleStandardDeviation: Math.sqrt(2 * 61.75 ** 2)
    })
    expect(stats.modelInvocationCount).toMatchObject({
      mean: 2,
      min: 0,
      max: 4,
      knownCount: 2,
      unknownCount: 2
    })
    expect(stats.toolCallCount).toMatchObject({
      mean: 1.5,
      min: 0,
      max: 3,
      knownCount: 2,
      unknownCount: 2
    })
    expect(stats.peakInputTokens).toMatchObject({
      mean: 45_000,
      min: 0,
      max: 90_000,
      knownCount: 2,
      unknownCount: 2
    })
    expect(stats.peakContextUtilization).toMatchObject({
      mean: 0.225,
      min: 0,
      max: 0.45,
      knownCount: 2,
      unknownCount: 2
    })
    const data = evidenceData()
    delete data.runs[0].executionEvidence!.peakInvocation!.contextWindowTokens
    const unpaired = executionEvidenceAnalytics(data.runs)
    expect(unpaired.peakInputTokens.knownCount).toBe(2)
    expect(unpaired.peakContextUtilization).toMatchObject({
      mean: 0,
      knownCount: 1,
      unknownCount: 3,
      sampleStandardDeviation: null
    })
  })

  it('keeps empty, absent and minimal evidence Unknown; v1 normalization does not manufacture evidence', () => {
    const legacy = normalizeDataset({ ...fixture(), schemaVersion: 1 })
    for (const runs of [
      [],
      legacy.runs,
      [
        {
          ...legacy.runs[0],
          executionEvidence: { kind: 'codex-rollout' as const, formatVersion: 1 as const }
        }
      ]
    ]) {
      const stats = executionEvidenceAnalytics(runs)
      for (const key of [
        'timeToFirstTokenMs',
        'modelInvocationCount',
        'toolCallCount',
        'peakInputTokens',
        'peakContextUtilization'
      ] as const)
        expect(stats[key]).toMatchObject({
          knownCount: 0,
          unknownCount: runs.length,
          mean: null,
          median: null,
          min: null,
          max: null,
          sampleStandardDeviation: null
        })
    }
    expect(executionEvidenceAnalytics([]).sourceKinds).toEqual({
      counts: [],
      recorded: 0,
      total: 0,
      complete: false
    })
    expect(legacy.runs[0]).not.toHaveProperty('executionEvidence')
  })

  it.each(['Clean', 'Contaminated', 'Unknown'] as const)(
    'keeps %s quota snapshots out of economics and evidence measurements',
    (attribution) => {
      const run = fixture().runs[0]
      const e = evidenceFixture()
      e.quotaWindows = [{ attribution, first: { usedPercent: 28 }, last: { usedPercent: 29 } }]
      const withQuota = { ...run, executionEvidence: e }
      expect(usageBurn(withQuota)).toBeNull()
      expect(runCost(withQuota)).toBe(runCost(run))
      expect(usageBurn({ ...withQuota, usageBefore: 90, usageAfter: 85 })).toBe(5)
      const withoutQuota = { ...e }
      delete withoutQuota.quotaWindows
      expect(executionEvidenceAnalytics([withQuota])).toEqual(
        executionEvidenceAnalytics([{ ...run, executionEvidence: withoutQuota }])
      )
    }
  )

  it('shares exact evidence filter/group identities, missing values and same-run stage qualification', () => {
    const data = evidenceData()
    expect(runFilterOptions(data, 'evidenceSourceKind')).toEqual([
      { key: 'codex-rollout', label: 'codex-rollout' }
    ])
    expect(
      runFilterOptions(data, 'runtimeVersion')
        .map((o) => o.key)
        .sort()
    ).toEqual(['Unknown', 'synthetic-1.0'])
    const groups = groupRuns(data, data.runs, 'runtimeVersion')
    expect(groups.find((g) => g.key === '["recorded",null]')!.runs.map((r) => r.id)).toEqual([
      'partial',
      'legacy'
    ])
    expect(groups.find((g) => g.key === '["recorded","Unknown"]')!.runs.map((r) => r.id)).toEqual([
      'zero'
    ])
    const context: ComparisonContext = {
      filters: { runtimeVersion: null },
      groupBy: 'evidenceSourceKind',
      sort: 'label'
    }
    validateComparisonRequest({ revision: data.revision, context })
    expect(compareData(data, context).runs.map((r) => r.id)).toEqual(['partial', 'legacy'])
    context.filters = { evidenceSourceKind: null }
    expect(compareData(data, context).runs.map((r) => r.id)).toEqual(['legacy'])
    context.filters = { evidenceSourceKind: 'codex-rollout', runtimeVersion: 'synthetic-1.0' }
    const qualified = compareData(data, context)
    expect(qualified.runs.map((r) => r.id)).toEqual(['complete'])
    expect(qualified.accepted[0].lifecycle).toEqual(data.runs)
    expect(qualified.accepted[0].metrics.analytics.executionEvidence.sourceKinds.recorded).toBe(3)
    context.stageScopes = [{ kind: 'role', value: 'Critic' }]
    expect(compareData(data, context).runs).toEqual([]) // another run cannot satisfy the stage
    context.stageScopes = []
    context.filters = { runtimeVersion: 'Unknown' }
    expect(compareData(data, context).runs.map((r) => r.id)).toEqual(['zero'])
  })

  it('exports the same evidence, context and membership in ordinary and ordered one-snapshot plan results without mutating data', () => {
    const data = evidenceData()
    const before = structuredClone(data)
    const contexts: ComparisonContext[] = [
      {
        filters: {},
        groupBy: 'runtimeVersion',
        sort: 'label',
        selectedCandidates: [modelConfiguration(data, data.runs[0]).key],
        selectedGroup: '["recorded",null]'
      },
      {
        filters: { evidenceSourceKind: 'codex-rollout' },
        groupBy: 'evidenceSourceKind',
        sort: 'cost'
      },
      { filters: { runtimeVersion: null }, groupBy: 'runtimeVersion', sort: 'time' },
      { filters: { evidenceSourceKind: null }, groupBy: 'runtimeVersion', sort: 'label' }
    ]
    const plan = {
      kind: 'pennytel-comparison-plan',
      planVersion: 1,
      name: 'Evidence parity',
      comparisons: contexts.map((context, i) => ({ id: `e${i}`, name: `Evidence ${i}`, context }))
    }
    const timestamp = '2026-09-15T12:00:00.000Z'
    const results = executeComparisonPlan(data, plan, '0.2.1', timestamp)
    for (const [i, context] of contexts.entries()) {
      const view = compareData(data, context)
      const output = comparisonExport(
        data,
        { revision: data.revision, context },
        '0.2.1',
        timestamp
      )
      expect(results.results[i].analysis).toEqual(output)
      expect(output.analytics).toEqual(view.analytics)
      expect(output.temporal).toEqual(view.temporal)
      expect(output.acceptedAnalytics).toEqual(view.acceptedAnalytics)
      expect(output.groups.map((g) => g.analytics)).toEqual(view.groups.map((g) => g.analytics))
      expect(output.candidates.map((c) => c.metrics)).toEqual(view.candidates.map((c) => c.metrics))
      expect(output.acceptedSlices.map((a) => a.analytics)).toEqual(
        view.accepted.map((a) => a.metrics.analytics)
      )
      expect(output.context).toEqual(context)
      expect(output.summary.usageBurnPercentagePoints.knownTotal).toBeNull()
      expect(() => mergeImport(data, JSON.stringify(output))).toThrow(/comparison/i)
    }
    expect(() => mergeImport(data, JSON.stringify(results))).toThrow(/comparison/i)
    expect(mergeImport(data, JSON.stringify(data)).data).toEqual(data)
    expect(data).toEqual(before)
  })
})
