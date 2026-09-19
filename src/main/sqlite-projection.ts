import { isAbsolute, join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { normalizeDataset, validateDataset } from '../shared/data'
import { TABLES, type Dataset } from '../shared/types'
import type { DatasetProjectionRepository } from './storage-service'

export const PROJECTION_DATABASE_FILENAME = 'pennytel-projection.sqlite'
export const PROJECTION_SCHEMA_VERSION = 1
export const MAX_PROJECTION_BYTES = 10_000_000
export const MAX_PROJECTION_RECORDS = 50_000

const APPLICATION_ID = 0x50544c31 // "PTL1"
const BUSY_TIMEOUT_MS = 500

const REDUNDANT_FIELDS: Record<
  (typeof TABLES)[number],
  ReadonlyArray<readonly [jsonKey: string, column: string]>
> = {
  slices: [['id', 'id']],
  runs: [
    ['id', 'id'],
    ['sliceId', 'slice_id'],
    ['model', 'model'],
    ['provider', 'provider']
  ],
  findings: [
    ['id', 'id'],
    ['sliceId', 'slice_id'],
    ['runId', 'run_id'],
    ['repairRunId', 'repair_run_id']
  ],
  discoveries: [
    ['id', 'id'],
    ['sliceId', 'slice_id'],
    ['runId', 'run_id']
  ],
  pricing: [
    ['id', 'id'],
    ['model', 'model'],
    ['provider', 'provider'],
    ['effectiveDate', 'effective_date']
  ]
}

export interface ProjectionConnectionSettings {
  foreignKeys: true
  journalMode: 'wal'
  synchronous: 'normal'
  trustedSchema: false
  busyTimeoutMs: number
}

const SCHEMA_V1 = `
  CREATE TABLE projection_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    dataset_schema_version INTEGER NOT NULL CHECK (dataset_schema_version = 2),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    registry_json TEXT,
    record_count INTEGER NOT NULL CHECK (record_count >= 0),
    serialized_bytes INTEGER NOT NULL CHECK (serialized_bytes >= 0)
  ) STRICT;

  CREATE TABLE slices (
    position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
    id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL
  ) STRICT;

  CREATE TABLE runs (
    position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
    id TEXT PRIMARY KEY,
    slice_id TEXT NOT NULL,
    model TEXT,
    provider TEXT,
    record_json TEXT NOT NULL,
    UNIQUE (id, slice_id),
    FOREIGN KEY (slice_id) REFERENCES slices(id)
  ) STRICT;

  CREATE TABLE findings (
    position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
    id TEXT PRIMARY KEY,
    slice_id TEXT NOT NULL,
    run_id TEXT,
    repair_run_id TEXT,
    record_json TEXT NOT NULL,
    FOREIGN KEY (slice_id) REFERENCES slices(id),
    FOREIGN KEY (run_id, slice_id) REFERENCES runs(id, slice_id),
    FOREIGN KEY (repair_run_id, slice_id) REFERENCES runs(id, slice_id)
  ) STRICT;

  CREATE TABLE discoveries (
    position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
    id TEXT PRIMARY KEY,
    slice_id TEXT NOT NULL,
    run_id TEXT,
    record_json TEXT NOT NULL,
    FOREIGN KEY (slice_id) REFERENCES slices(id),
    FOREIGN KEY (run_id, slice_id) REFERENCES runs(id, slice_id)
  ) STRICT;

  CREATE TABLE pricing (
    position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
    id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    effective_date TEXT NOT NULL,
    record_json TEXT NOT NULL
  ) STRICT;

  CREATE INDEX runs_slice_model ON runs(slice_id, model);
  CREATE INDEX findings_slice_run ON findings(slice_id, run_id);
  CREATE INDEX discoveries_slice_run ON discoveries(slice_id, run_id);
  CREATE INDEX pricing_identity_date ON pricing(model, provider, effective_date);
`

function numeric(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error(`SQLite projection has an invalid ${key} value.`)
  return value
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`SQLite projection has an invalid ${key} value.`)
  return value
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Projection value is not JSON serializable.')
  return serialized
}

function serializedByteLength(serialized: string): number {
  return Buffer.byteLength(serialized)
}

function normalizedSchema(database: DatabaseSync): string {
  const definitions = database
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name`
    )
    .all()
    .map((row) => ({
      type: text(row, 'type'),
      name: text(row, 'name'),
      table: text(row, 'tbl_name'),
      sql: text(row, 'sql')
        .replace(/\s+/g, ' ')
        .replace(/\s*([(),])\s*/g, '$1')
        .trim()
        .toLowerCase()
    }))
  return JSON.stringify(definitions)
}

function expectedSchema(): string {
  const reference = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false
  })
  try {
    reference.exec(SCHEMA_V1)
    return normalizedSchema(reference)
  } finally {
    reference.close()
  }
}

export function projectionDatabasePath(dataDirectory: string): string {
  if (!isAbsolute(dataDirectory))
    throw new Error('Projection data directory must be an absolute user-data or QA path.')
  return join(dataDirectory, PROJECTION_DATABASE_FILENAME)
}

export class SqliteProjectionRepository implements DatasetProjectionRepository {
  readonly connectionSettings: ProjectionConnectionSettings
  private readonly database: DatabaseSync
  private readonly insertMetadata: StatementSync
  private readonly insertSlice: StatementSync
  private readonly insertRun: StatementSync
  private readonly insertFinding: StatementSync
  private readonly insertDiscovery: StatementSync
  private readonly insertPricing: StatementSync

  constructor(readonly path: string) {
    if (!isAbsolute(path)) throw new Error('Projection database path must be absolute.')
    this.database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false
    })
    try {
      const admission = this.admitDatabase()
      this.connectionSettings = this.configureConnection()
      if (admission === 'fresh') this.initializeSchema()
      this.insertMetadata = this.database.prepare(
        `INSERT INTO projection_metadata
          (singleton, dataset_schema_version, revision, registry_json, record_count, serialized_bytes)
         VALUES (1, ?, ?, ?, ?, ?)`
      )
      this.insertSlice = this.database.prepare(
        'INSERT INTO slices (position, id, record_json) VALUES (?, ?, ?)'
      )
      this.insertRun = this.database.prepare(
        `INSERT INTO runs (position, id, slice_id, model, provider, record_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      this.insertFinding = this.database.prepare(
        `INSERT INTO findings (position, id, slice_id, run_id, repair_run_id, record_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      this.insertDiscovery = this.database.prepare(
        `INSERT INTO discoveries (position, id, slice_id, run_id, record_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      this.insertPricing = this.database.prepare(
        `INSERT INTO pricing (position, id, model, provider, effective_date, record_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  private admitDatabase(): 'fresh' | 'existing' {
    const version = numeric(this.database.prepare('PRAGMA user_version').get(), 'user_version')
    if (version > PROJECTION_SCHEMA_VERSION)
      throw new Error(
        `Unsupported projection schema version ${version}; expected at most ${PROJECTION_SCHEMA_VERSION}.`
      )
    const applicationId = numeric(
      this.database.prepare('PRAGMA application_id').get(),
      'application_id'
    )
    if (version === 0) {
      if (applicationId !== 0)
        throw new Error('Unversioned projection database has a foreign application identity.')
      const schema = this.database
        .prepare("SELECT 1 AS present FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1")
        .get()
      if (schema)
        throw new Error(
          'Unversioned projection database contains schema; initialization was refused.'
        )
      return 'fresh'
    }
    if (version !== PROJECTION_SCHEMA_VERSION || applicationId !== APPLICATION_ID)
      throw new Error('Projection database identity or schema version is invalid.')
    if (normalizedSchema(this.database) !== expectedSchema())
      throw new Error('Projection database structure does not match the supported schema version.')
    return 'existing'
  }

  private configureConnection(): ProjectionConnectionSettings {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};
      PRAGMA synchronous = NORMAL;
      PRAGMA trusted_schema = OFF;
    `)
    const journal = this.database.prepare('PRAGMA journal_mode = WAL').get()
    const foreignKeys = numeric(this.database.prepare('PRAGMA foreign_keys').get(), 'foreign_keys')
    const synchronous = numeric(this.database.prepare('PRAGMA synchronous').get(), 'synchronous')
    const trustedSchema = numeric(
      this.database.prepare('PRAGMA trusted_schema').get(),
      'trusted_schema'
    )
    const busyTimeout = numeric(this.database.prepare('PRAGMA busy_timeout').get(), 'timeout')
    if (
      text(journal ?? {}, 'journal_mode').toLowerCase() !== 'wal' ||
      foreignKeys !== 1 ||
      synchronous !== 1 ||
      trustedSchema !== 0 ||
      busyTimeout !== BUSY_TIMEOUT_MS
    )
      throw new Error('SQLite projection connection settings could not be verified.')
    return {
      foreignKeys: true,
      journalMode: 'wal',
      synchronous: 'normal',
      trustedSchema: false,
      busyTimeoutMs: BUSY_TIMEOUT_MS
    }
  }

  private initializeSchema(): void {
    this.transaction(() => {
      this.database.exec(SCHEMA_V1)
      this.database.exec(`PRAGMA application_id = ${APPLICATION_ID}`)
      this.database.exec(`PRAGMA user_version = ${PROJECTION_SCHEMA_VERSION}`)
    })
    if (normalizedSchema(this.database) !== expectedSchema())
      throw new Error('Initialized projection database structure could not be verified.')
  }

  private requireOpen(): void {
    if (!this.database.isOpen) throw new Error('Projection database is closed.')
  }

  private transaction(action: () => void): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      action()
      this.database.exec('COMMIT')
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK')
      throw error
    }
  }

  replace(dataset: Dataset): void {
    this.requireOpen()
    validateDataset(dataset)
    const serialized = json(dataset)
    const serializedBytes = serializedByteLength(serialized)
    const recordCount = TABLES.reduce((total, table) => total + dataset[table].length, 0)
    if (serializedBytes > MAX_PROJECTION_BYTES)
      throw new Error(
        `Projection exceeds the ${MAX_PROJECTION_BYTES.toLocaleString('en-US')} byte limit.`
      )
    if (recordCount > MAX_PROJECTION_RECORDS)
      throw new Error(
        `Projection exceeds the ${MAX_PROJECTION_RECORDS.toLocaleString('en-US')} record limit.`
      )
    const normalized = normalizeDataset(JSON.parse(serialized))
    this.transaction(() => {
      this.database.exec(`
        DELETE FROM findings;
        DELETE FROM discoveries;
        DELETE FROM runs;
        DELETE FROM pricing;
        DELETE FROM slices;
        DELETE FROM projection_metadata;
      `)
      normalized.slices.forEach((record, position) =>
        this.insertSlice.run(position, record.id, json(record))
      )
      normalized.runs.forEach((record, position) =>
        this.insertRun.run(
          position,
          record.id,
          record.sliceId,
          record.model ?? null,
          record.provider ?? null,
          json(record)
        )
      )
      normalized.findings.forEach((record, position) =>
        this.insertFinding.run(
          position,
          record.id,
          record.sliceId,
          record.runId ?? null,
          record.repairRunId ?? null,
          json(record)
        )
      )
      normalized.discoveries.forEach((record, position) =>
        this.insertDiscovery.run(
          position,
          record.id,
          record.sliceId,
          record.runId ?? null,
          json(record)
        )
      )
      normalized.pricing.forEach((record, position) =>
        this.insertPricing.run(
          position,
          record.id,
          record.model,
          record.provider,
          record.effectiveDate,
          json(record)
        )
      )
      this.insertMetadata.run(
        normalized.schemaVersion,
        normalized.revision,
        normalized.registry === undefined ? null : json(normalized.registry),
        recordCount,
        serializedBytes
      )
    })
  }

  private readRows(table: (typeof TABLES)[number]): Record<string, unknown>[] {
    const rows = this.database.prepare(`SELECT * FROM ${table} ORDER BY position`).all() as Record<
      string,
      unknown
    >[]
    rows.forEach((row, position) => {
      if (numeric(row, 'position') !== position)
        throw new Error(`SQLite projection ${table} positions are not contiguous.`)
    })
    return rows
  }

  private boundedPhysicalRecordCount(limit: number): number {
    const union = TABLES.map((table) => `SELECT 1 AS present FROM ${table}`).join(' UNION ALL ')
    return numeric(
      this.database.prepare(`SELECT count(*) AS count FROM (${union} LIMIT ?)`).get(limit),
      'count'
    )
  }

  private parseRecord(
    table: (typeof TABLES)[number],
    row: Record<string, unknown>
  ): Record<string, unknown> {
    let record: unknown
    try {
      record = JSON.parse(text(row, 'record_json'))
    } catch {
      throw new Error(`SQLite projection ${table} record JSON is invalid.`)
    }
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new Error(`SQLite projection ${table} record is not an object.`)
    const value = record as Record<string, unknown>
    for (const [jsonKey, column] of REDUNDANT_FIELDS[table]) {
      const canonicalValue = value[jsonKey] === undefined ? null : value[jsonKey]
      if (canonicalValue !== row[column])
        throw new Error(
          `SQLite projection ${table} relational projection does not match its JSON record.`
        )
    }
    return value
  }

  load(): Dataset | undefined {
    this.requireOpen()
    this.database.exec('BEGIN')
    try {
      const result = this.loadSnapshot()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK')
      throw error
    }
  }

  private loadSnapshot(): Dataset | undefined {
    const metadata = this.database
      .prepare('SELECT * FROM projection_metadata WHERE singleton = 1')
      .get() as Record<string, unknown> | undefined
    if (!metadata) {
      const orphanCount = this.boundedPhysicalRecordCount(1)
      if (orphanCount) throw new Error('SQLite projection contains records without metadata.')
      return undefined
    }
    const recordCount = numeric(metadata, 'record_count')
    const serializedBytes = numeric(metadata, 'serialized_bytes')
    if (recordCount > MAX_PROJECTION_RECORDS || serializedBytes > MAX_PROJECTION_BYTES)
      throw new Error('SQLite projection exceeds configured synchronous-work limits.')
    const physicalRecordCount = this.boundedPhysicalRecordCount(MAX_PROJECTION_RECORDS + 1)
    if (physicalRecordCount > MAX_PROJECTION_RECORDS)
      throw new Error('SQLite projection physical record count exceeds the configured limit.')
    if (physicalRecordCount !== recordCount)
      throw new Error('SQLite projection record count does not match its metadata.')
    const measuredBytes = TABLES.reduce(
      (total, table) =>
        total +
        numeric(
          this.database
            .prepare(
              `SELECT coalesce(sum(length(CAST(record_json AS BLOB))), 0) AS bytes FROM ${table}`
            )
            .get(),
          'bytes'
        ),
      metadata.registry_json === null ? 0 : Buffer.byteLength(text(metadata, 'registry_json'))
    )
    if (measuredBytes > MAX_PROJECTION_BYTES)
      throw new Error('SQLite projection payload exceeds the configured byte limit.')
    const rows = Object.fromEntries(TABLES.map((table) => [table, this.readRows(table)])) as Record<
      (typeof TABLES)[number],
      Record<string, unknown>[]
    >
    const actualCount = TABLES.reduce((total, table) => total + rows[table].length, 0)
    if (actualCount !== physicalRecordCount)
      throw new Error('SQLite projection record count does not match its metadata.')
    let registry: unknown
    if (metadata.registry_json !== null) {
      try {
        registry = JSON.parse(text(metadata, 'registry_json'))
      } catch {
        throw new Error('SQLite projection registry JSON is invalid.')
      }
    }
    const dataset = normalizeDataset({
      schemaVersion: numeric(metadata, 'dataset_schema_version'),
      revision: numeric(metadata, 'revision'),
      slices: rows.slices.map((row) => this.parseRecord('slices', row)),
      runs: rows.runs.map((row) => this.parseRecord('runs', row)),
      findings: rows.findings.map((row) => this.parseRecord('findings', row)),
      discoveries: rows.discoveries.map((row) => this.parseRecord('discoveries', row)),
      pricing: rows.pricing.map((row) => this.parseRecord('pricing', row)),
      ...(registry === undefined ? {} : { registry })
    })
    if (serializedByteLength(json(dataset)) !== serializedBytes)
      throw new Error('SQLite projection serialized byte count does not match its metadata.')
    return dataset
  }

  close(): void {
    if (this.database.isOpen) this.database.close()
  }
}
