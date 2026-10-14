/**
 * Answers the agent's `atom-ide` MCP tool calls (forwarded by the main process) from the renderer state:
 * open editors, current selection, Monaco diagnostics, opening files and terminal output.
 */
import type { IdeDiagnostic, IdeOpenEditorsResult, IdeRequest, IdeSelectionResult, Unsubscribe } from '@shared/types'
import { isInside, joinPath, normalizeSlashes } from '@shared/paths'
import { atom } from './api'
import { useEditorStore } from '../stores/editor'
import { getTerminalBufferText } from '../stores/terminal'
import { useWorkspaceStore } from '../stores/workspace'

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

/** Resolve a possibly relative path (as the agent sees it) against the workspace root. */
export function resolveWorkspacePath(p: string): string {
  const input = p.replace(/^file:\/\//, '')
  const isAbs = input.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(input) || input.startsWith('\\\\')
  if (isAbs) return input
  const ws = useWorkspaceStore.getState().workspace
  if (!ws) return input
  return joinPath(ws.path, input.replace(/^\.\//, ''))
}

function getOpenEditors(): IdeOpenEditorsResult {
  const { tabs, activeTabId } = useEditorStore.getState()
  const active = tabs.find((t) => t.id === activeTabId)
  const info = useEditorStore.getState().getActiveEditorInfo()
  const seen = new Set<string>()
  const editors: IdeOpenEditorsResult['editors'] = []
  for (const t of tabs) {
    if (t.kind !== 'file' && t.kind !== 'image') continue
    const key = normalizeSlashes(t.path)
    if (seen.has(key)) continue
    seen.add(key)
    editors.push({ path: t.path, dirty: t.dirty, language: t.language })
  }
  return {
    activePath: active && active.kind !== 'welcome' ? active.path : null,
    editors,
    cursor: info ? { line: info.line, column: info.column } : null
  }
}

function getSelection(): IdeSelectionResult {
  const info = useEditorStore.getState().getActiveEditorInfo()
  if (!info) return { path: null, text: '', startLine: 0, endLine: 0 }
  if (!info.selection) return { path: info.path, text: '', startLine: info.line, endLine: info.line }
  return { path: info.path, text: info.selection.text, startLine: info.selection.startLine, endLine: info.selection.endLine }
}

function getDiagnostics(params: Record<string, unknown>): { diagnostics: IdeDiagnostic[] } {
  const p = str(params.path)
  const store = useEditorStore.getState()
  if (!p) return { diagnostics: store.getDiagnostics() }
  const abs = resolveWorkspacePath(p)
  const target = normalizeSlashes(abs).replace(/\/+$/, '')
  // A folder path returns diagnostics of every file inside it.
  const all = store.getDiagnostics()
  const exact = all.filter((d) => normalizeSlashes(d.path) === target)
  if (exact.length) return { diagnostics: exact }
  return { diagnostics: all.filter((d) => isInside(target, d.path)) }
}

async function openFile(params: Record<string, unknown>): Promise<{ ok: true; path: string }> {
  const p = str(params.path)
  if (!p) throw new Error('openFile: "path" is required')
  const abs = resolveWorkspacePath(p)
  const line = num(params.line)
  const endLine = num(params.endLine ?? params.end_line)
  await useEditorStore.getState().openFile(abs, { line, endLine, preview: false, focus: false })
  return { ok: true, path: abs }
}

function getTerminalOutput(params: Record<string, unknown>): { output: string } {
  const max = num(params.maxChars ?? params.max_chars) ?? 8000
  return { output: getTerminalBufferText(Math.min(max, 100_000)) }
}

async function handle(req: IdeRequest): Promise<unknown> {
  const params = req.params ?? {}
  switch (req.method) {
    case 'getOpenEditors':
      return getOpenEditors()
    case 'getSelection':
      return getSelection()
    case 'getDiagnostics':
      return getDiagnostics(params)
    case 'openFile':
      return openFile(params)
    case 'getTerminalOutput':
      return getTerminalOutput(params)
    default:
      throw new Error(`Unknown IDE method: ${String((req as { method: unknown }).method)}`)
  }
}

let unsubscribe: Unsubscribe | null = null

/** Register the renderer side of the IDE bridge. Idempotent; returns the uninstall function. */
export function installIdeBridge(): Unsubscribe {
  if (unsubscribe) return unsubscribe
  const off = atom.ide.onRequest(handle)
  const uninstall: Unsubscribe = () => {
    off()
    if (unsubscribe === uninstall) unsubscribe = null
  }
  unsubscribe = uninstall
  return uninstall
}
