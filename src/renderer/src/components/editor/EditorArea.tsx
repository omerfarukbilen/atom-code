import { useEffect, useRef, useState, type DragEvent } from 'react'
import { FileDown } from 'lucide-react'
import { cn } from '../../lib/cn'
import { getActiveCodeEditor, samePath, useEditorStore } from '../../stores/editor'
import { Breadcrumbs } from './Breadcrumbs'
import { registerEditorCommands } from './commands'
import { DiffEditor } from './DiffEditor'
import { EditorDialogs } from './EditorDialogs'
import { EditorTabs } from './EditorTabs'
import { ImagePreview } from './ImagePreview'
import { MonacoEditor } from './MonacoEditor'
import { WelcomePage } from './WelcomePage'

/** Drag type used by the Explorer for file entries. */
const EXPLORER_MIME = 'application/x-atom-path'

/**
 * The editor column: tab strip, breadcrumbs and the active editor (code, diff, image or welcome page).
 * The code editor stays mounted while other tab kinds are shown so switching back is instant.
 */
export function EditorArea() {
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const active = tabs.find((t) => t.id === activeTabId) ?? null
  const lastFilePath = useRef<string | null>(null)
  const [dropping, setDropping] = useState(false)

  // App registers these at boot; registering here too (idempotent) keeps ⌘S & co. working if the editor
  // area is ever mounted on its own.
  useEffect(() => {
    registerEditorCommands()
  }, [])

  // The code editor stays mounted (invisible) behind diff/image/welcome tabs. If it still holds keyboard
  // focus when another kind of tab becomes active (e.g. Ctrl+Tab), typing would silently edit the hidden file.
  const activeKind = active?.kind
  useEffect(() => {
    if (activeKind === 'file') return
    const el = document.activeElement
    if (el instanceof HTMLElement && getActiveCodeEditor()?.hasWidgetFocus()) el.blur()
  }, [activeKind, activeTabId])

  if (active?.kind === 'file') lastFilePath.current = active.path
  const fileTab =
    active?.kind === 'file'
      ? active
      : (tabs.find((t) => t.kind === 'file' && lastFilePath.current !== null && samePath(t.path, lastFilePath.current)) ?? tabs.find((t) => t.kind === 'file') ?? null)

  const showWelcome = !active || active.kind === 'welcome'

  const onDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer.types.includes(EXPLORER_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!dropping) setDropping(true)
  }

  const onDrop = (e: DragEvent): void => {
    setDropping(false)
    const path = e.dataTransfer.getData(EXPLORER_MIME)
    if (!path) return
    e.preventDefault()
    void useEditorStore.getState().openFile(path, { preview: false })
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-app"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={onDrop}
    >
      {tabs.length > 0 && <EditorTabs />}
      {active && (active.kind === 'file' || active.kind === 'image') && <Breadcrumbs tab={active} />}
      <div className="relative min-h-0 flex-1">
        {fileTab && (
          <div className={cn('absolute inset-0', active?.kind !== 'file' && 'pointer-events-none invisible')} aria-hidden={active?.kind !== 'file'}>
            <MonacoEditor path={fileTab.path} />
          </div>
        )}
        {active?.kind === 'diff' && (
          <div className="absolute inset-0">
            <DiffEditor key={active.id} tabId={active.id} />
          </div>
        )}
        {active?.kind === 'image' && (
          <div className="absolute inset-0">
            <ImagePreview key={active.id} tabId={active.id} path={active.path} />
          </div>
        )}
        {showWelcome && (
          <div className="absolute inset-0">
            <WelcomePage />
          </div>
        )}
      </div>
      {dropping && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-accent-soft ring-2 ring-inset ring-accent/50">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-overlay px-3 py-2 text-[12.5px] text-fg shadow-pop">
            <FileDown size={15} className="text-accent" /> Drop to open
          </div>
        </div>
      )}
      <EditorDialogs />
    </div>
  )
}
