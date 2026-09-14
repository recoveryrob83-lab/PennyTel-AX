// All generated telemetry is synthetic QA data in an isolated directory.
import { _electron as electron } from 'playwright'
import { captureElectron } from './electron-qa-capture.mjs'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const results = resolve('test-results')
const { version: appVersion } = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
await mkdir(results, { recursive: true })
const directory = await mkdtemp(join(results, 'electron-qa-'))
const env = { ...process.env, PENNYTEL_DATA_DIR: directory }
delete env.ELECTRON_RUN_AS_NODE
let app
let page
const failures = []
async function launch() {
  app = await electron.launch({
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      resolve('out/main/index.js')
    ],
    env,
    timeout: 30_000
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
  page.on('pageerror', (error) => failures.push(error.message))
  await page.getByRole('heading', { name: 'Slice notebook', exact: true }).waitFor()
}
const button = (name) => page.getByRole('button', { name, exact: true })
const field = (name) => page.getByLabel(name, { exact: false })
async function save(name) {
  await button(`Save ${name}`).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
}
async function addRun({
  id,
  type,
  role,
  model = 'QA Model',
  tokens = true,
  realTokens = false,
  overrides = false,
  usage = false
}) {
  await button('+ Add run').click()
  await field('Record ID').fill(id)
  await field('Run type').fill(type)
  await field('Factory role').selectOption(role)
  await field('Exact model').fill(model)
  await field('Provider').fill('QA Provider')
  await field('Thinking level').selectOption('High')
  await field('Candidate / implementation').fill('Candidate A')
  await field('Start timestamp').fill('2026-09-11T10:00:00-05:00')
  await field('End timestamp').fill('2026-09-11T10:30:00-05:00')
  if (tokens) {
    await field('Input tokens (fresh / noncached)').fill(realTokens ? '138187' : '100000')
    await field('Cached input tokens').fill(realTokens ? '2902400' : '40000')
    await field('Output tokens (including reasoning)').fill(realTokens ? '69046' : '20000')
    await field('Reasoning tokens').fill(realTokens ? '11505' : '10000')
  }
  if (overrides) {
    await field('Override input $ / million').fill('2')
    await field('Override cached $ / million').fill('0.5')
    await field('Override output $ / million').fill('10')
  }
  if (usage) {
    await field('Usage before (% remaining)').fill('94')
    await field('Usage after (% remaining)').fill('92')
    await field('Meter reset / replenished').selectOption('false')
  }
  await save('run')
}
try {
  await launch()
  await page.getByText('Start with a piece of work', { exact: true }).waitFor()
  await captureElectron(app, page, { path: join(directory, '01-empty.png') })

  await button('＄Pricing history')
    .count()
    .then(async (count) => {
      if (count) await button('＄Pricing history').click()
      else
        await page.getByRole('navigation').getByRole('button', { name: 'Pricing history' }).click()
    })
  await button('+ Add price').click()
  await field('Record ID').fill('qa-price')
  await field('Exact model').fill('QA Model')
  await field('Provider').fill('QA Provider')
  await field('Effective date').fill('2026-01-01')
  await page.getByLabel(/^Input \$ \/ million/).fill('2')
  await field('Cached input $ / million').fill('0.5')
  await field('Output $ / million').fill('10')
  await field('Pricing source').fill('Synthetic QA source, not a published rate')
  await save('price')
  console.log('PASS: pricing catalog creation')

  await page.getByRole('navigation').getByRole('button', { name: 'Slice notebook' }).click()
  await button('+ New slice').click()
  await field('Record ID').fill('qa-slice')
  await field('Title').fill('Synthetic QA · accepted work')
  await field('Project').fill('QA only')
  await field('Task shape').fill('Feature implementation')
  await field('Factory production model').selectOption('Full Pipeline')
  await field('Ambiguity').selectOption('High')
  await field('Risk').selectOption('Medium')
  await save('slice')
  await addRun({
    id: 'qa-implementation',
    type: 'Implementation',
    role: 'Implementer',
    realTokens: true,
    usage: true
  })
  await addRun({
    id: 'qa-critic',
    type: 'Criticism',
    role: 'Critic',
    model: 'QA Support Model',
    overrides: true
  })
  await addRun({
    id: 'qa-repair',
    type: 'Repair',
    role: 'Repair',
    model: 'QA Support Model',
    overrides: true
  })
  await button('Implementation').click()
  await page.getByRole('dialog').getByText('$2.418', { exact: true }).waitFor()
  await page.getByRole('dialog').getByText('95.5%', { exact: true }).waitFor()
  await page.getByRole('dialog').getByText('2 pp', { exact: true }).waitFor()
  const displayedStart = await page
    .getByRole('dialog')
    .locator('time[datetime="2026-09-11T10:00:00-05:00"]')
    .innerText()
  assert.match(displayedStart, /Sep 11, 2026/)
  assert.ok(!displayedStart.includes('T10:00:00'))
  await button('Edit run').click()
  await field('Reasoning tokens').fill('69047')
  await button('Save run').click()
  await page
    .getByRole('alert')
    .filter({ hasText: /reasoning tokens exceed/ })
    .waitFor()
  await field('Reasoning tokens').fill('11505')
  await field('Meter reset / replenished').selectOption('true')
  await save('run')
  await button('Implementation').click()
  assert.match(
    await page.getByRole('dialog').locator('.metric').filter({ hasText: 'Meter burn' }).innerText(),
    /Unknown/
  )
  await button('Edit run').click()
  await field('Usage meter burn (percentage points)').fill('2')
  await save('run')
  await button('Implementation').click()
  await page.getByRole('dialog').getByText('2 pp', { exact: true }).waitFor()
  await button('Close dialog').click()
  console.log(
    'PASS: actual-shaped Codex input, corrected cost/cache, reasoning validation, remaining meter and explicit reset override, readable run timestamps'
  )

  await page.getByRole('tab', { name: 'Findings' }).click()
  await button('+ Add finding').click()
  await field('Record ID').fill('qa-finding')
  await field('Discovered in run').selectOption('qa-critic')
  await field('Severity').selectOption('P1')
  await field('Category').selectOption('Product')
  await field('Finding title').fill('Synthetic QA defect: retained state')
  await field('Description').fill('Changed value was not retained')
  await field('User visible').selectOption('true')
  await field('Repair required').selectOption('true')
  await field('Repair run').selectOption('qa-repair')
  await field('Final status').selectOption('Repaired')
  await page
    .getByLabel('Evidence', { exact: true })
    .fill('Synthetic QA evidence; not actual production telemetry.')
  await page.getByText('Review judgment', { exact: true }).click()
  await field('Contract / invariant').fill('Edits must survive restart')
  await page.getByLabel('Impact', { exact: true }).fill('Lost operator edits')
  await field('Confidence').fill('High: independently reproduced')
  await page
    .getByRole('dialog')
    .locator('summary')
    .filter({ hasText: /^Notes$/ })
    .click()
  await page.getByLabel('Notes', { exact: true }).fill('Separate reviewer notes')
  await save('finding')
  await page.getByRole('heading', { name: /Synthetic QA defect/ }).waitFor()

  await page.getByRole('tab', { name: 'Discoveries' }).click()
  await button('+ Add discovery').click()
  await field('Record ID').fill('qa-discovery')
  await field('Discovery run').selectOption('qa-implementation')
  await page
    .getByLabel('Description', { exact: false })
    .fill('Synthetic QA discovery: additional acceptance edge case')
  await field('Already in prompt / contract').selectOption('false')
  await field('Self-initiated').selectOption('true')
  await field('Independent validation').selectOption('Yes')
  await field('Validated by').fill('Independent QA reviewer')
  await field('Impact level').selectOption('High')
  await field('Downstream value').selectOption('Prevented Defect')
  await field('Adopted').selectOption('Deferred')
  await save('discovery')
  await page.getByText('Validated autonomous', { exact: true }).waitFor()
  console.log('PASS: linked findings, repair links, and independently validated discoveries')

  await button('Edit slice').click()
  await page.getByRole('dialog').getByLabel('Disposition', { exact: true }).selectOption('Accepted')
  await button('Use exact timestamp (ISO with timezone)').click()
  await field('Accepted at').fill('2026-09-11T11:00:00-05:00')
  assert.deepEqual(await field('Product quality grade').locator('option').allTextContents(), [
    'Unknown / not recorded',
    '1',
    '2',
    '3',
    '4',
    '5'
  ])
  await field('Product quality grade').selectOption('5')
  await field('Preferred candidate / model').fill('Candidate A')
  await save('slice')
  await page.getByText('5 / 5', { exact: true }).waitFor()
  const acceptedDisplay = await page
    .locator('time[datetime="2026-09-11T11:00:00-05:00"]')
    .innerText()
  assert.match(acceptedDisplay, /Sep 11, 2026/)
  assert.ok(!acceptedDisplay.includes('T11:00:00'))
  await page.getByRole('tab', { name: 'Runs' }).click()
  await captureElectron(app, page, { path: join(directory, '02-slice.png') })

  await button('Criticism').click()
  await button('Delete run').click()
  await button('Delete record').click()
  await page
    .getByRole('alert')
    .filter({ hasText: /referenced by a finding/ })
    .waitFor()
  await button('Cancel').click()
  console.log('PASS: referenced run deletion blocked without data loss')

  await page.getByRole('navigation').getByRole('button', { name: 'Slice notebook' }).click()
  await button('+ New slice').click()
  await field('Record ID').fill('qa-other-slice')
  await field('Title').fill('Synthetic QA · other model only')
  await page.getByRole('dialog').getByLabel('Disposition', { exact: true }).selectOption('Accepted')
  await button('Use exact timestamp (ISO with timezone)').click()
  await field('Accepted at').fill('2026-09-11T11:00:00-05:00')
  await field('Product quality grade').selectOption('3')
  await save('slice')
  await addRun({
    id: 'qa-other-run',
    type: 'Other implementation',
    role: 'Implementer',
    model: 'QA Unpriced Model',
    tokens: false
  })

  await page.getByRole('navigation').getByRole('button', { name: 'Pricing history' }).click()
  await button('Edit price').click()
  await page.getByLabel(/^Input \$ \/ million/).fill('999')
  await save('price')
  await page.getByRole('navigation').getByRole('button', { name: 'Compare', exact: true }).click()
  await page.getByRole('heading', { name: 'Compare the work' }).waitFor()
  await page.getByText('$3.258', { exact: true }).first().waitFor()
  const acceptedSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Accepted slice economics', exact: true }) })
  await acceptedSection
    .getByRole('button', { name: 'Synthetic QA · other model only', exact: true })
    .waitFor()
  await captureElectron(app, page, { path: join(directory, '03-compare.png'), fullPage: true })
  await field('Group runs by').selectOption('role')
  await page.getByRole('heading', { name: 'Run economics by factory role' }).waitFor()
  await page.getByText('Narrow the cohort', { exact: true }).click()
  await field('Filter Thinking level').selectOption('High')
  await field('Filter Factory role').selectOption('Implementer')
  await field('Filter Exact model').selectOption('QA Model')
  await field('Order groups').selectOption('cost')
  await page.getByRole('heading', { name: 'Accepted slice economics' }).waitFor()
  await page
    .getByRole('cell')
    .filter({ hasText: /^\$3\.258/ })
    .waitFor()
  assert.equal(
    await acceptedSection
      .getByRole('button', { name: 'Synthetic QA · other model only', exact: true })
      .count(),
    0
  )
  await acceptedSection
    .getByRole('button', { name: 'Synthetic QA · accepted work', exact: true })
    .waitFor()
  await acceptedSection.getByText(/Inspect lifecycle · Synthetic QA · accepted work ·/).click()
  const lifecycleStages = acceptedSection.getByRole('table', {
    name: 'Lifecycle stages · Synthetic QA · accepted work',
    exact: true
  })
  for (const stage of ['Criticism', 'Repair'])
    assert.match(
      await lifecycleStages.getByRole('row', { name: new RegExp(`^${stage}`) }).innerText(),
      /\$0\.42/
    )
  await captureElectron(app, page, {
    path: join(directory, '03-filtered-cohort.png'),
    fullPage: true
  })
  console.log(
    'PASS: frozen historical cost; multi-slice cohort excludes unmatched model but retains other-model critic and repair cost'
  )

  const analysisPath = join(directory, 'qa-comparison.json')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, analysisPath)
  await button('Export comparison').click()
  await page
    .getByRole('status')
    .filter({ hasText: /Comparison exported/ })
    .waitFor()
  const analysis = JSON.parse(await readFile(analysisPath, 'utf8'))
  assert.equal(analysis.kind, 'pennytel-comparison')
  assert.equal(analysis.analysisFormatVersion, 1)
  assert.equal(analysis.app.version, appVersion)
  assert.ok(Number.isFinite(Date.parse(analysis.generatedAt)))
  assert.deepEqual(analysis.context.filters, {
    thinking: 'High',
    role: 'Implementer',
    model: 'QA Model'
  })
  assert.equal(analysis.context.groupBy, 'role')
  assert.equal(analysis.context.sort, 'cost')
  assert.deepEqual(analysis.cohort.sliceIds, ['qa-slice'])
  assert.deepEqual(analysis.cohort.runIds, ['qa-implementation'])
  assert.equal(analysis.summary.costUSD.completeTotal, 2.418034)
  assert.ok(Math.abs(analysis.acceptedSlices[0].costUSD.completeTotal - 3.258034) < 1e-10)
  assert.equal(analysis.acceptedSlices[0].roles.Critic.completeTotal, 0.42)
  assert.equal(analysis.acceptedSlices[0].roles.Repair.completeTotal, 0.42)
  assert.equal(analysis.acceptedSlices[0].qualityGrade, 5)
  assert.equal(analysis.acceptedSlices[0].defects.bySeverityAndCategory.P1.Product, 1)
  assert.equal(analysis.acceptedSlices[0].validatedAutonomousDiscoveries, 1)
  assert.equal(analysis.summary.usageBurnPercentagePoints.completeTotal, 2)
  await button('Clear filters').click()
  const allAnalysisPath = join(directory, 'qa-comparison-all.json')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, allAnalysisPath)
  await button('Export comparison').click()
  await page.getByRole('status').filter({ hasText: allAnalysisPath }).waitFor()
  const allAnalysis = JSON.parse(await readFile(allAnalysisPath, 'utf8'))
  assert.equal(allAnalysis.summary.costUSD.completeTotal, null)
  assert.equal(
    allAnalysis.acceptedSlices.find((s) => s.sliceId === 'qa-other-slice').costUSD.knownTotal,
    null
  )
  console.log(
    'PASS: separate comparison export, active context/provenance, per-role costs and unknown coverage'
  )

  await page.getByRole('navigation').getByRole('button', { name: 'Data & portability' }).click()
  const exportPath = join(directory, 'qa-export.json')
  // Route native file pickers to deterministic QA paths; export/import themselves use real IPC and disk.
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, exportPath)
  await button('Export dataset').click()
  await page
    .getByRole('status')
    .filter({ hasText: /Exported to/ })
    .waitFor()
  const exported = JSON.parse(await readFile(exportPath, 'utf8'))
  assert.equal(exported.slices[0].qualityGrade, 5)
  assert.equal(exported.runs.length, 4)
  assert.equal(exported.runs[0].priceSnapshot.inputRate, 2)
  assert.equal(exported.pricing[0].inputRate, 999)
  assert.equal(exported.runs[0].inputTokens, 138187)
  assert.equal(exported.runs[0].cachedInputTokens, 2902400)
  assert.equal(
    exported.runs[0].priceSnapshot.rateSource,
    'Synthetic QA source, not a published rate'
  )
  assert.equal(exported.slices[0].acceptedAt, '2026-09-11T11:00:00-05:00')
  assert.equal(exported.findings[0].title, 'Synthetic QA defect: retained state')
  assert.equal(exported.findings[0].contractInvariant, 'Edits must survive restart')
  assert.equal(exported.findings[0].impact, 'Lost operator edits')
  assert.equal(exported.findings[0].confidence, 'High: independently reproduced')
  assert.equal(exported.findings[0].notes, 'Separate reviewer notes')
  assert.equal(exported.discoveries[0].adopted, 'Deferred')
  assert.equal(exported.revision, analysis.source.datasetRevision)
  assert.equal(exported.kind, undefined)
  await field('Dataset JSON').fill(JSON.stringify(exported))
  await button('Validate & preview').click()
  await page.getByText('9 identical records skipped', { exact: true }).waitFor()
  assert.ok(await button('Import records').isDisabled())
  await field('Dataset JSON').fill(JSON.stringify(analysis))
  await button('Validate & preview').click()
  await page
    .getByRole('alert')
    .filter({ hasText: /not importable telemetry/ })
    .waitFor()
  const importPath = join(directory, 'qa-import.json')
  await writeFile(
    importPath,
    JSON.stringify({
      schemaVersion: 1,
      slices: [{ id: 'qa-imported', title: 'Synthetic imported QA slice' }]
    })
  )
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, importPath)
  await button('Choose JSON file').click()
  await field('Dataset JSON').waitFor()
  await button('Validate & preview').click()
  await button('Import records').click()
  await page
    .getByRole('status')
    .filter({ hasText: 'Import saved. All relationships validated.' })
    .waitFor()
  await field('Dataset JSON').fill(
    JSON.stringify({ schemaVersion: 1, slices: [{ id: 'qa-slice', title: 'Conflicting title' }] })
  )
  await button('Validate & preview').click()
  await page
    .getByRole('alert')
    .filter({ hasText: /conflicts with an existing record/ })
    .waitFor()
  await field('Dataset JSON').fill('{broken')
  await button('Validate & preview').click()
  await page
    .getByRole('alert')
    .filter({ hasText: /Invalid JSON/ })
    .waitFor()
  console.log('PASS: export, file import, preview, conflict and malformed JSON rejection')

  await app.close()
  await launch()
  await page.getByRole('heading', { name: 'Synthetic QA · accepted work', exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Synthetic imported QA slice', exact: true }).waitFor()
  await page.getByRole('button', { name: /Synthetic QA · accepted work/ }).click()
  await button('Implementation').click()
  await page.getByRole('dialog').getByText('$2.418', { exact: true }).waitFor()
  await page.getByRole('dialog').getByText('2 pp', { exact: true }).waitFor()
  await button('Close dialog').click()
  await page.setViewportSize({ width: 900, height: 680 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await captureElectron(app, page, { path: join(directory, '04-narrow.png') })
  assert.deepEqual(failures, [])
  const persisted = JSON.parse(await readFile(join(directory, 'telemetry.json'), 'utf8'))
  assert.equal(persisted.slices.length, 3)
  assert.equal(persisted.findings[0].repairRunId, 'qa-repair')
  assert.equal(persisted.discoveries[0].validation, 'Yes')
  assert.equal(persisted.discoveries[0].adopted, 'Deferred')
  console.log(
    'PASS: application restart durability, relationship preservation, 900px layout, no renderer exceptions'
  )
  console.log(`Electron QA artifacts: ${directory}`)
} catch (error) {
  if (page && !page.isClosed())
    await captureElectron(app, page, { path: join(directory, 'failure.png') }).catch(() => {})
  console.error(`QA failed. Artifacts: ${directory}`)
  throw error
} finally {
  if (app) await app.close().catch(() => {})
}
