import {
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  CanonicalArtifactStore,
  MAX_CANONICAL_DATASET_BYTES,
  type CanonicalArtifactStoreOptions,
  type CanonicalPublishBoundary
} from '../src/main/canonical-artifact-store'
import {
  CANONICAL_METADATA_RELATIVE_PATH,
  canonicalArtifactStorePath,
  canonicalRecordRelativePath
} from '../src/main/canonical-artifacts'
import { projectionDatabasePath, SqliteProjectionRepository } from '../src/main/sqlite-projection'
import { MainProcessStorageService } from '../src/main/storage-service'
import { emptyDataset, TABLES, type Dataset } from '../src/shared/types'
import { comparisonFixture, evidenceFixture, fixture } from './fixtures'
import { registryFixture } from './registry-fixtures'

async function qaDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pennytel-artifacts-'))
}

function representativeDataset(): Dataset {
  const data = comparisonFixture()
  data.revision = 19
  data.registry = registryFixture()
  data.runs[0].executionEvidence = evidenceFixture()
  data.runs.push({
    id: 'unknown-telemetry',
    sliceId: 'empty',
    runType: 'Synthetic QA',
    role: 'Critic',
    notes: 'Token values are deliberately Unknown.'
  })
  return data
}

function openStore(
  directory: string,
  faultInjector?: CanonicalArtifactStoreOptions['faultInjector']
): {
  repository: SqliteProjectionRepository
  service: MainProcessStorageService
  store: CanonicalArtifactStore
} {
  const repository = new SqliteProjectionRepository(projectionDatabasePath(directory))
  const service = new MainProcessStorageService(repository)
  const store = new CanonicalArtifactStore(canonicalArtifactStorePath(directory), service, {
    ...(faultInjector ? { faultInjector } : {})
  })
  return { repository, service, store }
}

describe('canonical JSON artifact store', () => {
  it('publishes self-describing artifacts before projection and losslessly replaces stable records', async () => {
    const directory = await qaDirectory()
    const root = canonicalArtifactStorePath(directory)
    const { service, store } = openStore(directory)
    const initial = representativeDataset()
    expect(await store.initialize(initial)).toEqual(initial)
    expect(await store.loadCanonical()).toEqual(initial)
    expect(service.loadProjection()).toEqual(initial)

    const run = initial.runs.find((record) => record.id === 'astra-impl')!
    const path = join(root, canonicalRecordRelativePath('runs', run.id))
    const before = JSON.parse(await readFile(path, 'utf8'))
    expect(before).toMatchObject({
      kind: 'pennytel-canonical-record',
      artifactVersion: 1,
      datasetSchemaVersion: 2,
      entityType: 'runs',
      id: run.id,
      record: run
    })
    const updated = { ...run, notes: 'Stable record replacement' }
    const next = await store.mutate({
      kind: 'save',
      table: 'runs',
      record: updated,
      revision: initial.revision
    })
    expect(next.revision).toBe(initial.revision + 1)
    expect(join(root, canonicalRecordRelativePath('runs', run.id))).toBe(path)
    expect(JSON.parse(await readFile(path, 'utf8')).record.notes).toBe('Stable record replacement')
    expect(await store.loadCanonical()).toEqual(next)
    expect(service.loadProjection()).toEqual(next)
    expect(next.runs.find((record) => record.id === 'luna-critic')!.outputTokens).toBe(0)
    expect(next.runs.find((record) => record.id === 'unknown-telemetry')).not.toHaveProperty(
      'outputTokens'
    )
    expect(next.runs[0].executionEvidence).toEqual(evidenceFixture())
    expect(next.registry).toEqual(initial.registry)
    service.close()
  })

  it('derives containment-safe paths from hostile but valid identities', async () => {
    const directory = await qaDirectory()
    const root = canonicalArtifactStorePath(directory)
    const data = fixture()
    data.slices[0].id = '../../nested\\hostile:id'
    data.runs[0].sliceId = data.slices[0].id
    const relativePath = canonicalRecordRelativePath('slices', data.slices[0].id)
    expect(relativePath).toMatch(/^artifact-slices-[a-f0-9]{64}\.json$/)
    expect(relativePath).not.toContain('..')
    expect(() => canonicalArtifactStorePath('relative')).toThrow('absolute')
    expect(() => new CanonicalArtifactStore('relative', {} as MainProcessStorageService)).toThrow(
      'absolute'
    )
    const { service, store } = openStore(directory)
    await store.initialize(data)
    expect(JSON.parse(await readFile(join(root, relativePath), 'utf8')).id).toBe(data.slices[0].id)
    expect(await store.loadCanonical()).toEqual(data)
    service.close()
  })

  it('keeps distinct accepted UTF-16 identities separate across publication and restart', async () => {
    const directory = await qaDirectory()
    const firstId = '\ud800'
    const secondId = '\udc00'
    for (const table of TABLES)
      expect(canonicalRecordRelativePath(table, firstId)).not.toBe(
        canonicalRecordRelativePath(table, secondId)
      )
    expect(canonicalRecordRelativePath('slices', 'ordinary-a')).not.toBe(
      canonicalRecordRelativePath('slices', 'ordinary-b')
    )
    const data = fixture()
    data.slices[0].id = firstId
    data.runs[0].sliceId = firstId
    const seeded = openStore(directory)
    await seeded.store.initialize(data)
    seeded.service.close()

    let interrupted = false
    const saving = openStore(directory, ({ boundary }) => {
      if (!interrupted && boundary === 'publication-authorized') {
        interrupted = true
        throw new Error('synthetic identity restart')
      }
    })
    await expect(
      saving.store.mutate({
        kind: 'save',
        table: 'slices',
        record: { id: secondId, title: 'Distinct valid ID' },
        revision: data.revision
      })
    ).rejects.toThrow('synthetic identity restart')
    saving.service.close()

    const restarted = openStore(directory)
    expect((await restarted.store.recover()).action).toBe('recovered-publication')
    const canonical = (await restarted.store.loadCanonical())!
    expect(canonical.slices.map(({ id }) => id)).toEqual([firstId, secondId])
    expect(restarted.service.loadProjection()).toEqual(canonical)
    for (const id of [firstId, secondId]) {
      const artifact = JSON.parse(
        await readFile(
          join(canonicalArtifactStorePath(directory), canonicalRecordRelativePath('slices', id)),
          'utf8'
        )
      )
      expect(artifact.id).toBe(id)
    }
    restarted.service.close()
  })

  it.each<{
    boundary: CanonicalPublishBoundary
    expectedAction: 'none' | 'discarded-prepared' | 'recovered-publication'
    published: boolean
  }>([
    { boundary: 'staged-data-durable', expectedAction: 'none', published: false },
    {
      boundary: 'prepared-receipt-durable',
      expectedAction: 'discarded-prepared',
      published: false
    },
    {
      boundary: 'publication-authorized',
      expectedAction: 'recovered-publication',
      published: true
    },
    {
      boundary: 'artifact-operation-durable',
      expectedAction: 'recovered-publication',
      published: true
    },
    {
      boundary: 'canonical-state-durable',
      expectedAction: 'recovered-publication',
      published: true
    },
    {
      boundary: 'projection-complete',
      expectedAction: 'recovered-publication',
      published: true
    },
    { boundary: 'pending-state-cleared', expectedAction: 'none', published: true }
  ])(
    'recovers idempotently after interruption at $boundary',
    async ({ boundary, expectedAction, published }) => {
      const directory = await qaDirectory()
      let injected = false
      const first = openStore(directory, (event) => {
        if (!injected && event.boundary === boundary) {
          injected = true
          throw new Error(`synthetic crash at ${boundary}`)
        }
      })
      const expected = representativeDataset()
      await expect(first.store.initialize(expected)).rejects.toThrow(
        `synthetic crash at ${boundary}`
      )
      first.service.close()

      const restarted = openStore(directory)
      const result = await restarted.store.recover()
      expect(result.action).toBe(expectedAction)
      expect(await restarted.store.loadCanonical()).toEqual(published ? expected : undefined)
      expect(restarted.service.loadProjection()).toEqual(published ? expected : undefined)
      expect((await restarted.store.recover()).action).toBe('none')
      expect(
        (await readdir(canonicalArtifactStorePath(directory))).filter(
          (name) => name.startsWith('stage-') || name.startsWith('tombstone-')
        )
      ).toEqual([])
      restarted.service.close()
    }
  )

  it('recovers an interrupted delete with a tombstone and does not resurrect the record', async () => {
    const directory = await qaDirectory()
    const initial = fixture()
    const first = openStore(directory)
    await first.store.initialize(initial)
    first.service.close()

    let injected = false
    const deleting = openStore(directory, (event) => {
      if (!injected && event.boundary === 'artifact-operation-durable') {
        injected = true
        throw new Error('synthetic delete crash')
      }
    })
    await expect(
      deleting.store.mutate({
        kind: 'delete',
        table: 'pricing',
        id: 'price-test',
        revision: initial.revision
      })
    ).rejects.toThrow('synthetic delete crash')
    deleting.service.close()

    const restarted = openStore(directory)
    expect((await restarted.store.recover()).action).toBe('recovered-publication')
    const recovered = (await restarted.store.loadCanonical())!
    expect(recovered.pricing).toEqual([])
    expect(recovered.revision).toBe(initial.revision + 1)
    await expect(
      readFile(
        join(
          canonicalArtifactStorePath(directory),
          canonicalRecordRelativePath('pricing', 'price-test')
        )
      )
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(restarted.service.loadProjection()).toEqual(recovered)
    restarted.service.close()
  })

  it('replays a partially published multi-artifact mutation before advancing dataset revision', async () => {
    const directory = await qaDirectory()
    const initial = fixture()
    const seeded = openStore(directory)
    await seeded.store.initialize(initial)
    seeded.service.close()

    const importData = emptyDataset()
    importData.slices.push({ id: 'new-slice', title: 'Imported together' })
    importData.runs.push({
      id: 'new-run',
      sliceId: 'new-slice',
      runType: 'Synthetic QA',
      role: 'Implementer',
      outputTokens: 0
    })
    let injected = false
    const interrupted = openStore(directory, (event) => {
      if (
        !injected &&
        event.boundary === 'artifact-operation-durable' &&
        event.operationIndex === 0
      ) {
        injected = true
        throw new Error('synthetic partial multi-artifact publication')
      }
    })
    await expect(
      interrupted.store.mutate({
        kind: 'import',
        text: JSON.stringify(importData),
        revision: initial.revision
      })
    ).rejects.toThrow('synthetic partial multi-artifact publication')
    expect(interrupted.service.loadProjection()).toEqual(initial)
    const metadata = JSON.parse(
      await readFile(
        join(canonicalArtifactStorePath(directory), CANONICAL_METADATA_RELATIVE_PATH),
        'utf8'
      )
    )
    expect(metadata.revision).toBe(initial.revision)
    interrupted.service.close()

    const restarted = openStore(directory)
    expect((await restarted.store.recover()).action).toBe('recovered-publication')
    const recovered = (await restarted.store.loadCanonical())!
    expect(recovered.revision).toBe(initial.revision + 1)
    expect(recovered.slices.some((slice) => slice.id === 'new-slice')).toBe(true)
    expect(recovered.runs.find((run) => run.id === 'new-run')!.outputTokens).toBe(0)
    expect(restarted.service.loadProjection()).toEqual(recovered)
    expect((await restarted.store.recover()).action).toBe('none')
    restarted.service.close()
  })

  it('keeps published artifacts authoritative when SQLite projection fails, then reprojects on restart', async () => {
    const directory = await qaDirectory()
    const initial = fixture()
    const first = openStore(directory)
    await first.store.initialize(initial)
    const trigger = new DatabaseSync(projectionDatabasePath(directory))
    trigger.exec(`
      CREATE TRIGGER synthetic_projection_failure
      BEFORE INSERT ON slices
      WHEN NEW.id = 'slice-test'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic projection lag');
      END;
    `)
    await expect(
      first.store.mutate({
        kind: 'save',
        table: 'slices',
        record: { ...initial.slices[0], title: 'Canonical wins' },
        revision: initial.revision
      })
    ).rejects.toThrow('synthetic projection lag')
    const canonical = (await first.store.loadCanonical())!
    expect(canonical.slices[0].title).toBe('Canonical wins')
    expect(first.service.loadProjection()).toEqual(initial)
    first.service.close()
    trigger.exec('DROP TRIGGER synthetic_projection_failure')
    trigger.close()

    const restarted = openStore(directory)
    expect((await restarted.store.recover()).action).toBe('recovered-publication')
    expect(restarted.service.loadProjection()).toEqual(canonical)
    restarted.service.close()
  })

  it('fails closed if an unchanged canonical record contradicts a published transaction receipt', async () => {
    const directory = await qaDirectory()
    const initial = fixture()
    const seeded = openStore(directory)
    await seeded.store.initialize(initial)
    seeded.service.close()
    let injected = false
    const interrupted = openStore(directory, (event) => {
      if (!injected && event.boundary === 'canonical-state-durable') {
        injected = true
        throw new Error('synthetic published crash')
      }
    })
    await expect(
      interrupted.store.mutate({
        kind: 'save',
        table: 'slices',
        record: { ...initial.slices[0], title: 'Updated' },
        revision: initial.revision
      })
    ).rejects.toThrow('synthetic published crash')
    interrupted.service.close()
    const unrelatedPath = join(
      canonicalArtifactStorePath(directory),
      canonicalRecordRelativePath('pricing', 'price-test')
    )
    const unrelated = JSON.parse(await readFile(unrelatedPath, 'utf8'))
    unrelated.record.notes = 'Externally changed while publish was pending'
    await writeFile(unrelatedPath, `${JSON.stringify(unrelated, null, 2)}\n`)
    const restarted = openStore(directory)
    await expect(restarted.store.recover()).rejects.toThrow(
      'Published canonical state does not match its pending transaction'
    )
    expect(restarted.service.loadProjection()).toEqual(initial)
    restarted.service.close()
  })

  it('fails closed on malformed/foreign artifacts and incomplete durable receipts', async () => {
    const malformedDirectory = await qaDirectory()
    const malformed = openStore(malformedDirectory)
    const data = fixture()
    await malformed.store.initialize(data)
    const recordPath = join(
      canonicalArtifactStorePath(malformedDirectory),
      canonicalRecordRelativePath('slices', 'slice-test')
    )
    await writeFile(recordPath, '{"kind":"foreign"}\n')
    await expect(malformed.store.loadCanonical()).rejects.toThrow('missing or unknown fields')
    malformed.service.close()

    const foreignDirectory = await qaDirectory()
    const foreign = openStore(foreignDirectory)
    await foreign.store.initialize(fixture())
    await writeFile(
      join(canonicalArtifactStorePath(foreignDirectory), 'artifact-runs-foreign.json'),
      '{"kind":"foreign"}'
    )
    await expect(foreign.store.loadCanonical()).rejects.toThrow(
      'artifact set contradicts dataset-level metadata'
    )
    foreign.service.close()

    const receiptDirectory = await qaDirectory()
    let injected = false
    const interrupted = openStore(receiptDirectory, (event) => {
      if (!injected && event.boundary === 'prepared-receipt-durable') {
        injected = true
        throw new Error('prepared crash')
      }
    })
    await expect(interrupted.store.initialize(fixture())).rejects.toThrow('prepared crash')
    interrupted.service.close()
    const stage = canonicalArtifactStorePath(receiptDirectory)
    await unlink(
      join(
        stage,
        (await readdir(stage)).find((name) => name.startsWith('stage-'))!
      )
    )
    const recovery = openStore(receiptDirectory)
    await expect(recovery.store.recover()).rejects.toThrow('incomplete or contradictory')
    expect(recovery.service.loadProjection()).toBeUndefined()
    recovery.service.close()
  })

  it('refuses projection-only authority and bounds synchronous artifact work before publication', async () => {
    const projectionOnlyDirectory = await qaDirectory()
    const projectionOnly = openStore(projectionOnlyDirectory)
    projectionOnly.service.project(fixture())
    await expect(projectionOnly.store.recover()).rejects.toThrow(
      'projection claims data while canonical dataset artifacts are absent'
    )
    projectionOnly.service.close()

    const oversizedDirectory = await qaDirectory()
    const oversized = openStore(oversizedDirectory)
    const data = fixture()
    data.slices = Array.from({ length: 101 }, (_, index) => ({
      id: `large-${index}`,
      title: `Large ${index}`,
      notes: 'x'.repeat(100_000)
    }))
    data.runs = []
    expect(Buffer.byteLength(JSON.stringify(data))).toBeGreaterThan(MAX_CANONICAL_DATASET_BYTES)
    await expect(oversized.store.initialize(data)).rejects.toThrow('byte limit')
    expect(oversized.service.loadProjection()).toBeUndefined()
    const metadataPath = join(
      canonicalArtifactStorePath(oversizedDirectory),
      CANONICAL_METADATA_RELATIVE_PATH
    )
    await expect(readFile(metadataPath)).rejects.toMatchObject({ code: 'ENOENT' })
    oversized.service.close()
  })

  it('rejects unsafe canonical directory substitution without following it', async () => {
    const directory = await qaDirectory()
    const root = canonicalArtifactStorePath(directory)
    await mkdir(root, { recursive: true })
    await mkdir(join(root, 'artifacts'))
    const { service, store } = openStore(directory)
    await expect(store.initialize(fixture())).rejects.toThrow('store contains an unsafe entry')
    service.close()

    const symlinkDirectory = await qaDirectory()
    const symlinkRoot = canonicalArtifactStorePath(symlinkDirectory)
    await mkdir(symlinkRoot, { recursive: true })
    await symlink(directory, join(symlinkRoot, 'artifacts'))
    const substituted = openStore(symlinkDirectory)
    await expect(substituted.store.initialize(fixture())).rejects.toThrow(
      'store contains an unsafe entry'
    )
    substituted.service.close()
  })

  it('blocks nested-parent substitution before publication and replays the pending receipt after removal', async () => {
    const directory = await qaDirectory()
    const external = await qaDirectory()
    const root = canonicalArtifactStorePath(directory)
    const initial = fixture()
    const original = openStore(directory)
    await original.store.initialize(initial)
    original.service.close()

    const artifactPath = join(root, canonicalRecordRelativePath('slices', initial.slices[0].id))
    const before = await readFile(artifactPath)
    const injected = openStore(directory, async ({ boundary }) => {
      if (boundary === 'publication-authorized') {
        await mkdir(join(root, 'artifacts'))
        await symlink(external, join(root, 'artifacts', 'slices'))
      }
    })
    await expect(
      injected.store.mutate({
        kind: 'save',
        table: 'slices',
        record: { ...initial.slices[0], title: 'Must remain pending' },
        revision: initial.revision
      })
    ).rejects.toThrow('store contains an unsafe entry')
    expect(await readdir(external)).toEqual([])
    expect(await readFile(artifactPath)).toEqual(before)
    expect(injected.service.loadProjection()).toEqual(initial)
    expect(JSON.parse(await readFile(join(root, 'transaction-pending.json'), 'utf8')).state).toBe(
      'publishing'
    )
    await expect(injected.store.recover()).rejects.toThrow('store contains an unsafe entry')
    injected.service.close()

    await unlink(join(root, 'artifacts', 'slices'))
    await rmdir(join(root, 'artifacts'))
    const restarted = openStore(directory)
    expect((await restarted.store.recover()).action).toBe('recovered-publication')
    const recovered = (await restarted.store.loadCanonical())!
    expect(recovered.slices[0].title).toBe('Must remain pending')
    expect(restarted.service.loadProjection()).toEqual(recovered)
    expect((await restarted.store.recover()).action).toBe('none')
    expect(await readdir(external)).toEqual([])
    restarted.service.close()
  })

  it('rejects store-root substitution at the publication boundary before an external write', async () => {
    const directory = await qaDirectory()
    const external = await qaDirectory()
    const root = canonicalArtifactStorePath(directory)
    const displaced = join(directory, 'displaced-store')
    const initial = fixture()
    const seeded = openStore(directory)
    await seeded.store.initialize(initial)
    seeded.service.close()

    const publishing = openStore(directory, async ({ boundary }) => {
      if (boundary === 'publication-authorized') {
        await rename(root, displaced)
        await symlink(external, root)
      }
    })
    await expect(
      publishing.store.mutate({
        kind: 'save',
        table: 'slices',
        record: { ...initial.slices[0], title: 'Pending root swap' },
        revision: initial.revision
      })
    ).rejects.toThrow('storage directory is unsafe')
    expect(await readdir(external)).toEqual([])
    expect(publishing.service.loadProjection()).toEqual(initial)
    expect(
      JSON.parse(await readFile(join(displaced, 'transaction-pending.json'), 'utf8')).state
    ).toBe('publishing')
    publishing.service.close()

    await unlink(root)
    await rename(displaced, root)
    const restarted = openStore(directory)
    expect((await restarted.store.recover()).action).toBe('recovered-publication')
    expect((await restarted.store.loadCanonical())!.slices[0].title).toBe('Pending root swap')
    expect(await readdir(external)).toEqual([])
    restarted.service.close()
  })

  it.each<{
    boundary: 'staged-data-durable' | 'prepared-receipt-durable'
    pendingState: 'absent' | 'prepared'
    recoveryAction: 'none' | 'discarded-prepared'
  }>([
    { boundary: 'staged-data-durable', pendingState: 'absent', recoveryAction: 'none' },
    {
      boundary: 'prepared-receipt-durable',
      pendingState: 'prepared',
      recoveryAction: 'discarded-prepared'
    }
  ])(
    'rejects store-root substitution after $boundary before another receipt write',
    async ({ boundary, pendingState, recoveryAction }) => {
      const directory = await qaDirectory()
      const external = await qaDirectory()
      const root = canonicalArtifactStorePath(directory)
      const displaced = join(directory, 'displaced-store')
      const initial = fixture()
      const seeded = openStore(directory)
      await seeded.store.initialize(initial)
      seeded.service.close()

      const originalArtifact = await readFile(
        join(root, canonicalRecordRelativePath('slices', initial.slices[0].id))
      )
      const saving = openStore(directory, async (event) => {
        if (event.boundary === boundary) {
          await rename(root, displaced)
          await symlink(external, root)
        }
      })
      const mutation = {
        kind: 'save' as const,
        table: 'slices' as const,
        record: { ...initial.slices[0], title: `Retry after ${boundary}` },
        revision: initial.revision
      }
      await expect(saving.store.mutate(mutation)).rejects.toThrow('storage directory is unsafe')
      expect(await readdir(external)).toEqual([])
      expect(
        await readFile(join(displaced, canonicalRecordRelativePath('slices', initial.slices[0].id)))
      ).toEqual(originalArtifact)
      expect(saving.service.loadProjection()).toEqual(initial)
      const displacedNames = await readdir(displaced)
      expect(displacedNames.some((name) => name.startsWith('stage-'))).toBe(true)
      expect(displacedNames.includes('transaction-pending.next.json')).toBe(false)
      if (pendingState === 'prepared') {
        expect(
          JSON.parse(await readFile(join(displaced, 'transaction-pending.json'), 'utf8')).state
        ).toBe('prepared')
      } else {
        expect(displacedNames.includes('transaction-pending.json')).toBe(false)
      }
      saving.service.close()

      await unlink(root)
      await rename(displaced, root)
      const restarted = openStore(directory)
      expect((await restarted.store.recover()).action).toBe(recoveryAction)
      expect(await restarted.store.loadCanonical()).toEqual(initial)
      expect(restarted.service.loadProjection()).toEqual(initial)
      const retried = await restarted.store.mutate(mutation)
      expect(retried.revision).toBe(initial.revision + 1)
      expect(retried.slices[0].title).toBe(mutation.record.title)
      expect(await restarted.store.loadCanonical()).toEqual(retried)
      expect(restarted.service.loadProjection()).toEqual(retried)
      expect((await restarted.store.recover()).action).toBe('none')
      expect(await readdir(external)).toEqual([])
      restarted.service.close()
    }
  )

  it.each<{
    boundary: 'artifact-operation-durable' | 'projection-complete' | 'pending-state-cleared'
    pendingState: 'publishing' | 'published' | 'absent'
    recoveryAction: 'recovered-publication' | 'none'
    projected: boolean
  }>([
    {
      boundary: 'artifact-operation-durable',
      pendingState: 'publishing',
      recoveryAction: 'recovered-publication',
      projected: false
    },
    {
      boundary: 'projection-complete',
      pendingState: 'published',
      recoveryAction: 'recovered-publication',
      projected: true
    },
    {
      boundary: 'pending-state-cleared',
      pendingState: 'absent',
      recoveryAction: 'none',
      projected: true
    }
  ])(
    'revalidates the store root after $boundary before further filesystem mutation',
    async ({ boundary, pendingState, recoveryAction, projected }) => {
      const directory = await qaDirectory()
      const external = await qaDirectory()
      const root = canonicalArtifactStorePath(directory)
      const displaced = join(directory, 'displaced-store')
      const initial = fixture()
      const seeded = openStore(directory)
      await seeded.store.initialize(initial)
      seeded.service.close()

      const saving = openStore(directory, async (event) => {
        if (event.boundary === boundary) {
          await rename(root, displaced)
          await symlink(external, root)
        }
      })
      const mutation = {
        kind: 'save' as const,
        table: 'slices' as const,
        record: { ...initial.slices[0], title: `After ${boundary}` },
        revision: initial.revision
      }
      await expect(saving.store.mutate(mutation)).rejects.toThrow('storage directory is unsafe')
      expect(await readdir(external)).toEqual([])
      expect(saving.service.loadProjection()?.revision).toBe(initial.revision + (projected ? 1 : 0))
      const names = await readdir(displaced)
      if (pendingState === 'absent') {
        expect(names.includes('transaction-pending.json')).toBe(false)
      } else {
        expect(
          JSON.parse(await readFile(join(displaced, 'transaction-pending.json'), 'utf8')).state
        ).toBe(pendingState)
      }
      expect(
        JSON.parse(await readFile(join(displaced, CANONICAL_METADATA_RELATIVE_PATH), 'utf8'))
          .revision
      ).toBe(initial.revision + (projected ? 1 : 0))
      saving.service.close()

      await unlink(root)
      await rename(displaced, root)
      const restarted = openStore(directory)
      expect((await restarted.store.recover()).action).toBe(recoveryAction)
      const recovered = (await restarted.store.loadCanonical())!
      expect(recovered.revision).toBe(initial.revision + 1)
      expect(recovered.slices[0].title).toBe(mutation.record.title)
      expect(restarted.service.loadProjection()).toEqual(recovered)
      expect((await restarted.store.recover()).action).toBe('none')
      expect(await readdir(external)).toEqual([])
      restarted.service.close()
    }
  )
})
