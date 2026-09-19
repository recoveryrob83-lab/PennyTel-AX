import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { validateRecord } from '../shared/data'
import { TABLES, type Dataset, type Entity, type Table } from '../shared/types'

export const CANONICAL_ARTIFACT_FORMAT_VERSION = 1
export const CANONICAL_ARTIFACT_STORE_DIRECTORY = 'canonical-artifact-store'
export const CANONICAL_METADATA_RELATIVE_PATH = 'artifact-dataset.json'

export interface CanonicalRecordArtifact {
  kind: 'pennytel-canonical-record'
  artifactVersion: 1
  datasetSchemaVersion: 2
  entityType: Table
  id: string
  record: Entity
}

export interface CanonicalDatasetArtifact {
  kind: 'pennytel-canonical-dataset'
  artifactVersion: 1
  datasetSchemaVersion: 2
  revision: number
  records: Record<Table, string[]>
  registry?: Dataset['registry']
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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
    throw new Error('Canonical artifact contains missing or unknown fields.')
}

export function validateCanonicalId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !id || id !== id.trim() || id.length > 200)
    throw new Error(
      'Canonical artifact identity must be nonempty trimmed text of at most 200 characters.'
    )
}

export function canonicalArtifactStorePath(dataDirectory: string): string {
  if (!isAbsolute(dataDirectory))
    throw new Error('Canonical artifact data directory must be an absolute user-data or QA path.')
  return join(dataDirectory, CANONICAL_ARTIFACT_STORE_DIRECTORY)
}

export function canonicalRecordRelativePath(table: Table, id: string): string {
  if (!TABLES.includes(table)) throw new Error('Canonical artifact entity type is invalid.')
  validateCanonicalId(id)
  // UTF-16LE preserves every JavaScript code unit, including lone surrogates.
  // UTF-8 would replace those code units and alias distinct accepted IDs.
  const digest = createHash('sha256').update(Buffer.from(id, 'utf16le')).digest('hex')
  return `artifact-${table}-${digest}.json`
}

export function createCanonicalRecordArtifact(
  table: Table,
  record: Entity
): CanonicalRecordArtifact {
  validateRecord(table, record)
  return {
    kind: 'pennytel-canonical-record',
    artifactVersion: CANONICAL_ARTIFACT_FORMAT_VERSION,
    datasetSchemaVersion: 2,
    entityType: table,
    id: record.id,
    record: structuredClone(record)
  }
}

export function createCanonicalDatasetArtifact(dataset: Dataset): CanonicalDatasetArtifact {
  return {
    kind: 'pennytel-canonical-dataset',
    artifactVersion: CANONICAL_ARTIFACT_FORMAT_VERSION,
    datasetSchemaVersion: 2,
    revision: dataset.revision,
    records: Object.fromEntries(
      TABLES.map((table) => [table, dataset[table].map((record) => record.id)])
    ) as Record<Table, string[]>,
    ...(dataset.registry === undefined ? {} : { registry: structuredClone(dataset.registry) })
  }
}

export function serializeCanonicalArtifact(
  artifact: CanonicalRecordArtifact | CanonicalDatasetArtifact
): Buffer {
  return Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
}

export function parseCanonicalRecordArtifact(value: unknown): CanonicalRecordArtifact {
  if (!object(value)) throw new Error('Canonical record artifact must be an object.')
  exactKeys(value, [
    'kind',
    'artifactVersion',
    'datasetSchemaVersion',
    'entityType',
    'id',
    'record'
  ])
  if (
    value.kind !== 'pennytel-canonical-record' ||
    value.artifactVersion !== CANONICAL_ARTIFACT_FORMAT_VERSION ||
    value.datasetSchemaVersion !== 2 ||
    typeof value.entityType !== 'string' ||
    !TABLES.includes(value.entityType as Table)
  )
    throw new Error('Unsupported or foreign canonical record artifact.')
  validateCanonicalId(value.id)
  const table = value.entityType as Table
  validateRecord(table, value.record)
  if (value.record.id !== value.id)
    throw new Error('Canonical record artifact identity does not match its record.')
  return structuredClone(value) as unknown as CanonicalRecordArtifact
}

export function parseCanonicalDatasetArtifact(value: unknown): CanonicalDatasetArtifact {
  if (!object(value)) throw new Error('Canonical dataset artifact must be an object.')
  exactKeys(
    value,
    ['kind', 'artifactVersion', 'datasetSchemaVersion', 'revision', 'records'],
    ['registry']
  )
  if (
    value.kind !== 'pennytel-canonical-dataset' ||
    value.artifactVersion !== CANONICAL_ARTIFACT_FORMAT_VERSION ||
    value.datasetSchemaVersion !== 2 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !object(value.records)
  )
    throw new Error('Unsupported or foreign canonical dataset artifact.')
  exactKeys(value.records, TABLES)
  for (const table of TABLES) {
    const ids = value.records[table]
    if (!Array.isArray(ids))
      throw new Error(`Canonical dataset ${table} registry must be an array.`)
    const unique = new Set<string>()
    for (const id of ids) {
      validateCanonicalId(id)
      if (unique.has(id))
        throw new Error(`Canonical dataset contains duplicate ${table} identity “${id}”.`)
      unique.add(id)
    }
  }
  return structuredClone(value) as unknown as CanonicalDatasetArtifact
}
