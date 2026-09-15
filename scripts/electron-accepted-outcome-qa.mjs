// Synthetic identities and frozen test prices; token magnitudes match the repository's
// production-shaped Codex example. Never reads or alters an operator profile.
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { captureElectron } from './electron-qa-capture.mjs'
import { verifyAnalytics } from './electron-analytics-qa.mjs'

await mkdir(resolve('test-results'), { recursive: true })
const directory = await mkdtemp(resolve('test-results/accepted-outcome-runtime-'))
const data = JSON.parse(await readFile(resolve('tests/accepted-outcome-fixture.json'), 'utf8'))
data.registry = JSON.parse(
  await readFile(
    resolve('docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json'),
    'utf8'
  )
)
const bytes = JSON.stringify(data, null, 2)
const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
await writeFile(join(directory, 'telemetry.json'), bytes)
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
  await page.getByText(`PennyTel v${version}`, { exact: false }).waitFor()
  await page.getByRole('navigation').getByRole('button', { name: 'Compare', exact: true }).click()
}
try {
  await launch()
  assert.deepEqual((await page.evaluate(() => window.pennytel.load())).data, data)
  const table = page.getByRole('region', { name: 'Accepted outcome comparison' })
  const row = (title) => table.getByRole('row').filter({ hasText: title })
  assert.equal(await table.locator('tbody tr').count(), 5)
  assert.match(
    await row('Directly accepted implementation').locator('th, td').nth(4).innerText(),
    /^Yes/
  )
  assert.match(await row('Cross-model accepted repair').locator('th, td').nth(4).innerText(), /^No/)
  assert.match(
    await row('Incomplete accepted lifecycle').locator('th, td').nth(4).innerText(),
    /^Unknown/
  )
  assert.match(await row('Incomplete accepted lifecycle').innerText(), /no acceptance cutoff/)
  assert.match(
    await row('Accepted with no recorded runs').locator('th, td').nth(1).innerText(),
    /Unknown.*0\/0 recorded.*incomplete/s
  )
  assert.match(
    await row('Recorded zero-cost acceptance').locator('th, td').nth(1).innerText(),
    /\$0\.00.*1\/1 recorded/s
  )
  await table.scrollIntoViewIfNeeded()
  await captureElectron(app, page, { path: join(directory, 'accepted-outcomes.png') })
  await verifyAnalytics(app, page, directory)
  await page.getByText('Narrow the cohort', { exact: true }).click()
  const filter = page.getByLabel('Filter Model Configuration', { exact: true })
  await filter.selectOption({ label: 'GPT-6 Astra — Low' })
  const astraKey = await filter.inputValue()
  await page.getByRole('checkbox', { name: 'GPT-6 Astra — Low', exact: true }).check()
  await page
    .getByRole('checkbox', { name: 'Implementation (role: Implementer)', exact: true })
    .check()
  assert.equal(await table.locator('tbody tr').count(), 4)
  const mixed = row('Cross-model accepted repair')
  assert.match(await mixed.innerText(), /\$2\.5248.*6\/6 recorded/s)
  assert.match(await mixed.locator('th, td').nth(2).innerText(), /1\.2h.*6\/6 recorded/s)
  assert.match(await mixed.locator('th, td').nth(3).innerText(), /1\.5h.*Recorded timing complete/s)
  assert.match(await mixed.locator('th, td').nth(6).innerText(), /No: 5.*Yes: 1.*6\/6 recorded/s)
  const summary = page.getByText('Inspect lifecycle · Cross-model accepted repair · 6 runs', {
    exact: true
  })
  await summary.click()
  const detail = page.locator('details').filter({ has: summary })
  const stages = detail.getByRole('table', {
    name: 'Lifecycle stages · Cross-model accepted repair',
    exact: true
  })
  assert.equal(await stages.locator('tbody tr').count(), 6)
  for (const stage of [
    'Context map',
    'Implementation',
    'Independent critic',
    'Repair',
    'Re-critic',
    'Verification'
  ])
    assert.match(await stages.innerText(), new RegExp(stage))
  const totals = detail.getByRole('table', {
    name: 'Lifecycle totals · Cross-model accepted repair',
    exact: true
  })
  assert.match(await totals.innerText(), /184,187.*3,302,400.*74,246.*13,005.*17\.5%/s)
  await detail.getByRole('button', { name: 'Repair', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /GPT-5.6 Luna/)
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await stages.scrollIntoViewIfNeeded()
  await captureElectron(app, page, { path: join(directory, 'accepted-stages.png') })
  const exportPath = join(directory, 'accepted-comparison.json')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, exportPath)
  await page.getByRole('button', { name: 'Export comparison', exact: true }).click()
  await page.getByRole('status').filter({ hasText: exportPath }).waitFor()
  const analysis = JSON.parse(await readFile(exportPath, 'utf8'))
  assert.equal(analysis.app.version, '0.2.1')
  assert.deepEqual(analysis.context.filters, { modelConfiguration: astraKey })
  assert.deepEqual(analysis.context.selectedCandidates, [astraKey])
  assert.deepEqual(analysis.context.stageScopes, [{ kind: 'role', value: 'Implementer' }])
  const accepted = analysis.acceptedSlices.find((s) => s.sliceId === 'mixed')
  assert.deepEqual(accepted.lifecycleRunIds, [
    'support',
    'astra-implementation',
    'luna-critic',
    'luna-repair',
    'luna-recritic',
    'verification'
  ])
  assert.ok(Math.abs(accepted.costUSD.completeTotal - 2.524834) < 1e-10)
  assert.equal(accepted.wallMinutes.completeTotal, 72)
  assert.equal(accepted.timeToAcceptedMinutes, 90)
  assert.equal(accepted.outcome.firstPassAcceptance.state, 'No')
  assert.deepEqual(accepted.outcome.repair.runIds, ['luna-repair'])
  assert.equal(accepted.outcome.stages.length, 6)
  assert.equal(accepted.evidence.numeric.reasoningTokens.completeTotal, 13005)
  const invalid = await page.evaluate(async (analysis) => {
    try {
      await window.pennytel.previewImport(JSON.stringify(analysis))
      return 'unexpected success'
    } catch (error) {
      return error.message
    }
  }, analysis)
  assert.match(invalid, /not importable telemetry/)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  await table.scrollIntoViewIfNeeded()
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true
  )
  await table.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  assert.ok(await table.evaluate((element) => element.scrollLeft > 0))
  const pinned = await table.evaluate((element) => {
    const header = element.querySelector('thead th').getBoundingClientRect()
    const row = element.querySelector('tbody th').getBoundingClientRect()
    const bounds = element.getBoundingClientRect()
    return { headerLeft: header.left, rowLeft: row.left, left: bounds.left, right: bounds.right }
  })
  assert.ok(Math.abs(pinned.headerLeft - pinned.rowLeft) <= 1)
  assert.ok(pinned.rowLeft >= pinned.left && pinned.rowLeft < pinned.right)
  await captureElectron(app, page, { path: join(directory, 'accepted-narrow.png') })
  const rawPath = join(directory, 'raw.json')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, rawPath)
  await page.evaluate(() => window.pennytel.exportData())
  assert.deepEqual(JSON.parse(await readFile(rawPath, 'utf8')), data)
  assert.equal(await readFile(join(directory, 'telemetry.json'), 'utf8'), bytes)
  await app.close()
  await launch()
  assert.deepEqual((await page.evaluate(() => window.pennytel.load())).data, data)
  assert.equal(
    await page
      .getByRole('region', { name: 'Accepted outcome comparison' })
      .locator('tbody tr')
      .count(),
    5
  )
  assert.deepEqual(errors, [])
  console.log(
    `PASS: accepted outcomes, full Astra/Luna lifecycle, direct first-pass/repaired/Unknown/zero, stage and source-run inspection, tokens, runtime evidence, filtered authoritative export, raw bytes, restart and 900px layout. Evidence: ${directory}`
  )
} finally {
  if (app) await app.close()
}
