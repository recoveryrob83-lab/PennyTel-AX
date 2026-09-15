import { describe, expect, it } from 'vitest'
import {
  applyMutation,
  mergeImport,
  normalizeDataset,
  validateDataset,
  validateRecord
} from '../src/shared/data'
import { validateExecutionEvidence } from '../src/shared/execution-evidence'
import { cacheRatio, runCost, usageBurn } from '../src/shared/metrics'
import { emptyDataset } from '../src/shared/types'
import { comparisonFixture, evidenceFixture, fixture, runFixture } from './fixtures'
import { registryFixture } from './registry-fixtures'

describe('schema v2 compatibility and economics', () => {
  it('normalizes representative v1 data exactly, deterministically and without inventing evidence', () => {
    const legacy = {
      ...comparisonFixture(),
      schemaVersion: 1,
      revision: 42,
      registry: registryFixture()
    }
    const before = JSON.stringify(legacy)
    const migrated = normalizeDataset(legacy)
    expect(migrated).toEqual({ ...legacy, schemaVersion: 2 })
    expect(normalizeDataset(legacy)).toEqual(migrated)
    expect(normalizeDataset(migrated)).toEqual(migrated)
    expect(migrated.runs.every((run) => !Object.hasOwn(run, 'executionEvidence'))).toBe(true)
    expect(migrated.runs.map(runCost)).toEqual(legacy.runs.map(runCost))
    migrated.runs[0].notes = 'Detached'
    expect(JSON.stringify(legacy)).toBe(before)
  })
  it('keeps v2 strict and v1 compatibility explicit, including partial additive imports', () => {
    const legacy = { ...fixture(), schemaVersion: 1 }
    expect(() => validateDataset(legacy)).toThrow('schemaVersion 2')
    expect(mergeImport(emptyDataset(), JSON.stringify(legacy)).data).toEqual(fixture())
    const appended = mergeImport(
      fixture(),
      JSON.stringify({ schemaVersion: 1, revision: 999, runs: [runFixture({ id: 'appended' })] })
    ).data
    expect(appended.schemaVersion).toBe(2)
    expect(appended.revision).toBe(0)
    expect(appended.runs[1].sliceId).toBe('slice-test')
    expect(appended.runs[1]).not.toHaveProperty('executionEvidence')
    const disguised = { ...legacy, runs: [runFixture({ executionEvidence: evidenceFixture() })] }
    expect(() => normalizeDataset(disguised)).toThrow('Schema v1')
    expect(() => mergeImport(emptyDataset(), JSON.stringify(disguised))).toThrow('Schema v1')
    for (const schemaVersion of [0, 3, '2', null]) {
      expect(() => normalizeDataset({ ...legacy, schemaVersion })).toThrow()
      expect(() => mergeImport(emptyDataset(), JSON.stringify({ schemaVersion }))).toThrow()
    }
  })
  it('round-trips v2 evidence and snapshots; detects nested conflicts without deduplicating distinct turns', () => {
    const data = fixture()
    data.runs[0].executionEvidence = evidenceFixture()
    const imported = mergeImport(emptyDataset(), JSON.stringify(data)).data
    expect(imported).toEqual(data)
    expect(mergeImport(imported, JSON.stringify(data)).preview.skipped).toBe(3)
    const reordered = {
      ...data,
      runs: [
        {
          ...data.runs[0],
          executionEvidence: Object.fromEntries(Object.entries(evidenceFixture()).reverse())
        }
      ]
    }
    expect(mergeImport(imported, JSON.stringify(reordered)).preview.skipped).toBe(3)
    const conflict = structuredClone(data)
    conflict.runs[0].executionEvidence!.turnId = 'different-turn'
    expect(() => mergeImport(imported, JSON.stringify(conflict))).toThrow('conflicts')
    const otherTurn = {
      ...data.runs[0],
      id: 'other-turn',
      executionEvidence: { ...evidenceFixture(), turnId: 'turn-2' }
    }
    expect(
      mergeImport(data, JSON.stringify({ schemaVersion: 2, runs: [otherTurn] })).data.runs
    ).toHaveLength(2)
    expect(imported).toEqual(data)
  })
  it('preserves cached/fresh token economics, workflow metadata, meter semantics, and frozen pricing on evidence edits', () => {
    const data = fixture()
    const saved = applyMutation(data, {
      kind: 'save',
      table: 'runs',
      revision: data.revision,
      record: {
        ...data.runs[0],
        inputTokens: 100,
        cachedInputTokens: 1000,
        outputTokens: 200,
        reasoningTokens: 150,
        executionEvidence: evidenceFixture()
      }
    })
    const run = saved.runs[0]
    expect(runCost(run)).toBeCloseTo(0.0027)
    expect(cacheRatio(run)).toBeCloseTo(1000 / 1100)
    expect(usageBurn(run)).toBeNull()
    expect(run).not.toHaveProperty('usageBefore')
    expect(run).not.toHaveProperty('usageAfter')
    expect(run).not.toHaveProperty('usageBurn')
    expect(run).not.toHaveProperty('result')
    expect(run).not.toHaveProperty('contextMode')
    expect(run.sliceId).toBe(data.runs[0].sliceId)
    expect(run.role).toBe(data.runs[0].role)
    expect(run.runType).toBe(data.runs[0].runType)
    expect(run.priceSnapshot).toEqual(data.runs[0].priceSnapshot)
    for (const attribution of ['Clean', 'Contaminated', 'Unknown'] as const) {
      const metered = {
        ...run,
        executionEvidence: {
          ...evidenceFixture(),
          quotaWindows: [{ attribution, first: { usedPercent: 98 }, last: { usedPercent: 1 } }]
        }
      }
      expect(() => validateRecord('runs', metered)).not.toThrow()
      expect(usageBurn(metered)).toBeNull()
      expect(usageBurn({ ...metered, usageBefore: 94, usageAfter: 92 })).toBe(2)
      expect(usageBurn({ ...metered, usageBurn: 0 })).toBe(0)
    }
    expect(saved.revision).toBe(data.revision + 1)
  })
  it('does not manufacture required operator metadata from a complete rollout identity', () => {
    for (const key of ['sliceId', 'runType', 'role']) {
      const run: Record<string, unknown> = { ...runFixture(), executionEvidence: evidenceFixture() }
      delete run[key]
      expect(() => validateRecord('runs', run)).toThrow('required')
    }
  })
  it('keeps omitted/partial evidence unknown and accepts measured zeroes', () => {
    const minimal = { kind: 'codex-rollout', formatVersion: 1 }
    for (const executionEvidence of [
      undefined,
      minimal,
      {
        ...minimal,
        modelInvocationCount: 0,
        toolCallCount: 0,
        timeToFirstTokenMs: 0,
        quotaWindows: [
          { attribution: 'Unknown' },
          { attribution: 'Clean', first: { usedPercent: 0 } }
        ],
        environment: { sandboxMode: 'unknown' }
      }
    ]) {
      const run = runFixture({
        executionEvidence: executionEvidence as ReturnType<typeof evidenceFixture>
      })
      expect(() => validateRecord('runs', run)).not.toThrow()
      expect(
        mergeImport(emptyDataset(), JSON.stringify({ ...fixture(), runs: [run] })).data.runs[0]
          .executionEvidence
      ).toEqual(executionEvidence)
    }
  })
})

describe('strict, bounded execution evidence', () => {
  it.each([0, 1])(
    'rejects a peak with %i input tokens when invocation count is zero',
    (inputTokens) => {
      const executionEvidence = {
        ...evidenceFixture(),
        modelInvocationCount: 0,
        peakInvocation: { inputTokens }
      }
      expect(() => validateExecutionEvidence(executionEvidence)).toThrow(
        'at least one model invocation'
      )
      expect(() =>
        mergeImport(
          emptyDataset(),
          JSON.stringify({ ...fixture(), runs: [runFixture({ executionEvidence })] })
        )
      ).toThrow('at least one model invocation')
      for (const modelInvocationCount of [undefined, 1]) {
        const valid: ReturnType<typeof evidenceFixture> = { ...executionEvidence }
        if (modelInvocationCount === undefined) delete valid.modelInvocationCount
        else valid.modelInvocationCount = modelInvocationCount
        expect(() => validateExecutionEvidence(valid)).not.toThrow()
      }
    }
  )
  it.each(['\u2028', '\u2029'])(
    'rejects Unicode separator %j in every metadata text field',
    (separator) => {
      for (const path of [
        'sourceLog.fileName',
        'sourceLog.contentHash.value',
        'sessionId',
        'turnId',
        'runtimeVersion',
        'originator',
        'workingDirectory',
        'repository.url',
        'repository.branch',
        'repository.baselineCommitSha',
        'quotaWindows.0.windowName',
        'quotaWindows.0.planType',
        'quotaWindows.0.note'
      ]) {
        const value = evidenceFixture()
        const keys = path.split('.')
        let target = value as unknown as Record<string, unknown>
        for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>
        target[keys.at(-1)!] = `before${separator}after`
        expect(() => validateExecutionEvidence(value)).toThrow('single-line metadata')
      }
    }
  )
  it.each([
    ['kind', 'other'],
    ['formatVersion', 2],
    ['modelInvocationCount', -1],
    ['toolCallCount', 1.5],
    ['modelInvocationCount', Number.MAX_SAFE_INTEGER + 1],
    ['toolCallCount', '2'],
    ['timeToFirstTokenMs', Infinity],
    ['timeToFirstTokenMs', NaN],
    ['timeToFirstTokenMs', -0.5],
    ['modelContextWindowTokens', 0],
    ['modelContextWindowTokens', 2.5],
    ['sessionId', ''],
    ['sessionId', ' spaced'],
    ['turnId', 'has space'],
    ['turnId', 'x'.repeat(201)],
    ['runtimeVersion', 'x'.repeat(101)],
    ['originator', 'x'.repeat(201)],
    ['workingDirectory', 'x'.repeat(4097)],
    ['workingDirectory', 'raw\ntext'],
    ['sourceLog', { fileName: '../rollout.jsonl' }],
    ['sourceLog', { fileName: 'C:\\rollout.jsonl' }],
    ['sourceLog', { fileName: '..' }],
    ['sourceLog', { fileName: 'x'.repeat(256) }],
    ['sourceLog', { fileName: 'x', contentHash: { algorithm: 'md5', value: 'a'.repeat(64) } }],
    ['sourceLog', { fileName: 'x', contentHash: { algorithm: 'sha256', value: 'A'.repeat(64) } }],
    ['sourceLog', { fileName: 'x', contentHash: { algorithm: 'sha256', value: 'a'.repeat(63) } }],
    ['sourceLog', { fileName: 'x', contentHash: { value: 'a'.repeat(64) } }],
    ['repository', { baselineCommitSha: 'abc1234' }],
    ['repository', { url: 'x'.repeat(2049) }],
    ['repository', { branch: 'x'.repeat(256) }],
    ['peakInvocation', {}],
    ['peakInvocation', { inputTokens: 10, cachedInputTokens: 11 }],
    ['peakInvocation', { inputTokens: -1 }],
    ['peakInvocation', { inputTokens: 1, contextWindowTokens: 0 }],
    ['quotaWindows', Array.from({ length: 17 }, () => ({ attribution: 'Unknown' }))],
    ['quotaWindows', [{ attribution: 'Guess' }]],
    ['quotaWindows', [{ first: { usedPercent: 1 } }]],
    ['quotaWindows', [{ attribution: 'Clean', windowMinutes: 0 }]],
    ['quotaWindows', [{ attribution: 'Clean', windowMinutes: 1.5 }]],
    ['quotaWindows', [{ attribution: 'Clean', note: 'x'.repeat(501) }]],
    ['quotaWindows', [{ attribution: 'Clean', first: { usedPercent: 101 } }]],
    ['quotaWindows', [{ attribution: 'Clean', first: { usedPercent: -1 } }]],
    ['quotaWindows', [{ attribution: 'Clean', last: { usedPercent: Infinity } }]],
    ['quotaWindows', [{ attribution: 'Clean', first: { usedPercent: null } }]],
    ['quotaWindows', [{ attribution: 'Clean', first: { recordedAt: '2026-09-15T00:00:00Z' } }]],
    [
      'quotaWindows',
      [
        {
          attribution: 'Clean',
          first: { usedPercent: 1, recordedAt: '2026-09-15T02:00:00Z' },
          last: { usedPercent: 2, recordedAt: '2026-09-15T01:00:00Z' }
        }
      ]
    ],
    ['environment', { sandboxMode: 'custom' }],
    ['environment', { approvalPolicy: 'always' }],
    ['environment', { approvalReviewer: 'other' }],
    ['environment', { networkAccess: true }]
  ])('rejects malformed %s: %j', (key, value) => {
    expect(() => validateExecutionEvidence({ ...evidenceFixture(), [key]: value })).toThrow()
  })
  it.each([
    '2026-02-30T00:00:00Z',
    '2026-09-15T24:00:00Z',
    '2026-09-15T00:60:00Z',
    '2026-09-15T00:00:60Z',
    '2026-09-15T10:00:00',
    '2026-09-15T00:00:00+24:00',
    '2026-09-15T00:00:00+00:60',
    'invalid',
    123
  ])('rejects malformed observation/reset timestamp %j', (value) => {
    for (const key of ['recordedAt', 'resetsAt'])
      expect(() =>
        validateExecutionEvidence({
          ...evidenceFixture(),
          quotaWindows: [{ attribution: 'Unknown', first: { usedPercent: 1, [key]: value } }]
        })
      ).toThrow('timestamp')
  })
  it('accepts upper bounds, full SHA-256 Git IDs, partial provenance, and paired context with changing windows', () => {
    expect(() =>
      validateExecutionEvidence({
        kind: 'codex-rollout',
        formatVersion: 1,
        sourceLog: { fileName: 'x'.repeat(255) },
        sessionId: 'x'.repeat(200),
        modelInvocationCount: Number.MAX_SAFE_INTEGER,
        timeToFirstTokenMs: Number.MAX_SAFE_INTEGER,
        repository: { baselineCommitSha: 'f'.repeat(64) },
        modelContextWindowTokens: 100000,
        peakInvocation: { inputTokens: 90000, contextWindowTokens: 200000 },
        quotaWindows: Array.from({ length: 16 }, () => ({
          attribution: 'Unknown',
          last: { usedPercent: 100 }
        }))
      })
    ).not.toThrow()
  })
  it('rejects null, arrays, missing discriminators and unknown/privacy fields at every nested level', () => {
    for (const value of [null, [], {}, { kind: 'codex-rollout' }, { formatVersion: 1 }])
      expect(() => validateExecutionEvidence(value)).toThrow()
    const fields = [
      'prompt',
      'systemInstructions',
      'agents',
      'reasoning',
      'encryptedReasoning',
      'sourceExcerpt',
      'toolCommand',
      'toolOutput',
      'messages',
      'raw',
      'sliceId',
      'runType',
      'role',
      'result',
      'contextMode',
      'peakContextUtilization',
      'usageBurn',
      '__proto__'
    ]
    for (const field of fields) {
      for (const path of [
        '',
        'sourceLog',
        'sourceLog.contentHash',
        'repository',
        'peakInvocation',
        'quotaWindows.0',
        'quotaWindows.0.first',
        'quotaWindows.0.last',
        'environment'
      ]) {
        const value = evidenceFixture()
        let target: unknown = value
        for (const key of path.split('.').filter(Boolean))
          target = (target as Record<string, unknown>)[key]
        Object.defineProperty(target, field, {
          value: 'rejected synthetic payload',
          enumerable: true
        })
        expect(() => validateExecutionEvidence(value)).toThrow('unknown field')
        expect(() =>
          mergeImport(
            emptyDataset(),
            JSON.stringify({ ...fixture(), runs: [runFixture({ executionEvidence: value })] })
          )
        ).toThrow('unknown field')
      }
    }
    for (const key of [
      'sourceLog',
      'sessionId',
      'repository',
      'peakInvocation',
      'quotaWindows',
      'environment'
    ]) {
      expect(() => validateExecutionEvidence({ ...evidenceFixture(), [key]: null })).toThrow()
      expect(() => validateExecutionEvidence({ ...evidenceFixture(), [key]: undefined })).toThrow()
    }
  })
})
