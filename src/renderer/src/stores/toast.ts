import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error' | 'warning'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  detail?: string
  action?: { label: string; run: () => void }
}

interface ToastState {
  toasts: ToastItem[]
  push(t: Omit<ToastItem, 'id'>, durationMs?: number): number
  dismiss(id: number): void
}

let nextId = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t, durationMs = t.kind === 'error' ? 7000 : 3500) => {
    const id = nextId++
    set({ toasts: [...get().toasts.slice(-4), { ...t, id }] })
    if (durationMs > 0) setTimeout(() => get().dismiss(id), durationMs)
    return id
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

/** Fire-and-forget notifications: toast.success('Saved'), toast.error('Failed', err.message). */
export const toast = {
  info: (message: string, detail?: string) => useToastStore.getState().push({ kind: 'info', message, detail }),
  success: (message: string, detail?: string) => useToastStore.getState().push({ kind: 'success', message, detail }),
  warning: (message: string, detail?: string) => useToastStore.getState().push({ kind: 'warning', message, detail }),
  error: (message: string, detail?: string) => useToastStore.getState().push({ kind: 'error', message, detail }),
  show: (t: Omit<ToastItem, 'id'>, durationMs?: number) => useToastStore.getState().push(t, durationMs)
}

/** Extract a readable message from an unknown error (strips Electron's "Error invoking remote method" prefix). */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
