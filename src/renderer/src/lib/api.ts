import type { AtomAPI } from '@shared/ipc'

/** Typed access to the preload bridge. The renderer must talk to the main process only through this. */
export const atom: AtomAPI = window.atom
