import { describe, expect, it } from 'vitest'
import {
  acceptanceRuns,
  applicablePrice,
  costIssues,
  groupRuns,
  runCost,
  runMinutes,
  summarize,
  timeToAccepted,
  usageBurn,
  validatedDiscovery,
  roleSummary,
  cacheRatio,
  runEvidence
} from '../src/shared/metrics'
import { snapshotRun } from '../src/shared/data'
import { fixture, runFixture } from './fixtures'
import type { Discovery } from '../src/shared/types'

describe('deterministic telemetry calculations', () => {
  it('aggregates only recorded numeric and categorical run evidence with independent coverage', () => {
    const evidence = runEvidence([
      runFixture({
        filesChanged: 0,
        testsAdded: 2,
        testsPassed: 8,
        testsFailed: 0,
        testsSkipped: 1,
        buildResult: 'Not run',
        runtimeTested: false,
        result: 'Needs repair'
      }),
      runFixture({
        inputTokens: undefined,
        cachedInputTokens: 0,
        outputTokens: undefined,
        reasoningTokens: undefined,
        filesChanged: 3,
        testsPassed: 4,
        buildResult: 'Passed',
        runtimeTested: true,
        result: 'Completed'
      })
    ])
    expect(evidence.numeric.inputTokens).toEqual({
      knownTotal: 100_000,
      completeTotal: null,
      recorded: 1,
      total: 2,
      complete: false
    })
    expect(evidence.numeric.cachedInputTokens.completeTotal).toBe(40_000)
    expect(evidence.numeric.outputTokens.knownTotal).toBe(20_000)
    expect(evidence.numeric.reasoningTokens).toMatchObject({ knownTotal: 10_000, recorded: 1 })
    expect(evidence.numeric.filesChanged.completeTotal).toBe(3)
    expect(evidence.numeric.testsAdded).toMatchObject({
      knownTotal: 2,
      recorded: 1,
      complete: false
    })
    expect(evidence.numeric.testsPassed.completeTotal).toBe(12)
    expect(evidence.numeric.testsFailed.knownTotal).toBe(0)
    expect(evidence.numeric.testsSkipped.knownTotal).toBe(1)
    expect(evidence.runtimeTested.counts).toEqual([
      { value: false, count: 1 },
      { value: true, count: 1 }
    ])
    expect(evidence.buildResult.counts).toEqual([
      { value: 'Not run', count: 1 },
      { value: 'Passed', count: 1 }
    ])
    expect(evidence.result).toMatchObject({ recorded: 2, complete: true })
    for (const rows of [[], [runFixture()]]) {
      const unknown = runEvidence(rows)
      expect(unknown.numeric.filesChanged.knownTotal).toBeNull()
      expect(unknown.numeric.filesChanged.complete).toBe(false)
      expect(unknown.runtimeTested.recorded).toBe(0)
      expect(unknown.runtimeTested.counts).toEqual([])
    }
  })
  it('does not present unpriced role work as zero burden', () => {
    expect(roleSummary([runFixture({ role: 'Critic' })], 'Critic')).toEqual({
      cost: null,
      priced: 0,
      total: 1
    })
    expect(roleSummary([], 'Repair')).toEqual({ cost: 0, priced: 0, total: 0 })
  })
  it('charges cached input separately and never double bills reasoning', () => {
    expect(runCost(fixture().runs[0])).toBeCloseTo(0.42, 10)
    expect(runCost({ ...fixture().runs[0], reasoningTokens: 0 })).toBeCloseTo(0.42, 10)
  })
  it('distinguishes missing tokens and missing rates from explicit zero', () => {
    const run = fixture().runs[0]
    expect(runCost({ ...run, cachedInputTokens: undefined })).toBeNull()
    expect(runCost({ ...run, priceSnapshot: undefined })).toBeNull()
    expect(costIssues(run)).toEqual([])
    expect(runCost({ ...run, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 })).toBe(0)
  })
  it('selects historical prices by exact model/provider and UTC effective date', () => {
    const data = fixture()
    data.pricing.push({
      ...data.pricing[0],
      id: 'future',
      effectiveDate: '2026-09-12',
      inputRate: 4
    })
    expect(applicablePrice(runFixture(), data.pricing)?.id).toBe('price-test')
    expect(
      applicablePrice(runFixture({ startAt: '2026-09-11T23:30:00-05:00' }), data.pricing)?.id
    ).toBe('future')
    expect(applicablePrice(runFixture({ provider: 'Other' }), data.pricing)).toBeUndefined()
    expect(applicablePrice(runFixture({ startAt: undefined }), data.pricing)).toBeUndefined()
    expect(
      applicablePrice(runFixture({ startAt: '2025-01-01T00:00:00Z' }), data.pricing)
    ).toBeUndefined()
  })
  it('separates aggregate run time from elapsed time to acceptance', () => {
    const data = fixture()
    expect(runMinutes(data.runs[0])).toBe(30)
    expect(runMinutes({ ...data.runs[0], wallMinutes: 0 })).toBe(0)
    expect(timeToAccepted(data.slices[0], data.runs)).toBe(60)
    expect(timeToAccepted({ ...data.slices[0], disposition: 'Rejected' }, data.runs)).toBeNull()
    expect(timeToAccepted({ ...data.slices[0], timeToAcceptedMinutes: 0 }, data.runs)).toBe(0)
  })
  it('bounds acceptance costs but retains undated work', () => {
    const data = fixture()
    const runs = [
      ...data.runs,
      runFixture({ id: 'after', startAt: '2026-09-12T00:00:00Z' }),
      runFixture({ id: 'undated', startAt: undefined })
    ]
    expect(acceptanceRuns(data.slices[0], runs).map((r) => r.id)).toEqual(['run-test', 'undated'])
  })
  it('reports partial aggregates, weighted cache ratio, and role burdens', () => {
    const data = fixture()
    const repair = snapshotRun(
      runFixture({ id: 'repair', role: 'Repair', inputTokens: 900_000, cachedInputTokens: 0 }),
      data
    )
    const stats = summarize([
      ...data.runs,
      repair,
      runFixture({
        id: 'unknown',
        priceSnapshot: undefined,
        inputTokens: undefined,
        cachedInputTokens: undefined
      })
    ])
    expect(stats.priced).toBe(2)
    expect(stats.total).toBe(3)
    expect(stats.cost).toBeCloseTo(2.42)
    expect(stats.repairCost).toBe(2)
    expect(stats.cacheRatio).toBeCloseTo(40_000 / 1_040_000)
    expect(stats.repairRuns).toBe(1)
  })
  it('treats meter resets as unknown unless explicit burn is supplied', () => {
    expect(usageBurn(runFixture({ usageBefore: 94, usageAfter: 92 }))).toBe(2)
    expect(usageBurn(runFixture({ usageBefore: 0, usageAfter: 0 }))).toBe(0)
    expect(usageBurn(runFixture({ usageBefore: 5, usageAfter: 80 }))).toBeNull()
    expect(usageBurn(runFixture({ usageBefore: 94, usageAfter: 92, usageReset: true }))).toBeNull()
    expect(
      usageBurn(runFixture({ usageBefore: 94, usageAfter: 92, usageReset: true, usageBurn: 3 }))
    ).toBe(3)
    expect(usageBurn(runFixture({ usageBefore: 94, usageAfter: undefined }))).toBeNull()
  })
  it('accepts real-shaped Codex telemetry and computes fresh plus cached costs', () => {
    const run = snapshotRun(
      runFixture({
        inputTokens: 138_187,
        cachedInputTokens: 2_902_400,
        outputTokens: 69_046,
        reasoningTokens: 11_505
      }),
      fixture()
    )
    expect(runCost(run)).toBeCloseTo(2.418034, 10)
    expect(cacheRatio(run)).toBeCloseTo(2_902_400 / 3_040_587, 10)
    expect(cacheRatio({ ...run, inputTokens: 0 })).toBe(1)
    expect(cacheRatio({ ...run, inputTokens: 0, cachedInputTokens: 0 })).toBeNull()
    expect(cacheRatio({ ...run, inputTokens: undefined })).toBeNull()
  })
  it('requires all three predicates for validated autonomous credit', () => {
    const discovery: Discovery = {
      id: 'd',
      sliceId: 'slice-test',
      description: 'Test',
      selfInitiated: true,
      inPrompt: false,
      validation: 'Yes'
    }
    expect(validatedDiscovery(discovery)).toBe(true)
    expect(validatedDiscovery({ ...discovery, inPrompt: undefined })).toBe(false)
    expect(validatedDiscovery({ ...discovery, inPrompt: true })).toBe(false)
    expect(validatedDiscovery({ ...discovery, validation: 'Pending' })).toBe(false)
    expect(validatedDiscovery({ ...discovery, selfInitiated: false })).toBe(false)
  })
  it('does not merge candidates from separate slices and retains midnight as hour zero', () => {
    const data = fixture()
    data.slices.push({ id: 'second', title: 'Second' })
    const runs = [
      runFixture({ candidate: 'A', localHour: 0 }),
      runFixture({ id: 'second-run', sliceId: 'second', candidate: 'A' })
    ]
    expect(groupRuns(data, runs, 'candidate')).toHaveLength(2)
    expect(groupRuns(data, runs, 'localHour').map((g) => g.key)).toContain('0')
  })
})
