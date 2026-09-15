// Invoked by the repository's accepted-outcome QA, sharing its isolated real Electron profile.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { captureElectron } from './electron-qa-capture.mjs'

export async function verifyAnalytics(app, page, directory) {
  const workspace = page.getByRole('region', { name: 'Analytics workspace', exact: true })
  const region = (name) => workspace.getByRole('region', { name, exact: true })
  const filter = (name) => page.getByLabel(`Filter ${name}`, { exact: true })
  const clear = () => page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  assert.match(
    await workspace.innerText(),
    /Current cohort: 10 runs · 5 slices · 5 accepted outcomes/
  )
  assert.match(await region('Time versus cost').innerText(), /9\/10 paired samples · 1 omitted/)
  assert.match(
    await region('Operator quality versus accepted cost').innerText(),
    /1\/5 paired samples · 4 omitted/
  )
  assert.match(
    await region('First-pass acceptance distribution').innerText(),
    /Yes 2.*Unknown 2.*66.7%.*3\/5 determinable/s
  )
  const trend = region('Cost trend by recorded date')
  assert.match(await trend.innerText(), /1\/10 undated runs excluded/)
  assert.match(await trend.innerText(), /2026-09-11 · 8 runs/)
  assert.match(await trend.innerText(), /2026-09-12 · 1 runs/)
  await trend.getByText('Source runs for 2026-09-12', { exact: true }).click()
  await trend.getByRole('button', { name: 'later', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  const point = region('Time versus cost').getByRole('button', {
    name: /^Inspect run astra-implementation:/
  })
  await point.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('dialog').waitFor()
  assert.match(await page.getByRole('dialog').innerText(), /GPT-6 Astra/)
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByText('Narrow the cohort', { exact: true }).click()
  await filter('Project').selectOption('Synthetic accepted outcome QA')
  await filter('Recorded provider').selectOption('OpenAI')
  await filter('Saved offer ID').selectOption({ label: 'Unknown (not recorded)' })
  await filter('Runtime tested').selectOption('false')
  await filter('Factory role').selectOption('Implementer')
  await filter('Repair presence').selectOption('Yes')
  await filter('Repair cost burden').selectOption('Positive')
  await page.getByLabel('Run start from (UTC day)', { exact: true }).fill('2026-09-11')
  await page.getByLabel('Run start through (UTC day)', { exact: true }).fill('2026-09-11')
  await page.getByLabel('Group runs by', { exact: true }).selectOption('runType')
  assert.match(
    await workspace.innerText(),
    /Current cohort: 1 runs · 1 slices · 1 accepted outcomes/
  )
  assert.match(
    await region('Implementation versus accepted cost').innerText(),
    /Implementation \$2\.418.*1\/1 recorded.*Accepted \$2\.5248.*6\/6 recorded/s
  )
  assert.match(
    await region('Accepted lifecycle stage composition').innerText(),
    /Verification · Orchestrator/
  )
  await page
    .getByRole('button', { name: 'Inspect analytics group Implementation', exact: true })
    .click()
  await page.getByRole('heading', { name: 'Evidence · Implementation', exact: true }).waitFor()
  const path = join(directory, 'analytics-comparison.json')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, path)
  await page.getByRole('button', { name: 'Export comparison', exact: true }).click()
  await page.getByRole('status').filter({ hasText: path }).waitFor()
  const exported = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(exported.app.version, '0.1.5')
  assert.equal(exported.context.filters.offerId, null)
  assert.deepEqual(exported.context.dateRange, {
    from: '2026-09-11T00:00:00.000Z',
    to: '2026-09-11T23:59:59.999Z',
    includeUnknown: false
  })
  assert.deepEqual(exported.context.outcomeFilters, {
    repairPresence: 'Yes',
    repairBurden: 'Positive'
  })
  assert.deepEqual(exported.analytics.runIds, ['astra-implementation'])
  assert.equal(exported.acceptedAnalytics.lifecycleRunIds.length, 6)
  assert.equal(exported.acceptedAnalytics.sampleCount, 1)
  const composition = exported.analytics.costComposition
  assert.ok(
    Math.abs(
      Object.values(composition).reduce((sum, part) => sum + part.knownTotal, 0) - 2.418034
    ) < 1e-10
  )
  assert.ok(
    Math.abs(exported.acceptedAnalytics.knownLifecycleCostUSD.completeTotal - 2.524834) < 1e-10
  )
  await region('Cost composition').scrollIntoViewIfNeeded()
  await captureElectron(app, page, { path: join(directory, 'analytics-filtered.png') })
  await clear()
  await filter('Runtime tested').selectOption({ label: 'Unknown (not recorded)' })
  assert.match(
    await workspace.innerText(),
    /Current cohort: 1 runs · 1 slices · 1 accepted outcomes/
  )
  assert.match(await region('Cost composition').innerText(), /Unknown.*0\/1 recorded.*incomplete/s)
  await page.getByLabel('Run start from (UTC day)', { exact: true }).fill('2026-09-11')
  assert.match(
    await workspace.innerText(),
    /Current cohort: 0 runs · 0 slices · 0 accepted outcomes/
  )
  await page
    .getByRole('checkbox', { name: 'Include unknown run starts in date range', exact: true })
    .check()
  assert.match(
    await workspace.innerText(),
    /Current cohort: 1 runs · 1 slices · 1 accepted outcomes/
  )
  await page.getByLabel('Run start through (UTC day)', { exact: true }).fill('2026-09-10')
  assert.equal(
    await page.getByRole('button', { name: 'Export comparison', exact: true }).isDisabled(),
    true
  )
  await clear()
  await filter('Repair cost burden').selectOption('Zero')
  assert.match(
    await workspace.innerText(),
    /Current cohort: 2 runs · 2 slices · 2 accepted outcomes/
  )
  await clear()
  await filter('Repair presence').selectOption('Unknown')
  assert.match(
    await workspace.innerText(),
    /Current cohort: 1 runs · 2 slices · 2 accepted outcomes/
  )
  await clear()
  await page.getByLabel('Group runs by', { exact: true }).selectOption('modelConfiguration')
  await page.getByText('Narrow the cohort', { exact: true }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  await region('Time versus cost').scrollIntoViewIfNeeded()
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true
  )
  await captureElectron(app, page, { path: join(directory, 'analytics-narrow.png') })
  const stats = region('Analytics statistics')
  await stats.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  assert.ok(await stats.evaluate((element) => element.scrollWidth >= element.clientWidth))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960))
  await workspace
    .getByRole('heading', { name: 'Comparison analytics', exact: true })
    .scrollIntoViewIfNeeded()
  await captureElectron(app, page, { path: join(directory, 'analytics-overview.png') })
  console.log(
    'PASS: analytics filters, date/Unknown state, cohort/lifecycle retention, composition, distributions, two-day trends, source points, authoritative export, 900px layout.'
  )
}
