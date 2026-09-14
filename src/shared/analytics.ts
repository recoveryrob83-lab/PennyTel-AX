import type { Run } from './types'
import { measured, runCost, runMinutes, type MeasuredTotal } from './metrics'

/** Descriptive statistics over known samples, never an estimate for missing evidence. */
export function distribution(samples: (number | null)[]): {
  sampleCount: number
  knownCount: number
  unknownCount: number
  mean: number | null
  median: number | null
  min: number | null
  max: number | null
  sampleStandardDeviation: number | null
} {
  const values = samples.filter((v): v is number => v !== null).sort((a, b) => a - b)
  const n = values.length
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : null
  return {
    sampleCount: samples.length,
    knownCount: n,
    unknownCount: samples.length - n,
    mean,
    median: n ? (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2 : null,
    min: values[0] ?? null,
    max: values[n - 1] ?? null,
    sampleStandardDeviation:
      n > 1 ? Math.sqrt(values.reduce((sum, v) => sum + (v - mean!) ** 2, 0) / (n - 1)) : null
  }
}
export type Distribution = ReturnType<typeof distribution>

export function reasoningShare(runs: Run[]): {
  ratio: number | null
  knownRuns: number
  totalRuns: number
  complete: boolean
} {
  const pairs = runs.filter(
    (run) => run.reasoningTokens !== undefined && run.outputTokens !== undefined
  )
  const output = pairs.reduce((sum, run) => sum + run.outputTokens!, 0)
  return {
    ratio: output > 0 ? pairs.reduce((sum, run) => sum + run.reasoningTokens!, 0) / output : null,
    knownRuns: pairs.length,
    totalRuns: runs.length,
    complete: runs.length > 0 && pairs.length === runs.length
  }
}

export interface RunAnalytics {
  sampleCount: number
  runIds: string[]
  costUSD: Distribution
  wallMinutes: Distribution
  costComposition: {
    freshInputUSD: MeasuredTotal
    cachedInputUSD: MeasuredTotal
    outputUSD: MeasuredTotal
  }
  reasoningShare: ReturnType<typeof reasoningShare>
}
export function runAnalytics(runs: Run[]): RunAnalytics {
  const priced = runs.filter((run) => runCost(run) !== null)
  // Use the same fully priced subset for every component, so the stack reconciles to runCost.
  const component = (
    tokens: 'inputTokens' | 'cachedInputTokens' | 'outputTokens',
    rate: 'inputRate' | 'cachedRate' | 'outputRate'
  ): MeasuredTotal =>
    measured(
      priced.reduce((sum, run) => sum + (run[tokens]! * run.priceSnapshot![rate]) / 1_000_000, 0),
      priced.length,
      runs.length
    )
  return {
    sampleCount: runs.length,
    runIds: runs.map((run) => run.id),
    costUSD: distribution(runs.map(runCost)),
    wallMinutes: distribution(runs.map(runMinutes)),
    costComposition: {
      freshInputUSD: component('inputTokens', 'inputRate'),
      cachedInputUSD: component('cachedInputTokens', 'cachedRate'),
      outputUSD: component('outputTokens', 'outputRate')
    },
    reasoningShare: reasoningShare(runs)
  }
}
export interface TemporalAnalytics {
  basis: 'Recorded run start, UTC calendar day'
  undatedRunIds: string[]
  days: (RunAnalytics & { date: string })[]
  timeCost: {
    runId: string
    sliceId: string
    startAt: string | null
    costUSD: number | null
    wallMinutes: number | null
  }[]
}
export function temporalAnalytics(runs: Run[]): TemporalAnalytics {
  const days = new Map<string, Run[]>()
  for (const run of runs) {
    if (!run.startAt) continue
    const day = new Date(run.startAt).toISOString().slice(0, 10)
    days.set(day, [...(days.get(day) ?? []), run])
  }
  return {
    basis: 'Recorded run start, UTC calendar day' as const,
    undatedRunIds: runs.filter((run) => !run.startAt).map((run) => run.id),
    days: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayRuns]) => ({
        date,
        ...runAnalytics(dayRuns)
      })),
    timeCost: runs.map((run) => ({
      runId: run.id,
      sliceId: run.sliceId,
      startAt: run.startAt ?? null,
      costUSD: runCost(run),
      wallMinutes: runMinutes(run)
    }))
  }
}
