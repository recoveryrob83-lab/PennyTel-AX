import type { ComparisonRequest } from './comparison'

export type Level = 'Low' | 'Medium' | 'High'
export type Thinking = Level | 'ExtraHigh' | 'Max'
export type Role = 'Orchestrator' | 'Context Steward' | 'Implementer' | 'Critic' | 'Repair'
export interface Slice {
  id: string
  title: string
  project?: string
  repository?: string
  taskShape?: string
  productionModel?: 'Solo' | 'Orchestrated' | 'Full Pipeline' | 'Custom'
  factoryVersion?: string
  ambiguity?: Level
  risk?: Level
  baseline?: string
  contractVersion?: string
  promptHash?: string
  experiment?: string
  startDate?: string
  acceptedAt?: string
  disposition?: 'In progress' | 'Accepted' | 'Rejected' | 'Abandoned'
  qualityGrade?: 1 | 2 | 3 | 4 | 5
  preferredCandidate?: string
  timeToAcceptedMinutes?: number
  notes?: string
}
export interface Rates {
  inputRate: number
  cachedRate: number
  outputRate: number
}
export interface PriceSnapshot extends Rates {
  model: string
  provider: string
  effectiveDate?: string
  pricingId?: string
  source: 'Catalog' | 'Override'
  rateSource?: string
}
export interface Run {
  id: string
  sliceId: string
  runType: string
  role: Role
  candidate?: string
  model?: string
  modelFamily?: string
  thinking?: Thinking
  provider?: string
  sessionMode?: 'Fresh' | 'Resumed'
  contextMode?: 'Full Repo' | 'Compact Packet' | 'Resumed Context' | 'Orchestrated Packet' | 'Other'
  orchestrated?: boolean
  orchestratorModel?: string
  orchestratorThinking?: Thinking
  startAt?: string
  endAt?: string
  localHour?: number
  dayOfWeek?: 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday'
  wallMinutes?: number
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  usageBefore?: number
  usageAfter?: number
  usageBurn?: number
  usageReset?: boolean
  inputRate?: number
  cachedRate?: number
  outputRate?: number
  priceSnapshot?: PriceSnapshot
  filesChanged?: number
  implementationAdded?: number
  implementationDeleted?: number
  testAdded?: number
  testDeleted?: number
  testsAdded?: number
  testsPassed?: number
  testsFailed?: number
  testsSkipped?: number
  buildResult?: 'Passed' | 'Failed' | 'Not run'
  runtimeTested?: boolean
  humanInterventions?: number
  clarifications?: number
  autonomousDefects?: number
  scopeViolations?: number
  toolIncidents?: number
  result?: 'Completed' | 'Accepted' | 'Needs repair' | 'Rejected' | 'Blocked' | 'Aborted'
  notes?: string
}
export interface Finding {
  id: string
  sliceId: string
  runId?: string
  severity: 'P0' | 'P1' | 'P2' | 'Observation'
  category:
    | 'Product'
    | 'UX'
    | 'Architecture'
    | 'State'
    | 'Test Gap'
    | 'Harness'
    | 'Environment'
    | 'Scope'
    | 'Other'
  title?: string
  description: string
  contractInvariant?: string
  impact?: string
  confidence?: string
  notes?: string
  userVisible?: boolean
  reproducible?: boolean
  repairRequired?: boolean
  repairRunId?: string
  status?: 'Open' | 'Repaired' | 'Accepted risk' | 'Dismissed'
  evidence?: string
}
export interface Discovery {
  id: string
  sliceId: string
  runId?: string
  model?: string
  thinking?: Thinking
  discoveryType?: string
  inPrompt?: boolean
  selfInitiated?: boolean
  description: string
  impact?: Level
  validation?: 'Pending' | 'Yes' | 'No'
  validatedBy?: string
  adopted?: 'Yes' | 'No' | 'Deferred'
  disposition?: string
  downstreamValue?:
    | 'Prevented Defect'
    | 'Improved UX'
    | 'Reduced Cost'
    | 'Reduced Risk'
    | 'Improved Verification'
    | 'Other'
  evidence?: string
  notes?: string
}
export interface Pricing extends Rates {
  id: string
  model: string
  provider: string
  effectiveDate: string
  source?: string
  notes?: string
}
export interface EntityMap {
  slices: Slice
  runs: Run
  findings: Finding
  discoveries: Discovery
  pricing: Pricing
}
export type Table = keyof EntityMap
export type Entity = EntityMap[Table]
export type Dataset = { [K in Table]: EntityMap[K][] } & { schemaVersion: 1; revision: number }
export const TABLES: Table[] = ['slices', 'runs', 'findings', 'discoveries', 'pricing']
export const emptyDataset = (): Dataset => ({
  schemaVersion: 1,
  revision: 0,
  slices: [],
  runs: [],
  findings: [],
  discoveries: [],
  pricing: []
})
export type Mutation =
  | { kind: 'save'; table: Table; record: Entity; revision: number }
  | { kind: 'delete'; table: Table; id: string; revision: number }
  | { kind: 'import'; text: string; revision: number }
export interface LoadedData {
  data: Dataset
  path: string
  warning?: string
}
export interface ImportPreview {
  counts: Record<Table, number>
  skipped: number
}
export interface PennyTelAPI {
  load: () => Promise<LoadedData>
  mutate: (command: Mutation) => Promise<LoadedData>
  previewImport: (text: string) => Promise<ImportPreview>
  openImport: () => Promise<string | null>
  exportData: () => Promise<string | null>
  exportComparison: (request: ComparisonRequest) => Promise<string | null>
}
