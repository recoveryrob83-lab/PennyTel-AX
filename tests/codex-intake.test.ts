import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { statSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  CodexIntake,
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
    return matches[0]?.run
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
    expect(matches).toHaveLength(1)
    const run = matches[0].run
    expect(run.id).toBe(`codex_${valid.report.receiptId}`)
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
    ).toEqual([])
  })

  it('rejects a terminal block whose receipt content was altered under the same identity', async () => {
    const altered = receipt('pr1_20260919T120000000Z_11111111111111111111111111111111', 1)
    await expect(
      scanFile(file, new Map([[altered.report.receiptId, altered]]), '/synthetic', reporter, {
        bytes: 0,
        lines: 0
      })
    ).rejects.toThrow('does not match receipt')
  })

  it('fails closed on incompatible working directories and nonregular sources', async () => {
    const valid = receipt('pr1_20260919T120000000Z_11111111111111111111111111111111')
    await expect(
      scanFile(file, new Map([[valid.report.receiptId, valid]]), '/another-project', reporter, {
        bytes: 0,
        lines: 0
      })
    ).rejects.toThrow('outside PennyTel')
    await expect(
      scanFile('/dev/null', new Map([[valid.report.receiptId, valid]]), '/synthetic', reporter, {
        bytes: 0,
        lines: 0
      })
    ).rejects.toThrow('nonregular')
  })

  it('enumerates only fixed active and archived Codex session roots', async () => {
    const valid = receipt('pr1_20260919T120000000Z_11111111111111111111111111111111')
    const paths = await rolloutPaths(resolve('tests/fixtures/codex-home'), [valid])
    expect(paths).toHaveLength(2)
    expect(paths.some((path) => path.includes('/sessions/2026/09/19/'))).toBe(true)
    expect(paths.some((path) => path.includes('/archived_sessions/'))).toBe(true)
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
      expect(ready.status).toBe('ready')
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

      // A broken source that mentions the first receipt cannot poison a separate
      // valid closure for the second pending receipt.
      await writeFile(foreign, lines(fixture.slice(0, 10)).replaceAll(receiptId, otherId))
      const isolated = await status(otherId)
      expect(isolated.status).toBe('ready')
      expect((await status(receiptId)).status).toBe('blocked')
    })
  })
})
