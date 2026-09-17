import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, symlink, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverBatch } from '../src/main/batch-import'
import { mergeBatchImport } from '../src/shared/data'
import { emptyDataset, type ImportSource } from '../src/shared/types'
import { TelemetryStore } from '../src/main/store'

const source = (path: string, value: object): ImportSource => ({
  path,
  text: JSON.stringify({ schemaVersion: 2, ...value })
})
const parent = source('z/parent.pennytel.json', { slices: [{ id: 's', title: 'Slice' }] })
const child = source('a/run.pennytel.json', {
  runs: [{ id: 'r', sliceId: 's', runType: 'QA', role: 'Implementer' }]
})
const directory = (): Promise<string> => mkdtemp(join(tmpdir(), 'pennytel-batch-'))

describe('batch import', () => {
  it('validates cross-file relationships in either order and counts duplicates', () => {
    for (const sources of [
      [child, parent, parent],
      [parent, parent, child]
    ]) {
      const result = mergeBatchImport(emptyDataset(), sources)
      expect(result.preview).toEqual({
        counts: { slices: 1, runs: 1, findings: 0, discoveries: 0, pricing: 0 },
        skipped: 1
      })
      expect(result.data.runs[0].sliceId).toBe('s')
      expect(mergeBatchImport(result.data, [parent, child]).preview.skipped).toBe(2)
    }
  })
  it.each(['rr', 'R'])(
    'attributes invalid run %s to its exact source despite prefix/case collisions',
    (id) => {
      const valid = source('a-valid.pennytel.json', {
        slices: [{ id: 's', title: 'Slice' }],
        runs: [{ id: 'r', sliceId: 's', role: 'Implementer', runType: 'QA' }]
      })
      const broken = source('nested/z-broken.pennytel.json', {
        runs: [{ id, sliceId: 'missing', role: 'Critic', runType: 'QA' }]
      })
      for (const sources of [
        [valid, broken],
        [broken, valid]
      ]) {
        expect(() => mergeBatchImport(emptyDataset(), sources)).toThrow(
          `nested/z-broken.pennytel.json: runs ${id}: slice “missing” does not exist.`
        )
      }
    }
  )
  it('names malformed, conflicting, unsupported and relationship-invalid files', () => {
    for (const bad of [
      { path: 'late.pennytel.json', text: '{' },
      source('late.pennytel.json', { slices: [{ id: 's', title: 'Conflict' }] }),
      source('late.pennytel.json', { kind: 'pennytel-comparison' }),
      source('late.pennytel.json', {
        runs: [{ id: 'bad', sliceId: 'missing', role: 'Critic', runType: 'QA' }]
      })
    ])
      expect(() => mergeBatchImport(emptyDataset(), [parent, bad])).toThrow('late.pennytel.json')
  })
  it('discovers nested regular artifacts deterministically, ignoring hidden and symlink entries', async () => {
    const root = await directory()
    await mkdir(join(root, 'role'))
    await mkdir(join(root, '.metadata'))
    for (const path of [
      'z.pennytel.json',
      'role/a.pennytel.json',
      '.hidden.pennytel.json',
      '.metadata/b.pennytel.json',
      'x.json',
      'x.jsonl'
    ])
      await writeFile(join(root, path), parent.text)
    await symlink(join(root, 'role'), join(root, 'linked'))
    await symlink(join(root, 'z.pennytel.json'), join(root, 'link.pennytel.json'))
    expect((await discoverBatch(root)).map((s) => s.path)).toEqual([
      'role/a.pennytel.json',
      'z.pennytel.json'
    ])
    expect(await discoverBatch(await directory())).toEqual([])
  })
  it('enforces file count, byte and discovery bounds', async () => {
    expect(() => mergeBatchImport(emptyDataset(), Array(1001).fill(parent))).toThrow('1000')
    expect(() =>
      mergeBatchImport(emptyDataset(), [{ path: 'big', text: 'é'.repeat(5_000_001) }])
    ).toThrow('10 MB')
    expect(() =>
      mergeBatchImport(
        emptyDataset(),
        Array(11).fill({ path: 'big', text: ' '.repeat(10_000_000) })
      )
    ).toThrow('100 MB')
    const root = await directory()
    await writeFile(join(root, 'big.pennytel.json'), ' '.repeat(10_000_001))
    await expect(discoverBatch(root)).rejects.toThrow('big.pennytel.json: Import exceeds')
  })
  it('bounds actual discovery count, aggregate bytes, depth and UTF-8', async () => {
    const many = await directory()
    for (let i = 0; i < 1001; i++) await writeFile(join(many, `${i}.pennytel.json`), '{}')
    await expect(discoverBatch(many)).rejects.toThrow('1000-file')
    const large = await directory()
    for (let i = 0; i < 11; i++) {
      const path = join(large, `${i}.pennytel.json`)
      await writeFile(path, '')
      await truncate(path, 10_000_000)
    }
    await expect(discoverBatch(large)).rejects.toThrow('100 MB')
    const deep = await directory()
    let path = deep
    for (let i = 0; i < 65; i++) {
      path = join(path, 'nested')
      await mkdir(path)
    }
    await expect(discoverBatch(deep)).rejects.toThrow('64-level')
    const invalid = await directory()
    await writeFile(join(invalid, 'invalid.pennytel.json'), Buffer.from([0xff]))
    await expect(discoverBatch(invalid)).rejects.toThrow('invalid.pennytel.json')
  })
  it('persists exactly once, backs up starting bytes and leaves memory/live/backup unchanged on late failure or stale revision', async () => {
    const root = await directory()
    const store = new TelemetryStore(root)
    const before = JSON.stringify(emptyDataset())
    await writeFile(store.path, before)
    await store.load()
    await expect(
      store.mutate({
        kind: 'batch-import',
        sources: [parent, child, { path: 'late', text: '{' }],
        revision: 0
      })
    ).rejects.toThrow('late')
    expect(await readFile(store.path, 'utf8')).toBe(before)
    expect((await store.load()).data.revision).toBe(0)
    await expect(readFile(join(root, 'telemetry.backup.json'))).rejects.toThrow()
    const saved = await store.mutate({
      kind: 'batch-import',
      sources: [child, parent],
      revision: 0
    })
    expect(saved.data.revision).toBe(1)
    expect(await readFile(join(root, 'telemetry.backup.json'), 'utf8')).toBe(before)
    await expect(
      store.mutate({ kind: 'batch-import', sources: [parent], revision: 0 })
    ).rejects.toThrow('dataset changed')
    expect((await new TelemetryStore(root).load()).data).toEqual(saved.data)
  })
})
