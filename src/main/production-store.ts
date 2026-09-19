import { createHash } from 'node:crypto'
import { renameSync } from 'node:fs'
import { isDeepStrictEqual, TextDecoder } from 'node:util'
import canonicalRegistry from '../../docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json'
import { mergeImport, normalizeDataset } from '../shared/data'
import {
  emptyDataset,
  type Dataset,
  type ImportPreview,
  type LoadedData,
  type Mutation
} from '../shared/types'
import {
  CanonicalArtifactStore,
  type CanonicalArtifactStoreOptions
} from './canonical-artifact-store'
import { canonicalArtifactStorePath } from './canonical-artifacts'
import { MainProcessStorageService } from './storage-service'
import {
  ProductionProjection,
  PROJECTION_FILES,
  PROJECTION_RECOVERY_DIRECTORY
} from './production-projection'
import { entry, StorageFiles, syncDirectory } from './storage-files'

export const LEGACY_LIVE = 'telemetry.json'
export const LEGACY_BACKUP = 'telemetry.backup.json'
export const LEGACY_ARCHIVE = 'telemetry.legacy-archive.json'
export const LEGACY_BACKUP_ARCHIVE = 'telemetry.backup.legacy-archive.json'
export const MIGRATION_RECEIPT = 'legacy-migration.json'
const NEXT_RECEIPT = 'legacy-migration.next.json'

interface MigrationReceipt {
  kind: 'pennytel-legacy-migration'
  version: 1
  state: 'migrating' | 'retired'
  liveSha256: string
  backupSha256: string | null
}

export type MigrationBoundary =
  | 'receipt-durable'
  | 'canonical-verified'
  | 'live-archived'
  | 'backup-archived'
  | 'retirement-durable'
export interface ProductionStoreOptions {
  canonical?: CanonicalArtifactStoreOptions
  faultInjector?: (boundary: MigrationBoundary) => void | Promise<void>
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function parse(bytes: Buffer): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
}

function receiptBytes(receipt: MigrationReceipt): Buffer {
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)
}

function readReceipt(bytes: Buffer): MigrationReceipt {
  const value = parse(bytes) as MigrationReceipt
  if (
    !value ||
    value.kind !== 'pennytel-legacy-migration' ||
    value.version !== 1 ||
    !['migrating', 'retired'].includes(value.state) ||
    !/^[a-f0-9]{64}$/.test(value.liveSha256) ||
    !(value.backupSha256 === null || /^[a-f0-9]{64}$/.test(value.backupSha256)) ||
    Object.keys(value).sort().join(',') !== 'backupSha256,kind,liveSha256,state,version' ||
    !bytes.equals(receiptBytes(value))
  )
    throw new Error('Ambiguous legacy migration receipt; evidence preserved.')
  return value
}

function validateLegacyPair(live: Dataset, backup: Dataset | undefined): void {
  // TelemetryStore rotates exact live bytes before replacing live. Interrupted
  // replacement (or restoring that backup/export) can leave equivalent states.
  // Restores carry no durable revision-chain proof, so do not require adjacency,
  // identical encoding/schema versions, or monotonic record membership.
  if (
    backup &&
    (backup.revision > live.revision ||
      (backup.revision === live.revision && !isDeepStrictEqual(backup, live)))
  )
    throw new Error('Legacy live and backup revisions contradict each other; files preserved.')
}

/** The only normal production composition. Legacy data is input/archive only;
 * all Dataset writes, including registry seeding, go through the S10 store. */
export class ProductionStore {
  readonly path: string
  private files?: StorageFiles
  private artifacts?: CanonicalArtifactStore
  private service?: MainProcessStorageService
  private ready?: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private evidence?: ReturnType<ProductionStore['snapshotEvidence']>
  private closed = false

  constructor(
    private readonly directory: string,
    private readonly options: ProductionStoreOptions = {}
  ) {
    this.path = canonicalArtifactStorePath(directory)
  }

  get protectedPaths(): string[] {
    return [...this.evidenceNames, ...PROJECTION_FILES].map((name) => this.files!.path(name))
  }

  get protectedDirectories(): string[] {
    return [this.path, this.files!.path(PROJECTION_RECOVERY_DIRECTORY)]
  }

  private readonly evidenceNames = [
    LEGACY_LIVE,
    LEGACY_BACKUP,
    LEGACY_ARCHIVE,
    LEGACY_BACKUP_ARCHIVE,
    MIGRATION_RECEIPT,
    NEXT_RECEIPT
  ]

  private snapshotEvidence(): Array<{ bytes: Buffer | undefined; identity: string | undefined }> {
    return this.evidenceNames.map((name) => {
      const bytes = this.files!.read(name)
      const stat = this.files!.regular(name)
      return { bytes, identity: stat ? `${stat.dev}:${stat.ino}:${stat.ctimeMs}` : undefined }
    })
  }

  private assertEvidence(): void {
    if (!isDeepStrictEqual(this.snapshotEvidence(), this.evidence))
      throw new Error(
        'Storage evidence changed outside PennyTel; files preserved. Close and reopen PennyTel.'
      )
  }

  private async boundary(boundary: MigrationBoundary): Promise<void> {
    await this.options.faultInjector?.(boundary)
  }

  private writeReceipt(receipt: MigrationReceipt): void {
    const files = this.files!
    const expected =
      receipt.state === 'retired' ? receiptBytes({ ...receipt, state: 'migrating' }) : undefined
    if (!isDeepStrictEqual(files.read(MIGRATION_RECEIPT, 4096), expected))
      throw new Error('Migration receipt changed outside PennyTel; evidence preserved.')
    files.writeNew(NEXT_RECEIPT, receiptBytes(receipt))
    files.regular(MIGRATION_RECEIPT)
    renameSync(files.path(NEXT_RECEIPT), files.path(MIGRATION_RECEIPT))
    syncDirectory(files.directory)
  }

  private migrationSource(receipt: MigrationReceipt): { data: Dataset; archived: boolean } {
    const files = this.files!
    let data: Dataset | undefined
    let backupData: Dataset | undefined
    let archived = false
    for (const [live, archive, digest] of [
      [LEGACY_LIVE, LEGACY_ARCHIVE, receipt.liveSha256],
      [LEGACY_BACKUP, LEGACY_BACKUP_ARCHIVE, receipt.backupSha256]
    ] as const) {
      const source = files.read(live)
      const saved = files.read(archive)
      if (digest === null) {
        if (source || saved)
          throw new Error('Unexpected legacy backup evidence; migration blocked.')
        continue
      }
      if ((source === undefined) === (saved === undefined) || hash((source ?? saved)!) !== digest)
        throw new Error('Legacy migration evidence is missing or contradictory; files preserved.')
      const parsed = normalizeDataset(parse((source ?? saved)!))
      if (saved) archived = true
      if (live === LEGACY_LIVE) data = parsed
      else backupData = parsed
      if (receipt.state === 'retired' && source)
        throw new Error('Retired legacy live storage reappeared; files preserved.')
    }
    validateLegacyPair(data!, backupData)
    return { data: data!, archived }
  }

  private async start(): Promise<void> {
    const files = (this.files = new StorageFiles(this.directory))
    // A complete next receipt can only be an interrupted atomic receipt write.
    // Accept it only if it proves the same source and a legal state transition.
    const initialEvidence = this.snapshotEvidence()
    const receipt = files.read(MIGRATION_RECEIPT, 4096)
    const next = files.read(NEXT_RECEIPT, 4096)
    if (next) {
      const candidate = readReceipt(next)
      const previous = receipt ? readReceipt(receipt) : undefined
      if (
        (!previous && candidate.state !== 'migrating') ||
        (previous &&
          (previous.state !== 'migrating' ||
            candidate.state !== 'retired' ||
            previous.liveSha256 !== candidate.liveSha256 ||
            previous.backupSha256 !== candidate.backupSha256))
      )
        throw new Error('Contradictory migration receipt transition; evidence preserved.')
      this.migrationSource(candidate)
      // Defer promotion until canonical validation below. Partial/malformed next
      // receipts fail closed; no authoritative source has been removed by them.
    }
    let migration = receipt ? readReceipt(receipt) : next ? readReceipt(next) : undefined
    let source = migration ? this.migrationSource(migration) : undefined
    if (!migration && (files.read(LEGACY_ARCHIVE) || files.read(LEGACY_BACKUP_ARCHIVE)))
      throw new Error('Legacy archives have no migration receipt; recovery is ambiguous.')
    const live = files.read(LEGACY_LIVE)
    const backup = files.read(LEGACY_BACKUP)
    if (!migration) {
      const liveData = live ? normalizeDataset(parse(live)) : undefined
      const backupData = backup ? normalizeDataset(parse(backup)) : undefined
      if (!live && backup) throw new Error('Backup-only legacy recovery state; files preserved.')
      if (liveData) validateLegacyPair(liveData, backupData)
    }

    this.service = new MainProcessStorageService(new ProductionProjection(files))
    this.artifacts = new CanonicalArtifactStore(this.path, this.service, this.options.canonical)
    const authority = await this.artifacts.inspectStartup(
      migration?.state === 'migrating' || next ? source?.data : undefined
    )
    if (migration?.state === 'retired' && !authority.hasCanonical)
      throw new Error('Canonical authority is missing after legacy retirement; files preserved.')
    if (source?.archived && !authority.hasCanonical)
      throw new Error('Legacy retirement without canonical authority; files preserved.')
    if (!migration && authority.hasEvidence && (live || backup))
      throw new Error('Canonical and legacy live storage contradict each other; files preserved.')
    if (
      !authority.hasCanonical &&
      !migration &&
      !live &&
      (PROJECTION_FILES.some((name) => files.regular(name)) ||
        entry(files.path(PROJECTION_RECOVERY_DIRECTORY)))
    )
      throw new Error(
        'Projection-only recovery state cannot establish a new profile; files preserved.'
      )
    if (next && !receipt && authority.hasEvidence)
      throw new Error('Canonical publication without a durable migration receipt is ambiguous.')
    if (next && readReceipt(next).state === 'retired' && !authority.hasCanonical)
      throw new Error('Retirement receipt contradicts canonical state; files preserved.')
    if (!isDeepStrictEqual(this.snapshotEvidence(), initialEvidence))
      throw new Error('Storage evidence changed outside PennyTel; files preserved.')
    // Authority admission above is read-only. Only now may S10 recover canonical
    // publication/cleanup and rebuild its downstream projection.
    await this.artifacts.recover()
    let canonical = await this.artifacts.loadCanonical()
    if (next) {
      if (!receipt && canonical)
        throw new Error('Canonical publication without a durable migration receipt is ambiguous.')
      if (
        readReceipt(next).state === 'retired' &&
        (!canonical || !isDeepStrictEqual(canonical, source!.data))
      )
        throw new Error('Retirement receipt contradicts canonical state; files preserved.')
      if (!isDeepStrictEqual(this.snapshotEvidence(), initialEvidence))
        throw new Error('Migration evidence changed outside PennyTel; files preserved.')
      files.syncFile(NEXT_RECEIPT)
      renameSync(files.path(NEXT_RECEIPT), files.path(MIGRATION_RECEIPT))
      syncDirectory(files.directory)
      migration = readReceipt(next)
      source = this.migrationSource(migration)
    }
    if (!migration && live) {
      migration = {
        kind: 'pennytel-legacy-migration',
        version: 1,
        state: 'migrating',
        liveSha256: hash(live),
        backupSha256: backup ? hash(backup) : null
      }
      this.writeReceipt(migration)
      source = this.migrationSource(migration)
      await this.boundary('receipt-durable')
    }
    if (!canonical) {
      if (!migration && !isDeepStrictEqual(this.snapshotEvidence(), initialEvidence))
        throw new Error('Storage evidence changed outside PennyTel; files preserved.')
      canonical = await this.artifacts.initialize(source?.data ?? emptyDataset())
    }
    if (migration?.state === 'migrating') {
      source = this.migrationSource(migration)
      const verified = await this.artifacts.loadCanonical()
      if (!isDeepStrictEqual(verified, source.data))
        throw new Error('Canonical state contradicts the legacy migration source; files preserved.')
      await this.boundary('canonical-verified')
      this.migrationSource(migration)
      if (files.regular(LEGACY_LIVE)) files.move(LEGACY_LIVE, LEGACY_ARCHIVE)
      await this.boundary('live-archived')
      this.migrationSource(migration)
      if (files.regular(LEGACY_BACKUP)) files.move(LEGACY_BACKUP, LEGACY_BACKUP_ARCHIVE)
      await this.boundary('backup-archived')
      this.migrationSource(migration)
      this.writeReceipt({ ...migration, state: 'retired' })
      await this.boundary('retirement-durable')
    }
    if (migration) {
      const retired = { ...migration, state: 'retired' as const }
      this.migrationSource(retired)
      if (!isDeepStrictEqual(files.read(MIGRATION_RECEIPT, 4096), receiptBytes(retired)))
        throw new Error('Migration receipt changed outside PennyTel; evidence preserved.')
    }
    if (
      (!migration || (migration.state === 'retired' && !next)) &&
      !isDeepStrictEqual(this.snapshotEvidence(), initialEvidence)
    )
      throw new Error('Storage evidence changed outside PennyTel; files preserved.')
    this.evidence = this.snapshotEvidence()
  }

  private async ensureReady(): Promise<void> {
    if (this.closed) throw new Error('Production storage is closed.')
    // A failed startup stays blocked for this instance; no fallback authority.
    this.ready ??= this.start().catch((error) => {
      this.service?.close()
      throw error
    })
    await this.ready
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      await this.ensureReady()
      this.assertEvidence()
      return action()
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  private async current(): Promise<LoadedData> {
    await this.artifacts!.recover()
    const data = await this.artifacts!.loadCanonical()
    if (!data) throw new Error('Canonical authority disappeared; writes blocked.')
    return { data, path: this.path }
  }

  load(): Promise<LoadedData> {
    return this.enqueue(() => this.current())
  }

  initializeRegistry(): Promise<LoadedData> {
    return this.enqueue(async () => {
      const current = await this.current()
      if (current.data.registry) return current
      return {
        data: await this.artifacts!.mutate({
          kind: 'registry-import',
          text: JSON.stringify(canonicalRegistry),
          revision: current.data.revision
        }),
        path: this.path
      }
    })
  }

  preview(text: string): Promise<ImportPreview> {
    return this.enqueue(async () => mergeImport((await this.current()).data, text).preview)
  }

  mutate(command: Mutation): Promise<LoadedData> {
    return this.enqueue(async () => ({
      data: await this.artifacts!.mutate(command),
      path: this.path
    }))
  }

  close(): Promise<void> {
    return this.queue.then(() => {
      this.closed = true
      this.service?.close()
    })
  }
}
