/** Normalized metrics/provenance only. Raw rollout payloads remain external. */
export interface CodexExecutionEvidence {
  kind: 'codex-rollout'
  formatVersion: 1
  sourceLog?: {
    fileName: string
    contentHash?: { algorithm: 'sha256'; value: string }
  }
  sessionId?: string
  turnId?: string
  runtimeVersion?: string
  originator?: string
  workingDirectory?: string
  repository?: { url?: string; branch?: string; baselineCommitSha?: string }
  timeToFirstTokenMs?: number
  modelInvocationCount?: number
  toolCallCount?: number
  modelContextWindowTokens?: number
  /** Maximum observed invocation input, INCLUDING cached input; not run inputTokens. */
  peakInvocation?: {
    inputTokens: number
    cachedInputTokens?: number
    /** Window observed for this same invocation; never substitute a different window. */
    contextWindowTokens?: number
  }
  quotaWindows?: CodexQuotaWindow[]
  environment?: {
    sandboxMode?:
      'read-only' | 'workspace-write' | 'danger-full-access' | 'external-sandbox' | 'unknown'
    approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never' | 'unknown'
    approvalReviewer?: 'user' | 'auto_review' | 'unknown'
    networkAccess?: 'enabled' | 'restricted' | 'disabled' | 'unknown'
  }
}

export interface CodexQuotaReading {
  usedPercent: number
  recordedAt?: string
  resetsAt?: string
}

export interface CodexQuotaWindow {
  windowName?: string
  windowMinutes?: number
  planType?: string
  first?: CodexQuotaReading
  last?: CodexQuotaReading
  attribution: 'Clean' | 'Contaminated' | 'Unknown'
  note?: string
}

export type ExecutionEvidence = CodexExecutionEvidence

type Check = (value: unknown, path: string) => void
type Shape = Record<string, Check>
function invalid(path: string, message: string): never {
  throw new Error(`${path}: ${message}`)
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function shape(fields: Shape, required: string[] = []): Check {
  return (value, path) => {
    if (!record(value)) invalid(path, 'must be an object.')
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(fields, key)) invalid(`${path}.${key}`, 'unknown field.')
      fields[key](value[key], `${path}.${key}`)
    }
    for (const key of required)
      if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`, 'is required.')
  }
}
function text(max: number, pattern?: RegExp): Check {
  return (value, path) => {
    if (
      typeof value !== 'string' ||
      !value.length ||
      value.trim() !== value ||
      value.length > max ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) ||
      (pattern && !pattern.test(value))
    )
      invalid(
        path,
        `must be valid single-line metadata (1–${max} characters, no surrounding whitespace).`
      )
  }
}
function choices(values: readonly unknown[]): Check {
  return (value, path) => {
    if (!values.includes(value)) invalid(path, `must be one of ${values.join(', ')}.`)
  }
}
function number(min = 0, max = Number.MAX_SAFE_INTEGER, integer = true): Check {
  return (value, path) => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isSafeInteger(value))
    )
      invalid(path, `must be a finite ${integer ? 'integer ' : ''}number from ${min} to ${max}.`)
  }
}
const timestamp: Check = (value, path) => {
  // Reject calendar/time rollover (including 24:00), missing zones, and invalid offsets.
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(
      value
    ) ||
    !Number.isFinite(Date.parse(value)) ||
    !Number.isFinite(Date.parse(value.slice(0, 10))) ||
    new Date(value.slice(0, 10)).toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    invalid(path, 'must be a valid ISO timestamp including timezone.')
}

const quotaReading = shape(
  { usedPercent: number(0, 100, false), recordedAt: timestamp, resetsAt: timestamp },
  ['usedPercent']
)
const quotaWindow = shape(
  {
    windowName: text(100),
    windowMinutes: number(1),
    planType: text(100),
    first: quotaReading,
    last: quotaReading,
    attribution: choices(['Clean', 'Contaminated', 'Unknown']),
    note: text(500)
  },
  ['attribution']
)
const evidence = shape(
  {
    kind: choices(['codex-rollout']),
    formatVersion: choices([1]),
    sourceLog: shape(
      {
        fileName: text(255, /^(?!\.{1,2}$)[^/\\]+$/),
        // Digest of exact source-file bytes, not parsed/reformatted JSONL.
        contentHash: shape({ algorithm: choices(['sha256']), value: text(64, /^[a-f0-9]{64}$/) }, [
          'algorithm',
          'value'
        ])
      },
      ['fileName']
    ),
    sessionId: text(200, /^\S+$/),
    turnId: text(200, /^\S+$/),
    runtimeVersion: text(100),
    originator: text(200),
    workingDirectory: text(4096),
    repository: shape({
      url: text(2048),
      branch: text(255),
      baselineCommitSha: text(64, /^([a-f0-9]{40}|[a-f0-9]{64})$/)
    }),
    timeToFirstTokenMs: number(0, Number.MAX_SAFE_INTEGER, false),
    modelInvocationCount: number(),
    toolCallCount: number(),
    modelContextWindowTokens: number(1),
    peakInvocation: shape(
      { inputTokens: number(), cachedInputTokens: number(), contextWindowTokens: number(1) },
      ['inputTokens']
    ),
    quotaWindows: (value, path) => {
      if (!Array.isArray(value) || value.length > 16)
        invalid(path, 'must be an array with at most 16 windows.')
      for (const [index, window] of value.entries()) quotaWindow(window, `${path}[${index}]`)
    },
    environment: shape({
      sandboxMode: choices([
        'read-only',
        'workspace-write',
        'danger-full-access',
        'external-sandbox',
        'unknown'
      ]),
      approvalPolicy: choices(['untrusted', 'on-failure', 'on-request', 'never', 'unknown']),
      approvalReviewer: choices(['user', 'auto_review', 'unknown']),
      networkAccess: choices(['enabled', 'restricted', 'disabled', 'unknown'])
    })
  },
  ['kind', 'formatVersion']
)

export function validateExecutionEvidence(
  value: unknown,
  path = 'executionEvidence'
): asserts value is ExecutionEvidence {
  evidence(value, path)
  const data = value as ExecutionEvidence
  if (data.modelInvocationCount === 0 && data.peakInvocation !== undefined)
    invalid(`${path}.peakInvocation`, 'requires at least one model invocation.')
  if (
    data.peakInvocation?.cachedInputTokens !== undefined &&
    data.peakInvocation.cachedInputTokens > data.peakInvocation.inputTokens
  )
    invalid(
      `${path}.peakInvocation.cachedInputTokens`,
      'exceeds invocation input (which includes cached input).'
    )
  for (const [index, window] of (data.quotaWindows ?? []).entries()) {
    if (
      window.first?.recordedAt &&
      window.last?.recordedAt &&
      Date.parse(window.last.recordedAt) < Date.parse(window.first.recordedAt)
    )
      invalid(`${path}.quotaWindows[${index}].last.recordedAt`, 'precedes first reading.')
  }
}
