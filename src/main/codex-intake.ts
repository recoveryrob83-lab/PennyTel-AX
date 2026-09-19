import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { realpathSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import type { CodexExecutionEvidence } from '../shared/execution-evidence'
import type { CodexIntakeCandidate, Dataset, Run } from '../shared/types'
import { validateRecord } from '../shared/data'
import type { ProductionStore } from './production-store'

const MAX_RECEIPTS = 100
const MAX_FILES = 200
const MAX_FILE_BYTES = 32_000_000
const MAX_TOTAL_BYTES = 128_000_000
const MAX_LINES = 100_000
const MAX_LINE_BYTES = 256_000
const MAX_RECEIPT_BYTES = 4096
const REPORTER_START = 'PENNYOS_TURN_REPORT_V1'
const RECEIPT_NAME = /^pr1_[0-9]{8}T[0-9]{9}Z_[a-f0-9]{32}\.json$/

interface Report {
  receiptId: string
  projectId: string
  project: string
  sliceId: string
  runType: string
  role: Run['role']
  result: NonNullable<Run['result']>
  verification: string
  findings: number
  candidate?: string
}
interface Reporter {
  validateReceipt(value: string): { report: Report; canonicalReport: string }
  extractTerminalBlock(value: string): { report: Report; canonicalReport: string }
  matchTerminalBlockToReceipt(value: string, receipt: string): Report
}
export interface Receipt {
  path: string
  text: string
  report: Report
  digest: string
}
interface Usage {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_output_tokens: number
}
interface Turn {
  id: string
  startedAt?: string
  baseline?: Usage
  total?: Usage
  invalidUsage: boolean
  contextWindows: Set<number>
  models: Set<string>
  efforts: Set<string>
  toolCalls: number
  invocationCount: number
  invocationEvidenceValid: boolean
  sawTotal: boolean
  peak?: { inputTokens: number; cachedInputTokens: number; contextWindowTokens?: number }
  quotas: Map<string, NonNullable<CodexExecutionEvidence['quotaWindows']>[number]>
  environment?: CodexExecutionEvidence['environment']
  final?: { receipt: Receipt; text: string }
  terminalCount: number
  contradictory: boolean
}
export interface Match {
  receipt: Receipt
  run: Run
  path: string
  prefixBytes: number
  prefixHash: string
  sourceDevice: number
  sourceInode: number
  warnings: string[]
}
/** Authority only advances; measurement is the immutable first valid closure. */
export interface ReceiptAuthority {
  cardinality: 'none' | 'unique' | 'multiple'
  first?: Match
  conflicts: string[]
  uncertainties: string[]
}
type AuthorityEvent = { kind: 'closure'; match: Match } | { kind: 'uncertain'; reason: string }

function diagnostic(values: string[], reason: string): string[] {
  return values.includes(reason) || values.length >= 3 ? values : [...values, reason]
}
export function reduceAuthority(state: ReceiptAuthority, event: AuthorityEvent): ReceiptAuthority {
  if (event.kind === 'uncertain')
    return { ...state, uncertainties: diagnostic(state.uncertainties, event.reason) }
  if (state.cardinality === 'none')
    return { ...state, cardinality: 'unique', first: freeze(event.match) }
  return {
    ...state,
    cardinality: 'multiple',
    conflicts: diagnostic(state.conflicts, 'Multiple terminal closures match this receipt.')
  }
}
function emptyAuthority(): ReceiptAuthority {
  return { cardinality: 'none', conflicts: [], uncertainties: [] }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
interface SourceStamp {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  ctimeMs: number
}
function stamp(value: SourceStamp): SourceStamp {
  return {
    dev: value.dev,
    ino: value.ino,
    size: value.size,
    mtimeMs: value.mtimeMs,
    ctimeMs: value.ctimeMs
  }
}
function sameStamp(a: SourceStamp, b: SourceStamp): boolean {
  return JSON.stringify(stamp(a)) === JSON.stringify(stamp(b))
}
interface FileObservation {
  path: string
  identity: SourceStamp
  inspectedBytes: number
  digest: string
  authority: Record<string, ReceiptAuthority>
  uncertainties: string[]
}
interface AuthorityObservation {
  adapter: 'codex-0.155.1/reporter-0.1.0/authority-1'
  receipts: { id: string; digest: string }[]
  inventory: string[]
  directories: Record<string, SourceStamp>
  sources: FileObservation[]
  authority: Record<string, ReceiptAuthority>
  coverage: 'complete' | 'incomplete'
  uncertainties: string[]
}
class SourceChangedError extends Error {}
class InspectionLimitError extends Error {}
interface Preview {
  observation: AuthorityObservation
  match: Match
  revision: number
}

/** Both review and commit evaluate the same sealed authority and Dataset rules. */
export function eligibility(
  observation: Pick<AuthorityObservation, 'authority' | 'uncertainties' | 'coverage'>,
  receipt: Receipt,
  data: Dataset
): { status: 'ready' | 'blocked' | 'already imported'; reason?: string; match?: Match } {
  if (data.runs.some((run) => run.id === `codex_${receipt.report.receiptId}`))
    return { status: 'already imported' }
  const state = observation.authority[receipt.report.receiptId] ?? emptyAuthority()
  if (state.conflicts.length) return { status: 'blocked', reason: state.conflicts.join(' ') }
  const uncertainties = [...observation.uncertainties, ...state.uncertainties]
  if (observation.coverage !== 'complete' || uncertainties.length)
    return {
      status: 'blocked',
      reason: `Rollout search incomplete. ${uncertainties.slice(0, 3).join(' ')}`
    }
  if (state.cardinality !== 'unique' || !state.first)
    return { status: 'blocked', reason: 'No verified closed Codex turn found.' }
  if (!data.slices.some((slice) => slice.id === receipt.report.sliceId))
    return {
      status: 'blocked',
      reason: 'Create or import the matching Dataset Slice first.',
      match: state.first
    }
  return { status: 'ready', match: state.first }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function safeText(value: unknown, max = 200): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    value === value.trim() &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
    ? value
    : undefined
}
function timestamp(value: unknown): string | undefined {
  const text =
    typeof value === 'number' && Number.isFinite(value)
      ? new Date(value * 1000).toISOString()
      : value
  return typeof text === 'string' &&
    Number.isFinite(Date.parse(text)) &&
    /^\d{4}-\d\d-\d\dT/.test(text)
    ? text
    : undefined
}
function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function usage(value: unknown): Usage | undefined {
  if (
    !object(value) ||
    !nonnegative(value.input_tokens) ||
    !nonnegative(value.cached_input_tokens) ||
    !nonnegative(value.output_tokens) ||
    !nonnegative(value.reasoning_output_tokens) ||
    value.cached_input_tokens > value.input_tokens ||
    value.reasoning_output_tokens > value.output_tokens ||
    (Object.hasOwn(value, 'total_tokens') &&
      (!nonnegative(value.total_tokens) ||
        value.total_tokens !== value.input_tokens + value.output_tokens))
  )
    return undefined
  return {
    input_tokens: value.input_tokens,
    cached_input_tokens: value.cached_input_tokens,
    output_tokens: value.output_tokens,
    reasoning_output_tokens: value.reasoning_output_tokens
  }
}
const zeroUsage = (): Usage => ({
  input_tokens: 0,
  cached_input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0
})
function delta(start: Usage, end: Usage): Usage | undefined {
  const result = {
    input_tokens: end.input_tokens - start.input_tokens,
    cached_input_tokens: end.cached_input_tokens - start.cached_input_tokens,
    output_tokens: end.output_tokens - start.output_tokens,
    reasoning_output_tokens: end.reasoning_output_tokens - start.reasoning_output_tokens
  }
  return usage(result)
}
function captureQuota(turn: Turn, limits: unknown, recordedAt: unknown): void {
  if (!object(limits)) return
  const recorded = timestamp(recordedAt)
  for (const name of ['primary', 'secondary'] as const) {
    const source = limits[name]
    if (
      !object(source) ||
      typeof source.used_percent !== 'number' ||
      !Number.isFinite(source.used_percent) ||
      source.used_percent < 0 ||
      source.used_percent > 100
    )
      continue
    const key = `${safeText(limits.limit_id, 100) ?? 'Codex'}:${name}`
    const reading = {
      usedPercent: source.used_percent,
      ...(recorded ? { recordedAt: recorded } : {}),
      ...(timestamp(source.resets_at) ? { resetsAt: timestamp(source.resets_at)! } : {})
    }
    const existing = turn.quotas.get(key)
    const window = existing ?? {
      windowName: key,
      ...(nonnegative(source.window_minutes) && source.window_minutes > 0
        ? { windowMinutes: source.window_minutes }
        : {}),
      ...(safeText(limits.plan_type, 100) ? { planType: safeText(limits.plan_type, 100)! } : {}),
      attribution: 'Unknown' as const,
      note: 'Quota window may include activity outside this measured turn.'
    }
    if (!existing) window.first = reading
    window.last = reading
    if (turn.quotas.size < 16 || existing) turn.quotas.set(key, window)
  }
}
function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}
async function directory(path: string): Promise<string | undefined> {
  try {
    if (!(await lstat(path)).isDirectory())
      throw new Error('Source root is not a regular directory.')
    const actual = await realpath(path)
    if (actual !== path) throw new Error('Source root uses a symlink or ambiguous path.')
    return actual
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
async function fixedFile(path: string, max: number): Promise<Buffer> {
  if ((await realpath(path)) !== path) throw new Error('Source path uses a symlink.')
  const before = await lstat(path)
  if (!before.isFile() || before.size > max) throw new Error('Nonregular or oversized source.')
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await fd.stat()
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error('Source changed during discovery.')
    const bytes = Buffer.alloc(opened.size + 1)
    let count = 0
    while (count < bytes.length) {
      const read = await fd.read(bytes, count, bytes.length - count, count)
      if (!read.bytesRead) break
      count += read.bytesRead
    }
    const after = await lstat(path)
    if (
      (await realpath(path)) !== path ||
      count !== opened.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    )
      throw new Error('Source changed during discovery.')
    return bytes.subarray(0, count)
  } finally {
    await fd.close()
  }
}

/** Resolve the installed executable to the package's declared public main export. */
export function installedReporter(): Reporter {
  for (const part of (process.env.PATH ?? '').split(sep === '/' ? ':' : ';')) {
    const executable = join(part, 'pennyReporter')
    if (!part || !existsSync(executable)) continue
    const root = dirname(dirname(realpathSync(executable)))
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name?: string
      version?: string
      main?: string
    }
    if (manifest.name !== 'penny-reporter' || manifest.version !== '0.1.0' || !manifest.main)
      throw new Error('Installed pennyReporter protocol version is unsupported.')
    const protocol = createRequire(join(root, 'package.json'))(root) as Reporter
    if (
      typeof protocol.validateReceipt !== 'function' ||
      typeof protocol.extractTerminalBlock !== 'function' ||
      typeof protocol.matchTerminalBlockToReceipt !== 'function'
    )
      throw new Error('Installed pennyReporter lacks its public validation API.')
    return protocol
  }
  throw new Error('Installed pennyReporter was not found on PATH.')
}
export async function rolloutPaths(
  home: string,
  directories: Record<string, SourceStamp> = {}
): Promise<string[]> {
  const paths: string[] = []
  let entriesSeen = 0
  const root = await directory(home)
  if (!root) return paths
  directories[root] = stamp(await lstat(root))
  for (const name of ['sessions', 'archived_sessions']) {
    const base = await directory(join(root, name))
    if (!base || !inside(root, base)) continue
    const walk = async (at: string, depth: number): Promise<void> => {
      if (depth > 4) throw new Error('Codex session tree exceeds supported depth.')
      if ((await realpath(at)) !== at || !inside(base, at))
        throw new Error('Codex session directory changed or escaped its root.')
      directories[at] = stamp(await lstat(at))
      const entries = (await readdir(at, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name)
      )
      entriesSeen += entries.length
      if (entriesSeen > MAX_FILES * 50)
        throw new Error('Codex session directory exceeds scan limit.')
      for (const entry of entries) {
        const child = join(at, entry.name)
        if (entry.isSymbolicLink()) throw new Error('Codex session tree contains a symlink.')
        if (entry.isDirectory()) await walk(child, depth + 1)
        else if (entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
          if (!entry.isFile()) throw new Error('Nonregular rollout source.')
          if (paths.length >= MAX_FILES)
            throw new Error('Relevant Codex rollout file count exceeds limit.')
          paths.push(child)
        }
      }
    }
    await walk(base, 0)
  }
  return paths
}

function derive(
  receipt: Receipt,
  turn: Turn,
  meta: Record<string, unknown>,
  file: string,
  complete: Record<string, unknown>
): { run: Run; warnings: string[] } {
  const evidence: CodexExecutionEvidence = {
    kind: 'codex-rollout',
    formatVersion: 1,
    sourceLog: { fileName: basename(file) }
  }
  const warnings: string[] = []
  const session = safeText(meta.session_id ?? meta.id)
  if (session) evidence.sessionId = session
  evidence.turnId = turn.id
  const version = safeText(meta.cli_version, 100)
  if (version) evidence.runtimeVersion = version
  const originator = safeText(meta.originator)
  if (originator) evidence.originator = originator
  const cwd = safeText(meta.cwd, 4096)
  if (cwd) evidence.workingDirectory = cwd
  if (turn.environment && Object.keys(turn.environment).length)
    evidence.environment = turn.environment
  if (nonnegative(complete.time_to_first_token_ms))
    evidence.timeToFirstTokenMs = complete.time_to_first_token_ms
  evidence.toolCallCount = turn.toolCalls
  if (!turn.invalidUsage && turn.sawTotal && turn.invocationEvidenceValid && turn.baseline)
    evidence.modelInvocationCount = turn.invocationCount
  if (turn.contextWindows.size === 1)
    evidence.modelContextWindowTokens = [...turn.contextWindows][0]
  if (!turn.invalidUsage && turn.invocationEvidenceValid && turn.peak)
    evidence.peakInvocation = turn.peak
  if (turn.quotas.size) evidence.quotaWindows = [...turn.quotas.values()]
  const git = object(meta.git) ? meta.git : undefined
  if (git) {
    const repository: NonNullable<CodexExecutionEvidence['repository']> = {}
    const url = safeText(git.repository_url, 2048)
    const branch = safeText(git.branch, 255)
    const baseline = safeText(git.commit_hash, 64)
    if (url) repository.url = url
    if (branch) repository.branch = branch
    if (baseline && /^([a-f0-9]{40}|[a-f0-9]{64})$/.test(baseline))
      repository.baselineCommitSha = baseline
    if (Object.keys(repository).length) evidence.repository = repository
  }
  const report = receipt.report
  const run: Run = {
    id: `codex_${report.receiptId}`,
    sliceId: report.sliceId,
    runType: report.runType,
    role: report.role,
    result: report.result,
    executionEvidence: evidence
  }
  if (report.candidate) run.candidate = report.candidate
  const startedAt = timestamp(complete.started_at) ?? turn.startedAt
  const endedAt = timestamp(complete.completed_at)
  if (startedAt) run.startAt = startedAt
  if (endedAt) run.endAt = endedAt
  if (nonnegative(complete.duration_ms)) run.wallMinutes = complete.duration_ms / 60_000
  else if (startedAt && endedAt && Date.parse(endedAt) >= Date.parse(startedAt))
    run.wallMinutes = (Date.parse(endedAt) - Date.parse(startedAt)) / 60_000
  if (!turn.invalidUsage && turn.baseline && turn.total) {
    const change = delta(turn.baseline, turn.total)
    if (change) {
      run.inputTokens = change.input_tokens - change.cached_input_tokens
      run.cachedInputTokens = change.cached_input_tokens
      run.outputTokens = change.output_tokens
      run.reasoningTokens = change.reasoning_output_tokens
    } else
      warnings.push(
        'Cumulative usage contradicts cache or reasoning totals; tokens remain Unknown.'
      )
  } else warnings.push('Matched-turn cumulative usage is incomplete; tokens remain Unknown.')
  if (turn.models.size === 1) run.model = [...turn.models][0]
  if (turn.efforts.size === 1) {
    const effort = [...turn.efforts][0]
    const mapping: Record<string, Run['thinking']> = {
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      xhigh: 'ExtraHigh',
      max: 'Max'
    }
    if (mapping[effort]) run.thinking = mapping[effort]
  }
  const provider = safeText(meta.model_provider)
  if (provider) run.provider = provider
  validateRecord('runs', run)
  return { run, warnings }
}

export async function scanFile(
  file: string,
  receipts: Map<string, Receipt>,
  repo: string,
  reporter: Reporter,
  budget: { bytes: number; lines: number }
): Promise<FileObservation> {
  if ((await realpath(file)) !== file) throw new Error('Rollout path uses a symlink.')
  const before = await lstat(file)
  if (!before.isFile() || before.size > MAX_FILE_BYTES)
    throw new Error('Rollout is nonregular or exceeds the 32 MB file limit.')
  if (budget.bytes + before.size > MAX_TOTAL_BYTES)
    throw new Error('Discovery exceeds the 128 MB read limit.')
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  const hash = createHash('sha256')
  let offset = 0
  let readPosition = 0
  let lineNumber = 0
  let meta: Record<string, unknown> = {}
  let prior: Usage | undefined
  let tasks = 0
  let turn: Turn | undefined
  const authority: Record<string, ReceiptAuthority> = Object.fromEntries(
    [...receipts.keys()].map((id) => [id, emptyAuthority()])
  )
  let uncertainties: string[] = []
  let unrelated = false
  let turnError: string | undefined
  const turnReceipts = new Set<string>()
  let sourceDevice = 0
  let sourceInode = 0
  const uncertain = (id: string, reason: string): void => {
    authority[id] = reduceAuthority(authority[id], { kind: 'uncertain', reason })
  }
  const recordError = (error: Error): void => {
    if (error instanceof InspectionLimitError) throw error
    turnError ??= error.message
    for (const id of turnReceipts) uncertain(id, error.message)
    prior = undefined
  }
  const processLine = (line: Buffer): void => {
    lineNumber++
    budget.lines++
    if (lineNumber > MAX_LINES || budget.lines > MAX_LINES * MAX_FILES)
      throw new InspectionLimitError('Rollout record limit exceeded.')
    if (!line.length) return
    const raw = line.toString('utf8')
    let record: unknown
    try {
      record = JSON.parse(raw)
    } catch {
      uncertainties = diagnostic(
        uncertainties,
        'Malformed Codex rollout JSONL; authority coverage is incomplete.'
      )
      recordError(new Error('Malformed Codex rollout JSONL.'))
      return
    }
    if (!object(record) || !object(record.payload)) return
    const payload = record.payload
    if (record.type === 'session_meta') {
      if (Object.keys(meta).length) {
        uncertainties = diagnostic(uncertainties, 'Duplicate Codex session metadata.')
        return
      }
      meta = payload
      const cwd = safeText(payload.cwd, 4096)
      if (!cwd)
        uncertainties = diagnostic(uncertainties, 'Invalid Codex session working directory.')
      unrelated = Boolean(cwd && !inside(repo, resolve(cwd)))
    } else if (unrelated) {
      return
    } else if (record.type === 'event_msg' && payload.type === 'task_started') {
      if (!safeText(meta.session_id ?? meta.id) || !safeText(meta.cwd, 4096))
        throw new Error('Task has no valid Codex session identity or working directory.')
      const overlap = turn && !turnError ? 'Overlapping Codex task boundaries.' : undefined
      if (turn) recordError(new Error('Overlapping Codex task boundaries.'))
      turnReceipts.clear()
      turnError = overlap
      const id = safeText(payload.turn_id)
      if (!id) throw new Error('Task start has no valid turn identity.')
      tasks++
      turn = {
        id,
        startedAt: timestamp(payload.started_at),
        baseline: prior ?? (tasks === 1 ? zeroUsage() : undefined),
        invalidUsage: false,
        contextWindows: new Set(),
        models: new Set(),
        efforts: new Set(),
        toolCalls: 0,
        invocationCount: 0,
        invocationEvidenceValid: true,
        sawTotal: false,
        quotas: new Map(),
        terminalCount: 0,
        contradictory: false
      }
      if (nonnegative(payload.model_context_window) && payload.model_context_window > 0)
        turn.contextWindows.add(payload.model_context_window)
    } else if (record.type === 'turn_context' && turn) {
      if (payload.turn_id !== turn.id) throw new Error('Turn context identity contradicts task.')
      const contextCwd = safeText(payload.cwd, 4096)
      if (contextCwd && !inside(repo, resolve(contextCwd)))
        throw new Error('Matched turn working directory is outside PennyTel.')
      const model = safeText(payload.model)
      const effort = safeText(payload.effort)
      if (model) turn.models.add(model)
      if (effort) turn.efforts.add(effort.toLowerCase())
      const env: NonNullable<CodexExecutionEvidence['environment']> = {}
      if (
        typeof payload.approval_policy === 'string' &&
        ['untrusted', 'on-failure', 'on-request', 'never'].includes(payload.approval_policy)
      )
        env.approvalPolicy = payload.approval_policy as NonNullable<typeof env.approvalPolicy>
      const sandbox = object(payload.sandbox_policy)
        ? payload.sandbox_policy.type
        : payload.sandbox_policy
      if (
        typeof sandbox === 'string' &&
        ['read-only', 'workspace-write', 'danger-full-access', 'external-sandbox'].includes(sandbox)
      )
        env.sandboxMode = sandbox as NonNullable<typeof env.sandboxMode>
      turn.environment = env
    } else if (record.type === 'event_msg' && payload.type === 'token_count') {
      if (turn) captureQuota(turn, payload.rate_limits, record.timestamp)
      const info = object(payload.info) ? payload.info : undefined
      const total = info ? usage(info.total_token_usage) : undefined
      if (turn && info && Object.hasOwn(info, 'total_token_usage') && !total)
        turn.invalidUsage = true
      if (total) {
        const last = usage(info?.last_token_usage)
        const window =
          info && nonnegative(info.model_context_window) && info.model_context_window > 0
            ? info.model_context_window
            : undefined
        const previous = prior ?? (turn?.baseline && !turn.sawTotal ? turn.baseline : undefined)
        const advancement = previous ? delta(previous, total) : undefined
        if (previous && !advancement) {
          if (turn) turn.invalidUsage = true
        } else if (turn) {
          turn.sawTotal = true
          if (window) turn.contextWindows.add(window)
          if (advancement && Object.values(advancement).some((value) => value > 0)) {
            // A cumulative increase counts as one invocation only when the paired
            // latest-request sample explains that exact increase.
            if (
              !last ||
              JSON.stringify(last) !== JSON.stringify(advancement) ||
              (window !== undefined && last.input_tokens > window)
            ) {
              turn.invocationEvidenceValid = false
              turn.peak = undefined
            } else if (turn.invocationEvidenceValid) {
              turn.invocationCount++
              if (!turn.peak || last.input_tokens > turn.peak.inputTokens)
                turn.peak = {
                  inputTokens: last.input_tokens,
                  cachedInputTokens: last.cached_input_tokens,
                  ...(window ? { contextWindowTokens: window } : {})
                }
            }
          } else if (!advancement) {
            turn.invocationEvidenceValid = false
            turn.peak = undefined
          }
        }
        prior = total
        if (turn) turn.total = total
      }
    } else if (record.type === 'response_item') {
      if (turn && (payload.type === 'function_call' || payload.type === 'custom_tool_call'))
        turn.toolCalls++
      if (
        payload.type === 'message' &&
        payload.role === 'assistant' &&
        payload.phase === 'final_answer' &&
        Array.isArray(payload.content)
      ) {
        const message = payload.content
          .filter((part): part is Record<string, unknown> => object(part))
          .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
          .map((part) => part.text as string)
          .join('')
          .trimEnd()
        if (message.includes(REPORTER_START)) {
          let extracted: ReturnType<Reporter['extractTerminalBlock']>
          try {
            extracted = reporter.extractTerminalBlock(message)
          } catch {
            if (turn) turn.contradictory = true
            return
          }
          if (turn) {
            turn.terminalCount++
            if (turn.terminalCount > 1) turn.contradictory = true
          }
          const receipt = receipts.get(extracted.report.receiptId)
          if (receipt) {
            turnReceipts.add(receipt.report.receiptId)
            if (!turn || turnError) {
              uncertain(
                receipt.report.receiptId,
                turnError ?? 'Terminal report has no valid task boundary.'
              )
              return
            }
            try {
              reporter.matchTerminalBlockToReceipt(message, receipt.text)
            } catch (error) {
              // Receipt-specific disagreement cannot change another turn's counters.
              uncertain(receipt.report.receiptId, (error as Error).message)
              return
            }
            if (turn.final) turn.contradictory = true
            else turn.final = { receipt, text: message }
          }
        }
      }
    } else if (record.type === 'event_msg' && payload.type === 'task_complete') {
      if (!turn || payload.turn_id !== turn.id)
        throw new Error('Task completion identity contradicts start.')
      if (turn.contradictory || turn.models.size > 1 || turn.efforts.size > 1)
        recordError(
          new Error('Matched turn contains contradictory terminal/model/effort evidence.')
        )
      if (turn.final && !turnError) {
        const id = turn.final.receipt.report.receiptId
        try {
          const { run, warnings } = derive(turn.final.receipt, turn, meta, file, payload)
          authority[id] = reduceAuthority(authority[id], {
            kind: 'closure',
            match: {
              receipt: turn.final.receipt,
              run,
              path: file,
              prefixBytes: offset,
              prefixHash: hash.copy().digest('hex'),
              sourceDevice,
              sourceInode,
              warnings
            }
          })
        } catch (error) {
          uncertain(id, (error as Error).message)
        }
      }
      // A later task may start with a reliable baseline only if the immediately
      // preceding task ended with a valid cumulative snapshot.
      prior = !turnError && !turn.invalidUsage && turn.total ? turn.total : undefined
      turn = undefined
      turnError = undefined
      turnReceipts.clear()
    }
  }
  try {
    const opened = await fd.stat()
    if (
      !Number.isSafeInteger(before.dev) ||
      !Number.isSafeInteger(before.ino) ||
      !Number.isSafeInteger(opened.dev) ||
      !Number.isSafeInteger(opened.ino) ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      !sameStamp(opened, before)
    )
      throw new SourceChangedError('Codex closure evidence changed during capture.')
    sourceDevice = opened.dev
    sourceInode = opened.ino
    const chunk = Buffer.alloc(64 * 1024)
    let pending = Buffer.alloc(0)
    while (readPosition < before.size) {
      const count = Math.min(chunk.length, before.size - readPosition)
      const read = await fd.read(chunk, 0, count, readPosition)
      if (!read.bytesRead) throw new Error('Rollout changed during discovery.')
      readPosition += read.bytesRead
      budget.bytes += read.bytesRead
      const bytes = Buffer.concat([pending, chunk.subarray(0, read.bytesRead)])
      let start = 0
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] !== 10) continue
        const line = bytes.subarray(start, i)
        if (line.length > MAX_LINE_BYTES) throw new Error('Rollout line exceeds the 256 KB limit.')
        const complete = bytes.subarray(start, i + 1)
        hash.update(complete)
        offset += complete.length
        try {
          processLine(line)
        } catch (error) {
          recordError(error as Error)
        }
        start = i + 1
      }
      pending = bytes.subarray(start)
      if (pending.length > MAX_LINE_BYTES) throw new Error('Rollout line exceeds the 256 KB limit.')
      if (readPosition === before.size) {
        if (pending.length) {
          hash.update(pending)
          offset += pending.length
          try {
            processLine(pending)
          } catch (error) {
            recordError(error as Error)
          }
          pending = Buffer.alloc(0)
        }
      }
    }
    // Verify the entire parsed horizon, including suffixes and sources with no
    // target closure. Growth is a changed capture, never an unclassified extension.
    const verifyIdentity = async (): Promise<void> => {
      if (
        (await realpath(file)) !== file ||
        !sameStamp(opened, await fd.stat()) ||
        !sameStamp(opened, await lstat(file))
      )
        throw new SourceChangedError('Codex closure evidence changed during capture.')
    }
    await verifyIdentity()
    const digest = hash.digest('hex')
    const verified = createHash('sha256')
    let position = 0
    while (position < opened.size) {
      const count = Math.min(chunk.length, opened.size - position)
      if (budget.bytes + count > MAX_TOTAL_BYTES)
        throw new Error('Discovery exceeds the 128 MB read limit.')
      const read = await fd.read(chunk, 0, count, position)
      if (!read.bytesRead)
        throw new SourceChangedError('Codex closure evidence changed during capture.')
      verified.update(chunk.subarray(0, read.bytesRead))
      position += read.bytesRead
      budget.bytes += read.bytesRead
    }
    if (verified.digest('hex') !== digest)
      throw new SourceChangedError('Codex closure evidence changed during capture.')
    await verifyIdentity()
    if (turn?.final)
      uncertain(turn.final.receipt.report.receiptId, 'Terminal report has no task completion.')
    return freeze({
      path: file,
      identity: stamp(opened),
      inspectedBytes: offset,
      digest,
      authority,
      uncertainties
    })
  } finally {
    await fd.close()
  }
}

export class CodexIntake {
  private previews = new Map<string, Preview>()
  constructor(
    private readonly repo: string,
    private readonly store: ProductionStore,
    private reporter?: Reporter,
    private readonly codexHome: string = resolve(
      process.env.CODEX_HOME !== undefined ? process.env.CODEX_HOME : join(homedir(), '.codex')
    ),
    private readonly testSources?: {
      receiptDirectory: string
      rolloutFiles: string[]
      sourceRepositoryRoot: string
    }
  ) {}

  private protocol(): Reporter {
    return (this.reporter ??= installedReporter())
  }

  private async receipts(): Promise<{ valid: Receipt[]; rejected: CodexIntakeCandidate[] }> {
    const root = await directory(resolve(this.repo))
    if (!root) throw new Error('PennyTel repository is unavailable.')
    const project = JSON.parse(
      (await fixedFile(join(root, 'pennyos', 'project.json'), 4096)).toString('utf8')
    )
    if (project.projectId !== 'pennytel' || project.project !== 'PennyTel')
      throw new Error('Repository identity is not PennyTel.')
    const receiptRoot = await directory(
      this.testSources?.receiptDirectory ?? join(root, '.pennyos', 'runtime', 'receipts')
    )
    if (!receiptRoot) return { valid: [], rejected: [] }
    const entries = (await readdir(receiptRoot, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    if (entries.length > MAX_RECEIPTS)
      throw new Error('Receipt count exceeds the 100-receipt limit.')
    const valid: Receipt[] = []
    const rejected: CodexIntakeCandidate[] = []
    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue
      const id = entry.name.slice(0, -5)
      try {
        if (!RECEIPT_NAME.test(entry.name) || !entry.isFile())
          throw new Error('Unsafe receipt source.')
        const path = join(receiptRoot, entry.name)
        const text = (await fixedFile(path, MAX_RECEIPT_BYTES)).toString('utf8')
        const { report } = this.protocol().validateReceipt(text)
        if (report.receiptId !== id) throw new Error('Receipt filename and content disagree.')
        if (report.projectId !== project.projectId || report.project !== project.project)
          throw new Error('Receipt belongs to another project.')
        const slice = join(root, 'pennyos', 'slices', `${report.sliceId}.json`)
        if (
          !/^[A-Za-z0-9_-]{1,100}$/.test(report.sliceId) ||
          JSON.parse((await fixedFile(slice, 4096)).toString('utf8')).sliceId !== report.sliceId
        )
          throw new Error('Receipt slice identity is absent from this repository.')
        valid.push({ path, text, report, digest: createHash('sha256').update(text).digest('hex') })
      } catch (error) {
        rejected.push({
          receiptId: id.slice(0, 100),
          status: 'rejected',
          reason: (error as Error).message
        })
      }
    }
    return { valid, rejected }
  }

  private async capture(receipts: Receipt[]): Promise<AuthorityObservation> {
    const authority: Record<string, ReceiptAuthority> = Object.fromEntries(
      receipts.map((receipt) => [receipt.report.receiptId, emptyAuthority()])
    )
    const sources: FileObservation[] = []
    let uncertainties: string[] = []
    let inventory: string[] = []
    const directories: Record<string, SourceStamp> = {}
    const files = async (captured: Record<string, SourceStamp>): Promise<string[]> => {
      const paths = this.testSources?.rolloutFiles
        ? [...this.testSources.rolloutFiles].sort()
        : await rolloutPaths(this.codexHome, captured)
      if (paths.length > MAX_FILES)
        throw new Error('Relevant Codex rollout file count exceeds limit.')
      return paths
    }
    try {
      inventory = await files(directories)
      const budget = { bytes: 0, lines: 0 }
      const all = new Map(receipts.map((receipt) => [receipt.report.receiptId, receipt]))
      for (const path of inventory) {
        try {
          const source = await scanFile(
            path,
            all,
            this.testSources?.sourceRepositoryRoot ?? resolve(this.repo),
            this.protocol(),
            budget
          )
          sources.push(source)
          for (const reason of source.uncertainties)
            uncertainties = diagnostic(uncertainties, reason)
          for (const [id, state] of Object.entries(source.authority)) {
            if (state.first)
              authority[id] = reduceAuthority(authority[id], {
                kind: 'closure',
                match: state.first
              })
            if (state.cardinality === 'multiple' && state.first)
              authority[id] = reduceAuthority(authority[id], {
                kind: 'closure',
                match: state.first
              })
            for (const reason of state.uncertainties)
              authority[id] = reduceAuthority(authority[id], { kind: 'uncertain', reason })
          }
        } catch (error) {
          uncertainties = diagnostic(uncertainties, (error as Error).message)
        }
      }
      // Revalidate receipts and the inventory as part of capture. This observation
      // set is deliberately not an atomic live-filesystem snapshot.
      const current = await this.receipts()
      const identities = (values: Receipt[]): string =>
        JSON.stringify(values.map((r) => [r.report.receiptId, r.digest]))
      if (identities(current.valid) !== identities(receipts))
        throw new SourceChangedError('Receipt changed during capture; rediscover before import.')
      if (JSON.stringify(await files({})) !== JSON.stringify(inventory))
        throw new SourceChangedError('Codex source inventory changed during capture.')
      for (const source of sources) {
        if (
          (await realpath(source.path)) !== source.path ||
          !sameStamp(source.identity, await lstat(source.path))
        )
          throw new SourceChangedError('Codex closure evidence changed during capture.')
      }
      for (const [path, identity] of Object.entries(directories)) {
        if ((await realpath(path)) !== path || !sameStamp(identity, await lstat(path)))
          throw new SourceChangedError('Codex source inventory changed during capture.')
      }
    } catch (error) {
      uncertainties = diagnostic(uncertainties, (error as Error).message)
    }
    return freeze({
      adapter: 'codex-0.155.1/reporter-0.1.0/authority-1',
      receipts: receipts.map((r) => ({ id: r.report.receiptId, digest: r.digest })),
      inventory,
      directories,
      sources,
      authority,
      coverage: uncertainties.length ? 'incomplete' : 'complete',
      uncertainties
    })
  }

  async discover(): Promise<CodexIntakeCandidate[]> {
    this.previews.clear()
    const { data } = await this.store.load()
    const { valid, rejected } = await this.receipts()
    const observation = await this.capture(valid)
    return [
      ...rejected,
      ...valid.map((receipt): CodexIntakeCandidate => {
        const report = receipt.report
        const metadata = {
          sliceId: report.sliceId,
          runType: report.runType,
          role: report.role,
          result: report.result,
          verification: report.verification,
          findings: report.findings,
          ...(report.candidate ? { candidate: report.candidate } : {})
        }
        const base = { receiptId: report.receiptId, report: metadata }
        const decision = eligibility(observation, receipt, data)
        if (decision.status !== 'ready' || !decision.match)
          return {
            ...base,
            status: decision.status,
            reason: decision.reason,
            ...(decision.match
              ? { run: decision.match.run, warnings: decision.match.warnings }
              : {})
          }
        const match = decision.match
        const token = randomUUID()
        this.previews.set(token, { observation, match, revision: data.revision })
        const run = match.run
        const unknowns = (
          [
            'model',
            'thinking',
            'provider',
            'startAt',
            'endAt',
            'inputTokens',
            'cachedInputTokens',
            'outputTokens',
            'reasoningTokens'
          ] as const
        ).filter((key) => run[key] === undefined) as string[]
        const evidence = run.executionEvidence
        for (const key of [
          'sourceLog.contentHash',
          'sessionId',
          'turnId',
          'runtimeVersion',
          'originator',
          'workingDirectory',
          'repository',
          'timeToFirstTokenMs',
          'modelInvocationCount',
          'toolCallCount',
          'modelContextWindowTokens',
          'peakInvocation',
          'quotaWindows',
          'environment'
        ]) {
          const value =
            key === 'sourceLog.contentHash'
              ? evidence?.sourceLog?.contentHash
              : evidence?.[key as keyof typeof evidence]
          if (value === undefined) unknowns.push(`executionEvidence.${key}`)
        }
        return { ...base, status: 'ready', token, run, unknowns, warnings: match.warnings }
      })
    ]
  }

  async commit(token: string): Promise<Awaited<ReturnType<ProductionStore['mutate']>>> {
    const selected = this.previews.get(token)
    this.previews.delete(token)
    if (!selected) throw new Error('Discover and review this Codex candidate again.')
    const { data } = await this.store.load()
    if (data.revision !== selected.revision)
      throw new Error('Dataset revision changed; rediscover before import.')
    if (data.runs.some((r) => r.id === selected.match.run.id))
      throw new Error('Deterministic Run ID already exists; import refused.')
    const { valid } = await this.receipts()
    const freshReceipt = valid.find(
      (r) => r.report.receiptId === selected.match.receipt.report.receiptId
    )
    if (!freshReceipt || freshReceipt.digest !== selected.match.receipt.digest)
      throw new Error('Receipt changed; rediscover before import.')
    const observation = await this.capture(valid)
    const decision = eligibility(observation, freshReceipt, data)
    if (decision.status !== 'ready' || !decision.match)
      throw new Error(decision.reason ?? 'Deterministic Run ID already exists; import refused.')
    const fresh = decision.match
    if (
      fresh.path !== selected.match.path ||
      fresh.sourceDevice !== selected.match.sourceDevice ||
      fresh.sourceInode !== selected.match.sourceInode ||
      fresh.prefixBytes !== selected.match.prefixBytes ||
      fresh.prefixHash !== selected.match.prefixHash ||
      JSON.stringify(fresh.run) !== JSON.stringify(selected.match.run)
    )
      throw new Error('Codex closure evidence changed; rediscover before import.')
    // The complete sealed observation above is the approved external authority
    // cutoff. Later producer writes do not reopen this decision during storage IO.
    return this.store.mutate({
      kind: 'save',
      table: 'runs',
      record: selected.match.run,
      revision: selected.revision
    })
  }
}
