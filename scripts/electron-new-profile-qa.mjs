// Registry startup is now the first guarded write. The pre-seed late-state race is
// additionally covered by store tests; this exercises external changes after seeding.
// Exact late-state regression through real Electron, preload, IPC, UI, and disk.
import { _electron as electron } from 'playwright'
import { captureElectron } from './electron-qa-capture.mjs'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import { canonicalDataset } from './canonical-qa.mjs'
import { join, resolve } from 'node:path'

await mkdir(resolve('test-results'), { recursive: true })
const directory = await mkdtemp(resolve('test-results/new-profile-runtime-'))
const env = { ...process.env, PENNYTEL_DATA_DIR: directory }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      resolve('out/main/index.js')
    ],
    env
  })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    // Keep animation-frame actionability checks running when another desktop app gains focus.
    // This is confined to the QA window; production preferences and security stay unchanged.
    window.webContents.setBackgroundThrottling(false)
    window.show()
    window.focus()
  })
  await page.bringToFront()
  await page.getByRole('button', { name: '+ New slice', exact: true }).waitFor()
  const initial = await page.evaluate(() => window.pennytel.load())
  assert.equal(initial.data.revision, 1)
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
        revision: 1,
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
  assert.match(observed.error, /changed outside PennyTel/)
  assert.ok(observed.liveUnchanged && observed.backupUnchanged && observed.recoverySurvives)
  await page.getByRole('button', { name: '+ New slice', exact: true }).click()
  await page.getByLabel('Title', { exact: false }).fill('Must not save')
  await page.getByRole('button', { name: 'Save slice', exact: true }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: /changed outside PennyTel/ })
    .waitFor()
  assert.ok(await page.getByRole('dialog').isVisible())
  assert.equal((await canonicalDataset(directory)).revision, 1)
  assert.equal(await readFile(live, 'utf8'), liveBytes)
  assert.equal(await readFile(backup, 'utf8'), backupBytes)
  await captureElectron(app, page, { path: join(directory, 'rejected-save.png') })
  await app.close()
  // Stray legacy files cannot be promoted after canonical cutover. Preserve the
  // external evidence elsewhere while closed, then reopen canonical authority.
  await rename(live, join(directory, 'preserved-stray-live.json'))
  await rename(backup, join(directory, 'preserved-stray-backup.json'))
  app = await electron.launch({
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      resolve('out/main/index.js')
    ],
    env
  })
  const restoredPage = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    // Keep animation-frame actionability checks running when another desktop app gains focus.
    // This is confined to the QA window; production preferences and security stay unchanged.
    window.webContents.setBackgroundThrottling(false)
    window.show()
    window.focus()
  })
  await restoredPage.bringToFront()
  await restoredPage.getByRole('button', { name: '+ New slice', exact: true }).waitFor()
  const saved = await restoredPage.evaluate(() =>
    window.pennytel.mutate({
      kind: 'save',
      table: 'slices',
      revision: 1,
      record: { id: 'after-restore', title: 'After restoration' }
    })
  )
  assert.equal(saved.data.revision, 2)
  assert.ok(!saved.data.slices.some((slice) => slice.id === 'recovery-only'))
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, 'preserved-stray-backup.json'), 'utf8')),
    JSON.parse(backupBytes)
  )
  await assert.rejects(readFile(live), { code: 'ENOENT' })
  await assert.rejects(readFile(backup), { code: 'ENOENT' })
  console.log(
    `PASS: IPC rejection, UI error without false success, byte preservation, recovery survival, and restored restart. Artifacts: ${directory}`
  )
} finally {
  if (app) await app.close().catch(() => {})
}
