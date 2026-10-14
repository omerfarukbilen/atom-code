import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Filter, Info, Lightbulb, XCircle } from 'lucide-react'
import type { IdeDiagnostic } from '@shared/types'
import { basename, dirname, isInside, relativePath } from '@shared/paths'
import { cn } from '../../lib/cn'
import { FileIcon } from '../../lib/file-icons'
import { useEditorStore } from '../../stores/editor'
import { useWorkspaceStore } from '../../stores/workspace'
import { EmptyState, Input } from '../ui'

type Severity = IdeDiagnostic['severity']

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2, hint: 3 }

function SeverityIcon({ severity, size = 14 }: { severity: Severity; size?: number }) {
  if (severity === 'error') return <XCircle size={size} className="shrink-0 text-danger" />
  if (severity === 'warning') return <AlertTriangle size={size} className="shrink-0 text-warning" />
  if (severity === 'info') return <Info size={size} className="shrink-0 text-info" />
  return <Lightbulb size={size} className="shrink-0 text-subtle" />
}

interface FileGroup {
  path: string
  items: IdeDiagnostic[]
  errors: number
  warnings: number
}

/** Monaco markers of open files, grouped by file. Click a row to jump to the location. */
export function ProblemsPanel() {
  const version = useEditorStore((s) => s.diagnosticsVersion)
  const workspace = useWorkspaceStore((s) => s.workspace)
  const [query, setQuery] = useState('')
  const [hidden, setHidden] = useState<Record<Severity, boolean>>({ error: false, warning: false, info: false, hint: true })
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const all = useMemo(() => useEditorStore.getState().getDiagnostics(), [version])

  const groups = useMemo<FileGroup[]>(() => {
    const q = query.trim().toLowerCase()
    const byFile = new Map<string, IdeDiagnostic[]>()
    for (const d of all) {
      if (hidden[d.severity]) continue
      if (q && !`${d.message} ${d.source ?? ''} ${d.code ?? ''} ${basename(d.path)}`.toLowerCase().includes(q)) continue
      const list = byFile.get(d.path) ?? []
      list.push(d)
      byFile.set(d.path, list)
    }
    const out: FileGroup[] = []
    for (const [path, items] of byFile) {
      items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.line - b.line || a.column - b.column)
      out.push({ path, items, errors: items.filter((i) => i.severity === 'error').length, warnings: items.filter((i) => i.severity === 'warning').length })
    }
    return out.sort((a, b) => (b.errors > 0 ? 1 : 0) - (a.errors > 0 ? 1 : 0) || a.path.localeCompare(b.path))
  }, [all, hidden, query])

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { error: 0, warning: 0, info: 0, hint: 0 }
    for (const d of all) c[d.severity]++
    return c
  }, [all])

  const open = (d: IdeDiagnostic): void => {
    void useEditorStore.getState().openFile(d.path, { line: d.line, column: d.column, endLine: d.endLine, preview: true })
  }

  const toggle = (sev: Severity): void => setHidden((h) => ({ ...h, [sev]: !h[sev] }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-line px-3">
        <Input
          inputSize="sm"
          className="max-w-[320px] flex-1"
          icon={<Filter size={12} />}
          placeholder="Filter (e.g. text, source, file)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex items-center gap-1">
          {(['error', 'warning', 'info'] as const).map((sev) => (
            <button
              key={sev}
              type="button"
              title={`${hidden[sev] ? 'Show' : 'Hide'} ${sev === 'error' ? 'errors' : sev === 'warning' ? 'warnings' : 'infos'}`}
              onClick={() => toggle(sev)}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] transition-colors',
                hidden[sev] ? 'text-subtle opacity-60 hover:bg-hover' : 'bg-active text-fg hover:bg-hover'
              )}
            >
              <SeverityIcon severity={sev} size={12} />
              {counts[sev]}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1 font-sans">
        {groups.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={24} className="text-success" />}
            title={all.length ? 'No problems match the filter' : 'No problems detected'}
            description={
              all.length
                ? 'Clear the filter or show hidden severities.'
                : 'Syntax errors and validation issues of open files appear here. Ask ATOM to run your type checker or build for a full report.'
            }
          />
        ) : (
          groups.map((g) => {
            const isCollapsed = !!collapsed[g.path]
            const relDir = workspace && isInside(workspace.path, g.path) ? relativePath(workspace.path, dirname(g.path)) : dirname(g.path)
            return (
              <div key={g.path}>
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [g.path]: !isCollapsed }))}
                  className="flex h-[24px] w-full items-center gap-1.5 px-2 text-left text-[12.5px] hover:bg-hover"
                  title={g.path}
                >
                  {isCollapsed ? <ChevronRight size={14} className="shrink-0 text-subtle" /> : <ChevronDown size={14} className="shrink-0 text-subtle" />}
                  <FileIcon name={g.path} size={14} />
                  <span className="truncate text-fg">{basename(g.path)}</span>
                  {relDir && relDir !== '.' && <span className="min-w-0 truncate text-[11.5px] text-subtle">{relDir}</span>}
                  <span className="ml-auto shrink-0 rounded-full bg-active px-1.5 text-[10.5px] font-medium leading-4 text-muted">{g.items.length}</span>
                </button>
                {!isCollapsed &&
                  g.items.map((d, i) => (
                    <button
                      key={`${d.line}:${d.column}:${i}`}
                      type="button"
                      onClick={() => open(d)}
                      className="group flex min-h-[22px] w-full items-start gap-2 py-[3px] pl-[42px] pr-3 text-left text-[12.5px] hover:bg-hover focus:bg-active focus:outline-none"
                      title={d.message}
                    >
                      <span className="mt-[2px]">
                        <SeverityIcon severity={d.severity} size={13} />
                      </span>
                      <span className="min-w-0 flex-1 break-words text-fg">{d.message}</span>
                      {(d.source || d.code) && (
                        <span className="shrink-0 font-mono text-[11px] text-subtle">
                          {d.source}
                          {d.code ? `(${d.code})` : ''}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[11px] text-subtle">
                        [Ln {d.line}, Col {d.column}]
                      </span>
                    </button>
                  ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
