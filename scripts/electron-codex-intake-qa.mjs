import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const fixtureId = 'pr1_20260919T120000000Z_11111111111111111111111111111111'
await mkdir(resolve('test-results'), { recursive: true })
const root = await mkdtemp(resolve('test-results/codex-intake-runtime-'))
const repo = join(root, 'repository')
const home = join(root, 'codex-home')
const profile = join(root, 'pennytel-profile')
await mkdir(join(repo, 'pennyos', 'slices'), { recursive: true })
await mkdir(join(repo, '.pennyos', 'runtime', 'receipts'), { recursive: true })
await mkdir(join(home, 'sessions', '2026', '09', '19'), { recursive: true })
await mkdir(profile, { recursive: true })
await writeFile(
  join(repo, 'pennyos', 'project.json'),
  JSON.stringify({ projectId: 'pennytel', project: 'PennyTel' })
)
await writeFile(join(repo, 'pennyos', 'slices', 'S13.json'), JSON.stringify({ sliceId: 'S13' }))
await copyFile(
  resolve(`tests/fixtures/codex-receipts/${fixtureId}.json`),
  join(repo, '.pennyos', 'runtime', 'receipts', `${fixtureId}.json`)
)
const rollout = (
  await readFile(resolve('tests/fixtures/codex-rollout-current-0.155.1.jsonl'), 'utf8')
).replaceAll('/synthetic', repo)
await writeFile(
  join(home, 'sessions', '2026', '09', '19', 'rollout-2026-09-19T12-00-00-fixture.jsonl'),
  rollout
)

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
  assert.ok(bridge.includes('discoverCodexRuns') && bridge.includes('importCodexRun'))
  assert.ok(!bridge.some((name) => /filesystem|readfile|sql|rollout/i.test(name)))
  await page.evaluate(async () => {
    const loaded = await window.pennytel.load()
    await window.pennytel.mutate({
      kind: 'save',
      table: 'slices',
      record: { id: 'S13', title: 'Synthetic Codex intake QA' },
      revision: loaded.data.revision
    })
  })
  await page.reload()
  await page.getByRole('heading', { name: 'Slice notebook', exact: true }).waitFor()
  await page.getByRole('navigation').getByRole('button', { name: 'Data & portability' }).click()
  await page.getByRole('button', { name: 'Discover Codex runs' }).click()
  await page.getByRole('heading', { name: `${fixtureId} · ready` }).waitFor()
  await page.getByText(/Unknown: executionEvidence\.sourceLog\.contentHash/).waitFor()
  const before = await page.evaluate(async () => (await window.pennytel.load()).data)
  assert.equal(before.runs.length, 0)
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
  assert.equal(imported.runs[0].executionEvidence.turnId, 'turn-1')
  assert.ok(!JSON.stringify(imported).includes('PENNYOS_TURN_REPORT_V1'))
  await application.close()
  page = await launch()
  const restarted = await page.evaluate(async () => (await window.pennytel.load()).data)
  assert.deepEqual(restarted.runs, imported.runs)
  await page.getByRole('navigation').getByRole('button', { name: 'Data & portability' }).click()
  await page.getByRole('button', { name: 'Discover Codex runs' }).click()
  await page.getByRole('heading', { name: `${fixtureId} · already imported` }).waitFor()
  console.log('Electron Codex intake QA passed: discover, review, import, restart, idempotency')
} finally {
  if (application) await application.close()
}
