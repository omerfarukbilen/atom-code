import { useEffect, useMemo, useRef, useState } from 'react'
import { DiffEditor as MonacoDiffEditor, type DiffOnMount } from '@monaco-editor/react'
import { ArrowDown, ArrowUp, Columns2, FileText, Lock, Rows2 } from 'lucide-react'
import { basename } from '@shared/paths'
import type { monaco } from '../../lib/monaco'
import { formatKeybinding } from '../../lib/platform'
import { getActiveDiffEditor, getDiffModels, setActiveDiffEditor, useEditorStore } from '../../stores/editor'
import { useSettingsStore } from '../../stores/settings'
import { Badge, IconButton, Spinner } from '../ui'
import { useEditorOptions } from './MonacoEditor'

const SIDE_KEY = 'atom.diff.sideBySide'

function loadSideBySide(): boolean {
  try {
    return localStorage.getItem(SIDE_KEY) !== '0'
  } catch {
    return true
  }
}

/** Monaco diff editor for a diff tab (original ↔ modified). Editable when the request was not read-only. */
export function DiffEditor({ tabId }: { tabId: string }) {
  const data = useEditorStore((s) => s.diffData[tabId])
  const tab = useEditorStore((s) => s.tabs.find((t) => t.id === tabId))
  const theme = useSettingsStore((s) => s.settings.theme)
  const base = useEditorOptions()
  const [sideBySide, setSideBySide] = useState(loadSideBySide)
  const [stats, setStats] = useState<{ added: number; removed: number; changes: number } | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)

  const options = useMemo<monaco.editor.IDiffEditorConstructionOptions>(
    () => ({
      ...(base as monaco.editor.IDiffEditorConstructionOptions),
      readOnly: data?.readOnly ?? true,
      originalEditable: false,
      renderSideBySide: sideBySide,
      useInlineViewWhenSpaceIsLimited: true,
      enableSplitViewResizing: true,
      renderOverviewRuler: true,
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      diffAlgorithm: 'advanced',
      hideUnchangedRegions: { enabled: true, contextLineCount: 4, minimumLineCount: 6, revealLineCount: 20 },
      minimap: { enabled: false }
    }),
    [base, data?.readOnly, sideBySide]
  )

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_KEY, sideBySide ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [sideBySide])

  useEffect(
    () => () => {
      if (editorRef.current && getActiveDiffEditor() === editorRef.current) setActiveDiffEditor(null)
    },
    []
  )

  const onMount: DiffOnMount = (editor) => {
    editorRef.current = editor
    setActiveDiffEditor(editor)
    const update = (): void => {
      const changes = editor.getLineChanges() ?? []
      let added = 0
      let removed = 0
      for (const c of changes) {
        if (c.modifiedEndLineNumber >= c.modifiedStartLineNumber && c.modifiedEndLineNumber > 0) added += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1
        if (c.originalEndLineNumber >= c.originalStartLineNumber && c.originalEndLineNumber > 0) removed += c.originalEndLineNumber - c.originalStartLineNumber + 1
      }
      setStats({ added, removed, changes: changes.length })
    }
    editor.onDidUpdateDiff(update)
    if (editor.getLineChanges()) update()
    editor.getModifiedEditor().onDidFocusEditorWidget(() => setActiveDiffEditor(editor))
    // Reached by keyboard (Ctrl+Tab) with nothing focused: let the user keep navigating in the diff.
    if (!document.activeElement || document.activeElement === document.body) editor.getModifiedEditor().focus()
  }

  if (!data || !tab || !getDiffModels(tabId)) {
    return <div className="flex h-full items-center justify-center text-[12px] text-subtle">This diff is no longer available.</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-line bg-app px-3 text-[12px]">
        <span className="truncate text-muted" title={tab.path}>
          {basename(tab.path)}
        </span>
        <span className="text-subtle">Original ↔ Modified</span>
        {stats && (
          <span className="flex items-center gap-1.5 font-mono text-[11px]">
            <span className="text-success">+{stats.added}</span>
            <span className="text-danger">−{stats.removed}</span>
          </span>
        )}
        {data.readOnly ? (
          <Badge tone="neutral" title="The modified side is read-only">
            <Lock size={10} /> Read-only
          </Badge>
        ) : (
          <Badge tone="accent" title={`Edit the right side and save with ${formatKeybinding('mod+s')}`}>
            Editable
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton title="Previous Change" icon={<ArrowUp size={14} />} disabled={!stats?.changes} onClick={() => editorRef.current?.goToDiff('previous')} />
          <IconButton title="Next Change" icon={<ArrowDown size={14} />} disabled={!stats?.changes} onClick={() => editorRef.current?.goToDiff('next')} />
          <IconButton
            title={sideBySide ? 'Inline View' : 'Side-by-Side View'}
            icon={sideBySide ? <Rows2 size={14} /> : <Columns2 size={14} />}
            onClick={() => setSideBySide((v) => !v)}
          />
          <IconButton title="Open File" icon={<FileText size={14} />} onClick={() => void useEditorStore.getState().openFile(tab.path, { preview: false })} />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <MonacoDiffEditor
          originalModelPath={data.originalUri}
          modifiedModelPath={data.modifiedUri}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          theme={theme}
          options={options}
          onMount={onMount}
          loading={
            <div className="flex items-center gap-2 text-[12px] text-subtle">
              <Spinner size={12} /> Loading diff…
            </div>
          }
        />
      </div>
    </div>
  )
}
