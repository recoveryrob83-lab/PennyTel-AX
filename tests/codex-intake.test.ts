import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  truncate,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  CodexIntake,
  eligibility,
  installedReporter,
  rolloutPaths,
  scanFile,
  type Receipt
} from '../src/main/codex-intake'
import {
  emptyDataset,
  type CodexIntakeCandidate,
  type Dataset,
  type Mutation,
  type Run
} from '../src/shared/types'
import type { ProductionStore } from '../src/main/production-store'

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>())
}))

const reporter = installedReporter() as ReturnType<typeof installedReporter> & {
  createReceipt(report: object): object
}
const file = resolve('tests/fixtures/codex-rollout-current-0.155.1.jsonl')
const receiptId = 'pr1_20260919T120000000Z_11111111111111111111111111111111'

type RolloutRecord = { type: string; payload: Record<string, unknown>; timestamp?: string }
const event = (type: string, payload: Record<string, unknown>): RolloutRecord => ({
  type: 'event_msg',
  payload: { type, ...payload }
})
const counters = (
  input: number,
  cached: number,
  output: number,
  reasoning: number
): {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_output_tokens: number
} => ({
  input_tokens: input,
  cached_input_tokens: cached,
  output_tokens: output,
  reasoning_output_tokens: reasoning
})
const token = (total: object, last?: object, window?: number): RolloutRecord =>
  event('token_count', {
    info: {
      total_token_usage: total,
      ...(last ? { last_token_usage: last } : {}),
      ...(window ? { model_context_window: window } : {})
    }
  })
const started = (id: string): RolloutRecord => event('task_started', { turn_id: id })
const completed = (id: string): RolloutRecord => event('task_complete', { turn_id: id })
const lines = (records: RolloutRecord[]): string =>
  records.map((record) => JSON.stringify(record)).join('\n') + '\n'

async function fixtureRecords(): Promise<RolloutRecord[]> {
  return (await readFile(file, 'utf8'))
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as RolloutRecord)
}
async function inTemp<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'pennytel-s13-repair-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
async function scanRecords(records: RolloutRecord[]): Promise<Run | undefined> {
  return inTemp(async (dir) => {
    const path = join(dir, 'rollout-test.jsonl')
    await writeFile(path, lines(records))
    const valid = receipt(receiptId)
    const matches = await scanFile(path, new Map([[receiptId, valid]]), '/synthetic', reporter, {
      bytes: 0,
      lines: 0
    })
    const state = matches.authority[receiptId]
    if (matches.uncertainties.length || state.uncertainties.length || state.conflicts.length)
      throw new Error(
        [...matches.uncertainties, ...state.uncertainties, ...state.conflicts].join(' ')
      )
    return state.first?.run
  })
}

function receipt(id: string, findings = 0): Receipt {
  const report = {
    reportVersion: 1,
    receiptId: id,
    projectId: 'pennytel',
    project: 'PennyTel',
    sliceId: 'S13',
    runType: 'Implementation',
    role: 'Implementer',
    result: 'Completed',
    verification: 'Passed',
    findings
  }
  const text = JSON.stringify(reporter.createReceipt(report))
  return {
    path: '/synthetic/receipt.json',
    text,
    report: reporter.validateReceipt(text).report,
    digest: createHash('sha256').update(text).digest('hex')
  }
}

describe('current Codex 0.155.1 closed-turn adapter', () => {
  it('matches only assistant final closure and derives cumulative, cache, reasoning and bounded evidence', async () => {
    const valid = receipt('pr1_20260919T120000000Z_11111111111111111111111111111111')
    const matches = await scanFile(
      file,
      new Map([[valid.report.receiptId, valid]]),
      '/synthetic',
      reporter,
      { bytes: 0, lines: 0 }
    )
    expect(matches.authority[receiptId].cardinality).toBe('unique')
    const run = matches.authority[receiptId].first!.run
    expect(run.id).toBe(`codex_${valid.report.receiptId}`)
    expect(run.verification).toBe('Passed')
    expect(run.result).toBe('Completed')
    expect(run).toMatchObject({
      inputTokens: 60,
      cachedInputTokens: 40,
      outputTokens: 10,
      reasoningTokens: 4,
      thinking: 'ExtraHigh',
      model: 'gpt-6-astra',
      wallMinutes: 4 / 60
    })
    expect(run.executionEvidence).toMatchObject({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runtimeVersion: '0.155.1',
      toolCallCount: 1,
      modelInvocationCount: 2,
      modelContextWindowTokens: 258400,
      peakInvocation: { inputTokens: 60, cachedInputTokens: 20, contextWindowTokens: 258400 },
      quotaWindows: [
        { attribution: 'Unknown', first: { usedPercent: 12 }, last: { usedPercent: 13 } }
      ]
    })
    expect(JSON.stringify(run)).not.toContain('PENNYOS_TURN_REPORT_V1')
    expect(JSON.stringify(run)).not.toContain('Completed.\\n')
  })

  it('ignores a copied report in a user prompt and a different receipt', async () => {
    const wrong = receipt('pr1_20260919T120000001Z_22222222222222222222222222222222')
    expect(
      await scanFile(file, new Map([[wrong.report.receiptId, wrong]]), '/synthetic', reporter, {
        bytes: 0,
        lines: 0
      })
    ).toMatchObject({ authority: { [wrong.report.receiptId]: { cardinality: 'none' } } })
  })

  it('rejects a terminal block whose receipt content was altered under the same identity', async () => {
    const altered = receipt('pr1_20260919T120000000Z_11111111111111111111111111111111', 1)
    await expect(
      scanFile(file, new Map([[altered.report.receiptId, altered]]), '/synthetic', reporter, {
        bytes: 0,
        lines: 0
      })
    ).resolves.toMatchObject({
      authority: {
        [receiptId]: { uncertainties: [expect.stringContaining('does not match receipt')] }
      }
    })
  })

  it('fails closed on incompatible working directories and nonregular sources', async () => {
    const valid = receipt('pr1_20260919T120000000Z_11111111111111111111111111111111')
    await expect(
      scanFile(file, new Map([[valid.report.receiptId, valid]]), '/another-project', reporter, {
        bytes: 0,
        lines: 0
      })
    ).resolves.toMatchObject({ authority: { [receiptId]: { cardinality: 'none' } } })
    await expect(
      scanFile('/dev/null', new Map([[valid.report.receiptId, valid]]), '/synthetic', reporter, {
        bytes: 0,
        lines: 0
      })
    ).rejects.toThrow('nonregular')
  })

  it('enumerates only fixed active and archived Codex session roots', async () => {
    const now = Date.parse('2026-09-19T13:00:00.000Z')
    const paths = await rolloutPaths(resolve('tests/fixtures/codex-home'), {
      horizon: 1,
      now,
      cutoff: now - 86_400_000
    })
    expect(paths).toHaveLength(2)
    expect(paths.some((path) => path.includes('/sessions/2026/09/19/'))).toBe(true)
    expect(paths.some((path) => path.includes('/archived_sessions/'))).toBe(true)
  })

  it('classifies rolling 1/3/5-day UTC boundaries before the 200-file bound', async () => {
    await inTemp(async (home) => {
      const active = join(home, 'sessions')
      const archive = join(home, 'archived_sessions')
      await mkdir(active)
      await mkdir(archive)
      const now = Date.parse('2026-09-19T12:00:00.000Z')
      const add = async (root: string, date: string, suffix: string): Promise<void> => {
        await writeFile(join(root, `rollout-${date}-${suffix}.jsonl`), '')
      }
      await add(active, '2026-09-18T12-00-00', 'one-boundary')
      await add(archive, '2026-09-16T12-00-00', 'three-boundary')
      await add(archive, '2026-09-14T12-00-00', 'five-boundary')
      await add(active, '2026-09-14T11-59-59', 'outside')
      for (let i = 0; i < 218; i++) await add(archive, '2026-09-01T12-00-00', `old-${i}`)
      const paths = (horizon: 1 | 3 | 5): Promise<string[]> =>
        rolloutPaths(home, { horizon, now, cutoff: now - horizon * 86_400_000 })
      expect((await paths(1)).map((path) => path.includes('one-boundary'))).toEqual([true])
      expect(await paths(3)).toHaveLength(2)
      expect(await paths(5)).toHaveLength(3)
      for (let i = 0; i < 198; i++) await add(active, '2026-09-19T11-00-00', `recent-${i}`)
      expect(await paths(1)).toHaveLength(199)
      await add(active, '2026-09-19T11-00-00', 'recent-198')
      expect(await paths(1)).toHaveLength(200)
      await add(active, '2026-09-19T11-00-00', 'recent-199')
      await expect(paths(1)).rejects.toThrow('selected 1-day Codex window exceeds the 200-rollout')
    })
  })

  it('fails closed on malformed, conflicting, and future source timestamps', async () => {
    await inTemp(async (home) => {
      const active = join(home, 'sessions', '2026', '09', '19')
      await mkdir(active, { recursive: true })
      const now = Date.parse('2026-09-19T13:00:00.000Z')
      const paths = (): Promise<string[]> =>
        rolloutPaths(home, { horizon: 1, now, cutoff: now - 86_400_000 })
      const path = join(active, 'rollout-2026-09-19T12-00-00-valid.jsonl')
      await writeFile(path, '')
      expect(await paths()).toEqual([path])
      for (const name of [
        'rollout-unknown.jsonl',
        'rollout-2026-02-30T12-00-00-invalid.jsonl',
        'rollout-2026-09-18T12-00-00-conflict.jsonl',
        'rollout-2026-09-20T12-00-00-future.jsonl'
      ]) {
        const bad = join(active, name)
        await writeFile(bad, '')
        await expect(paths()).rejects.toThrow(/timestamp|dates disagree/)
        await rm(bad)
      }
    })
  })

  it('requires review, consumes preview tokens, checks revision, and never overwrites a Run', async () => {
    let data: Dataset = { ...emptyDataset(), slices: [{ id: 'S13', title: 'Intake' }] }
    const mutations: Mutation[] = []
    const store = {
      load: async () => ({ data: structuredClone(data), path: '/synthetic/data' }),
      mutate: async (command: Mutation) => {
        mutations.push(command)
        if (
          command.kind !== 'save' ||
          command.table !== 'runs' ||
          command.revision !== data.revision
        )
          throw new Error('Unexpected mutation')
        data = { ...data, revision: data.revision + 1, runs: [...data.runs, command.record as Run] }
        return { data: structuredClone(data), path: '/synthetic/data' }
      }
    } as unknown as ProductionStore
    const intake = new CodexIntake(resolve('.'), store, reporter, '/synthetic/codex', {
      receiptDirectory: resolve('tests/fixtures/codex-receipts'),
      rolloutFiles: [file],
      sourceRepositoryRoot: '/synthetic'
    })
    const preview = (await intake.discover()).find(
      (item) => item.receiptId === 'pr1_20260919T120000000Z_11111111111111111111111111111111'
    )!
    expect(preview.status).toBe('ready')
    expect(mutations).toHaveLength(0)
    expect(preview.run?.inputTokens).toBe(60)
    const saved = await intake.commit(preview.token!)
    expect(saved.data.revision).toBe(1)
    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toMatchObject({ kind: 'save', table: 'runs', revision: 0 })
    await expect(intake.commit(preview.token!)).rejects.toThrow('Discover and review')
    expect(
      (await intake.discover()).find((item) => item.receiptId === preview.receiptId)?.status
    ).toBe('already imported')

    data = { ...data, runs: [], revision: 2 }
    const stale = (await intake.discover()).find((item) => item.receiptId === preview.receiptId)!
    data = { ...data, revision: 3 }
    await expect(intake.commit(stale.token!)).rejects.toThrow('revision changed')
    expect(mutations).toHaveLength(1)

    const conflict = (await intake.discover()).find((item) => item.receiptId === preview.receiptId)!
    data.runs.push({ id: conflict.run!.id, sliceId: 'S13', runType: 'Other', role: 'Critic' })
    await expect(intake.commit(conflict.token!)).rejects.toThrow('already exists')
    expect(mutations).toHaveLength(1)
  })

  it('blocks review when the matching telemetry Slice is missing', async () => {
    const store = {
      load: async () => ({ data: emptyDataset(), path: '/synthetic/data' })
    } as ProductionStore
    const intake = new CodexIntake(resolve('.'), store, reporter, '/synthetic/codex', {
      receiptDirectory: resolve('tests/fixtures/codex-receipts'),
      rolloutFiles: [file],
      sourceRepositoryRoot: '/synthetic'
    })
    const candidate = (await intake.discover()).find(
      (item) => item.receiptId === 'pr1_20260919T120000000Z_11111111111111111111111111111111'
    )!
    expect(candidate.status).toBe('blocked')
    expect(candidate.reason).toContain('Dataset Slice')
    expect(candidate.token).toBeUndefined()
  })

  it('shows invalid and foreign receipts as rejected and preserves optional candidate metadata', async () => {
    const data = { ...emptyDataset(), slices: [{ id: 'S13', title: 'Intake' }] }
    const store = { load: async () => ({ data, path: '/synthetic/data' }) } as ProductionStore
    const intake = new CodexIntake(resolve('.'), store, reporter, '/synthetic/codex', {
      receiptDirectory: resolve('tests/fixtures/codex-receipts'),
      rolloutFiles: [file],
      sourceRepositoryRoot: '/synthetic'
    })
    const candidates = await intake.discover()
    expect(candidates.filter((item) => item.status === 'rejected')).toHaveLength(2)
    expect(candidates.find((item) => item.receiptId.includes('222222'))?.reason).toContain(
      'another project'
    )
    expect(candidates.find((item) => item.receiptId.includes('333333'))?.status).toBe('rejected')
    const optional = candidates.find((item) => item.receiptId.includes('444444'))
    expect(optional?.report?.candidate).toBe('review-sha')
    expect(optional?.status).toBe('blocked')
  })
})

describe('S13 accepted repair regressions', () => {
  it.each(['rewrite-and-append', 'same-size-rewrite'])(
    'rejects a %s during commit revalidation',
    async (change) => {
      await inTemp(async (dir) => {
        const receiptDirectory = join(dir, 'receipts')
        await mkdir(receiptDirectory)
        await writeFile(join(receiptDirectory, `${receiptId}.json`), receipt(receiptId).text)
        const rollout = join(dir, 'rollout-test.jsonl')
        const original = lines((await fixtureRecords()).slice(0, 10))
        await writeFile(rollout, original)
        const stableTime = new Date('2024-01-01T00:00:00.000Z')
        utimesSync(rollout, stableTime, stableTime)
        let armed = false
        let writes = 0
        const checkingReporter = {
          ...reporter,
          matchTerminalBlockToReceipt(message: string, receiptText: string) {
            const matched = reporter.matchTerminalBlockToReceipt(message, receiptText)
            if (armed) {
              armed = false
              const before = statSync(rollout)
              const rewritten = original.replace('gpt-6-astra', 'gpt-6-terra')
              expect(rewritten).not.toBe(original)
              expect(rewritten.length).toBe(original.length)
              writeFileSync(
                rollout,
                change === 'rewrite-and-append' ? rewritten + lines([started('later')]) : rewritten
              )
              if (change === 'same-size-rewrite') utimesSync(rollout, before.atime, before.mtime)
            }
            return matched
          }
        }
        const store = {
          load: async () => ({
            data: { ...emptyDataset(), slices: [{ id: 'S13', title: 'Intake' }] },
            path: dir
          }),
          mutate: async () => {
            writes++
            return { data: emptyDataset(), path: dir }
          }
        } as unknown as ProductionStore
        const intake = new CodexIntake(resolve('.'), store, checkingReporter, dir, {
          receiptDirectory,
          rolloutFiles: [rollout],
          sourceRepositoryRoot: '/synthetic'
        })
        const candidate = (await intake.discover()).find((item) => item.receiptId === receiptId)!
        expect(candidate.status).toBe('ready')
        armed = true
        await expect(intake.commit(candidate.token!)).rejects.toThrow('closure evidence changed')
        expect(writes).toBe(0)
      })
    }
  )

  it('binds preview to closure bytes and file identity while allowing a later append', async () => {
    await inTemp(async (dir) => {
      const receiptDirectory = join(dir, 'receipts')
      await mkdir(receiptDirectory)
      const valid = receipt(receiptId)
      await writeFile(join(receiptDirectory, `${receiptId}.json`), valid.text)
      const rollout = join(dir, 'rollout-test.jsonl')
      const original = await readFile(file, 'utf8')
      const records = await fixtureRecords()
      const throughClosure = lines(records.slice(0, 10))
      let writes = 0
      const store = {
        load: async () => ({
          data: { ...emptyDataset(), slices: [{ id: 'S13', title: 'Intake' }] },
          path: '/synthetic/data'
        }),
        mutate: async () => {
          writes++
          return { data: emptyDataset(), path: '/synthetic/data' }
        }
      } as unknown as ProductionStore
      const intake = new CodexIntake(resolve('.'), store, reporter, dir, {
        receiptDirectory,
        rolloutFiles: [rollout],
        sourceRepositoryRoot: '/synthetic'
      })
      const preview = async (): Promise<string> => {
        const candidate = (await intake.discover()).find((item) => item.receiptId === receiptId)!
        expect(candidate.status).toBe('ready')
        return candidate.token!
      }

      await writeFile(rollout, throughClosure)
      await intake.commit(await preview())
      expect(writes).toBe(1)

      await writeFile(rollout, throughClosure)
      const appendToken = await preview()
      await writeFile(rollout, original)
      await intake.commit(appendToken)
      expect(writes).toBe(2)

      await writeFile(rollout, throughClosure)
      const changedByteToken = await preview()
      await writeFile(
        rollout,
        throughClosure.replace('Completed.\\nPENNYOS', 'Finished.\\nPENNYOS') +
          lines(records.slice(10))
      )
      await expect(intake.commit(changedByteToken)).rejects.toThrow('closure evidence changed')
      await expect(intake.commit(changedByteToken)).rejects.toThrow('Discover and review')

      await writeFile(rollout, throughClosure)
      const changedModelToken = await preview()
      await writeFile(rollout, throughClosure.replace('gpt-6-astra', 'gpt-6-terra'))
      await expect(intake.commit(changedModelToken)).rejects.toThrow('closure evidence changed')

      await writeFile(rollout, throughClosure)
      const changedModelAndTurnToken = await preview()
      await writeFile(
        rollout,
        throughClosure.replace('gpt-6-astra', 'gpt-6-terra').replace('turn-1', 'turn-x') +
          lines(records.slice(10))
      )
      await expect(intake.commit(changedModelAndTurnToken)).rejects.toThrow()

      await writeFile(rollout, throughClosure)
      const changedTurnToken = await preview()
      await writeFile(rollout, throughClosure.replaceAll('turn-1', 'turn-x'))
      await expect(intake.commit(changedTurnToken)).rejects.toThrow('closure evidence changed')

      await writeFile(rollout, throughClosure)
      const replacedToken = await preview()
      await rename(rollout, `${rollout}.old`)
      await writeFile(rollout, throughClosure)
      await expect(intake.commit(replacedToken)).rejects.toThrow('closure evidence changed')
      expect(writes).toBe(2)
    })
  })

  it('requires adjacent cumulative boundaries and consistent latest-request evidence', async () => {
    const fixture = await fixtureRecords()
    const meta = fixture[0]
    const final = fixture[8]
    const a = counters(100, 20, 10, 2)
    const b = counters(140, 30, 15, 3)
    const c = counters(180, 40, 20, 4)
    const first = await scanRecords([
      meta,
      started('first'),
      token(a, a),
      final,
      completed('first')
    ])
    expect(first).toMatchObject({ inputTokens: 80, cachedInputTokens: 20, outputTokens: 10 })
    expect(first?.executionEvidence?.modelInvocationCount).toBe(1)

    const adjacent = await scanRecords([
      meta,
      started('a'),
      token(a, a),
      completed('a'),
      started('c'),
      token(c, counters(80, 20, 10, 2)),
      final,
      completed('c')
    ])
    expect(adjacent).toMatchObject({ inputTokens: 60, cachedInputTokens: 20, outputTokens: 10 })

    const gap = await scanRecords([
      meta,
      started('a'),
      token(a, a),
      completed('a'),
      started('b'),
      completed('b'),
      started('c'),
      token(c, counters(80, 20, 10, 2)),
      final,
      completed('c')
    ])
    expect(gap?.inputTokens).toBeUndefined()
    expect(gap?.executionEvidence?.modelInvocationCount).toBeUndefined()

    const resumed = await scanRecords([
      meta,
      token(a, a),
      started('resumed'),
      token(b, counters(40, 10, 5, 1)),
      final,
      completed('resumed')
    ])
    expect(resumed).toMatchObject({ inputTokens: 30, cachedInputTokens: 10, outputTokens: 5 })

    const noBoundary = await scanRecords([
      meta,
      started('prior'),
      completed('prior'),
      started('resumed'),
      token(b, counters(40, 10, 5, 1)),
      final,
      completed('resumed')
    ])
    expect(noBoundary?.inputTokens).toBeUndefined()

    const stale = await scanRecords([
      meta,
      started('first'),
      token(a, a),
      token(a, a),
      final,
      completed('first')
    ])
    expect(stale?.executionEvidence?.modelInvocationCount).toBe(1)

    const zero = counters(0, 0, 0, 0)
    const measuredZero = await scanRecords([
      meta,
      started('first'),
      token(zero),
      final,
      completed('first')
    ])
    expect(measuredZero).toMatchObject({ inputTokens: 0, outputTokens: 0 })
    expect(measuredZero?.executionEvidence?.modelInvocationCount).toBe(0)
    const absent = await scanRecords([meta, started('first'), final, completed('first')])
    expect(absent?.inputTokens).toBeUndefined()
    expect(absent?.executionEvidence?.modelInvocationCount).toBeUndefined()

    const reset = await scanRecords([
      meta,
      started('first'),
      token(a, a),
      token(zero, zero),
      final,
      completed('first')
    ])
    expect(reset?.inputTokens).toBeUndefined()
    const contradictory = await scanRecords([
      meta,
      started('first'),
      token(a, counters(999, 0, 0, 0), 100),
      final,
      completed('first')
    ])
    expect(contradictory?.executionEvidence?.peakInvocation).toBeUndefined()
    expect(contradictory?.executionEvidence?.modelInvocationCount).toBeUndefined()
    expect(contradictory?.inputTokens).toBe(80)
    expect(first?.executionEvidence?.peakInvocation).toMatchObject({
      inputTokens: 100,
      cachedInputTokens: 20
    })
  })

  it('validates the complete assistant message and ignores copied user/tool reports', async () => {
    const fixture = await fixtureRecords()
    const meta = fixture[0]
    const report = (fixture[8].payload.content as { text: string }[])[0].text
    const message = (parts: string[], role = 'assistant'): RolloutRecord => ({
      type: 'response_item',
      payload: {
        type: 'message',
        role,
        phase: 'final_answer',
        content: parts.map((text) => ({ type: 'output_text', text }))
      }
    })
    const scan = (messages: RolloutRecord[]): Promise<Run | undefined> =>
      scanRecords([meta, started('one'), ...messages, completed('one')])
    expect(
      await scan([message(['Prose.\n', report.slice(report.indexOf('PENNYOS_'))])])
    ).toBeDefined()
    expect(await scan([message([report, '   \n'])])).toBeDefined()
    expect(await scan([message([report])])).toBeDefined()
    expect(await scan([message([report, 'Later prose'])])).toBeUndefined()
    expect(await scan([message([report.slice(0, -8), 'broken'])])).toBeUndefined()
    expect(await scan([message([report], 'user')])).toBeUndefined()
    expect(
      await scan([
        { type: 'response_item', payload: { type: 'function_call_output', output: report } }
      ])
    ).toBeUndefined()
    await expect(scan([message([report]), message([report])])).rejects.toThrow(
      'contradictory terminal'
    )
  })

  it('isolates unrelated and later rollout failures while blocking a second closure', async () => {
    await inTemp(async (dir) => {
      const receiptDirectory = join(dir, 'receipts')
      await mkdir(receiptDirectory)
      const valid = receipt(receiptId)
      const otherId = 'pr1_20260919T120000004Z_44444444444444444444444444444444'
      const other = receipt(otherId)
      await writeFile(join(receiptDirectory, `${receiptId}.json`), valid.text)
      await writeFile(join(receiptDirectory, `${otherId}.json`), other.text)
      const fixture = await fixtureRecords()
      const good = join(dir, 'rollout-good.jsonl')
      const foreign = join(dir, 'rollout-foreign.jsonl')
      const malformed = join(dir, 'rollout-malformed.jsonl')
      await writeFile(good, lines(fixture.slice(0, 10)))
      await writeFile(
        foreign,
        lines([
          { ...fixture[0], payload: { ...fixture[0].payload, cwd: '/foreign' } },
          started('x')
        ])
      )
      await writeFile(malformed, lines([fixture[0]]) + '{broken json\n')
      let writes = 0
      const store = {
        load: async () => ({
          data: { ...emptyDataset(), slices: [{ id: 'S13', title: 'Intake' }] },
          path: dir
        }),
        mutate: async () => {
          writes++
          return { data: emptyDataset(), path: dir }
        }
      } as unknown as ProductionStore
      const intake = new CodexIntake(resolve('.'), store, reporter, dir, {
        receiptDirectory,
        rolloutFiles: [good, foreign, malformed],
        sourceRepositoryRoot: '/synthetic'
      })
      const status = async (id: string): Promise<CodexIntakeCandidate> =>
        (await intake.discover()).find((item) => item.receiptId === id)!
      const ready = await status(receiptId)
      expect(ready.status).toBe('blocked')
      expect(ready.reason).toContain('incomplete')
      await writeFile(malformed, lines([fixture[0], started('unrelated'), completed('unrelated')]))
      expect((await status(otherId)).status).toBe('blocked')
      const commitReady = await status(receiptId)
      await intake.commit(commitReady.token!)
      expect(writes).toBe(1)
      await writeFile(
        good,
        lines([
          ...fixture.slice(0, 10),
          started('later'),
          { ...fixture[3], payload: { ...fixture[3].payload, turn_id: 'later', cwd: '/foreign' } }
        ])
      )
      expect((await status(receiptId)).status).toBe('ready')
      await writeFile(
        good,
        lines([
          ...fixture.slice(0, 10),
          started('later'),
          { ...fixture[3], payload: { ...fixture[3].payload, turn_id: 'later', cwd: '/foreign' } },
          completed('later'),
          started('again'),
          fixture[8],
          completed('again')
        ])
      )
      expect((await status(receiptId)).reason).toContain('Multiple terminal closures')
      await writeFile(
        good,
        lines([...fixture.slice(0, 10), started('again'), fixture[8], completed('again')])
      )
      expect((await status(receiptId)).reason).toContain('Multiple terminal closures')
      await writeFile(good, lines(fixture.slice(0, 9)) + '{broken json\n' + lines([fixture[9]]))
      expect((await status(receiptId)).status).toBe('blocked')
      expect((await status(otherId)).status).toBe('blocked')

      // Unparseable bytes cannot prove uniqueness even for another receipt.
      await writeFile(foreign, lines(fixture.slice(0, 10)).replaceAll(receiptId, otherId))
      const isolated = await status(otherId)
      expect(isolated.status).toBe('blocked')
      expect((await status(receiptId)).status).toBe('blocked')
    })
  })
})

const otherReceiptId = 'pr1_20260919T120000004Z_44444444444444444444444444444444'
interface AuthorityHarness {
  intake: CodexIntake
  discover: (id?: string) => Promise<CodexIntakeCandidate>
  original: string
  rollout: string
  closure: (id?: string, turn?: string) => string
  receiptDirectory: string
  writes: Mutation[]
  sources: { receiptDirectory: string; rolloutFiles: string[]; sourceRepositoryRoot: string }
  home: string
  alterData: (update: (data: Dataset) => Dataset) => void
}
async function authorityHarness(
  dir: string,
  options: {
    protocol?: ReturnType<typeof installedReporter>
    onPublish?: () => void
    realInventory?: boolean
    missingSlice?: boolean
    now?: () => number
  } = {}
): Promise<AuthorityHarness> {
  const receiptDirectory = join(dir, '.pennyos', 'runtime', 'receipts')
  await mkdir(receiptDirectory, { recursive: true })
  await mkdir(join(dir, 'pennyos', 'slices'), { recursive: true })
  await writeFile(
    join(dir, 'pennyos', 'project.json'),
    JSON.stringify({ projectId: 'pennytel', project: 'PennyTel' })
  )
  await writeFile(
    join(dir, 'pennyos', 'slices', 'S13.json'),
    JSON.stringify({ sliceId: 'S13', title: 'Tracked title' })
  )
  execFileSync('git', ['init', '-q', dir])
  execFileSync('git', ['-C', dir, 'add', '--', 'pennyos/project.json', 'pennyos/slices/S13.json'])
  await writeFile(join(receiptDirectory, `${receiptId}.json`), receipt(receiptId).text)
  const home = join(dir, 'codex')
  await mkdir(join(home, 'sessions'), { recursive: true })
  const rollout = join(home, 'sessions', 'rollout-2026-09-19T12-00-00-source.jsonl')
  const fixture = await fixtureRecords()
  const original = lines(fixture.slice(0, 10)).replaceAll('/synthetic', dir)
  const closure = (id = receiptId, turn = 'later'): string =>
    lines([
      started(turn),
      JSON.parse(JSON.stringify(fixture[8]).replaceAll(receiptId, id)),
      completed(turn)
    ])
  await writeFile(rollout, original)
  let data: Dataset = options.missingSlice
    ? emptyDataset()
    : { ...emptyDataset(), slices: [{ id: 'S13', title: 'Intake' }] }
  const writes: Mutation[] = []
  const store = {
    load: async () => ({ data: structuredClone(data), path: dir }),
    mutate: async (command: Mutation) => {
      options.onPublish?.()
      expect(command).toMatchObject({ kind: 'save', revision: data.revision })
      if (command.kind !== 'save') throw new Error('Unexpected mutation')
      writes.push(command)
      if (command.table === 'slices') {
        if (data.slices.some((slice) => slice.id === command.record.id)) throw new Error('Conflict')
        data = {
          ...data,
          revision: data.revision + 1,
          slices: [...data.slices, structuredClone(command.record as Dataset['slices'][number])]
        }
      } else if (command.table === 'runs')
        data = {
          ...data,
          revision: data.revision + 1,
          runs: [...data.runs, structuredClone(command.record as Run)]
        }
      else throw new Error('Unexpected table')
      return { data: structuredClone(data), path: dir }
    }
  } as unknown as ProductionStore
  const sources = { receiptDirectory, rolloutFiles: [rollout], sourceRepositoryRoot: dir }
  const intake = new CodexIntake(
    dir,
    store,
    options.protocol ?? reporter,
    home,
    options.realInventory ? undefined : sources,
    options.now ?? (() => Date.parse('2026-09-19T13:00:00.000Z'))
  )
  const discover = async (id = receiptId): Promise<CodexIntakeCandidate> =>
    (await intake.discover()).find((candidate) => candidate.receiptId === id)!
  return {
    intake,
    discover,
    original,
    rollout,
    closure,
    receiptDirectory,
    writes,
    sources,
    home,
    alterData: (update) => {
      data = update(data)
    }
  }
}

afterEach(() => vi.restoreAllMocks())

describe('S15 selected authority window', () => {
  it('excludes an older duplicate, requires rediscovery on selection change, and binds commit to the reviewed cutoff', async () => {
    await inTemp(async (dir) => {
      let now = Date.parse('2026-09-19T13:00:00.000Z')
      const h = await authorityHarness(dir, { realInventory: true, now: () => now })
      const archived = join(h.home, 'archived_sessions')
      await mkdir(archived)
      await writeFile(join(archived, 'rollout-2026-09-16T12-00-00-duplicate.jsonl'), h.original)
      const oneDay = await h.intake.discover(1)
      const reviewed = oneDay.find((candidate) => candidate.receiptId === receiptId)!
      expect(reviewed.status).toBe('ready')
      const fiveDay = (await h.intake.discover(5)).find(
        (candidate) => candidate.receiptId === receiptId
      )!
      expect(fiveDay.status).toBe('blocked')
      expect(fiveDay.reason).toContain('Multiple terminal closures')
      await expect(h.intake.commit(reviewed.token!)).rejects.toThrow('Discover and review')
      const fresh = (await h.intake.discover(1)).find(
        (candidate) => candidate.receiptId === receiptId
      )!
      expect(fresh.status).toBe('ready')
      // A new current-time cutoff would exclude the reviewed active source.
      now += 2 * 86_400_000
      const saved = await h.intake.commit(fresh.token!)
      expect(saved.data.runs).toEqual([fresh.run])
      expect(h.writes).toHaveLength(1)
    })
  })

  it('rejects arbitrary discovery duration before creating review authority', async () => {
    await inTemp(async (dir) => {
      const h = await authorityHarness(dir)
      await expect(h.intake.discover(2 as 1)).rejects.toThrow('Invalid Codex discovery window')
      expect(h.writes).toHaveLength(0)
    })
  })
})

describe('S13 sealed authority observation regression matrix', () => {
  it.each([
    ['pennyos/project.json', false],
    ['pennyos/project.json', true],
    ['pennyos/slices/S13.json', false],
    ['pennyos/slices/S13.json', true]
  ] as const)(
    'blocks creation from untracked identity %s (ignored: %s), including stale previews',
    async (path, ignored) => {
      await inTemp(async (dir) => {
        const h = await authorityHarness(dir, { missingSlice: true })
        const preview = await h.discover()
        expect(preview.createSlice).toBeDefined()
        // Only the disposable fixture's index changes; the lookalike file stays present.
        execFileSync('git', ['-C', dir, 'rm', '--cached', '--', path])
        if (ignored) await writeFile(join(dir, '.gitignore'), `${path}\n`)
        expect(execFileSync('git', ['-C', dir, 'ls-files', '--', path], { encoding: 'utf8' })).toBe(
          ''
        )
        await expect(h.intake.createSlice(preview.createSlice!.token)).rejects.toThrow(
          'identity changed'
        )
        const blocked = await h.discover()
        expect(blocked.status).toBe('blocked')
        expect(blocked.reason).toContain('must be Git-tracked')
        expect(blocked.reason).toContain('manually')
        expect(blocked.createSlice).toBeUndefined()
        expect(blocked.token).toBeUndefined()
        expect(h.writes).toEqual([])
      })
    }
  )
  it('fails closed when the identity directory is not a Git repository', async () => {
    await inTemp(async (dir) => {
      const h = await authorityHarness(dir, { missingSlice: true })
      await rename(join(dir, '.git'), join(dir, 'saved-git'))
      const blocked = await h.discover()
      expect(blocked.reason).toContain('Tracking could not be verified')
      expect(blocked.createSlice).toBeUndefined()
      expect(h.writes).toEqual([])
    })
  })
  it('offers only tracked Slice semantics, creates once, then requires rediscovery before Run import', async () => {
    await inTemp(async (dir) => {
      const h = await authorityHarness(dir, { missingSlice: true })
      const blocked = await h.discover()
      expect(blocked.status).toBe('blocked')
      expect(blocked.createSlice?.slice).toEqual({
        id: 'S13',
        title: 'Tracked title',
        project: 'PennyTel'
      })
      expect(blocked.token).toBeUndefined()
      const saved = await h.intake.createSlice(blocked.createSlice!.token)
      expect(saved.data.slices).toEqual([
        { id: 'S13', title: 'Tracked title', project: 'PennyTel' }
      ])
      expect(saved.data.runs).toHaveLength(0)
      expect(h.writes).toHaveLength(1)
      expect(h.writes[0]).toMatchObject({ kind: 'save', table: 'slices', revision: 0 })
      await expect(h.intake.createSlice(blocked.createSlice!.token)).rejects.toThrow(
        'Discover and review'
      )
      const ready = await h.discover()
      expect(ready.status).toBe('ready')
      await h.intake.commit(ready.token!)
      expect(h.writes).toHaveLength(2)
      expect(h.writes[1]).toMatchObject({ kind: 'save', table: 'runs', revision: 1 })
    })
  })
  it('blocks stale, conflicting, and invalid tracked Slice proposals', async () => {
    await inTemp(async (dir) => {
      const h = await authorityHarness(dir, { missingSlice: true })
      const first = await h.discover()
      await writeFile(
        join(dir, 'pennyos', 'slices', 'S13.json'),
        JSON.stringify({ sliceId: 'S13', title: 'Changed' })
      )
      await expect(h.intake.createSlice(first.createSlice!.token)).rejects.toThrow(
        'identity changed'
      )
      await writeFile(
        join(dir, 'pennyos', 'slices', 'S13.json'),
        JSON.stringify({ sliceId: 'S13' })
      )
      expect((await h.discover()).createSlice).toBeUndefined()
      await writeFile(
        join(dir, 'pennyos', 'slices', 'S13.json'),
        JSON.stringify({ sliceId: 'S13', title: 'Tracked title' })
      )
      const fresh = await h.discover()
      h.alterData((data) => ({ ...data, revision: data.revision + 1 }))
      await expect(h.intake.createSlice(fresh.createSlice!.token)).rejects.toThrow(
        'revision changed'
      )
      const conflicting = await h.discover()
      h.alterData((data) => ({ ...data, slices: [{ id: 'S13', title: 'Existing' }] }))
      await expect(h.intake.createSlice(conflicting.createSlice!.token)).rejects.toThrow(
        'already exists'
      )
      expect(h.writes).toHaveLength(0)
    })
  })
  it.each(['parse', 'verification'])(
    'blocks duplicate growth during %s, consumes token, and publishes nothing',
    async (phase) => {
      await inTemp(async (dir) => {
        let append: (() => void) | undefined
        const protocol = {
          ...reporter,
          matchTerminalBlockToReceipt(message: string, text: string) {
            const result = reporter.matchTerminalBlockToReceipt(message, text)
            append?.()
            return result
          }
        }
        const h = await authorityHarness(dir, { protocol })
        const preview = await h.discover()
        expect(preview.status).toBe('ready')
        const grow = (): void => {
          appendFileSync(h.rollout, h.closure())
          append = undefined
        }
        if (phase === 'parse') append = grow
        else {
          const originalOpen = fs.open
          vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
            const handle = await originalOpen(...args)
            if (args[0] === h.rollout) {
              const read = handle.read.bind(handle)
              let reads = 0
              handle.read = (async (...params: Parameters<typeof read>) => {
                if (++reads === 2) grow()
                return read(...params)
              }) as typeof handle.read
            }
            return handle
          })
        }
        await expect(h.intake.commit(preview.token!)).rejects.toThrow('changed during capture')
        expect(h.writes).toHaveLength(0)
        await expect(h.intake.commit(preview.token!)).rejects.toThrow('Discover and review')
        vi.restoreAllMocks()
        expect((await h.discover()).reason).toContain('Multiple terminal closures')
      })
    }
  )

  it('rejects an existing suffix rewritten into a duplicate during capture', async () => {
    await inTemp(async (dir) => {
      let rewrite: (() => void) | undefined
      const protocol = {
        ...reporter,
        matchTerminalBlockToReceipt(message: string, text: string) {
          const result = reporter.matchTerminalBlockToReceipt(message, text)
          rewrite?.()
          return result
        }
      }
      const h = await authorityHarness(dir, { protocol })
      const safe = lines([started('later'), completed('later')])
      await writeFile(h.rollout, h.original + safe)
      const preview = await h.discover()
      rewrite = () => {
        writeFileSync(h.rollout, h.original + h.closure())
        rewrite = undefined
      }
      await expect(h.intake.commit(preview.token!)).rejects.toThrow('changed during capture')
      expect(h.writes).toHaveLength(0)
    })
  })

  it('accepts later writes after the sealed cutoff while preserving the exact reviewed Run', async () => {
    await inTemp(async (dir) => {
      const h = await authorityHarness(dir, { onPublish: () => afterCutoff?.() })
      const preview = await h.discover()
      const afterCutoff = (): void => appendFileSync(h.rollout, h.closure())
      const saved = await h.intake.commit(preview.token!)
      expect(saved.data.revision).toBe(1)
      expect(saved.data.runs).toEqual([preview.run])
      expect(h.writes).toHaveLength(1)
      const observed = await scanFile(
        h.rollout,
        new Map([[receiptId, receipt(receiptId)]]),
        dir,
        reporter,
        { bytes: 0, lines: 0 }
      )
      expect(observed.authority[receiptId].cardinality).toBe('multiple')
      expect((await h.discover()).status).toBe('already imported')
    })
  })

  it.each([false, true])(
    'accumulates A/B conflicts in either duplicate order (reverse=%s)',
    async (reverse) => {
      await inTemp(async (dir) => {
        const h = await authorityHarness(dir)
        await writeFile(
          join(h.receiptDirectory, `${otherReceiptId}.json`),
          receipt(otherReceiptId).text
        )
        const duplicates = reverse ? [otherReceiptId, receiptId] : [receiptId, otherReceiptId]
        await writeFile(
          h.rollout,
          h.original +
            h.closure(otherReceiptId, 'b') +
            duplicates.map((id, i) => h.closure(id, `duplicate-${i}`)).join('') +
            lines([started('bad'), event('task_complete', { turn_id: 'wrong' })])
        )
        for (const id of [receiptId, otherReceiptId]) {
          const candidate = await h.discover(id)
          expect(candidate.status).toBe('blocked')
          expect(candidate.reason).toContain('Multiple terminal closures')
          expect(candidate.token).toBeUndefined()
        }
        expect(h.writes).toHaveLength(0)
      })
    }
  )

  it('retains the first measurement and detects duplicates beyond malformed later activity', async () => {
    await inTemp(async (dir) => {
      const h = await authorityHarness(dir)
      const preview = await h.discover()
      await writeFile(
        h.rollout,
        h.original + lines([started('broken')]) + '{bad json\n' + h.closure()
      )
      const observed = await scanFile(
        h.rollout,
        new Map([[receiptId, receipt(receiptId)]]),
        dir,
        reporter,
        { bytes: 0, lines: 0 }
      )
      expect(observed.authority[receiptId].cardinality).toBe('multiple')
      expect(observed.authority[receiptId].first?.run).toEqual(preview.run)
      expect(observed.uncertainties).not.toHaveLength(0)
      expect((await h.discover()).reason).toContain('Multiple terminal closures')
      await expect(h.intake.commit(preview.token!)).rejects.toThrow('Discover and review')
    })
  })

  it('evaluates A identically alone or alongside B and freezes all observation fields', async () => {
    await inTemp(async (dir) => {
      const h = await authorityHarness(dir)
      await writeFile(
        h.rollout,
        h.original + h.closure(otherReceiptId, 'b') + h.closure(otherReceiptId, 'duplicate-b')
      )
      const one = await scanFile(
        h.rollout,
        new Map([[receiptId, receipt(receiptId)]]),
        dir,
        reporter,
        { bytes: 0, lines: 0 }
      )
      const both = await scanFile(
        h.rollout,
        new Map([receiptId, otherReceiptId].map((id) => [id, receipt(id)])),
        dir,
        reporter,
        { bytes: 0, lines: 0 }
      )
      expect(one.authority[receiptId]).toEqual(both.authority[receiptId])
      const dataset = { ...emptyDataset(), slices: [{ id: 'S13', title: 'Intake' }] }
      expect(eligibility({ ...one, coverage: 'complete' }, receipt(receiptId), dataset)).toEqual(
        eligibility({ ...both, coverage: 'complete' }, receipt(receiptId), dataset)
      )
      expect(both.authority[otherReceiptId].cardinality).toBe('multiple')
      expect(Object.isFrozen(one)).toBe(true)
      expect(Object.isFrozen(one.authority[receiptId].first?.run.executionEvidence)).toBe(true)
      expect(one.inspectedBytes).toBe(Buffer.byteLength(await readFile(h.rollout)))
      expect(one.digest).toBe(
        createHash('sha256')
          .update(await readFile(h.rollout))
          .digest('hex')
      )
    })
  })

  it('does not let another requested receipt change measured cumulative boundaries', async () => {
    await inTemp(async (dir) => {
      const h = await authorityHarness(dir)
      const fixture = await fixtureRecords()
      const a = counters(100, 20, 10, 2)
      const b = counters(150, 30, 20, 4)
      const otherFinal = JSON.parse(
        JSON.stringify(fixture[8]).replaceAll(receiptId, otherReceiptId)
      )
      await writeFile(
        h.rollout,
        lines([
          { ...fixture[0], payload: { ...fixture[0].payload, cwd: dir } },
          started('other'),
          token(a, a),
          otherFinal,
          completed('other'),
          started('target'),
          token(b, counters(50, 10, 10, 2)),
          fixture[8],
          completed('target')
        ])
      )
      const alone = await scanFile(
        h.rollout,
        new Map([[receiptId, receipt(receiptId)]]),
        dir,
        reporter,
        { bytes: 0, lines: 0 }
      )
      const together = await scanFile(
        h.rollout,
        new Map([
          [receiptId, receipt(receiptId)],
          [otherReceiptId, receipt(otherReceiptId, 1)]
        ]),
        dir,
        reporter,
        { bytes: 0, lines: 0 }
      )
      expect(together.authority[otherReceiptId].uncertainties).not.toHaveLength(0)
      expect(together.authority[receiptId]).toEqual(alone.authority[receiptId])
      expect(together.authority[receiptId].first?.run.inputTokens).toBe(40)
    })
  })

  it('rejects a receipt rewritten during source capture', async () => {
    await inTemp(async (dir) => {
      let rewrite: (() => void) | undefined
      const protocol = {
        ...reporter,
        matchTerminalBlockToReceipt(message: string, text: string) {
          const result = reporter.matchTerminalBlockToReceipt(message, text)
          rewrite?.()
          return result
        }
      }
      const h = await authorityHarness(dir, { protocol })
      const preview = await h.discover()
      rewrite = () => {
        writeFileSync(join(h.receiptDirectory, `${receiptId}.json`), receipt(receiptId, 1).text)
        rewrite = undefined
      }
      await expect(h.intake.commit(preview.token!)).rejects.toThrow(
        'Receipt changed during capture'
      )
      expect(h.writes).toHaveLength(0)
    })
  })

  it.each(['before', 'during'])(
    'blocks another-file duplicate introduced %s capture',
    async (when) => {
      await inTemp(async (dir) => {
        let introduce: (() => void) | undefined
        const protocol = {
          ...reporter,
          matchTerminalBlockToReceipt(message: string, text: string) {
            const result = reporter.matchTerminalBlockToReceipt(message, text)
            introduce?.()
            return result
          }
        }
        const h = await authorityHarness(dir, { protocol, realInventory: true })
        const preview = await h.discover()
        const create = (): void => {
          writeFileSync(
            join(h.home, 'sessions', 'rollout-2026-09-19T12-00-01-new.jsonl'),
            h.original
          )
          introduce = undefined
        }
        if (when === 'before') create()
        else introduce = create
        await expect(h.intake.commit(preview.token!)).rejects.toThrow(
          when === 'before' ? 'Multiple terminal closures' : 'inventory changed'
        )
        expect(h.writes).toHaveLength(0)
      })
    }
  )

  it.each(['receipt', 'truncation', 'symlink', 'incomplete-tail'])(
    'fails closed for %s before commit',
    async (change) => {
      await inTemp(async (dir) => {
        const h = await authorityHarness(dir)
        const preview = await h.discover()
        if (change === 'receipt')
          await writeFile(join(h.receiptDirectory, `${receiptId}.json`), receipt(receiptId, 1).text)
        if (change === 'truncation') await truncate(h.rollout, 100)
        if (change === 'symlink') {
          await rename(h.rollout, `${h.rollout}.old`)
          await symlink(`${h.rollout}.old`, h.rollout)
        }
        if (change === 'incomplete-tail') appendFileSync(h.rollout, '{broken json')
        await expect(h.intake.commit(preview.token!)).rejects.toThrow()
        expect(h.writes).toHaveLength(0)
      })
    }
  )

  it('enforces byte, line, record and file limits without retrying into false uniqueness', async () => {
    await inTemp(async (dir) => {
      const h = await authorityHarness(dir)
      const receipts = new Map([[receiptId, receipt(receiptId)]])
      const length = Buffer.byteLength(h.original)
      const budget = { bytes: 128_000_000 - length, lines: 0 }
      await expect(scanFile(h.rollout, receipts, dir, reporter, budget)).rejects.toThrow('128 MB')
      expect(budget.bytes).toBe(128_000_000)
      await writeFile(h.rollout, h.original + '\n'.repeat(100_001))
      await expect(
        scanFile(h.rollout, receipts, dir, reporter, { bytes: 0, lines: 0 })
      ).rejects.toThrow('record limit')
      await writeFile(h.rollout, h.original + 'x'.repeat(256_001))
      expect((await h.discover()).reason).toContain('256 KB')
      await truncate(h.rollout, 32_000_001)
      expect((await h.discover()).reason).toContain('32 MB')
      h.sources.rolloutFiles = Array.from({ length: 201 }, () => h.rollout)
      expect((await h.discover()).reason).toContain('file count')
      expect(h.writes).toHaveLength(0)
    })
  })

  it('keeps arbitrary transcript data out of review, publication and diagnostics', async () => {
    await inTemp(async (dir) => {
      const h = await authorityHarness(dir)
      const secret = 'PRIVATE_PROMPT_REASONING_TOOL_IMAGE_SENTINEL'
      await writeFile(
        h.rollout,
        h.original +
          lines([
            {
              type: 'response_item',
              payload: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: secret }]
              }
            },
            { type: 'response_item', payload: { type: 'reasoning', encrypted_content: secret } },
            { type: 'response_item', payload: { type: 'function_call_output', output: secret } }
          ])
      )
      const preview = await h.discover()
      expect(preview.status).toBe('ready')
      expect(JSON.stringify(preview)).not.toContain(secret)
      const saved = await h.intake.commit(preview.token!)
      expect(JSON.stringify(saved)).not.toContain(secret)
      expect(JSON.stringify(h.writes)).not.toContain('PENNYOS_TURN_REPORT_V1')
      appendFileSync(h.rollout, '{' + secret)
      const blocked = await scanFile(
        h.rollout,
        new Map([[receiptId, receipt(receiptId)]]),
        dir,
        reporter,
        { bytes: 0, lines: 0 }
      )
      expect(JSON.stringify(blocked.uncertainties)).not.toContain(secret)
    })
  })
})
