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
// Mixed observed evidence; role and exact invocation text intentionally differ.
Object.assign(data.runs[0], {
  wallMinutes: 30,
  usageBefore: 90,
  usageAfter: 87,
  filesChanged: 0,
  testsPassed: 8,
  testsFailed: 0,
  buildResult: 'Passed',
  runtimeTested: false,
  result: 'Completed'
})
delete data.runs[1].inputTokens
Object.assign(data.runs[1], { usageBefore: 5, usageAfter: 80, usageReset: true })
Object.assign(data.runs[2], { wallMinutes: 0, usageBurn: 0 })
for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens'])
  delete data.runs[3][key]
data.runs[3].runType = 'Unclassified invocation'
Object.assign(data.runs[4], { role: 'Critic', runType: 'Re-critic' })
Object.assign(data.runs[5], { role: 'Repair', runType: 'Verification' })
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
  assert.deepEqual(initial.data, { ...data, schemaVersion: 2 })
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
  await page.getByRole('button', { name: /GPT-6 Astra\s*2\/4 priced/ }).waitFor()
  await page.getByLabel('Group runs by', { exact: true }).selectOption('modelFamily')
  await page.getByRole('button', { name: /Astra\s*2\/4 priced/ }).waitFor()
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
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  const candidate = (label) => page.getByRole('checkbox', { name: label, exact: true })
  const table = page.getByRole('region', { name: 'Selected candidate comparison' })
  const selectedKeys = []
  for (const label of ['GPT-6 Astra — Low', 'GPT-5.6 Luna — Max']) {
    await candidate(label).check()
    selectedKeys.push(await candidate(label).inputValue())
  }
  assert.equal(await table.getByRole('columnheader').count(), 3)
  assert.match(
    await table.getByRole('row', { name: /^API-equivalent cost/ }).innerText(),
    /1\/2 recorded.*incomplete/s
  )
  assert.match(
    await table.getByRole('row', { name: /^Wall time/ }).innerText(),
    /30m.*1\/2 recorded/s
  )
  await captureElectron(app, page, { path: join(directory, 'workspace-two.png'), fullPage: true })
  for (const label of [
    'GPT-6 Astra — ExtraHigh / XHigh',
    'GPT-5.6 Sol — High',
    'GPT-6 Astra — Unknown',
    'Same — Low [1]',
    'Same — Low [2]'
  ]) {
    await candidate(label).check()
    selectedKeys.push(await candidate(label).inputValue())
  }
  assert.equal(new Set(selectedKeys).size, 7)
  assert.equal(await table.getByRole('columnheader').count(), 8)
  await candidate('Implementation (role: Implementer)').check()
  assert.match(
    await table.getByRole('columnheader', { name: /GPT-5.6 Luna/ }).innerText(),
    /0 runs \/ no evidence/
  )
  await candidate('Critic (role: Critic)').check()
  assert.match(
    await table.getByRole('columnheader', { name: /GPT-5.6 Luna/ }).innerText(),
    /1 runs/
  )
  await page.getByRole('button', { name: 'Clear stage scope', exact: true }).click()
  await candidate('Recorded run type: Verification').check()
  assert.match(await table.getByRole('columnheader', { name: /GPT-5.6 Sol/ }).innerText(), /1 runs/)
  assert.match(
    await table.getByRole('columnheader', { name: /GPT-5.6 Luna/ }).innerText(),
    /0 runs \/ no evidence/
  )
  await candidate('Recorded run type: Re-critic').check()
  assert.match(
    await table.getByRole('columnheader', { name: /GPT-5.6 Luna/ }).innerText(),
    /1 runs/
  )
  await filter.selectOption({ label: 'GPT-6 Astra — Low' })
  assert.equal(await page.locator('.bar-row').count(), 0)
  assert.equal(await table.getByRole('columnheader', { name: /0 runs \/ no evidence/ }).count(), 7)
  await filter.selectOption('')
  await page.getByRole('button', { name: 'Clear stage scope', exact: true }).click()
  await candidate('Recorded run type: Unclassified invocation').check()
  assert.match(
    await table.getByRole('columnheader', { name: /GPT-6 Astra — Unknown/ }).innerText(),
    /1 runs/
  )
  assert.match(
    await table.getByRole('row', { name: /^API-equivalent cost/ }).innerText(),
    /Unknown.*0\/1 recorded/s
  )
  await page.getByRole('button', { name: 'Clear stage scope', exact: true }).click()
  const workspaceAllPath = join(directory, 'workspace-all.json')
  async function exportWorkspace(path) {
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, path)
    await page.getByRole('button', { name: 'Export comparison', exact: true }).click()
    await page.getByRole('status').filter({ hasText: path }).waitFor()
    return JSON.parse(await readFile(path, 'utf8'))
  }
  const all = await exportWorkspace(workspaceAllPath)
  assert.deepEqual(all.context.selectedCandidates, selectedKeys)
  assert.deepEqual(
    all.candidates.map((c) => c.runIds),
    [
      ['low', 'alias-low'],
      ['luna'],
      ['xhigh'],
      ['sol'],
      ['unknown'],
      ['collision-a'],
      ['collision-b']
    ]
  )
  assert.equal(all.candidates[0].metrics.costUSD.knownTotal, 0.42)
  assert.equal(all.candidates[0].metrics.meanPricedRunCostUSD, 0.42)
  assert.equal(all.candidates[0].metrics.costUSD.completeTotal, null)
  assert.equal(all.candidates[0].metrics.evidence.numeric.reasoningTokens.knownTotal, 20000)
  assert.equal(all.candidates[0].metrics.evidence.numeric.filesChanged.knownTotal, 0)
  assert.equal(all.candidates[0].metrics.usageBurnPercentagePoints.recorded, 1)
  assert.equal(all.candidates[4].metrics.costUSD.knownTotal, null)
  assert.equal(all.app.version, '0.2.2')
  await candidate('Implementation (role: Implementer)').check()
  await candidate('Recorded run type: Verification').check()
  const workspacePath = join(directory, 'workspace-scoped.json')
  const scoped = await exportWorkspace(workspacePath)
  assert.deepEqual(scoped.context.stageScopes, [
    { kind: 'role', value: 'Implementer' },
    { kind: 'runType', value: 'Verification' }
  ])
  assert.deepEqual(scoped.context.selectedCandidates, selectedKeys)
  assert.deepEqual(
    scoped.candidates.map((c) => c.runIds),
    [['low', 'alias-low'], [], ['xhigh'], ['sol'], ['unknown'], ['collision-a'], ['collision-b']]
  )
  assert.deepEqual(scoped.acceptedSlices, all.acceptedSlices)
  assert.equal(scoped.candidates[1].metrics.costUSD.knownTotal, null)
  const invalid = await page.evaluate(
    async (request) => {
      const messages = []
      for (const candidate of [
        { ...request, revision: request.revision + 1 },
        { ...request, context: { ...request.context, selectedCandidates: ['display label'] } },
        {
          ...request,
          context: { ...request.context, stageScopes: [{ kind: 'role', value: 'Verification' }] }
        }
      ]) {
        try {
          await window.pennytel.exportComparison(candidate)
          messages.push('unexpected success')
        } catch (error) {
          messages.push(error.message)
        }
      }
      return messages
    },
    { revision: data.revision, context: scoped.context }
  )
  assert.match(invalid[0], /changed/)
  assert.match(invalid[1], /candidate selection/)
  assert.match(invalid[2], /stage scope/)
  assert.match(
    await page.evaluate(async (text) => {
      try {
        await window.pennytel.previewImport(text)
        return 'unexpected success'
      } catch (error) {
        return error.message
      }
    }, JSON.stringify(scoped)),
    /not importable telemetry/
  )
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  await page.getByText(`PennyTel v${version}`, { exact: false }).waitFor({ state: 'visible' })
  const versionBox = await page.locator('.sidebar .version').boundingBox()
  assert.ok(versionBox && versionBox.y >= 0 && versionBox.y + versionBox.height <= 700)
  await table.scrollIntoViewIfNeeded()
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true
  )
  const layout = await table.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
    element.scrollTop = element.scrollHeight
    const bounds = element.getBoundingClientRect()
    const heading = element.querySelector('thead').getBoundingClientRect()
    const pinned = element.querySelector('thead th').getBoundingClientRect()
    return {
      width: element.clientWidth,
      scroll: element.scrollLeft,
      pinned: pinned.top >= bounds.top && pinned.bottom <= bounds.bottom,
      verticallyScrolled: heading.top < bounds.top
    }
  })
  assert.ok(layout.width > 400 && layout.scroll > 0)
  assert.equal(layout.pinned, true)
  assert.equal(layout.verticallyScrolled, true)
  assert.equal(await candidate('Same — Low [2]').isChecked(), true)
  await captureElectron(app, page, {
    path: join(directory, 'workspace-seven-narrow.png'),
    fullPage: true
  })
  await table.evaluate((element) => {
    element.scrollLeft = 0
    element.scrollTop = 0
  })
  await captureElectron(app, page, { path: join(directory, 'workspace-narrow-visible.png') })
  await page.getByRole('button', { name: 'Clear candidates', exact: true }).click()
  for (const label of ['GPT-6 Astra — Low', 'GPT-5.6 Luna — Max']) await candidate(label).check()
  await table.scrollIntoViewIfNeeded()
  assert.equal(await table.getByRole('columnheader').count(), 3)
  assert.equal(await table.evaluate((element) => element.scrollWidth <= element.clientWidth), true)
  await captureElectron(app, page, { path: join(directory, 'workspace-two-narrow.png') })
  const rawPath = join(directory, 'raw.json')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, rawPath)
  await page.evaluate(() => window.pennytel.exportData())
  assert.deepEqual(JSON.parse(await readFile(rawPath, 'utf8')), { ...data, schemaVersion: 2 })
  assert.equal(await readFile(join(directory, 'telemetry.json'), 'utf8'), originalBytes)
  await app.close()
  await launch()
  assert.deepEqual((await page.evaluate(() => window.pennytel.load())).data, {
    ...data,
    schemaVersion: 2
  })
  assert.equal(await readFile(join(directory, 'telemetry.json'), 'utf8'), originalBytes)
  await page.getByRole('navigation').getByRole('button', { name: 'Compare', exact: true }).click()
  assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    `PASS: configuration groups, 2/7 candidate workspace, collision keys, role/exact stages, unknown/partial evidence, authoritative scoped export, raw bytes, restart, 900px layout and visible v${version}${executablePath ? ' packaged app' : ''}. Evidence: ${directory}`
  )
} finally {
  if (app) await app.close()
}
