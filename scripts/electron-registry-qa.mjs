// Real Electron registry QA. Optional source profile is read only and copied into this repo.
import { _electron as electron } from 'playwright'
import { canonicalSnapshot } from './canonical-qa.mjs'
import { captureElectron } from './electron-qa-capture.mjs'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

await mkdir(resolve('test-results'), { recursive: true })
const directory = await mkdtemp(resolve('test-results/registry-runtime-'))
const sourceProfile = process.env.PENNYTEL_QA_SOURCE_PROFILE
const sourceBytes = sourceProfile ? await readFile(sourceProfile, 'utf8') : undefined
const seed = JSON.parse(
  await readFile(
    resolve('docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json'),
    'utf8'
  )
)
const run = (id, model, overrides = {}) => ({
  id,
  sliceId: 'registry-qa',
  role: 'Implementer',
  runType: id,
  model,
  provider: 'OpenAI',
  inputTokens: 138187,
  cachedInputTokens: 2902400,
  outputTokens: 69046,
  reasoningTokens: 11505,
  ...overrides
})
const synthetic = {
  schemaVersion: 1,
  revision: 4,
  slices: [
    { id: 'registry-qa', title: 'Registry recovered QA', startDate: '2026-09-11' },
    { id: 'undated', title: 'Unknown date QA' }
  ],
  runs: [
    run('luna', 'GPT-5.6 Luna'),
    run('astra', 'GPT-6 Astra'),
    run('later-alias', 'Recovered QA Luna'),
    run('unknown', 'Unknown model'),
    run('undated', 'GPT-5.6 Luna', { sliceId: 'undated' }),
    run('frozen', 'GPT-5.6 Luna', {
      inputRate: 2,
      cachedRate: 0.5,
      outputRate: 10,
      priceSnapshot: {
        model: 'GPT-5.6 Luna',
        provider: 'OpenAI',
        source: 'Override',
        inputRate: 2,
        cachedRate: 0.5,
        outputRate: 10
      }
    })
  ],
  findings: [],
  discoveries: [],
  pricing: [
    {
      id: 'legacy-evidence',
      model: 'Old model',
      provider: 'Old provider',
      effectiveDate: '2025-01-01',
      inputRate: 1,
      cachedRate: 0,
      outputRate: 5,
      notes: 'Preserve this legacy record'
    }
  ]
}
const original = sourceBytes ? JSON.parse(sourceBytes) : synthetic
await writeFile(join(directory, 'telemetry.json'), JSON.stringify(original, null, 2))
const env = { ...process.env, PENNYTEL_DATA_DIR: directory }
delete env.ELECTRON_RUN_AS_NODE
let app, page
const errors = []
const costs = (run) =>
  (run.inputTokens * run.priceSnapshot.inputRate +
    run.cachedInputTokens * run.priceSnapshot.cachedRate +
    run.outputTokens * run.priceSnapshot.outputRate) /
  1000000
const load = () => page.evaluate(() => window.pennytel.load())
const button = (name) => page.getByRole('button', { name, exact: true })
async function launch() {
  // Launch away from the repo: compiled app cannot rely on a docs/ runtime path.
  app = await electron.launch({
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      resolve('out/main/index.js')
    ],
    cwd: directory,
    env,
    timeout: 30000
  })
  page = await app.firstWindow()
  // Foreground the real QA window before Playwright waits for actionable controls.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    // Keep animation-frame actionability checks running when another desktop app gains focus.
    // This is confined to the QA window; production preferences and security stay unchanged.
    window.webContents.setBackgroundThrottling(false)
    window.show()
    window.focus()
  })
  await page.bringToFront()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.getByRole('heading', { name: 'Slice notebook', exact: true }).waitFor()
}
try {
  await launch()
  const security = await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    return {
      sandbox: p.sandbox,
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration
    }
  })
  assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false })
  const initial = (await load()).data
  assert.equal(initial.registry.kind, seed.kind)
  for (const table of ['slices', 'findings', 'discoveries', 'pricing'])
    assert.deepEqual(initial[table], original[table])
  assert.equal(initial.runs.length, original.runs.length)
  for (const prior of original.runs) {
    const current = initial.runs.find((r) => r.id === prior.id)
    for (const [key, value] of Object.entries(prior))
      assert.deepEqual(current[key], value, `Preserve ${prior.id}.${key}`)
    if (prior.priceSnapshot) assert.deepEqual(current.priceSnapshot, prior.priceSnapshot)
  }
  const resolved = initial.runs.filter(
    (r) => r.priceSnapshot && !original.runs.find((old) => old.id === r.id).priceSnapshot
  )
  assert.ok(resolved.some((r) => r.model === 'GPT-5.6 Luna'))
  assert.ok(resolved.some((r) => r.model === 'GPT-6 Astra'))
  for (const r of resolved) {
    assert.equal(r.startAt, undefined)
    assert.equal(r.priceSnapshot.referenceDateSource, 'slice.startDate')
    assert.equal(r.priceSnapshot.inputRate, r.model === 'GPT-6 Astra' ? 10 : 0.2)
  }
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, 'telemetry.legacy-archive.json'), 'utf8')),
    original
  )
  if (!sourceProfile) {
    assert.ok(Math.abs(costs(initial.runs.find((r) => r.id === 'luna')) - 0.1685406) < 1e-10)
    assert.ok(Math.abs(costs(initial.runs.find((r) => r.id === 'astra')) - 7.73657) < 1e-10)
    for (const id of ['later-alias', 'unknown', 'undated'])
      assert.equal(initial.runs.find((r) => r.id === id).priceSnapshot, undefined)
  }
  console.log(
    `PASS: ${sourceProfile ? 'existing profile copy' : 'synthetic existing profile'} opened; all original fields retained; ${resolved.length} unpriced Luna/Astra runs resolved from slice dates; frozen snapshots unchanged`
  )

  await page.getByRole('navigation').getByRole('button', { name: 'Model Registry' }).click()
  await page.getByRole('heading', { name: 'GPT-5.6 Luna', exact: true }).waitFor()
  await page.getByRole('heading', { name: 'GPT-6 Astra', exact: true }).waitFor()
  const lunaPanel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'GPT-5.6 Luna', exact: true }) })
  await lunaPanel.getByText('Benchmarks (7)', { exact: true }).click()
  await lunaPanel.getByText('62.7 percent', { exact: true }).waitFor()
  await lunaPanel.getByText(/Reasoning levels: none, low, medium, high, xhigh, max/).waitFor()
  assert.match(await lunaPanel.innerText(), /Input \$0.20.*cached \$0.02.*output \$1.20/)
  await captureElectron(app, page, {
    path: join(directory, 'registry-metadata.png'),
    fullPage: true
  })
  await page.getByText('Import / update registry', { exact: true }).click()
  const invalid = structuredClone(seed)
  invalid.models[0].makerId = 'missing-maker'
  const invalidPath = join(directory, 'invalid-registry.json')
  await writeFile(invalidPath, JSON.stringify(invalid))
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, invalidPath)
  await button('Choose registry JSON').click()
  const liveBefore = await canonicalSnapshot(directory)
  const backupBefore = await readFile(join(directory, 'telemetry.legacy-archive.json'), 'utf8')
  await button('Validate registry & preview').click()
  await page
    .getByRole('alert')
    .filter({ hasText: /unknown maker reference/ })
    .waitFor()
  assert.equal(await button('Install registry update').count(), 0)
  // The main process rejects the same invalid document even without the UI preview.
  const invalidResult = await page.evaluate(
    async ({ text, revision }) => {
      try {
        await window.pennytel.mutate({ kind: 'registry-import', text, revision })
        return 'unexpected success'
      } catch (e) {
        return e.message
      }
    },
    { text: JSON.stringify(invalid), revision: initial.revision }
  )
  assert.match(invalidResult, /unknown maker reference/)
  assert.equal(await canonicalSnapshot(directory), liveBefore)
  assert.equal(
    await readFile(join(directory, 'telemetry.legacy-archive.json'), 'utf8'),
    backupBefore
  )
  await captureElectron(app, page, { path: join(directory, 'invalid-registry.png') })
  console.log(
    'PASS: file selection, useful UI rejection and independent main-process validation; invalid update leaves live/backup bytes unchanged'
  )

  const updated = structuredClone(initial.registry)
  updated.registryRevision++
  updated.description = 'Local QA registry update'
  updated.models.find((m) => m.id === 'openai:gpt-5.6-luna').aliases.push('Recovered QA Luna')
  updated.models.find((m) => m.id === 'openai:gpt-5.6-luna').canonicalName =
    'GPT-5.6 Luna (QA metadata edit)'
  updated.models
    .find((m) => m.id === 'openai:gpt-5.6-luna')
    .offers[0].pricingHistory.at(-1).inputUsd = 0.3
  await page.getByLabel('Registry JSON', { exact: true }).fill(JSON.stringify(updated))
  await button('Validate registry & preview').click()
  await button('Install registry update').click()
  await page
    .getByRole('status')
    .filter({ hasText: /Registry saved/ })
    .waitFor()
  const after = (await load()).data
  assert.equal(after.registry.registryRevision, updated.registryRevision)
  for (const r of initial.runs.filter((r) => r.priceSnapshot))
    assert.deepEqual(after.runs.find((n) => n.id === r.id).priceSnapshot, r.priceSnapshot)
  if (!sourceProfile)
    assert.equal(after.runs.find((r) => r.id === 'later-alias').priceSnapshot.inputRate, 0.3)
  console.log(
    'PASS: supported registry update persists metadata and rates, backfills newly eligible alias, and retains existing snapshots'
  )

  const exportPath = join(directory, 'registry-dataset-export.json')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, exportPath)
  await page.evaluate(() => window.pennytel.exportData())
  assert.deepEqual(JSON.parse(await readFile(exportPath, 'utf8')), after)
  const preview = await page.evaluate(
    (text) => window.pennytel.previewImport(text),
    JSON.stringify(after)
  )
  assert.equal(
    Object.values(preview.counts).reduce((a, b) => a + b, 0),
    0
  )
  await app.close()
  await launch()
  assert.deepEqual((await load()).data, after)
  await page.getByRole('navigation').getByRole('button', { name: 'Model Registry' }).click()
  await page
    .getByRole('heading', { name: 'GPT-5.6 Luna (QA metadata edit)', exact: true })
    .waitFor()
  await page.setViewportSize({ width: 900, height: 700 })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false
  )
  await captureElectron(app, page, { path: join(directory, 'registry-restarted-900.png') })
  assert.deepEqual(errors, [])
  if (sourceProfile) assert.equal(await readFile(sourceProfile, 'utf8'), sourceBytes)
  const report = {
    source: sourceProfile
      ? 'read-only copy of existing operator profile'
      : 'synthetic existing profile',
    originalRunCount: original.runs.length,
    newlyPriced: resolved.map((r) => ({
      id: r.id,
      cost: costs(r),
      reference: r.priceSnapshot.referenceDate
    })),
    priorSnapshotsPreserved: original.runs.filter((r) => r.priceSnapshot).length,
    registryRevision: after.registry.registryRevision,
    security,
    rendererErrors: errors,
    checks: [
      'startup migration',
      'metadata visibility',
      'slice-date pricing',
      'invalid import atomicity',
      'update backfill',
      'snapshot immutability',
      'raw export/import',
      'restart',
      '900px layout',
      'source profile unchanged'
    ]
  }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    `PASS: export/import regression, restart, 900px layout, sandbox preferences and no renderer errors. Artifacts: ${directory}`
  )
} catch (error) {
  if (page) {
    await captureElectron(app, page, { path: join(directory, 'runtime-failure.png') }).catch(
      () => {}
    )
    const state = await page
      .evaluate(() => ({
        text: document.body.innerText,
        details: [...document.querySelectorAll('details')].map((d) => ({
          summary: d.querySelector('summary')?.textContent,
          open: d.open
        })),
        buttons: [...document.querySelectorAll('button')]
          .filter((b) => b.textContent.includes('Validate registry'))
          .map((b) => ({ disabled: b.disabled, rect: b.getBoundingClientRect().toJSON() }))
      }))
      .catch(() => ({}))
    await writeFile(
      join(directory, 'runtime-failure.json'),
      JSON.stringify({ error: String(error), state }, null, 2)
    )
    console.log(`Failure evidence: ${directory}`)
  }
  throw error
} finally {
  if (app) await app.close().catch(() => {})
}
