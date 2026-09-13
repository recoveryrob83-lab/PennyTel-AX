import { describe, expect, it } from 'vitest'
import { modelConfiguration, modelIdentity } from '../src/shared/configuration'
import {
  compareData,
  comparisonExport,
  runFilterOptions,
  selectCohort,
  validateComparisonRequest,
  type ComparisonContext
} from '../src/shared/comparison'
import { groupRuns, runCost } from '../src/shared/metrics'
import { mergeImport, validateDataset } from '../src/shared/data'
import { emptyDataset } from '../src/shared/types'
import { configurationFixture } from './configuration-fixtures'

describe('derived Model Configuration', () => {
  it.each(['x', '\u0000', '"', '\\', '\ud800'])(
    'round-trips maximum identity evidence (%j) through selection and export',
    (character) => {
      const data = configurationFixture()
      delete data.registry
      data.runs = ['a', 'b'].map((suffix) => ({
        ...data.runs[0],
        id: suffix,
        model: character.repeat(99_999) + suffix,
        modelId: character.repeat(199) + suffix,
        modelFamily: character.repeat(99_999) + suffix,
        priceSnapshot: undefined
      }))
      validateDataset(data)
      const before = JSON.stringify(data)
      for (const dimension of ['modelConfiguration', 'canonicalModel', 'modelFamily'] as const) {
        const groups = groupRuns(data, data.runs, dimension)
        expect(groups).toHaveLength(2)
        expect(groups[0].key).not.toBe(groups[1].key)
        expect(runFilterOptions(data, dimension)).toEqual(
          groups.map(({ key, label }) => ({ key, label }))
        )
        for (const group of groups) {
          const context: ComparisonContext = {
            filters: { [dimension]: group.key },
            groupBy: dimension,
            sort: 'label',
            selectedGroup: group.key
          }
          const output = comparisonExport(
            data,
            { revision: data.revision, context },
            '0.1.1',
            '2026-09-12T00:00:00Z'
          )
          expect(compareData(data, context).shownRuns).toEqual(group.runs)
          expect(output.cohort.evidenceRunIds).toEqual(group.runs.map((run) => run.id))
          expect(JSON.parse(JSON.stringify(output)).context).toEqual(context)
        }
      }
      const tuple = JSON.parse(JSON.parse(modelConfiguration(data, data.runs[0]).key)[0])
      expect(tuple).toEqual(['unresolved-model', data.runs[0].modelId, data.runs[0].model])
      expect(JSON.stringify(data)).toBe(before)
    }
  )

  it('disambiguates presentation across unresolved IDs, canonical names and family Unknown without changing keys', () => {
    const data = configurationFixture()
    data.registry!.models[1].canonicalName = data.registry!.models[0].canonicalName
    data.runs = [
      { ...data.runs[0], id: 'a', modelId: 'missing-a', model: 'Same', modelFamily: undefined },
      { ...data.runs[0], id: 'b', modelId: 'missing-b', model: 'Same', modelFamily: 'Unknown' },
      { ...data.runs[0], id: 'c', modelId: data.registry!.models[0].id },
      { ...data.runs[0], id: 'd', modelId: data.registry!.models[1].id },
      {
        ...data.runs[0],
        id: 'e',
        modelId: 'missing-e',
        model: 'Same [1]',
        modelFamily: 'Unknown [1]'
      }
    ]
    const before = JSON.stringify(data)
    for (const dimension of ['modelConfiguration', 'canonicalModel', 'modelFamily'] as const) {
      const options = runFilterOptions(data, dimension)
      expect(new Set(options.map((option) => option.label)).size).toBe(options.length)
      expect(
        groupRuns(data, data.runs, dimension).map(({ key, label }) => ({ key, label }))
      ).toEqual(options)
      for (const option of options) {
        const selected = selectCohort(data, { [dimension]: option.key })
        expect(groupRuns(data, selected.runs, dimension)[0]).toMatchObject(option)
      }
      expect(runFilterOptions({ ...data, runs: [...data.runs].reverse() }, dimension)).toEqual(
        options
      )
    }
    expect(
      runFilterOptions(data, 'canonicalModel').find((option) => option.label === 'Same [1]')
    ).toBeDefined()
    expect(JSON.stringify(data)).toBe(before)
  })
  it('separates recorded efforts, merges established model aliases, and preserves all rollups', () => {
    const data = configurationFixture()
    validateDataset(data)
    const groups = groupRuns(data, data.runs, 'modelConfiguration')
    expect(groups.map((group) => group.label)).toEqual([
      'GPT-5.6 Luna — Max',
      'GPT-5.6 Sol — High',
      'GPT-6 Astra — ExtraHigh / XHigh',
      'GPT-6 Astra — Low',
      'GPT-6 Astra — Unknown'
    ])
    expect(
      groups.find((group) => group.label === 'GPT-6 Astra — Low')!.runs.map((run) => run.id)
    ).toEqual(['low', 'alias-low'])
    expect(
      groupRuns(data, data.runs, 'canonicalModel').find((group) => group.label === 'GPT-6 Astra')!
        .runs
    ).toHaveLength(4)
    expect(
      groupRuns(data, data.runs, 'modelFamily').find((group) => group.label === 'Astra')!.runs
    ).toHaveLength(4)
    expect(groupRuns(data, data.runs, 'model')).toHaveLength(4)
    expect(groupRuns(data, data.runs, 'thinking').map((group) => group.label)).toEqual([
      'ExtraHigh',
      'High',
      'Low',
      'Max',
      'Unknown'
    ])
    expect(data.runs[2].thinking).toBe('ExtraHigh')
    expect(data.runs[3].thinking).toBeUndefined()
  })

  it('honors stable IDs, rejects ambiguous/name-only guesses and keeps unresolved exact evidence distinct', () => {
    const data = configurationFixture()
    const run = data.runs[0]
    const model = data.registry!.models.find((model) => model.canonicalName === run.model)!
    const canonical = modelConfiguration(data, run)
    expect(
      modelConfiguration(data, {
        ...run,
        model: 'old recorded label',
        modelId: model.id,
        provider: undefined
      })
    ).toEqual(canonical)
    const legacy = { ...run, modelId: undefined, providerId: undefined, provider: undefined }
    expect(modelConfiguration(data, legacy).key).not.toBe(canonical.key)
    expect(
      modelConfiguration(data, { ...legacy, model: legacy.model!.toLowerCase() }).key
    ).not.toBe(modelConfiguration(data, legacy).key)
    expect(modelConfiguration(data, { ...run, modelId: 'missing' }).key).not.toBe(canonical.key)
    const aliasRun = { ...run, modelId: undefined, providerId: undefined, model: 'Shared alias' }
    data.registry!.models[0].aliases.push('Shared alias')
    data.registry!.models[1].aliases.push('Shared alias')
    expect(JSON.parse(modelIdentity(data, aliasRun).key)[0]).toBe('unresolved-model')
    const before = modelConfiguration(data, data.runs[3])
    model.reasoning.effortLevels = ['max']
    expect(modelConfiguration(data, data.runs[3])).toEqual(before)
    expect(before.label).toMatch(/Unknown$/)
    expect(() => validateDataset({ ...data, runs: [{ ...run, thinking: 'XHigh' }] })).toThrow()
  })

  it('uses collision-safe keys even for identical display names and delimiter-shaped legacy text', () => {
    const data = configurationFixture()
    const run = data.runs[0]
    const a = { ...run, modelId: 'unresolved-a' }
    const b = { ...run, modelId: 'unresolved-b' }
    expect(modelConfiguration(data, a).label).toBe(modelConfiguration(data, b).label)
    expect(modelConfiguration(data, a).key).not.toBe(modelConfiguration(data, b).key)
    expect(modelConfiguration(data, { ...a, model: 'A — Low', thinking: undefined }).key).not.toBe(
      modelConfiguration(data, { ...a, model: 'A', thinking: 'Low' }).key
    )
  })

  it('filters and exports the same configuration while retaining full accepted lifecycle economics', () => {
    const data = configurationFixture()
    const key = modelConfiguration(data, data.runs[0]).key
    const context: ComparisonContext = {
      filters: { modelConfiguration: key },
      groupBy: 'modelConfiguration',
      sort: 'label',
      selectedGroup: key
    }
    const view = compareData(data, context)
    expect(view.runs.map((run) => run.id)).toEqual(['low', 'alias-low'])
    expect(view.accepted[0].lifecycle).toEqual(data.runs)
    expect(selectCohort(data, { ...context.filters, role: 'Critic' }).slices).toEqual([])
    expect(
      selectCohort(data, { canonicalModel: modelIdentity(data, data.runs[0]).key }).runs
    ).toHaveLength(4)
    expect(
      selectCohort(data, { modelFamily: JSON.stringify(['family', 'Astra']) }).runs
    ).toHaveLength(4)
    expect(
      selectCohort(data, {
        modelConfiguration: modelConfiguration(data, data.runs[3]).key
      }).runs.map((run) => run.id)
    ).toEqual(['unknown'])
    expect(selectCohort(data, { modelConfiguration: 'GPT-6 Astra — Low' }).runs).toEqual([])
    expect(runFilterOptions(data, 'modelConfiguration').map((option) => option.key)).toEqual(
      groupRuns(data, data.runs, 'modelConfiguration').map((group) => group.key)
    )
    const output = comparisonExport(
      data,
      { revision: data.revision, context },
      '0.1.1',
      '2026-09-12T00:00:00Z'
    )
    expect(output.context).toEqual(context)
    expect(output.groups[0]).toMatchObject({
      key,
      label: view.groups[0].label,
      runIds: ['low', 'alias-low']
    })
    expect(output.cohort.evidenceRunIds).toEqual(['low', 'alias-low'])
    expect(output.acceptedSlices[0].costUSD.completeTotal).toBe(view.accepted[0].stats.cost)
    expect(() => validateComparisonRequest({ revision: 0, context })).not.toThrow()
    expect(() =>
      validateComparisonRequest({
        revision: 0,
        context: { ...context, filters: { modelConfiguration: 1 } }
      })
    ).toThrow()
    expect(() =>
      validateComparisonRequest({
        revision: 0,
        context: { ...context, groupBy: 'configurationGuess' }
      })
    ).toThrow()
  })

  it('leaves v1 raw evidence, snapshots and costs unchanged through analysis and raw import/export', () => {
    const data = configurationFixture()
    const original = JSON.stringify(data)
    const costs = data.runs.map(runCost)
    for (const groupBy of ['modelConfiguration', 'canonicalModel', 'modelFamily'] as const)
      comparisonExport(
        data,
        { revision: data.revision, context: { filters: {}, groupBy, sort: 'label' } },
        '0.1.1',
        '2026-09-12T00:00:00Z'
      )
    expect(JSON.stringify(data)).toBe(original)
    const imported = mergeImport(emptyDataset(), original).data
    expect(imported.runs).toEqual(data.runs)
    expect(imported.runs.map(runCost)).toEqual(costs)
    const legacy = JSON.parse(original)
    delete legacy.registry
    for (const run of legacy.runs) {
      delete run.modelId
      delete run.providerId
    }
    validateDataset(legacy)
    expect(
      groupRuns(legacy, legacy.runs, 'modelConfiguration').some((group) =>
        group.label.endsWith('Unknown')
      )
    ).toBe(true)
  })
})
