// Real Electron schema-v2 QA; all data and source identifiers are synthetic.
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { captureElectron } from './electron-qa-capture.mjs'
import { verifyEvidenceAnalysis } from './electron-evidence-analysis-qa.mjs'

await mkdir(resolve('test-results'), { recursive: true })
const directory = await mkdtemp(resolve('test-results/execution-evidence-runtime-'))
const evidence = JSON.parse(
  await readFile(resolve('tests/execution-evidence-fixture.json'), 'utf8')
)
const registry = JSON.parse(
  await readFile(
    resolve('docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json'),
    'utf8'
  )
)
const legacy = {
  schemaVersion: 1,
  revision: 7,
  registry,
  slices: [{ id: 'evidence-slice', title: 'Synthetic evidence slice', notes: 'Café 日本語 😀 �' }],
  runs: [
    {
      id: 'legacy-run',
      sliceId: 'evidence-slice',
      runType: 'Historical run',
      role: 'Implementer',
      model: 'Synthetic model',
      provider: 'Synthetic provider',
      inputTokens: 100,
      cachedInputTokens: 1000,
      outputTokens: 200,
      reasoningTokens: 150,
      inputRate: 2,
      cachedRate: 0.5,
      outputRate: 10,
      priceSnapshot: {
        model: 'Synthetic model',
        provider: 'Synthetic provider',
        source: 'Override',
        inputRate: 2,
        cachedRate: 0.5,
        outputRate: 10
      }
    }
  ],
  findings: [
    {
      id: 'linked-finding',
      sliceId: 'evidence-slice',
      runId: 'legacy-run',
      severity: 'Observation',
      category: 'Test Gap',
      description: 'Synthetic linked evidence'
    }
  ],
  discoveries: [],
  pricing: []
}
const live = join(directory, 'telemetry.json')
const backup = join(directory, 'telemetry.backup.json')
const bytes = JSON.stringify(legacy) + '\n'
await writeFile(live, bytes)
let application, page
const errors = []
const button = (name) => page.getByRole('button', { name, exact: true })
const load = async () => (await page.evaluate(() => window.pennytel.load())).data

async function launch(profile, expectLoaded = true) {
  const env = { ...process.env, PENNYTEL_DATA_DIR: profile }
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      resolve('out/main/index.js')
    ],
    env,
    timeout: 30000
  })
  page = await application.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.webContents.setBackgroundThrottling(false)
    window.show()
    window.focus()
  })
  await page.bringToFront()
  if (expectLoaded)
    await page.getByRole('heading', { name: 'Slice notebook', exact: true }).waitFor()
}
async function exportTo(path) {
  await application.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination })
  }, path)
  assert.equal(await page.evaluate(() => window.pennytel.exportData()), path)
  return JSON.parse(await readFile(path, 'utf8'))
}

try {
  await launch(directory)
  assert.deepEqual(await load(), { ...legacy, schemaVersion: 2 })
  assert.equal(await readFile(live, 'utf8'), bytes)
  assert.deepEqual(await exportTo(join(directory, 'migrated-export.json')), {
    ...legacy,
    schemaVersion: 2
  })
  assert.equal(await readFile(live, 'utf8'), bytes)
  await assert.rejects(readFile(backup), { code: 'ENOENT' })
  console.log(
    'PASS: v1 startup/export normalize to v2 without rewriting live bytes, creating backup or changing revision/pricing/relationships'
  )

  await page.getByRole('navigation').getByRole('button', { name: 'Data & portability' }).click()
  const importedRun = {
    ...legacy.runs[0],
    id: 'evidence-run',
    runType: 'Evidence runtime run',
    executionEvidence: evidence
  }
  const batch = JSON.stringify({ schemaVersion: 2, revision: 999, runs: [importedRun] })
  await page.getByLabel('Dataset JSON').fill(batch)
  await button('Validate & preview').click()
  assert.equal(await readFile(live, 'utf8'), bytes)
  await button('Import records').click()
  await page.getByRole('status').filter({ hasText: 'Import saved' }).waitFor()
  const imported = await load()
  assert.equal(imported.schemaVersion, 2)
  assert.equal(imported.revision, 8)
  assert.deepEqual(imported.runs[1], importedRun)
  assert.equal(await readFile(backup, 'utf8'), bytes)
  assert.deepEqual(await readFile(backup), Buffer.from(bytes, 'utf8'))
  assert.equal(imported.runs[1].usageBurn, undefined)
  assert.equal(imported.runs[1].usageBefore, undefined)
  assert.equal(imported.runs[1].usageAfter, undefined)
  console.log(
    'PASS: actual UI preview/import persists strict evidence and cached/fresh token semantics, leaves operator meter unknown, backs up original v1 bytes'
  )

  const persisted = await readFile(live, 'utf8')
  const backupBytes = await readFile(backup, 'utf8')
  for (const badEvidence of [
    { ...evidence, peakInvocation: { inputTokens: 300000, contextWindowTokens: 200000 } },
    { ...evidence, toolOutput: 'rejected synthetic payload' },
    { ...evidence, environment: { ...evidence.environment, raw: 'rejected' } },
    { ...evidence, quotaWindows: [{ attribution: 'Unknown', first: { usedPercent: 101 } }] }
  ]) {
    const rejected = await page.evaluate(
      async ({ executionEvidence, run, revision }) => {
        try {
          await window.pennytel.mutate({
            kind: 'save',
            table: 'runs',
            revision,
            record: { ...run, executionEvidence }
          })
          return false
        } catch {
          return true
        }
      },
      { executionEvidence: badEvidence, run: importedRun, revision: imported.revision }
    )
    assert.equal(rejected, true)
    await assert.rejects(
      page.evaluate(
        (text) => window.pennytel.previewImport(text),
        JSON.stringify({
          schemaVersion: 2,
          runs: [{ ...importedRun, id: 'invalid', executionEvidence: badEvidence }]
        })
      )
    )
    assert.equal(await readFile(live, 'utf8'), persisted)
    assert.equal(await readFile(backup, 'utf8'), backupBytes)
    assert.deepEqual(await load(), imported)
  }
  console.log(
    'PASS: independent main-process save/preview rejects privacy fields and bad percentages without publishing memory, live or backup changes'
  )

  await page.getByRole('navigation').getByRole('button', { name: 'Slice notebook' }).click()
  await page.getByRole('button').filter({ hasText: 'Synthetic evidence slice' }).click()
  await button('Evidence runtime run').click()
  await button('Edit run').click()
  await page.getByText('Execution evidence', { exact: true }).click()
  const editor = page.getByLabel('Execution evidence JSON')
  assert.deepEqual(JSON.parse(await editor.inputValue()), evidence)
  await editor.fill(JSON.stringify({ ...evidence, prompt: 'rejected synthetic payload' }))
  await button('Save run').click()
  await page.getByRole('alert').filter({ hasText: 'unknown field' }).waitFor()
  assert.equal(await readFile(live, 'utf8'), persisted)
  await editor.fill(
    JSON.stringify({
      ...evidence,
      peakInvocation: { inputTokens: 300000, contextWindowTokens: 200000 }
    })
  )
  await button('Save run').click()
  await page.getByRole('alert').filter({ hasText: 'exceeds paired context window' }).waitFor()
  assert.equal(JSON.parse(await editor.inputValue()).peakInvocation.inputTokens, 300000)
  assert.equal(await readFile(live, 'utf8'), persisted)
  const corrected = { ...evidence, toolCallCount: 0 }
  await editor.fill(JSON.stringify(corrected, null, 2))
  await captureElectron(application, page, { path: join(directory, 'evidence-editor.png') })
  await button('Save run').click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const edited = await load()
  assert.equal(edited.revision, 9)
  assert.deepEqual(edited.runs[1].executionEvidence, corrected)
  assert.deepEqual(edited.runs[1].priceSnapshot, importedRun.priceSnapshot)
  assert.equal(edited.runs[1].role, importedRun.role)
  assert.equal(edited.runs[1].contextMode, undefined)
  assert.equal(edited.runs[1].result, undefined)

  await button('Evidence runtime run').click()
  await button('Edit run').click()
  await page.getByLabel('Input tokens (fresh / noncached)', { exact: true }).fill('101')
  await button('Save run').click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const saved = await load()
  assert.equal(saved.revision, 10)
  assert.deepEqual(saved.runs[1].executionEvidence, corrected)
  assert.deepEqual(saved.runs[1].priceSnapshot, importedRun.priceSnapshot)
  const rawPath = join(directory, 'v2-export.json')
  assert.deepEqual(await exportTo(rawPath), saved)
  assert.equal(
    (await page.evaluate((text) => window.pennytel.previewImport(text), JSON.stringify(saved)))
      .skipped,
    4
  )
  const preferences = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
  )
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  await application.close()
  application = undefined
  await launch(directory)
  assert.deepEqual(await load(), saved)
  assert.deepEqual(JSON.parse(await readFile(live, 'utf8')), saved)
  await application.close()
  application = undefined
  console.log(
    'PASS: failed UI draft/correction, ordinary edit preservation, immutable pricing, reload, idempotent export preview and sandbox/preload boundaries'
  )

  const roundTrip = await mkdtemp(resolve('test-results/execution-evidence-roundtrip-'))
  await writeFile(
    join(roundTrip, 'telemetry.json'),
    JSON.stringify({
      schemaVersion: 2,
      revision: 0,
      registry,
      slices: [],
      runs: [],
      findings: [],
      discoveries: [],
      pricing: []
    })
  )
  await launch(roundTrip)
  const restored = await page.evaluate(
    (text) => window.pennytel.mutate({ kind: 'import', revision: 0, text }),
    JSON.stringify(saved)
  )
  assert.deepEqual(restored.data, { ...saved, revision: 1 })
  const v1Child = {
    schemaVersion: 1,
    runs: [
      { id: 'legacy-child', sliceId: 'evidence-slice', runType: 'Historical child', role: 'Critic' }
    ]
  }
  const appended = await page.evaluate(
    (text) => window.pennytel.mutate({ kind: 'import', revision: 1, text }),
    JSON.stringify(v1Child)
  )
  assert.equal(appended.data.schemaVersion, 2)
  assert.equal(appended.data.revision, 2)
  assert.deepEqual(appended.data.runs[2], v1Child.runs[0])
  await verifyEvidenceAnalysis(application, page, roundTrip)
  assert.deepEqual(errors, [])
  console.log(
    `PASS: v2 raw export/import into another isolated profile, v1 additive child compatibility; no renderer errors. Artifacts: ${directory}, ${roundTrip}`
  )
  await application.close()
  application = undefined
  const malformedProfile = await mkdtemp(resolve('test-results/execution-evidence-invalid-utf8-'))
  const malformedLive = join(malformedProfile, 'telemetry.json')
  const malformedBackup = join(malformedProfile, 'telemetry.backup.json')
  const original = Buffer.from(bytes)
  const offset = original.indexOf(Buffer.from('�'))
  assert.ok(offset >= 0)
  const malformed = Buffer.concat([
    original.subarray(0, offset),
    Buffer.from([0xff]),
    original.subarray(offset + 3)
  ])
  await writeFile(malformedLive, malformed)
  await writeFile(malformedBackup, original)
  await launch(malformedProfile, false)
  await assert.rejects(load(), /encoded data was not valid/)
  await assert.rejects(
    page.evaluate(() =>
      window.pennytel.mutate({
        kind: 'save',
        table: 'slices',
        revision: 7,
        record: { id: 'blocked', title: 'Blocked' }
      })
    ),
    /encoded data was not valid/
  )
  assert.deepEqual(await readFile(malformedLive), malformed)
  assert.deepEqual(await readFile(malformedBackup), original)
  console.log(
    'PASS: malformed UTF-8 blocks Electron startup load and mutation while preserving exact live and backup bytes'
  )
} finally {
  if (application) await application.close()
}
