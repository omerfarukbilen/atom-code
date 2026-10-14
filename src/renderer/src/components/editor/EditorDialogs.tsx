import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AlertTriangle, FilePlus, FolderOpen } from 'lucide-react'
import { basename } from '@shared/paths'
import { FileIcon } from '../../lib/file-icons'
import { registerDialogHost, useEditorStore, type UnsavedChoice } from '../../stores/editor'
import { useWorkspaceStore } from '../../stores/workspace'
import { Button, Input, Kbd, Modal } from '../ui'

/** Unsaved-changes confirmation and the New File prompt. Rendered by EditorArea. */
export function EditorDialogs({ standalone = false }: { standalone?: boolean }) {
  const dialog = useEditorStore((s) => s.dialog)
  useEffect(() => {
    if (standalone) return
    unmountStandalone()
    return registerDialogHost()
  }, [standalone])
  if (!dialog) return null
  if (dialog.kind === 'confirm-unsaved') return <UnsavedDialog paths={dialog.paths} onChoose={dialog.resolve} />
  return <NewFileDialog initial={dialog.initial} />
}

/** Focus after the Modal's own initial-focus frame (it focuses the first button/input it finds). */
function focusLater(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

function UnsavedDialog({ paths, onChoose }: { paths: string[]; onChoose(choice: UnsavedChoice): void }) {
  const single = paths.length === 1
  const saveRef = useRef<HTMLButtonElement>(null)
  useEffect(() => focusLater(() => saveRef.current?.focus()), [])
  return (
    <Modal
      open
      onClose={() => onChoose('cancel')}
      width="max-w-md"
      title={single ? `Save changes to ${basename(paths[0])}?` : `Save changes to ${paths.length} files?`}
      footer={
        <>
          <Button variant="ghost" size="sm" className="mr-auto text-danger hover:text-danger" onClick={() => onChoose('discard')}>
            Don’t Save
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onChoose('cancel')}>
            Cancel
          </Button>
          <Button ref={saveRef} variant="primary" size="sm" onClick={() => onChoose('save')}>
            {single ? 'Save' : 'Save All'}
          </Button>
        </>
      }
    >
      <div className="flex gap-3 px-5 py-4">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-muted">
          <p>Your changes will be lost if you don’t save them.</p>
          {!single && (
            <ul className="mt-2.5 max-h-48 space-y-1 overflow-auto rounded-md border border-line bg-input p-2">
              {paths.map((p) => (
                <li key={p} className="flex items-center gap-2 text-[12px] text-fg" title={p}>
                  <FileIcon name={p} size={14} />
                  <span className="truncate">{basename(p)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

function NewFileDialog({ initial }: { initial: string }) {
  const workspace = useWorkspaceStore((s) => s.workspace)
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const close = (): void => useEditorStore.getState().closeDialog()

  useEffect(() => {
    focusLater(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [])

  const submit = async (): Promise<void> => {
    if (busy || !value.trim()) return
    setBusy(true)
    const ok = await useEditorStore.getState().createFile(value)
    if (!ok) setBusy(false)
  }

  if (!workspace) {
    return (
      <Modal open onClose={close} width="max-w-md" title="New File">
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <FolderOpen size={28} className="text-subtle" />
          <div className="text-[13px] text-fg">Open a folder to create files</div>
          <div className="max-w-[300px] text-[12px] text-muted">New files are created inside the current workspace folder.</div>
          <Button
            variant="primary"
            size="sm"
            icon={<FolderOpen size={14} />}
            onClick={() => {
              close()
              void useWorkspaceStore.getState().openFolderDialog()
            }}
          >
            Open Folder…
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={close}
      width="max-w-lg"
      title="New File"
      description={
        <>
          Path relative to <span className="font-medium text-fg">{workspace.name}</span>. Missing folders are created automatically.
        </>
      }
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5 text-[11px] text-subtle">
            <Kbd keys="enter" /> create <Kbd keys="escape" /> cancel
          </span>
          <Button variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!value.trim() || value.trim().endsWith('/')} onClick={() => void submit()}>
            Create
          </Button>
        </>
      }
    >
      <div className="px-5 py-4">
        <Input
          ref={inputRef}
          value={value}
          placeholder="src/components/Button.tsx"
          icon={value.trim() && !value.endsWith('/') ? <FileIcon name={value} size={14} /> : <FilePlus size={14} />}
          className="font-mono"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
        />
      </div>
    </Modal>
  )
}

let standalone: { root: Root; el: HTMLDivElement } | null = null

/** Mount a dialog host outside the React tree (used when EditorArea is not on screen). */
export function mountStandaloneEditorDialogs(): void {
  if (standalone) return
  const el = document.createElement('div')
  el.id = 'atom-editor-dialogs'
  document.body.appendChild(el)
  const root = createRoot(el)
  root.render(<EditorDialogs standalone />)
  standalone = { root, el }
}

function unmountStandalone(): void {
  const s = standalone
  if (!s) return
  standalone = null
  // Defer: unmounting a root synchronously during another root's commit is not allowed.
  setTimeout(() => {
    s.root.unmount()
    s.el.remove()
  }, 0)
}
