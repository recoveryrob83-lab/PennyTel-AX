import seed from '../docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json'
import { parseRegistry, type ModelRegistry } from '../src/shared/registry'
import { emptyDataset, type Dataset, type Run } from '../src/shared/types'

export const registryFixture = (): ModelRegistry => parseRegistry(JSON.stringify(seed))
export const recoveredRun = (overrides: Partial<Run> = {}): Run => ({
  id: 'luna',
  sliceId: 'recovered',
  runType: 'Implementation',
  role: 'Implementer',
  model: 'GPT-5.6 Luna',
  provider: 'OpenAI',
  inputTokens: 138187,
  cachedInputTokens: 2902400,
  outputTokens: 69046,
  reasoningTokens: 11505,
  ...overrides
})
export const recoveredData = (): Dataset => ({
  ...emptyDataset(),
  slices: [{ id: 'recovered', title: 'Recovered experiment', startDate: '2026-09-11' }],
  runs: [recoveredRun()]
})
