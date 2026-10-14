import { useEffect } from 'react'
import { ChevronsDownUp, FilePlus, FolderOpen, FolderPlus, History, RefreshCw } from 'lucide-react'
import { basename, isInside } from '@shared/paths'
import { useEditorStore } from '../../stores/editor'
import { useSettingsStore } from '../../stores/settings'
import { useWorkspaceStore } from '../../stores/workspace'
import { Button, EmptyState, IconButton, Kbd, Spinner } from '../ui'
import { ViewHeader } from '../workbench/ViewHeader'
import { startNewFile } from './explorerActions'
import { useExplorerStore } from './explorerStore'
import { ExplorerTree } from './ExplorerTree'

export function ExplorerView() {
  const workspace = useWorkspaceStore((s) => s.workspace)
  const opening = useWorkspaceStore((s) => s.opening)
  if (!workspace) return opening ? <OpeningState /> : <NoWorkspace />
  return <WorkspaceExplorer root={workspace.path} name={workspace.name} />
}

function WorkspaceExplorer({ root, name }: { root: string; name: string }) {
  const rootChildren = useExplorerStore((s) => s.children[root])
  const rootError = useExplorerStore((s) => s.rootError)
  const rootLoading = useExplorerStore((s) => !!s.loading[root])
  const editing = useExplorerStore((s) => s.editing)

  // Auto-reveal the active editor's file.
  useEffect(() => {
    const revealActive = (): void => {
      const { tabs, activeTabId } = useEditorStore.getState()
      const tab = tabs.find((t) => t.id === activeTabId)
      if (!tab || tab.kind === 'welcome' || tab.kind === 'diff' || !isInside(root, tab.path)) return
      void useExplorerStore.getState().reveal(tab.path)
    }
    revealActive()
    let last = useEditorStore.getState().activeTabId
    return useEditorStore.subscribe((s) => {
      if (s.activeTabId === last) return
      last = s.activeTabId
      revealActive()
    })
  }, [root])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader
        title={name}
        actions={
          <>
            <IconButton title="New File…" icon={<FilePlus size={15} />} onClick={() => startNewFile('new-file')} />
            <IconButton title="New Folder…" icon={<FolderPlus size={15} />} onClick={() => startNewFile('new-folder')} />
            <IconButton title="Refresh Explorer" icon={<RefreshCw size={14} />} onClick={() => void useExplorerStore.getState().refreshAll()} />
            <IconButton title="Collapse Folders" icon={<ChevronsDownUp size={15} />} onClick={() => useExplorerStore.getState().collapseAll()} />
          </>
        }
      />
      {rootError ? (
        <EmptyState
          title="Cannot read this folder"
          description={rootError}
          action={
            <Button size="sm" icon={<RefreshCw size={13} />} onClick={() => void useExplorerStore.getState().loadDir(root)}>
              Try again
            </Button>
          }
        />
      ) : !rootChildren ? (
        <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-subtle">{rootLoading && <Spinner size={12} />} Loading…</div>
      ) : rootChildren.length === 0 && !editing ? (
        <EmptyState
          title="This folder is empty"
          description="Create a file to get started, or ask ATOM to scaffold the project for you."
          action={
            <div className="flex gap-2">
              <Button size="sm" icon={<FilePlus size={13} />} onClick={() => startNewFile('new-file', root)}>
                New File
              </Button>
              <Button size="sm" variant="ghost" icon={<FolderPlus size={13} />} onClick={() => startNewFile('new-folder', root)}>
                New Folder
              </Button>
            </div>
          }
        />
      ) : (
        <ExplorerTree root={root} />
      )}
    </div>
  )
}

function OpeningState() {
  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Explorer" />
      <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-muted">
        <Spinner size={12} /> Opening folder…
      </div>
    </div>
  )
}

function NoWorkspace() {
  const recent = useSettingsStore((s) => s.settings.recentWorkspaces)
  const openFolderDialog = useWorkspaceStore((s) => s.openFolderDialog)
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader title="Explorer" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmptyState
          icon={<FolderOpen size={28} strokeWidth={1.5} />}
          title="No folder opened"
          description="Open a project folder to browse its files, search the code and let ATOM work on it."
          action={
            <div className="flex flex-col items-center gap-2">
              <Button variant="primary" size="sm" icon={<FolderOpen size={14} />} onClick={() => void openFolderDialog()}>
                Open Folder
              </Button>
              <span className="flex items-center gap-1 text-[11px] text-subtle">
                or press <Kbd keys="mod+o" />
              </span>
            </div>
          }
        />
        {recent.length > 0 && (
          <div className="px-2 pb-4">
            <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
              <History size={12} /> Recent
            </div>
            {recent.slice(0, 8).map((r) => (
              <button
                key={r.path}
                type="button"
                title={r.path}
                onClick={() => void openWorkspace(r.path)}
                className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-hover"
              >
                <span className="truncate text-[12.5px] text-fg">{r.name || basename(r.path)}</span>
                <span className="truncate text-[11px] text-subtle">{r.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
