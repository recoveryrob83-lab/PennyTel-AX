// Durable adapter smoke entry. It is a separate Electron main entry, never an application hook.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import canonicalRegistry from '../../docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json'
import type { Dataset } from '../shared/types'
import { SqliteProjectionRepository, projectionDatabasePath } from './sqlite-projection'
import { MainProcessStorageService } from './storage-service'

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

const repository = new SqliteProjectionRepository(databasePath)
const settings = repository.connectionSettings
const service = new MainProcessStorageService(repository)
const expected = representativeDataset()
try {
  if (phase === 'create') service.project(expected)
  const actual = service.loadProjection()
  assert.deepEqual(actual, expected)
  assert.equal(Object.hasOwn(actual!.runs[0], 'outputTokens'), true)
  assert.equal(actual!.runs[0].outputTokens, 0)
  assert.equal(Object.hasOwn(actual!.runs[1], 'outputTokens'), false)
  assert.equal(actual!.runs[0].executionEvidence?.environment?.networkAccess, 'restricted')
  assert.equal(actual!.registry?.kind, 'pennytel-model-registry')
  writeFileSync(
    join(directory, `${phase}-report.json`),
    JSON.stringify(
      {
        phase,
        versions: process.versions,
        processType: process.type ?? 'run-as-node',
        databasePath,
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
          outsideAsar: true
        }
      },
      null,
      2
    )
  )
} finally {
  service.close()
}
process.exit(0)
