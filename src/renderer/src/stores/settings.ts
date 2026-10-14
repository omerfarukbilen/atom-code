import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { AppSettings, DeepPartial } from '@shared/types'
import { atom } from '../lib/api'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load(): Promise<void>
  update(patch: DeepPartial<AppSettings>): Promise<void>
  reset(): Promise<void>
}

function applyToDocument(s: AppSettings): void {
  const root = document.documentElement
  root.dataset.theme = s.theme
  root.style.setProperty('--ui-font-size', `${s.uiFontSize}px`)
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const settings = await atom.settings.get()
    applyToDocument(settings)
    set({ settings, loaded: true })
  },
  update: async (patch) => {
    const settings = await atom.settings.update(patch)
    applyToDocument(settings)
    set({ settings })
  },
  reset: async () => {
    const settings = await atom.settings.reset()
    applyToDocument(settings)
    set({ settings })
  }
}))

atom.settings.onChange((settings) => {
  applyToDocument(settings)
  useSettingsStore.setState({ settings, loaded: true })
})

/** Convenience selector hook for a slice of settings. */
export function useSetting<T>(selector: (s: AppSettings) => T): T {
  return useSettingsStore((st) => selector(st.settings))
}
