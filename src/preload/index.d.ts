import type { AtomAPI } from '../shared/ipc'

declare global {
  interface Window {
    atom: AtomAPI
  }
}

export {}
