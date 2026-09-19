// Runs the durable projection smoke in Electron's embedded Node, with isolated synthetic data.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const packagedExecutable = process.argv[2] ? resolve(process.argv[2]) : undefined
const resultsRoot = resolve('test-results')
await mkdir(resultsRoot, { recursive: true })
const directory = await mkdtemp(join(resultsRoot, 'storage-runtime-'))
const executable = packagedExecutable ?? electronPath
const archive = packagedExecutable
  ? join(dirname(packagedExecutable), 'resources/app.asar')
  : undefined
const entry = packagedExecutable
  ? join(archive, 'out/main/sqlite-projection-qa.js')
  : resolve('out/main/sqlite-projection-qa.js')
assert.ok(existsSync(executable), `Electron executable does not exist: ${executable}`)
assert.ok(
  existsSync(archive ?? entry),
  `Storage QA ${archive ? 'archive' : 'entry'} does not exist: ${archive ?? entry}`
)

async function runPhase(phase) {
  const env = { ...process.env }
  if (packagedExecutable) env.ELECTRON_RUN_AS_NODE = '1'
  else delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(executable, [entry, directory, phase], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Electron storage QA ${phase} timed out.\n${stdout}\n${stderr}`))
    }, 30_000)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolveResult({ code, signal, stdout, stderr })
    })
  })
  if (result.code !== 0)
    throw new Error(
      `Electron storage QA ${phase} failed (code=${result.code}, signal=${result.signal}).\n${result.stdout}\n${result.stderr}`
    )
  const report = JSON.parse(await readFile(join(directory, `${phase}-report.json`), 'utf8'))
  assert.equal(report.phase, phase)
  assert.equal(report.checks.roundTrip, true)
  assert.equal(report.checks.knownZero, true)
  assert.equal(report.checks.unknownOmitted, true)
  assert.equal(report.checks.nestedEvidence, true)
  assert.equal(report.checks.registry, true)
  assert.equal(report.checks.outsideAsar, true)
  assert.equal(report.settings.foreignKeys, true)
  assert.equal(report.settings.journalMode, 'wal')
  assert.equal(report.settings.synchronous, 'normal')
  assert.equal(report.settings.trustedSchema, false)
  return report
}

const created = await runPhase('create')
const restarted = await runPhase('restart')
assert.equal(restarted.databasePath, created.databasePath)
assert.deepEqual(restarted.recordCounts, created.recordCounts)
assert.equal(Boolean(packagedExecutable), entry.includes('app.asar'))

if (packagedExecutable) {
  const env = { ...process.env, PENNYTEL_DATA_DIR: directory }
  delete env.ELECTRON_RUN_AS_NODE
  let application
  try {
    application = await electron.launch({
      executablePath: packagedExecutable,
      args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
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
    await page.getByRole('heading', { name: 'Slice notebook', exact: true }).waitFor()
    const main = await application.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged,
      appPath: app.getAppPath(),
      preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    }))
    assert.equal(main.packaged, true)
    assert.equal(main.appPath.endsWith('app.asar'), true)
    assert.equal(main.preferences.sandbox, true)
    assert.equal(main.preferences.contextIsolation, true)
    assert.equal(main.preferences.nodeIntegration, false)
    const renderer = await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
      api: Object.keys(window.pennytel).sort()
    }))
    assert.equal(renderer.require, 'undefined')
    assert.equal(renderer.process, 'undefined')
    assert.deepEqual(renderer.api, [
      'commitBatchImport',
      'exportComparison',
      'exportData',
      'load',
      'mutate',
      'openBatchImport',
      'openImport',
      'previewImport',
      'runComparisonPlan'
    ])
  } finally {
    await application?.close()
  }
}
console.log(
  `PASS: SQLite projection create/restart in Electron ${created.versions.electron}; Node ${created.versions.node}; SQLite ${created.versions.sqlite}; packaged=${Boolean(packagedExecutable)}${packagedExecutable ? '; packaged application/security=true' : ''}; reports=${directory}`
)
