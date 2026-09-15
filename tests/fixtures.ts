// Deliberately synthetic, test-only telemetry. The application never loads fixtures.
import { emptyDataset, type Dataset, type Run } from '../src/shared/types'
import { snapshotRun } from '../src/shared/data'
import evidence from './execution-evidence-fixture.json'
import { validateExecutionEvidence, type ExecutionEvidence } from '../src/shared/execution-evidence'

export function evidenceFixture(): ExecutionEvidence {
  validateExecutionEvidence(evidence)
  return structuredClone(evidence)
}

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

export function comparisonFixture(): Dataset {
  const data = fixture()
  data.slices = [
    {
      ...data.slices[0],
      id: 'mixed',
      title: 'Mixed-model accepted slice',
      qualityGrade: 5,
      project: 'QA'
    },
    {
      ...data.slices[0],
      id: 'luna-only',
      title: 'Luna-only accepted slice',
      qualityGrade: 3,
      project: 'QA'
    },
    {
      ...data.slices[0],
      id: 'cross-role',
      title: 'Different runs match different filters',
      project: 'QA'
    },
    { ...data.slices[0], id: 'empty', title: 'Accepted with missing run telemetry', project: 'QA' }
  ]
  const priced = (overrides: Partial<Run>): Run =>
    snapshotRun(
      runFixture({
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        inputRate: 1,
        cachedRate: 0.1,
        outputRate: 2,
        ...overrides
      }),
      data
    )
  data.runs = [
    priced({
      id: 'astra-impl',
      sliceId: 'mixed',
      model: 'QA Astra',
      role: 'Implementer',
      usageBefore: 94,
      usageAfter: 92
    }),
    priced({
      id: 'luna-critic',
      sliceId: 'mixed',
      model: 'QA Luna',
      role: 'Critic',
      inputTokens: 2_000_000
    }),
    priced({
      id: 'luna-repair',
      sliceId: 'mixed',
      model: 'QA Luna',
      role: 'Repair',
      inputTokens: 3_000_000
    }),
    priced({
      id: 'after-acceptance',
      sliceId: 'mixed',
      model: 'QA Luna',
      role: 'Critic',
      inputTokens: 50_000_000,
      startAt: '2026-09-12T10:00:00-05:00',
      endAt: '2026-09-12T10:30:00-05:00'
    }),
    priced({
      id: 'luna-only-run',
      sliceId: 'luna-only',
      model: 'QA Luna',
      role: 'Implementer',
      inputTokens: 7_000_000
    }),
    priced({ id: 'cross-astra', sliceId: 'cross-role', model: 'QA Astra', role: 'Critic' }),
    priced({ id: 'cross-luna', sliceId: 'cross-role', model: 'QA Luna', role: 'Implementer' })
  ]
  data.findings = [
    {
      id: 'product',
      sliceId: 'mixed',
      runId: 'luna-critic',
      severity: 'P1',
      category: 'Product',
      title: 'Product issue',
      description: 'Synthetic finding',
      contractInvariant: 'State must persist',
      impact: 'User edit lost',
      confidence: 'High: reproduced',
      notes: 'Independent review',
      evidence: 'Test evidence',
      status: 'Repaired'
    },
    {
      id: 'harness',
      sliceId: 'mixed',
      runId: 'luna-critic',
      severity: 'P1',
      category: 'Harness',
      description: 'Synthetic harness finding'
    },
    {
      id: 'observation',
      sliceId: 'mixed',
      runId: 'luna-critic',
      severity: 'Observation',
      category: 'Other',
      description: 'Synthetic observation'
    },
    {
      id: 'dismissed',
      sliceId: 'mixed',
      runId: 'luna-critic',
      severity: 'P0',
      category: 'UX',
      description: 'Synthetic dismissed finding',
      status: 'Dismissed'
    }
  ]
  data.discoveries = [
    {
      id: 'discovery',
      sliceId: 'mixed',
      runId: 'astra-impl',
      description: 'Synthetic independently confirmed insight',
      inPrompt: false,
      selfInitiated: true,
      validation: 'Yes',
      adopted: 'Deferred'
    }
  ]
  return data
}
