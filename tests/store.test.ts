import { mkdir, mkdtemp, readFile, writeFile, unlink, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { TelemetryStore } from '../src/main/store'
import { emptyDataset } from '../src/shared/types'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

async function qaDirectory(prefix: string): Promise<string> {
  const base = join(process.cwd(), 'test-results')
  await mkdir(base, { recursive: true })
  return mkdtemp(join(base, prefix))
}

describe('durable local storage', () => {
  const command = {
    kind: 'save',
    table: 'slices',
    record: { id: 'new', title: 'New' },
    revision: 0
  } as const
  it.each(['valid', 'corrupt', 'dangling'])(
    'blocks backup-only startup and writes with a %s backup',
    async (kind) => {
      const directory = await qaDirectory('backup-only-')
      const backup = join(directory, 'telemetry.backup.json')
      const contents = JSON.stringify({
        ...emptyDataset(),
        slices: [{ id: 'saved', title: 'Recovery evidence' }]
      })
      if (kind === 'dangling') await symlink(join(directory, 'missing.json'), backup)
      else await writeFile(backup, kind === 'valid' ? contents : '{broken')
      const store = new TelemetryStore(directory)
      await expect(store.load()).rejects.toThrow('Recovery state')
      await expect(store.mutate(command)).rejects.toThrow('Recovery state')
      await expect(readFile(store.path)).rejects.toMatchObject({ code: 'ENOENT' })
      if (kind !== 'dangling')
        expect(await readFile(backup, 'utf8')).toBe(kind === 'valid' ? contents : '{broken')
    }
  )
  it.each(['backup', 'live', 'both'])(
    'rejects externally appearing %s after new-profile load without changing bytes',
    async (kind) => {
      const directory = await qaDirectory('late-storage-')
      const store = new TelemetryStore(directory)
      const initial = await store.load()
      const backup = join(directory, 'telemetry.backup.json')
      const liveBytes = JSON.stringify(initial.data, null, 2) + '\n'
      const backupBytes =
        JSON.stringify({
          ...emptyDataset(),
          slices: [{ id: 'recovery-only', title: 'Recovery-only record' }]
        }) + '\n'
      if (kind !== 'backup') await writeFile(store.path, liveBytes)
      if (kind !== 'live') await writeFile(backup, backupBytes)
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(store.mutate(command)).rejects.toThrow('Storage state changed externally')
        expect((await store.load()).data).toEqual(initial.data)
        if (kind !== 'backup') expect(await readFile(store.path, 'utf8')).toBe(liveBytes)
        else await expect(readFile(store.path)).rejects.toMatchObject({ code: 'ENOENT' })
        if (kind !== 'live') expect(await readFile(backup, 'utf8')).toBe(backupBytes)
        else await expect(readFile(backup)).rejects.toMatchObject({ code: 'ENOENT' })
      }
    }
  )
  it('saves an untouched new profile, then rotates previous live revisions normally', async () => {
    const directory = await qaDirectory('new-rotation-')
    const store = new TelemetryStore(directory)
    expect((await store.load()).data).toEqual(emptyDataset())
    expect((await store.mutate(command)).data.revision).toBe(1)
    const backup = join(directory, 'telemetry.backup.json')
    await expect(readFile(backup)).rejects.toMatchObject({ code: 'ENOENT' })
    for (const revision of [1, 2]) {
      const current = revision === 1 ? store : new TelemetryStore(directory)
      await current.load()
      const previous = await readFile(store.path, 'utf8')
      expect((await current.mutate({ ...command, revision })).data.revision).toBe(revision + 1)
      expect(await readFile(backup, 'utf8')).toBe(previous)
    }
  })
  it('protects the backup when live data disappears or changes during a session', async () => {
    const directory = await qaDirectory('lost-live-')
    const store = new TelemetryStore(directory)
    await store.mutate(command)
    await store.mutate({ ...command, revision: 1, record: { id: 'new', title: 'Second' } })
    const backup = join(directory, 'telemetry.backup.json')
    const before = await readFile(backup, 'utf8')
    await unlink(store.path)
    await expect(store.mutate({ ...command, revision: 2 })).rejects.toThrow('Recovery state')
    expect(await readFile(backup, 'utf8')).toBe(before)
    await writeFile(store.path, before)
    await expect(store.mutate({ ...command, revision: 2 })).rejects.toThrow('changed outside')
    expect(await readFile(backup, 'utf8')).toBe(before)
  })
  it('allows a genuinely new profile and manual recovery without losing recovered records', async () => {
    const directory = await qaDirectory('new-and-restored-')
    const store = new TelemetryStore(directory)
    expect((await store.load()).data.slices).toEqual([])
    await store.mutate(command)
    const live = await readFile(store.path, 'utf8')
    await writeFile(join(directory, 'telemetry.backup.json'), live)
    await unlink(store.path)
    await expect(new TelemetryStore(directory).load()).rejects.toThrow('Recovery state')
    await writeFile(store.path, live)
    await new TelemetryStore(directory).mutate({
      ...command,
      revision: 1,
      record: { id: 'another', title: 'After restore' }
    })
    expect(
      JSON.parse(await readFile(join(directory, 'telemetry.backup.json'), 'utf8')).slices
    ).toEqual([command.record])
  })
  it('does not publish memory state when the live path becomes unreadable', async () => {
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
    await expect(readFile(join(directory, 'telemetry.backup.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
  it('retains live and memory state after failed atomic replacement and allows retry', async () => {
    const directory = await qaDirectory('atomic-failure-')
    const store = new TelemetryStore(directory)
    await store.mutate(command)
    const original = await readFile(store.path, 'utf8')
    const { rename } = await vi.importActual<typeof fs>('node:fs/promises')
    const spy = vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (to === store.path) throw new Error('Synthetic rename failure')
      return rename(from, to)
    })
    try {
      await expect(
        store.mutate({ ...command, revision: 1, record: { id: 'new', title: 'Changed' } })
      ).rejects.toThrow('Synthetic rename failure')
      expect(await readFile(store.path, 'utf8')).toBe(original)
      expect((await store.load()).data.slices).toEqual([command.record])
      expect(await readFile(join(directory, 'telemetry.backup.json'), 'utf8')).toBe(original)
    } finally {
      spy.mockImplementation(rename)
    }
    expect((await store.mutate({ ...command, revision: 1 })).data.revision).toBe(2)
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
