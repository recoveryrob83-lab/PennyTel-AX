// Runs the durable projection smoke in Electron's embedded Node, with isolated synthetic data.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'
import { canonicalDataset } from './canonical-qa.mjs'

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
  assert.equal(report.checks.canonicalArtifactRestartRecovery, true)
  assert.equal(report.checks.legacyMigrationBoundary, true)
  assert.equal(report.checks.startupRefusalEvidenceUnchanged, true)
  if (phase === 'restart') {
    assert.equal(report.checks.legacyArchiveExactBytes, true)
    assert.equal(report.checks.productionCanonicalMutation, true)
    assert.equal(report.checks.invalidAndMissingProjectionRebuild, true)
    assert.equal(report.checks.noLegacyDualWrites, true)
  }
  assert.equal(report.artifactRoot.includes('app.asar'), false)
  assert.equal(report.settings.foreignKeys, true)
  assert.equal(report.settings.journalMode, 'wal')
  assert.equal(report.settings.synchronous, 'normal')
  assert.equal(report.settings.trustedSchema, false)
  return report
}

const created = await runPhase('create')
const restarted = await runPhase('restart')
assert.equal(restarted.databasePath, created.databasePath)
assert.equal(restarted.artifactRoot, created.artifactRoot)
assert.deepEqual(restarted.recordCounts, created.recordCounts)
assert.equal(Boolean(packagedExecutable), entry.includes('app.asar'))

async function storageEvidence(profile, nested = false) {
  const entries = await readdir(profile, { withFileTypes: true })
  return Promise.all(
    entries
      .filter(
        ({ name }) =>
          nested ||
          /^(telemetry\.|legacy-migration\.|pennytel-projection\.|canonical-artifact-store$|projection-recovery$)/.test(
            name
          )
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (item) => [
        item.name,
        item.isDirectory()
          ? await storageEvidence(join(profile, item.name), true)
          : (await readFile(join(profile, item.name))).toString('base64')
      ])
  )
}

// Exercise the same refusal through the actual normal application/preload/UI.
for (const refusal of restarted.startupRefusals) {
  const before = await storageEvidence(refusal.directory)
  const env = { ...process.env, PENNYTEL_DATA_DIR: refusal.directory }
  delete env.ELECTRON_RUN_AS_NODE
  const application = await electron.launch({
    executablePath: executable,
    args: [
      ...(packagedExecutable ? [] : ['.']),
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ],
    env,
    timeout: 30_000
  })
  try {
    const page = await application.firstWindow()
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.show()
      window.focus()
    })
    await page.getByRole('alert').filter({ hasText: refusal.message }).waitFor()
    assert.equal(await page.getByRole('button', { name: '+ New slice', exact: true }).count(), 0)
    const error = await page.evaluate(async () => {
      try {
        await window.pennytel.load()
        return 'unexpected successful load'
      } catch (error) {
        return error.message
      }
    })
    assert.ok(error.includes(refusal.message), error)
    await page.getByRole('button', { name: 'Retry load', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: refusal.message }).waitFor()
  } finally {
    await application.close()
  }
  assert.deepEqual(await storageEvidence(refusal.directory), before)
}

if (packagedExecutable) {
  const env = { ...process.env, PENNYTEL_DATA_DIR: restarted.productionDirectory }
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
    const loaded = await page.evaluate(() => window.pennytel.load())
    assert.deepEqual(loaded.data, await canonicalDataset(restarted.productionDirectory))
    assert.equal(loaded.path, join(restarted.productionDirectory, 'canonical-artifact-store'))
    const saved = await page.evaluate(
      async (revision) =>
        window.pennytel.mutate({
          kind: 'save',
          table: 'slices',
          revision,
          record: { id: 'packaged-cutover-smoke', title: 'Packaged canonical save' }
        }),
      loaded.data.revision
    )
    assert.deepEqual(saved.data, await canonicalDataset(restarted.productionDirectory))
    await application.close()
    application = await electron.launch({
      executablePath: packagedExecutable,
      env,
      timeout: 30_000
    })
    const restartedPage = await application.firstWindow()
    await restartedPage.getByRole('heading', { name: 'Slice notebook', exact: true }).waitFor()
    assert.deepEqual((await restartedPage.evaluate(() => window.pennytel.load())).data, saved.data)
    assert.equal(existsSync(join(restarted.productionDirectory, 'telemetry.json')), false)
    assert.equal(existsSync(join(restarted.productionDirectory, 'telemetry.backup.json')), false)
  } finally {
    await application?.close()
  }
}
console.log(
  `PASS: SQLite projection, canonical recovery, legacy migration/archival/cutover, projection rebuild, and all three startup refusals through storage/application/retry with unchanged evidence in Electron ${created.versions.electron}; Node ${created.versions.node}; SQLite ${created.versions.sqlite}; packaged=${Boolean(packagedExecutable)}${packagedExecutable ? '; packaged application/load/save/restart/security=true' : ''}; reports=${directory}`
)
