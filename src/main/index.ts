import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join, resolve } from 'node:path'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { TelemetryStore } from './store'
import type { Mutation } from '../shared/types'
import { comparisonExport, validateComparisonRequest } from '../shared/comparison'
import { version as appVersion } from '../../package.json'

// A dedicated directory keeps local QA separate from the operator's dataset.
if (process.env.PENNYTEL_DATA_DIR) app.setPath('userData', resolve(process.env.PENNYTEL_DATA_DIR))
app.setName('PennyTel')
const locked = app.requestSingleInstanceLock()
if (!locked) app.quit()
else {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.pennyos.pennytel')
    const store = new TelemetryStore(app.getPath('userData'))
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
    handle('telemetry:load', () => store.load())
    handle('telemetry:mutate', (command) => store.mutate(command as Mutation))
    handle('telemetry:preview', (text) => {
      if (typeof text !== 'string') throw new Error('Import must be text.')
      return store.preview(text)
    })
    handle('telemetry:open', async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Import PennyTel records',
        properties: ['openFile'],
        filters: [{ name: 'PennyTel JSON', extensions: ['json'] }]
      })
      if (result.canceled) return null
      if ((await stat(result.filePaths[0])).size > 10_000_000)
        throw new Error('Import exceeds the 10 MB limit.')
      return readFile(result.filePaths[0], 'utf8')
    })
    handle('telemetry:export', async () => {
      const { data } = await store.load()
      return saveExport(
        'Export PennyTel dataset',
        `pennytel-${new Date().toISOString().slice(0, 10)}.json`,
        data
      )
    })
    handle('telemetry:export-comparison', async (request) => {
      validateComparisonRequest(request)
      const { data } = await store.load()
      // Bundle package metadata: direct entry-file launches otherwise report Electron's 0.0.
      const analysis = comparisonExport(data, request, appVersion, new Date().toISOString())
      return saveExport(
        'Export PennyTel comparison (analysis only)',
        `pennytel-comparison-${new Date().toISOString().slice(0, 10)}.json`,
        analysis
      )
    })
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
      if (
        resolve(result.filePath) === store.path ||
        resolve(result.filePath) === join(app.getPath('userData'), 'telemetry.backup.json')
      )
        throw new Error('Choose a path outside the live dataset and its backup.')
      await writeFile(result.filePath, JSON.stringify(contents, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      })
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
