import { useEffect, useState } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import { basename } from '@shared/paths'
import type { MenuCommand, WorkspaceInfo } from '@shared/types'
import { LoginDialog } from './components/auth/LoginDialog'
import { CommandPalette } from './components/palette/CommandPalette'
import { SettingsView } from './components/settings/SettingsView'
import { AtomLogo, Button, ConfirmHost, Modal, Toaster } from './components/ui'
import { AboutDialog } from './components/workbench/AboutDialog'
import { registerWorkbenchCommands } from './components/workbench/commands'
import { Workbench } from './components/workbench/Workbench'
import { atom } from './lib/api'
import { installIdeBridge } from './lib/ide-bridge'
import { executeCommand, installKeybindings } from './stores/commands'
import { useEditorStore } from './stores/editor'
import { useLayoutStore } from './stores/layout'
import { useSettingsStore } from './stores/settings'
import { errorMessage, toast } from './stores/toast'
import { useWorkspaceStore } from './stores/workspace'

/** The last workspace is restored once per page load (StrictMode runs effects twice in development). */
let restoredWorkspace = false

export default function App() {
  const loaded = useSettingsStore((s) => s.loaded)
  const settingsOpen = useLayoutStore((s) => s.settingsOpen)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 1. Settings first — theme, fonts and the last workspace depend on them.
  const loadSettings = (): void => {
    setLoadError(null)
    useSettingsStore
      .getState()
      .load()
      .catch((err: unknown) => setLoadError(errorMessage(err)))
  }
  useEffect(loadSettings, [])

  // 2. Wire the workbench once settings are available.
  useEffect(() => {
    if (!loaded) return
    const disposers = [
      installKeybindings(),
      registerWorkbenchCommands(),
      // Lets the agent's atom-ide tools read open editors, selection, diagnostics and the terminal.
      installIdeBridge(),
      atom.app.onMenuCommand((command: MenuCommand) => {
        void executeCommand(command).then((handled) => {
          if (!handled) console.warn(`[menu] no handler for ${command}`)
        })
      })
    ]
    if (!restoredWorkspace) {
      restoredWorkspace = true
      const last = useSettingsStore.getState().settings.lastWorkspace
      if (last && !useWorkspaceStore.getState().workspace) void useWorkspaceStore.getState().openWorkspace(last, { silent: true })
    }
    return () => disposers.forEach((d) => d())
  }, [loaded])

  useWindowTitle()

  if (!loaded) return <Splash error={loadError} onRetry={loadSettings} />

  return (
    <>
      <Workbench />
      {settingsOpen && <SettingsView />}
      <CommandPalette />
      <AboutDialog />
      <LoginDialog />
      <CloseGuard />
      <ConfirmHost />
      <Toaster />
    </>
  )
}

function useWindowTitle(): void {
  useEffect(() => {
    const apply = (ws: WorkspaceInfo | null): void => {
      const title = ws ? `${ws.name} — ATOM Code` : 'ATOM Code'
      document.title = title
      void atom.app.setTitle(title).catch(() => undefined)
    }
    apply(useWorkspaceStore.getState().workspace)
    return useWorkspaceStore.subscribe((s, prev) => {
      if (s.workspace?.path !== prev.workspace?.path || s.workspace?.name !== prev.workspace?.name) apply(s.workspace)
    })
  }, [])
}

function Splash({ error, onRetry }: { error: string | null; onRetry(): void }) {
  return (
    <div className="drag flex h-full w-full flex-col items-center justify-center gap-4 bg-app">
      <div className="flex flex-col items-center gap-3 animate-fade-in" style={{ animationDelay: '120ms' }}>
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-accent-soft blur-2xl" />
          <AtomLogo size={56} animated={!error} className="relative" />
        </div>
        <div className="atom-gradient-text text-[18px] font-semibold tracking-tight">ATOM Code</div>
        {error ? (
          <div className="no-drag flex max-w-sm flex-col items-center gap-3 text-center">
            <div className="text-[12.5px] text-danger selectable">Could not load settings: {error}</div>
            <Button size="sm" icon={<RefreshCw size={13} />} onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="text-[12px] text-subtle animate-atom-pulse">Starting…</div>
        )}
      </div>
    </div>
  )
}

/**
 * Answers the main process' "may I close?" question. With unsaved editors the user chooses between
 * Save All, Don't Save and Cancel.
 */
function CloseGuard() {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const tabs = useEditorStore((s) => s.tabs)
  const dirtyTabs = open ? tabs.filter((t) => t.dirty) : []

  useEffect(
    () =>
      atom.app.onBeforeClose(() => {
        if (useEditorStore.getState().hasDirtyTabs()) setOpen(true)
        else void atom.app.confirmClose(true)
      }),
    []
  )

  const answer = (allow: boolean): void => {
    setOpen(false)
    void atom.app.confirmClose(allow)
  }

  const saveAll = async (): Promise<void> => {
    setSaving(true)
    try {
      await useEditorStore.getState().saveAll()
      if (useEditorStore.getState().hasDirtyTabs()) {
        toast.error('Some files could not be saved', 'Review the unsaved editors before closing.')
        answer(false)
        return
      }
      answer(true)
    } catch (err) {
      toast.error('Save failed', errorMessage(err))
      answer(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => answer(false)}
      title="Save changes before closing?"
      description="Your changes will be lost if you don't save them."
      width="max-w-md"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => answer(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="outline" onClick={() => answer(true)}>
            Don&apos;t Save
          </Button>
          <Button size="sm" variant="primary" autoFocus icon={<Save size={13} />} loading={saving} onClick={() => void saveAll()}>
            Save All
          </Button>
        </>
      }
    >
      <ul className="max-h-48 space-y-0.5 overflow-y-auto px-5 py-3">
        {dirtyTabs.map((t) => (
          <li key={t.id} className="flex items-center gap-2 text-[12.5px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg/70" />
            <span className="text-fg">{basename(t.path)}</span>
            <span className="min-w-0 truncate text-[11.5px] text-subtle">{t.path}</span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
