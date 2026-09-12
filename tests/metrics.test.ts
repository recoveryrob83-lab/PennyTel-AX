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
  roleSummary
} from '../src/shared/metrics'
import { snapshotRun } from '../src/shared/data'
import { fixture, runFixture } from './fixtures'
import type { Discovery } from '../src/shared/types'

describe('deterministic telemetry calculations', () => {
  it('does not present unpriced role work as zero burden', () => {
    expect(roleSummary([runFixture({ role: 'Critic' })], 'Critic')).toEqual({
      cost: null,
      priced: 0,
      total: 1
    })
    expect(roleSummary([], 'Repair')).toEqual({ cost: 0, priced: 0, total: 0 })
  })
  it('charges cached input separately and never double bills reasoning', () => {
    expect(runCost(fixture().runs[0])).toBeCloseTo(0.34, 10)
    expect(runCost({ ...fixture().runs[0], reasoningTokens: 0 })).toBeCloseTo(0.34, 10)
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
    expect(stats.cost).toBeCloseTo(2.34)
    expect(stats.repairCost).toBe(2)
    expect(stats.cacheRatio).toBe(0.04)
    expect(stats.repairRuns).toBe(1)
  })
  it('treats meter resets as unknown unless explicit burn is supplied', () => {
    expect(usageBurn(runFixture({ usageBefore: 10, usageAfter: 14 }))).toBe(4)
    expect(usageBurn(runFixture({ usageBefore: 80, usageAfter: 5 }))).toBeNull()
    expect(usageBurn(runFixture({ usageBefore: 80, usageAfter: 5, usageBurn: 3 }))).toBe(3)
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
