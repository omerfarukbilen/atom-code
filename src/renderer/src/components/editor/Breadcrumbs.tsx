import { Fragment } from 'react'
import { ChevronRight, Sparkles } from 'lucide-react'
import { isInside, joinPath, normalizeSlashes, relativePath } from '@shared/paths'
import type { EditorTab } from '../../stores/contracts'
import { FileIcon } from '../../lib/file-icons'
import { samePath, useEditorStore } from '../../stores/editor'
import { useWorkspaceStore } from '../../stores/workspace'
import { Badge } from '../ui'
import { revealInExplorer } from './commands'

/** Path segments of the active file (click a folder to reveal it in the Explorer). */
export function Breadcrumbs({ tab }: { tab: EditorTab }) {
  const workspace = useWorkspaceStore((s) => s.workspace)
  const deleted = useEditorStore((s) => !!s.deleted[tab.id])
  const agentEdited = useEditorStore((s) => s.agentEditedPaths.some((p) => samePath(p, tab.path)))
  const inside = !!workspace && isInside(workspace.path, tab.path)
  const rel = inside && workspace ? relativePath(workspace.path, tab.path) : normalizeSlashes(tab.path)
  const parts = rel.split('/').filter(Boolean)
  const file = parts.pop() ?? tab.title
  const absDir = (i: number): string => {
    const sub = parts.slice(0, i + 1).join('/')
    if (inside && workspace) return joinPath(workspace.path, sub)
    return (normalizeSlashes(tab.path).startsWith('/') ? '/' : '') + sub
  }

  return (
    <div className="flex h-[24px] shrink-0 items-center gap-2 bg-app pl-3 pr-2 text-[12px]">
      <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden whitespace-nowrap text-muted" aria-label="Breadcrumbs">
        {inside && workspace && (
          <>
            <button type="button" className="shrink-0 rounded px-1 hover:bg-hover hover:text-fg" title={workspace.path} onClick={() => revealInExplorer(workspace.path)}>
              {workspace.name}
            </button>
            <ChevronRight size={12} className="shrink-0 text-subtle" />
          </>
        )}
        {parts.map((p, i) => (
          <Fragment key={`${i}-${p}`}>
            <button
              type="button"
              className="min-w-0 shrink truncate rounded px-1 hover:bg-hover hover:text-fg"
              title={absDir(i)}
              onClick={() => (inside ? revealInExplorer(absDir(i)) : undefined)}
            >
              {p}
            </button>
            <ChevronRight size={12} className="shrink-0 text-subtle" />
          </Fragment>
        ))}
        <span className="flex shrink-0 items-center gap-1.5 px-1 text-fg">
          <FileIcon name={tab.path} size={14} />
          <span className={deleted ? 'text-danger line-through' : undefined}>{file}</span>
        </span>
      </nav>
      {agentEdited && (
        <Badge tone="accent" title="ATOM edited this file during this session">
          <Sparkles size={10} /> Edited by ATOM
        </Badge>
      )}
      {deleted && (
        <Badge tone="danger" title="The file was deleted on disk. Save to re-create it.">
          Deleted on disk
        </Badge>
      )}
    </div>
  )
}
