import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join, resolve } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ProductionStore } from './production-store'
import { writeExport } from './export'
import { randomUUID } from 'node:crypto'
import { discoverBatch } from './batch-import'
import { mergeBatchImport } from '../shared/data'
import type { CodexDiscoveryHorizon, ImportSource, Mutation } from '../shared/types'
import { comparisonExport, validateComparisonRequest } from '../shared/comparison'
import { version as appVersion } from '../../package.json'
import { runComparisonPlanOperation } from './comparison-plan'
import { CodexIntake } from './codex-intake'

// A dedicated directory keeps local QA separate from the operator's dataset.
if (process.env.PENNYTEL_DATA_DIR) app.setPath('userData', resolve(process.env.PENNYTEL_DATA_DIR))
app.setName('PennyTel')
const locked = app.requestSingleInstanceLock()
if (!locked) app.quit()
else {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.pennyos.pennytel')
    const store = new ProductionStore(app.getPath('userData'))
    const codexIntake = new CodexIntake(
      resolve(process.env.PENNYTEL_REPO_DIR || process.cwd()),
      store
    )
    let storageClosed = false
    app.on('before-quit', (event) => {
      if (storageClosed) return
      event.preventDefault()
      void store.close().finally(() => {
        storageClosed = true
        app.quit()
      })
    })
    const mainWindow = new BrowserWindow({
      title: 'PennyTel',
      width: 1440,
      height: 960,
      minWidth: 900,
      minHeight: 640,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#10171e',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    const handle = (channel: string, action: (...args: unknown[]) => unknown): void => {
      ipcMain.handle(channel, (event, ...args) => {
        if (
          event.sender !== mainWindow.webContents ||
          event.senderFrame !== mainWindow.webContents.mainFrame
        )
          throw new Error('Untrusted caller.')
        return action(...args)
      })
    }
    let batch: { token: string; sources: ImportSource[]; revision: number } | undefined
    handle('telemetry:discover-codex', (horizon) => {
      if (horizon !== 1 && horizon !== 3 && horizon !== 5)
        throw new Error('Invalid Codex discovery window. Choose 1, 3, or 5 days.')
      return codexIntake.discover(horizon as CodexDiscoveryHorizon)
    })
    handle('telemetry:create-codex-slice', (token) => {
      if (typeof token !== 'string') throw new Error('Invalid Codex Slice token.')
      return codexIntake.createSlice(token)
    })
    handle('telemetry:import-codex', (token) => {
      if (typeof token !== 'string') throw new Error('Invalid Codex import token.')
      return codexIntake.commit(token)
    })
    handle('telemetry:open-batch', async () => {
      batch = undefined
      const selected = await dialog.showOpenDialog(mainWindow, {
        title: 'Import PennyTel folder',
        properties: ['openDirectory']
      })
      if (selected.canceled || !selected.filePaths[0]) return null
      const sources = await discoverBatch(selected.filePaths[0])
      if (!sources.length) throw new Error('No .pennytel.json files found in the selected folder.')
      const { data } = await store.load()
      const { preview } = mergeBatchImport(data, sources)
      batch = { token: randomUUID(), sources, revision: data.revision }
      return { ...preview, token: batch.token, revision: data.revision, fileCount: sources.length }
    })
    handle('telemetry:commit-batch', async (token) => {
      if (!batch || token !== batch.token)
        throw new Error('Select and preview the batch folder again.')
      const selected = batch
      batch = undefined
      return store.mutate({
        kind: 'batch-import',
        sources: selected.sources,
        revision: selected.revision
      })
    })
    handle('telemetry:load', () => store.initializeRegistry())
    handle('telemetry:mutate', (command) => store.mutate(command as Mutation))
    handle('telemetry:preview', (text) => {
      if (typeof text !== 'string') throw new Error('Import must be text.')
      return store.preview(text)
    })
    handle('telemetry:open', async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Open PennyTel JSON',
        properties: ['openFile'],
        filters: [{ name: 'PennyTel JSON', extensions: ['json'] }]
      })
      if (result.canceled) return null
      if ((await stat(result.filePaths[0])).size > 10_000_000)
        throw new Error('Import exceeds the 10 MB limit.')
      return readFile(result.filePaths[0], 'utf8')
    })
    handle('telemetry:export', async () => {
      const { data } = await store.initializeRegistry()
      return saveExport(
        'Export PennyTel dataset',
        `pennytel-${new Date().toISOString().slice(0, 10)}.json`,
        data
      )
    })
    handle('telemetry:export-comparison', async (request) => {
      validateComparisonRequest(request)
      const { data } = await store.initializeRegistry()
      // Bundle package metadata: direct entry-file launches otherwise report Electron's 0.0.
      const analysis = comparisonExport(data, request, appVersion, new Date().toISOString())
      return saveExport(
        'Export PennyTel comparison (analysis only)',
        `pennytel-comparison-${new Date().toISOString().slice(0, 10)}.json`,
        analysis
      )
    })
    handle('telemetry:run-comparison-plan', () =>
      runComparisonPlanOperation(
        {
          choosePlan: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              title: 'Run PennyTel comparison plan',
              properties: ['openFile'],
              filters: [{ name: 'PennyTel comparison plan', extensions: ['json'] }]
            })
            if (result.canceled || !result.filePaths[0]) return null
            if ((await stat(result.filePaths[0])).size > 10_000_000)
              throw new Error('Comparison plan exceeds the 10 MB limit.')
            return readFile(result.filePaths[0], 'utf8')
          },
          loadDataset: async () => (await store.load()).data,
          saveResults: (results, defaultPath) =>
            saveExport('Export PennyTel comparison-plan results', defaultPath, results)
        },
        appVersion
      )
    )
    async function saveExport(
      title: string,
      defaultPath: string,
      contents: unknown
    ): Promise<string | null> {
      const result = await dialog.showSaveDialog(mainWindow, {
        title,
        defaultPath,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return null
      await writeExport(result.filePath, contents, store.protectedPaths, store.protectedDirectories)
      return result.filePath
    }
    mainWindow.on('ready-to-show', () => mainWindow.show())
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
    mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false)
    )
    optimizer.watchWindowShortcuts(mainWindow)
    if (is.dev && process.env.ELECTRON_RENDERER_URL)
      mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    app.on('second-instance', () => {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    })
  })
  app.on('window-all-closed', () => app.quit())
}
