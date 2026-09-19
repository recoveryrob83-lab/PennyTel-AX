// Bounded repair regression QA: real Electron/preload/IPC/disk, isolated synthetic profile.
import { _electron as electron } from 'playwright'
import { captureElectron } from './electron-qa-capture.mjs'
import assert from 'node:assert/strict'
import { copyFile, link, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { canonicalDataset } from './canonical-qa.mjs'
import { join, resolve } from 'node:path'

await mkdir(resolve('test-results'), { recursive: true })
const directory = await mkdtemp(resolve('test-results/repair-runtime-'))
const env = { ...process.env, PENNYTEL_DATA_DIR: directory, TZ: 'America/Chicago' }
delete env.ELECTRON_RUN_AS_NODE
let app, page
const errors = []
async function launch() {
  app = await electron.launch({
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      resolve('out/main/index.js')
    ],
    env
  })
  page = await app.firstWindow()
  // Foreground the real QA window before Playwright waits for actionable controls.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    // Keep animation-frame actionability checks running when another desktop app gains focus.
    // This is confined to the QA window; production preferences and security stay unchanged.
    window.webContents.setBackgroundThrottling(false)
    window.show()
    window.focus()
  })
  await page.bringToFront()
  page.on('pageerror', (error) => errors.push(error.message))
}
const button = (name) => page.getByRole('button', { name, exact: true })
const acceptance = () => page.getByLabel(/^Accepted at/)
const save = async () => {
  await button('Save slice').click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
}
const dataset = async () => canonicalDataset(env.PENNYTEL_DATA_DIR)
try {
  await launch()
  await button('+ New slice').click()
  await page.getByLabel('Title', { exact: false }).fill('Repair QA acceptance')
  await page.getByLabel('Record ID', { exact: false }).fill('repair-qa')
  assert.equal(await acceptance().getAttribute('type'), 'datetime-local')
  await page.getByText(/Local timezone: America\/Chicago/).waitFor()
  const before = Date.now()
  await button('Accept now').click()
  assert.equal(await page.getByLabel('Disposition', { exact: true }).inputValue(), 'Accepted')
  await captureElectron(app, page, { path: join(directory, 'accept-now.png') })
  await save()
  const stamped = (await dataset()).slices[0]
  assert.ok(
    Date.parse(stamped.acceptedAt) >= before && Date.parse(stamped.acceptedAt) <= Date.now()
  )
  assert.match(stamped.acceptedAt, /Z$/)
  assert.equal(stamped.qualityGrade, undefined)
  assert.equal(stamped.preferredCandidate, undefined)
  await button('Edit slice').click()
  await page.getByLabel('Disposition', { exact: true }).selectOption('In progress')
  assert.ok(await button('Accept now').isDisabled())
  await save()
  assert.equal((await dataset()).slices[0].acceptedAt, stamped.acceptedAt)
  await app.close()
  await launch()
  await page.getByRole('button', { name: /Repair QA acceptance/ }).click()
  await button('Edit slice').click()
  assert.ok(await button('Accept now').isDisabled())
  await button('Use exact timestamp (ISO with timezone)').click()
  assert.equal(await acceptance().inputValue(), stamped.acceptedAt)
  await button('Use local date/time').click()
  await acceptance().fill('2026-09-11T15:30:12.123')
  await save()
  assert.equal((await dataset()).slices[0].acceptedAt, '2026-09-11T20:30:12.123Z')
  await button('Edit slice').click()
  await acceptance().fill('2026-01-11T15:30')
  await save()
  assert.equal((await dataset()).slices[0].acceptedAt, '2026-01-11T21:30:00.000Z')
  for (const [local, message] of [
    ['2026-03-08T02:30', /does not exist/],
    ['2026-11-01T01:30', /occurs twice/]
  ]) {
    await button('Edit slice').click()
    await acceptance().fill('')
    await acceptance().fill(local)
    await page.getByRole('alert').filter({ hasText: message }).waitFor()
    await button('Save slice').click()
    await page
      .getByRole('alert')
      .filter({ hasText: /including timezone/ })
      .waitFor()
    await button('Use exact timestamp (ISO with timezone)').click()
    await acceptance().fill('2026-11-01T01:30:00-06:00')
    await save()
    assert.equal((await dataset()).slices[0].acceptedAt, '2026-11-01T01:30:00-06:00')
  }
  await button('Edit slice').click()
  await button('Clear acceptance time').click()
  assert.ok(await button('Accept now').isEnabled())
  await page.getByLabel('Product quality grade (1–5)', { exact: true }).selectOption('4')
  await page.getByLabel('Preferred candidate / model', { exact: true }).fill('QA candidate')
  await button('Accept now').click()
  await save()
  assert.equal((await dataset()).slices[0].qualityGrade, 4)
  assert.equal((await dataset()).slices[0].preferredCandidate, 'QA candidate')
  console.log(
    'PASS: local summer/winter editing, DST gap/overlap rejection, exact correction, Accept now, explicit clearing, history/judgment preservation and restart'
  )

  const canonicalRoot = join(directory, 'canonical-artifact-store')
  const paths = [join(canonicalRoot, 'artifact-dataset.json')]
  const originals = await Promise.all(paths.map((path) => readFile(path, 'utf8')))
  async function exportTo(filePath, kind) {
    await app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination })
    }, filePath)
    return page.evaluate(async (kind) => {
      try {
        const api = window.pennytel
        return {
          path:
            kind === 'raw'
              ? await api.exportData()
              : await api.exportComparison({
                  revision: (await api.load()).data.revision,
                  context: { filters: {}, groupBy: 'model', sort: 'label' }
                })
        }
      } catch (error) {
        return { error: error.message }
      }
    }, kind)
  }
  for (const [index, protectedPath] of paths.entries()) {
    const symbolic = join(directory, `symbolic-${index}.json`)
    const hard = join(directory, `hard-${index}.json`)
    const parent = join(directory, `parent-${index}`)
    await symlink(protectedPath, symbolic)
    await link(protectedPath, hard)
    await symlink(canonicalRoot, parent, 'dir')
    for (const kind of ['raw', 'comparison']) {
      for (const destination of [
        protectedPath,
        symbolic,
        hard,
        join(parent, 'artifact-dataset.json'),
        join(directory, 'telemetry.json'),
        join(directory, 'pennytel-projection.sqlite'),
        join(directory, 'pennytel-projection.sqlite-wal'),
        join(canonicalRoot, 'transaction-pending.json')
      ]) {
        assert.ok((await exportTo(destination, kind)).error, `${kind}: must reject ${destination}`)
        assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, 'utf8'))), originals)
      }
    }
  }
  for (const kind of ['raw', 'comparison']) {
    const destination = join(directory, `${kind}-export.json`)
    assert.equal((await exportTo(destination, kind)).path, destination)
    assert.equal((await exportTo(destination, kind)).path, destination)
    const exported = JSON.parse(await readFile(destination, 'utf8'))
    if (kind === 'raw') assert.deepEqual(exported, await dataset())
    else assert.equal(exported.kind, 'pennytel-comparison')
  }
  const security = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    return {
      sandbox: prefs.sandbox,
      contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration
    }
  })
  assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false })
  console.log(
    'PASS: raw/comparison reject canonical aliases, projection, pending and retired live paths; regular exports and sandbox preserved'
  )

  const backupBefore = JSON.stringify(await dataset(), null, 2)
  await app.close()
  // Backup-only legacy recovery must be tested before canonical cutover.
  const recoveryDirectory = await mkdtemp(join(directory, 'legacy-recovery-'))
  const recoveryBackup = join(recoveryDirectory, 'telemetry.backup.json')
  await writeFile(recoveryBackup, backupBefore)
  env.PENNYTEL_DATA_DIR = recoveryDirectory
  await launch()
  await page
    .getByRole('alert')
    .filter({ hasText: /Backup-only legacy recovery state/ })
    .waitFor()
  assert.equal(await button('+ New slice').count(), 0)
  const rejection = await page.evaluate(async () => {
    try {
      await window.pennytel.mutate({
        kind: 'save',
        table: 'slices',
        revision: 0,
        record: { id: 'bad', title: 'Must not save' }
      })
      return false
    } catch {
      return true
    }
  })
  assert.ok(rejection)
  await button('Retry load').click()
  await page
    .getByRole('alert')
    .filter({ hasText: /Backup-only legacy recovery state/ })
    .waitFor()
  assert.equal(await readFile(recoveryBackup, 'utf8'), backupBefore)
  await captureElectron(app, page, { path: join(directory, 'backup-only.png') })
  await app.close()
  await copyFile(recoveryBackup, join(directory, 'preserved-recovery.json'))
  await copyFile(recoveryBackup, join(recoveryDirectory, 'telemetry.json'))
  await launch()
  await page.getByRole('button', { name: /Repair QA acceptance/ }).click()
  await button('Edit slice').click()
  await page.getByLabel('Title', { exact: false }).fill('Recovered QA record')
  await save()
  assert.equal(
    await readFile(join(recoveryDirectory, 'telemetry.backup.legacy-archive.json'), 'utf8'),
    backupBefore
  )
  console.log(
    'PASS: backup-only startup, IPC write refusal, retry preservation, manual recovery and subsequent save'
  )
  assert.deepEqual(errors, [])
  console.log(`Repair QA artifacts: ${directory}`)
} catch (error) {
  if (page && !page.isClosed())
    await captureElectron(app, page, { path: join(directory, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (app) await app.close().catch(() => {})
}
