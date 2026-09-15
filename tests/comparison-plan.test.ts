import { describe, expect, it, vi } from 'vitest'
import { comparisonExport, type ComparisonContext } from '../src/shared/comparison'
import {
  executeComparisonPlan,
  MAX_COMPARISON_PLAN_ENTRIES,
  MAX_COMPARISON_PLAN_NAME_LENGTH,
  parseComparisonPlan,
  validateComparisonPlan,
  type ComparisonPlan
} from '../src/shared/comparison-plan'
import { runComparisonPlanOperation } from '../src/main/comparison-plan'
import { mergeImport } from '../src/shared/data'
import { emptyDataset } from '../src/shared/types'
import { comparisonFixture } from './fixtures'

const context = (overrides: Partial<ComparisonContext> = {}): ComparisonContext => ({
  filters: {},
  groupBy: 'modelConfiguration',
  sort: 'label',
  ...overrides
})
const plan = (...contexts: ComparisonContext[]): ComparisonPlan => ({
  kind: 'pennytel-comparison-plan',
  planVersion: 1,
  name: 'Synthetic batch',
  comparisons: contexts.map((comparisonContext, index) => ({
    id: `comparison-${index + 1}`,
    name: `Comparison ${index + 1}`,
    context: comparisonContext
  }))
})

describe('comparison plan validation', () => {
  it('accepts valid one- and multi-comparison plans with complete ComparisonContext state', () => {
    expect(() => validateComparisonPlan(plan(context()))).not.toThrow()
    expect(() =>
      validateComparisonPlan(
        plan(
          context({ filters: { project: 'QA' }, groupBy: 'slice' }),
          context({
            filters: { model: 'QA Astra' },
            sort: 'cost',
            selectedGroup: 'QA Astra',
            stageScopes: [{ kind: 'role', value: 'Implementer' }],
            dateRange: { from: '2026-09-01T00:00:00.000Z', includeUnknown: true },
            outcomeFilters: { firstPass: 'No' }
          })
        )
      )
    ).not.toThrow()
  })

  it.each([
    ['wrong kind', { ...plan(context()), kind: 'other' }, 'kind'],
    ['wrong version', { ...plan(context()), planVersion: 2 }, 'planVersion'],
    ['empty comparisons', { ...plan(context()), comparisons: [] }, 'at least one'],
    [
      'over limit',
      {
        ...plan(context()),
        comparisons: Array.from({ length: MAX_COMPARISON_PLAN_ENTRIES + 1 }, (_, index) => ({
          id: `id-${index}`,
          name: 'Name',
          context: context()
        }))
      },
      'more than'
    ],
    [
      'duplicate ids',
      {
        ...plan(context(), context()),
        comparisons: plan(context(), context()).comparisons.map((e) => ({ ...e, id: 'same' }))
      },
      'duplicate'
    ],
    [
      'invalid id',
      { ...plan(context()), comparisons: [{ id: '../output', name: 'Name', context: context() }] },
      'invalid id'
    ],
    ['empty plan name', { ...plan(context()), name: '  ' }, 'plan name'],
    [
      'oversized plan name',
      { ...plan(context()), name: 'x'.repeat(MAX_COMPARISON_PLAN_NAME_LENGTH + 1) },
      'plan name'
    ],
    [
      'empty entry name',
      { ...plan(context()), comparisons: [{ id: 'valid', name: '', context: context() }] },
      'name must'
    ],
    ['unknown top field', { ...plan(context()), command: 'run' }, 'unknown field'],
    [
      'unknown entry field',
      {
        ...plan(context()),
        comparisons: [{ ...plan(context()).comparisons[0], outputPath: '/tmp/x' }]
      },
      'unknown field'
    ],
    [
      'malformed context',
      {
        ...plan(context()),
        comparisons: [
          {
            id: 'bad-context',
            name: 'Bad',
            context: { filters: {}, groupBy: 'path', sort: 'label' }
          }
        ]
      },
      'bad-context'
    ]
  ])('rejects %s', (_name, value, message) => {
    expect(() => validateComparisonPlan(value)).toThrow(message)
  })

  it.each([
    { filters: { arbitrary: 'x' }, groupBy: 'slice', sort: 'label' },
    { filters: {}, groupBy: 'wrong', sort: 'label' },
    { filters: {}, groupBy: 'slice', sort: 'wrong' },
    {
      filters: {},
      groupBy: 'slice',
      sort: 'label',
      stageScopes: [{ kind: 'role', value: 'Wrong' }]
    },
    { filters: {}, groupBy: 'slice', sort: 'label', dateRange: { includeUnknown: false } },
    { filters: {}, groupBy: 'slice', sort: 'label', outcomeFilters: { firstPass: 'Maybe' } },
    { filters: {}, groupBy: 'slice', sort: 'label', selectedCandidates: ['display label'] },
    { filters: {}, groupBy: 'slice', sort: 'label', selectedGroup: 4 }
  ])('delegates malformed comparison state to ordinary request validation', (badContext) => {
    const value = {
      ...plan(context()),
      comparisons: [{ id: 'delegated', name: 'Delegated', context: badContext }]
    }
    expect(() => validateComparisonPlan(value)).toThrow(/Comparison 1 \(delegated\) is invalid/)
  })

  it('parses JSON and rejects malformed JSON deterministically', () => {
    expect(parseComparisonPlan(JSON.stringify(plan(context()))).comparisons).toHaveLength(1)
    expect(() => parseComparisonPlan('{')).toThrow('Invalid comparison plan JSON')
  })
})

describe('comparison plan execution and isolation', () => {
  it('executes in order against one revision and exactly matches independent comparison exports', () => {
    const data = comparisonFixture()
    data.slices[0].risk = 'Medium'
    const contexts = [
      context({ filters: { project: 'QA' }, groupBy: 'slice' }),
      context({
        filters: { project: 'QA' },
        stageScopes: [{ kind: 'role', value: 'Implementer' }]
      }),
      context({ filters: {}, stageScopes: [{ kind: 'role', value: 'Repair' }] }),
      context({ filters: { project: 'QA', risk: 'Medium' }, groupBy: 'ambiguity' })
    ]
    const input = plan(...contexts)
    const before = JSON.stringify(data)
    const generatedAt = '2026-09-14T12:34:56.000Z'
    const bundle = executeComparisonPlan(data, input, '0.1.5', generatedAt)

    expect(bundle.kind).toBe('pennytel-comparison-plan-results')
    expect(bundle.resultsFormatVersion).toBe(1)
    expect(bundle.app).toEqual({ name: 'PennyTel', version: '0.1.5' })
    expect(bundle.source).toEqual({ datasetSchemaVersion: 1, datasetRevision: data.revision })
    expect(bundle.generatedAt).toBe(generatedAt)
    expect(bundle.plan).toEqual({
      kind: 'pennytel-comparison-plan',
      planVersion: 1,
      name: input.name
    })
    expect(bundle.results.map(({ id, name }) => ({ id, name }))).toEqual(
      input.comparisons.map(({ id, name }) => ({ id, name }))
    )
    bundle.results.forEach((result, index) => {
      expect(result.analysis).toEqual(
        comparisonExport(
          data,
          { revision: data.revision, context: contexts[index] },
          '0.1.5',
          generatedAt
        )
      )
      expect(result.analysis.kind).toBe('pennytel-comparison')
      expect(result.analysis.source.datasetRevision).toBe(bundle.source.datasetRevision)
      expect(result.analysis.generatedAt).toBe(bundle.generatedAt)
    })
    expect(bundle.results[2].analysis.context.filters).toEqual({})
    expect(bundle.results[2].analysis.context.stageScopes).toEqual([
      { kind: 'role', value: 'Repair' }
    ])
    expect(bundle.results[3].analysis.context).not.toHaveProperty('stageScopes')
    expect(bundle.results[3].analysis.context.filters).toEqual({ project: 'QA', risk: 'Medium' })
    expect(JSON.stringify(data)).toBe(before)
    expect(data.revision).toBe(0)
  })
})

describe('comparison plan main-process operation', () => {
  it('does nothing when open or save is canceled and uses one save for a valid plan', async () => {
    const loadDataset = vi.fn().mockResolvedValue(comparisonFixture())
    const saveResults = vi.fn().mockResolvedValue('/qa/results.json')
    expect(
      await runComparisonPlanOperation(
        { choosePlan: vi.fn().mockResolvedValue(null), loadDataset, saveResults },
        '0.1.5'
      )
    ).toBeNull()
    expect(loadDataset).not.toHaveBeenCalled()

    const result = await runComparisonPlanOperation(
      {
        choosePlan: vi.fn().mockResolvedValue(JSON.stringify(plan(context()))),
        loadDataset,
        saveResults
      },
      '0.1.5',
      '2026-09-14T00:00:00.000Z'
    )
    expect(result).toBe('/qa/results.json')
    expect(saveResults).toHaveBeenCalledTimes(1)
    expect(saveResults.mock.calls[0][1]).toBe('pennytel-comparison-results-2026-09-14.json')

    saveResults.mockResolvedValueOnce(null)
    expect(
      await runComparisonPlanOperation(
        {
          choosePlan: vi.fn().mockResolvedValue(JSON.stringify(plan(context()))),
          loadDataset,
          saveResults
        },
        '0.1.5'
      )
    ).toBeNull()
  })

  it('validates the whole plan before loading data or offering output', async () => {
    const loadDataset = vi.fn().mockResolvedValue(comparisonFixture())
    const saveResults = vi.fn()
    const invalid = plan(context(), context())
    invalid.comparisons[1].context = context({ groupBy: 'wrong' as never })
    await expect(
      runComparisonPlanOperation(
        {
          choosePlan: vi.fn().mockResolvedValue(JSON.stringify(invalid)),
          loadDataset,
          saveResults
        },
        '0.1.5'
      )
    ).rejects.toThrow('Comparison 2')
    expect(loadDataset).not.toHaveBeenCalled()
    expect(saveResults).not.toHaveBeenCalled()
  })
})

describe('telemetry import guard', () => {
  it.each([
    ['pennytel-comparison-plan', 'Use Run comparison plan'],
    ['pennytel-comparison-plan-results', 'cannot be imported as telemetry']
  ])('explicitly rejects %s', (kind, message) => {
    expect(() => mergeImport(emptyDataset(), JSON.stringify({ kind }))).toThrow(message)
  })
})
