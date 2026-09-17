import { contextBridge, ipcRenderer } from 'electron'
import type { PennyTelAPI } from '../shared/types'

const api: PennyTelAPI = {
  openBatchImport: () => ipcRenderer.invoke('telemetry:open-batch'),
  commitBatchImport: (token) => ipcRenderer.invoke('telemetry:commit-batch', token),
  load: () => ipcRenderer.invoke('telemetry:load'),
  mutate: (command) => ipcRenderer.invoke('telemetry:mutate', command),
  previewImport: (text) => ipcRenderer.invoke('telemetry:preview', text),
  openImport: () => ipcRenderer.invoke('telemetry:open'),
  exportData: () => ipcRenderer.invoke('telemetry:export'),
  exportComparison: (request) => ipcRenderer.invoke('telemetry:export-comparison', request),
  runComparisonPlan: () => ipcRenderer.invoke('telemetry:run-comparison-plan')
}
contextBridge.exposeInMainWorld('pennytel', api)
