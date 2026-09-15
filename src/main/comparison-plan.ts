import type { Dataset } from '../shared/types'
import {
  executeComparisonPlan,
  parseComparisonPlan,
  type ComparisonPlanResults
} from '../shared/comparison-plan'

export interface ComparisonPlanOperation {
  choosePlan: () => Promise<string | null>
  loadDataset: () => Promise<Dataset>
  saveResults: (results: ComparisonPlanResults, defaultPath: string) => Promise<string | null>
}

export async function runComparisonPlanOperation(
  operation: ComparisonPlanOperation,
  appVersion: string,
  generatedAt = new Date().toISOString()
): Promise<string | null> {
  const text = await operation.choosePlan()
  if (text === null) return null
  // Parsing and whole-plan validation deliberately precede dataset access and the save dialog.
  const plan = parseComparisonPlan(text)
  const data = await operation.loadDataset()
  const results = executeComparisonPlan(data, plan, appVersion, generatedAt)
  return operation.saveResults(
    results,
    `pennytel-comparison-results-${generatedAt.slice(0, 10)}.json`
  )
}
