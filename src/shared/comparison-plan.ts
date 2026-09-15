import {
  comparisonExport,
  validateComparisonRequest,
  type ComparisonAnalysis,
  type ComparisonContext
} from './comparison'
import type { Dataset } from './types'

export const MAX_COMPARISON_PLAN_ENTRIES = 50
export const MAX_COMPARISON_PLAN_ID_LENGTH = 80
export const MAX_COMPARISON_PLAN_NAME_LENGTH = 200

export interface ComparisonPlanEntry {
  id: string
  name: string
  context: ComparisonContext
}

export interface ComparisonPlan {
  kind: 'pennytel-comparison-plan'
  planVersion: 1
  name: string
  comparisons: ComparisonPlanEntry[]
}

export interface ComparisonPlanResults {
  kind: 'pennytel-comparison-plan-results'
  resultsFormatVersion: 1
  app: { name: 'PennyTel'; version: string }
  source: { datasetSchemaVersion: number; datasetRevision: number }
  generatedAt: string
  plan: Pick<ComparisonPlan, 'kind' | 'planVersion' | 'name'>
  results: { id: string; name: string; analysis: ComparisonAnalysis }[]
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boundedName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_COMPARISON_PLAN_NAME_LENGTH
  )
}

export function validateComparisonPlan(value: unknown): asserts value is ComparisonPlan {
  if (!object(value)) throw new Error('Comparison plan must be a JSON object.')
  const fields = Object.keys(value)
  const unknown = fields.find(
    (key) => !['kind', 'planVersion', 'name', 'comparisons'].includes(key)
  )
  if (unknown) throw new Error(`Comparison plan has unknown field “${unknown}”.`)
  if (value.kind !== 'pennytel-comparison-plan')
    throw new Error('Comparison plan kind must be “pennytel-comparison-plan”.')
  if (value.planVersion !== 1) throw new Error('Comparison plan planVersion must be 1.')
  if (!boundedName(value.name))
    throw new Error(
      `Comparison plan name must be nonempty text no longer than ${MAX_COMPARISON_PLAN_NAME_LENGTH} characters.`
    )
  if (!Array.isArray(value.comparisons) || value.comparisons.length === 0)
    throw new Error('Comparison plan must contain at least one comparison.')
  if (value.comparisons.length > MAX_COMPARISON_PLAN_ENTRIES)
    throw new Error(
      `Comparison plan cannot contain more than ${MAX_COMPARISON_PLAN_ENTRIES} comparisons.`
    )

  const ids = new Set<string>()
  for (let index = 0; index < value.comparisons.length; index += 1) {
    const entry = value.comparisons[index]
    const location = `Comparison ${index + 1}`
    if (!object(entry)) throw new Error(`${location} must be an object.`)
    const unknownEntry = Object.keys(entry).find((key) => !['id', 'name', 'context'].includes(key))
    if (unknownEntry) throw new Error(`${location} has unknown field “${unknownEntry}”.`)
    if (
      typeof entry.id !== 'string' ||
      entry.id.length > MAX_COMPARISON_PLAN_ID_LENGTH ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.id) ||
      entry.id.includes('..')
    )
      throw new Error(
        `${location} has an invalid id. Use 1–${MAX_COMPARISON_PLAN_ID_LENGTH} letters, numbers, periods, underscores, or hyphens; “..” and paths are not allowed.`
      )
    if (ids.has(entry.id)) throw new Error(`${location} has duplicate id “${entry.id}”.`)
    ids.add(entry.id)
    if (!boundedName(entry.name))
      throw new Error(
        `${location} (${entry.id}) name must be nonempty text no longer than ${MAX_COMPARISON_PLAN_NAME_LENGTH} characters.`
      )
    try {
      validateComparisonRequest({ revision: 0, context: entry.context })
    } catch (error) {
      throw new Error(`${location} (${entry.id}) is invalid: ${(error as Error).message}`)
    }
  }
}

export function parseComparisonPlan(text: string): ComparisonPlan {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Invalid comparison plan JSON.')
  }
  validateComparisonPlan(value)
  return value
}

export function executeComparisonPlan(
  data: Dataset,
  plan: unknown,
  appVersion: string,
  generatedAt: string
): ComparisonPlanResults {
  // Validate the complete plan before executing any comparison.
  validateComparisonPlan(plan)
  const results = plan.comparisons.map(({ id, name, context }) => ({
    id,
    name,
    analysis: comparisonExport(data, { revision: data.revision, context }, appVersion, generatedAt)
  }))
  return {
    kind: 'pennytel-comparison-plan-results',
    resultsFormatVersion: 1,
    app: { name: 'PennyTel', version: appVersion },
    source: { datasetSchemaVersion: data.schemaVersion, datasetRevision: data.revision },
    generatedAt,
    plan: { kind: plan.kind, planVersion: plan.planVersion, name: plan.name },
    results
  }
}
