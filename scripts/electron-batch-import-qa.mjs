import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
await mkdir(resolve('test-results'), { recursive: true })
const profile = await mkdtemp(resolve('test-results/batch-runtime-'))
const folder = join(profile, 'historical')
await mkdir(join(folder, 'project', 'implementer'), { recursive: true })
const slice = { id: 'batch-slice', title: 'Batch runtime QA' }
for (let i = 0; i < 20; i++) {
  await writeFile(
    join(folder, 'project', 'implementer', `${String(i).padStart(2, '0')}.pennytel.json`),
    JSON.stringify({
      schemaVersion: i % 2 ? 1 : 2,
      slices: [slice],
      runs: [{ id: `run-${i}`, sliceId: slice.id, runType: `Batch run ${i}`, role: 'Implementer' }]
    })
  )
}
await writeFile(join(folder, 'rollout.jsonl'), 'ignored')
await writeFile(join(folder, 'manifest.json'), 'ignored')
let application
async function launch() {
  const env = { ...process.env, PENNYTEL_DATA_DIR: profile }
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({ args: [resolve('out/main/index.js')], env })
  const page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  await page.getByRole('heading', { name: 'Slice notebook', exact: true }).waitFor()
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.show()
    window.focus()
  })
  return page
}
try {
  let page = await launch()
  const load = () => page.evaluate(async () => (await window.pennytel.load()).data)
  const before = await load()
  const original = await readFile(join(profile, 'telemetry.json'), 'utf8')
  await application.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, folder)
  await page.getByRole('navigation').getByRole('button', { name: 'Data & portability' }).click()
  await page.getByRole('button', { name: 'Choose batch folder', exact: true }).click()
  await page.getByRole('heading', { name: 'Batch ready to add · 20 files', exact: true }).waitFor()
  assert.equal(await readFile(join(profile, 'telemetry.json'), 'utf8'), original)
  await page.getByRole('button', { name: 'Import batch', exact: true }).click()
  await page
    .getByRole('status')
    .filter({ hasText: 'Batch saved. 21 records imported; 19 identical records skipped.' })
    .waitFor()
  let saved = await load()
  assert.equal(saved.revision, before.revision + 1)
  assert.equal(saved.runs.length, 20)
  assert.equal(saved.slices.length, 1)
  assert.equal(await readFile(join(profile, 'telemetry.backup.json'), 'utf8'), original)
  // Force a real store rejection after preview, using only this isolated QA profile.
  const backupPath = join(profile, 'telemetry.backup.json')
  const liveBeforeFailure = await readFile(join(profile, 'telemetry.json'), 'utf8')
  const backupBeforeFailure = await readFile(backupPath, 'utf8')
  await page.getByRole('button', { name: 'Choose batch folder', exact: true }).click()
  await page.getByRole('heading', { name: 'Batch ready to add · 20 files', exact: true }).waitFor()
  await writeFile(backupPath, 'QA changed backup evidence')
  try {
    await page.getByRole('button', { name: 'Import batch', exact: true }).click()
    await page
      .getByRole('alert')
      .filter({
        hasText:
          'Batch import failed. No records were changed. Select and preview the batch folder again before retrying.'
      })
      .waitFor()
    assert.equal(await page.getByRole('heading', { name: /Batch ready to add/ }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Import batch', exact: true }).count(), 0)
    assert.deepEqual(await load(), saved)
    assert.equal(await readFile(join(profile, 'telemetry.json'), 'utf8'), liveBeforeFailure)
  } finally {
    await writeFile(backupPath, backupBeforeFailure)
  }
  // Verify the main-process token remains consumed even after the failure is removed.
  const failedPreview = await page.evaluate(() => window.pennytel.openBatchImport())
  assert.ok(failedPreview)
  await writeFile(backupPath, 'QA changed backup evidence')
  try {
    const error = await page.evaluate(async (token) => {
      try {
        await window.pennytel.commitBatchImport(token)
        return null
      } catch (error) {
        return error.message
      }
    }, failedPreview.token)
    assert.match(error, /Backup changed outside PennyTel/)
  } finally {
    await writeFile(backupPath, backupBeforeFailure)
  }
  const retryError = await page.evaluate(async (token) => {
    try {
      await window.pennytel.commitBatchImport(token)
      return null
    } catch (error) {
      return error.message
    }
  }, failedPreview.token)
  assert.match(retryError, /Select and preview the batch folder again/)
  assert.deepEqual(await load(), saved)
  assert.equal(await readFile(join(profile, 'telemetry.json'), 'utf8'), liveBeforeFailure)
  // Backup provenance includes ctime: reopening is required after external QA changes.
  await application.close()
  application = undefined
  page = await launch()
  await application.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, folder)
  await page.getByRole('navigation').getByRole('button', { name: 'Data & portability' }).click()
  await page.getByRole('button', { name: 'Choose batch folder', exact: true }).click()
  await page.getByRole('heading', { name: 'Batch ready to add · 20 files', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Import batch', exact: true }).click()
  await page
    .getByRole('status')
    .filter({ hasText: 'Batch saved. 0 records imported; 40 identical records skipped.' })
    .waitFor()
  const retried = await load()
  assert.equal(retried.revision, saved.revision + 1)
  assert.deepEqual(retried.runs, saved.runs)
  assert.equal(await readFile(backupPath, 'utf8'), liveBeforeFailure)
  saved = retried
  await writeFile(join(folder, 'zz-late.pennytel.json'), '{')
  await page.getByRole('button', { name: 'Choose batch folder', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'zz-late.pennytel.json' }).waitFor()
  assert.deepEqual(await load(), saved)
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'telemetry.json'), 'utf8')), saved)
  assert.equal(await readFile(backupPath, 'utf8'), liveBeforeFailure)
  const preferences = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
  )
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  await application.close()
  application = undefined
  page = await launch()
  assert.deepEqual(await load(), saved)
  console.log(
    `PASS: 20 nested artifacts, mixed v1/v2, ignored unrelated files, UI aggregate preview/one-click import, duplicate counts, single revision/backup, failed commit clears UI and preserves data, consumed-token rejection/fresh-preview retry, late malformed rejection, security and restart persistence. Profile: ${profile}`
  )
} finally {
  if (application) await application.close()
}
