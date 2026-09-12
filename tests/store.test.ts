import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TelemetryStore } from '../src/main/store'

async function qaDirectory(prefix: string): Promise<string> {
  const base = join(process.cwd(), 'test-results')
  await mkdir(base, { recursive: true })
  return mkdtemp(join(base, prefix))
}

describe('durable local storage', () => {
  it('does not publish memory state after a failed atomic replacement', async () => {
    const directory = await qaDirectory('write-failure-test-')
    const store = new TelemetryStore(directory)
    await store.load()
    await mkdir(store.path)
    await expect(
      store.mutate({
        kind: 'save',
        table: 'slices',
        record: { id: 's', title: 'Must not persist' },
        revision: 0
      })
    ).rejects.toThrow()
    expect((await store.load()).data.revision).toBe(0)
    expect((await store.load()).data.slices).toEqual([])
    expect(
      JSON.parse(await readFile(join(directory, 'telemetry.backup.json'), 'utf8')).revision
    ).toBe(0)
  })
  it('returns detached snapshots to callers', async () => {
    const directory = await qaDirectory('ownership-test-')
    const store = new TelemetryStore(directory)
    const loaded = await store.load()
    loaded.data.slices.push({ id: 'not-saved', title: 'Caller mutation' })
    expect((await store.load()).data.slices).toEqual([])
  })
  it('persists across instances, keeps the previous revision, and serializes stale writers', async () => {
    const directory = await qaDirectory('store-test-')
    const store = new TelemetryStore(directory)
    await store.mutate({
      kind: 'save',
      table: 'slices',
      record: { id: 's', title: 'Synthetic storage test' },
      revision: 0
    })
    const restarted = new TelemetryStore(directory)
    expect((await restarted.load()).data.slices[0].title).toBe('Synthetic storage test')
    const writes = await Promise.allSettled([
      store.mutate({
        kind: 'save',
        table: 'slices',
        record: { id: 's', title: 'Edit' },
        revision: 1
      }),
      store.mutate({
        kind: 'save',
        table: 'slices',
        record: { id: 's', title: 'Stale edit' },
        revision: 1
      })
    ])
    expect(writes.map((w) => w.status)).toEqual(['fulfilled', 'rejected'])
    expect(
      JSON.parse(await readFile(join(directory, 'telemetry.backup.json'), 'utf8')).revision
    ).toBe(1)
    expect((await store.load()).data.revision).toBe(2)
  })
  it('preserves corrupt data and refuses writes instead of starting empty', async () => {
    const directory = await qaDirectory('corruption-test-')
    const path = join(directory, 'telemetry.json')
    await writeFile(path, '{damaged')
    const store = new TelemetryStore(directory)
    await expect(store.load()).rejects.toThrow('preserved')
    await expect(
      store.mutate({
        kind: 'save',
        table: 'slices',
        record: { id: 's', title: 'Do not write' },
        revision: 0
      })
    ).rejects.toThrow('preserved')
    expect(await readFile(path, 'utf8')).toBe('{damaged')
  })
  it('a validation failure leaves the on-disk revision unchanged and permits a later valid save', async () => {
    const directory = await qaDirectory('transaction-test-')
    const store = new TelemetryStore(directory)
    await expect(
      store.mutate({
        kind: 'save',
        table: 'runs',
        record: { id: 'r', sliceId: 'missing', role: 'Critic', runType: 'Criticism' },
        revision: 0
      })
    ).rejects.toThrow('does not exist')
    const saved = await store.mutate({
      kind: 'save',
      table: 'slices',
      record: { id: 's', title: 'Valid' },
      revision: 0
    })
    expect(saved.data.revision).toBe(1)
  })
})
