// All generated telemetry is synthetic QA data in an isolated directory.
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const results = resolve('test-results')
await mkdir(results, { recursive: true })
const directory = await mkdtemp(join(results, 'electron-qa-'))
const env = { ...process.env, PENNYTEL_DATA_DIR: directory }
delete env.ELECTRON_RUN_AS_NODE
let app
let page
const failures = []
async function launch() {
  app = await electron.launch({ args: [resolve('out/main/index.js')], env, timeout: 30_000 })
  page = await app.firstWindow()
  page.on('pageerror', (error) => failures.push(error.message))
  await page.getByRole('heading', { name: 'Slice notebook', exact: true }).waitFor()
}
const button = (name) => page.getByRole('button', { name, exact: true })
const field = (name) => page.getByLabel(name, { exact: false })
async function save(name) {
  await button(`Save ${name}`).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
}
async function addRun({ id, type, role, model = 'QA Model', tokens = true }) {
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
    await field('Input tokens (including cached)').fill('100000')
    await field('Cached input tokens').fill('40000')
    await field('Output tokens (including reasoning)').fill('20000')
  }
  await save('run')
}
try {
  await launch()
  await page.getByText('Start with a piece of work', { exact: true }).waitFor()
  await page.screenshot({ path: join(directory, '01-empty.png') })

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
  await addRun({ id: 'qa-implementation', type: 'Implementation', role: 'Implementer' })
  await addRun({
    id: 'qa-critic',
    type: 'Criticism',
    role: 'Critic',
    model: 'QA Unpriced Model',
    tokens: false
  })
  await addRun({ id: 'qa-repair', type: 'Repair', role: 'Repair' })
  await button('Implementation').click()
  await page.getByRole('dialog').getByText('$0.34', { exact: true }).waitFor()
  await button('Edit run').click()
  await field('Cached input tokens').fill('100001')
  await button('Save run').click()
  await page
    .getByRole('alert')
    .filter({ hasText: /cached input exceeds/ })
    .waitFor()
  await field('Cached input tokens').fill('40000')
  await save('run')
  console.log('PASS: run creation, precise cost, invalid token rejection and correction')

  await page.getByRole('tab', { name: 'Findings' }).click()
  await button('+ Add finding').click()
  await field('Record ID').fill('qa-finding')
  await field('Discovered in run').selectOption('qa-critic')
  await field('Severity').selectOption('P1')
  await field('Category').selectOption('Product')
  await field('Short description').fill('Synthetic QA defect: changed value was not retained')
  await field('User visible').selectOption('true')
  await field('Repair required').selectOption('true')
  await field('Repair run').selectOption('qa-repair')
  await field('Final status').selectOption('Repaired')
  await field('Evidence / notes').fill('Synthetic QA evidence; not actual production telemetry.')
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
  await save('discovery')
  await page.getByText('Validated autonomous', { exact: true }).waitFor()
  console.log('PASS: linked findings, repair links, and independently validated discoveries')

  await button('Edit slice').click()
  await field('Disposition').selectOption('Accepted')
  await field('Accepted at').fill('2026-09-11T11:00:00-05:00')
  await field('Product quality grade').fill('A')
  await field('Preferred candidate / model').fill('Candidate A')
  await save('slice')
  await page.getByRole('tab', { name: 'Runs' }).click()
  await page.screenshot({ path: join(directory, '02-slice.png') })

  await button('Criticism').click()
  await button('Delete run').click()
  await button('Delete record').click()
  await page
    .getByRole('alert')
    .filter({ hasText: /referenced by a finding/ })
    .waitFor()
  await button('Cancel').click()
  console.log('PASS: referenced run deletion blocked without data loss')

  await page.getByRole('navigation').getByRole('button', { name: 'Pricing history' }).click()
  await button('Edit price').click()
  await page.getByLabel(/^Input \$ \/ million/).fill('999')
  await save('price')
  await page.getByRole('navigation').getByRole('button', { name: 'Compare', exact: true }).click()
  await page.getByRole('heading', { name: 'Compare the work' }).waitFor()
  await page.getByText('$0.68', { exact: true }).first().waitFor()
  await page.screenshot({ path: join(directory, '03-compare.png'), fullPage: true })
  await field('Group runs by').selectOption('role')
  await page.getByRole('heading', { name: 'Run economics by factory role' }).waitFor()
  await page.getByText('Narrow the cohort', { exact: true }).click()
  await field('Filter Thinking level').selectOption('High')
  await field('Filter Factory role').selectOption('Implementer')
  await page.getByRole('heading', { name: 'Accepted slice economics' }).waitFor()
  await page
    .getByRole('cell')
    .filter({ hasText: /^\$0\.68/ })
    .waitFor()
  console.log(
    'PASS: frozen historical cost, group comparison, full acceptance cost under role filters'
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
  assert.equal(exported.slices[0].qualityGrade, 'A')
  assert.equal(exported.runs.length, 3)
  assert.equal(exported.runs[0].priceSnapshot.inputRate, 2)
  assert.equal(exported.pricing[0].inputRate, 999)
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
  await page.getByRole('dialog').getByText('$0.34', { exact: true }).waitFor()
  await button('Close dialog').click()
  await page.setViewportSize({ width: 900, height: 680 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(directory, '04-narrow.png') })
  assert.deepEqual(failures, [])
  const persisted = JSON.parse(await readFile(join(directory, 'telemetry.json'), 'utf8'))
  assert.equal(persisted.slices.length, 2)
  assert.equal(persisted.findings[0].repairRunId, 'qa-repair')
  assert.equal(persisted.discoveries[0].validation, 'Yes')
  console.log(
    'PASS: application restart durability, relationship preservation, 900px layout, no renderer exceptions'
  )
  console.log(`Electron QA artifacts: ${directory}`)
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
  console.error(`QA failed. Artifacts: ${directory}`)
  throw error
} finally {
  if (app) await app.close().catch(() => {})
}
