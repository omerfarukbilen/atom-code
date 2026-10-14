import { useEffect, useMemo, useState } from 'react'
import { FilePen, FilePlus, FileText, GitCompare, NotebookPen, type LucideIcon } from 'lucide-react'
import { basename } from '@shared/paths'
import { atom } from '../../../../lib/api'
import type { ToolCall } from '../../../../lib/agent-types'
import { useEditorStore } from '../../../../stores/editor'
import { errorMessage, toast } from '../../../../stores/toast'
import { Badge } from '../../../ui'
import { useDepth, useTranscript } from '../context'
import {
  applyEdit,
  countChanges,
  editsFromInput,
  hunksFromEdits,
  hunksFromStrings,
  hunksFromStructured,
  type EditSpec,
  type Hunk
} from '../diff'
import { DiffView } from '../DiffView'
import { lineRangeLabel, openPath, resolvePath } from '../file-links'
import { isObj, num, plural, str } from '../format'
import { PathChip, ToolAction, ToolShell } from '../ToolShell'

// ─────────────────────────────────────────────────────────────────────────────
// Current file content (for pre-apply previews)
// ─────────────────────────────────────────────────────────────────────────────

const fileCache = new Map<string, { at: number; content: string | null }>()

/**
 * Text content of a file on disk, read once (cached for a few seconds). `undefined` while loading,
 * `null` when it does not exist / is binary / too large.
 */
export function useFileContent(path: string, enabled: boolean): string | null | undefined {
  const { workspace } = useTranscript()
  const abs = path ? resolvePath(path, workspace) : ''
  const [state, setState] = useState<{ path: string; content: string | null } | null>(null)
  useEffect(() => {
    if (!enabled || !abs) return
    const cached = fileCache.get(abs)
    if (cached && Date.now() - cached.at < 5000) {
      setState({ path: abs, content: cached.content })
      return
    }
    let cancelled = false
    atom.fs
      .readFile(abs)
      .then(
        (f) => (f.isBinary || f.tooLarge ? null : f.content),
        () => null
      )
      .then((content) => {
        fileCache.set(abs, { at: Date.now(), content })
        if (fileCache.size > 50) fileCache.delete(fileCache.keys().next().value as string)
        if (!cancelled) setState({ path: abs, content })
      })
    return () => {
      cancelled = true
    }
  }, [abs, enabled])
  return state && state.path === abs ? state.content : undefined
}

/** 0-based line offset of `needle` in `content`, or null when not found exactly once (or at all). */
export function lineOffsetOf(content: string | null | undefined, needle: string): number | null {
  if (!content || !needle) return null
  const i = content.indexOf(needle)
  if (i === -1) return null
  let n = 0
  for (let k = 0; k < i; k++) if (content.charCodeAt(k) === 10) n++
  return n
}

function ChangeCounts({ hunks }: { hunks: Hunk[] }) {
  const { added, removed } = countChanges(hunks)
  if (!added && !removed) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums">
      {added > 0 && <span className="text-success">+{added}</span>}
      {removed > 0 && <span className="text-danger">−{removed}</span>}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

export function ReadTool({ tool }: { tool: ToolCall }) {
  const { workspace } = useTranscript()
  const path = str(tool.input.file_path) ?? str(tool.input.path) ?? ''
  const offset = num(tool.input.offset)
  const limit = num(tool.input.limit)
  const pages = str(tool.input.pages)
  const s = isObj(tool.structured) ? tool.structured : null
  const file = s && isObj(s.file) ? s.file : null
  const startLine = offset ?? (file ? num(file.startLine) : undefined)
  const numLines = file ? num(file.numLines) : undefined
  const totalLines = file ? num(file.totalLines) : undefined
  let endLine: number | undefined
  if (offset && limit) endLine = offset + limit - 1
  else if (file && startLine && numLines && totalLines && numLines < totalLines) endLine = startLine + numLines - 1
  if (endLine && totalLines) endLine = Math.min(endLine, totalLines)
  const partial = !!offset || !!endLine
  const range = partial ? lineRangeLabel(startLine ?? 1, endLine) : ''
  const isImage = s?.type === 'image'

  return (
    <ToolShell
      tool={tool}
      icon={FileText}
      titleTooltip={path ? `Open ${path}` : undefined}
      onTitleClick={path ? () => openPath(path, workspace, startLine, endLine) : undefined}
      title={
        <>
          <span className="shrink-0">{tool.status === 'streaming' || tool.status === 'running' ? 'Reading' : 'Read'}</span>
          {path ? (
            <PathChip path={path} line={partial ? startLine : undefined} endLine={partial ? endLine : undefined} />
          ) : (
            <span className="text-subtle">file…</span>
          )}
          {!range && numLines !== undefined && <span className="shrink-0 text-[11px] text-subtle">{plural(numLines, 'line')}</span>}
          {pages && <span className="shrink-0 text-[11px] text-subtle">pages {pages}</span>}
          {isImage && <span className="shrink-0 text-[11px] text-subtle">image</span>}
        </>
      }
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit / MultiEdit / Write
// ─────────────────────────────────────────────────────────────────────────────

function useEditModel(tool: ToolCall) {
  const isWrite = tool.name === 'Write'
  const path = str(tool.input.file_path) ?? ''
  const content = str(tool.input.content) ?? ''
  const s = isObj(tool.structured) ? tool.structured : null
  const writeType = s ? str(s.type) : undefined
  const originalFile = s && typeof s.originalFile === 'string' ? s.originalFile : null
  const preApply = tool.status === 'streaming' || tool.status === 'running'
  const edits = useMemo<EditSpec[]>(() => (isWrite ? [] : editsFromInput(tool.name, tool.input)), [isWrite, tool.name, tool.input])
  // Before the tool ran, read the file to anchor line numbers (Edit) or diff against it (Write).
  const current = useFileContent(path, preApply && !!path && (isWrite || edits.length === 1))

  const model = useMemo(() => {
    const structured = s ? hunksFromStructured(s.structuredPatch) : null
    if (structured && structured.length) return { hunks: structured, anchored: true, offset: 0 }
    if (isWrite) {
      if (originalFile !== null) return { hunks: hunksFromStrings(originalFile, content), anchored: true, offset: 0 }
      if (preApply && typeof current === 'string') return { hunks: hunksFromStrings(current, content), anchored: true, offset: 0 }
      return { hunks: hunksFromStrings('', content), anchored: true, offset: 0 }
    }
    const hunks = hunksFromEdits(edits)
    if (preApply && edits.length === 1) {
      const off = lineOffsetOf(current, edits[0].oldString)
      if (off !== null) return { hunks, anchored: true, offset: off }
    }
    return { hunks, anchored: false, offset: 0 }
  }, [s, isWrite, originalFile, content, preApply, current, edits])

  return { isWrite, path, content, writeType, originalFile, current, edits, preApply, ...model }
}

export function EditTool({ tool }: { tool: ToolCall }) {
  const { workspace } = useTranscript()
  const depth = useDepth()
  const m = useEditModel(tool)
  const s = isObj(tool.structured) ? tool.structured : null
  const isNew = m.writeType === 'create' || (m.isWrite && m.preApply && m.current === null)
  const verb = m.isWrite ? (isNew ? 'Create' : 'Write') : 'Edit'
  const icon: LucideIcon = m.isWrite && isNew ? FilePlus : FilePen
  const firstLine = m.hunks[0] ? m.hunks[0].newStart + m.offset : undefined

  const openDiff = async (): Promise<void> => {
    if (!m.path) return
    const title = `${basename(m.path)} ↔ ATOM edit`
    const editor = useEditorStore.getState()
    try {
      if (m.isWrite) {
        let original: string | null = m.originalFile ?? (m.preApply && typeof m.current === 'string' ? m.current : null)
        if (original === null && !isNew && workspace) original = await atom.git.fileAtHead(workspace, resolvePath(m.path, workspace)).catch(() => null)
        editor.openDiff({ path: resolvePath(m.path, workspace), title, original: original ?? '', modified: m.content })
        return
      }
      const base = m.originalFile ?? (m.preApply && typeof m.current === 'string' ? m.current : null)
      if (base !== null) {
        let modified = base
        for (const e of m.edits) modified = applyEdit(modified, e.oldString, e.newString, e.replaceAll)
        editor.openDiff({ path: resolvePath(m.path, workspace), title, original: base, modified })
      } else {
        editor.openDiff({
          path: resolvePath(m.path, workspace),
          title,
          original: m.edits.map((e) => e.oldString).join('\n\n⋯\n\n'),
          modified: m.edits.map((e) => e.newString).join('\n\n⋯\n\n')
        })
      }
    } catch (err) {
      toast.error('Could not open the diff', errorMessage(err))
    }
  }

  const collapsedByDefault = depth > 0 || tool.status === 'denied' || tool.status === 'interrupted'
  return (
    <ToolShell
      tool={tool}
      icon={icon}
      variant="card"
      defaultOpen={!collapsedByDefault}
      title={
        <>
          <span className="shrink-0 font-medium">{verb}</span>
          {m.path ? <PathChip path={m.path} line={firstLine} /> : <span className="text-subtle">file…</span>}
          {tool.name === 'MultiEdit' && m.edits.length > 1 && <span className="shrink-0 text-[11px] text-subtle">{plural(m.edits.length, 'edit')}</span>}
          {s?.staged === true && <Badge tone="info">held for review</Badge>}
          {s?.userModified === true && <Badge tone="neutral">modified by you</Badge>}
        </>
      }
      meta={<ChangeCounts hunks={m.hunks} />}
      actions={
        m.path ? (
          <>
            <ToolAction icon={FileText} label="Open" title="Open file" onClick={() => openPath(m.path, workspace, firstLine)} />
            <ToolAction icon={GitCompare} label="Diff" title="Open diff in the editor" onClick={() => void openDiff()} />
          </>
        ) : undefined
      }
    >
      <DiffView
        hunks={m.hunks}
        path={m.path}
        lineNumbers={m.anchored}
        lineOffset={m.offset}
        maxRows={depth > 0 ? 12 : 40}
        emptyText={tool.status === 'streaming' ? 'Writing…' : 'No changes'}
      />
    </ToolShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NotebookEdit
// ─────────────────────────────────────────────────────────────────────────────

export function NotebookEditTool({ tool }: { tool: ToolCall }) {
  const depth = useDepth()
  const path = str(tool.input.notebook_path) ?? ''
  const cellId = str(tool.input.cell_id)
  const mode = str(tool.input.edit_mode) ?? 'replace'
  const s = isObj(tool.structured) ? tool.structured : null
  const newSource = str(tool.input.new_source) ?? ''
  const oldSource = s ? (str(s.old_source) ?? '') : ''
  const hunks = useMemo(
    () => (mode === 'delete' ? hunksFromStrings(oldSource || newSource, '') : hunksFromStrings(oldSource, newSource)),
    [mode, oldSource, newSource]
  )
  const language = (s ? str(s.language) : undefined) ?? (str(tool.input.cell_type) === 'markdown' ? 'markdown' : 'python')
  const pseudoPath = `cell.${language === 'markdown' ? 'md' : language === 'python' ? 'py' : language}`
  const verb = mode === 'insert' ? 'Insert cell' : mode === 'delete' ? 'Delete cell' : 'Edit cell'
  return (
    <ToolShell
      tool={tool}
      icon={NotebookPen}
      variant="card"
      defaultOpen={depth === 0 && tool.status !== 'denied'}
      title={
        <>
          <span className="shrink-0 font-medium">{verb}</span>
          {path && <PathChip path={path} />}
          {cellId && <span className="truncate font-mono text-[11px] text-subtle">#{cellId}</span>}
        </>
      }
      meta={<ChangeCounts hunks={hunks} />}
    >
      <DiffView hunks={hunks} path={pseudoPath} maxRows={depth > 0 ? 12 : 40} />
    </ToolShell>
  )
}

