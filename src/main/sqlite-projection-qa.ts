// Durable adapter smoke entry. It is a separate Electron main entry, never an application hook.
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import canonicalRegistry from '../../docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json'
import type { Dataset } from '../shared/types'
import { CanonicalArtifactStore } from './canonical-artifact-store'
import { canonicalArtifactStorePath } from './canonical-artifacts'
import { SqliteProjectionRepository, projectionDatabasePath } from './sqlite-projection'
import { MainProcessStorageService } from './storage-service'
import { PROJECTION_RECOVERY_DIRECTORY } from './production-projection'
import {
  ProductionStore,
  LEGACY_LIVE,
  LEGACY_BACKUP,
  LEGACY_ARCHIVE,
  LEGACY_BACKUP_ARCHIVE
} from './production-store'

function representativeDataset(): Dataset {
  return {
    schemaVersion: 2,
    revision: 7,
    slices: [
      {
        id: 's9-qa',
        title: 'Synthetic SQLite projection QA',
        project: 'PennyTel QA',
        startDate: '2026-09-18',
        acceptedAt: '2026-09-18T12:00:00-05:00',
        disposition: 'Accepted'
      }
    ],
    runs: [
      {
        id: 'known-zero',
        sliceId: 's9-qa',
        runType: 'Storage QA',
        role: 'Implementer',
        model: 'GPT-5.6 Luna',
        provider: 'OpenAI',
        modelId: 'openai-gpt-5-6-luna',
        providerId: 'openai',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        startAt: '2026-09-18T10:00:00-05:00',
        endAt: '2026-09-18T10:01:00-05:00',
        executionEvidence: {
          kind: 'codex-rollout',
          formatVersion: 1,
          modelInvocationCount: 1,
          toolCallCount: 0,
          environment: { sandboxMode: 'workspace-write', networkAccess: 'restricted' }
        }
      },
      {
        id: 'unknown-telemetry',
        sliceId: 's9-qa',
        runType: 'Storage QA',
        role: 'Critic',
        notes: 'Token and model telemetry are deliberately Unknown.'
      }
    ],
    findings: [
      {
        id: 'synthetic-finding',
        sliceId: 's9-qa',
        runId: 'known-zero',
        severity: 'Observation',
        category: 'Architecture',
        description: 'Synthetic relationship evidence for adapter QA.',
        status: 'Dismissed'
      }
    ],
    discoveries: [
      {
        id: 'synthetic-discovery',
        sliceId: 's9-qa',
        runId: 'known-zero',
        description: 'Synthetic discovery evidence for adapter QA.',
        validation: 'Yes',
        adopted: 'Deferred'
      }
    ],
    pricing: [
      {
        id: 'synthetic-price',
        model: 'Synthetic model',
        provider: 'Synthetic provider',
        effectiveDate: '2026-01-01',
        inputRate: 1,
        cachedRate: 0,
        outputRate: 2,
        source: 'Synthetic QA only'
      }
    ],
    registry: canonicalRegistry as Dataset['registry']
  }
}

const directoryArgument = process.argv[2]
const phase = process.argv[3]
assert.ok(directoryArgument, 'QA data directory is required.')
assert.ok(phase === 'create' || phase === 'restart', 'QA phase must be create or restart.')
assert.ok(process.versions.electron, 'This QA entry must run in the Electron runtime.')
const directory = resolve(directoryArgument)
const databasePath = projectionDatabasePath(directory)
assert.equal(databasePath.startsWith(`${directory}/`), true)
assert.equal(databasePath.includes('app.asar'), false)

function evidenceSnapshot(path: string): unknown {
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => [
      entry.name,
      entry.isDirectory()
        ? evidenceSnapshot(join(path, entry.name))
        : createHash('sha256')
            .update(readFileSync(join(path, entry.name)))
            .digest('hex')
    ])
}

async function startupRefusalQa(): Promise<Array<{ directory: string; message: string }>> {
  const cases = [
    { name: 'newer-backup', message: 'live and backup revisions contradict' },
    { name: 'canonical-legacy', message: 'Canonical and legacy live storage contradict' },
    { name: 'quarantine-only', message: 'Projection-only recovery' }
  ]
  const results: Array<{ directory: string; message: string }> = []
  for (const { name, message } of cases) {
    const profile = join(directory, `refusal-${name}`)
    if (phase === 'create') {
      mkdirSync(profile)
      const data = representativeDataset()
      if (name === 'newer-backup') {
        writeFileSync(join(profile, LEGACY_LIVE), JSON.stringify(data) + '\n')
        writeFileSync(
          join(profile, LEGACY_BACKUP),
          JSON.stringify({ ...data, revision: data.revision + 1 })
        )
        const projection = new SqliteProjectionRepository(projectionDatabasePath(profile))
        projection.replace(data)
        projection.close()
      } else {
        let initial = new ProductionStore(profile)
        await initial.load()
        await initial.close()
        if (name === 'canonical-legacy') {
          writeFileSync(join(profile, LEGACY_LIVE), JSON.stringify(data))
          const projection = new SqliteProjectionRepository(projectionDatabasePath(profile))
          projection.replace(data)
          projection.close()
          writeFileSync(
            join(canonicalArtifactStorePath(profile), 'stage-put-0.json'),
            'preserved work'
          )
          writeFileSync(
            join(canonicalArtifactStorePath(profile), 'transaction-pending.next.json'),
            '{}'
          )
        } else {
          writeFileSync(projectionDatabasePath(profile), 'invalid SQLite to quarantine')
          initial = new ProductionStore(profile)
          await initial.load()
          await initial.close()
          assert.ok(readdirSync(join(profile, PROJECTION_RECOVERY_DIRECTORY)).length)
          const preserved = join(directory, 'preserved-quarantine-authority')
          mkdirSync(preserved)
          renameSync(canonicalArtifactStorePath(profile), join(preserved, 'canonical'))
          renameSync(projectionDatabasePath(profile), join(preserved, 'projection'))
        }
      }
    }
    const before = evidenceSnapshot(profile)
    const store = new ProductionStore(profile)
    try {
      await assert.rejects(store.initializeRegistry(), new RegExp(message))
      await assert.rejects(store.load(), new RegExp(message))
    } finally {
      await store.close()
    }
    assert.deepEqual(evidenceSnapshot(profile), before)
    results.push({ directory: profile, message })
  }
  return results
}

async function runQa(): Promise<void> {
  const repository = new SqliteProjectionRepository(databasePath)
  const settings = repository.connectionSettings
  const service = new MainProcessStorageService(repository)
  const expected = representativeDataset()
  try {
    const startupRefusals = await startupRefusalQa()
    if (phase === 'create') service.project(expected)
    const actual = service.loadProjection()
    assert.deepEqual(actual, expected)
    assert.equal(Object.hasOwn(actual!.runs[0], 'outputTokens'), true)
    assert.equal(actual!.runs[0].outputTokens, 0)
    assert.equal(Object.hasOwn(actual!.runs[1], 'outputTokens'), false)
    assert.equal(actual!.runs[0].executionEvidence?.environment?.networkAccess, 'restricted')
    assert.equal(actual!.registry?.kind, 'pennytel-model-registry')
    const canonicalDirectory = join(directory, 'canonical-qa')
    if (phase === 'create') mkdirSync(canonicalDirectory, { mode: 0o700 })
    const artifactRoot = canonicalArtifactStorePath(canonicalDirectory)
    assert.equal(artifactRoot.includes('app.asar'), false)
    const artifactService = new MainProcessStorageService(
      new SqliteProjectionRepository(projectionDatabasePath(canonicalDirectory))
    )
    let interrupted = false
    const artifacts = new CanonicalArtifactStore(artifactRoot, artifactService, {
      faultInjector: ({ boundary }) => {
        if (phase === 'create' && !interrupted && boundary === 'canonical-state-durable') {
          interrupted = true
          throw new Error('synthetic Electron publish interruption')
        }
      }
    })
    try {
      if (phase === 'create') {
        await artifacts.initialize(expected).then(
          () => assert.fail('Synthetic publish interruption did not occur.'),
          (error: unknown) =>
            assert.match((error as Error).message, /synthetic Electron publish interruption/)
        )
        assert.deepEqual(artifactService.loadProjection(), undefined)
      } else {
        assert.equal((await artifacts.recover()).action, 'recovered-publication')
        assert.equal((await artifacts.recover()).action, 'none')
        assert.deepEqual(artifactService.loadProjection(), expected)
      }
      assert.deepEqual(await artifacts.loadCanonical(), expected)
    } finally {
      artifactService.close()
    }
    const productionDirectory = join(directory, 'production-qa')
    const legacyBytes = Buffer.from(JSON.stringify(expected, null, '\t') + '\r\n')
    const backupBytes = Buffer.from(JSON.stringify({ ...expected, revision: 6 }) + '\n')
    if (phase === 'create') {
      mkdirSync(productionDirectory, { mode: 0o700 })
      writeFileSync(join(productionDirectory, LEGACY_LIVE), legacyBytes)
      writeFileSync(join(productionDirectory, LEGACY_BACKUP), backupBytes)
      const production = new ProductionStore(productionDirectory, {
        canonical: {
          faultInjector: ({ boundary }) => {
            if (boundary === 'canonical-state-durable')
              throw new Error('synthetic migration interruption')
          }
        }
      })
      await assert.rejects(production.load(), /synthetic migration interruption/)
      await production.close()
      assert.deepEqual(readFileSync(join(productionDirectory, LEGACY_LIVE)), legacyBytes)
      assert.deepEqual(readFileSync(join(productionDirectory, LEGACY_BACKUP)), backupBytes)
    } else {
      let production = new ProductionStore(productionDirectory)
      assert.deepEqual((await production.load()).data, expected)
      assert.deepEqual(readFileSync(join(productionDirectory, LEGACY_ARCHIVE)), legacyBytes)
      assert.deepEqual(readFileSync(join(productionDirectory, LEGACY_BACKUP_ARCHIVE)), backupBytes)
      const saved = await production.mutate({
        kind: 'save',
        table: 'slices',
        revision: expected.revision,
        record: { ...expected.slices[0], notes: 'Canonical production mutation after migration' }
      })
      await production.close()
      // A safely replaceable but inadmissible database must rebuild in Electron.
      writeFileSync(projectionDatabasePath(productionDirectory), 'synthetic invalid SQLite')
      production = new ProductionStore(productionDirectory)
      assert.deepEqual((await production.load()).data, saved.data)
      await production.close()
      unlinkSync(projectionDatabasePath(productionDirectory))
      production = new ProductionStore(productionDirectory)
      assert.deepEqual((await production.initializeRegistry()).data, saved.data)
      await production.close()
      const rebuilt = new SqliteProjectionRepository(projectionDatabasePath(productionDirectory))
      assert.deepEqual(rebuilt.load(), saved.data)
      rebuilt.close()
      assert.equal(existsSync(join(productionDirectory, LEGACY_LIVE)), false)
      assert.equal(existsSync(join(productionDirectory, LEGACY_BACKUP)), false)
      assert.deepEqual(readFileSync(join(productionDirectory, LEGACY_ARCHIVE)), legacyBytes)
      assert.deepEqual(readFileSync(join(productionDirectory, LEGACY_BACKUP_ARCHIVE)), backupBytes)
    }
    writeFileSync(
      join(directory, `${phase}-report.json`),
      JSON.stringify(
        {
          phase,
          versions: process.versions,
          processType: process.type ?? 'run-as-node',
          databasePath,
          artifactRoot,
          productionDirectory,
          startupRefusals,
          settings,
          revision: actual!.revision,
          recordCounts: {
            slices: actual!.slices.length,
            runs: actual!.runs.length,
            findings: actual!.findings.length,
            discoveries: actual!.discoveries.length,
            pricing: actual!.pricing.length
          },
          checks: {
            roundTrip: true,
            knownZero: true,
            unknownOmitted: true,
            nestedEvidence: true,
            registry: true,
            outsideAsar: true,
            canonicalArtifactRestartRecovery: true,
            legacyMigrationBoundary: true,
            startupRefusalEvidenceUnchanged: true,
            ...(phase === 'restart'
              ? {
                  legacyArchiveExactBytes: true,
                  productionCanonicalMutation: true,
                  invalidAndMissingProjectionRebuild: true,
                  noLegacyDualWrites: true
                }
              : {})
          }
        },
        null,
        2
      )
    )
  } finally {
    service.close()
  }
}

runQa().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error)
    process.exit(1)
  }
)
