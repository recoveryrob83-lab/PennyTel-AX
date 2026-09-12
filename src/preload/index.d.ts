import type { PennyTelAPI } from '../shared/types'
declare global {
  interface Window {
    pennytel: PennyTelAPI
  }
}
