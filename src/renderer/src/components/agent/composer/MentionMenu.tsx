import { useEffect, useMemo, type ReactNode, type RefObject } from 'react'
import { FileCode, GitCompareArrows, SquareTerminal, TextCursorInput, TriangleAlert } from 'lucide-react'
import type { ContextAttachment } from '@shared/types'
import { basename, relativePath } from '@shared/paths'
import { atom } from '../../../lib/api'
import { FileIcon } from '../../../lib/file-icons'
import { fuzzyFilter, fuzzyScore, highlightSegments } from '../../../lib/fuzzy'
import { cn } from '../../../lib/cn'
import type { ActiveEditorInfo } from '../../../stores/contracts'
import { useEditorStore } from '../../../stores/editor'
import { getTerminalBufferText, useTerminalStore } from '../../../stores/terminal'
import { useWorkspaceStore } from '../../../stores/workspace'
import { Spinner } from '../../ui'
import { PopupList, type PopupAnchor, type PopupMenuHandle } from './PopupList'
import { pluralize } from './utils'

export type SpecialMention = 'current-file' | 'selection' | 'terminal' | 'problems' | 'git-diff'

export type MentionItem =
  | { kind: 'special'; id: SpecialMention; label: string; description: string; positions: number[] }
  | { kind: 'file' | 'folder'; path: string; rel: string; positions: number[]; section: string }

interface PathEntry {
  path: string
  rel: string
}

const MAX_ITEMS = 50
const MAX_DIFF_CHARS = 80_000

const SPECIAL_ICONS: Record<SpecialMention, ReactNode> = {
  'current-file': <FileCode size={14} className="text-info" />,
  selection: <TextCursorInput size={14} className="text-accent" />,
  terminal: <SquareTerminal size={14} className="text-success" />,
  problems: <TriangleAlert size={14} className="text-warning" />,
  'git-diff': <GitCompareArrows size={14} className="text-accent-2" />
}

/** Context sources that exist right now (current file, selection, terminal, problems, git diff). */
function availableSpecials(workspace: string): Omit<Extract<MentionItem, { kind: 'special' }>, 'positions'>[] {
  const out: Omit<Extract<MentionItem, { kind: 'special' }>, 'positions'>[] = []
  let info: ActiveEditorInfo | null = null
  try {
    info = useEditorStore.getState().getActiveEditorInfo()
  } catch {
    info = null
  }
  const rel = (p: string): string => (workspace ? relativePath(workspace, p) || basename(p) : basename(p))
  if (info) out.push({ kind: 'special', id: 'current-file', label: 'Current file', description: rel(info.path) })
  if (info?.selection?.text.trim()) {
    const { startLine, endLine } = info.selection
    out.push({ kind: 'special', id: 'selection', label: 'Selection', description: `${basename(info.path)}:${startLine}${endLine !== startLine ? `-${endLine}` : ''}` })
  }
  try {
    const diags = useEditorStore.getState().getDiagnostics()
    if (diags.length) {
      const errors = diags.filter((d) => d.severity === 'error').length
      const warnings = diags.filter((d) => d.severity === 'warning').length
      const parts = [errors && pluralize(errors, 'error'), warnings && pluralize(warnings, 'warning')].filter(Boolean)
      out.push({ kind: 'special', id: 'problems', label: 'Problems', description: parts.join(', ') || pluralize(diags.length, 'problem') })
    }
  } catch {
    /* editor not ready */
  }
  if (useTerminalStore.getState().instances.length) {
    out.push({ kind: 'special', id: 'terminal', label: 'Terminal output', description: 'Recent output of the active terminal' })
  }
  if (useWorkspaceStore.getState().workspace?.isGitRepo) {
    out.push({ kind: 'special', id: 'git-diff', label: 'Git diff', description: 'Uncommitted changes' })
  }
  return out
}

/** Convert a picked mention into a context attachment. Throws an Error with a user-facing message. */
export async function resolveMention(item: MentionItem, workspace: string): Promise<ContextAttachment> {
  if (item.kind !== 'special') return item.kind === 'folder' ? { type: 'folder', path: item.path } : { type: 'file', path: item.path }
  const editor = useEditorStore.getState()
  const info = editor.getActiveEditorInfo()
  switch (item.id) {
    case 'current-file':
      if (!info) throw new Error('No file is open in the editor.')
      return { type: 'file', path: info.path }
    case 'selection':
      if (!info?.selection?.text.trim()) throw new Error('Select some code in the editor first.')
      return {
        type: 'selection',
        path: info.path,
        startLine: info.selection.startLine,
        endLine: info.selection.endLine,
        text: info.selection.text,
        language: info.language
      }
    case 'terminal': {
      const text = getTerminalBufferText(8000).trim()
      if (!text) throw new Error('The terminal has no output yet.')
      return { type: 'terminal', text }
    }
    case 'problems': {
      const diags = editor.getDiagnostics()
      if (!diags.length) throw new Error('There are no problems in the open files.')
      const text = diags
        .map((d) => {
          const p = workspace ? relativePath(workspace, d.path) : d.path
          return `${p}:${d.line}:${d.column} ${d.severity}: ${d.message}${d.source ? ` (${d.source}${d.code ? ` ${d.code}` : ''})` : ''}`
        })
        .join('\n')
      return { type: 'diagnostics', path: info?.path ?? workspace, text }
    }
    case 'git-diff': {
      if (!workspace) throw new Error('Open a folder first.')
      const diff = await atom.git.diff(workspace)
      if (!diff.trim()) throw new Error('There are no uncommitted changes.')
      const text = diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated — ${diff.length.toLocaleString()} characters in total)` : diff
      return { type: 'git-diff', text }
    }
  }
}

function Highlighted({ text, positions, offset = 0, className }: { text: string; positions: number[]; offset?: number; className?: string }) {
  const local = positions.filter((p) => p >= offset && p < offset + text.length).map((p) => p - offset)
  return (
    <span className={className}>
      {highlightSegments(text, local).map((seg, i) => (
        <span key={i} className={cn(seg.match && 'font-semibold text-accent')}>
          {seg.text}
        </span>
      ))}
    </span>
  )
}

interface MentionMenuProps {
  query: string
  anchor: PopupAnchor
  workspace: string
  handleRef: RefObject<PopupMenuHandle | null>
  onSelect(item: MentionItem): void
  onClose(): void
}

/** "@" context picker: special sources, open editors, folders and fuzzy-matched workspace files. */
export function MentionMenu({ query, anchor, workspace, handleRef, onSelect, onClose }: MentionMenuProps) {
  const files = useWorkspaceStore((s) => s.files)
  const filesLoading = useWorkspaceStore((s) => s.filesLoading)
  const tabs = useEditorStore((s) => s.tabs)

  // The file index is built lazily; make sure it exists once the user starts mentioning files.
  useEffect(() => {
    const ws = useWorkspaceStore.getState()
    if (ws.workspace && !ws.files.length && !ws.filesLoading) void ws.refreshFiles()
  }, [])

  const entries = useMemo<PathEntry[]>(() => files.map((path) => ({ path, rel: workspace ? relativePath(workspace, path) : path })), [files, workspace])

  const folders = useMemo<PathEntry[]>(() => {
    if (!workspace) return []
    const seen = new Set<string>()
    const out: PathEntry[] = []
    const sep = workspace.includes('\\') && !workspace.includes('/') ? '\\' : '/'
    for (const e of entries) {
      let idx = e.rel.indexOf('/')
      while (idx > 0) {
        const dir = e.rel.slice(0, idx)
        if (!seen.has(dir)) {
          seen.add(dir)
          out.push({ rel: dir, path: workspace.replace(/[\\/]+$/, '') + sep + dir.split('/').join(sep) })
        }
        idx = e.rel.indexOf('/', idx + 1)
      }
    }
    return out
  }, [entries, workspace])

  // Recomputed when editors change (current file / selection / problems come from the editor store).
  const specials = useMemo(() => availableSpecials(workspace), [workspace, tabs])

  const items = useMemo<MentionItem[]>(() => {
    const q = query.trim()
    const out: MentionItem[] = []
    for (const s of specials) {
      if (!q) out.push({ ...s, positions: [] })
      else {
        const m = fuzzyScore(q, s.label)
        if (m) out.push({ ...s, positions: m.positions })
      }
    }
    if (!q) {
      const seen = new Set<string>()
      for (const t of tabs) {
        if (t.kind !== 'file' || seen.has(t.path) || seen.size >= 8) continue
        seen.add(t.path)
        out.push({ kind: 'file', path: t.path, rel: workspace ? relativePath(workspace, t.path) : t.path, positions: [], section: 'Open editors' })
      }
      for (const e of entries) {
        if (out.length >= MAX_ITEMS) break
        if (seen.has(e.path)) continue
        out.push({ kind: 'file', path: e.path, rel: e.rel, positions: [], section: 'Files' })
      }
      return out
    }
    const fileMatches = fuzzyFilter(entries, q, (e) => e.rel, { path: true, limit: MAX_ITEMS })
    const folderMatches = fuzzyFilter(folders, q, (e) => e.rel, { path: true, limit: 12 })
    const ranked = [
      ...fileMatches.map((m) => ({ score: m.score, item: { kind: 'file' as const, path: m.item.path, rel: m.item.rel, positions: m.positions, section: 'Files & folders' } })),
      ...folderMatches.map((m) => ({ score: m.score + 2, item: { kind: 'folder' as const, path: m.item.path, rel: m.item.rel, positions: m.positions, section: 'Files & folders' } }))
    ].sort((a, b) => b.score - a.score)
    for (const r of ranked) {
      if (out.length >= MAX_ITEMS) break
      out.push(r.item)
    }
    return out
  }, [query, specials, tabs, entries, folders, workspace])

  return (
    <PopupList
      ariaLabel="Add context"
      anchor={anchor}
      items={items}
      handleRef={handleRef}
      onClose={onClose}
      onSelect={(item) => onSelect(item)}
      getKey={(item) => (item.kind === 'special' ? `special:${item.id}` : `${item.kind}:${item.path}`)}
      sectionOf={(item) => (item.kind === 'special' ? 'Context' : item.section)}
      renderItem={(item) => {
        if (item.kind === 'special') {
          return (
            <>
              <span className="flex w-4 shrink-0 justify-center">{SPECIAL_ICONS[item.id]}</span>
              <Highlighted text={item.label} positions={item.positions} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-right text-[11.5px] text-subtle">{item.description}</span>
            </>
          )
        }
        const slash = item.rel.lastIndexOf('/')
        const name = slash >= 0 ? item.rel.slice(slash + 1) : item.rel
        const dir = slash >= 0 ? item.rel.slice(0, slash) : ''
        return (
          <>
            <FileIcon name={item.path} isDirectory={item.kind === 'folder'} size={14} />
            <Highlighted text={item.kind === 'folder' ? `${name}/` : name} positions={item.positions} offset={slash + 1} className="max-w-[60%] shrink-0 truncate" />
            {dir && <Highlighted text={dir} positions={item.positions} className="min-w-0 flex-1 truncate text-right text-[11.5px] text-subtle" />}
          </>
        )
      }}
      empty={
        <div className="flex items-center gap-2 px-2.5 py-3 text-[12px] text-muted">
          {filesLoading ? (
            <>
              <Spinner size={12} /> Indexing files…
            </>
          ) : workspace ? (
            <>No files match “{query}”</>
          ) : (
            <>Open a folder to mention its files</>
          )}
        </div>
      }
      footer={
        <>
          <span>↑↓ navigate</span>
          <span>↩ add</span>
          <span>Esc close</span>
          {filesLoading && (
            <span className="ml-auto flex items-center gap-1">
              <Spinner size={10} /> indexing
            </span>
          )}
        </>
      }
    />
  )
}
