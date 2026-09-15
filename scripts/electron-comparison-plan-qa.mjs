// Real Electron/preload/IPC/dialog/disk QA using an isolated synthetic profile.
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { captureElectron } from './electron-qa-capture.mjs'

const resultsRoot = resolve('test-results')
await mkdir(resultsRoot, { recursive: true })
const directory = await mkdtemp(join(resultsRoot, 'comparison-plan-runtime-'))
await copyFile(resolve('tests/accepted-outcome-fixture.json'), join(directory, 'telemetry.json'))
const env = { ...process.env, PENNYTEL_DATA_DIR: directory }
delete env.ELECTRON_RUN_AS_NODE
const errors = []
let application

try {
  application = await electron.launch({
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      resolve('out/main/index.js')
    ],
    env,
    timeout: 30_000
  })
  const page = await application.firstWindow()
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.webContents.setBackgroundThrottling(false)
    window.show()
    window.focus()
  })
  await page.bringToFront()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Slice notebook', exact: true }).waitFor()
  await page.getByRole('navigation').getByRole('button', { name: 'Compare' }).click()

  await page.getByText('Narrow the cohort').click()
  await page.getByLabel('Filter Project').selectOption('Synthetic accepted outcome QA')
  await page.getByLabel('Group runs by').selectOption('role')
  await page.getByLabel('Order groups').selectOption('time')
  await page.getByRole('checkbox', { name: 'Repair (role: Repair)' }).click()
  const uiBefore = {
    project: await page.getByLabel('Filter Project').inputValue(),
    groupBy: await page.getByLabel('Group runs by').inputValue(),
    sort: await page.getByLabel('Order groups').inputValue(),
    repair: await page.getByRole('checkbox', { name: 'Repair (role: Repair)' }).isChecked()
  }

  const telemetryPath = join(directory, 'telemetry.json')
  const telemetryBefore = await readFile(telemetryPath, 'utf8')
  const authoritative = JSON.parse(telemetryBefore)
  const planPath = join(directory, 'comparison-plan.json')
  const outputPath = join(directory, 'comparison-plan-results.json')
  const plan = {
    kind: 'pennytel-comparison-plan',
    planVersion: 1,
    name: 'Runtime state-isolation QA',
    comparisons: [
      {
        id: 'accepted-by-slice',
        name: 'Accepted by slice',
        context: {
          filters: { project: 'Synthetic accepted outcome QA' },
          groupBy: 'slice',
          sort: 'label'
        }
      },
      {
        id: 'repair-by-config',
        name: 'Repair by configuration',
        context: {
          filters: {},
          groupBy: 'modelConfiguration',
          sort: 'label',
          stageScopes: [{ kind: 'role', value: 'Repair' }]
        }
      },
      {
        id: 'unscoped-by-ambiguity',
        name: 'Unscoped by ambiguity',
        context: {
          filters: { project: 'Synthetic accepted outcome QA' },
          groupBy: 'ambiguity',
          sort: 'cost'
        }
      }
    ]
  }
  await writeFile(planPath, JSON.stringify(plan, null, 2))
  await application.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.plan] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output })
    },
    { plan: planPath, output: outputPath }
  )
  await page.getByRole('button', { name: 'Run comparison plan' }).click()
  await page.getByRole('status').filter({ hasText: outputPath }).waitFor()

  const bundle = JSON.parse(await readFile(outputPath, 'utf8'))
  assert.equal(bundle.kind, 'pennytel-comparison-plan-results')
  assert.equal(bundle.resultsFormatVersion, 1)
  assert.equal(bundle.app.version, '0.2.1')
  assert.equal(bundle.source.datasetRevision, authoritative.revision)
  assert.deepEqual(
    bundle.results.map(({ id, name }) => ({ id, name })),
    plan.comparisons.map(({ id, name }) => ({ id, name }))
  )
  assert.equal(bundle.results.length, 3)
  for (const [index, result] of bundle.results.entries()) {
    assert.equal(result.analysis.kind, 'pennytel-comparison')
    assert.equal(result.analysis.source.datasetRevision, bundle.source.datasetRevision)
    assert.equal(result.analysis.generatedAt, bundle.generatedAt)
    assert.deepEqual(result.analysis.context, plan.comparisons[index].context)
  }
  assert.deepEqual(bundle.results[1].analysis.context.filters, {})
  assert.deepEqual(bundle.results[1].analysis.context.stageScopes, [
    { kind: 'role', value: 'Repair' }
  ])
  assert.equal(bundle.results[2].analysis.context.stageScopes, undefined)
  assert.equal(await readFile(telemetryPath, 'utf8'), telemetryBefore)
  assert.deepEqual(
    {
      project: await page.getByLabel('Filter Project').inputValue(),
      groupBy: await page.getByLabel('Group runs by').inputValue(),
      sort: await page.getByLabel('Order groups').inputValue(),
      repair: await page.getByRole('checkbox', { name: 'Repair (role: Repair)' }).isChecked()
    },
    uiBefore
  )

  const comparisonPath = join(directory, 'ordinary-comparison.json')
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, comparisonPath)
  await page.getByRole('button', { name: 'Export comparison' }).click()
  await page.getByRole('status').filter({ hasText: comparisonPath }).waitFor()
  assert.equal(JSON.parse(await readFile(comparisonPath, 'utf8')).kind, 'pennytel-comparison')
  assert.equal(await readFile(telemetryPath, 'utf8'), telemetryBefore)

  const preferences = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return window.webContents.getLastWebPreferences()
  })
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.deepEqual(errors, [])
  await captureElectron(application, page, {
    path: join(directory, 'comparison-plan-success.png'),
    fullPage: true
  })
  console.log(
    `PASS: 3-entry plan chooser/save/IPC bundle, order/identity/context isolation, shared revision/timestamp, unchanged telemetry/UI state, ordinary export regression and sandbox. Evidence: ${directory}`
  )
} finally {
  await application?.close().catch(() => undefined)
}
