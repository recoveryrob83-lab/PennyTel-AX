import { describe, expect, it } from 'vitest'
import {
  compareData,
  comparisonExport,
  selectCohort,
  validateComparisonRequest,
  type ComparisonContext
} from '../src/shared/comparison'
import { mergeImport, validateDataset } from '../src/shared/data'
import { emptyDataset } from '../src/shared/types'
import { comparisonFixture, runFixture } from './fixtures'
import { MAX_DERIVED_IDENTITY_LENGTH } from '../src/shared/configuration'

const context: ComparisonContext = {
  filters: { model: 'QA Astra', role: 'Implementer' },
  groupBy: 'role',
  sort: 'cost'
}
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
