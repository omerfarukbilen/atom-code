import { create } from 'zustand'

export type SidebarView = 'explorer' | 'search' | 'git' | 'history' | 'skills'
export type PanelTab = 'terminal' | 'problems' | 'output'

export interface LayoutState {
  sidebarVisible: boolean
  panelVisible: boolean
  agentVisible: boolean
  /** Agent panel takes the whole editor area (Cursor-style "agent layout"). */
  agentMaximized: boolean
  sidebarView: SidebarView
  panelTab: PanelTab
  settingsOpen: boolean
  settingsSection: string
  commandPaletteOpen: boolean
  /** Initial text for the command palette: '>' = commands, '' = files, '@' = symbols, ':' = go to line. */
  commandPalettePrefix: string
  aboutOpen: boolean

  toggleSidebar(): void
  togglePanel(): void
  toggleAgent(): void
  setAgentMaximized(v: boolean): void
  showSidebarView(view: SidebarView): void
  showPanel(tab: PanelTab): void
  setPanelVisible(v: boolean): void
  setAgentVisible(v: boolean): void
  openSettings(section?: string): void
  closeSettings(): void
  openCommandPalette(prefix?: string): void
  closeCommandPalette(): void
  setAboutOpen(v: boolean): void
}

const STORAGE_KEY = 'atom.layout.v1'

type Persisted = Pick<LayoutState, 'sidebarVisible' | 'panelVisible' | 'agentVisible' | 'sidebarView' | 'panelTab' | 'agentMaximized'>

function load(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Persisted>
  } catch {
    return {}
  }
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  sidebarVisible: true,
  panelVisible: false,
  agentVisible: true,
  agentMaximized: false,
  sidebarView: 'explorer',
  panelTab: 'terminal',
  settingsOpen: false,
  settingsSection: 'account',
  commandPaletteOpen: false,
  commandPalettePrefix: '>',
  aboutOpen: false,
  ...load(),

  toggleSidebar: () => set({ sidebarVisible: !get().sidebarVisible }),
  togglePanel: () => set({ panelVisible: !get().panelVisible }),
  toggleAgent: () => set({ agentVisible: !get().agentVisible }),
  setAgentMaximized: (v) => set({ agentMaximized: v, agentVisible: v ? true : get().agentVisible }),
  showSidebarView: (view) => {
    const s = get()
    // Clicking the active view's icon collapses the sidebar (VS Code behaviour).
    if (s.sidebarVisible && s.sidebarView === view) set({ sidebarVisible: false })
    else set({ sidebarView: view, sidebarVisible: true })
  },
  showPanel: (tab) => set({ panelTab: tab, panelVisible: true }),
  setPanelVisible: (v) => set({ panelVisible: v }),
  setAgentVisible: (v) => set({ agentVisible: v }),
  openSettings: (section) => set({ settingsOpen: true, settingsSection: section ?? get().settingsSection }),
  closeSettings: () => set({ settingsOpen: false }),
  openCommandPalette: (prefix = '>') => set({ commandPaletteOpen: true, commandPalettePrefix: prefix }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  setAboutOpen: (v) => set({ aboutOpen: v })
}))

useLayoutStore.subscribe((s) => {
  const persisted: Persisted = {
    sidebarVisible: s.sidebarVisible,
    panelVisible: s.panelVisible,
    agentVisible: s.agentVisible,
    agentMaximized: s.agentMaximized,
    sidebarView: s.sidebarView,
    panelTab: s.panelTab
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  } catch {
    /* storage unavailable */
  }
})
