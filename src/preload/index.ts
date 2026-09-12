import { contextBridge, ipcRenderer } from 'electron'
import type { PennyTelAPI } from '../shared/types'

const api: PennyTelAPI = {
  load: () => ipcRenderer.invoke('telemetry:load'),
  mutate: (command) => ipcRenderer.invoke('telemetry:mutate', command),
  previewImport: (text) => ipcRenderer.invoke('telemetry:preview', text),
  openImport: () => ipcRenderer.invoke('telemetry:open'),
  exportData: () => ipcRenderer.invoke('telemetry:export')
}
contextBridge.exposeInMainWorld('pennytel', api)
