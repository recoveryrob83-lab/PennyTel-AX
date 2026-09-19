import { describe, expect, it } from 'vitest'
import { applyMutation, mergeImport, validateDataset, validateRecord } from '../src/shared/data'
import { emptyDataset, type Dataset, type Entity, type Table } from '../src/shared/types'
import { fixture, runFixture } from './fixtures'
import { runCost } from '../src/shared/metrics'

const save = (data: Dataset, table: Table, record: Entity): Dataset =>
  applyMutation(data, { kind: 'save', table, record, revision: data.revision })
describe('validated transactions and imports', () => {
  it('preserves every explicit verification state and omitted historical state independently of result', () => {
    for (const verification of ['Passed', 'Failed', 'Partial', 'Not run', 'Unknown'] as const) {
      const source = fixture()
      source.runs = [runFixture({ result: 'Needs repair', verification })]
      validateDataset(source)
      const imported = mergeImport(emptyDataset(), JSON.stringify(source)).data
      expect(imported.runs[0].verification).toBe(verification)
      expect(imported.runs[0].result).toBe('Needs repair')
    }
    const historical = fixture()
    delete historical.runs[0].verification
    expect(mergeImport(emptyDataset(), JSON.stringify(historical)).data.runs[0]).not.toHaveProperty(
      'verification'
    )
    expect(() =>
      validateRecord('runs', runFixture({ verification: 'Invalid' as 'Passed' }))
    ).toThrow('invalid Worker verification')
  })
  it.each([0, 6, 1.5, 'A', '5'])(
    'rejects a quality grade outside the numeric 1–5 contract: %j',
    (qualityGrade) => {
      expect(() => validateRecord('slices', { id: 's', title: 'QA', qualityGrade })).toThrow()
    }
  )
  it('round-trips reconciled Sheet evidence, adoption, quality, and historical pricing provenance', () => {
    const data = fixture()
    data.slices[0].qualityGrade = 4
    data.pricing[0].source = 'QA provider pricing source'
    data.runs = [
      runFixture({
        inputTokens: 138_187,
        cachedInputTokens: 2_902_400,
        outputTokens: 69_046,
        reasoningTokens: 11_505
      })
    ]
    data.findings = [
      {
        id: 'finding',
        sliceId: 'slice-test',
        title: 'QA title',
        description: 'QA description',
        severity: 'P1',
        category: 'Product',
        contractInvariant: 'Must persist',
        impact: 'Lost edits',
        confidence: 'Reproduced twice',
        notes: 'Reviewer notes',
        evidence: 'QA evidence'
      }
    ]
    data.discoveries = [
      { id: 'discovery', sliceId: 'slice-test', description: 'QA insight', adopted: 'Deferred' }
    ]
    const imported = mergeImport(emptyDataset(), JSON.stringify(data)).data
    expect(imported.findings).toEqual(data.findings)
    expect(imported.discoveries[0].adopted).toBe('Deferred')
    expect(imported.slices[0].qualityGrade).toBe(4)
    expect(imported.runs[0].priceSnapshot?.rateSource).toBe('QA provider pricing source')
    expect(runCost(imported.runs[0])).toBeCloseTo(2.418034)
    const changed = save(imported, 'pricing', {
      ...imported.pricing[0],
      source: 'New source',
      inputRate: 999
    })
    expect(changed.runs[0].priceSnapshot?.rateSource).toBe('QA provider pricing source')
    expect(mergeImport(emptyDataset(), JSON.stringify(changed)).data.runs[0].priceSnapshot).toEqual(
      changed.runs[0].priceSnapshot
    )
  })
  it('supports undated override costs without inventing an effective date', () => {
    const data = fixture()
    const saved = save(data, 'runs', {
      id: 'undated',
      sliceId: 'slice-test',
      role: 'Critic',
      runType: 'Criticism',
      inputRate: 1,
      cachedRate: 0,
      outputRate: 2,
      inputTokens: 1000,
      cachedInputTokens: 0,
      outputTokens: 1000
    })
    const run = saved.runs.find((r) => r.id === 'undated')!
    expect(runCost(run)).toBe(0.003)
    expect(run.priceSnapshot).not.toHaveProperty('effectiveDate')
    expect(() => validateDataset(saved)).not.toThrow()
  })
  it('does not mutate caller state and freezes historical pricing on edits', () => {
    const data = fixture()
    const changed = save(data, 'pricing', { ...data.pricing[0], inputRate: 999 })
    expect(data.pricing[0].inputRate).toBe(2)
    expect(runCost(changed.runs[0])).toBeCloseTo(0.42)
    const edited = save(changed, 'runs', { ...changed.runs[0], notes: 'Corrected note' })
    expect(runCost(edited.runs[0])).toBeCloseTo(0.42)
    const overridden = save(edited, 'runs', {
      ...edited.runs[0],
      inputRate: 0,
      cachedRate: 0,
      outputRate: 0
    })
    expect(runCost(overridden.runs[0])).toBe(0)
  })
  it('reselects rates on model or timestamp correction', () => {
    const data = fixture()
    expect(
      save(data, 'runs', { ...data.runs[0], model: 'Unknown' }).runs[0].priceSnapshot
    ).toBeUndefined()
    expect(
      save(data, 'runs', { ...data.runs[0], startAt: '2025-01-01T00:00:00Z' }).runs[0].priceSnapshot
    ).toBeUndefined()
  })
  it.each([
    [{ inputTokens: -1 }, 'nonnegative'],
    [{ cachedInputTokens: -1 }, 'nonnegative'],
    [{ usageBefore: 101 }, 'no greater than'],
    [{ usageAfter: 101 }, 'no greater than'],
    [{ reasoningTokens: 20_001 }, 'reasoning tokens exceed'],
    [{ testsPassed: 1.5 }, 'whole'],
    [{ outputTokens: Infinity }, 'nonnegative'],
    [{ localHour: 24 }, 'no greater than'],
    [{ startAt: '2026-02-30T00:00:00Z' }, 'ISO timestamp'],
    [{ startAt: '2026-09-11T10:00' }, 'timezone'],
    [{ endAt: '2026-01-01T00:00:00Z' }, 'precedes'],
    [{ inputRate: 1 }, 'all three'],
    [{ role: 'Admin' }, 'invalid'],
    [{ notes: null }, 'nonempty'],
    [{ surprise: 1 }, 'unknown field']
  ])('rejects invalid telemetry %j', (overrides, message) =>
    expect(() => validateRecord('runs', { ...runFixture(), ...overrides })).toThrow(String(message))
  )
  it('allows minimal records and known zeroes', () => {
    expect(() =>
      validateRecord('runs', {
        id: 'r',
        sliceId: 's',
        runType: 'Context loading',
        role: 'Context Steward',
        inputTokens: 0
      })
    ).not.toThrow()
    expect(() => validateRecord('slices', { id: 's', title: 'Small slice' })).not.toThrow()
  })
  it('rejects stale writers', () =>
    expect(() =>
      applyMutation(fixture(), { kind: 'delete', table: 'runs', id: 'run-test', revision: 99 })
    ).toThrow('changed'))
  it('preserves same-slice relationships and protects referenced deletion', () => {
    const data = fixture()
    data.slices.push({ id: 'other', title: 'Other' })
    expect(() =>
      save(data, 'findings', {
        id: 'f',
        sliceId: 'other',
        runId: 'run-test',
        severity: 'P1',
        category: 'Product',
        description: 'Test'
      })
    ).toThrow('same slice')
    const linked = save(data, 'findings', {
      id: 'f',
      sliceId: 'slice-test',
      runId: 'run-test',
      severity: 'P1',
      category: 'Harness',
      description: 'Test'
    })
    expect(() =>
      applyMutation(linked, {
        kind: 'delete',
        table: 'runs',
        id: 'run-test',
        revision: linked.revision
      })
    ).toThrow('referenced')
    expect(() =>
      applyMutation(data, { kind: 'delete', table: 'slices', id: 'slice-test', revision: 0 })
    ).toThrow('related records')
  })
  it('retains snapshots after deleting catalog entries', () => {
    const data = applyMutation(fixture(), {
      kind: 'delete',
      table: 'pricing',
      id: 'price-test',
      revision: 0
    })
    expect(data.pricing).toHaveLength(0)
    expect(runCost(data.runs[0])).toBeCloseTo(0.42)
  })
  it('rejects duplicate effective prices and malformed snapshots', () => {
    const data = fixture()
    expect(() => save(data, 'pricing', { ...data.pricing[0], id: 'duplicate' })).toThrow(
      'only one price'
    )
    data.runs[0].priceSnapshot!.model = 'Wrong'
    expect(() => validateDataset(data)).toThrow('snapshot')
  })
  it('imports related batches atomically, skips identical exports, and rejects conflicts', () => {
    const first = mergeImport(emptyDataset(), JSON.stringify(fixture()))
    expect(first.preview.counts).toEqual({
      slices: 1,
      runs: 1,
      pricing: 1,
      findings: 0,
      discoveries: 0
    })
    expect(mergeImport(first.data, JSON.stringify(first.data)).preview.skipped).toBe(3)
    expect(() =>
      mergeImport(
        first.data,
        JSON.stringify({ schemaVersion: 1, slices: [{ id: 'slice-test', title: 'Conflict' }] })
      )
    ).toThrow('conflicts')
    expect(first.data.slices[0].title).toBe('Synthetic QA slice')
  })
  it('can append children referencing existing slices and freezes imported prices', () => {
    const data = fixture()
    const merged = mergeImport(
      data,
      JSON.stringify({ schemaVersion: 1, runs: [runFixture({ id: 'new-run' })] })
    )
    expect(merged.data.runs[1].priceSnapshot?.inputRate).toBe(2)
  })
  it('rejects missing parents, duplicate incoming IDs, invalid JSON, and oversized input', () => {
    expect(() =>
      mergeImport(emptyDataset(), JSON.stringify({ schemaVersion: 1, runs: [runFixture()] }))
    ).toThrow('does not exist')
    expect(() =>
      mergeImport(
        emptyDataset(),
        JSON.stringify({
          schemaVersion: 1,
          slices: [
            { id: 's', title: 'One' },
            { id: 's', title: 'One' }
          ]
        })
      )
    ).toThrow('duplicate')
    expect(() => mergeImport(emptyDataset(), 'oops')).toThrow('Invalid JSON')
    expect(() => mergeImport(emptyDataset(), ' '.repeat(10_000_001))).toThrow('10 MB')
  })
})
