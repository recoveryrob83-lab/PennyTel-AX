import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { realpathSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import type { CodexExecutionEvidence } from '../shared/execution-evidence'
import type { CodexIntakeCandidate, Run } from '../shared/types'
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
class PartialScanError extends Error {
  constructor(
    message: string,
    readonly matches: Match[],
    readonly affected: Set<string> | undefined = undefined,
    readonly canUseMatches = false
  ) {
    super(message)
  }
}
class UnrelatedRolloutError extends Error {}
class SourceChangedError extends Error {}
class ReceiptConflictError extends Error {
  constructor(readonly receiptId: string) {
    super('Multiple terminal closures match this receipt.')
  }
}
interface Preview {
  match: Match
  revision: number
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
      after.mtimeMs !== opened.mtimeMs
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
export async function rolloutPaths(home: string, receipts: Receipt[]): Promise<string[]> {
  const paths: string[] = []
  let entriesSeen = 0
  const dates = new Set<string>()
  let earliestReceipt = Number.POSITIVE_INFINITY
  for (const receipt of receipts) {
    const stamp = receipt.report.receiptId.slice(4, 12)
    const day = Date.UTC(
      Number(stamp.slice(0, 4)),
      Number(stamp.slice(4, 6)) - 1,
      Number(stamp.slice(6, 8))
    )
    const issuedAt = Date.parse(
      `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${receipt.report.receiptId.slice(13, 15)}:${receipt.report.receiptId.slice(15, 17)}:${receipt.report.receiptId.slice(17, 19)}Z`
    )
    if (Number.isFinite(issuedAt)) earliestReceipt = Math.min(earliestReceipt, issuedAt)
    for (const shift of [-1, 0, 1])
      dates.add(new Date(day + shift * 86_400_000).toISOString().slice(0, 10))
  }
  const root = await directory(home)
  if (!root) return paths
  for (const name of ['sessions', 'archived_sessions']) {
    const base = await directory(join(root, name))
    if (!base || !inside(root, base)) continue
    const walk = async (at: string, depth: number): Promise<void> => {
      if (depth > 4) throw new Error('Codex session tree exceeds supported depth.')
      if ((await realpath(at)) !== at || !inside(base, at))
        throw new Error('Codex session directory changed or escaped its root.')
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
          const info = await lstat(child)
          const dateHint = [...dates].some((date) => entry.name.startsWith(`rollout-${date}`))
          // A resumed session may retain an old filename. Its last write must still
          // be near or after the receipt publication that precedes the final report.
          if (!dateHint && info.mtimeMs < earliestReceipt - 86_400_000) continue
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
): Promise<Match[]> {
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
  const results: Match[] = []
  const mentioned = new Set<string>()
  const untrustedMatches = new Set<string>()
  let scanError: Error | undefined
  let fullyInspected = false
  let sourceDevice = 0
  let sourceInode = 0
  const recordError = (error: Error): void => {
    if (error instanceof UnrelatedRolloutError) throw error
    if (!scanError || error instanceof ReceiptConflictError) scanError = error
    if (results.length) {
      // A bad resumed turn must not hide a subsequent independent closure.
      turn = undefined
      prior = undefined
    }
  }
  const processLine = (line: Buffer): void => {
    lineNumber++
    budget.lines++
    if (lineNumber > MAX_LINES || budget.lines > MAX_LINES * MAX_FILES)
      throw new Error('Rollout record limit exceeded.')
    if (!line.length) return
    const raw = line.toString('utf8')
    for (const receiptId of receipts.keys()) if (raw.includes(receiptId)) mentioned.add(receiptId)
    let record: unknown
    try {
      record = JSON.parse(raw)
    } catch {
      throw new Error('Malformed Codex rollout JSONL.')
    }
    if (!object(record) || !object(record.payload)) return
    const payload = record.payload
    if (record.type === 'session_meta') {
      if (Object.keys(meta).length) throw new Error('Duplicate Codex session metadata.')
      meta = payload
      const cwd = safeText(payload.cwd, 4096)
      if (!cwd || !inside(repo, resolve(cwd)))
        throw new UnrelatedRolloutError('Rollout working directory is outside PennyTel.')
    } else if (record.type === 'event_msg' && payload.type === 'task_started') {
      if (!safeText(meta.session_id ?? meta.id) || !safeText(meta.cwd, 4096))
        throw new Error('Task has no valid Codex session identity or working directory.')
      if (turn) throw new Error('Overlapping Codex task boundaries.')
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
    } else if (record.type === 'response_item' && turn) {
      if (payload.type === 'function_call' || payload.type === 'custom_tool_call') turn.toolCalls++
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
            turn.contradictory = true
            return
          }
          turn.terminalCount++
          if (turn.terminalCount > 1) turn.contradictory = true
          const receipt = receipts.get(extracted.report.receiptId)
          if (receipt) {
            reporter.matchTerminalBlockToReceipt(message, receipt.text)
            if (turn.final) turn.contradictory = true
            else turn.final = { receipt, text: message }
          }
        }
      }
    } else if (record.type === 'event_msg' && payload.type === 'task_complete') {
      if (!turn || payload.turn_id !== turn.id)
        throw new Error('Task completion identity contradicts start.')
      if (turn.final) {
        if (turn.contradictory || turn.models.size > 1 || turn.efforts.size > 1)
          throw new Error('Matched turn contains contradictory terminal/model/effort evidence.')
        const { run, warnings } = derive(turn.final.receipt, turn, meta, file, payload)
        if (
          results.some(
            (match) => match.receipt.report.receiptId === turn!.final!.receipt.report.receiptId
          )
        )
          throw new ReceiptConflictError(turn.final.receipt.report.receiptId)
        results.push({
          receipt: turn.final.receipt,
          run,
          path: file,
          prefixBytes: offset,
          prefixHash: hash.copy().digest('hex'),
          sourceDevice,
          sourceInode,
          warnings
        })
      }
      // A later task may start with a reliable baseline only if the immediately
      // preceding task ended with a valid cumulative snapshot.
      prior = !turn.invalidUsage && turn.total ? turn.total : undefined
      turn = undefined
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
      opened.size !== before.size
    )
      throw new Error('Rollout changed during discovery.')
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
        if (scanError && !results.length) {
          const raw = line.toString('utf8')
          for (const receiptId of receipts.keys())
            if (raw.includes(receiptId)) mentioned.add(receiptId)
        } else {
          try {
            const previousCount = results.length
            processLine(line)
            if (scanError)
              for (const match of results.slice(previousCount))
                untrustedMatches.add(match.receipt.report.receiptId)
          } catch (error) {
            recordError(error as Error)
          }
        }
        start = i + 1
      }
      pending = bytes.subarray(start)
      if (pending.length > MAX_LINE_BYTES) throw new Error('Rollout line exceeds the 256 KB limit.')
      if (readPosition === before.size) {
        if (pending.length) {
          hash.update(pending)
          offset += pending.length
          if (scanError && !results.length) {
            const raw = pending.toString('utf8')
            for (const receiptId of receipts.keys())
              if (raw.includes(receiptId)) mentioned.add(receiptId)
          } else {
            try {
              const previousCount = results.length
              processLine(pending)
              if (scanError)
                for (const match of results.slice(previousCount))
                  untrustedMatches.add(match.receipt.report.receiptId)
            } catch (error) {
              recordError(error as Error)
            }
          }
          pending = Buffer.alloc(0)
        }
      }
    }
    if (results.length) {
      const sameSnapshot = (left: typeof opened, right: typeof opened): boolean =>
        left.dev === right.dev &&
        left.ino === right.ino &&
        left.size === right.size &&
        left.mtimeMs === right.mtimeMs &&
        left.ctimeMs === right.ctimeMs
      let verified = false
      for (let attempt = 0; attempt < 3 && !verified; attempt++) {
        const start = await fd.stat()
        const pathStart = await lstat(file)
        if (
          (await realpath(file)) !== file ||
          start.dev !== opened.dev ||
          start.ino !== opened.ino ||
          pathStart.dev !== opened.dev ||
          pathStart.ino !== opened.ino ||
          start.size < before.size ||
          pathStart.size < before.size
        )
          throw new SourceChangedError('Rollout changed during discovery.')
        if (!sameSnapshot(start, pathStart)) continue
        const verifiedHash = createHash('sha256')
        const chunk = Buffer.alloc(64 * 1024)
        let verifiedBytes = 0
        for (const match of results) {
          while (verifiedBytes < match.prefixBytes) {
            const count = Math.min(chunk.length, match.prefixBytes - verifiedBytes)
            if (budget.bytes + count > MAX_TOTAL_BYTES)
              throw new Error('Discovery exceeds the 128 MB read limit.')
            const read = await fd.read(chunk, 0, count, verifiedBytes)
            if (!read.bytesRead) throw new SourceChangedError('Rollout changed during discovery.')
            verifiedHash.update(chunk.subarray(0, read.bytesRead))
            verifiedBytes += read.bytesRead
            budget.bytes += read.bytesRead
          }
          if (verifiedHash.copy().digest('hex') !== match.prefixHash)
            throw new SourceChangedError('Rollout closure evidence changed during discovery.')
        }
        const end = await fd.stat()
        const pathEnd = await lstat(file)
        if (
          (await realpath(file)) !== file ||
          end.dev !== opened.dev ||
          end.ino !== opened.ino ||
          pathEnd.dev !== opened.dev ||
          pathEnd.ino !== opened.ino ||
          end.size < before.size ||
          pathEnd.size < before.size
        )
          throw new SourceChangedError('Rollout changed during discovery.')
        verified = sameSnapshot(start, end) && sameSnapshot(end, pathEnd)
      }
      if (!verified) throw new SourceChangedError('Rollout changed during discovery.')
    } else {
      const after = await lstat(file)
      if (
        (await realpath(file)) !== file ||
        after.dev !== opened.dev ||
        after.ino !== opened.ino ||
        after.size !== before.size ||
        after.mtimeMs !== opened.mtimeMs ||
        after.ctimeMs !== opened.ctimeMs
      )
        throw new SourceChangedError('Rollout changed during discovery.')
    }
    fullyInspected = true
    if (scanError) throw scanError
    return results
  } catch (error) {
    if (error instanceof UnrelatedRolloutError) throw error
    const message = (error as Error).message
    const canUseMatches = fullyInspected && !(error instanceof SourceChangedError)
    const affected =
      error instanceof ReceiptConflictError
        ? new Set([error.receiptId])
        : !canUseMatches
          ? undefined
          : results.length
            ? new Set(
                [...mentioned, ...untrustedMatches].filter(
                  (id) =>
                    !results.some((match) => match.receipt.report.receiptId === id) ||
                    untrustedMatches.has(id)
                )
              )
            : mentioned.size || fullyInspected
              ? mentioned
              : undefined
    throw new PartialScanError(message, results, affected, canUseMatches)
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

  async discover(): Promise<CodexIntakeCandidate[]> {
    this.previews.clear()
    const { data } = await this.store.load()
    const { valid, rejected } = await this.receipts()
    const pending = valid.filter(
      (r) => !data.runs.some((run) => run.id === `codex_${r.report.receiptId}`)
    )
    const matches = new Map<string, Match[]>()
    const failures = new Map<string, string[]>()
    const addFailure = (message: string, excluded = new Set<string>()): void => {
      for (const receipt of pending) {
        if (excluded.has(receipt.report.receiptId)) continue
        failures.set(receipt.report.receiptId, [
          ...(failures.get(receipt.report.receiptId) ?? []),
          message
        ])
      }
    }
    const budget = { bytes: 0, lines: 0 }
    if (pending.length) {
      const all = new Map(pending.map((r) => [r.report.receiptId, r]))
      let files: string[]
      try {
        files = this.testSources?.rolloutFiles ?? (await rolloutPaths(this.codexHome, pending))
      } catch (error) {
        files = []
        addFailure((error as Error).message)
      }
      for (const path of files) {
        try {
          const found = await scanFile(
            path,
            all,
            this.testSources?.sourceRepositoryRoot ?? resolve(this.repo),
            this.protocol(),
            budget
          )
          for (const match of found)
            matches.set(match.receipt.report.receiptId, [
              ...(matches.get(match.receipt.report.receiptId) ?? []),
              match
            ])
        } catch (error) {
          if (error instanceof UnrelatedRolloutError) continue
          const partial =
            error instanceof PartialScanError && error.canUseMatches ? error.matches : []
          for (const match of partial)
            matches.set(match.receipt.report.receiptId, [
              ...(matches.get(match.receipt.report.receiptId) ?? []),
              match
            ])
          const affected =
            error instanceof PartialScanError && error.canUseMatches ? error.affected : undefined
          const protectedIds = new Set(partial.map((match) => match.receipt.report.receiptId))
          for (const receipt of pending) {
            const id = receipt.report.receiptId
            if (affected ? !affected.has(id) : protectedIds.has(id)) continue
            failures.set(id, [
              ...(failures.get(id) ?? []),
              `${basename(path)}: ${(error as Error).message}`
            ])
          }
        }
      }
    }
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
        if (data.runs.some((r) => r.id === `codex_${report.receiptId}`))
          return { ...base, status: 'already imported' }
        const found = matches.get(report.receiptId) ?? []
        const sourceFailures = failures.get(report.receiptId) ?? []
        if (sourceFailures.length)
          return {
            ...base,
            status: 'blocked',
            reason: `Rollout search incomplete. ${sourceFailures.slice(0, 3).join(' ')}`
          }
        if (found.length !== 1)
          return {
            ...base,
            status: 'blocked',
            reason:
              found.length > 1
                ? 'Multiple rollouts match this receipt.'
                : 'No verified closed Codex turn found.'
          }
        if (!data.slices.some((s) => s.id === report.sliceId))
          return {
            ...base,
            status: 'blocked',
            reason: 'Create or import the matching Dataset Slice first.',
            run: found[0].run,
            warnings: found[0].warnings
          }
        const token = randomUUID()
        this.previews.set(token, { match: found[0], revision: data.revision })
        const run = found[0].run
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
        return { ...base, status: 'ready', token, run, unknowns, warnings: found[0].warnings }
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
    const budget = { bytes: 0, lines: 0 }
    const files =
      this.testSources?.rolloutFiles ?? (await rolloutPaths(this.codexHome, [freshReceipt]))
    const found: Match[] = []
    for (const file of files) {
      try {
        found.push(
          ...(await scanFile(
            file,
            new Map([[freshReceipt.report.receiptId, freshReceipt]]),
            this.testSources?.sourceRepositoryRoot ?? resolve(this.repo),
            this.protocol(),
            budget
          ))
        )
      } catch (error) {
        if (error instanceof UnrelatedRolloutError) continue
        if (!(error instanceof PartialScanError) || !error.canUseMatches || !error.affected)
          throw error
        if (error.affected.has(freshReceipt.report.receiptId)) throw error
        found.push(...error.matches)
      }
    }
    if (found.length !== 1 || found[0].path !== selected.match.path)
      throw new Error('Codex receipt match became missing or ambiguous; rediscover before import.')
    const fresh = found[0]
    if (
      !fresh ||
      fresh.sourceDevice !== selected.match.sourceDevice ||
      fresh.sourceInode !== selected.match.sourceInode ||
      fresh.prefixBytes !== selected.match.prefixBytes ||
      fresh.prefixHash !== selected.match.prefixHash ||
      JSON.stringify(fresh.run) !== JSON.stringify(selected.match.run)
    )
      throw new Error('Codex closure evidence changed; rediscover before import.')
    return this.store.mutate({
      kind: 'save',
      table: 'runs',
      record: fresh.run,
      revision: selected.revision
    })
  }
}
