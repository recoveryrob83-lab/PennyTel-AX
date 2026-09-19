import { createHash, randomUUID } from 'node:crypto'
import { constants, lstat, mkdir, open, opendir, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { isDeepStrictEqual, TextDecoder } from 'node:util'
import { applyMutation, normalizeDataset, validateDataset } from '../shared/data'
import { TABLES, type Dataset, type Entity, type Mutation, type Table } from '../shared/types'
import {
  CANONICAL_METADATA_RELATIVE_PATH,
  canonicalRecordRelativePath,
  createCanonicalDatasetArtifact,
  createCanonicalRecordArtifact,
  parseCanonicalDatasetArtifact,
  parseCanonicalRecordArtifact,
  serializeCanonicalArtifact,
  validateCanonicalId,
  type CanonicalDatasetArtifact,
  type CanonicalRecordArtifact
} from './canonical-artifacts'
import type { PennyTelStorageService } from './storage-service'

export const MAX_CANONICAL_RECORDS = 50_000
export const MAX_CANONICAL_DATASET_BYTES = 10_000_000
export const MAX_CANONICAL_ARTIFACT_BYTES = 10_000_000
export const MAX_CANONICAL_TRANSACTION_OPERATIONS = MAX_CANONICAL_RECORDS * 2 + 1
export const MAX_CANONICAL_RECEIPT_BYTES = 30_000_000

const TRANSACTION_FORMAT_VERSION = 1
// Every transaction and artifact entry is a direct child of the store root.
// Node's pathname-based rename cannot pin a replaceable nested parent directory.
const PENDING_RECEIPT_RELATIVE_PATH = 'transaction-pending.json'
const NEXT_RECEIPT_RELATIVE_PATH = 'transaction-pending.next.json'
const STAGE_PREFIX = 'stage-'
const TOMBSTONE_PREFIX = 'tombstone-'

function stagePath(name: string): string {
  return `${STAGE_PREFIX}${name}`
}

function tombstonePath(name: string): string {
  return `${TOMBSTONE_PREFIX}${name}`
}

type TransactionState = 'prepared' | 'publishing' | 'published'
type ArtifactType = Table | 'dataset'

interface PutOperation {
  kind: 'put'
  artifactType: ArtifactType
  id?: string
  stagedFile: string
  desiredSha256: string
  expectedSha256: string | null
}

interface DeleteOperation {
  kind: 'delete'
  artifactType: Table
  id: string
  tombstoneFile: string
  expectedSha256: string
}

type TransactionOperation = PutOperation | DeleteOperation

interface PendingTransaction {
  kind: 'pennytel-canonical-transaction'
  transactionVersion: 1
  transactionId: string
  state: TransactionState
  baseRevision: number | null
  targetRevision: number
  targetDatasetSha256: string
  operations: TransactionOperation[]
}

export type CanonicalPublishBoundary =
  | 'staged-data-durable'
  | 'prepared-receipt-durable'
  | 'publication-authorized'
  | 'artifact-operation-durable'
  | 'canonical-state-durable'
  | 'projection-complete'
  | 'pending-state-cleared'

export interface CanonicalPublishEvent {
  boundary: CanonicalPublishBoundary
  operationIndex?: number
}

export interface CanonicalArtifactStoreOptions {
  faultInjector?: (event: CanonicalPublishEvent) => void | Promise<void>
}

export interface CanonicalRecoveryResult {
  action: 'none' | 'discarded-prepared' | 'recovered-publication'
  revision?: number
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function datasetDigest(dataset: Dataset): string {
  return sha256(Buffer.from(stableJson(JSON.parse(JSON.stringify(dataset))), 'utf8'))
}

function serializedDatasetBytes(dataset: Dataset): number {
  return Buffer.byteLength(JSON.stringify(dataset))
}

function datasetRecordCount(dataset: Dataset): number {
  return TABLES.reduce((total, table) => total + dataset[table].length, 0)
}

function validateDatasetBounds(dataset: Dataset): void {
  const records = datasetRecordCount(dataset)
  const bytes = serializedDatasetBytes(dataset)
  if (records > MAX_CANONICAL_RECORDS)
    throw new Error(
      `Canonical dataset exceeds the ${MAX_CANONICAL_RECORDS.toLocaleString('en-US')} record limit.`
    )
  if (bytes > MAX_CANONICAL_DATASET_BYTES)
    throw new Error(
      `Canonical dataset exceeds the ${MAX_CANONICAL_DATASET_BYTES.toLocaleString('en-US')} byte limit.`
    )
}

function exactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = []
): void {
  const allowed = new Set([...required, ...optional])
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  )
    throw new Error('Pending canonical transaction contains missing or unknown fields.')
}

function validateDigest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error('Pending canonical transaction contains an invalid content digest.')
}

function operationTarget(operation: TransactionOperation): string {
  return operation.artifactType === 'dataset'
    ? CANONICAL_METADATA_RELATIVE_PATH
    : canonicalRecordRelativePath(operation.artifactType, operation.id!)
}

function validateReceipt(value: unknown): PendingTransaction {
  if (!object(value)) throw new Error('Pending canonical transaction must be an object.')
  exactKeys(value, [
    'kind',
    'transactionVersion',
    'transactionId',
    'state',
    'baseRevision',
    'targetRevision',
    'targetDatasetSha256',
    'operations'
  ])
  if (
    value.kind !== 'pennytel-canonical-transaction' ||
    value.transactionVersion !== TRANSACTION_FORMAT_VERSION ||
    typeof value.transactionId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(value.transactionId) ||
    !['prepared', 'publishing', 'published'].includes(String(value.state)) ||
    (value.baseRevision !== null &&
      (!Number.isSafeInteger(value.baseRevision) || (value.baseRevision as number) < 0)) ||
    !Number.isSafeInteger(value.targetRevision) ||
    (value.targetRevision as number) < 0 ||
    !Array.isArray(value.operations) ||
    !value.operations.length ||
    value.operations.length > MAX_CANONICAL_TRANSACTION_OPERATIONS
  )
    throw new Error('Pending canonical transaction header is invalid or exceeds work limits.')
  validateDigest(value.targetDatasetSha256)
  if (value.baseRevision !== null && value.targetRevision !== (value.baseRevision as number) + 1)
    throw new Error('Pending canonical transaction revision transition is invalid.')

  const targets = new Set<string>()
  const workFiles = new Set<string>()
  const operations = value.operations.map((candidate, index): TransactionOperation => {
    if (!object(candidate)) throw new Error('Pending canonical transaction operation is invalid.')
    const expectedStage = `put-${index}.json`
    const expectedTombstone = `delete-${index}.json`
    if (candidate.kind === 'put') {
      exactKeys(
        candidate,
        ['kind', 'artifactType', 'stagedFile', 'desiredSha256', 'expectedSha256'],
        ['id']
      )
      if (candidate.artifactType !== 'dataset' && !TABLES.includes(candidate.artifactType as Table))
        throw new Error('Pending canonical put has an invalid artifact type.')
      if (candidate.artifactType === 'dataset') {
        if (Object.hasOwn(candidate, 'id'))
          throw new Error('Pending canonical dataset put must not contain a record identity.')
      } else validateCanonicalId(candidate.id)
      if (candidate.stagedFile !== expectedStage)
        throw new Error('Pending canonical put has an invalid staging path.')
      validateDigest(candidate.desiredSha256)
      if (candidate.expectedSha256 !== null) validateDigest(candidate.expectedSha256)
      const operation = candidate as unknown as PutOperation
      const target = operationTarget(operation)
      if (targets.has(target) || workFiles.has(operation.stagedFile))
        throw new Error('Pending canonical transaction contains duplicate paths.')
      targets.add(target)
      workFiles.add(operation.stagedFile)
      return operation
    }
    if (candidate.kind === 'delete') {
      exactKeys(candidate, ['kind', 'artifactType', 'id', 'tombstoneFile', 'expectedSha256'])
      if (!TABLES.includes(candidate.artifactType as Table))
        throw new Error('Pending canonical delete has an invalid artifact type.')
      validateCanonicalId(candidate.id)
      if (candidate.tombstoneFile !== expectedTombstone)
        throw new Error('Pending canonical delete has an invalid tombstone path.')
      validateDigest(candidate.expectedSha256)
      const operation = candidate as unknown as DeleteOperation
      const target = operationTarget(operation)
      if (targets.has(target) || workFiles.has(operation.tombstoneFile))
        throw new Error('Pending canonical transaction contains duplicate paths.')
      targets.add(target)
      workFiles.add(operation.tombstoneFile)
      return operation
    }
    throw new Error('Pending canonical transaction operation kind is invalid.')
  })
  const metadataIndex = operations.findIndex(
    (operation) => operation.kind === 'put' && operation.artifactType === 'dataset'
  )
  if (metadataIndex !== operations.length - 1)
    throw new Error('Pending canonical transaction must publish dataset metadata last.')
  return structuredClone({ ...value, operations }) as unknown as PendingTransaction
}

export class CanonicalArtifactStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    readonly root: string,
    private readonly storage: PennyTelStorageService,
    private readonly options: CanonicalArtifactStoreOptions = {}
  ) {
    if (!isAbsolute(root)) throw new Error('Canonical artifact store path must be absolute.')
  }

  private path(relativePath: string): string {
    const target = resolve(this.root, relativePath)
    const withinRoot = target === this.root || target.startsWith(`${this.root}${sep}`)
    if (!withinRoot || relative(this.root, target).startsWith('..'))
      throw new Error('Canonical artifact path escapes its storage root.')
    return target
  }

  private async syncDirectory(path: string): Promise<void> {
    const handle = await open(path, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  private async ensureDirectory(path: string): Promise<void> {
    let stat
    try {
      stat = await lstat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(path, { mode: 0o700 })
      await this.syncDirectory(dirname(path))
      stat = await lstat(path)
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`Canonical artifact storage directory is unsafe: ${path}`)
  }

  private async ensureLayout(): Promise<void> {
    const parent = await lstat(dirname(this.root))
    if (!parent.isDirectory() || parent.isSymbolicLink())
      throw new Error('Canonical artifact parent directory is unsafe.')
    await this.ensureDirectory(this.root)
    await this.removeReceiptTemporary()
  }

  private async entry(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
    try {
      return await lstat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private async removeReceiptTemporary(): Promise<void> {
    const path = this.path(NEXT_RECEIPT_RELATIVE_PATH)
    const stat = await this.entry(path)
    if (!stat) return
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Pending canonical transaction temporary evidence is unsafe.')
    await unlink(path)
    await this.syncDirectory(dirname(path))
  }

  private async readBounded(path: string, limit: number): Promise<Buffer | undefined> {
    let handle
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) throw new Error(`Canonical storage entry is not a regular file: ${path}`)
      if (stat.size > limit)
        throw new Error(`Canonical storage entry exceeds its byte limit: ${path}`)
      const buffer = Buffer.alloc(stat.size + 1)
      let position = 0
      while (position < buffer.length) {
        const { bytesRead } = await handle.read(buffer, position, buffer.length - position, null)
        if (bytesRead === 0) break
        position += bytesRead
      }
      if (position !== stat.size)
        throw new Error(`Canonical storage entry changed while it was read: ${path}`)
      return buffer.subarray(0, position)
    } finally {
      await handle.close()
    }
  }

  private parseJson(bytes: Buffer, description: string): unknown {
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch {
      throw new Error(`${description} is not valid UTF-8.`)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`${description} is not valid JSON.`)
    }
  }

  private async hashAt(relativePath: string): Promise<string | undefined> {
    const bytes = await this.readBounded(this.path(relativePath), MAX_CANONICAL_ARTIFACT_BYTES)
    return bytes === undefined ? undefined : sha256(bytes)
  }

  private async assertCanonicalBytes(
    relativePath: string,
    expectedType: ArtifactType,
    expectedId?: string
  ): Promise<{ bytes: Buffer; artifact: CanonicalRecordArtifact | CanonicalDatasetArtifact }> {
    const bytes = await this.readBounded(this.path(relativePath), MAX_CANONICAL_ARTIFACT_BYTES)
    if (!bytes) throw new Error(`Required canonical artifact is missing: ${relativePath}`)
    const parsed = this.parseJson(bytes, `Canonical artifact ${relativePath}`)
    const artifact =
      expectedType === 'dataset'
        ? parseCanonicalDatasetArtifact(parsed)
        : parseCanonicalRecordArtifact(parsed)
    if (
      expectedType !== 'dataset' &&
      (artifact.kind !== 'pennytel-canonical-record' ||
        artifact.entityType !== expectedType ||
        artifact.id !== expectedId)
    )
      throw new Error(`Canonical artifact does not match its expected identity: ${relativePath}`)
    const canonical = serializeCanonicalArtifact(artifact)
    if (!bytes.equals(canonical))
      throw new Error(`Canonical artifact is not in the deterministic encoding: ${relativePath}`)
    return { bytes, artifact }
  }

  private async loadCanonicalInternal(): Promise<Dataset | undefined> {
    await this.ensureLayout()
    const artifactNames = (await this.listRootFiles()).filter((name) =>
      name.startsWith('artifact-')
    )
    const metadataBytes = await this.readBounded(
      this.path(CANONICAL_METADATA_RELATIVE_PATH),
      MAX_CANONICAL_ARTIFACT_BYTES
    )
    if (!metadataBytes) {
      if (artifactNames.length)
        throw new Error(
          'Canonical record artifacts exist without dataset-level canonical metadata.'
        )
      return undefined
    }
    const parsed = this.parseJson(metadataBytes, 'Canonical dataset artifact')
    const metadata = parseCanonicalDatasetArtifact(parsed)
    if (!metadataBytes.equals(serializeCanonicalArtifact(metadata)))
      throw new Error('Canonical dataset artifact is not in the deterministic encoding.')
    const recordCount = TABLES.reduce((total, table) => total + metadata.records[table].length, 0)
    if (recordCount > MAX_CANONICAL_RECORDS)
      throw new Error('Canonical dataset metadata exceeds the configured record limit.')
    const expected = new Set<string>([CANONICAL_METADATA_RELATIVE_PATH])
    for (const table of TABLES)
      for (const id of metadata.records[table]) expected.add(canonicalRecordRelativePath(table, id))
    if (artifactNames.length !== expected.size || artifactNames.some((name) => !expected.has(name)))
      throw new Error('Canonical artifact set contradicts dataset-level metadata.')
    let artifactBytes = metadataBytes.length
    const rows: { [K in Table]: Dataset[K] } = {
      slices: [],
      runs: [],
      findings: [],
      discoveries: [],
      pricing: []
    }
    for (const table of TABLES) {
      rows[table] = []
      for (const id of metadata.records[table]) {
        const relativePath = canonicalRecordRelativePath(table, id)
        const loaded = await this.assertCanonicalBytes(relativePath, table, id)
        artifactBytes += loaded.bytes.length
        if (artifactBytes > MAX_CANONICAL_DATASET_BYTES * 3)
          throw new Error(
            'Canonical artifact material exceeds the configured aggregate byte limit.'
          )
        ;(rows[table] as Entity[]).push((loaded.artifact as CanonicalRecordArtifact).record)
      }
    }
    const dataset = {
      schemaVersion: 2,
      revision: metadata.revision,
      slices: rows.slices,
      runs: rows.runs,
      findings: rows.findings,
      discoveries: rows.discoveries,
      pricing: rows.pricing,
      ...(metadata.registry === undefined ? {} : { registry: metadata.registry })
    } satisfies Dataset
    validateDataset(dataset)
    validateDatasetBounds(dataset)
    return structuredClone(dataset)
  }

  loadCanonical(): Promise<Dataset | undefined> {
    return this.enqueue(async () => this.loadCanonicalInternal())
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(action, action)
    this.queue = operation.catch(() => undefined)
    return operation
  }

  private async writeDurableFile(path: string, bytes: Buffer): Promise<void> {
    const handle = await open(path, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  private async writeReceipt(receipt: PendingTransaction): Promise<void> {
    const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
    if (bytes.length > MAX_CANONICAL_RECEIPT_BYTES)
      throw new Error('Pending canonical transaction receipt exceeds its byte limit.')
    await this.ensureLayout()
    const nextPath = this.path(NEXT_RECEIPT_RELATIVE_PATH)
    await this.removeReceiptTemporary()
    await this.writeDurableFile(nextPath, bytes)
    const pendingPath = this.path(PENDING_RECEIPT_RELATIVE_PATH)
    const existing = await this.entry(pendingPath)
    if (existing && (!existing.isFile() || existing.isSymbolicLink()))
      throw new Error('Pending canonical transaction evidence is unsafe.')
    await rename(nextPath, pendingPath)
    await this.syncDirectory(dirname(pendingPath))
  }

  private async readReceipt(): Promise<PendingTransaction | undefined> {
    const bytes = await this.readBounded(
      this.path(PENDING_RECEIPT_RELATIVE_PATH),
      MAX_CANONICAL_RECEIPT_BYTES
    )
    if (!bytes) return undefined
    const receipt = validateReceipt(this.parseJson(bytes, 'Pending canonical transaction'))
    const canonical = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
    if (!bytes.equals(canonical))
      throw new Error('Pending canonical transaction is not in the deterministic encoding.')
    return receipt
  }

  private async clearReceipt(): Promise<void> {
    const path = this.path(PENDING_RECEIPT_RELATIVE_PATH)
    const stat = await this.entry(path)
    if (!stat || !stat.isFile() || stat.isSymbolicLink())
      throw new Error('Pending canonical transaction disappeared or became unsafe.')
    await unlink(path)
    await this.syncDirectory(dirname(path))
  }

  private async listRootFiles(): Promise<string[]> {
    const directory = await opendir(this.root)
    const names: string[] = []
    try {
      for await (const entry of directory) {
        names.push(entry.name)
        if (names.length > MAX_CANONICAL_TRANSACTION_OPERATIONS * 3)
          throw new Error('Canonical artifact store exceeds its entry limit.')
        if (!entry.isFile() || entry.isSymbolicLink())
          throw new Error('Canonical artifact store contains an unsafe entry.')
      }
    } finally {
      await directory.close().catch(() => undefined)
    }
    return names.sort()
  }

  private async cleanWorkDirectories(): Promise<void> {
    for (const name of await this.listRootFiles())
      if (name.startsWith(STAGE_PREFIX) || name.startsWith(TOMBSTONE_PREFIX))
        await unlink(this.path(name))
    await this.syncDirectory(this.root)
  }

  private async assertWorkMatches(receipt: PendingTransaction): Promise<void> {
    const expectedStage = receipt.operations
      .filter((operation): operation is PutOperation => operation.kind === 'put')
      .map((operation) => operation.stagedFile)
      .sort()
    const expectedTombstones =
      receipt.state === 'prepared'
        ? []
        : receipt.operations
            .filter((operation): operation is DeleteOperation => operation.kind === 'delete')
            .map((operation) => operation.tombstoneFile)
    const rootFiles = await this.listRootFiles()
    const actualStage = rootFiles
      .filter((name) => name.startsWith(STAGE_PREFIX))
      .map((name) => name.slice(STAGE_PREFIX.length))
    const actualTombstones = rootFiles
      .filter((name) => name.startsWith(TOMBSTONE_PREFIX))
      .map((name) => name.slice(TOMBSTONE_PREFIX.length))
    if (actualStage.some((name) => !expectedStage.includes(name)))
      throw new Error('Canonical transaction staging contains unreferenced material.')
    if (
      receipt.state === 'prepared' &&
      (actualStage.length !== expectedStage.length || actualTombstones.length)
    )
      throw new Error('Prepared canonical transaction evidence is incomplete or contradictory.')
    if (
      receipt.state !== 'prepared' &&
      actualTombstones.some((name) => !expectedTombstones.includes(name))
    )
      throw new Error('Canonical transaction tombstones contain unreferenced material.')
  }

  private oldArtifactMap(dataset: Dataset | undefined): Map<string, Buffer> {
    const artifacts = new Map<string, Buffer>()
    if (!dataset) return artifacts
    for (const table of TABLES) {
      for (const record of dataset[table])
        artifacts.set(
          canonicalRecordRelativePath(table, record.id),
          serializeCanonicalArtifact(createCanonicalRecordArtifact(table, record))
        )
    }
    artifacts.set(
      CANONICAL_METADATA_RELATIVE_PATH,
      serializeCanonicalArtifact(createCanonicalDatasetArtifact(dataset))
    )
    return artifacts
  }

  private newArtifactMap(dataset: Dataset): Map<string, Buffer> {
    return this.oldArtifactMap(dataset)
  }

  private artifactIdentity(
    relativePath: string,
    artifact: CanonicalRecordArtifact | CanonicalDatasetArtifact
  ): { artifactType: ArtifactType; id?: string } {
    if (relativePath === CANONICAL_METADATA_RELATIVE_PATH) return { artifactType: 'dataset' }
    if (artifact.kind !== 'pennytel-canonical-record')
      throw new Error('Canonical transaction record material has an invalid envelope.')
    return { artifactType: artifact.entityType, id: artifact.id }
  }

  private async prepareTransaction(
    current: Dataset | undefined,
    next: Dataset
  ): Promise<PendingTransaction> {
    const existingReceipt = await this.readReceipt()
    if (existingReceipt) throw new Error('A pending canonical transaction must be recovered first.')
    await this.cleanWorkDirectories()
    const before = this.oldArtifactMap(current)
    const after = this.newArtifactMap(next)
    const operations: TransactionOperation[] = []
    const recordTargets = [...new Set([...before.keys(), ...after.keys()])]
      .filter((path) => path !== CANONICAL_METADATA_RELATIVE_PATH)
      .sort()
    for (const target of recordTargets) {
      const previous = before.get(target)
      const desired = after.get(target)
      if (previous && desired && previous.equals(desired)) continue
      const index = operations.length
      if (!desired) {
        const parsed = parseCanonicalRecordArtifact(
          this.parseJson(previous!, `Previous canonical artifact ${target}`)
        )
        operations.push({
          kind: 'delete',
          artifactType: parsed.entityType,
          id: parsed.id,
          tombstoneFile: `delete-${index}.json`,
          expectedSha256: sha256(previous!)
        })
      } else {
        const parsed = parseCanonicalRecordArtifact(
          this.parseJson(desired, `Next canonical artifact ${target}`)
        )
        operations.push({
          kind: 'put',
          artifactType: parsed.entityType,
          id: parsed.id,
          stagedFile: `put-${index}.json`,
          desiredSha256: sha256(desired),
          expectedSha256: previous ? sha256(previous) : null
        })
      }
    }
    const metadata = after.get(CANONICAL_METADATA_RELATIVE_PATH)!
    const metadataIndex = operations.length
    operations.push({
      kind: 'put',
      artifactType: 'dataset',
      stagedFile: `put-${metadataIndex}.json`,
      desiredSha256: sha256(metadata),
      expectedSha256: before.has(CANONICAL_METADATA_RELATIVE_PATH)
        ? sha256(before.get(CANONICAL_METADATA_RELATIVE_PATH)!)
        : null
    })
    if (operations.length > MAX_CANONICAL_TRANSACTION_OPERATIONS)
      throw new Error('Canonical publish exceeds the transaction operation limit.')

    let stagedBytes = 0
    for (const [index, operation] of operations.entries()) {
      if (operation.kind !== 'put') continue
      const target = operationTarget(operation)
      const bytes = after.get(target)!
      if (bytes.length > MAX_CANONICAL_ARTIFACT_BYTES)
        throw new Error('Canonical publish artifact exceeds its individual byte limit.')
      stagedBytes += bytes.length
      if (stagedBytes > MAX_CANONICAL_DATASET_BYTES * 3)
        throw new Error('Canonical publish staging exceeds the aggregate byte limit.')
      await this.writeDurableFile(this.path(stagePath(operation.stagedFile)), bytes)
      const parsed = this.parseJson(bytes, `Staged canonical artifact ${index}`)
      const artifact =
        operation.artifactType === 'dataset'
          ? parseCanonicalDatasetArtifact(parsed)
          : parseCanonicalRecordArtifact(parsed)
      const identity = this.artifactIdentity(target, artifact)
      if (identity.artifactType !== operation.artifactType || identity.id !== operation.id)
        throw new Error('Staged canonical artifact identity does not match its transaction.')
    }
    await this.syncDirectory(this.root)
    await this.boundary('staged-data-durable')
    const receipt: PendingTransaction = {
      kind: 'pennytel-canonical-transaction',
      transactionVersion: TRANSACTION_FORMAT_VERSION,
      transactionId: randomUUID(),
      state: 'prepared',
      baseRevision: current?.revision ?? null,
      targetRevision: next.revision,
      targetDatasetSha256: datasetDigest(next),
      operations
    }
    await this.writeReceipt(receipt)
    await this.boundary('prepared-receipt-durable')
    return receipt
  }

  private async boundary(
    boundary: CanonicalPublishBoundary,
    operationIndex?: number
  ): Promise<void> {
    await this.options.faultInjector?.({
      boundary,
      ...(operationIndex === undefined ? {} : { operationIndex })
    })
  }

  private async assertStagedPut(operation: PutOperation): Promise<void> {
    const path = this.path(stagePath(operation.stagedFile))
    const bytes = await this.readBounded(path, MAX_CANONICAL_ARTIFACT_BYTES)
    if (!bytes || sha256(bytes) !== operation.desiredSha256)
      throw new Error('Pending canonical transaction staged data is missing or does not match.')
    const parsed = this.parseJson(bytes, `Staged canonical artifact ${operation.stagedFile}`)
    const artifact =
      operation.artifactType === 'dataset'
        ? parseCanonicalDatasetArtifact(parsed)
        : parseCanonicalRecordArtifact(parsed)
    if (!bytes.equals(serializeCanonicalArtifact(artifact)))
      throw new Error('Pending canonical transaction staged artifact encoding is invalid.')
    const identity = this.artifactIdentity(operationTarget(operation), artifact)
    if (identity.artifactType !== operation.artifactType || identity.id !== operation.id)
      throw new Error('Pending canonical transaction staged artifact identity is invalid.')
  }

  private async verifyPrepared(receipt: PendingTransaction): Promise<void> {
    await this.assertWorkMatches(receipt)
    for (const operation of receipt.operations) {
      const targetHash = await this.hashAt(operationTarget(operation))
      const expected = operation.expectedSha256 ?? undefined
      if (targetHash !== expected)
        throw new Error('Prepared canonical transaction contradicts canonical artifact state.')
      if (operation.kind === 'put') await this.assertStagedPut(operation)
    }
  }

  private async applyPut(operation: PutOperation): Promise<void> {
    const targetRelative = operationTarget(operation)
    const targetHash = await this.hashAt(targetRelative)
    const stageRelative = stagePath(operation.stagedFile)
    const stageHash = await this.hashAt(stageRelative)
    if (targetHash === operation.desiredSha256) {
      if (stageHash !== undefined) {
        if (stageHash !== operation.desiredSha256)
          throw new Error('Canonical staged artifact conflicts with already published state.')
        await unlink(this.path(stageRelative))
        await this.syncDirectory(this.root)
      }
      return
    }
    if (targetHash !== (operation.expectedSha256 ?? undefined))
      throw new Error(
        'Canonical artifact changed outside the pending transaction; recovery blocked.'
      )
    if (stageHash !== operation.desiredSha256)
      throw new Error('Canonical staged artifact is missing or corrupt; recovery blocked.')
    await this.assertStagedPut(operation)
    const targetPath = this.path(targetRelative)
    const targetEntry = await this.entry(targetPath)
    if (targetEntry && (!targetEntry.isFile() || targetEntry.isSymbolicLink()))
      throw new Error('Canonical artifact target is unsafe; publication blocked.')
    await rename(this.path(stageRelative), targetPath)
    await this.syncDirectory(this.root)
    if ((await this.hashAt(targetRelative)) !== operation.desiredSha256)
      throw new Error('Canonical artifact publication could not be verified.')
  }

  private async applyDelete(operation: DeleteOperation): Promise<void> {
    const targetRelative = operationTarget(operation)
    const tombstoneRelative = tombstonePath(operation.tombstoneFile)
    const targetHash = await this.hashAt(targetRelative)
    const tombstoneHash = await this.hashAt(tombstoneRelative)
    if (targetHash === undefined && tombstoneHash === operation.expectedSha256) return
    if (targetHash !== operation.expectedSha256 || tombstoneHash !== undefined)
      throw new Error('Canonical delete evidence is incomplete or contradictory; recovery blocked.')
    const targetPath = this.path(targetRelative)
    const targetEntry = await this.entry(targetPath)
    if (!targetEntry?.isFile() || targetEntry.isSymbolicLink())
      throw new Error('Canonical delete target is unsafe; publication blocked.')
    await rename(targetPath, this.path(tombstoneRelative))
    await this.syncDirectory(this.root)
    if ((await this.hashAt(tombstoneRelative)) !== operation.expectedSha256)
      throw new Error('Canonical delete tombstone could not be verified.')
  }

  private async finishPublication(receipt: PendingTransaction): Promise<PendingTransaction> {
    await this.ensureLayout()
    await this.assertWorkMatches(receipt)
    for (const [index, operation] of receipt.operations.entries()) {
      if (index > 0) await this.ensureLayout()
      if (operation.kind === 'put') await this.applyPut(operation)
      else await this.applyDelete(operation)
      await this.boundary('artifact-operation-durable', index)
    }
    const published = { ...receipt, state: 'published' as const }
    await this.writeReceipt(published)
    await this.boundary('canonical-state-durable')
    return published
  }

  private async verifyPublished(receipt: PendingTransaction): Promise<void> {
    await this.assertWorkMatches(receipt)
    for (const operation of receipt.operations) {
      if (operation.kind === 'put') {
        if ((await this.hashAt(operationTarget(operation))) !== operation.desiredSha256)
          throw new Error('Published canonical artifact does not match its transaction receipt.')
      } else {
        const targetHash = await this.hashAt(operationTarget(operation))
        const tombstoneHash = await this.hashAt(tombstonePath(operation.tombstoneFile))
        if (targetHash !== undefined || tombstoneHash !== operation.expectedSha256)
          throw new Error('Published canonical delete does not match its transaction receipt.')
      }
    }
  }

  private async projectAndClear(receipt: PendingTransaction): Promise<Dataset> {
    await this.verifyPublished(receipt)
    const dataset = await this.loadCanonicalInternal()
    if (
      !dataset ||
      dataset.revision !== receipt.targetRevision ||
      datasetDigest(dataset) !== receipt.targetDatasetSha256
    )
      throw new Error('Published canonical state does not match its pending transaction.')
    this.storage.project(dataset)
    await this.boundary('projection-complete')
    await this.ensureLayout()
    await this.clearReceipt()
    await this.boundary('pending-state-cleared')
    await this.ensureLayout()
    await this.cleanWorkDirectories()
    return dataset
  }

  private async reconcileProjection(dataset: Dataset | undefined): Promise<void> {
    let projection: Dataset | undefined
    try {
      projection = this.storage.loadProjection()
    } catch (error) {
      if (!dataset) throw error
      this.storage.project(dataset)
      return
    }
    if (!dataset) {
      if (projection)
        throw new Error(
          'SQLite projection claims data while canonical dataset artifacts are absent.'
        )
      return
    }
    if (!projection || !isDeepStrictEqual(projection, dataset)) this.storage.project(dataset)
  }

  private async recoverInternal(): Promise<CanonicalRecoveryResult> {
    await this.ensureLayout()
    const receipt = await this.readReceipt()
    if (!receipt) {
      await this.cleanWorkDirectories()
      const dataset = await this.loadCanonicalInternal()
      await this.reconcileProjection(dataset)
      return { action: 'none', ...(dataset ? { revision: dataset.revision } : {}) }
    }
    if (receipt.state === 'prepared') {
      await this.verifyPrepared(receipt)
      await this.clearReceipt()
      await this.cleanWorkDirectories()
      const dataset = await this.loadCanonicalInternal()
      await this.reconcileProjection(dataset)
      return {
        action: 'discarded-prepared',
        ...(dataset ? { revision: dataset.revision } : {})
      }
    }
    const published =
      receipt.state === 'publishing' ? await this.finishPublication(receipt) : receipt
    const dataset = await this.projectAndClear(published)
    return { action: 'recovered-publication', revision: dataset.revision }
  }

  recover(): Promise<CanonicalRecoveryResult> {
    return this.enqueue(async () => this.recoverInternal())
  }

  private async publish(current: Dataset | undefined, next: Dataset): Promise<Dataset> {
    validateDataset(next)
    const durable = normalizeDataset(JSON.parse(JSON.stringify(next)))
    validateDatasetBounds(durable)
    let receipt = await this.prepareTransaction(current, durable)
    receipt = { ...receipt, state: 'publishing' }
    await this.writeReceipt(receipt)
    await this.boundary('publication-authorized')
    const published = await this.finishPublication(receipt)
    return this.projectAndClear(published)
  }

  initialize(dataset: Dataset): Promise<Dataset> {
    return this.enqueue(async () => {
      await this.recoverInternal()
      const existing = await this.loadCanonicalInternal()
      if (existing) throw new Error('Canonical artifact store is already initialized.')
      const projection = this.storage.loadProjection()
      if (projection)
        throw new Error(
          'SQLite projection exists without canonical artifacts; initialization refused.'
        )
      return structuredClone(await this.publish(undefined, structuredClone(dataset)))
    })
  }

  mutate(command: Mutation): Promise<Dataset> {
    return this.enqueue(async () => {
      await this.recoverInternal()
      const current = await this.loadCanonicalInternal()
      if (!current) throw new Error('Canonical artifact store is not initialized.')
      const next = applyMutation(current, command)
      return structuredClone(await this.publish(current, next))
    })
  }
}
