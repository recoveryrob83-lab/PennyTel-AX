import { describe, expect, it } from 'vitest'
import seed from '../docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json'
import { applyMutation, mergeImport, validateDataset, validateRecord } from '../src/shared/data'
import {
  backfillRegistry,
  parseRegistry,
  priceAt,
  reconcileLegacyPricing,
  registrySnapshot,
  resolveIdentity,
  validateRegistry,
  type ModelRegistry
} from '../src/shared/registry'
import { emptyDataset, type Dataset, type Pricing } from '../src/shared/types'
import { runCost } from '../src/shared/metrics'
import { fixture } from './fixtures'

import { registryFixture, recoveredRun, recoveredData } from './registry-fixtures'
const install = (data: Dataset, registry = registryFixture()): Dataset =>
  applyMutation(data, {
    kind: 'registry-import',
    revision: data.revision,
    text: JSON.stringify(registry)
  })
const legacy = (overrides: Partial<Pricing> = {}): Pricing => ({
  id: 'legacy-luna',
  model: 'Luna',
  provider: 'OpenAI',
  effectiveDate: '2026-07-01',
  inputRate: 0.1,
  cachedRate: 0.01,
  outputRate: 0.5,
  source: 'Historical operator evidence',
  notes: 'Keep me',
  ...overrides
})

describe('registry contract validation', () => {
  it('accepts the unchanged canonical seed and preserves all benchmark values', () => {
    expect(() => validateRegistry(seed)).not.toThrow()
    expect(registryFixture()).toEqual(seed)
  })
  it.each(['makers', 'providers', 'models'] as const)('rejects duplicate %s IDs', (table) => {
    const registry = registryFixture()
    registry[table].push(registry[table][0] as never)
    expect(() => validateRegistry(registry)).toThrow('duplicate ID')
  })
  it.each([
    [
      'kind',
      (r: ModelRegistry) => {
        Object.assign(r, { kind: 'arbitrary' })
      }
    ],
    [
      'schemaVersion',
      (r: ModelRegistry) => {
        Object.assign(r, { schemaVersion: 2 })
      }
    ],
    [
      'maker',
      (r: ModelRegistry) => {
        r.models[0].makerId = 'missing'
      }
    ],
    [
      'provider',
      (r: ModelRegistry) => {
        r.models[0].offers[0].providerId = 'missing'
      }
    ],
    [
      'offer ID',
      (r: ModelRegistry) => {
        r.models[1].offers[0].id = r.models[0].offers[0].id
      }
    ],
    [
      'duplicate offer',
      (r: ModelRegistry) => {
        r.models[0].offers.push({ ...r.models[0].offers[0], id: 'another' })
      }
    ],
    [
      'effectiveFrom',
      (r: ModelRegistry) => {
        r.models[0].offers[0].pricingHistory[0].effectiveFrom = '2026-02-30'
      }
    ],
    [
      'effectiveTo',
      (r: ModelRegistry) => {
        r.models[0].offers[0].pricingHistory[0].effectiveTo = '2026-01-01'
      }
    ],
    [
      'negative rate',
      (r: ModelRegistry) => {
        r.models[0].offers[0].pricingHistory[0].inputUsd = -1
      }
    ],
    [
      'nonfinite rate',
      (r: ModelRegistry) => {
        r.models[0].offers[0].pricingHistory[0].cacheWriteUsd = Infinity
      }
    ],
    [
      'duplicate effective date',
      (r: ModelRegistry) => {
        r.models[0].offers[0].pricingHistory.push({
          ...r.models[0].offers[0].pricingHistory[0],
          inputUsd: 7
        })
      }
    ],
    [
      'effort',
      (r: ModelRegistry) => {
        Object.assign(r.models[0].reasoning, { effortLevels: ['extreme'] })
      }
    ],
    [
      'benchmark shape',
      (r: ModelRegistry) => {
        Object.assign(r.models[0].benchmarks[0], { score: '99' })
      }
    ],
    [
      'benchmark percent',
      (r: ModelRegistry) => {
        r.models[0].benchmarks[0].score = 101
      }
    ],
    [
      'unknown nested field',
      (r: ModelRegistry) => {
        Object.assign(r.models[0].offers[0].pricingHistory[0], { inputUSd: 1 })
      }
    ],
    [
      'unknown root field',
      (r: ModelRegistry) => {
        Object.assign(r, { mystery: true })
      }
    ],
    [
      'policy order',
      (r: ModelRegistry) => {
        r.pricingResolutionPolicy.pricingReferencePreference.reverse()
      }
    ],
    [
      'mutable snapshot policy',
      (r: ModelRegistry) => {
        Object.assign(r.pricingResolutionPolicy, { historicalSnapshotsImmutable: false })
      }
    ]
  ])('rejects malformed %s', (_label, edit) => {
    const registry = registryFixture()
    edit(registry)
    expect(() => validateRegistry(registry)).toThrow(/Registry\./)
  })
  it('rejects invalid JSON, oversized input and telemetry submitted as registry', () => {
    expect(() => parseRegistry('{')).toThrow('Invalid registry JSON')
    expect(() => parseRegistry(' '.repeat(10000001))).toThrow('10 MB')
    expect(() => parseRegistry(JSON.stringify(emptyDataset()))).toThrow()
  })
})

describe('identity and historical pricing', () => {
  it('resolves stable IDs, canonical names, API/provider IDs, and legacy first-party maker names', () => {
    const registry = registryFixture()
    for (const run of [
      recoveredRun(),
      recoveredRun({ model: ' luna ', provider: 'openai api' }),
      recoveredRun({ model: 'gpt-5.6-luna', provider: 'openai-api' }),
      recoveredRun({
        model: undefined,
        provider: undefined,
        modelId: 'openai:gpt-5.6-luna',
        providerId: 'openai-api'
      })
    ]) {
      expect(resolveIdentity(run, registry)?.offer.id).toBe('openai:gpt-5.6-luna@openai-api')
    }
  })
  it('does not infer a missing provider or substitute for an unknown explicit ID', () => {
    expect(
      resolveIdentity(recoveredRun({ provider: undefined }), registryFixture())
    ).toBeUndefined()
    expect(resolveIdentity(recoveredRun({ modelId: 'unknown' }), registryFixture())).toBeUndefined()
  })
  it('never guesses between aliases or multiple first-party offers', () => {
    const registry = registryFixture()
    registry.models[0].aliases.push('Luna')
    expect(resolveIdentity(recoveredRun({ model: 'Luna' }), registry)).toBeUndefined()
    const data = recoveredData()
    data.runs[0].model = 'Luna'
    data.pricing = [legacy()]
    expect(install(data, registry).runs[0]).toEqual(data.runs[0])
    const another = registryFixture()
    another.providers.push({
      id: 'another-api',
      name: 'Another OpenAI endpoint',
      type: 'first_party_api'
    })
    another.models[3].offers.push({
      ...another.models[3].offers[0],
      id: 'another-offer',
      providerId: 'another-api'
    })
    expect(resolveIdentity(recoveredRun(), another)).toBeUndefined()
  })
  it('selects the latest covering price and treats effectiveTo as exclusive', () => {
    const offer = registryFixture().models[3].offers[0]
    offer.pricingHistory.push({
      ...offer.pricingHistory[0],
      effectiveFrom: '2026-09-01',
      effectiveTo: '2026-09-10',
      inputUsd: 0.3
    })
    expect(priceAt(offer, '2026-07-29')).toBeUndefined()
    expect(priceAt(offer, '2026-08-01')?.inputUsd).toBe(0.2)
    expect(priceAt(offer, '2026-09-01')?.inputUsd).toBe(0.3)
    expect(priceAt(offer, '2026-09-10')?.inputUsd).toBe(0.2)
    offer.pricingHistory[0].effectiveTo = '2026-09-01'
    expect(priceAt(offer, '2026-09-10')).toBeUndefined()
  })
  it.each([
    [
      { startAt: '2026-08-01T23:30:00-05:00', pricingReferenceDate: '2026-09-11' },
      '2026-08-02',
      'run.startAt',
      0.2
    ],
    [{ pricingReferenceDate: '2026-08-03' }, '2026-08-03', 'run.pricingReferenceDate', 0.2],
    [{}, '2026-09-11', 'slice.startDate', 0.4]
  ] as const)('uses reference date preference for %j', (overrides, date, source, rate) => {
    const registry = registryFixture(),
      data = recoveredData()
    const history = registry.models[3].offers[0].pricingHistory
    history.push({ ...history[0], effectiveFrom: '2026-09-01', inputUsd: 0.4 })
    data.runs = [recoveredRun(overrides)]
    expect(install(data, registry).runs[0].priceSnapshot).toMatchObject({
      referenceDate: date,
      referenceDateSource: source,
      inputRate: rate
    })
  })
  it('does not fall through to a later reference date when the preferred date has no price', () => {
    const data = recoveredData()
    data.runs[0].startAt = '2026-01-01T00:00:00Z'
    data.runs[0].pricingReferenceDate = '2026-09-11'
    expect(install(data).runs[0].priceSnapshot).toBeUndefined()
  })
  it('leaves missing and prehistory dates unpriced without legacy fallback for a registered offer', () => {
    const data = recoveredData()
    delete data.slices[0].startDate
    expect(install(data).runs[0].priceSnapshot).toBeUndefined()
    const registry = registryFixture()
    registry.models[3].offers[0].pricingHistory = []
    expect(registrySnapshot(recoveredRun(), registry, recoveredData().slices[0])).toBeUndefined()
    const installed = install(recoveredData())
    installed.pricing = [legacy({ effectiveDate: '2026-09-11', inputRate: 100 })]
    installed.registry!.models[3].offers[0].pricingHistory = []
    installed.runs = []
    const imported = mergeImport(
      installed,
      JSON.stringify({
        schemaVersion: 1,
        runs: [recoveredRun({ startAt: '2026-09-11T00:00:00Z' })]
      })
    ).data
    expect(imported.runs[0].priceSnapshot).toBeUndefined()
  })
  it.each([
    ['GPT-5.6 Luna', 0.1685406, 0.2, 0.02, 1.2],
    ['GPT-6 Astra', 7.73657, 10, 1, 50]
  ] as const)(
    'prices recovered %s with the canonical API-equivalent rates',
    (model, cost, inputRate, cachedRate, outputRate) => {
      const data = recoveredData()
      data.runs[0].model = model
      const run = install(data).runs[0]
      expect(run.priceSnapshot).toMatchObject({
        inputRate,
        cachedRate,
        outputRate,
        source: 'Registry'
      })
      expect(runCost(run)).toBeCloseTo(cost, 9)
      expect(run.startAt).toBeUndefined()
    }
  )
})

describe('snapshot immutability, backfill and v1 portability', () => {
  it('backfills eligible runs while retaining existing snapshots, unknown runs and absent dates', () => {
    const data = recoveredData()
    data.runs.push(
      recoveredRun({ id: 'unknown', model: 'Unknown' }),
      recoveredRun({ id: 'missing-date', sliceId: 'undated' })
    )
    data.slices.push({ id: 'undated', title: 'Undated' })
    const frozen = install(recoveredData()).runs[0]
    data.runs.push({ ...frozen, id: 'frozen' })
    const installed = install(data)
    expect(installed.runs[0].priceSnapshot).toBeDefined()
    expect(installed.runs[1]).toEqual(data.runs[1])
    expect(installed.runs[2].priceSnapshot).toBeUndefined()
    expect(installed.runs[3]).toEqual(data.runs[3])
    expect(backfillRegistry(installed)).toEqual(installed)
    expect(data.runs[0].priceSnapshot).toBeUndefined()
  })
  it('updates registry metadata and rates without changing snapshots or calculated cost', () => {
    const original = install(recoveredData()),
      registry = registryFixture()
    registry.registryRevision++
    registry.models[3].canonicalName = 'New Luna display name'
    registry.models[3].aliases = []
    registry.models[3].offers[0].pricingHistory[0].inputUsd = 999
    const changed = install(original, registry)
    expect(changed.runs).toEqual(original.runs)
    expect(runCost(changed.runs[0])).toBe(runCost(original.runs[0]))
    expect(changed.registry?.models[3].canonicalName).toBe('New Luna display name')
  })
  it('backfills previously unmatched runs after an alias and price update', () => {
    const data = recoveredData()
    data.runs[0].model = 'Recovered Luna label'
    const original = install(data),
      registry = registryFixture()
    expect(original.runs[0].priceSnapshot).toBeUndefined()
    registry.models[3].aliases.push('Recovered Luna label')
    expect(install(original, registry).runs[0].priceSnapshot).toBeDefined()
  })
  it('backfills after adding a slice date and after importing a recovered v1 experiment', () => {
    const data = recoveredData()
    delete data.slices[0].startDate
    const original = install(data)
    const changed = applyMutation(original, {
      kind: 'save',
      table: 'slices',
      revision: original.revision,
      record: { ...original.slices[0], startDate: '2026-09-11' }
    })
    expect(changed.runs[0].priceSnapshot).toBeDefined()
    const imported = mergeImport(install(emptyDataset()), JSON.stringify(recoveredData())).data
    expect(runCost(imported.runs[0])).toBeCloseTo(0.1685406)
    expect(() => validateDataset(imported)).not.toThrow()
  })
  it('keeps old v1 datasets and pricing, and round-trips complete registry exports', () => {
    const legacyData = fixture()
    const imported = mergeImport(install(emptyDataset()), JSON.stringify(legacyData)).data
    expect(imported.pricing).toEqual(legacyData.pricing)
    expect(imported.runs[0].priceSnapshot).toEqual(legacyData.runs[0].priceSnapshot)
    const restored = mergeImport(emptyDataset(), JSON.stringify(imported)).data
    expect(restored).toEqual({ ...imported, revision: 0 })
    expect(mergeImport(imported, JSON.stringify(imported)).preview.skipped).toBe(3)
    expect(() => validateDataset(emptyDataset())).not.toThrow()
  })
  it('refuses implicit registry replacement via telemetry import and malformed registry snapshots', () => {
    const original = install(recoveredData()),
      changed = structuredClone(original)
    changed.registry!.registryRevision++
    expect(() => mergeImport(original, JSON.stringify(changed))).toThrow('Use Model Registry')
    expect(() => mergeImport(original, JSON.stringify(seed))).toThrow('Use Model Registry')
    const run = structuredClone(original.runs[0])
    delete run.priceSnapshot!.referenceDate
    expect(() => validateRecord('runs', run)).toThrow('provenance')
  })
  it('protects referenced identity from removal but allows retirement', () => {
    const original = install(recoveredData()),
      registry = registryFixture()
    registry.models = registry.models.filter((m) => m.id !== original.runs[0].modelId)
    expect(() => install(original, registry)).toThrow('removes identity')
    const retired = registryFixture()
    retired.models[3].status = 'retired'
    expect(install(original, retired).runs).toEqual(original.runs)
  })
})

describe('legacy pricing reconciliation and precedence', () => {
  it.each(['2026-07-30', '2026-06-01'])(
    're-bounds migrated history when authored pricing starts on %s',
    (start) => {
      const registry = registryFixture()
      const authored = {
        ...registry.models[3].offers[0].pricingHistory[0],
        effectiveFrom: start,
        effectiveTo: '2026-08-30'
      }
      registry.models[3].offers[0].pricingHistory = []
      const data = recoveredData()
      data.pricing = [legacy(), legacy({ id: 'alias', model: 'gpt-5.6-luna' })]
      data.runs[0].pricingReferenceDate = '2026-07-15'
      const installed = install(data, registry)
      expect(installed.registry!.models[3].offers[0].pricingHistory[0].effectiveTo).toBeNull()
      const update = structuredClone(installed.registry!)
      update.models[3].offers[0].pricingHistory.push(authored)
      const changed = install(installed, update)
      const offer = changed.registry!.models[3].offers[0]
      for (const date of [
        '2026-05-31',
        '2026-07-01',
        '2026-07-29',
        start,
        '2026-08-29',
        '2026-08-30',
        '2026-09-01'
      ]) {
        const rate =
          date >= start && date < '2026-08-30'
            ? authored.inputUsd
            : date >= '2026-07-01' && date < start
              ? 0.1
              : undefined
        expect(priceAt(offer, date)?.inputUsd).toBe(rate)
        const snapshot = registrySnapshot(
          recoveredRun({ pricingReferenceDate: date }),
          changed.registry!
        )
        expect(snapshot?.inputRate).toBe(rate)
        if (snapshot) expect(snapshot.source).toBe('Registry')
      }
      expect(changed.runs).toEqual(installed.runs)
      expect(changed.pricing).toEqual(data.pricing)
      expect(install(changed, changed.registry!).registry).toEqual(changed.registry)
      expect(
        install({ ...installed, pricing: [...data.pricing].reverse() }, update).registry
      ).toEqual(changed.registry)
    }
  )
  it('migrates only earlier history, bounds it at canonical pricing, and preserves original rows', () => {
    const data = recoveredData()
    data.pricing = [legacy()]
    data.runs[0].pricingReferenceDate = '2026-07-15'
    const installed = install(data)
    expect(installed.pricing).toEqual(data.pricing)
    expect(installed.registry!.models[3].offers[0].pricingHistory[0]).toMatchObject({
      effectiveFrom: '2026-07-01',
      effectiveTo: '2026-07-30',
      legacyPricingIds: ['legacy-luna']
    })
    expect(installed.registry!.models[3].offers[0].pricingHistory[0].cacheWriteUsd).toBeUndefined()
    expect(installed.runs[0].priceSnapshot?.inputRate).toBe(0.1)
    expect(reconcileLegacyPricing(installed.registry!, data.pricing).registry).toEqual(
      installed.registry
    )
  })
  it('reconciles equivalent entries without duplicates and never overrides conflicting registry prices', () => {
    const registry = registryFixture()
    const same = legacy({
      effectiveDate: '2026-07-30',
      inputRate: 0.2,
      cachedRate: 0.02,
      outputRate: 1.2
    })
    const result = reconcileLegacyPricing(registry, [same])
    expect(result.registry.models[3].offers[0].pricingHistory).toHaveLength(1)
    expect(result.records[0].status).toBe('equivalent')
    const conflict = reconcileLegacyPricing(registry, [{ ...same, inputRate: 999 }])
    expect(conflict.records[0].status).toBe('conflict')
    expect(conflict.registry).toEqual(registry)
  })
  it('does not choose by input order when legacy aliases disagree on one offer/date', () => {
    const prices = [legacy(), legacy({ id: 'alias', model: 'gpt-5.6-luna', inputRate: 999 })]
    for (const ordered of [prices, [...prices].reverse()]) {
      const result = reconcileLegacyPricing(registryFixture(), ordered)
      expect(result.records.map((r) => r.status)).toEqual(['conflict', 'conflict'])
      expect(result.registry.models[3].offers[0].pricingHistory).toHaveLength(1)
    }
  })
  it('produces identical history for equivalent aliases regardless of row order', () => {
    const prices = [
      legacy({ source: 'First evidence' }),
      legacy({ id: 'alias', model: 'gpt-5.6-luna', source: 'Second evidence' })
    ]
    const first = reconcileLegacyPricing(registryFixture(), prices)
    const second = reconcileLegacyPricing(registryFixture(), [...prices].reverse())
    expect(first.registry).toEqual(second.registry)
    expect(first.registry.models[3].offers[0].pricingHistory[0].source).toContain('Second evidence')
  })
  it('retains exact legacy fallback for an unregistered provider/model pair', () => {
    const data = fixture()
    data.runs = []
    const installed = install(data)
    const imported = mergeImport(
      installed,
      JSON.stringify({
        schemaVersion: 1,
        runs: [{ ...fixture().runs[0], priceSnapshot: undefined }]
      })
    ).data
    expect(imported.runs[0].priceSnapshot?.source).toBe('Catalog')
    expect(runCost(imported.runs[0])).toBeCloseTo(0.42)
  })
})
