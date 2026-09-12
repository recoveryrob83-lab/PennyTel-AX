import type { Table } from './types'

export interface Field {
  key: string
  label: string
  type?: 'number' | 'boolean' | 'date' | 'timestamp' | 'textarea'
  options?: readonly string[]
  required?: boolean
  integer?: boolean
  min?: number
  max?: number
  hint?: string
  group?: string
  relation?: 'slices' | 'runs'
}
const levels = ['Low', 'Medium', 'High']
const thinking = [...levels, 'ExtraHigh', 'Max']
const id: Field = {
  key: 'id',
  label: 'Record ID',
  required: true,
  hint: 'Stable identifier used by imports and related records.'
}
const sliceId: Field = { key: 'sliceId', label: 'Slice', required: true, relation: 'slices' }
const notes: Field = { key: 'notes', label: 'Notes', type: 'textarea', group: 'Notes' }
const number = (
  key: string,
  label: string,
  group: string,
  hint?: string,
  integer = true
): Field => ({ key, label, type: 'number', group, hint, integer })
export const fields: Record<Table, Field[]> = {
  slices: [
    id,
    { key: 'title', label: 'Title', required: true },
    { key: 'project', label: 'Project' },
    { key: 'repository', label: 'Repository' },
    { key: 'taskShape', label: 'Task shape' },
    {
      key: 'productionModel',
      label: 'Factory production model',
      options: ['Solo', 'Orchestrated', 'Full Pipeline', 'Custom']
    },
    { key: 'ambiguity', label: 'Ambiguity', options: levels },
    {
      key: 'risk',
      label: 'Risk',
      options: levels,
      hint: 'Consequence of incorrect work, not task size.'
    },
    {
      key: 'disposition',
      label: 'Disposition',
      options: ['In progress', 'Accepted', 'Rejected', 'Abandoned']
    },
    {
      key: 'qualityGrade',
      label: 'Product quality grade (1–5)',
      type: 'number',
      integer: true,
      min: 1,
      max: 5,
      options: ['1', '2', '3', '4', '5'],
      hint: 'Final operator judgment on the Sheet’s 1–5 scale, separate from automated metrics.'
    },
    { key: 'preferredCandidate', label: 'Preferred candidate / model' },
    { key: 'startDate', label: 'Start date', type: 'date' },
    {
      key: 'acceptedAt',
      label: 'Accepted at',
      type: 'timestamp',
      hint: 'Edit local date/time or use the exact timestamp option. Stored as ISO with timezone.'
    },
    number(
      'timeToAcceptedMinutes',
      'Time to accepted (minutes)',
      'Acceptance',
      'Optional measured elapsed time; otherwise derived from first run to acceptance.',
      false
    ),
    { key: 'factoryVersion', label: 'Factory model version', group: 'Provenance' },
    { key: 'baseline', label: 'Starting commit / baseline', group: 'Provenance' },
    { key: 'contractVersion', label: 'Contract / prompt version', group: 'Provenance' },
    { key: 'promptHash', label: 'Prompt hash', group: 'Provenance' },
    { key: 'experiment', label: 'Experiment / study', group: 'Provenance' },
    notes
  ],
  runs: [
    id,
    sliceId,
    {
      key: 'runType',
      label: 'Run type',
      required: true,
      hint: 'Implementation, criticism, repair, verification, context loading…'
    },
    {
      key: 'role',
      label: 'Factory role',
      required: true,
      options: ['Orchestrator', 'Context Steward', 'Implementer', 'Critic', 'Repair']
    },
    { key: 'candidate', label: 'Candidate / implementation' },
    { key: 'model', label: 'Exact model' },
    { key: 'modelFamily', label: 'Model family' },
    { key: 'provider', label: 'Provider' },
    { key: 'thinking', label: 'Thinking level', options: thinking },
    {
      key: 'result',
      label: 'Run result',
      options: ['Completed', 'Accepted', 'Needs repair', 'Rejected', 'Blocked', 'Aborted']
    },
    {
      key: 'sessionMode',
      label: 'Session mode',
      options: ['Fresh', 'Resumed'],
      group: 'Session & context'
    },
    {
      key: 'contextMode',
      label: 'Context mode',
      options: ['Full Repo', 'Compact Packet', 'Resumed Context', 'Orchestrated Packet', 'Other'],
      group: 'Session & context'
    },
    { key: 'orchestrated', label: 'Orchestrated', type: 'boolean', group: 'Session & context' },
    { key: 'orchestratorModel', label: 'Orchestrator model', group: 'Session & context' },
    {
      key: 'orchestratorThinking',
      label: 'Orchestrator thinking',
      options: thinking,
      group: 'Session & context'
    },
    {
      key: 'startAt',
      label: 'Start timestamp',
      type: 'timestamp',
      group: 'Time & usage',
      hint: 'ISO timestamp with timezone, e.g. 2026-09-11T15:00:00-05:00. Required for automatic pricing.'
    },
    { key: 'endAt', label: 'End timestamp', type: 'timestamp', group: 'Time & usage' },
    number(
      'wallMinutes',
      'Wall clock (minutes)',
      'Time & usage',
      'Overrides elapsed time from timestamps.',
      false
    ),
    {
      ...number(
        'localHour',
        'Local hour',
        'Time & usage',
        'Operator-local hour, 0–23. Set explicitly for time-of-day analysis.'
      ),
      max: 23
    },
    {
      key: 'dayOfWeek',
      label: 'Day of week',
      options: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      group: 'Time & usage'
    },
    {
      ...number(
        'usageBefore',
        'Usage before (% remaining)',
        'Time & usage',
        'Remaining percentage, 0–100. Use comparable readings from the same meter.',
        false
      ),
      max: 100
    },
    {
      ...number(
        'usageAfter',
        'Usage after (% remaining)',
        'Time & usage',
        '94% before → 92% after = 2 percentage points burned. An increase is treated as a reset, not negative burn.',
        false
      ),
      max: 100
    },
    {
      key: 'usageReset',
      label: 'Meter reset / replenished between readings',
      type: 'boolean',
      group: 'Time & usage',
      hint: 'Yes disables inferred burn, even if the ending percentage is lower. Explicit burn remains authoritative.'
    },
    number(
      'usageBurn',
      'Usage meter burn (percentage points)',
      'Time & usage',
      'Explicit measured burn overrides before minus after. Leave blank if unknown across a reset.',
      false
    ),
    number(
      'inputTokens',
      'Input tokens (fresh / noncached)',
      'Tokens & cost',
      'Codex input tokens are fresh input. Cached input is additional and recorded separately.'
    ),
    number(
      'cachedInputTokens',
      'Cached input tokens',
      'Tokens & cost',
      'Additional cached input; may exceed fresh input. Enter 0 when known to be uncached. Blank means unknown.'
    ),
    number('outputTokens', 'Output tokens (including reasoning)', 'Tokens & cost'),
    number(
      'reasoningTokens',
      'Reasoning tokens',
      'Tokens & cost',
      'A subset of output tokens; never charged twice.'
    ),
    number(
      'inputRate',
      'Override input $ / million',
      'Tokens & cost',
      'To correct a run’s rates, enter all three overrides.',
      false
    ),
    number('cachedRate', 'Override cached $ / million', 'Tokens & cost', undefined, false),
    number('outputRate', 'Override output $ / million', 'Tokens & cost', undefined, false),
    ...[
      ['filesChanged', 'Files changed'],
      ['implementationAdded', 'Implementation LOC added'],
      ['implementationDeleted', 'Implementation LOC deleted'],
      ['testAdded', 'Test LOC added'],
      ['testDeleted', 'Test LOC deleted'],
      ['testsAdded', 'Tests added'],
      ['testsPassed', 'Tests passed'],
      ['testsFailed', 'Tests failed'],
      ['testsSkipped', 'Tests skipped']
    ].map(([key, label]) => number(key, label, 'Implementation & verification')),
    {
      key: 'buildResult',
      label: 'Build / check result',
      options: ['Passed', 'Failed', 'Not run'],
      group: 'Implementation & verification'
    },
    {
      key: 'runtimeTested',
      label: 'Runtime testing performed',
      type: 'boolean',
      group: 'Implementation & verification'
    },
    ...[
      ['humanInterventions', 'Human interventions'],
      ['clarifications', 'Clarification requests'],
      ['autonomousDefects', 'Autonomous defects discovered'],
      ['scopeViolations', 'Scope violations / unrelated changes'],
      ['toolIncidents', 'Environment / tool incidents']
    ].map(([key, label]) => number(key, label, 'Factory behavior')),
    notes
  ],
  findings: [
    id,
    sliceId,
    { key: 'runId', label: 'Discovered in run', relation: 'runs' },
    {
      key: 'severity',
      label: 'Severity',
      required: true,
      options: ['P0', 'P1', 'P2', 'Observation']
    },
    {
      key: 'category',
      label: 'Category',
      required: true,
      options: [
        'Product',
        'UX',
        'Architecture',
        'State',
        'Test Gap',
        'Harness',
        'Environment',
        'Scope',
        'Other'
      ]
    },
    { key: 'title', label: 'Finding title' },
    { key: 'description', label: 'Description', type: 'textarea', required: true },
    { key: 'userVisible', label: 'User visible', type: 'boolean' },
    { key: 'reproducible', label: 'Reproducible', type: 'boolean' },
    { key: 'repairRequired', label: 'Repair required', type: 'boolean' },
    { key: 'repairRunId', label: 'Repair run', relation: 'runs' },
    {
      key: 'status',
      label: 'Final status',
      options: ['Open', 'Repaired', 'Accepted risk', 'Dismissed']
    },
    { key: 'evidence', label: 'Evidence', type: 'textarea' },
    {
      key: 'contractInvariant',
      label: 'Contract / invariant',
      type: 'textarea',
      group: 'Review judgment'
    },
    { key: 'impact', label: 'Impact', type: 'textarea', group: 'Review judgment' },
    {
      key: 'confidence',
      label: 'Confidence',
      group: 'Review judgment',
      hint: 'Reviewer’s confidence and rationale; the Sheet specifies no fixed scale.'
    },
    notes
  ],
  discoveries: [
    id,
    sliceId,
    { key: 'runId', label: 'Discovery run', relation: 'runs' },
    {
      key: 'model',
      label: 'Model',
      hint: 'Optional attribution; the linked run is authoritative when present.'
    },
    { key: 'thinking', label: 'Thinking level', options: thinking },
    { key: 'discoveryType', label: 'Discovery type' },
    { key: 'description', label: 'Description', required: true, type: 'textarea' },
    { key: 'inPrompt', label: 'Already in prompt / contract', type: 'boolean' },
    { key: 'selfInitiated', label: 'Self-initiated', type: 'boolean' },
    { key: 'impact', label: 'Impact level', options: levels },
    { key: 'validation', label: 'Independent validation', options: ['Pending', 'Yes', 'No'] },
    { key: 'validatedBy', label: 'Validated by' },
    { key: 'adopted', label: 'Adopted', options: ['Yes', 'No', 'Deferred'] },
    { key: 'disposition', label: 'Disposition' },
    {
      key: 'downstreamValue',
      label: 'Downstream value',
      options: [
        'Prevented Defect',
        'Improved UX',
        'Reduced Cost',
        'Reduced Risk',
        'Improved Verification',
        'Other'
      ]
    },
    { key: 'evidence', label: 'Evidence / link', type: 'textarea' },
    notes
  ],
  pricing: [
    id,
    { key: 'model', label: 'Exact model', required: true },
    { key: 'provider', label: 'Provider', required: true },
    { key: 'effectiveDate', label: 'Effective date (UTC)', required: true, type: 'date' },
    { ...number('inputRate', 'Input $ / million', 'Rates', undefined, false), required: true },
    {
      ...number('cachedRate', 'Cached input $ / million', 'Rates', undefined, false),
      required: true
    },
    { ...number('outputRate', 'Output $ / million', 'Rates', undefined, false), required: true },
    {
      key: 'source',
      label: 'Pricing source',
      hint: 'Provider source or link; retained with new catalog snapshots.'
    },
    notes
  ]
}
export const singular: Record<Table, string> = {
  slices: 'slice',
  runs: 'run',
  findings: 'finding',
  discoveries: 'discovery',
  pricing: 'price'
}
