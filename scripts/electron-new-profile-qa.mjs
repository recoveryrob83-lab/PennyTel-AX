// Exact late-state regression through real Electron, preload, IPC, UI, and disk.
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

await mkdir(resolve('test-results'), { recursive: true })
const directory = await mkdtemp(resolve('test-results/new-profile-runtime-'))
const env = { ...process.env, PENNYTEL_DATA_DIR: directory }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ args: [resolve('out/main/index.js')], env })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '+ New slice', exact: true }).waitFor()
  const initial = await page.evaluate(() => window.pennytel.load())
  assert.equal(initial.data.revision, 0)
  assert.deepEqual(initial.data.slices, [])
  const live = join(directory, 'telemetry.json')
  const backup = join(directory, 'telemetry.backup.json')
  const liveBytes = JSON.stringify(initial.data, null, 2) + '\n'
  const backupBytes =
    JSON.stringify({
      ...initial.data,
      slices: [{ id: 'recovery-only', title: 'Recovery-only record' }]
    }) + '\n'
  await writeFile(live, liveBytes)
  await writeFile(backup, backupBytes)
  const outcome = await page.evaluate(async () => {
    try {
      await window.pennytel.mutate({
        kind: 'save',
        table: 'slices',
        revision: 0,
        record: { id: 'unexpected', title: 'Must not save' }
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  const observed = {
    ...outcome,
    liveUnchanged: (await readFile(live, 'utf8')) === liveBytes,
    backupUnchanged: (await readFile(backup, 'utf8')) === backupBytes,
    recoverySurvives: JSON.parse(await readFile(backup, 'utf8')).slices.some(
      (slice) => slice.id === 'recovery-only'
    )
  }
  console.log(JSON.stringify(observed, null, 2))
  assert.equal(observed.success, false)
  assert.match(observed.error, /Storage state changed externally/)
  assert.ok(observed.liveUnchanged && observed.backupUnchanged && observed.recoverySurvives)
  await page.getByRole('button', { name: '+ New slice', exact: true }).click()
  await page.getByLabel('Title', { exact: false }).fill('Must not save')
  await page.getByRole('button', { name: 'Save slice', exact: true }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: /Storage state changed externally/ })
    .waitFor()
  assert.ok(await page.getByRole('dialog').isVisible())
  assert.equal((await page.evaluate(() => window.pennytel.load())).data.revision, 0)
  assert.equal(await readFile(live, 'utf8'), liveBytes)
  assert.equal(await readFile(backup, 'utf8'), backupBytes)
  await page.screenshot({ path: join(directory, 'rejected-save.png') })
  await app.close()
  // Operator restores recovery data while the application is closed.
  await copyFile(backup, live)
  app = await electron.launch({ args: [resolve('out/main/index.js')], env })
  const restoredPage = await app.firstWindow()
  await restoredPage.getByRole('button', { name: '+ New slice', exact: true }).waitFor()
  const saved = await restoredPage.evaluate(() =>
    window.pennytel.mutate({
      kind: 'save',
      table: 'slices',
      revision: 0,
      record: { id: 'after-restore', title: 'After restoration' }
    })
  )
  assert.equal(saved.data.revision, 1)
  assert.ok(saved.data.slices.some((slice) => slice.id === 'recovery-only'))
  assert.deepEqual(JSON.parse(await readFile(backup, 'utf8')), JSON.parse(backupBytes))
  console.log(
    `PASS: IPC rejection, UI error without false success, byte preservation, recovery survival, and restored restart. Artifacts: ${directory}`
  )
} finally {
  if (app) await app.close().catch(() => {})
}
