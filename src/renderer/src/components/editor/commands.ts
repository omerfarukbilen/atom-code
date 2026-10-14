/**
 * Editor, terminal and panel commands (palette entries + keyboard shortcuts + native menu ids).
 * `registerEditorCommands()` is called once at boot and is idempotent.
 */
import type { ContextAttachment } from '@shared/types'
import { relativePath } from '@shared/paths'
import { atom } from '../../lib/api'
import { isMac } from '../../lib/platform'
import { registerCommands, type Command } from '../../stores/commands'
import { getActiveCodeEditor, getActiveDiffEditor, getActiveMonacoEditor, triggerInlineEdit, useEditorStore } from '../../stores/editor'
import { useLayoutStore } from '../../stores/layout'
import { useSettingsStore } from '../../stores/settings'
import { focusTerminal, isTerminalFocused, usePanelUiStore, useTerminalStore } from '../../stores/terminal'
import { toast } from '../../stores/toast'
import { useWorkspaceStore } from '../../stores/workspace'
import { useAgentStore } from '../../stores/agent'

/** Ctrl-based shortcuts: the registry treats `mod` as Ctrl on Windows/Linux and only matches `ctrl` on macOS. */
const ctrl = (rest: string): string => (isMac ? `ctrl+${rest}` : `mod+${rest}`)

/** True when keyboard focus is inside a Monaco editor (text or one of its widgets). */
export function isEditorFocused(): boolean {
  const code = getActiveCodeEditor()
  if (code?.hasWidgetFocus()) return true
  const diff = getActiveDiffEditor()
  return !!diff && (diff.getModifiedEditor().hasWidgetFocus() || diff.getOriginalEditor().hasWidgetFocus())
}

/** True while typing in a regular input/textarea (outside Monaco) — Alt combos produce characters there. */
function isTypingInInput(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el || el.closest('.monaco-editor')) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

function paletteOpen(): boolean {
  return useLayoutStore.getState().commandPaletteOpen
}

function activeTab() {
  const { tabs, activeTabId } = useEditorStore.getState()
  return tabs.find((t) => t.id === activeTabId) ?? null
}

function hasTextTab(): boolean {
  const t = activeTab()
  return !!t && (t.kind === 'file' || t.kind === 'diff')
}

/**
 * Add context to the agent composer: the current selection when there is one, otherwise the file.
 * Pass `path` to attach a specific file (tab context menu).
 */
export function addToChat(path?: string): void {
  let attachment: ContextAttachment | null = null
  if (path) {
    attachment = { type: 'file', path }
  } else {
    const info = useEditorStore.getState().getActiveEditorInfo()
    const tab = activeTab()
    if (info?.selection && info.selection.text.trim()) {
      attachment = {
        type: 'selection',
        path: info.path,
        startLine: info.selection.startLine,
        endLine: info.selection.endLine,
        text: info.selection.text,
        language: info.language
      }
    } else if (info) {
      attachment = { type: 'file', path: info.path }
    } else if (tab && tab.kind === 'image') {
      attachment = { type: 'file', path: tab.path }
    }
  }
  const layout = useLayoutStore.getState()
  layout.setAgentVisible(true)
  const agent = useAgentStore.getState()
  if (attachment) agent.addAttachment(attachment)
  requestAnimationFrame(() => useAgentStore.getState().focusComposer())
}

/** Open the Cmd/Ctrl+K inline edit prompt in the active file editor. */
export function startInlineEdit(): void {
  const tab = activeTab()
  if (!tab || tab.kind !== 'file') {
    toast.info('Open a file to use inline edit', 'Select code and press the shortcut to edit it with ATOM.')
    return
  }
  const editor = getActiveCodeEditor()
  if (!editor) return
  editor.focus()
  triggerInlineEdit()
}

async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error('Could not access the clipboard')
  }
}

export function copyPath(path: string, relative: boolean): void {
  const ws = useWorkspaceStore.getState().workspace
  const value = relative && ws ? relativePath(ws.path, path) : path
  void copyText(value, relative ? 'Relative path' : 'Path')
}

/** Show the Explorer and reveal `path` in it. */
export function revealInExplorer(path: string): void {
  useLayoutStore.setState({ sidebarVisible: true, sidebarView: 'explorer' })
  void import('../explorer/explorerStore')
    .then((m) => m.useExplorerStore.getState().reveal(path))
    .catch(() => undefined)
}

/** Toggle / focus the terminal panel (VS Code Ctrl+` behaviour). */
export async function toggleTerminal(): Promise<void> {
  const layout = useLayoutStore.getState()
  if (layout.panelVisible && layout.panelTab === 'terminal' && isTerminalFocused()) {
    layout.setPanelVisible(false)
    getActiveMonacoEditor()?.focus()
    return
  }
  layout.showPanel('terminal')
  const term = useTerminalStore.getState()
  if (!term.instances.length) await term.create({ focus: true })
  else requestAnimationFrame(() => focusTerminal())
}

export async function newTerminal(): Promise<void> {
  useLayoutStore.getState().showPanel('terminal')
  await useTerminalStore.getState().create({ focus: true })
}

function toggleEditorSetting(key: 'wordWrap' | 'minimap' | 'stickyScroll'): void {
  const current = useSettingsStore.getState().settings.editor[key]
  void useSettingsStore.getState().update({ editor: { [key]: !current } })
}

function buildCommands(): Command[] {
  const editor = () => useEditorStore.getState()
  return [
    // ── File ──
    {
      id: 'file.save',
      title: 'Save',
      category: 'File',
      icon: 'Save',
      keybinding: 'mod+s',
      run: () => editor().saveActive()
    },
    {
      id: 'file.saveAll',
      title: 'Save All',
      category: 'File',
      icon: 'SaveAll',
      keybinding: 'mod+alt+s',
      run: () => editor().saveAll()
    },
    {
      id: 'file.closeEditor',
      title: 'Close Editor',
      category: 'File',
      icon: 'X',
      keybinding: 'mod+w',
      when: () => editor().tabs.length > 0 && !isTerminalFocused(),
      run: async () => {
        const id = editor().activeTabId
        if (id) await editor().closeTab(id)
      }
    },
    {
      id: 'file.newFile',
      title: 'New File…',
      category: 'File',
      icon: 'FilePlus',
      keybinding: 'mod+n',
      run: () => editor().openNewFileDialog()
    },
    {
      id: 'file.revert',
      title: 'Revert File',
      category: 'File',
      icon: 'Undo2',
      when: () => activeTab()?.kind === 'file',
      run: async () => {
        const t = activeTab()
        if (t?.kind === 'file') await editor().revertFile(t.path)
      }
    },

    // ── Editor ──
    {
      id: 'editor.inlineEdit',
      title: 'Edit Selection with ATOM',
      category: 'Editor',
      icon: 'Sparkles',
      keybinding: 'mod+k',
      when: () => activeTab()?.kind === 'file' && (isEditorFocused() || paletteOpen()),
      run: () => startInlineEdit()
    },
    {
      id: 'editor.addToChat',
      title: 'Add Selection to Chat',
      category: 'Editor',
      icon: 'MessageSquarePlus',
      keybinding: 'mod+l',
      when: () => isEditorFocused() || (paletteOpen() && !!activeTab() && activeTab()?.kind !== 'welcome'),
      run: () => addToChat()
    },
    {
      id: 'editor.addFileToChat',
      title: 'Add Active File to Chat',
      category: 'Editor',
      icon: 'FileText',
      when: () => {
        const t = activeTab()
        return !!t && (t.kind === 'file' || t.kind === 'image')
      },
      run: () => {
        const t = activeTab()
        if (t) addToChat(t.path)
      }
    },
    {
      id: 'editor.reopenClosed',
      title: 'Reopen Closed Editor',
      category: 'Editor',
      icon: 'RotateCcw',
      keybinding: 'mod+shift+t',
      when: () => editor().recentlyClosed.length > 0,
      run: () => editor().reopenClosed()
    },
    {
      id: 'editor.nextTab',
      title: 'Next Editor',
      category: 'Editor',
      keybinding: ctrl('tab'),
      when: () => editor().tabs.length > 1,
      run: () => editor().cycleTab(1)
    },
    {
      id: 'editor.prevTab',
      title: 'Previous Editor',
      category: 'Editor',
      keybinding: ctrl('shift+tab'),
      when: () => editor().tabs.length > 1,
      run: () => editor().cycleTab(-1)
    },
    {
      id: 'editor.formatDocument',
      title: 'Format Document',
      category: 'Editor',
      icon: 'AlignLeft',
      keybinding: 'shift+alt+f',
      when: () => hasTextTab() && (paletteOpen() || !isTypingInInput()),
      run: async () => {
        const ed = getActiveMonacoEditor()
        if (!ed) return
        const action = ed.getAction('editor.action.formatDocument')
        if (!action || !action.isSupported()) {
          toast.info('No formatter available for this file type')
          return
        }
        await action.run()
      }
    },
    {
      id: 'editor.goToLine',
      title: 'Go to Line…',
      category: 'Editor',
      icon: 'ArrowDownToLine',
      keybinding: ctrl('g'),
      when: () => hasTextTab(),
      run: () => {
        const ed = getActiveMonacoEditor()
        if (!ed) return
        ed.focus()
        void ed.getAction('editor.action.gotoLine')?.run()
      }
    },
    {
      id: 'editor.closeAll',
      title: 'Close All Editors',
      category: 'Editor',
      icon: 'XSquare',
      when: () => editor().tabs.length > 0,
      run: () => editor().closeAll()
    },
    {
      id: 'editor.closeOthers',
      title: 'Close Other Editors',
      category: 'Editor',
      when: () => editor().tabs.length > 1,
      run: async () => {
        const id = editor().activeTabId
        if (id) await editor().closeOthers(id)
      }
    },
    {
      id: 'editor.closeSaved',
      title: 'Close Saved Editors',
      category: 'Editor',
      when: () => editor().tabs.some((t) => !t.dirty),
      run: () => editor().closeSaved()
    },
    {
      id: 'editor.toggleWordWrap',
      title: 'Toggle Word Wrap',
      category: 'View',
      icon: 'WrapText',
      keybinding: 'alt+z',
      when: () => paletteOpen() || !isTypingInInput(),
      run: () => toggleEditorSetting('wordWrap')
    },
    {
      id: 'editor.toggleMinimap',
      title: 'Toggle Minimap',
      category: 'View',
      icon: 'Map',
      run: () => toggleEditorSetting('minimap')
    },
    {
      id: 'editor.toggleStickyScroll',
      title: 'Toggle Sticky Scroll',
      category: 'View',
      run: () => toggleEditorSetting('stickyScroll')
    },
    {
      id: 'editor.copyPath',
      title: 'Copy Path of Active File',
      category: 'File',
      icon: 'Copy',
      when: () => {
        const t = activeTab()
        return !!t && t.kind !== 'welcome'
      },
      run: () => {
        const t = activeTab()
        if (t) copyPath(t.path, false)
      }
    },
    {
      id: 'editor.copyRelativePath',
      title: 'Copy Relative Path of Active File',
      category: 'File',
      when: () => {
        const t = activeTab()
        return !!t && t.kind !== 'welcome'
      },
      run: () => {
        const t = activeTab()
        if (t) copyPath(t.path, true)
      }
    },
    {
      id: 'editor.revealInExplorer',
      title: 'Reveal Active File in Explorer View',
      category: 'File',
      icon: 'FolderSearch',
      when: () => {
        const t = activeTab()
        return !!t && (t.kind === 'file' || t.kind === 'image')
      },
      run: () => {
        const t = activeTab()
        if (t) revealInExplorer(t.path)
      }
    },
    {
      id: 'editor.revealInOs',
      title: isMac ? 'Reveal Active File in Finder' : 'Reveal Active File in File Manager',
      category: 'File',
      when: () => {
        const t = activeTab()
        return !!t && (t.kind === 'file' || t.kind === 'image')
      },
      run: () => {
        const t = activeTab()
        if (t) void atom.app.showItemInFolder(t.path)
      }
    },
    {
      id: 'view.welcome',
      title: 'Show Welcome Page',
      category: 'Help',
      icon: 'Atom',
      run: () => editor().openWelcome()
    },

    // ── Terminal & panel ──
    {
      id: 'terminal.new',
      title: 'New Terminal',
      category: 'Terminal',
      icon: 'SquareTerminal',
      keybinding: ctrl('shift+`'),
      run: () => newTerminal()
    },
    {
      id: 'view.terminal',
      title: 'Toggle Terminal',
      category: 'View',
      icon: 'Terminal',
      keybinding: ctrl('`'),
      run: () => toggleTerminal()
    },
    {
      id: 'terminal.kill',
      title: 'Kill Active Terminal',
      category: 'Terminal',
      icon: 'Trash2',
      when: () => !!useTerminalStore.getState().activeId,
      run: async () => {
        const id = useTerminalStore.getState().activeId
        if (id) await useTerminalStore.getState().kill(id)
      }
    },
    {
      id: 'terminal.clear',
      title: 'Clear Terminal',
      category: 'Terminal',
      icon: 'Eraser',
      when: () => !!useTerminalStore.getState().activeId,
      run: () => useTerminalStore.getState().clear()
    },
    {
      id: 'view.problems',
      title: 'Show Problems',
      category: 'View',
      icon: 'CircleAlert',
      keybinding: 'mod+shift+m',
      run: () => useLayoutStore.getState().showPanel('problems')
    },
    {
      id: 'view.output',
      title: 'Show Output',
      category: 'View',
      icon: 'ScrollText',
      run: () => useLayoutStore.getState().showPanel('output')
    },
    {
      id: 'view.togglePanelMaximized',
      title: 'Toggle Maximized Panel',
      category: 'View',
      icon: 'Maximize2',
      when: () => useLayoutStore.getState().panelVisible,
      run: () => usePanelUiStore.getState().toggleMaximized()
    }
  ]
}

let unregister: (() => void) | null = null

/** Register all editor/terminal/panel commands. Safe to call more than once. */
export function registerEditorCommands(): () => void {
  if (unregister) return unregister
  const off = registerCommands(buildCommands())
  const dispose = (): void => {
    off()
    if (unregister === dispose) unregister = null
  }
  unregister = dispose
  return dispose
}
