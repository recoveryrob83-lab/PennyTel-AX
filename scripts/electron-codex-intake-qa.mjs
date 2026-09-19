import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { appendFile, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const fixtureId = 'pr1_20260919T120000000Z_11111111111111111111111111111111'
await mkdir(resolve('test-results'), { recursive: true })
const root = await mkdtemp(resolve('test-results/codex-intake-runtime-'))
const repo = join(root, 'repository')
const home = join(root, 'codex-home')
const profile = join(root, 'pennytel-profile')
const now = new Date()
const [year, month, day] = now.toISOString().slice(0, 10).split('-')
const stamp = now.toISOString().slice(0, 19).replaceAll(':', '-')
await mkdir(join(repo, 'pennyos', 'slices'), { recursive: true })
await mkdir(join(repo, '.pennyos', 'runtime', 'receipts'), { recursive: true })
await mkdir(join(home, 'sessions', year, month, day), { recursive: true })
await mkdir(join(home, 'archived_sessions'), { recursive: true })
await mkdir(profile, { recursive: true })
await writeFile(
  join(repo, 'pennyos', 'project.json'),
  JSON.stringify({ projectId: 'pennytel', project: 'PennyTel' })
)
await writeFile(
  join(repo, 'pennyos', 'slices', 'S13.json'),
  JSON.stringify({ sliceId: 'S13', title: 'Synthetic Codex intake QA' })
)
execFileSync('git', ['init', '-q', repo])
await copyFile(
  resolve(`tests/fixtures/codex-receipts/${fixtureId}.json`),
  join(repo, '.pennyos', 'runtime', 'receipts', `${fixtureId}.json`)
)
const rollout = (
  await readFile(resolve('tests/fixtures/codex-rollout-current-0.155.1.jsonl'), 'utf8')
).replaceAll('/synthetic', repo)
const rolloutPath = join(home, 'sessions', year, month, day, `rollout-${stamp}-fixture.jsonl`)
await writeFile(rolloutPath, rollout)
for (let i = 0; i < 218; i++)
  await writeFile(join(home, 'archived_sessions', `rollout-2020-01-01T00-00-00-old-${i}.jsonl`), '')

let application
const env = {
  ...process.env,
  PENNYTEL_DATA_DIR: profile,
  PENNYTEL_REPO_DIR: repo,
  CODEX_HOME: home
}
delete env.ELECTRON_RUN_AS_NODE
async function launch() {
  const packagedBinary = process.env.PENNYTEL_PACKAGED_BINARY
  application = await electron.launch(
    packagedBinary
      ? { executablePath: resolve(packagedBinary), args: [], env }
      : { args: [resolve('out/main/index.js')], env }
  )
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
  const preferences = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
  )
  assert.deepEqual(
    {
      sandbox: preferences.sandbox,
      contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration
    },
    { sandbox: true, contextIsolation: true, nodeIntegration: false }
  )
  const bridge = await page.evaluate(() => Object.keys(window.pennytel).sort())
  assert.ok(
    bridge.includes('discoverCodexRuns') &&
      bridge.includes('importCodexRun') &&
      bridge.includes('createCodexSlice')
  )
  assert.ok(!bridge.some((name) => /filesystem|readfile|sql|rollout/i.test(name)))
  await page.getByRole('navigation').getByRole('button', { name: 'Data & portability' }).click()
  const selector = page.getByLabel('Codex discovery window')
  assert.deepEqual(await selector.locator('option').allTextContents(), [
    'Last 1 day',
    'Last 3 days',
    'Last 5 days'
  ])
  assert.equal(await selector.inputValue(), '1')
  const invalidWindow = await page.evaluate(async () => {
    try {
      await window.pennytel.discoverCodexRuns(2)
      return ''
    } catch (error) {
      return String(error)
    }
  })
  assert.match(invalidWindow, /Invalid Codex discovery window/)
  await selector.selectOption('3')
  await page.getByRole('button', { name: 'Discover Codex runs' }).click()
  await page.getByText('Reviewed Codex window: last 3 days.').waitFor()
  await selector.selectOption('5')
  await page.getByRole('button', { name: 'Discover Codex runs' }).click()
  await page.getByText('Reviewed Codex window: last 5 days.').waitFor()
  await selector.selectOption('1')
  for (const path of ['pennyos/project.json', 'pennyos/slices/S13.json']) {
    const other =
      path === 'pennyos/project.json' ? 'pennyos/slices/S13.json' : 'pennyos/project.json'
    execFileSync('git', ['-C', repo, 'add', '-f', '--', other])
    for (const ignored of [false, true]) {
      await writeFile(join(repo, '.gitignore'), ignored ? `${path}\n` : '')
      await page.getByRole('button', { name: 'Discover Codex runs' }).click()
      await page.getByRole('heading', { name: `${fixtureId} · blocked` }).waitFor()
      await page
        .getByText(/both pennyos\/project.json and the Slice identity must be Git-tracked/)
        .waitFor()
      assert.equal(await page.getByRole('button', { name: 'Create Slice' }).count(), 0)
      const blockedData = await page.evaluate(async () => (await window.pennytel.load()).data)
      assert.equal(blockedData.slices.length, 0)
      assert.equal(blockedData.runs.length, 0)
    }
    execFileSync('git', ['-C', repo, 'rm', '--cached', '--', other])
  }
  execFileSync('git', [
    '-C',
    repo,
    'add',
    '-f',
    '--',
    'pennyos/project.json',
    'pennyos/slices/S13.json'
  ])
  await page.getByRole('button', { name: 'Discover Codex runs' }).click()
  await page.getByText('Reviewed Codex window: last 1 day.').waitFor()
  await page.getByRole('heading', { name: `${fixtureId} · blocked` }).waitFor()
  await page.getByRole('button', { name: 'Create Slice' }).click()
  await page.getByRole('status').filter({ hasText: 'Discover Codex runs again' }).waitFor()
  const parentOnly = await page.evaluate(async () => (await window.pennytel.load()).data)
  assert.deepEqual(parentOnly.slices, [
    { id: 'S13', title: 'Synthetic Codex intake QA', project: 'PennyTel' }
  ])
  assert.equal(parentOnly.runs.length, 0)
  await page.getByRole('button', { name: 'Discover Codex runs' }).click()
  await page.getByRole('heading', { name: `${fixtureId} · ready` }).waitFor()
  await page.getByText(/Unknown: executionEvidence\.sourceLog\.contentHash/).waitFor()
  const before = await page.evaluate(async () => (await window.pennytel.load()).data)
  assert.equal(before.runs.length, 0)
  // Exercise the repaired authority gate in the real main process before the UI import.
  const candidate = await page.evaluate(
    async (id) =>
      (await window.pennytel.discoverCodexRuns(1)).find((item) => item.receiptId === id),
    fixtureId
  )
  const records = rollout.trimEnd().split('\n')
  const duplicate = records.slice(1, 10).join('\n') + '\n'
  await writeFile(rolloutPath, records.slice(0, 10).join('\n') + '\n' + duplicate)
  const rejected = await page.evaluate(async (token) => {
    try {
      await window.pennytel.importCodexRun(token)
      return ''
    } catch (error) {
      return String(error)
    }
  }, candidate.token)
  assert.match(rejected, /Multiple terminal closures/)
  const unchanged = await page.evaluate(async () => (await window.pennytel.load()).data)
  assert.equal(unchanged.revision, before.revision)
  assert.equal(unchanged.runs.length, 0)
  await writeFile(rolloutPath, records.slice(0, 10).join('\n') + '\n')
  await page.getByRole('button', { name: 'Discover Codex runs' }).click()
  await page.getByRole('heading', { name: `${fixtureId} · ready` }).waitFor()
  // A safe resumed suffix changes authority coverage but never measured telemetry.
  await appendFile(rolloutPath, records.slice(10).join('\n') + '\n')
  await page.getByRole('button', { name: 'Import reviewed Run' }).click()
  await page
    .getByRole('status')
    .filter({ hasText: `Codex Run codex_${fixtureId} imported.` })
    .waitFor()
  const imported = await page.evaluate(async () => (await window.pennytel.load()).data)
  assert.equal(imported.revision, before.revision + 1)
  assert.equal(imported.runs.length, 1)
  assert.equal(imported.runs[0].inputTokens, 60)
  assert.equal(imported.runs[0].cachedInputTokens, 40)
  assert.equal(imported.runs[0].reasoningTokens, 4)
  assert.equal(imported.runs[0].verification, 'Passed')
  assert.equal(imported.runs[0].executionEvidence.turnId, 'turn-1')
  assert.ok(!JSON.stringify(imported).includes('PENNYOS_TURN_REPORT_V1'))
  await page.getByRole('navigation').getByRole('button', { name: 'Slice notebook' }).click()
  await page.getByRole('button', { name: /Synthetic Codex intake QA/ }).click()
  await page.getByRole('button', { name: 'Accept Slice' }).click()
  const accepted = await page.evaluate(async () => (await window.pennytel.load()).data)
  assert.equal(accepted.slices[0].disposition, 'Accepted')
  assert.ok(Number.isFinite(Date.parse(accepted.slices[0].acceptedAt)))
  await page.evaluate(async () => {
    let loaded = await window.pennytel.load()
    loaded = await window.pennytel.mutate({
      kind: 'save',
      table: 'slices',
      record: {
        id: 'S13-other',
        title: 'Synthetic Codex intake QA',
        disposition: 'Accepted',
        acceptedAt: new Date().toISOString()
      },
      revision: loaded.data.revision
    })
    await window.pennytel.mutate({
      kind: 'save',
      table: 'runs',
      record: {
        id: 'legacy-run',
        sliceId: 'S13-other',
        runType: 'Implementation',
        role: 'Implementer',
        result: 'Completed'
      },
      revision: loaded.data.revision
    })
  })
  await page.reload()
  await page.getByRole('heading', { name: 'Slice notebook', exact: true }).waitFor()
  await application.close()
  page = await launch()
  const restarted = await page.evaluate(async () => (await window.pennytel.load()).data)
  assert.deepEqual(
    restarted.runs.find((run) => run.id === imported.runs[0].id),
    imported.runs[0]
  )
  assert.equal(restarted.slices[0].disposition, 'Accepted')
  await page.getByRole('navigation').getByRole('button', { name: 'Compare' }).click()
  const comparison = page.getByRole('region', { name: 'Accepted outcome comparison' })
  await comparison.getByText('Slice ID: S13', { exact: true }).waitFor()
  await comparison.getByText('Slice ID: S13-other', { exact: true }).waitFor()
  const compactRow = comparison.getByRole('row').filter({ hasText: 'Slice ID: S13-other' })
  assert.equal(await compactRow.getByRole('cell').count(), 2)
  assert.equal(await compactRow.getByRole('cell').first().getAttribute('colspan'), '6')
  assert.match(await compactRow.innerText(), /No execution evidence attached/)
  assert.equal(await compactRow.getByText(/Repair cost:/).count(), 0)
  const lifecycle = page
    .locator('details')
    .filter({ hasText: 'Inspect lifecycle · Synthetic Codex intake QA · S13-other' })
  await lifecycle.locator('summary').click()
  await lifecycle.getByRole('button', { name: 'Implementation', exact: true }).waitFor()
  await page.screenshot({ path: join(root, 'compare-compaction.png'), fullPage: true })
  await page.getByLabel('Execution evidence coverage').selectOption('None')
  await comparison.getByText('Slice ID: S13-other', { exact: true }).waitFor()
  assert.equal(await comparison.getByText('Slice ID: S13', { exact: true }).count(), 0)
  await page.getByLabel('Execution evidence coverage').selectOption('Complete')
  await comparison.getByText('Slice ID: S13', { exact: true }).waitFor()
  assert.equal(await comparison.getByText('Slice ID: S13-other', { exact: true }).count(), 0)
  await page.getByRole('navigation').getByRole('button', { name: 'Data & portability' }).click()
  await page.getByRole('button', { name: 'Discover Codex runs' }).click()
  await page.getByRole('heading', { name: `${fixtureId} · already imported` }).waitFor()
  console.log(
    'Electron Codex intake QA passed: 1/3/5-day selector and IPC validation, 218 old rollouts excluded, untracked/ignored identity blocked, tracked parent creation, rediscovery, review, duplicate rejection, safe resume, verification import, acceptance, restart, Compare compaction/expansion/coverage, idempotency'
  )
} finally {
  if (application) await application.close()
}
