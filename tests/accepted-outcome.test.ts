import { describe, expect, it } from 'vitest'
import raw from './accepted-outcome-fixture.json'
import {
  acceptedEconomics,
  compareData,
  comparisonExport,
  type ComparisonContext
} from '../src/shared/comparison'
import { modelConfiguration } from '../src/shared/configuration'
import { mergeImport, validateDataset } from '../src/shared/data'
import { emptyDataset, type Dataset } from '../src/shared/types'

function fixture(): Dataset {
  const data: unknown = structuredClone(raw)
  validateDataset(data)
  return data
}
const context: ComparisonContext = { filters: {}, groupBy: 'modelConfiguration', sort: 'label' }
const outcome = (data: Dataset, id = 'mixed'): ReturnType<typeof acceptedEconomics> =>
  acceptedEconomics(
    data,
    data.slices.find((s) => s.id === id)!
  )

describe('accepted outcome economics', () => {
  it('retains all six lifecycle stages across models under configuration and implementation scope', () => {
    const data = fixture()
    const key = modelConfiguration(data, data.runs[1]).key
    const view = compareData(data, {
      ...context,
      filters: { modelConfiguration: key },
      stageScopes: [{ kind: 'role', value: 'Implementer' }],
      selectedCandidates: [key]
    })
    const mixed = view.accepted.find((a) => a.slice.id === 'mixed')!
    expect(mixed.lifecycle.map((r) => r.id)).toEqual([
      'support',
      'astra-implementation',
      'luna-critic',
      'luna-repair',
      'luna-recritic',
      'verification'
    ])
    expect(mixed.metrics.costUSD.completeTotal).toBeCloseTo(2.524834, 10)
    expect(mixed.metrics.wallMinutes.completeTotal).toBe(72)
    expect(mixed.elapsedMinutes).toBe(90)
    expect(mixed.outcome.stages.map((s) => [s.role, s.runType])).toEqual([
      ['Context Steward', 'Context map'],
      ['Implementer', 'Implementation'],
      ['Critic', 'Independent critic'],
      ['Repair', 'Repair'],
      ['Critic', 'Re-critic'],
      ['Orchestrator', 'Verification']
    ])
    expect(mixed.outcome.stages.flatMap((s) => s.runIds)).toEqual(mixed.lifecycle.map((r) => r.id))
    expect(mixed.outcome.firstPassAcceptance.state).toBe('No')
    expect(mixed.outcome.repair.recordedRunCount).toBe(1)
    expect(mixed.outcome.repair.costUSD.completeTotal).toBe(0.052)
    expect(mixed.outcome.repair.toImplementationCostRatio).toBeCloseTo(0.052 / 2.418034)
    expect(mixed.metrics.evidence.runtimeTested).toMatchObject({
      recorded: 6,
      total: 6,
      counts: [
        { value: false, count: 5 },
        { value: true, count: 1 }
      ]
    })
    expect(view.accepted.some((a) => a.slice.id === 'empty')).toBe(false)
  })
  it('uses frozen snapshots and totals fresh, cached, output and reasoning without charging reasoning again', () => {
    const data = fixture()
    const before = outcome(data)
    expect(before.metrics.evidence.numeric.inputTokens.completeTotal).toBe(184187)
    expect(before.metrics.evidence.numeric.cachedInputTokens.completeTotal).toBe(3302400)
    expect(before.metrics.evidence.numeric.outputTokens.completeTotal).toBe(74246)
    expect(before.metrics.evidence.numeric.reasoningTokens.completeTotal).toBe(13005)
    expect(before.outcome.reasoningShare.ratio).toBeCloseTo(13005 / 74246)
    data.pricing.push({
      id: 'new-price',
      model: 'GPT-6 Astra',
      provider: 'OpenAI',
      effectiveDate: '2026-09-01',
      inputRate: 900,
      cachedRate: 900,
      outputRate: 900
    })
    data.runs[1].reasoningTokens = 60000
    expect(outcome(data).metrics.costUSD).toEqual(before.metrics.costUSD)
    expect(outcome(data).outcome.reasoningShare.ratio).not.toBe(before.outcome.reasoningShare.ratio)
  })
  it('distinguishes direct first-pass acceptance, incomplete evidence, empty evidence and known zero', () => {
    const data = fixture()
    const first = outcome(data, 'one-shot')
    expect(first.outcome.firstPassAcceptance).toMatchObject({
      state: 'Yes',
      runIds: ['one-shot-run']
    })
    expect(first.outcome.repair.costUSD.completeTotal).toBe(0)
    expect(first.outcome.repair.toImplementationCostRatio).toBe(0)
    const incomplete = outcome(data, 'incomplete')
    expect(incomplete.outcome.firstPassAcceptance.state).toBe('Unknown')
    expect(incomplete.outcome.repair.costUSD.knownTotal).toBeNull()
    expect(incomplete.outcome.repair.toImplementationCostRatio).toBeNull()
    expect(incomplete.metrics.costUSD.knownTotal).toBeNull()
    expect(incomplete.metrics.wallMinutes.knownTotal).toBeNull()
    expect(incomplete.outcome.acceptanceWindow).toEqual({
      bounded: false,
      undatedRunIds: ['incomplete-run'],
      completeTiming: false
    })
    const empty = outcome(data, 'empty')
    expect(empty.outcome.firstPassAcceptance.state).toBe('Unknown')
    expect(empty.metrics.costUSD.complete).toBe(false)
    expect(empty.metrics.costUSD.knownTotal).toBeNull()
    const zero = outcome(data, 'zero')
    expect(zero.metrics.costUSD.completeTotal).toBe(0)
    expect(zero.metrics.wallMinutes.completeTotal).toBe(0)
    expect(zero.outcome.reasoningShare).toEqual({
      ratio: null,
      knownRuns: 1,
      totalRuns: 1,
      complete: true
    })
    expect(zero.outcome.repair.toImplementationCostRatio).toBeNull()
  })
  it.each(['result', 'startAt', 'endAt'] as const)(
    'does not claim first-pass success when %s is missing',
    (field) => {
      const data = fixture()
      delete data.runs.find((r) => r.id === 'one-shot-run')![field]
      expect(outcome(data, 'one-shot').outcome.firstPassAcceptance.state).toBe('Unknown')
    }
  )
  it('does not equate Completed plus acceptance of a later review with explicit acceptance of the first implementation', () => {
    const data = fixture()
    const first = data.runs.find((r) => r.id === 'one-shot-run')!
    first.result = 'Completed'
    data.runs.push({
      ...first,
      id: 'accepting-review',
      role: 'Critic',
      result: 'Accepted',
      runType: 'Review'
    })
    expect(outcome(data, 'one-shot').outcome.firstPassAcceptance.state).toBe('Unknown')
  })
  it('keeps multiple implementations and conflicting results or findings uncertain without repair proof', () => {
    const data = fixture()
    const first = data.runs.find((r) => r.id === 'one-shot-run')!
    data.runs.push({ ...first, id: 'retry' })
    expect(outcome(data, 'one-shot').outcome.firstPassAcceptance.state).toBe('Unknown')
    data.runs.pop()
    first.result = 'Blocked'
    expect(outcome(data, 'one-shot').outcome.firstPassAcceptance.state).toBe('Unknown')
    first.result = 'Accepted'
    data.findings.push({
      id: 'uncertain',
      sliceId: 'one-shot',
      severity: 'P1',
      category: 'Product',
      description: 'No repair disposition'
    })
    expect(outcome(data, 'one-shot').outcome.firstPassAcceptance.state).toBe('Unknown')
  })
  it('uses explicit repair requirements even when repair telemetry is absent', () => {
    const data = fixture()
    data.runs = data.runs.filter((r) => r.id !== 'luna-repair')
    delete data.findings[0].repairRunId
    validateDataset(data)
    const result = outcome(data)
    expect(result.outcome.firstPassAcceptance.state).toBe('No')
    expect(result.outcome.repair.recordedRunCount).toBe(0)
    expect(result.outcome.repair.requiredRunIds).toEqual(['luna-critic'])
    expect(result.outcome.repair.costUSD.completeTotal).toBeNull()
    expect(result.outcome.repair.toImplementationCostRatio).toBeNull()
  })
  it('counts explicit same-slice repair links once even under a different structured role', () => {
    const data = fixture()
    data.runs.find((r) => r.id === 'luna-repair')!.role = 'Implementer'
    data.findings.push({ ...data.findings[0], id: 'duplicate-link' })
    validateDataset(data)
    expect(outcome(data).outcome.repair).toMatchObject({
      recordedRunCount: 1,
      runIds: ['luna-repair'],
      toImplementationCostRatio: 0.052 / 2.418034
    })
    expect(outcome(data).outcome.stages.find((s) => s.runType === 'Repair')!.role).toBe(
      'Implementer'
    )
    // Later dismissal does not erase explicitly linked repair work already performed.
    data.findings.forEach((finding) => {
      finding.status = 'Dismissed'
    })
    expect(outcome(data).outcome.repair.recordedRunCount).toBe(1)
  })
  it('preserves partial pricing, paired reasoning coverage, undated work and explicit elapsed measurement', () => {
    const data = fixture()
    const repair = data.runs.find((r) => r.id === 'luna-repair')!
    delete repair.priceSnapshot
    delete repair.startAt
    delete repair.endAt
    delete repair.reasoningTokens
    delete repair.runtimeTested
    data.slices[0].timeToAcceptedMinutes = 0
    const result = outcome(data)
    expect(result.metrics.costUSD).toMatchObject({
      completeTotal: null,
      recorded: 5,
      total: 6,
      complete: false
    })
    expect(result.metrics.wallMinutes.recorded).toBe(5)
    expect(result.elapsedMinutes).toBe(0)
    expect(result.outcome.acceptanceWindow.undatedRunIds).toEqual(['luna-repair'])
    expect(result.outcome.reasoningShare).toMatchObject({
      ratio: 12505 / 71246,
      knownRuns: 5,
      totalRuns: 6,
      complete: false
    })
    expect(result.metrics.evidence.runtimeTested).toMatchObject({
      recorded: 5,
      total: 6,
      complete: false
    })
    expect(result.outcome.repair.toImplementationCostRatio).toBeNull()
  })
  it('does not let later repairs or findings rewrite an earlier first-pass acceptance', () => {
    const data = fixture()
    const later = {
      ...data.runs.find((r) => r.id === 'later')!,
      id: 'later-first',
      sliceId: 'one-shot'
    }
    data.runs.push(later)
    data.findings.push({
      ...data.findings[0],
      id: 'later-finding',
      sliceId: 'one-shot',
      runId: later.id,
      repairRunId: later.id
    })
    validateDataset(data)
    const first = outcome(data, 'one-shot')
    expect(first.outcome.firstPassAcceptance.state).toBe('Yes')
    expect(first.findings).toHaveLength(1)
    expect(first.lifecycle.map((r) => r.id)).toEqual(['one-shot-run'])
  })
  it('exports shared outcome evidence without changing raw telemetry or the import boundary', () => {
    const data = fixture()
    const bytes = JSON.stringify(data)
    const exported = comparisonExport(
      data,
      { revision: data.revision, context },
      '0.1.3',
      '2026-09-13T00:00:00Z'
    )
    expect(exported.acceptedSlices).toHaveLength(5)
    expect(exported.acceptedSlices[0].outcome).toEqual(outcome(data).outcome)
    expect(exported.acceptedSlices[0].costUSD).toEqual(outcome(data).metrics.costUSD)
    expect(exported.acceptedSlices.every((s) => s.outcome.sampleCount === 1)).toBe(true)
    expect(JSON.stringify(data)).toBe(bytes)
    expect(mergeImport(emptyDataset(), bytes).data.runs).toEqual(data.runs)
    expect(() => mergeImport(emptyDataset(), JSON.stringify(exported))).toThrow(
      'not importable telemetry'
    )
  })
})
