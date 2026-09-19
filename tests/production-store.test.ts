import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  ProductionStore,
  LEGACY_LIVE,
  LEGACY_BACKUP,
  LEGACY_ARCHIVE,
  LEGACY_BACKUP_ARCHIVE,
  MIGRATION_RECEIPT,
  type MigrationBoundary
} from '../src/main/production-store'
import { type CanonicalPublishBoundary } from '../src/main/canonical-artifact-store'
import {
  canonicalArtifactStorePath,
  CANONICAL_METADATA_RELATIVE_PATH
} from '../src/main/canonical-artifacts'
import { projectionDatabasePath, SqliteProjectionRepository } from '../src/main/sqlite-projection'
import { PROJECTION_RECOVERY_DIRECTORY } from '../src/main/production-projection'
import { applyMutation, normalizeDataset } from '../src/shared/data'
import { emptyDataset, type Dataset } from '../src/shared/types'
import { comparisonExport } from '../src/shared/comparison'
import { writeExport } from '../src/main/export'
import { TelemetryStore } from '../src/main/store'
import { comparisonFixture, evidenceFixture, fixture } from './fixtures'
import { registryFixture } from './registry-fixtures'
import registry from '../docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json'

const directory = (): Promise<string> => mkdtemp(join(tmpdir(), 'pennytel-cutover-'))
const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value, null, '\t') + '\r\n')
const bytesReceipt = (value: unknown): string => JSON.stringify(value, null, 2) + '\n'
const boundaries: CanonicalPublishBoundary[] = [
  'staged-data-durable',
  'prepared-receipt-durable',
  'publication-authorized',
  'artifact-operation-durable',
  'canonical-state-durable',
  'projection-complete',
  'pending-state-cleared'
]

async function evidenceSnapshot(path: string): Promise<unknown> {
  const entries = await readdir(path, { withFileTypes: true })
  return Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) => [
        entry.name,
        entry.isDirectory()
          ? await evidenceSnapshot(join(path, entry.name))
          : entry.isSymbolicLink()
            ? ['link', await readlink(join(path, entry.name))]
            : createHash('sha256')
                .update(await readFile(join(path, entry.name)))
                .digest('hex')
      ])
  )
}

function representative(): Dataset {
  const data = comparisonFixture()
  data.revision = 37
  data.registry = registryFixture()
  data.runs[0].executionEvidence = evidenceFixture()
  data.runs.push({ id: 'unknown', sliceId: 'empty', runType: 'QA', role: 'Critic' })
  data.slices[0].title = 'Café 日本語 😀 �'
  return data
}

async function migrated(path: string, data = representative()): Promise<Dataset> {
  await writeFile(join(path, LEGACY_LIVE), bytes(data))
  const store = new ProductionStore(path)
  try {
    return (await store.load()).data
  } finally {
    await store.close()
  }
}

describe('canonical production authority and legacy cutover', () => {
  it.each(['newer-backup', 'equal-revision-different-data'])(
    'rejects %s before creating canonical/receipt/archive or touching projection',
    async (kind) => {
      const path = await directory()
      const data = { ...fixture(), revision: 1 }
      const backup = structuredClone(data)
      if (kind === 'newer-backup') backup.revision = 2
      else backup.slices[0].title = 'Contradictory equal revision'
      await writeFile(join(path, LEGACY_LIVE), bytes(data))
      await writeFile(join(path, LEGACY_BACKUP), bytes(backup))
      const repo = new SqliteProjectionRepository(projectionDatabasePath(path))
      repo.replace(backup)
      repo.close()
      const before = await evidenceSnapshot(path)
      const store = new ProductionStore(path)
      await expect(store.load()).rejects.toThrow('live and backup revisions contradict')
      await expect(store.initializeRegistry()).rejects.toThrow(
        'live and backup revisions contradict'
      )
      await store.close()
      expect(await evidenceSnapshot(path)).toEqual(before)
    }
  )

  it.each(['prior-rotation', 'identical', 'equivalent-export', 'older-restored-backup'])(
    'admits legal legacy relationship %s and archives both exact encodings',
    async (kind) => {
      const path = await directory()
      const data = fixture()
      await writeFile(join(path, LEGACY_LIVE), bytes(data))
      if (kind === 'prior-rotation') {
        await new TelemetryStore(path).mutate({
          kind: 'save',
          table: 'slices',
          revision: data.revision,
          record: { ...data.slices[0], title: 'Rotated by the old store' }
        })
      } else {
        const backup = kind === 'equivalent-export' ? { ...data, schemaVersion: 1 } : data
        await writeFile(
          join(path, LEGACY_BACKUP),
          kind === 'equivalent-export' ? JSON.stringify(backup) : bytes(backup)
        )
        if (kind === 'older-restored-backup')
          await writeFile(join(path, LEGACY_LIVE), bytes({ ...data, revision: 9 }))
      }
      const live = await readFile(join(path, LEGACY_LIVE))
      const backup = await readFile(join(path, LEGACY_BACKUP))
      const store = new ProductionStore(path)
      expect((await store.load()).data).toEqual(normalizeDataset(JSON.parse(live.toString())))
      await store.close()
      expect(await readFile(join(path, LEGACY_ARCHIVE))).toEqual(live)
      expect(await readFile(join(path, LEGACY_BACKUP_ARCHIVE))).toEqual(backup)
    }
  )

  it.each(['migrating', 'retired'])(
    'does not grandfather contradictory live/backup relationships in a %s receipt',
    async (state) => {
      const path = await directory()
      const live = bytes({ ...fixture(), revision: 1 })
      const backup = bytes({ ...fixture(), revision: 2 })
      await writeFile(join(path, state === 'retired' ? LEGACY_ARCHIVE : LEGACY_LIVE), live)
      await writeFile(
        join(path, state === 'retired' ? LEGACY_BACKUP_ARCHIVE : LEGACY_BACKUP),
        backup
      )
      await writeFile(
        join(path, MIGRATION_RECEIPT),
        bytesReceipt({
          kind: 'pennytel-legacy-migration',
          version: 1,
          state,
          liveSha256: createHash('sha256').update(live).digest('hex'),
          backupSha256: createHash('sha256').update(backup).digest('hex')
        })
      )
      const before = await evidenceSnapshot(path)
      const store = new ProductionStore(path)
      await expect(store.load()).rejects.toThrow('live and backup revisions contradict')
      await store.close()
      expect(await evidenceSnapshot(path)).toEqual(before)
    }
  )

  it.each(['valid', 'invalid', 'sidecars'])(
    'preserves all evidence on unjournaled canonical/legacy contradiction with %s projection',
    async (kind) => {
      const path = await directory()
      const initial = new ProductionStore(path)
      await initial.load()
      await initial.close()
      const legacy = { ...fixture(), revision: 1 }
      await writeFile(join(path, LEGACY_LIVE), bytes(legacy))
      const repo = new SqliteProjectionRepository(projectionDatabasePath(path))
      repo.replace(legacy)
      repo.close()
      if (kind === 'invalid') await writeFile(projectionDatabasePath(path), 'invalid evidence')
      if (kind === 'sidecars') {
        await writeFile(`${projectionDatabasePath(path)}-wal`, 'WAL evidence')
        await writeFile(`${projectionDatabasePath(path)}-shm`, 'SHM evidence')
      }
      // These would previously be removed by ensureLayout/cleanWorkDirectories.
      await writeFile(join(canonicalArtifactStorePath(path), 'transaction-pending.next.json'), '{}')
      await writeFile(join(canonicalArtifactStorePath(path), 'stage-put-0.json'), 'staged evidence')
      const before = await evidenceSnapshot(path)
      const store = new ProductionStore(path)
      await expect(store.load()).rejects.toThrow('contradict')
      await store.close()
      expect(await evidenceSnapshot(path)).toEqual(before)
    }
  )

  it.each(['empty-directory', 'quarantined-database', 'dangling-link', 'unexpected-file'])(
    'refuses a new profile with projection recovery evidence: %s',
    async (kind) => {
      const path = await directory()
      const recovery = join(path, PROJECTION_RECOVERY_DIRECTORY)
      if (kind === 'dangling-link') await symlink(join(path, 'absent'), recovery)
      else if (kind === 'unexpected-file') await writeFile(recovery, 'recovery evidence')
      else {
        await mkdir(recovery)
        if (kind === 'quarantined-database')
          await writeFile(join(recovery, 'rejected-pennytel-projection.sqlite'), 'invalid SQLite')
      }
      const before = await evidenceSnapshot(path)
      const store = new ProductionStore(path)
      await expect(store.initializeRegistry()).rejects.toThrow('Projection-only recovery')
      await store.close()
      expect(await evidenceSnapshot(path)).toEqual(before)
    }
  )

  it('refuses a new profile after real quarantine when canonical and active projection disappear', async () => {
    const path = await directory()
    let store = new ProductionStore(path)
    await store.load()
    await store.close()
    await writeFile(projectionDatabasePath(path), 'invalid SQLite for quarantine')
    store = new ProductionStore(path)
    await store.load()
    await store.close()
    const preserved = await directory()
    await rename(canonicalArtifactStorePath(path), join(preserved, 'canonical'))
    await rename(projectionDatabasePath(path), join(preserved, 'projection'))
    const before = await evidenceSnapshot(path)
    store = new ProductionStore(path)
    await expect(store.load()).rejects.toThrow('Projection-only recovery')
    await store.close()
    expect(await evidenceSnapshot(path)).toEqual(before)
  })

  it('initializes and concurrently seeds a genuinely new profile exactly once', async () => {
    const path = await directory()
    const store = new ProductionStore(path)
    try {
      expect((await store.load()).data).toEqual(emptyDataset())
      const results = await Promise.all([
        store.initializeRegistry(),
        store.initializeRegistry(),
        store.load()
      ])
      for (const result of results) {
        expect(result.data.revision).toBe(1)
        expect(result.data.registry?.kind).toBe('pennytel-model-registry')
        expect(result.path).toBe(canonicalArtifactStorePath(path))
      }
      expect((await readdir(path)).filter((name) => name.startsWith('telemetry'))).toEqual([])
    } finally {
      await store.close()
    }
  })

  it.each(
    [1, 2].flatMap((schemaVersion) =>
      [false, true].flatMap((withBackup) =>
        [false, true].map((withRegistry) => ({ schemaVersion, withBackup, withRegistry }))
      )
    )
  )(
    'migrates v$schemaVersion losslessly (backup=$withBackup, registry=$withRegistry)',
    async ({ schemaVersion, withBackup, withRegistry }) => {
      const path = await directory()
      const data = representative()
      if (schemaVersion === 1) delete data.runs[0].executionEvidence
      if (!withRegistry) delete data.registry
      const live = bytes({ ...data, schemaVersion })
      const backup = bytes({ ...fixture(), schemaVersion, revision: 2 })
      await writeFile(join(path, LEGACY_LIVE), live)
      if (withBackup) await writeFile(join(path, LEGACY_BACKUP), backup)
      const store = new ProductionStore(path)
      let expected: Dataset
      try {
        expect((await store.load()).data).toEqual(data)
        const loaded = (await store.initializeRegistry()).data
        expected = withRegistry
          ? data
          : applyMutation(data, {
              kind: 'registry-import',
              text: JSON.stringify(registry),
              revision: data.revision
            })
        expect(loaded).toEqual(expected)
        expect(loaded.runs.find((run) => run.id === 'unknown')).not.toHaveProperty('outputTokens')
        expect(loaded.runs.find((run) => run.id === 'luna-critic')!.outputTokens).toBe(0)
        expect(await readFile(join(path, LEGACY_ARCHIVE))).toEqual(live)
        if (withBackup) expect(await readFile(join(path, LEGACY_BACKUP_ARCHIVE))).toEqual(backup)
        expect(await readdir(path)).not.toContain(LEGACY_LIVE)
        expect(await readdir(path)).not.toContain(LEGACY_BACKUP)
      } finally {
        await store.close()
      }
      const restarted = new ProductionStore(path)
      try {
        expect((await restarted.initializeRegistry()).data).toEqual(expected!)
      } finally {
        await restarted.close()
      }
    }
  )

  it.each<MigrationBoundary>([
    'receipt-durable',
    'canonical-verified',
    'live-archived',
    'backup-archived',
    'retirement-durable'
  ])('restarts idempotently after %s', async (boundary) => {
    const path = await directory()
    const data = representative()
    const live = bytes(data)
    const backup = bytes(fixture())
    await writeFile(join(path, LEGACY_LIVE), live)
    await writeFile(join(path, LEGACY_BACKUP), backup)
    const interrupted = new ProductionStore(path, {
      faultInjector: (event) => {
        if (event === boundary) throw new Error('synthetic migration crash')
      }
    })
    await expect(interrupted.load()).rejects.toThrow('synthetic migration crash')
    await interrupted.close()
    const restarted = new ProductionStore(path)
    try {
      expect((await restarted.load()).data).toEqual(data)
      expect((await restarted.load()).data).toEqual(data)
      expect(await readFile(join(path, LEGACY_ARCHIVE))).toEqual(live)
      expect(await readFile(join(path, LEGACY_BACKUP_ARCHIVE))).toEqual(backup)
      expect(await readdir(path)).not.toContain(LEGACY_LIVE)
      expect(await readdir(path)).not.toContain(LEGACY_BACKUP)
    } finally {
      await restarted.close()
    }
  })

  it.each(boundaries)(
    'reuses S10 recovery after migration publication boundary %s',
    async (boundary) => {
      const path = await directory()
      const data = representative()
      await writeFile(join(path, LEGACY_LIVE), bytes(data))
      let once = false
      const interrupted = new ProductionStore(path, {
        canonical: {
          faultInjector: (event) => {
            if (!once && event.boundary === boundary) {
              once = true
              throw new Error('synthetic canonical crash')
            }
          }
        }
      })
      await expect(interrupted.load()).rejects.toThrow('synthetic canonical crash')
      await interrupted.close()
      const restarted = new ProductionStore(path)
      try {
        expect((await restarted.load()).data).toEqual(data)
        expect(await readFile(join(path, LEGACY_ARCHIVE))).toEqual(bytes(data))
      } finally {
        await restarted.close()
      }
    }
  )

  it.each(boundaries)(
    'restarts registry initialization through canonical recovery after %s',
    async (boundary) => {
      const path = await directory()
      const data = fixture()
      await migrated(path, data)
      const expected = applyMutation(data, {
        kind: 'registry-import',
        revision: data.revision,
        text: JSON.stringify(registry)
      })
      let once = false
      const interrupted = new ProductionStore(path, {
        canonical: {
          faultInjector: (event) => {
            if (!once && event.boundary === boundary) {
              once = true
              throw new Error('synthetic registry crash')
            }
          }
        }
      })
      await expect(interrupted.initializeRegistry()).rejects.toThrow('synthetic registry crash')
      await interrupted.close()
      const restarted = new ProductionStore(path)
      try {
        expect((await restarted.initializeRegistry()).data).toEqual(expected)
        expect(await readFile(join(path, LEGACY_ARCHIVE))).toEqual(bytes(data))
      } finally {
        await restarted.close()
      }
    }
  )

  it.each(['initial', 'retirement', 'partial'])(
    'handles %s migration receipt publication interruption without guessing',
    async (phase) => {
      const path = await directory()
      const data = representative()
      await writeFile(join(path, LEGACY_LIVE), bytes(data))
      const interrupted = new ProductionStore(path, {
        faultInjector: (boundary) => {
          if (boundary === (phase === 'retirement' ? 'backup-archived' : 'receipt-durable'))
            throw new Error('receipt interruption')
        }
      })
      await expect(interrupted.load()).rejects.toThrow('receipt interruption')
      await interrupted.close()
      const nextPath = join(path, 'legacy-migration.next.json')
      const receiptPath = join(path, MIGRATION_RECEIPT)
      if (phase === 'initial') await rename(receiptPath, nextPath)
      else if (phase === 'partial') await writeFile(nextPath, '{')
      else {
        const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
        await writeFile(nextPath, JSON.stringify({ ...receipt, state: 'retired' }, null, 2) + '\n')
      }
      const store = new ProductionStore(path)
      try {
        if (phase === 'partial') {
          await expect(store.load()).rejects.toThrow()
          expect(await readFile(nextPath, 'utf8')).toBe('{')
          expect(await readFile(join(path, LEGACY_LIVE))).toEqual(bytes(data))
        } else {
          expect((await store.load()).data).toEqual(data)
          expect(await readFile(join(path, LEGACY_ARCHIVE))).toEqual(bytes(data))
          expect(await readdir(path)).not.toContain('legacy-migration.next.json')
        }
      } finally {
        await store.close()
      }
    }
  )

  it('preserves a changed source and blocks retirement after canonical verification', async () => {
    const path = await directory()
    const data = representative()
    const changed = bytes({ ...data, revision: data.revision + 1 })
    await writeFile(join(path, LEGACY_LIVE), bytes(data))
    const store = new ProductionStore(path, {
      faultInjector: async (boundary) => {
        if (boundary === 'canonical-verified') await writeFile(join(path, LEGACY_LIVE), changed)
      }
    })
    await expect(store.load()).rejects.toThrow('contradictory')
    await store.close()
    expect(await readFile(join(path, LEGACY_LIVE))).toEqual(changed)
    expect(await readdir(path)).not.toContain(LEGACY_ARCHIVE)
    const restarted = new ProductionStore(path)
    await expect(restarted.load()).rejects.toThrow('contradictory')
    await restarted.close()
  })

  it('blocks late legacy evidence and equal-byte archive replacement before writes', async () => {
    const path = await directory()
    const data = await migrated(path)
    const store = new ProductionStore(path)
    await store.load()
    const replacement = join(path, 'replacement.json')
    await writeFile(replacement, bytes(data))
    await rename(replacement, join(path, LEGACY_ARCHIVE))
    await expect(
      store.mutate({ kind: 'delete', table: 'slices', id: 'empty', revision: data.revision })
    ).rejects.toThrow('changed outside')
    await store.close()
    const restarted = new ProductionStore(path)
    await restarted.load()
    await writeFile(join(path, LEGACY_BACKUP), bytes(data))
    await expect(restarted.load()).rejects.toThrow('changed outside')
    await restarted.close()
  })

  it.each(['receipt', 'live'])(
    'preserves late %s contradictions during retirement',
    async (changed) => {
      const path = await directory()
      const data = representative()
      await writeFile(join(path, LEGACY_LIVE), bytes(data))
      const store = new ProductionStore(path, {
        faultInjector: async (boundary) => {
          if (changed === 'receipt' && boundary === 'backup-archived')
            await writeFile(join(path, MIGRATION_RECEIPT), 'foreign receipt')
          if (changed === 'live' && boundary === 'retirement-durable')
            await writeFile(join(path, LEGACY_LIVE), bytes(data))
        }
      })
      await expect(store.load()).rejects.toThrow(/changed outside|contradictory/)
      await store.close()
      expect(await readFile(join(path, LEGACY_ARCHIVE))).toEqual(bytes(data))
      if (changed === 'receipt')
        expect(await readFile(join(path, MIGRATION_RECEIPT), 'utf8')).toBe('foreign receipt')
      else expect(await readFile(join(path, LEGACY_LIVE))).toEqual(bytes(data))
    }
  )

  it('never rebuilds invalid SQLite from invalid canonical artifacts', async () => {
    const path = await directory()
    await migrated(path)
    await writeFile(join(canonicalArtifactStorePath(path), CANONICAL_METADATA_RELATIVE_PATH), '{')
    await writeFile(projectionDatabasePath(path), 'invalid projection to preserve')
    const store = new ProductionStore(path)
    await expect(store.load()).rejects.toThrow('not valid JSON')
    await store.close()
    expect(await readFile(projectionDatabasePath(path), 'utf8')).toBe(
      'invalid projection to preserve'
    )
    expect(await readdir(path)).not.toContain(PROJECTION_RECOVERY_DIRECTORY)
  })

  it.each([
    'backup-only',
    'malformed-live',
    'foreign-live',
    'utf8',
    'bad-backup',
    'symlink-live',
    'dangling-backup',
    'directory-live',
    'hardlink-live',
    'orphan-archive',
    'bad-receipt'
  ])('fails closed and preserves %s evidence', async (kind) => {
    const path = await directory()
    const live = join(path, LEGACY_LIVE)
    const backup = join(path, LEGACY_BACKUP)
    if (kind === 'backup-only') await writeFile(backup, bytes(fixture()))
    else if (kind === 'malformed-live') await writeFile(live, '{')
    else if (kind === 'foreign-live') await writeFile(live, '{"foreign":true}')
    else if (kind === 'utf8') await writeFile(live, Buffer.from([0xff]))
    else if (kind === 'directory-live') await mkdir(live)
    else if (kind === 'orphan-archive')
      await writeFile(join(path, LEGACY_ARCHIVE), bytes(fixture()))
    else if (kind === 'bad-receipt') await writeFile(join(path, MIGRATION_RECEIPT), '{}')
    else {
      await writeFile(join(path, 'source.json'), bytes(fixture()))
      if (kind === 'symlink-live' || kind === 'hardlink-live')
        await (kind === 'symlink-live' ? symlink : link)(join(path, 'source.json'), live)
      else {
        await writeFile(live, bytes(fixture()))
        if (kind === 'bad-backup') await writeFile(backup, '{')
        else await symlink(join(path, 'missing'), backup)
      }
    }
    const before = (await readdir(path)).sort()
    const store = new ProductionStore(path)
    await expect(store.load()).rejects.toThrow()
    await expect(store.initializeRegistry()).rejects.toThrow()
    await store.close()
    expect((await readdir(path)).sort()).toEqual(before)
  })

  it('blocks contradictions, recreated legacy files and missing canonical authority after retirement', async () => {
    const path = await directory()
    const data = await migrated(path)
    await writeFile(join(path, LEGACY_LIVE), bytes(data))
    let store = new ProductionStore(path)
    await expect(store.load()).rejects.toThrow(/contradictory|reappeared/)
    await store.close()
    await unlink(join(path, LEGACY_LIVE))
    await rename(canonicalArtifactStorePath(path), join(path, 'preserved-canonical'))
    store = new ProductionStore(path)
    await expect(store.load()).rejects.toThrow('missing after legacy retirement')
    await store.close()
    expect(await readFile(join(path, LEGACY_ARCHIVE))).toEqual(bytes(data))
  })

  it('blocks canonical plus unjournaled legacy, even with identical Dataset semantics', async () => {
    const path = await directory()
    const store = new ProductionStore(path)
    const { data } = await store.load()
    await store.close()
    await writeFile(join(path, LEGACY_LIVE), bytes(data))
    const restarted = new ProductionStore(path)
    await expect(restarted.load()).rejects.toThrow('contradict')
    await restarted.close()
    expect(await readFile(join(path, LEGACY_LIVE))).toEqual(bytes(data))
  })

  it('blocks a differing canonical Dataset before retirement rather than choosing either source', async () => {
    const path = await directory()
    const data = representative()
    await writeFile(join(path, LEGACY_LIVE), bytes(data))
    const interrupted = new ProductionStore(path, {
      faultInjector: (boundary) => {
        if (boundary === 'canonical-verified') throw new Error('interrupted')
      }
    })
    await expect(interrupted.load()).rejects.toThrow('interrupted')
    await interrupted.close()
    const metadata = join(canonicalArtifactStorePath(path), CANONICAL_METADATA_RELATIVE_PATH)
    const value = JSON.parse(await readFile(metadata, 'utf8'))
    await writeFile(
      metadata,
      JSON.stringify({ ...value, revision: value.revision + 1 }, null, 2) + '\n'
    )
    const before = await evidenceSnapshot(path)
    const restarted = new ProductionStore(path)
    await expect(restarted.load()).rejects.toThrow('contradicts the legacy')
    await restarted.close()
    expect(await evidenceSnapshot(path)).toEqual(before)
  })

  it.each(boundaries.filter((boundary) => boundary !== 'staged-data-durable'))(
    'preserves pending canonical, migration and projection evidence on source contradiction at %s',
    async (boundary) => {
      const path = await directory()
      const data = fixture()
      await writeFile(join(path, LEGACY_LIVE), bytes(data))
      const interrupted = new ProductionStore(path, {
        canonical: {
          faultInjector: (event) => {
            if (event.boundary === boundary) throw new Error('synthetic canonical crash')
          }
        }
      })
      await expect(interrupted.load()).rejects.toThrow('synthetic canonical crash')
      await interrupted.close()
      // A self-consistent migration receipt still cannot authorize a different
      // canonical publication, even at the same revision.
      data.slices[0].title = 'Conflicting source at the same revision'
      const changed = bytes(data)
      await writeFile(join(path, LEGACY_LIVE), changed)
      const receipt = JSON.parse(await readFile(join(path, MIGRATION_RECEIPT), 'utf8'))
      receipt.liveSha256 = createHash('sha256').update(changed).digest('hex')
      await writeFile(join(path, MIGRATION_RECEIPT), bytesReceipt(receipt))
      const repository = new SqliteProjectionRepository(projectionDatabasePath(path))
      repository.replace(data)
      repository.close()
      const before = await evidenceSnapshot(path)
      const restarted = new ProductionStore(path)
      await expect(restarted.load()).rejects.toThrow('contradicts the legacy')
      await restarted.close()
      expect(await evidenceSnapshot(path)).toEqual(before)
    }
  )

  it('preserves a partial canonical publication with a contradictory later target', async () => {
    const path = await directory()
    await writeFile(join(path, LEGACY_LIVE), bytes(fixture()))
    const interrupted = new ProductionStore(path, {
      canonical: {
        faultInjector: ({ boundary }) => {
          if (boundary === 'artifact-operation-durable') throw new Error('partial publication')
        }
      }
    })
    await expect(interrupted.load()).rejects.toThrow('partial publication')
    await interrupted.close()
    await writeFile(join(canonicalArtifactStorePath(path), CANONICAL_METADATA_RELATIVE_PATH), '{}')
    const before = await evidenceSnapshot(path)
    const restarted = new ProductionStore(path)
    await expect(restarted.load()).rejects.toThrow('contradicts the legacy')
    await restarted.close()
    expect(await evidenceSnapshot(path)).toEqual(before)
  })

  it.each([LEGACY_ARCHIVE, LEGACY_BACKUP_ARCHIVE, MIGRATION_RECEIPT, 'legacy-migration.next.json'])(
    'refuses empty new-profile initialization with unresolved %s evidence',
    async (name) => {
      const path = await directory()
      await writeFile(join(path, name), '{}')
      const before = await evidenceSnapshot(path)
      const store = new ProductionStore(path)
      await expect(store.initializeRegistry()).rejects.toThrow()
      await store.close()
      expect(await evidenceSnapshot(path)).toEqual(before)
    }
  )

  it.each([
    'missing',
    'empty',
    'stale',
    'malformed',
    'foreign',
    'unsupported',
    'invalid-content',
    'orphan-sidecars'
  ])('rebuilds %s projection solely from canonical truth', async (kind) => {
    const path = await directory()
    const expected = await migrated(path)
    const databasePath = projectionDatabasePath(path)
    if (kind === 'missing' || kind === 'orphan-sidecars') {
      await unlink(databasePath)
      if (kind === 'orphan-sidecars') {
        await writeFile(`${databasePath}-wal`, 'old WAL')
        await writeFile(`${databasePath}-shm`, 'old SHM')
      }
    } else if (kind === 'empty') await writeFile(databasePath, '')
    else if (kind === 'malformed') await writeFile(databasePath, 'not a database')
    else if (kind === 'stale') {
      const repo = new SqliteProjectionRepository(databasePath)
      repo.replace(emptyDataset())
      repo.close()
    } else {
      const database = new DatabaseSync(databasePath)
      if (kind === 'foreign') database.exec('PRAGMA application_id = 42')
      else if (kind === 'unsupported') database.exec('PRAGMA user_version = 99')
      else database.exec("UPDATE runs SET record_json = '{}'")
      database.close()
    }
    const store = new ProductionStore(path)
    expect((await store.load()).data).toEqual(expected)
    await store.close()
    const repository = new SqliteProjectionRepository(databasePath)
    expect(repository.load()).toEqual(expected)
    repository.close()
    if (
      ['malformed', 'foreign', 'unsupported', 'invalid-content', 'orphan-sidecars'].includes(kind)
    )
      expect((await readdir(join(path, PROJECTION_RECOVERY_DIRECTORY))).length).toBeGreaterThan(0)
  })

  it.each(['database-link', 'wal-link', 'shm-directory', 'hardlink', 'recovery-link'])(
    'fails closed for unsafe projection %s',
    async (kind) => {
      const path = await directory()
      await migrated(path)
      const db = projectionDatabasePath(path)
      const target = join(path, 'protected')
      await writeFile(target, 'preserve me')
      if (kind === 'database-link' || kind === 'hardlink') {
        await unlink(db)
        await (kind === 'hardlink' ? link : symlink)(target, db)
      } else if (kind === 'wal-link') await symlink(target, `${db}-wal`)
      else if (kind === 'shm-directory') await mkdir(`${db}-shm`)
      else {
        await writeFile(db, 'invalid')
        await symlink(path, join(path, PROJECTION_RECOVERY_DIRECTORY))
      }
      const store = new ProductionStore(path)
      await expect(store.load()).rejects.toThrow(/Unsafe/)
      await store.close()
      expect(await readFile(target, 'utf8')).toBe('preserve me')
    }
  )

  it('uses legacy rather than an old projection, but fails closed for projection-only recovery', async () => {
    for (const legacy of [false, true]) {
      const path = await directory()
      const repository = new SqliteProjectionRepository(projectionDatabasePath(path))
      repository.replace(representative())
      repository.close()
      if (legacy) await writeFile(join(path, LEGACY_LIVE), bytes(fixture()))
      const store = new ProductionStore(path)
      if (legacy) expect((await store.load()).data).toEqual(fixture())
      else await expect(store.load()).rejects.toThrow('Projection-only recovery')
      await store.close()
    }
  })

  it('routes save/delete/import/batch/export/comparison through canonical storage without legacy writes', async () => {
    const path = await directory()
    const source = representative()
    await migrated(path, source)
    const store = new ProductionStore(path)
    const archive = await readFile(join(path, LEGACY_ARCHIVE))
    try {
      let { data } = await store.load()
      data = (
        await store.mutate({
          kind: 'save',
          table: 'slices',
          record: { id: 'new', title: 'Saved' },
          revision: data.revision
        })
      ).data
      await expect(
        store.mutate({ kind: 'delete', table: 'slices', id: 'new', revision: data.revision - 1 })
      ).rejects.toThrow('changed since')
      data = (
        await store.mutate({ kind: 'delete', table: 'slices', id: 'new', revision: data.revision })
      ).data
      const incoming = { ...emptyDataset(), slices: [{ id: 'imported', title: 'Imported' }] }
      const text = JSON.stringify(incoming)
      expect((await store.preview(text)).counts.slices).toBe(1)
      data = (await store.mutate({ kind: 'import', text, revision: data.revision })).data
      const batch = { schemaVersion: 2, slices: [{ id: 'batch', title: 'Batch' }] }
      data = (
        await store.mutate({
          kind: 'batch-import',
          sources: [{ path: 'batch.pennytel.json', text: JSON.stringify(batch) }],
          revision: data.revision
        })
      ).data
      expect(data.slices.map(({ id }) => id)).toContain('batch')
      expect((await store.preview(text)).skipped).toBe(1)
      await expect(
        store.mutate({
          kind: 'import',
          text: JSON.stringify({ ...incoming, slices: [{ id: 'imported', title: 'Conflicting' }] }),
          revision: data.revision
        })
      ).rejects.toThrow()
      const exportPath = join(path, 'raw-export.json')
      await writeExport(
        exportPath,
        (await store.load()).data,
        store.protectedPaths,
        store.protectedDirectories
      )
      expect(normalizeDataset(JSON.parse(await readFile(exportPath, 'utf8')))).toEqual(data)
      expect(
        comparisonExport(
          data,
          { revision: data.revision, context: { filters: {}, groupBy: 'model', sort: 'label' } },
          'QA',
          '2026-09-19T00:00:00Z'
        )
      ).toBeDefined()
      for (const destination of [
        ...store.protectedPaths,
        join(store.path, 'transaction-pending.json'),
        join(store.path, 'arbitrary-new.json'),
        join(store.path, CANONICAL_METADATA_RELATIVE_PATH)
      ])
        await expect(
          writeExport(destination, data, store.protectedPaths, store.protectedDirectories)
        ).rejects.toThrow()
      const alias = join(path, 'archive-alias.json')
      await link(join(path, LEGACY_ARCHIVE), alias)
      await expect(
        writeExport(alias, data, store.protectedPaths, store.protectedDirectories)
      ).rejects.toThrow()
      await unlink(alias)
      expect(await readFile(join(path, LEGACY_ARCHIVE))).toEqual(archive)
      expect(await readdir(path)).not.toContain(LEGACY_LIVE)
      expect(await readdir(path)).not.toContain(LEGACY_BACKUP)
    } finally {
      await store.close()
    }
  })
})
