// Bounded repair regression QA: real Electron/preload/IPC/disk, isolated synthetic profile.
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { copyFile, link, mkdir, mkdtemp, readFile, rename, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

await mkdir(resolve('test-results'), { recursive: true })
const directory = await mkdtemp(resolve('test-results/repair-runtime-'))
const env = { ...process.env, PENNYTEL_DATA_DIR: directory, TZ: 'America/Chicago' }
delete env.ELECTRON_RUN_AS_NODE
let app, page
const errors = []
async function launch() {
  app = await electron.launch({ args: [resolve('out/main/index.js')], env })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
}
const button = (name) => page.getByRole('button', { name, exact: true })
const acceptance = () => page.getByLabel(/^Accepted at/)
const save = async () => {
  await button('Save slice').click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
}
const dataset = async () => JSON.parse(await readFile(join(directory, 'telemetry.json'), 'utf8'))
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
  await page.screenshot({ path: join(directory, 'accept-now.png') })
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

  const paths = ['telemetry.json', 'telemetry.backup.json'].map((name) => join(directory, name))
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
    await symlink(directory, parent, 'dir')
    for (const kind of ['raw', 'comparison']) {
      for (const destination of [
        protectedPath,
        symbolic,
        hard,
        join(parent, index ? 'telemetry.backup.json' : 'telemetry.json')
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
    'PASS: raw/comparison reject direct, symlink, hard-link and parent-directory aliases of live/backup; regular exports and sandbox preserved'
  )

  await app.close()
  // Preserve all QA evidence while creating a backup-only recovery scenario.
  await rename(paths[0], join(directory, 'preserved-live.json'))
  const backupBefore = await readFile(paths[1], 'utf8')
  await launch()
  await page
    .getByRole('alert')
    .filter({ hasText: /Recovery state/ })
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
    .filter({ hasText: /Recovery state/ })
    .waitFor()
  assert.equal(await readFile(paths[1], 'utf8'), backupBefore)
  await page.screenshot({ path: join(directory, 'backup-only.png') })
  await app.close()
  await copyFile(paths[1], join(directory, 'preserved-recovery.json'))
  await copyFile(paths[1], paths[0])
  await launch()
  await page.getByRole('button', { name: /Repair QA acceptance/ }).click()
  await button('Edit slice').click()
  await page.getByLabel('Title', { exact: false }).fill('Recovered QA record')
  await save()
  assert.equal(await readFile(paths[1], 'utf8'), JSON.stringify(JSON.parse(backupBefore), null, 2))
  console.log(
    'PASS: backup-only startup, IPC write refusal, retry preservation, manual recovery and subsequent save'
  )
  assert.deepEqual(errors, [])
  console.log(`Repair QA artifacts: ${directory}`)
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (app) await app.close().catch(() => {})
}
