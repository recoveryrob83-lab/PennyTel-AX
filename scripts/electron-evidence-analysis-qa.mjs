// Extends schema-v2 QA inside its isolated, visible Electron profile.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { captureElectron } from './electron-qa-capture.mjs'
import { canonicalSnapshot } from './canonical-qa.mjs'

export async function verifyEvidenceAnalysis(application, page, directory) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const navigate = async (name) =>
    page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
  const load = async () => (await page.evaluate(() => window.pennytel.load())).data
  await page.reload()
  await page.getByRole('heading', { name: 'Slice notebook', exact: true }).waitFor()
  await navigate('Data & portability')
  const base = { sliceId: 'evidence-slice', role: 'Implementer' }
  const incoming = [
    {
      ...base,
      id: 'partial-evidence',
      runType: 'Partial evidence',
      executionEvidence: {
        kind: 'codex-rollout',
        formatVersion: 1,
        runtimeVersion: '0.42.0',
        modelContextWindowTokens: 200000,
        peakInvocation: { inputTokens: 1000 },
        quotaWindows: [{ attribution: 'Unknown', note: 'No attribution recorded' }]
      }
    },
    {
      ...base,
      id: 'zero-evidence',
      runType: 'Zero evidence',
      executionEvidence: {
        kind: 'codex-rollout',
        formatVersion: 1,
        runtimeVersion: 'Unknown',
        timeToFirstTokenMs: 0,
        modelInvocationCount: 0,
        toolCallCount: 0,
        quotaWindows: [
          {
            attribution: 'Clean',
            first: { usedPercent: 0 },
            last: { usedPercent: 1 },
            note: 'Recorded clean window; coarse endpoints'
          }
        ]
      }
    },
    {
      ...base,
      id: 'zero-peak',
      runType: 'Zero peak',
      executionEvidence: {
        kind: 'codex-rollout',
        formatVersion: 1,
        peakInvocation: { inputTokens: 0, contextWindowTokens: 1000 }
      }
    }
  ]
  await page.getByLabel('Dataset JSON').fill(JSON.stringify({ schemaVersion: 2, runs: incoming }))
  await button('Validate & preview').click()
  await button('Import records').click()
  await page.getByRole('status').filter({ hasText: 'Import saved' }).waitFor()
  const data = await load()
  assert.equal(data.runs.length, 6)
  const before = await canonicalSnapshot(directory)

  await navigate('Slice notebook')
  await page.getByRole('button').filter({ hasText: 'Synthetic evidence slice' }).click()
  const detail = page.getByRole('region', { name: 'Execution evidence', exact: true })
  const field = (label) =>
    detail
      .locator('dl > div')
      .filter({ has: page.locator('dt').getByText(label, { exact: true }) })
      .locator('dd')
  await button('Evidence runtime run').click()
  await detail.waitFor()
  assert.equal(await field('Source log basename').innerText(), 'synthetic-rollout.jsonl')
  assert.equal(await field('Session ID').innerText(), 'synthetic-session-1')
  assert.equal(await field('Runtime / Codex version').innerText(), 'synthetic-1.0')
  assert.equal(await field('TTFT (ms)').innerText(), '123.5')
  assert.equal(await field('Tool calls').innerText(), '0')
  assert.equal(await field('Peak context utilization').innerText(), '45%')
  assert.match(await detail.innerText(), /Contaminated/)
  assert.match(await detail.innerText(), /10.5%/)
  assert.match(await detail.innerText(), /12.5%/)
  assert.equal(await detail.getByRole('link').count(), 0)
  assert.equal(await detail.getByRole('textbox').count(), 0)
  await detail
    .getByRole('heading', { name: 'Execution evidence', exact: true })
    .scrollIntoViewIfNeeded()
  await captureElectron(application, page, { path: join(directory, 'evidence-detail.png') })
  await field('Peak context utilization').scrollIntoViewIfNeeded()
  await captureElectron(application, page, { path: join(directory, 'evidence-context-quota.png') })
  await button('Close dialog').click()

  for (const [runType, checks] of [
    [
      'Partial evidence',
      [
        ['TTFT (ms)', 'Unknown'],
        ['Peak context utilization', 'Unknown'],
        ['Attribution', 'Unknown']
      ]
    ],
    [
      'Zero evidence',
      [
        ['TTFT (ms)', '0'],
        ['Model invocations', '0'],
        ['Tool calls', '0'],
        ['Attribution', 'Clean'],
        ['First used_percent', '0%']
      ]
    ],
    [
      'Zero peak',
      [
        ['Peak invocation input (tokens, includes cache)', '0'],
        ['Peak context utilization', '0%']
      ]
    ]
  ]) {
    await button(runType).click()
    for (const [label, expected] of checks) assert.equal(await field(label).innerText(), expected)
    await button('Close dialog').click()
  }
  await button('Historical run').click()
  assert.match(await detail.innerText(), /Unknown · no execution evidence recorded/)
  await button('Close dialog').click()
  console.log(
    'PASS: read-only complete/partial/absent/zero evidence, paired context math, inert provenance, and Clean/Contaminated/Unknown quota display'
  )

  await navigate('Compare')
  const statistics = page.getByRole('region', {
    name: 'Execution evidence statistics',
    exact: true
  })
  const overall = statistics.getByRole('row').nth(1)
  assert.match(await overall.innerText(), /4\/6 with execution evidence · 2 Unknown/)
  assert.match(await overall.innerText(), /Mean 61.75 · median 61.75/)
  assert.match(await overall.innerText(), /Mean 22.5% · median 22.5%/)
  assert.match(await overall.innerText(), /2\/6 known · 4 Unknown/)
  await page.getByText('Narrow the cohort', { exact: true }).click()
  await page.getByLabel('Group runs by').selectOption('runtimeVersion')

  async function saveDialog(path) {
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, path)
  }
  async function exportUI(name) {
    const path = join(directory, name)
    await saveDialog(path)
    await button('Export comparison').click()
    await page.getByRole('status').filter({ hasText: path }).waitFor()
    return JSON.parse(await readFile(path, 'utf8'))
  }
  const all = await exportUI('evidence-all-comparison.json')
  assert.equal(all.app.version, '0.3.0')
  const analytics = all.analytics.executionEvidence
  assert.deepEqual(analytics.sourceKinds, {
    counts: [{ value: 'codex-rollout', count: 4 }],
    recorded: 4,
    total: 6,
    complete: false
  })
  assert.equal(analytics.timeToFirstTokenMs.mean, 61.75)
  assert.equal(analytics.modelInvocationCount.mean, 2)
  assert.equal(analytics.toolCallCount.mean, 0)
  assert.equal(analytics.peakInputTokens.knownCount, 3)
  assert.equal(analytics.peakInputTokens.mean, 91000 / 3)
  assert.equal(analytics.peakContextUtilization.mean, 0.225)
  assert.equal(analytics.peakContextUtilization.knownCount, 2)
  assert.equal(all.summary.usageBurnPercentagePoints.knownTotal, null)
  assert.deepEqual(all.analytics.executionEvidence, all.summary.analytics.executionEvidence)

  await page.getByLabel('Filter Evidence source kind').selectOption('codex-rollout')
  await page.getByLabel('Filter Runtime / Codex version').selectOption('Unknown')
  assert.match(await overall.innerText(), /1\/1 with execution evidence/)
  assert.match(await overall.innerText(), /Mean 0 · median 0/)
  await button('Inspect execution evidence group Unknown').click()
  await page.getByRole('heading', { name: 'Evidence · Unknown', exact: true }).waitFor()
  await button('Zero evidence').click()
  assert.equal(await field('Model invocations').innerText(), '0')
  await button('Close dialog').click()
  const selected = await exportUI('evidence-selected-comparison.json')
  assert.deepEqual(selected.context.filters, {
    evidenceSourceKind: 'codex-rollout',
    runtimeVersion: 'Unknown'
  })
  assert.equal(selected.context.groupBy, 'runtimeVersion')
  assert.equal(selected.context.selectedGroup, '["recorded","Unknown"]')
  assert.deepEqual(selected.cohort.runIds, ['zero-evidence'])
  await button('Clear filters').click()
  await page.getByLabel('Filter Runtime / Codex version').selectOption('__missing__')
  assert.match(await overall.innerText(), /1\/3 with execution evidence · 2 Unknown/)
  const missing = await exportUI('evidence-missing-runtime.json')
  assert.deepEqual(missing.context.filters, { runtimeVersion: null })
  assert.deepEqual(missing.cohort.runIds, ['legacy-run', 'legacy-child', 'zero-peak'])
  await button('Clear filters').click()
  await page.getByLabel('Filter Evidence source kind').selectOption('__missing__')
  assert.match(await overall.innerText(), /0\/2 with execution evidence · 2 Unknown/)
  assert.match(await overall.innerText(), /Mean Unknown · median Unknown/)
  const absent = await exportUI('evidence-absent-comparison.json')

  const outputs = [all, selected, missing, absent]
  const plan = {
    kind: 'pennytel-comparison-plan',
    planVersion: 1,
    name: 'Evidence runtime parity',
    comparisons: outputs.map((output, i) => ({
      id: `e${i}`,
      name: `Evidence ${i}`,
      context: output.context
    }))
  }
  const planPath = join(directory, 'evidence-plan.json')
  const resultsPath = join(directory, 'evidence-plan-results.json')
  await writeFile(planPath, JSON.stringify(plan, null, 2))
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, planPath)
  await saveDialog(resultsPath)
  await button('Run comparison plan').click()
  await page.getByRole('status').filter({ hasText: resultsPath }).waitFor()
  const results = JSON.parse(await readFile(resultsPath, 'utf8'))
  assert.equal(results.source.datasetRevision, data.revision)
  assert.equal(results.results.length, outputs.length)
  for (const [i, result] of results.results.entries()) {
    assert.equal(result.id, `e${i}`)
    assert.deepEqual(result.analysis, { ...outputs[i], generatedAt: results.generatedAt })
  }
  for (const artifact of [all, results])
    await assert.rejects(
      page.evaluate((text) => window.pennytel.previewImport(text), JSON.stringify(artifact)),
      /derived analysis/
    )
  assert.equal(await canonicalSnapshot(directory), before)
  const rawPath = join(directory, 'evidence-analysis-raw.json')
  await saveDialog(rawPath)
  assert.equal(await page.evaluate(() => window.pennytel.exportData()), rawPath)
  assert.deepEqual(JSON.parse(await readFile(rawPath, 'utf8')), data)
  assert.deepEqual(await load(), data)

  await button('Clear filters').click()
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setMinimumSize(0, 0)
    window.setSize(900, 760)
  })
  await page
    .getByRole('heading', { name: 'Execution evidence analytics', exact: true })
    .scrollIntoViewIfNeeded()
  const layout = await statistics.evaluate((element) => ({
    overflow: getComputedStyle(element).overflowX,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }))
  assert.equal(layout.overflow, 'auto')
  assert.ok(layout.scrollWidth > layout.clientWidth)
  assert.ok(layout.pageWidth <= layout.viewport + 1)
  await captureElectron(application, page, {
    path: join(directory, 'evidence-analytics-narrow.png')
  })
  await statistics.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  await captureElectron(application, page, {
    path: join(directory, 'evidence-analytics-narrow-context.png')
  })
  const preferences = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
  )
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  console.log(
    `PASS: six-run evidence analytics/coverage, exact and Unknown filters/groups/source inspection, ordinary/plan parity, raw/live/backup stability, 900px layout and Electron security. Artifacts: ${directory}`
  )
}
