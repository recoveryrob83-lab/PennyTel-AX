// Synthetic configuration evidence only; never opens the operator's profile.
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { captureElectron } from './electron-qa-capture.mjs'

await mkdir(resolve('test-results'), { recursive: true })
const directory = await mkdtemp(resolve('test-results/configuration-runtime-'))
const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const registry = JSON.parse(
  await readFile(
    resolve('docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json'),
    'utf8'
  )
)
const astra = registry.models.find((model) => model.canonicalName === 'GPT-6 Astra')
const run = (id, model, thinking, modelFamily) => ({
  id,
  model,
  ...(thinking ? { thinking } : {}),
  modelFamily,
  sliceId: 'configuration-qa',
  runType: 'Synthetic configuration QA',
  role: 'Implementer',
  provider: 'OpenAI',
  inputTokens: 100000,
  cachedInputTokens: 40000,
  outputTokens: 20000,
  reasoningTokens: 10000,
  priceSnapshot: {
    model,
    provider: 'OpenAI',
    source: 'Override',
    inputRate: 2,
    cachedRate: 0.5,
    outputRate: 10
  }
})
const data = {
  schemaVersion: 1,
  revision: 8,
  registry,
  slices: [
    { id: 'configuration-qa', title: 'Configuration QA accepted slice', disposition: 'Accepted' }
  ],
  runs: [
    run('low', astra.canonicalName, 'Low', 'Astra'),
    run('alias-low', astra.apiModelId.toUpperCase(), 'Low', 'Astra'),
    run('xhigh', astra.canonicalName, 'ExtraHigh', 'Astra'),
    run('unknown', astra.canonicalName, undefined, 'Astra'),
    run('luna', 'GPT-5.6 Luna', 'Max', 'Luna'),
    run('sol', 'GPT-5.6 Sol', 'High', 'Sol'),
    { ...run('collision-a', 'Same', 'Low', 'Same'), modelId: 'missing-a' },
    { ...run('collision-b', 'Same', 'Low', 'Same'), modelId: 'missing-b' }
  ],
  findings: [],
  discoveries: [],
  pricing: []
}
const originalBytes = JSON.stringify(data, null, 2)
await writeFile(join(directory, 'telemetry.json'), originalBytes)
const env = { ...process.env, PENNYTEL_DATA_DIR: directory }
delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.PENNYTEL_QA_EXECUTABLE_PATH
if (executablePath?.endsWith('.AppImage')) env.APPIMAGE_EXTRACT_AND_RUN = '1'
let app, page
const errors = []
async function launch() {
  app = await electron.launch({
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(executablePath ? [] : [resolve('out/main/index.js')])
    ],
    env,
    cwd: directory,
    timeout: 30000
  })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.webContents.setBackgroundThrottling(false)
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  await page.bringToFront()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Slice notebook', exact: true }).waitFor()
  await page.getByText(`PennyTel v${version}`, { exact: false }).waitFor({ state: 'visible' })
  if (executablePath) assert.equal(await app.evaluate(({ app }) => app.getVersion()), version)
}
try {
  await launch()
  const initial = await page.evaluate(() => window.pennytel.load())
  assert.deepEqual(initial.data, data)
  await page.getByRole('navigation').getByRole('button', { name: 'Compare', exact: true }).click()
  assert.equal(
    await page.getByLabel('Group runs by', { exact: true }).inputValue(),
    'modelConfiguration'
  )
  for (const label of [
    'GPT-6 Astra — Low',
    'GPT-6 Astra — ExtraHigh / XHigh',
    'GPT-6 Astra — Unknown',
    'GPT-5.6 Luna — Max',
    'GPT-5.6 Sol — High'
  ])
    await page
      .locator('.comparison-bars')
      .getByRole('button', { name: new RegExp(label), pressed: false })
      .waitFor({ state: 'visible' })
  assert.equal(await page.locator('.bar-row').count(), 7)
  await captureElectron(app, page, { path: join(directory, 'configurations.png'), fullPage: true })
  await page.getByLabel('Group runs by', { exact: true }).selectOption('canonicalModel')
  await page.getByRole('button', { name: /GPT-6 Astra\s*4\/4 priced/ }).waitFor()
  await page.getByLabel('Group runs by', { exact: true }).selectOption('modelFamily')
  await page.getByRole('button', { name: /Astra\s*4\/4 priced/ }).waitFor()
  await page.getByLabel('Group runs by', { exact: true }).selectOption('model')
  assert.equal(await page.locator('.bar-row').count(), 5)
  await page.getByLabel('Group runs by', { exact: true }).selectOption('modelConfiguration')
  await page.getByText('Narrow the cohort', { exact: true }).click()
  const filter = page.getByLabel('Filter Model Configuration', { exact: true })
  for (const ordinal of [1, 2]) {
    const label = `Same — Low [${ordinal}]`
    await page
      .locator('.comparison-bars')
      .getByRole('button', { name: new RegExp(`Same — Low \\[${ordinal}\\]`) })
      .waitFor({ state: 'visible' })
    await filter.selectOption({ label })
    assert.equal(await page.locator('.bar-row').count(), 1)
    await page
      .locator('.comparison-bars')
      .getByRole('button', { name: new RegExp(`Same — Low \\[${ordinal}\\]`) })
      .click()
    const collisionKey = await filter.inputValue()
    const collisionPath = join(directory, `collision-${ordinal}.json`)
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, collisionPath)
    await page.getByRole('button', { name: 'Export comparison', exact: true }).click()
    await page.getByRole('status').filter({ hasText: collisionPath }).waitFor()
    const collision = JSON.parse(await readFile(collisionPath, 'utf8'))
    assert.equal(collision.groups[0].label, label)
    assert.equal(collision.context.selectedGroup, collisionKey)
    assert.deepEqual(collision.cohort.evidenceRunIds, [
      ordinal === 1 ? 'collision-a' : 'collision-b'
    ])
    await filter.selectOption('')
  }
  await filter.selectOption({ label: 'GPT-6 Astra — Unknown' })
  assert.equal(await page.locator('.bar-row').count(), 1)
  await page
    .locator('.comparison-bars')
    .getByRole('button', { name: /GPT-6 Astra — Unknown/ })
    .waitFor()
  await filter.selectOption({ label: 'GPT-6 Astra — ExtraHigh / XHigh' })
  const key = await filter.inputValue()
  await page
    .locator('.comparison-bars')
    .getByRole('button', { name: /GPT-6 Astra — ExtraHigh \/ XHigh/, pressed: false })
    .click()
  const exportPath = join(directory, 'comparison.json')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, exportPath)
  await page.getByRole('button', { name: 'Export comparison', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Comparison exported' }).waitFor()
  const analysis = JSON.parse(await readFile(exportPath, 'utf8'))
  assert.deepEqual(analysis.context, {
    filters: { modelConfiguration: key },
    groupBy: 'modelConfiguration',
    sort: 'label',
    selectedGroup: key
  })
  assert.deepEqual(analysis.cohort.runIds, ['xhigh'])
  assert.equal(analysis.groups[0].label, 'GPT-6 Astra — ExtraHigh / XHigh')
  assert.equal(analysis.app.version, version)
  assert.equal(analysis.groups[0].costUSD.completeTotal, 0.42)
  assert.equal(analysis.acceptedSlices[0].lifecycleRunIds.length, 8)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  await page.getByText(`PennyTel v${version}`, { exact: false }).waitFor({ state: 'visible' })
  const versionBox = await page.locator('.sidebar .version').boundingBox()
  assert.ok(versionBox && versionBox.y >= 0 && versionBox.y + versionBox.height <= 700)
  await captureElectron(app, page, {
    path: join(directory, 'configuration-filter-narrow.png'),
    fullPage: true
  })
  const rawPath = join(directory, 'raw.json')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, rawPath)
  await page.evaluate(() => window.pennytel.exportData())
  assert.deepEqual(JSON.parse(await readFile(rawPath, 'utf8')), data)
  assert.equal(await readFile(join(directory, 'telemetry.json'), 'utf8'), originalBytes)
  await app.close()
  await launch()
  assert.deepEqual((await page.evaluate(() => window.pennytel.load())).data, data)
  assert.equal(await readFile(join(directory, 'telemetry.json'), 'utf8'), originalBytes)
  assert.deepEqual(errors, [])
  console.log(
    `PASS: configuration groups, aliases, rollups, Unknown filter, export, frozen cost/source bytes, restart and visible v${version}${executablePath ? ' packaged app' : ''}. Evidence: ${directory}`
  )
} finally {
  if (app) await app.close()
}
