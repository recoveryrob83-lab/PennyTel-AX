// Deliberately synthetic, test-only telemetry. The application never loads fixtures.
import { emptyDataset, type Dataset, type Run } from '../src/shared/types'
import { snapshotRun } from '../src/shared/data'

export const runFixture = (overrides: Partial<Run> = {}): Run => ({
  id: 'run-test',
  sliceId: 'slice-test',
  runType: 'Implementation',
  role: 'Implementer',
  model: 'Test Model',
  provider: 'Test Provider',
  thinking: 'High',
  startAt: '2026-09-11T10:00:00-05:00',
  endAt: '2026-09-11T10:30:00-05:00',
  inputTokens: 100_000,
  cachedInputTokens: 40_000,
  outputTokens: 20_000,
  reasoningTokens: 10_000,
  ...overrides
})
export function fixture(): Dataset {
  const data = emptyDataset()
  data.slices = [
    {
      id: 'slice-test',
      title: 'Synthetic QA slice',
      productionModel: 'Solo',
      ambiguity: 'High',
      disposition: 'Accepted',
      acceptedAt: '2026-09-11T11:00:00-05:00'
    }
  ]
  data.pricing = [
    {
      id: 'price-test',
      model: 'Test Model',
      provider: 'Test Provider',
      effectiveDate: '2026-01-01',
      inputRate: 2,
      cachedRate: 0.5,
      outputRate: 10
    }
  ]
  data.runs = [snapshotRun(runFixture(), data)]
  return data
}
