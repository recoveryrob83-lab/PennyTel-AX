import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  MAX_PROJECTION_BYTES,
  MAX_PROJECTION_RECORDS,
  PROJECTION_DATABASE_FILENAME,
  PROJECTION_SCHEMA_VERSION,
  SqliteProjectionRepository,
  projectionDatabasePath
} from '../src/main/sqlite-projection'
import { MainProcessStorageService } from '../src/main/storage-service'
import type { Dataset } from '../src/shared/types'
import { comparisonFixture, evidenceFixture, fixture } from './fixtures'
import { registryFixture } from './registry-fixtures'

async function qaDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pennytel-storage-'))
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
    notes: 'Model, token, and pricing evidence are deliberately Unknown.'
  })
  return data
}

function openService(path: string): {
  repository: SqliteProjectionRepository
  service: MainProcessStorageService
} {
  const repository = new SqliteProjectionRepository(path)
  return { repository, service: new MainProcessStorageService(repository) }
}

describe('main-process SQLite projection foundation', () => {
  it('initializes deterministic schema/settings and losslessly round-trips current Dataset semantics', async () => {
    const directory = await qaDirectory()
    const path = projectionDatabasePath(directory)
    expect(path).toBe(join(directory, PROJECTION_DATABASE_FILENAME))
    const expected = representativeDataset()
    const first = openService(path)
    expect(first.repository.connectionSettings).toEqual({
      foreignKeys: true,
      journalMode: 'wal',
      synchronous: 'normal',
      trustedSchema: false,
      busyTimeoutMs: 500
    })
    expect(first.service.loadProjection()).toBeUndefined()
    first.service.project(expected)
    const loaded = first.service.loadProjection()!
    expect(loaded).toEqual(expected)
    expect(loaded.runs.find((run) => run.id === 'astra-impl')!.executionEvidence).toEqual(
      evidenceFixture()
    )
    expect(loaded.registry).toEqual(expected.registry)
    expect(loaded.runs.find((run) => run.id === 'unknown-telemetry')).not.toHaveProperty(
      'outputTokens'
    )
    expect(loaded.runs.find((run) => run.id === 'luna-critic')!.outputTokens).toBe(0)
    loaded.slices[0].title = 'Detached caller mutation'
    expect(first.service.loadProjection()!.slices[0].title).toBe(expected.slices[0].title)
    first.service.close()

    const raw = new DatabaseSync(path)
    expect(raw.prepare('PRAGMA user_version').get()!.user_version).toBe(PROJECTION_SCHEMA_VERSION)
    expect(raw.prepare('PRAGMA application_id').get()!.application_id).not.toBe(0)
    expect(
      raw
        .prepare('EXPLAIN QUERY PLAN SELECT * FROM runs WHERE slice_id = ? AND model = ?')
        .all('mixed', 'QA Luna')
        .some((row) => String(row.detail).includes('runs_slice_model'))
    ).toBe(true)
    raw.close()

    const restarted = openService(path)
    expect(restarted.service.loadProjection()).toEqual(expected)
    restarted.service.close()
    expect(() => restarted.service.loadProjection()).toThrow('closed')
    restarted.service.close()
  })

  it('rolls back the complete replacement when a SQLite write fails mid-transaction', async () => {
    const directory = await qaDirectory()
    const path = projectionDatabasePath(directory)
    const initial = representativeDataset()
    const { service } = openService(path)
    service.project(initial)
    const triggerConnection = new DatabaseSync(path)
    triggerConnection.exec(`
      CREATE TRIGGER synthetic_run_failure
      BEFORE INSERT ON runs
      WHEN NEW.id = 'astra-impl'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic projection failure');
      END;
    `)
    const replacement = structuredClone(initial)
    replacement.revision += 1
    replacement.slices[0].title = 'Must roll back'
    expect(() => service.project(replacement)).toThrow('synthetic projection failure')
    expect(service.loadProjection()).toEqual(initial)
    triggerConnection.exec('DROP TRIGGER synthetic_run_failure')
    triggerConnection.close()
    service.project(replacement)
    expect(service.loadProjection()).toEqual(replacement)
    service.close()
  })

  it('fails closed on unsupported or ambiguous schema state without rewriting it', async () => {
    const futureDirectory = await qaDirectory()
    const futurePath = projectionDatabasePath(futureDirectory)
    const future = new DatabaseSync(futurePath)
    future.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA user_version = ${PROJECTION_SCHEMA_VERSION + 1};
    `)
    future.close()
    expect(() => new SqliteProjectionRepository(futurePath)).toThrow(
      `Unsupported projection schema version ${PROJECTION_SCHEMA_VERSION + 1}`
    )
    const preserved = new DatabaseSync(futurePath)
    expect(preserved.prepare('PRAGMA user_version').get()!.user_version).toBe(
      PROJECTION_SCHEMA_VERSION + 1
    )
    expect(preserved.prepare('PRAGMA journal_mode').get()!.journal_mode).toBe('delete')
    preserved.close()

    const foreignDirectory = await qaDirectory()
    const foreignPath = projectionDatabasePath(foreignDirectory)
    const foreign = new DatabaseSync(foreignPath)
    foreign.exec('PRAGMA application_id = 305419896')
    foreign.close()
    expect(() => new SqliteProjectionRepository(foreignPath)).toThrow(
      'foreign application identity'
    )
    const unclaimed = new DatabaseSync(foreignPath)
    expect(unclaimed.prepare('PRAGMA application_id').get()!.application_id).toBe(305419896)
    expect(unclaimed.prepare('PRAGMA user_version').get()!.user_version).toBe(0)
    unclaimed.close()

    const ambiguousDirectory = await qaDirectory()
    const ambiguousPath = projectionDatabasePath(ambiguousDirectory)
    const ambiguous = new DatabaseSync(ambiguousPath)
    ambiguous.exec('CREATE TABLE legacy_unknown (id TEXT PRIMARY KEY)')
    ambiguous.close()
    expect(() => new SqliteProjectionRepository(ambiguousPath)).toThrow(
      'Unversioned projection database contains schema'
    )
    const unchanged = new DatabaseSync(ambiguousPath)
    expect(
      unchanged
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'legacy_unknown'")
        .get()!.name
    ).toBe('legacy_unknown')
    expect(unchanged.prepare('PRAGMA user_version').get()!.user_version).toBe(0)
    unchanged.close()

    const malformedDirectory = await qaDirectory()
    const malformedPath = projectionDatabasePath(malformedDirectory)
    const initialized = openService(malformedPath)
    initialized.service.close()
    const malformed = new DatabaseSync(malformedPath)
    malformed.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA foreign_keys = OFF;
      DROP TABLE findings;
      DROP TABLE discoveries;
      DROP TABLE runs;
      DROP TABLE pricing;
      DROP TABLE slices;
      DROP TABLE projection_metadata;
      CREATE TABLE projection_metadata (
        singleton INTEGER PRIMARY KEY,
        dataset_schema_version INTEGER,
        revision INTEGER,
        registry_json TEXT,
        record_count INTEGER,
        serialized_bytes INTEGER
      );
      CREATE TABLE slices (position INTEGER, id TEXT PRIMARY KEY, record_json TEXT);
      CREATE TABLE runs (
        position INTEGER, id TEXT PRIMARY KEY, slice_id TEXT, model TEXT, provider TEXT,
        record_json TEXT
      );
      CREATE TABLE findings (
        position INTEGER, id TEXT PRIMARY KEY, slice_id TEXT, run_id TEXT,
        repair_run_id TEXT, record_json TEXT
      );
      CREATE TABLE discoveries (
        position INTEGER, id TEXT PRIMARY KEY, slice_id TEXT, run_id TEXT, record_json TEXT
      );
      CREATE TABLE pricing (
        position INTEGER, id TEXT PRIMARY KEY, model TEXT, provider TEXT,
        effective_date TEXT, record_json TEXT
      );
    `)
    malformed.close()
    expect(() => new SqliteProjectionRepository(malformedPath)).toThrow('structure does not match')
    const malformedPreserved = new DatabaseSync(malformedPath)
    expect(malformedPreserved.prepare('PRAGMA journal_mode').get()!.journal_mode).toBe('delete')
    malformedPreserved.close()
  })

  it('bounds synchronous projection work and preserves the previous complete snapshot', async () => {
    const directory = await qaDirectory()
    const path = projectionDatabasePath(directory)
    const { service } = openService(path)
    const initial = fixture()
    service.project(initial)
    const oversized = fixture()
    for (let index = 0; index < 100; index++)
      oversized.slices.push({
        id: `large-${index}`,
        title: `Large synthetic ${index}`,
        notes: 'x'.repeat(100_000)
      })
    expect(Buffer.byteLength(JSON.stringify(oversized))).toBeGreaterThan(MAX_PROJECTION_BYTES)
    expect(() => service.project(oversized)).toThrow('byte limit')
    expect(service.loadProjection()).toEqual(initial)
    service.close()
  })

  it('reconciles serialized byte metadata with the reconstructed projection', async () => {
    const directory = await qaDirectory()
    const path = projectionDatabasePath(directory)
    const expected = representativeDataset()
    const { service } = openService(path)
    service.project(expected)
    const metadata = new DatabaseSync(path)
    const correctBytes = metadata
      .prepare('SELECT serialized_bytes FROM projection_metadata WHERE singleton = 1')
      .get()!.serialized_bytes as number
    expect(correctBytes).toBe(Buffer.byteLength(JSON.stringify(expected)))
    expect(correctBytes + 1).toBeLessThan(MAX_PROJECTION_BYTES)

    for (const forgedBytes of [0, correctBytes + 1]) {
      metadata
        .prepare('UPDATE projection_metadata SET serialized_bytes = ? WHERE singleton = 1')
        .run(forgedBytes)
      expect(() => service.loadProjection()).toThrow(
        'serialized byte count does not match its metadata'
      )
    }

    metadata
      .prepare('UPDATE projection_metadata SET serialized_bytes = ? WHERE singleton = 1')
      .run(correctBytes)
    expect(service.loadProjection()).toEqual(expected)
    metadata.close()
    service.close()
  })

  it('retains the actual payload ceiling independently of serialized byte metadata', async () => {
    const directory = await qaDirectory()
    const path = projectionDatabasePath(directory)
    const { service } = openService(path)
    service.project(representativeDataset())
    const tamper = new DatabaseSync(path)
    tamper
      .prepare('UPDATE projection_metadata SET registry_json = ? WHERE singleton = 1')
      .run('x'.repeat(MAX_PROJECTION_BYTES + 1))
    tamper.close()
    expect(() => service.loadProjection()).toThrow('payload exceeds the configured byte limit')
    service.close()
  })

  it.each([
    ['run model', "UPDATE runs SET model = 'tampered' WHERE id = 'astra-impl'"],
    ['run provider', "UPDATE runs SET provider = 'tampered' WHERE id = 'astra-impl'"],
    ['finding run', "UPDATE findings SET run_id = 'astra-impl' WHERE id = 'product'"],
    ['finding repair run', "UPDATE findings SET repair_run_id = 'astra-impl' WHERE id = 'product'"],
    ['discovery run', "UPDATE discoveries SET run_id = 'luna-critic' WHERE id = 'discovery'"],
    ['pricing model', "UPDATE pricing SET model = 'tampered' WHERE id = 'price-test'"],
    ['pricing provider', "UPDATE pricing SET provider = 'tampered' WHERE id = 'price-test'"],
    [
      'pricing effective date',
      "UPDATE pricing SET effective_date = '2026-02-01' WHERE id = 'price-test'"
    ],
    [
      'run slice',
      "UPDATE runs SET record_json = json_set(record_json, '$.sliceId', 'luna-only') WHERE id = 'astra-impl'"
    ]
  ])('detects %s relational-column/JSON divergence', async (_label, statement) => {
    const directory = await qaDirectory()
    const path = projectionDatabasePath(directory)
    const { service } = openService(path)
    service.project(representativeDataset())
    const tamper = new DatabaseSync(path)
    tamper.exec(statement)
    tamper.close()
    expect(() => service.loadProjection()).toThrow('relational projection does not match')
    service.close()
  })

  it('rejects forged metadata before materializing an over-limit physical projection', async () => {
    const directory = await qaDirectory()
    const path = projectionDatabasePath(directory)
    const { service } = openService(path)
    const bounded: Dataset = {
      schemaVersion: 2,
      revision: 0,
      slices: Array.from({ length: MAX_PROJECTION_RECORDS }, (_, position) => ({
        id: `bounded-${position}`,
        title: 'Bounded projection record'
      })),
      runs: [],
      findings: [],
      discoveries: [],
      pricing: []
    }
    service.project(bounded)
    expect(service.loadProjection()).toEqual(bounded)
    const tamper = new DatabaseSync(path)
    tamper
      .prepare('INSERT INTO slices (position, id, record_json) VALUES (?, ?, ?)')
      .run(MAX_PROJECTION_RECORDS, 'over-limit', 'not-json')
    tamper.close()
    expect(() => service.loadProjection()).toThrow('physical record count exceeds')
    service.close()
  })

  it('requires absolute service-owned data paths', () => {
    expect(() => projectionDatabasePath('relative/profile')).toThrow('absolute')
    expect(() => new SqliteProjectionRepository('relative.sqlite')).toThrow('absolute')
  })
})
