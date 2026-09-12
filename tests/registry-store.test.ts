import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TelemetryStore } from '../src/main/store'
import { recoveredData, registryFixture } from './registry-fixtures'
import { runCost } from '../src/shared/metrics'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, rename: vi.fn(actual.rename) }
})
async function directory(): Promise<string> {
  const base = join(process.cwd(), 'test-results')
  await mkdir(base, { recursive: true })
  return mkdtemp(join(base, 'registry-store-'))
}

describe('registry startup, durability and atomic updates', () => {
  it('persists re-bounded migration while preserving Registry, Catalog and Override snapshots', async () => {
    const path = await directory(),
      store = new TelemetryStore(path),
      data = recoveredData()
    data.pricing = [
      {
        id: 'p',
        model: 'Luna',
        provider: 'OpenAI',
        effectiveDate: '2026-07-01',
        inputRate: 9,
        cachedRate: 1,
        outputRate: 10
      }
    ]
    data.runs[0].pricingReferenceDate = '2026-07-15'
    for (const source of ['Catalog', 'Override'] as const)
      data.runs.push({
        ...data.runs[0],
        id: source,
        startAt: '2026-07-15T00:00:00Z',
        priceSnapshot: {
          model: data.runs[0].model!,
          provider: 'OpenAI',
          source,
          effectiveDate: '2026-07-01',
          inputRate: 2,
          cachedRate: 1,
          outputRate: 3
        }
      })
    await writeFile(store.path, JSON.stringify(data))
    const registry = registryFixture()
    const authored = {
      ...registry.models[3].offers[0].pricingHistory[0],
      effectiveTo: '2026-08-30'
    }
    registry.models[3].offers[0].pricingHistory = []
    const initial = await store.mutate({
      kind: 'registry-import',
      revision: data.revision,
      text: JSON.stringify(registry)
    })
    const update = structuredClone(initial.data.registry!)
    update.models[3].offers[0].pricingHistory.push(authored)
    const changed = await store.mutate({
      kind: 'registry-import',
      revision: initial.data.revision,
      text: JSON.stringify(update)
    })
    expect(changed.data.registry!.models[3].offers[0].pricingHistory[0].effectiveTo).toBe(
      '2026-07-30'
    )
    expect(changed.data.runs).toEqual(initial.data.runs)
    expect(changed.data.runs.map(runCost)).toEqual(initial.data.runs.map(runCost))
    expect(changed.data.pricing).toEqual(data.pricing)
    expect((await new TelemetryStore(path).load()).data).toEqual(changed.data)
  })
  it.each(['appears', 'changes', 'disappears', 'replaced'])(
    'blocks an existing-profile backup that %s after load',
    async (kind) => {
      const path = await directory(),
        store = new TelemetryStore(path)
      const live = JSON.stringify({ ...recoveredData(), revision: 4 }) + '\n'
      const backup = join(path, 'telemetry.backup.json')
      const recovery = JSON.stringify({ ...recoveredData(), revision: 99 }) + '\n'
      await writeFile(store.path, live)
      if (kind !== 'appears') await writeFile(backup, recovery)
      const before = await store.load()
      if (kind === 'disappears' || kind === 'replaced') await fs.unlink(backup)
      if (kind !== 'disappears')
        await writeFile(backup, kind === 'changes' ? recovery + ' ' : recovery)
      const bytes = kind === 'disappears' ? undefined : await readFile(backup, 'utf8')
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(store.initializeRegistry()).rejects.toThrow('Backup changed outside')
        expect(await readFile(store.path, 'utf8')).toBe(live)
        if (bytes === undefined)
          await expect(readFile(backup)).rejects.toMatchObject({ code: 'ENOENT' })
        else expect(await readFile(backup, 'utf8')).toBe(bytes)
        expect(await store.load()).toEqual(before)
      }
    }
  )
  it('seeds a new profile durably, creates no fictitious backup and does not reseed on restart', async () => {
    const path = await directory(),
      store = new TelemetryStore(path)
    const initial = await store.initializeRegistry()
    expect(initial.data.registry).toEqual(registryFixture())
    expect(initial.data.slices).toEqual([])
    expect(initial.data.revision).toBe(1)
    expect(JSON.parse(await readFile(store.path, 'utf8'))).toEqual(initial.data)
    await expect(readFile(join(path, 'telemetry.backup.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect((await new TelemetryStore(path).initializeRegistry()).data).toEqual(initial.data)
  })
  it('upgrades an existing v1 profile atomically, preserving original telemetry and backup evidence', async () => {
    const path = await directory(),
      store = new TelemetryStore(path),
      original = recoveredData()
    original.revision = 7
    original.pricing = [
      {
        id: 'unknown-price',
        model: 'Historical Model',
        provider: 'Other',
        effectiveDate: '2025-01-01',
        inputRate: 1,
        cachedRate: 0,
        outputRate: 5
      }
    ]
    await writeFile(store.path, JSON.stringify(original, null, 2))
    const upgraded = (await store.initializeRegistry()).data
    expect(upgraded.revision).toBe(8)
    expect(upgraded.pricing).toEqual(original.pricing)
    expect(upgraded.slices).toEqual(original.slices)
    expect(runCost(upgraded.runs[0])).toBeCloseTo(0.1685406)
    expect(upgraded.runs[0].startAt).toBeUndefined()
    expect(JSON.parse(await readFile(join(path, 'telemetry.backup.json'), 'utf8'))).toEqual(
      original
    )
    expect((await new TelemetryStore(path).initializeRegistry()).data).toEqual(upgraded)
  })
  it('retains custom registry updates and immutable snapshots across restart', async () => {
    const path = await directory(),
      store = new TelemetryStore(path),
      original = recoveredData()
    await writeFile(store.path, JSON.stringify(original))
    const initialized = await store.initializeRegistry(),
      registry = registryFixture()
    registry.registryRevision = 9
    registry.description = 'Operator revision'
    registry.models[3].offers[0].pricingHistory[0].inputUsd = 123
    const updated = await store.mutate({
      kind: 'registry-import',
      text: JSON.stringify(registry),
      revision: initialized.data.revision
    })
    expect(updated.data.runs).toEqual(initialized.data.runs)
    expect((await new TelemetryStore(path).initializeRegistry()).data).toEqual(updated.data)
  })
  it('rejects an invalid update before changing either file, memory, or telemetry', async () => {
    const path = await directory(),
      store = new TelemetryStore(path)
    const initial = await store.initializeRegistry()
    await store.mutate({
      kind: 'import',
      revision: initial.data.revision,
      text: JSON.stringify(recoveredData())
    })
    const before = await store.load(),
      live = await readFile(store.path, 'utf8'),
      backup = await readFile(join(path, 'telemetry.backup.json'), 'utf8')
    const registry = registryFixture()
    registry.models[0].makerId = 'invalid'
    await expect(
      store.mutate({
        kind: 'registry-import',
        text: JSON.stringify(registry),
        revision: before.data.revision
      })
    ).rejects.toThrow('unknown maker')
    expect(await readFile(store.path, 'utf8')).toBe(live)
    expect(await readFile(join(path, 'telemetry.backup.json'), 'utf8')).toBe(backup)
    expect(await store.load()).toEqual(before)
  })
  it('does not publish registry or backfill when atomic replacement fails; retry succeeds', async () => {
    const path = await directory(),
      store = new TelemetryStore(path),
      original = recoveredData()
    await writeFile(store.path, JSON.stringify(original, null, 2))
    const bytes = await readFile(store.path, 'utf8')
    const { rename } = await vi.importActual<typeof fs>('node:fs/promises')
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (to === store.path) throw new Error('Synthetic registry write failure')
      return rename(from, to)
    })
    try {
      await expect(store.initializeRegistry()).rejects.toThrow('Synthetic registry write failure')
      expect((await store.load()).data).toEqual(original)
      expect(await readFile(store.path, 'utf8')).toBe(bytes)
      expect(await readFile(join(path, 'telemetry.backup.json'), 'utf8')).toBe(bytes)
    } finally {
      vi.mocked(fs.rename).mockImplementation(rename)
    }
    expect((await store.initializeRegistry()).data.runs[0].priceSnapshot?.source).toBe('Registry')
  })
  it.each(['live', 'backup', 'both'])(
    'retains pre-seed new-profile provenance if %s appears after the initial read',
    async (kind) => {
      const path = await directory(),
        store = new TelemetryStore(path)
      const before = await store.load(),
        live = join(path, 'telemetry.json'),
        backup = join(path, 'telemetry.backup.json')
      if (kind !== 'backup') await writeFile(live, JSON.stringify(before.data))
      if (kind !== 'live') await writeFile(backup, JSON.stringify(recoveredData()))
      await expect(store.initializeRegistry()).rejects.toThrow('Storage state changed externally')
      expect(await store.load()).toEqual(before)
      if (kind !== 'backup') expect(JSON.parse(await readFile(live, 'utf8'))).toEqual(before.data)
      if (kind !== 'live')
        expect(JSON.parse(await readFile(backup, 'utf8'))).toEqual(recoveredData())
    }
  )
  it('serializes concurrent startup calls as one installation', async () => {
    const store = new TelemetryStore(await directory())
    const calls = await Promise.all([
      store.initializeRegistry(),
      store.initializeRegistry(),
      store.initializeRegistry()
    ])
    expect(calls.map((v) => v.data.revision)).toEqual([1, 1, 1])
  })
})
